// #213: a request turned away before it reached Krama is sent again by itself;
// Krama's own refusals are not.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { EDGE_RETRY_LIMIT, edgeRetryDelayMs, isKramaEnvelope } from "../../.test-build/lib/edgeRetry.mjs";

const OURS = { detail: { code: "RATE_LIMITED", message: "Too many attempts in a short time.", details: {} } };

describe("edge retry", () => {
  test("Render's plain-text refusal is retried, twice, then left alone", () => {
    assert.equal(edgeRetryDelayMs(429, "Too Many Requests", undefined, 0), 1500);
    assert.equal(edgeRetryDelayMs(429, "Too Many Requests", undefined, 1), 4000);
    assert.equal(edgeRetryDelayMs(429, "Too Many Requests", undefined, EDGE_RETRY_LIMIT), null);
  });

  test("an HTML or empty refusal from something in front of Krama is retried", () => {
    assert.equal(edgeRetryDelayMs(429, "<html><body>429</body></html>", undefined, 0), 1500);
    assert.equal(edgeRetryDelayMs(429, "", undefined, 0), 1500);
    assert.equal(edgeRetryDelayMs(429, undefined, undefined, 0), 1500);
    assert.equal(edgeRetryDelayMs(429, { error: "slow down" }, undefined, 0), 1500);
  });

  test("Krama's own refusal is never retried: it means what it says", () => {
    assert.equal(isKramaEnvelope(OURS), true);
    assert.equal(edgeRetryDelayMs(429, OURS, "30", 0), null);
  });

  test("a short Retry-After is honoured, a long one is not waited out", () => {
    assert.equal(edgeRetryDelayMs(429, "Too Many Requests", "2", 0), 2000);
    assert.equal(edgeRetryDelayMs(429, "Too Many Requests", "0.2", 0), 1000);
    assert.equal(edgeRetryDelayMs(429, "Too Many Requests", "60", 0), null);
    assert.equal(edgeRetryDelayMs(429, "Too Many Requests", "soon", 0), 1500);
  });

  test("nothing else is retried here", () => {
    for (const status of [200, 400, 401, 403, 404, 409, 422, 500, 502, 503, 504, null, undefined]) {
      assert.equal(edgeRetryDelayMs(status, "Too Many Requests", undefined, 0), null, String(status));
    }
  });
});
