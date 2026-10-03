/**
 * lib/errors.ts -- what a person is shown when something fails.
 *
 * The rule under test is in that file's header: nothing reaches the screen
 * that was not written for a person. So most of these build a failure the
 * way it really arrives (an axios error, by shape) and check both what the
 * sentence says and what it must never contain.
 *
 * Run with `npm test` (scripts/run-unit-tests.mjs).
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import {
  UserFacingError,
  describeError,
  isOutage,
  referenceLine,
  spokenWait,
  wasRefused,
  whoCanHelp,
} from "../../.test-build/lib/errors.mjs";

// --- builders: failures as axios really delivers them ------------------------

function httpError(status, data, { headers = {}, method = "get" } = {}) {
  return {
    isAxiosError: true,
    name: "AxiosError",
    message: `Request failed with status code ${status}`,
    code: status >= 500 ? "ERR_BAD_RESPONSE" : "ERR_BAD_REQUEST",
    config: { method, url: "/learning/tracker/overview" },
    request: {},
    response: { status, data, headers },
  };
}

function envelope(code, message, { details = {}, requestId = "SE-7K3F-9QXM" } = {}) {
  return { detail: { code, message, details, requestId } };
}

function noResponse(code, message, method = "get") {
  return { isAxiosError: true, name: "AxiosError", message, code, config: { method }, request: {} };
}

const ROLES = ["STUDENT", "TEACHER", "ADMIN", "SUPER_ADMIN", null];

/** Text that only a machine or a library would have written. */
const RAW = [
  /Request failed with status code/i,
  /Network Error/,
  /timeout of \d+ms/i,
  /\b[A-Z]{3,}_[A-Z_]{2,}\b/, // INTERNAL_SERVER_ERROR, CSRF_VALIDATION_FAILED ...
  /\bERR_[A-Z_]+\b/,
  /\bECONN[A-Z]+\b/,
  /\b[45]\d\d\b/, // an HTTP status
  /undefined|null|\[object/,
  /<[a-z/!]/i,
  /TypeError|Cannot read prop/,
];

function assertWrittenForAPerson(described) {
  assert.equal(typeof described.message, "string");
  assert.ok(described.message.length > 0, "message is empty");
  assert.match(described.message, /[.!?]$/, `not a finished sentence: ${described.message}`);
  assert.ok(described.title.length > 0, "title is empty");
  for (const pattern of RAW) {
    assert.doesNotMatch(described.message, pattern, `raw text in message: ${described.message}`);
    assert.doesNotMatch(described.title, pattern, `raw text in title: ${described.title}`);
  }
}

afterEach(() => {
  delete globalThis.navigator;
});

function setOnline(value) {
  Object.defineProperty(globalThis, "navigator", { value: { onLine: value }, configurable: true, writable: true });
}

// --- the server's own sentence ------------------------------------------------

describe("a response carrying our envelope", () => {
  test("shows the server's sentence, and never the code beside it", () => {
    const described = describeError(
      httpError(422, envelope("INVALID_TRANSFER_DATE", "The transfer date can't be before the student joined the section.")),
      { action: "transfer this student", role: "ADMIN" },
    );
    assert.equal(described.message, "The transfer date can't be before the student joined the section.");
    assert.equal(described.kind, "rejected");
    assert.equal(described.code, "INVALID_TRANSFER_DATE");
    assert.equal(described.status, 422);
    assert.equal(described.retryable, false);
    assertWrittenForAPerson(described);
  });

  test("the old reader's '(CODE)' suffix is gone for every status it used to decorate", () => {
    for (const [status, code] of [
      [400, "INVALID_PASSWORD"],
      [403, "CSRF_VALIDATION_FAILED"],
      [404, "NOT_FOUND"],
      [409, "ATTEMPT_LOCKED"],
      [422, "VALIDATION_ERROR"],
    ]) {
      const described = describeError(httpError(status, envelope(code, "A sentence the server wrote.")));
      assert.equal(described.message, "A sentence the server wrote.");
      assert.doesNotMatch(described.message, /\(/);
    }
  });

  test("a reference is carried on every envelope but only printed where it helps", () => {
    const refused = describeError(httpError(403, envelope("FORBIDDEN", "You don't have permission to do that.")));
    assert.equal(refused.reference, "SE-7K3F-9QXM");
    assert.doesNotMatch(refused.message, /SE-/);

    const crashed = describeError(
      httpError(500, envelope("INTERNAL_SERVER_ERROR", "Something went wrong on our side. Please try again in a moment.")),
      { role: "TEACHER" },
    );
    assert.match(crashed.message, /SE-7K3F-9QXM\.$/);
  });

  test("per-field problems are passed through for forms", () => {
    const described = describeError(
      httpError(
        422,
        envelope("VALIDATION_ERROR", "Page size must be at most 100.", {
          details: { fields: [{ field: "pageSize", in: "query", issue: "Page size must be at most 100." }, { field: 7 }] },
        }),
      ),
    );
    assert.deepEqual(described.fields, [{ field: "pageSize", issue: "Page size must be at most 100." }]);
  });

  test("the legacy top-level 'error' key on a crash is read the same way", () => {
    const body = { error: { code: "INTERNAL_SERVER_ERROR", message: "Something went wrong on our side.", requestId: "SE-2222-3333" } };
    const described = describeError(httpError(500, body), { action: "save this mark", role: "TEACHER" });
    assert.equal(described.kind, "server");
    assert.equal(described.reference, "SE-2222-3333");
    assertWrittenForAPerson({ ...described, message: described.message.replace("SE-2222-3333", "") });
  });
});

// --- everything that is not our envelope --------------------------------------

describe("a response that is not our envelope", () => {
  test("a framework's string detail is never shown", () => {
    for (const detail of ["Not Found", "Method Not Allowed", "Not authenticated", "Internal Server Error"]) {
      const status = detail === "Internal Server Error" ? 500 : 404;
      const described = describeError(httpError(status, { detail }), { action: "open this chapter" });
      assert.ok(!described.message.includes(detail), `showed the framework's "${detail}"`);
      assertWrittenForAPerson(described);
    }
  });

  test("a validation list from an older server is replaced, not printed", () => {
    const body = { detail: [{ type: "missing", loc: ["body", "password"], msg: "Field required", input: null }] };
    const described = describeError(httpError(422, body), { action: "change your password" });
    assert.equal(described.message, "We couldn't change your password. Please check the details and try again.");
    assertWrittenForAPerson(described);
  });

  test("the rate limiter's raw string is replaced, and the wait comes from the header", () => {
    const described = describeError(
      httpError(429, { error: "Rate limit exceeded: 5 per 1 minute" }, { headers: { "retry-after": "42" } }),
    );
    assert.equal(described.kind, "rateLimited");
    assert.equal(described.retryAfterSeconds, 42);
    assert.equal(described.message, "Too many attempts in a short time. Please wait about 50 seconds and try again.");
    assertWrittenForAPerson(described);
  });

  test("a proxy's HTML page is never shown, whatever the status", () => {
    const html = "<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>";
    for (const status of [404, 413, 500, 502, 503, 504]) {
      const described = describeError(httpError(status, html), { action: "load your classes" });
      assertWrittenForAPerson(described);
      assert.doesNotMatch(described.message, /nginx|Gateway/);
    }
  });

  test("a gateway answering for the app reads as 'briefly unavailable', not as our fault or theirs", () => {
    for (const status of [502, 503, 504]) {
      const described = describeError(httpError(status, ""), { action: "load your classes", role: "TEACHER" });
      assert.equal(described.kind, "unavailable");
      assert.equal(
        described.message,
        "We couldn't load your classes because Krama is starting up or briefly unavailable. Please try again in a minute.",
      );
      assert.equal(described.retryable, true);
    }
  });

  test("a 503 that IS ours keeps its own sentence", () => {
    const described = describeError(
      httpError(503, envelope("PLATFORM_ONBOARDING_DISABLED", "School onboarding is switched off on this server.")),
      { role: "SUPER_ADMIN" },
    );
    assert.equal(described.kind, "server");
    assert.match(described.message, /^School onboarding is switched off on this server\./);
  });

  test("an upload the proxy refused for size says so", () => {
    const described = describeError(httpError(413, "Request Entity Too Large", { method: "post" }));
    assert.equal(described.kind, "tooLarge");
    assert.equal(described.message, "That file is too large to upload. Please choose a smaller one.");
  });

  test("a message field holding a stack trace or markup falls back to our wording", () => {
    for (const message of [
      'Traceback (most recent call last):\n  File "app/main.py", line 3',
      "<b>Internal</b> error",
      "TypeError: Cannot read properties of undefined",
      "x".repeat(900),
    ]) {
      const described = describeError(httpError(400, { detail: { code: "BAD_REQUEST", message } }), { action: "save this lesson" });
      assert.equal(described.message, "We couldn't save this lesson. Please check the details and try again.");
    }
  });

  test("someone else's error object is not mistaken for ours", () => {
    // A hosting platform's own JSON, in the two places ours can appear.
    const foreign = [
      [413, { error: { code: "FUNCTION_PAYLOAD_TOO_LARGE", message: "Request Entity Too Large: FUNCTION_PAYLOAD_TOO_LARGE" } }],
      [504, { error: { code: "504", message: "An error occurred with your deployment" } }],
      [500, { error: { code: "INTERNAL_SERVER_ERROR", message: "A server error has occurred", requestId: "bom1::abcde-1700000000000" } }],
      [400, { detail: { message: "upstream connect error or disconnect/reset before headers. reset reason: connection failure" } }],
      [400, { detail: { code: 4001, message: "Bad things" } }],
      [502, { detail: { code: "BAD_GATEWAY" } }],
    ];
    for (const [status, body] of foreign) {
      const described = describeError(httpError(status, body), { action: "upload this file", role: "ADMIN" });
      const theirs = (body.error ?? body.detail).message;
      if (theirs) assert.ok(!described.message.includes(theirs), `showed "${theirs}"`);
      assert.equal(described.code, null, `took a code from ${JSON.stringify(body)}`);
      assertWrittenForAPerson(described);
    }
  });

  test("a missing thing reads properly whatever was being loaded", () => {
    for (const action of ["load your sections", "open this chapter", "save the new dates"]) {
      const described = describeError(httpError(404, "Not Found"), { action });
      assert.equal(
        described.message,
        `We couldn't ${action}. What you were looking for may have been removed, so refresh the page to see what's current.`,
      );
    }
  });

  test("a reference that is not in our format is not printed", () => {
    const described = describeError(
      httpError(500, { detail: { code: "INTERNAL_SERVER_ERROR", message: "x", requestId: "<script>alert(1)</script>" } }, {
        headers: { "x-request-id": "cf-ray-8a1b2c3d4e5f" },
      }),
      { role: "TEACHER" },
    );
    assert.equal(described.reference, null);
    assert.equal(described.message, "Something went wrong on our side. Please try again in a moment.");
  });

  test("the reference is taken from the X-Request-ID header when the body has none", () => {
    const headers = { get: (name) => (name.toLowerCase() === "x-request-id" ? "SE-ABCD-2345" : undefined) };
    const described = describeError(httpError(500, "", { headers }), { role: "ADMIN" });
    assert.equal(described.reference, "SE-ABCD-2345");
    assert.match(described.message, /give your platform administrator this reference: SE-ABCD-2345\.$/);
  });
});

// --- no response at all -------------------------------------------------------

describe("no response", () => {
  test("offline is named as offline", () => {
    setOnline(false);
    const described = describeError(noResponse("ERR_NETWORK", "Network Error"), { action: "load your sections" });
    assert.equal(described.kind, "offline");
    assert.equal(described.message, "You're offline, so we couldn't load your sections. Reconnect and try again.");
    assertWrittenForAPerson(described);
  });

  test("online but unreachable names what could not be reached", () => {
    setOnline(true);
    const described = describeError(noResponse("ERR_NETWORK", "Network Error"), { action: "load your sections" });
    assert.equal(described.kind, "network");
    assert.equal(
      described.message,
      "We couldn't load your sections because Krama couldn't be reached. Check your internet connection and try again.",
    );
    assertWrittenForAPerson(described);
  });

  test("a timed-out read can simply be tried again", () => {
    const described = describeError(noResponse("ECONNABORTED", "timeout of 90000ms exceeded"), { action: "load this attempt" });
    assert.equal(described.kind, "timeout");
    assert.equal(described.retryable, true);
    assert.equal(
      described.message,
      "We couldn't load this attempt in time. The connection may be slow, so please try again in a moment.",
    );
    assertWrittenForAPerson(described);
  });

  test("a timed-out change is not called a failure, because it may have gone through", () => {
    for (const method of ["post", "put", "patch", "delete"]) {
      const described = describeError(noResponse("ECONNABORTED", "timeout of 90000ms exceeded", method), {
        action: "save this mark",
      });
      assert.equal(described.retryable, false);
      assert.equal(
        described.message,
        "We didn't hear back in time, so we can't confirm whether we managed to save this mark. Please check before trying again.",
      );
      // Refreshing is how a page full of unsaved work gets thrown away.
      assert.doesNotMatch(described.message, /refresh/i);
      assertWrittenForAPerson(described);
    }
  });

  test("a cancelled request is recognised so callers can ignore it", () => {
    assert.equal(describeError(noResponse("ERR_CANCELED", "canceled")).kind, "cancelled");
  });
});

// --- sessions and permission ----------------------------------------------------

describe("401 and 403", () => {
  test("the session check's 401 means the session is over, in the server's words", () => {
    const error = httpError(401, envelope("UNAUTHORIZED", "Your password was changed, so this session has ended. Please sign in with your new password."));
    const described = describeError(error);
    assert.equal(described.kind, "session");
    assert.equal(described.message, "Your password was changed, so this session has ended. Please sign in with your new password.");
  });

  test("a 401 with no envelope is still a session end", () => {
    const error = httpError(401, { detail: "Not authenticated" });
    assert.equal(describeError(error).message, "Your session has ended. Please sign in again.");
    assert.equal(describeError(error).kind, "session");
  });

  test("a wrong password or wrong code is a refusal, not a sign-out", () => {
    for (const code of ["INVALID_CREDENTIALS", "INVALID_CODE", "ACCOUNT_LOCKED"]) {
      const error = httpError(401, envelope(code, "That code didn't match. Please try again."), { method: "post" });
      assert.equal(describeError(error).kind, "rejected");
    }
  });

  test("a bare 403 points each role at the right person", () => {
    const refused = (role) => describeError(httpError(403, ""), { role }).message;
    assert.equal(refused("STUDENT"), "You don't have permission to do that. If you think you should, ask your teacher.");
    assert.equal(refused("TEACHER"), "You don't have permission to do that. If you think you should, ask your school admin.");
    assert.equal(refused("ADMIN"), "You don't have permission to do that. If you think you should, ask your platform administrator.");
    assert.equal(refused("SUPER_ADMIN"), "You don't have permission to do that.");
  });
});

// --- our own crashes ------------------------------------------------------------

describe("a 500 from the app", () => {
  test("names what was being done and hands each role its reference line", () => {
    const body = envelope("INTERNAL_SERVER_ERROR", "Something went wrong on our side. Please try again in a moment.");
    const message = (role) => describeError(httpError(500, body, { method: "post" }), { action: "set this practice", role }).message;
    const core = "We couldn't set this practice because something went wrong on our side. Please try again in a moment.";

    assert.equal(message("STUDENT"), `${core} If it keeps happening, tell your teacher and show them this reference: SE-7K3F-9QXM.`);
    assert.equal(message("TEACHER"), `${core} If it keeps happening, give your school admin this reference: SE-7K3F-9QXM.`);
    assert.equal(message("ADMIN"), `${core} If it keeps happening, give your platform administrator this reference: SE-7K3F-9QXM.`);
    assert.equal(
      message("SUPER_ADMIN"),
      `${core} If it keeps happening, this reference finds the exact request in the server logs: SE-7K3F-9QXM.`,
    );
    assert.equal(message(null), `${core} If it keeps happening, give your school this reference: SE-7K3F-9QXM.`);
  });

  test("a specific 5xx keeps the server's sentence and still gets the reference", () => {
    const described = describeError(
      httpError(500, envelope("CODE_GENERATION_FAILED", "We couldn't generate a unique code for this person. Please try again.")),
      { action: "add this teacher", role: "ADMIN" },
    );
    assert.match(described.message, /^We couldn't generate a unique code for this person\. Please try again\. If it keeps/);
  });
});

// --- failures that never were HTTP ----------------------------------------------

describe("exceptions from our own code", () => {
  test("a JavaScript exception's message is never shown", () => {
    const errors = [
      new TypeError("Cannot read properties of undefined (reading 'map')"),
      new Error("Unexpected token < in JSON at position 0"),
      "a thrown string",
      undefined,
      null,
      42,
      {},
    ];
    for (const error of errors) {
      const withAction = describeError(error, { action: "load the dashboard" });
      assert.equal(withAction.kind, "unexpected");
      assert.equal(withAction.message, "We couldn't load the dashboard. Please try again.");
      assert.equal(describeError(error).message, "Something didn't work as expected. Please try again.");
    }
  });

  test("a UserFacingError is the one exception: its message is copy", () => {
    const described = describeError(new UserFacingError("That photo is too large. Please choose one under 5 MB."), {
      action: "update your photo",
    });
    assert.equal(described.message, "That photo is too large. Please choose one under 5 MB.");
    assert.equal(described.retryable, false);
  });
});

// --- the rule itself, swept -------------------------------------------------------

describe("no raw text for any status, shape or role", () => {
  const bodies = [
    undefined,
    null,
    "",
    "Bad Gateway",
    "<html><body>Application error</body></html>",
    { detail: "Not Found" },
    { detail: [{ loc: ["body", "x"], msg: "Field required", type: "missing" }] },
    { error: "Rate limit exceeded: 200 per 1 minute" },
    { message: "ECONNREFUSED 10.0.0.1:5432" },
    { detail: { code: "SOMETHING_ODD" } },
    { detail: { message: 12345 } },
    [],
  ];
  const statuses = [0, 200, 302, 400, 401, 403, 404, 405, 408, 409, 413, 415, 418, 422, 429, 500, 501, 502, 503, 504, 520];

  test("status x body x role x action", () => {
    let checked = 0;
    for (const status of statuses) {
      for (const data of bodies) {
        for (const role of ROLES) {
          for (const action of [undefined, "save your answer"]) {
            for (const method of ["get", "post"]) {
              assertWrittenForAPerson(describeError(httpError(status, data, { method }), { role, action }));
              checked += 1;
            }
          }
        }
      }
    }
    assert.equal(checked, statuses.length * bodies.length * ROLES.length * 2 * 2);
  });

  test("no-response failures, for every role", () => {
    for (const online of [true, false]) {
      setOnline(online);
      for (const role of ROLES) {
        for (const [code, message] of [
          ["ERR_NETWORK", "Network Error"],
          ["ECONNABORTED", "timeout of 90000ms exceeded"],
          ["ETIMEDOUT", "timeout of 90000ms exceeded"],
          [undefined, "Network Error"],
        ]) {
          for (const method of ["get", "post"]) {
            for (const action of [undefined, "save your answer"]) {
              assertWrittenForAPerson(describeError(noResponse(code, message, method), { role, action }));
            }
          }
        }
      }
    }
  });
});

// --- helpers ------------------------------------------------------------------

describe("helpers", () => {
  test("isOutage separates 'could not be reached' from 'was refused'", () => {
    assert.equal(isOutage(noResponse("ERR_NETWORK", "Network Error")), true);
    assert.equal(isOutage(noResponse("ECONNABORTED", "timeout")), true);
    assert.equal(isOutage(httpError(502, "")), true);
    assert.equal(isOutage(httpError(500, envelope("INTERNAL_SERVER_ERROR", "x"))), true);
    assert.equal(isOutage(httpError(401, envelope("UNAUTHORIZED", "Please sign in to continue."))), false);
    assert.equal(isOutage(httpError(403, envelope("FORBIDDEN", "No."))), false);
    assert.equal(isOutage(httpError(404, envelope("NOT_FOUND", "Gone."))), false);
  });

  test("wasRefused is true only when the server itself said no", () => {
    // Certain: it did not happen.
    assert.equal(wasRefused(describeError(httpError(403, envelope("FORBIDDEN", "No.")))), true);
    assert.equal(wasRefused(describeError(httpError(422, envelope("VALIDATION_ERROR", "No.")))), true);
    assert.equal(wasRefused(describeError(httpError(429, envelope("RATE_LIMITED", "Wait.")))), true);
    // Unknown: it may have happened, so no copy may claim it did not.
    assert.equal(wasRefused(describeError(noResponse("ERR_NETWORK", "Network Error", "post"))), false);
    assert.equal(wasRefused(describeError(noResponse("ECONNABORTED", "timeout", "post"))), false);
    assert.equal(wasRefused(describeError(httpError(502, "", { method: "post" }))), false);
    assert.equal(wasRefused(describeError(httpError(500, envelope("INTERNAL_SERVER_ERROR", "x"), { method: "post" }))), false);
    // A proxy's own 403 is not our server refusing.
    assert.equal(wasRefused(describeError(httpError(403, "<html>Forbidden</html>"))), false);
    assert.equal(wasRefused(describeError(new Error("boom"))), false);
  });

  test("whoCanHelp mirrors who actually holds the power", () => {
    assert.equal(whoCanHelp("STUDENT"), "your teacher");
    assert.equal(whoCanHelp("TEACHER"), "your school admin");
    assert.equal(whoCanHelp("ADMIN"), "your platform administrator");
    assert.equal(whoCanHelp("SUPER_ADMIN"), null);
    assert.equal(whoCanHelp(null), "your school");
    assert.equal(whoCanHelp(undefined), "your school");
  });

  test("referenceLine never tells a Super Admin to ask someone above them", () => {
    assert.doesNotMatch(referenceLine("SE-AAAA-2222", "SUPER_ADMIN"), /give|ask|tell/);
  });

  test("spokenWait rounds the way the server does", () => {
    assert.equal(spokenWait(3), "a few seconds");
    assert.equal(spokenWait(42), "about 50 seconds");
    assert.equal(spokenWait(50), "about 50 seconds");
    assert.equal(spokenWait(51), "about a minute");
    assert.equal(spokenWait(90), "about a minute");
    assert.equal(spokenWait(200), "about 4 minutes");
    assert.equal(spokenWait(3600), "about an hour");
    assert.equal(spokenWait(7200), "about 2 hours");
  });
});
