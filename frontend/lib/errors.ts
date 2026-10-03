/**
 * Turning a failure into words a person can act on (3 Oct 2026, UI revamp
 * Phase B, slice 2).
 *
 * What this replaces. Every error the app showed used to go through
 * `apiErrorMessage` in lib/api.ts, at 63 call sites. It appended the
 * machine code to the sentence ("... (CSRF_VALIDATION_FAILED)"), and when
 * the server had sent no sentence it fell back to the HTTP library's own
 * text, so a person could be shown "Request failed with status code 500",
 * "Network Error" or "timeout of 90000ms exceeded". Shailesh, 3 Oct 2026:
 * an error "should never be a raw error but one that the user should see
 * ... just like it is shown in every top notch world class platform".
 *
 * The rule this file enforces: nothing reaches the screen that was not
 * written for a person. That means no machine code, no HTTP status, no
 * library message, no JavaScript exception text, no response body that is
 * not our own envelope. There are exactly three sources of copy:
 *
 *   1. The server's sentence, when the response is our error envelope
 *      (backend/app/core/error_handling.py). Only the server knows it was
 *      the transfer date, or the third attempt, and its messages are
 *      written to the same standard as a label (backend/app/core/errors.py).
 *   2. The sentences in this file, for everything the server cannot say
 *      because it never got to speak: no connection, a timeout, a proxy
 *      answering in its place, a crash that produced no envelope.
 *   3. A UserFacingError thrown by our own browser-side code (image
 *      compression, for instance), which carries copy by definition.
 *
 * Two things make the second kind specific rather than generic:
 *
 *   `action`  what was being attempted, as the words that complete "We
 *             couldn't ...": "load your sections", "save this mark". Every
 *             call site passes one, so an outage on the Assign page reads
 *             "We couldn't load your sections because Krama
 *             couldn't be reached", not "Something went wrong".
 *   `role`    who is reading. A student is sent to their teacher, a
 *             teacher to their school admin; a Super Admin, who has nobody
 *             above them, is told what the reference is for instead.
 *
 * This module's only runtime import is the product's name (lib/brand.ts,
 * itself import-free); the other import is a type. It recognises an axios error by shape
 * rather than by `axios.isAxiosError`, so it can be unit-tested in plain
 * Node with no bundler: see tests/unit/errors.test.mjs and
 * scripts/run-unit-tests.mjs.
 */
import type { UserRole } from "@/types/auth";
import { PRODUCT_NAME } from "./brand";

export type ErrorKind =
  /** The browser says it has no connection at all. */
  | "offline"
  /** No response arrived, and the browser thinks it is online. */
  | "network"
  /** We stopped waiting. */
  | "timeout"
  /** The session behind this page is over (401 from the session check). */
  | "session"
  /** Signed in, but not allowed. */
  | "forbidden"
  | "notFound"
  /** The server understood and said no: validation, a conflict, a rule. */
  | "rejected"
  | "rateLimited"
  | "tooLarge"
  /** A gateway answered instead of the app: starting up, deploying, asleep. */
  | "unavailable"
  /** The app itself failed (5xx with our envelope, or an unrecognised 5xx). */
  | "server"
  | "cancelled"
  /** Not an HTTP failure at all: an exception in our own browser code. */
  | "unexpected";

export interface FieldIssue {
  /** Dotted path of the input the server rejected, e.g. "transferDate". */
  field: string;
  /** One sentence about it, already written for a person. */
  issue: string;
}

export interface DescribedError {
  kind: ErrorKind;
  /** A short heading, for a full-page or card treatment: "You're offline". */
  title: string;
  /** What to show. Complete on its own; includes the reference when one helps. */
  message: string;
  /** SE-XXXX-XXXX when the server supplied one, for a caller that wants to set it apart. */
  reference: string | null;
  /** Whether doing the same thing again, unchanged, could work. */
  retryable: boolean;
  /** Seconds the server asked us to wait, on a rate limit. */
  retryAfterSeconds: number | null;
  /** Per-input problems, when the server listed them. */
  fields: FieldIssue[];
  /** For programs only. Neither is ever shown. */
  status: number | null;
  code: string | null;
}

export interface DescribeOptions {
  /** Completes "We couldn't ...". Lower case, no full stop: "load your sections". */
  action?: string;
  /** Who is reading. null/undefined means nobody is signed in (the sign-in page). */
  role?: UserRole | null;
}

/**
 * An error raised by our own browser-side code whose message was written
 * for the person and may be shown as it is. A plain Error is never shown:
 * its message is whatever the JavaScript engine or a library put there.
 */
export class UserFacingError extends Error {
  readonly isUserFacing = true as const;

  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

// --- who to ask ---------------------------------------------------------------

/**
 * Who someone in this role goes to when they can't fix it themselves, as a
 * phrase that reads after "ask ..." / "tell ...". Follows who actually holds
 * the power in the product, as the backend's who_can_help does
 * (backend/app/core/errors.py): a school admin manages that school's
 * teachers and students; only a Super Admin manages admins. Two deliberate
 * differences from the backend's version. A student is sent to "your
 * teacher" alone -- the backend adds "or school admin" because its messages
 * are about accounts, which an admin fixes; these are about something not
 * working, which a child takes to their teacher. And a Super Admin, who has
 * no one above them inside the product, gets null rather than a phrase, so
 * callers say something else.
 */
export function whoCanHelp(role: UserRole | null | undefined): string | null {
  if (role === "STUDENT") return "your teacher";
  if (role === "TEACHER") return "your school admin";
  if (role === "ADMIN") return "your platform administrator";
  if (role === "SUPER_ADMIN") return null;
  return "your school";
}

/** The sentence that hands someone a reference, for their role. */
export function referenceLine(reference: string, role: UserRole | null | undefined): string {
  if (role === "STUDENT") return `If it keeps happening, tell your teacher and show them this reference: ${reference}.`;
  if (role === "SUPER_ADMIN") {
    return `If it keeps happening, this reference finds the exact request in the server logs: ${reference}.`;
  }
  return `If it keeps happening, give ${whoCanHelp(role)} this reference: ${reference}.`;
}

// --- reading the failure ------------------------------------------------------

// The server's reference format (error_handling.py, new_request_id). Checked
// before display so that a header some proxy set to something else is never
// printed as if it were ours.
const REFERENCE = /^SE-[0-9A-Z]{4}-[0-9A-Z]{4}$/;

// 5xx codes that say nothing beyond their status. A 5xx carrying any other
// code is a specific failure with its own sentence from the server.
const GENERIC_SERVER_CODES = new Set([
  "INTERNAL_SERVER_ERROR",
  "BAD_GATEWAY",
  "SERVICE_UNAVAILABLE",
  "GATEWAY_TIMEOUT",
  "REQUEST_FAILED",
]);

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * A sentence from the server is shown only if it could have been written by
 * a person for a person. Our envelope's always are; this is the net under
 * that, so a stack trace or a page of proxy HTML that somehow arrives in a
 * `message` field falls through to our own wording instead of the screen.
 */
function readableSentence(value: unknown): string | null {
  const sentence = text(value);
  if (!sentence || sentence.length > 500) return null;
  if (/<\/?[a-z!][^>]*>/i.test(sentence)) return null;
  if (/Traceback \(most recent|^\s*at \S+ \(|Exception:|Error: /.test(sentence)) return null;
  return sentence;
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== "object") return null;
  const bag = headers as { get?: (key: string) => unknown } & Dict;
  // axios hands back an AxiosHeaders (case-insensitive .get); a plain object
  // has lower-cased keys in the browser.
  const viaGet = typeof bag.get === "function" ? bag.get(name) : undefined;
  return text(viaGet ?? bag[name] ?? bag[name.toLowerCase()]);
}

/**
 * The server's error object, or null if this body is not one of ours.
 *
 * Ours is {"detail": {code, message, details, requestId}}: an object with a
 * string `code` and a string `message`. A `detail` that is a string or a
 * list is a framework's own. A crash also carries the same object under a
 * legacy top-level "error" key -- but that key is the usual place for
 * everyone else's errors too (a hosting platform's
 * {"error": {"code": "...", "message": "An error occurred with your
 * deployment"}}), so it is believed only when it carries one of our own
 * references. Anything that fails these tests gets this file's wording
 * instead of its own, whatever its `message` says.
 */
function ownEnvelope(data: Dict): Dict | null {
  const detail = data.detail;
  if (isDict(detail) && text(detail.code) && typeof detail.message === "string") return detail;
  const legacy = data.error;
  if (isDict(legacy) && text(legacy.code) && typeof legacy.message === "string") {
    const reference = text(legacy.requestId);
    if (reference && REFERENCE.test(reference)) return legacy;
  }
  return null;
}

interface Facts {
  transport: "response" | "timeout" | "cancelled" | "none" | "notHttp";
  status: number | null;
  code: string | null;
  sentence: string | null;
  reference: string | null;
  retryAfterSeconds: number | null;
  fields: FieldIssue[];
  /** GET/HEAD: nothing on the server can have changed. */
  readOnly: boolean;
  userFacing: string | null;
}

function readFacts(error: unknown): Facts {
  const facts: Facts = {
    transport: "notHttp",
    status: null,
    code: null,
    sentence: null,
    reference: null,
    retryAfterSeconds: null,
    fields: [],
    readOnly: true,
    userFacing: null,
  };

  if (isDict(error) && error.isUserFacing === true) {
    facts.userFacing = readableSentence(error.message);
    return facts;
  }
  // An axios error, by shape (see the file comment on why not isAxiosError).
  if (!isDict(error) || !(error.isAxiosError === true || "response" in error || "request" in error)) {
    return facts;
  }

  const config = isDict(error.config) ? error.config : {};
  const method = (text(config.method) || "get").toLowerCase();
  facts.readOnly = method === "get" || method === "head";

  const response = isDict(error.response) ? error.response : null;
  if (!response) {
    const axiosCode = text(error.code);
    if (axiosCode === "ERR_CANCELED") facts.transport = "cancelled";
    else if (axiosCode === "ECONNABORTED" || axiosCode === "ETIMEDOUT") facts.transport = "timeout";
    else facts.transport = "none";
    return facts;
  }

  facts.transport = "response";
  facts.status = typeof response.status === "number" ? response.status : null;

  const data = isDict(response.data) ? response.data : {};
  const envelope = ownEnvelope(data);
  if (envelope) {
    facts.code = text(envelope.code);
    facts.sentence = readableSentence(envelope.message);
    const details = isDict(envelope.details) ? envelope.details : {};
    if (typeof details.retryAfterSeconds === "number" && details.retryAfterSeconds > 0) {
      facts.retryAfterSeconds = Math.ceil(details.retryAfterSeconds);
    }
    if (Array.isArray(details.fields)) {
      for (const entry of details.fields) {
        if (!isDict(entry)) continue;
        const field = text(entry.field);
        const issue = readableSentence(entry.issue);
        if (field && issue) facts.fields.push({ field, issue });
      }
    }
    const fromBody = text(envelope.requestId);
    if (fromBody && REFERENCE.test(fromBody)) facts.reference = fromBody;
  }

  if (!facts.reference) {
    const fromHeader = headerValue(response.headers, "x-request-id");
    if (fromHeader && REFERENCE.test(fromHeader)) facts.reference = fromHeader;
  }
  if (facts.retryAfterSeconds === null) {
    const retryAfter = Number(headerValue(response.headers, "retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) facts.retryAfterSeconds = Math.ceil(retryAfter);
  }
  return facts;
}

// --- wording ------------------------------------------------------------------

/** Rounded the way the server rounds it (error_handling.py, _spoken_wait). */
export function spokenWait(seconds: number): string {
  if (seconds <= 5) return "a few seconds";
  if (seconds <= 50) return `about ${Math.ceil(seconds / 10) * 10} seconds`;
  if (seconds <= 90) return "about a minute";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? "about an hour" : `about ${hours} hours`;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function build(
  facts: Facts,
  kind: ErrorKind,
  title: string,
  message: string,
  retryable: boolean,
): DescribedError {
  return {
    kind,
    title,
    message,
    reference: facts.reference,
    retryable,
    retryAfterSeconds: facts.retryAfterSeconds,
    fields: facts.fields,
    status: facts.status,
    code: facts.code,
  };
}

/**
 * The one place a failure becomes words. See the file comment for the rule
 * it enforces and where each sentence comes from.
 */
export function describeError(error: unknown, options: DescribeOptions = {}): DescribedError {
  const facts = readFacts(error);
  const action = text(options.action);
  const role = options.role ?? null;
  const helper = whoCanHelp(role);

  // -- our own browser-side code ---------------------------------------------
  if (facts.userFacing) {
    return build(facts, "rejected", "That didn't work", facts.userFacing, false);
  }
  if (facts.transport === "notHttp") {
    return build(
      facts,
      "unexpected",
      "Something didn't work",
      action ? `We couldn't ${action}. Please try again.` : "Something didn't work as expected. Please try again.",
      true,
    );
  }

  // -- no response -----------------------------------------------------------
  if (facts.transport === "cancelled") {
    return build(facts, "cancelled", "Cancelled", "That was cancelled before it finished.", true);
  }
  if (facts.transport === "timeout") {
    if (!facts.readOnly) {
      // We sent a change and stopped waiting for the answer. It may well
      // have been made. Saying "it failed, try again" here is how an
      // assignment gets set twice. It does not say HOW to check, because
      // that depends on the page -- and the obvious way, refreshing, throws
      // away whatever else was typed there. A page where trying again is
      // known to be safe says so itself (the student's Submit does).
      return build(
        facts,
        "timeout",
        "We didn't hear back in time",
        action
          ? `We didn't hear back in time, so we can't confirm whether we managed to ${action}. Please check before trying again.`
          : "We didn't hear back in time, so we can't confirm that went through. Please check before trying again.",
        false,
      );
    }
    return build(
      facts,
      "timeout",
      "This is taking too long",
      action
        ? `We couldn't ${action} in time. The connection may be slow, so please try again in a moment.`
        : "That took longer than it should. The connection may be slow, so please try again in a moment.",
      true,
    );
  }
  if (facts.transport === "none") {
    if (isOffline()) {
      return build(
        facts,
        "offline",
        "You're offline",
        action ? `You're offline, so we couldn't ${action}. Reconnect and try again.` : "You're offline. Reconnect and try again.",
        true,
      );
    }
    return build(
      facts,
      "network",
      `We can't reach ${PRODUCT_NAME}`,
      action
        ? `We couldn't ${action} because ${PRODUCT_NAME} couldn't be reached. Check your internet connection and try again.`
        : `We couldn't reach ${PRODUCT_NAME}. Check your internet connection and try again.`,
      true,
    );
  }

  // -- a response ------------------------------------------------------------
  const status = facts.status ?? 0;
  const sentence = facts.sentence;

  if (status === 429) {
    const wait = facts.retryAfterSeconds ? spokenWait(facts.retryAfterSeconds) : "a minute";
    return build(
      facts,
      "rateLimited",
      "Too many attempts",
      sentence ?? `Too many attempts in a short time. Please wait ${wait} and try again.`,
      true,
    );
  }

  if (status >= 500) {
    const specific = sentence && facts.code && !GENERIC_SERVER_CODES.has(facts.code) ? sentence : null;
    const gateway = !specific && !facts.code && (status === 502 || status === 503 || status === 504);
    if (gateway) {
      // No envelope and a gateway status: the app did not answer, something
      // in front of it did. On this hosting that is a deploy in progress or
      // the server waking after a quiet spell, and it clears by itself.
      return build(
        facts,
        "unavailable",
        `${PRODUCT_NAME} is briefly unavailable`,
        action
          ? `We couldn't ${action} because ${PRODUCT_NAME} is starting up or briefly unavailable. Please try again in a minute.`
          : `${PRODUCT_NAME} is starting up or briefly unavailable. Please try again in a minute.`,
        true,
      );
    }
    const core =
      specific ??
      (action
        ? `We couldn't ${action} because something went wrong on our side. Please try again in a moment.`
        : "Something went wrong on our side. Please try again in a moment.");
    const message = facts.reference ? `${core} ${referenceLine(facts.reference, role)}` : core;
    return build(facts, "server", "Something went wrong on our side", message, true);
  }

  if (status === 401) {
    // UNAUTHORIZED is the session check's only 401 code. Any other 401 is a
    // refusal with its own reason -- wrong password, wrong code -- and the
    // session, if there is one, is untouched.
    if (!facts.code || facts.code === "UNAUTHORIZED") {
      return build(
        facts,
        "session",
        "You've been signed out",
        sentence ?? "Your session has ended. Please sign in again.",
        false,
      );
    }
    return build(
      facts,
      "rejected",
      "That didn't work",
      sentence ?? "That couldn't be verified. Please check what you entered and try again.",
      false,
    );
  }

  if (status === 403) {
    const fallback = helper
      ? `You don't have permission to do that. If you think you should, ask ${helper}.`
      : "You don't have permission to do that.";
    return build(facts, "forbidden", "You don't have access to this", sentence ?? fallback, false);
  }

  if (status === 404) {
    return build(
      facts,
      "notFound",
      "We couldn't find that",
      sentence ??
        (action
          ? `We couldn't ${action}. What you were looking for may have been removed, so refresh the page to see what's current.`
          : "We couldn't find that. It may have been removed, so refresh the page to see what's current."),
      false,
    );
  }

  if (status === 413) {
    return build(
      facts,
      "tooLarge",
      "That file is too large",
      sentence ?? "That file is too large to upload. Please choose a smaller one.",
      false,
    );
  }

  if (status === 408) {
    return build(
      facts,
      "timeout",
      "This is taking too long",
      sentence ?? "That took too long to send. Please try again.",
      true,
    );
  }

  if (status >= 400) {
    return build(
      facts,
      "rejected",
      "That couldn't be done",
      sentence ??
        (action
          ? `We couldn't ${action}. Please check the details and try again.`
          : "That couldn't be completed. Please check the details and try again."),
      false,
    );
  }

  // A "failure" with a 2xx/3xx status: a redirect we did not follow, or a
  // body we could not read. Nothing the person did, and nothing to quote.
  return build(
    facts,
    "unexpected",
    "Something didn't work",
    action ? `We couldn't ${action}. Please try again.` : "Something didn't work as expected. Please try again.",
    true,
  );
}

/**
 * True when the server itself answered and said no: one of our own codes on
 * a 4xx. Only then is it certain that what was asked for did not happen.
 * Every other failure -- no connection, a timeout, a gateway, a crash --
 * leaves that unknown, and copy that states an outcome ("you're still
 * signed in") must not be attached to it.
 */
export function wasRefused(problem: DescribedError): boolean {
  return problem.code !== null && problem.status !== null && problem.status >= 400 && problem.status < 500;
}

/**
 * True when the failure says nothing about the person or their request: the
 * server could not be reached or could not answer. Used to decide between
 * "show a way to try again" and "send them to sign in".
 */
export function isOutage(error: unknown): boolean {
  const kind = describeError(error).kind;
  return kind === "offline" || kind === "network" || kind === "timeout" || kind === "unavailable" || kind === "server";
}
