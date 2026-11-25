// A-010 and A-040: one rounding rule for every percentage a person reads.
// A percentage rounds down, so 17 of 21 is 80% and not the 81% My Progress
// used to show beside the parent report's 80%, and 99.6% approved reads 99%
// while questions are still unapproved.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { floorPercent, percentLabel, wholePercent } from "../../.test-build/lib/percentages.mjs";

describe("wholePercent", () => {
  test("rounds down, so a figure never reads as the next whole percent", () => {
    assert.equal(wholePercent(17, 21), 80); // 80.95%, the audit's own example
    assert.equal(wholePercent(6, 9), 66); // 66.66%
    assert.equal(wholePercent(996, 1000), 99); // A-040: not 100% while 4 are unapproved
  });

  test("multiplies before dividing, so the float trap cannot floor the wrong way", () => {
    // Math.floor((57 / 100) * 100) is 56: the division lands a hair below.
    assert.equal(Math.floor((57 / 100) * 100), 56);
    assert.equal(wholePercent(57, 100), 57);
    assert.equal(wholePercent(29, 50), 58);
  });

  test("exact values stay exact", () => {
    assert.equal(wholePercent(0, 20), 0);
    assert.equal(wholePercent(20, 20), 100);
  });

  test("no whole to divide by is null, which every screen shows as a dash", () => {
    assert.equal(wholePercent(5, 0), null);
    assert.equal(wholePercent(5, null), null);
    assert.equal(wholePercent(null, 10), null);
    assert.equal(wholePercent(undefined, 10), null);
    assert.equal(wholePercent(Number.NaN, 10), null);
  });
});

describe("floorPercent and percentLabel", () => {
  test("a number that arrives with a fraction is floored", () => {
    assert.equal(floorPercent(80.95), 80);
    assert.equal(floorPercent(79.6), 79);
    assert.equal(floorPercent(100), 100);
  });

  test("float dust within the epsilon is absorbed, and no more than that", () => {
    // The epsilon is 1e-9, carried over unchanged from the helper this
    // replaced. It absorbs the dust a float division leaves on a value that
    // is really a whole number, so 80 does not read 79.
    assert.equal(floorPercent(80 - 1e-10), 80);
    // It is deliberately not wider than that: a value a hundredth below 80
    // is a real 79-point-something and floors to 79, which is the rule.
    assert.equal(floorPercent(79.99), 79);
  });

  test("the words, with a dash when there is no number", () => {
    assert.equal(percentLabel(80.95), "80%");
    assert.equal(percentLabel(0), "0%");
    assert.equal(percentLabel(null), "—");
    assert.equal(percentLabel(undefined), "—");
    assert.equal(percentLabel(Number.NaN), "—");
  });
});
