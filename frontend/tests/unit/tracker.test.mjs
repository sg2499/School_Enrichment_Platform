/**
 * lib/tracker.ts -- how the Practice Tracker names an assignment's scope,
 * and which assignments it marks as Foundation Repair (13 Oct 2026: those
 * now record the student's section, so the reason is what tells them apart).
 *
 * Run with `npm test` (scripts/run-unit-tests.mjs).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { FOUNDATION_REPAIR_LABEL, isFoundationRepair, scopeLabel, scopeShort } from "../../.test-build/lib/tracker.mjs";

describe("isFoundationRepair", () => {
  test("the two reasons Foundation Repair sets", () => {
    assert.equal(isFoundationRepair("PREREQUISITE_GAP"), true);
    assert.equal(isFoundationRepair("LOW_ACCURACY"), true);
  });

  test("every other reason, and none at all", () => {
    for (const reason of ["SCHEDULED", "LOW_FLUENCY", "MISSED_PRACTICE", "TEACHER_SELECTED", "RE_ATTEMPT", "ADMIN_APPROVED", null, undefined]) {
      assert.equal(isFoundationRepair(reason), false, String(reason));
    }
  });

  test("the label is in Title Case", () => {
    assert.equal(FOUNDATION_REPAIR_LABEL, "Foundation Repair");
  });
});

describe("scopeLabel and scopeShort", () => {
  const section = { classLevelCode: "5", section: "A", boardCourseName: "Mathematics", className: null };

  test("a section-scoped assignment, Foundation Repair included", () => {
    assert.equal(scopeLabel(section), "Class 5 · Section A · Mathematics");
    assert.equal(scopeShort(section), "5A · Mathematics");
  });

  test("a whole-class assignment", () => {
    assert.equal(scopeLabel({ ...section, section: null }), "Class 5 · All Sections · Mathematics");
  });

  test("one made before sections were recorded", () => {
    const none = { classLevelCode: null, section: null, boardCourseName: "Mathematics", className: null };
    assert.equal(scopeLabel(none), "Individual Students · Mathematics");
    assert.equal(scopeShort(none), "Individual · Mathematics");
  });
});
