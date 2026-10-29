// Curriculum Studio (#212): counts, planned dates, and where a calendar entry stands today.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { countOf, formatPlannedDay, mapTiming } from "../../.test-build/lib/curriculumStudio.mjs";

describe("curriculum studio helpers", () => {
  test("counts read as words", () => {
    assert.equal(countOf(1, "lesson"), "1 lesson");
    assert.equal(countOf(15, "lesson"), "15 lessons");
    assert.equal(countOf(7500, "question"), "7,500 questions");
    assert.equal(countOf(2, "entry", "entries"), "2 entries");
  });

  test("planned days, as the local calendar day", () => {
    assert.equal(formatPlannedDay(null), null);
    assert.match(formatPlannedDay("2026-09-14"), /^14 Sept? 2026$/);
    assert.equal(formatPlannedDay("soon"), "soon");
  });

  test("where an entry stands", () => {
    const today = "2026-10-29";
    assert.equal(mapTiming({ plannedStartDate: null, plannedEndDate: null }, today), "undated");
    assert.equal(mapTiming({ plannedStartDate: null, plannedEndDate: "2026-11-30" }, today), "undated");
    assert.equal(mapTiming({ plannedStartDate: "2026-11-02", plannedEndDate: null }, today), "upcoming");
    assert.equal(mapTiming({ plannedStartDate: "2026-10-01", plannedEndDate: "2026-10-28" }, today), "finished");
    assert.equal(mapTiming({ plannedStartDate: "2026-10-01", plannedEndDate: "2026-10-29" }, today), "running");
    assert.equal(mapTiming({ plannedStartDate: "2026-10-29", plannedEndDate: null }, today), "running");
  });
});
