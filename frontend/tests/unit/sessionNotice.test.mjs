/**
 * lib/sessionNotice.ts -- why someone was sent to sign in, and where they
 * are taken back to. The rules that matter are the refusals: a return path
 * must never leave the site, cross into another role's area, or carry a
 * different person onto someone else's page.
 *
 * Run with `npm test` (scripts/run-unit-tests.mjs).
 */
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import {
  NOTICE_LIFETIME_MS,
  clearSignedOutNotice,
  readSignedOutNotice,
  rememberSignedOut,
  returnPathFor,
  safeReturnPath,
} from "../../.test-build/lib/sessionNotice.mjs";

function fakeStorage() {
  const items = new Map();
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => void items.set(key, String(value)),
    removeItem: (key) => void items.delete(key),
    _items: items,
  };
}

beforeEach(() => {
  globalThis.sessionStorage = fakeStorage();
});

describe("safeReturnPath", () => {
  test("a page inside the role's own area is kept, query and all", () => {
    assert.equal(safeReturnPath("/teacher/tracker", "TEACHER"), "/teacher/tracker");
    assert.equal(
      safeReturnPath("/teacher/tracker/assignments/abc-123?status=needs-review&page=2", "TEACHER"),
      "/teacher/tracker/assignments/abc-123?status=needs-review&page=2",
    );
    assert.equal(safeReturnPath("/student/practice/42", "STUDENT"), "/student/practice/42");
    assert.equal(safeReturnPath("/admin/people?tab=teachers", "ADMIN"), "/admin/people?tab=teachers");
    assert.equal(safeReturnPath("/admin/people", "SUPER_ADMIN"), "/admin/people");
  });

  test("the fragment is dropped", () => {
    assert.equal(safeReturnPath("/teacher/assign#top", "TEACHER"), "/teacher/assign");
  });

  test("another role's area is refused", () => {
    assert.equal(safeReturnPath("/admin/people", "TEACHER"), null);
    assert.equal(safeReturnPath("/teacher/tracker", "STUDENT"), null);
    assert.equal(safeReturnPath("/student/dashboard", "ADMIN"), null);
    // A prefix that only looks like the area.
    assert.equal(safeReturnPath("/teachers/elsewhere", "TEACHER"), null);
    assert.equal(safeReturnPath("/teacher", "TEACHER"), null);
  });

  test("anything that is not a plain path on this site is refused", () => {
    for (const path of [
      "https://evil.example/teacher/tracker",
      "//evil.example/teacher/tracker",
      "/\\evil.example/teacher/",
      "\\\\evil.example\\teacher\\",
      "javascript:alert(1)",
      "teacher/tracker",
      "/teacher/../admin/people",
      "/teacher/%2e%2e/admin/people",
      "/login",
      "/",
      "",
      "/teacher/\ntracker",
      `/teacher/${"x".repeat(600)}`,
      null,
      undefined,
      42,
      { toString: () => "/teacher/tracker" },
    ]) {
      assert.equal(safeReturnPath(path, "TEACHER"), null, `accepted ${JSON.stringify(path)}`);
    }
  });

  test("dot segments cannot be used to climb out of the area", () => {
    // Normalised by the URL parser to /admin/people, which is not /teacher/.
    assert.equal(safeReturnPath("/teacher/../admin/people", "TEACHER"), null);
    // ...and cannot be used to climb in, either.
    assert.equal(safeReturnPath("/student/../teacher/tracker", "STUDENT"), null);
  });
});

describe("returnPathFor", () => {
  const now = 1_800_000_000_000;
  const teacher = { id: "user-teacher-1", role: "TEACHER" };
  const notice = (overrides = {}) => ({
    message: "Your session has expired. Please sign in again.",
    returnTo: "/teacher/tracker/students/s-9",
    userId: "user-teacher-1",
    at: now - 60_000,
    ...overrides,
  });

  test("the same person is taken back to the page they were on", () => {
    assert.equal(returnPathFor(notice(), teacher, now), "/teacher/tracker/students/s-9");
  });

  test("a different person on the same computer is not", () => {
    assert.equal(returnPathFor(notice(), { id: "user-teacher-2", role: "TEACHER" }, now), null);
  });

  test("when it is not known whose session ended, nobody is taken back", () => {
    // The person who signed out in another tab and the next person at the
    // keyboard look the same from here.
    assert.equal(returnPathFor(notice({ userId: null }), teacher, now), null);
    assert.equal(returnPathFor(notice({ userId: "" }), teacher, now), null);
  });

  test("the same person signing in under a different role lands on that role's own home", () => {
    assert.equal(returnPathFor(notice(), { id: "user-teacher-1", role: "STUDENT" }, now), null);
  });

  test("a stale notice, or one from the future, is ignored", () => {
    assert.equal(returnPathFor(notice({ at: now - NOTICE_LIFETIME_MS - 1 }), teacher, now), null);
    assert.equal(returnPathFor(notice({ at: now + 5_000 }), teacher, now), null);
  });

  test("no notice, or one with no page, means the usual landing page", () => {
    assert.equal(returnPathFor(null, teacher, now), null);
    assert.equal(returnPathFor(notice({ returnTo: null }), teacher, now), null);
  });
});

describe("storage", () => {
  test("a notice round-trips, and clearing removes it", () => {
    rememberSignedOut({ message: "You've been signed out of all devices. Please sign in again.", returnTo: "/admin/security", userId: "u-1" });
    const read = readSignedOutNotice();
    assert.equal(read.message, "You've been signed out of all devices. Please sign in again.");
    assert.equal(read.returnTo, "/admin/security");
    assert.equal(read.userId, "u-1");
    assert.equal(typeof read.at, "number");

    clearSignedOutNotice();
    assert.equal(readSignedOutNotice(), null);
  });

  test("a stale notice reads as none", () => {
    rememberSignedOut({ message: "Your session has expired. Please sign in again." });
    assert.equal(readSignedOutNotice(Date.now() + NOTICE_LIFETIME_MS + 1_000), null);
  });

  test("garbage in storage reads as none rather than throwing", () => {
    for (const raw of ["not json", "null", "[]", "{}", '{"message":"","at":1}', '{"message":"x"}', '{"message":7,"at":1}']) {
      globalThis.sessionStorage.setItem("school_enrichment_signed_out", raw);
      assert.equal(readSignedOutNotice(), null, `read a notice out of ${raw}`);
    }
  });

  test("blocked or missing storage is survived silently", () => {
    globalThis.sessionStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    assert.doesNotThrow(() => rememberSignedOut({ message: "x" }));
    assert.equal(readSignedOutNotice(), null);
    assert.doesNotThrow(() => clearSignedOutNotice());

    delete globalThis.sessionStorage;
    assert.doesNotThrow(() => rememberSignedOut({ message: "x" }));
    assert.equal(readSignedOutNotice(), null);
    assert.doesNotThrow(() => clearSignedOutNotice());
  });
});
