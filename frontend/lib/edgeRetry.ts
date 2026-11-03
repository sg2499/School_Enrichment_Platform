/**
 * When to send a request again by itself (#213, 3 Nov 2026).
 *
 * On 3 Nov an admin signing in was told "Too many attempts in a short
 * time" after one attempt. Krama never saw the request: Render's front door
 * had turned it away, as "Too Many Requests" in plain text, because it came
 * from one of Vercel's shared servers. Krama now has its own addresses and
 * the browser calls the API directly, which removes that cause. This is the
 * second line: if anything in front of Krama ever turns a request away like
 * that again, the app waits a moment and tries again, twice, before saying
 * anything to the person.
 *
 * Only a refusal that did not come from Krama is retried. Krama's own
 * refusals carry its error envelope ({"detail": {"code": ...}}) and mean
 * what they say (a real limit on sign-in attempts, say); those are shown,
 * never retried. A refusal without the envelope was answered before the
 * request reached Krama, so nothing was done and sending it again is safe,
 * whatever the method.
 */

/** How many times one request is sent again. */
export const EDGE_RETRY_LIMIT = 2;

/** The waits before each retry when the refusal names none, in ms. */
const DEFAULT_WAITS_MS = [1500, 4000];

/** Never wait longer than this before a retry, whatever the refusal asks:
 * the person is looking at a spinner. Longer than this, say so instead. */
const LONGEST_WAIT_MS = 6000;

function isDict(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when the response body is Krama's own error envelope. */
export function isKramaEnvelope(data: unknown): boolean {
  if (!isDict(data)) return false;
  const detail = data.detail;
  return isDict(detail) && typeof detail.code === "string" && detail.code.length > 0;
}

/**
 * The wait before sending a refused request again, in milliseconds, or
 * null when it should not be sent again.
 *
 * @param status       the response's HTTP status
 * @param data         the response body, as axios parsed it
 * @param retryAfter   the Retry-After header, if any
 * @param attemptsSoFar how many times this request has already been re-sent
 */
export function edgeRetryDelayMs(
  status: number | null | undefined,
  data: unknown,
  retryAfter: string | number | null | undefined,
  attemptsSoFar: number,
): number | null {
  if (status !== 429) return null;
  if (isKramaEnvelope(data)) return null;
  if (attemptsSoFar >= EDGE_RETRY_LIMIT) return null;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) {
    if (seconds * 1000 > LONGEST_WAIT_MS) return null;
    return Math.max(1000, Math.ceil(seconds * 1000));
  }
  return DEFAULT_WAITS_MS[Math.min(attemptsSoFar, DEFAULT_WAITS_MS.length - 1)];
}
