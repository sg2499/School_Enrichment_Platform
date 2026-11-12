// The overview screens (#224): the wording the Question Bank, Reports,
// Settings and My Classes pages use.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { activityTime, dateRange, difficultyLine, plural, sharePercent, shortDate, waitingApproval } from "../../.test-build/lib/overview.mjs";

describe("numbers", () => {
  test("plural", () => {
    assert.equal(plural(1, "skill"), "1 skill");
    assert.equal(plural(0, "skill"), "0 skills");
    assert.equal(plural(2, "class", "classes"), "2 classes");
  });
  test("a share is a whole percent and never divides by nothing", () => {
    assert.equal(sharePercent(1, 2), "50%");
    assert.equal(sharePercent(0, 0), "—");
    assert.equal(sharePercent(2, 3), "66%"); // rounded down, like every other percentage
    assert.equal(sharePercent(6, 9), "66%");
  });
  test("waiting for approval never goes below zero", () => {
    assert.equal(waitingApproval(10, 4), 6);
    assert.equal(waitingApproval(3, 5), 0);
  });
});

describe("dates", () => {
  test("a short date from an ISO date or timestamp", () => {
    assert.equal(shortDate("2026-11-05"), "5 Nov");
    assert.equal(shortDate("2026-01-31T10:00:00Z"), "31 Jan");
    assert.equal(shortDate(null), "");
    assert.equal(shortDate("soon"), "");
  });
  test("a range says what is missing", () => {
    assert.equal(dateRange("2026-10-05", "2026-10-19"), "5 Oct – 19 Oct");
    assert.equal(dateRange("2026-10-05", null), "From 5 Oct");
    assert.equal(dateRange(null, "2026-10-19"), "Until 19 Oct");
    assert.equal(dateRange(null, null), "Not scheduled");
  });
  test("activity time is in IST", () => {
    assert.equal(activityTime("2026-11-12T09:35:00Z"), "12 Nov, 3:05 pm");
    assert.equal(activityTime("2026-11-12T18:30:00"), "13 Nov, 12:00 am");
    assert.equal(activityTime(null), "");
  });
});

describe("difficulty", () => {
  test("in order, with the words a teacher uses", () => {
    assert.equal(difficultyLine({ "2": 10, "1": 4 }), "Easy 4 · Medium 10");
    assert.equal(difficultyLine({}), "No questions yet");
  });
});
