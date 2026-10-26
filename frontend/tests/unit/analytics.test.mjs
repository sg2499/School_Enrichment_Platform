// Class Analytics (#186): cell words and symbols, question tones, and the
// Assign Practice address that carries a misconception's students.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  assignHref,
  CELL_LABEL,
  CELL_SYMBOL,
  cellText,
  flaggedText,
  percentCorrectText,
  questionTone,
  readAssignPrefill,
  sectionName,
} from "../../.test-build/lib/analytics.mjs";

describe("cells", () => {
  test("every state has words and a symbol, so colour never carries it alone", () => {
    for (const state of ["CORRECT", "PARTIAL", "WRONG", "BLANK", "PENDING"]) {
      assert.ok(CELL_LABEL[state] && CELL_SYMBOL[state]);
    }
    assert.equal(cellText(null, 3), "Question 3: not answered");
    assert.equal(cellText({ state: "PARTIAL", score: 1, max: 2 }, 2), "Question 2: Part marks (1 of 2)");
    assert.equal(cellText({ state: "PENDING", score: null, max: 2 }, 1), "Question 1: Waiting for marks");
  });

  test("question share right", () => {
    assert.equal(percentCorrectText(null), "—");
    assert.equal(percentCorrectText(49.99), "49%");
    assert.deepEqual([questionTone(null), questionTone(40), questionTone(50), questionTone(80)], ["none", "low", "mid", "high"]);
  });

  test("words", () => {
    assert.equal(flaggedText(14, 32), "14 of 32 students");
    assert.equal(flaggedText(1, 1), "1 of 1 student");
    assert.equal(sectionName({ classLevelCode: "5", section: "A", boardCourseName: "CBSE Class 5 Mathematics" }), "Class 5 · Section A · CBSE Class 5 Mathematics");
  });
});

describe("Assign Practice, filled in", () => {
  const section = { classLevelCode: "5", section: "A", boardCourseId: "course-1" };
  test("the address round-trips", () => {
    const href = assignHref({ chapterId: "ch-1", learningActivityId: "act-1", section, studentIds: ["s1", "s2", "s1"] });
    assert.ok(href.startsWith("/teacher/assign?"));
    const prefill = readAssignPrefill(href.slice(href.indexOf("?")));
    assert.deepEqual(prefill, { chapterId: "ch-1", activityId: "act-1", classLevel: "5", section: "A", courseId: "course-1", studentIds: ["s1", "s2"] });
  });

  test("anything missing, or not from Class Analytics, fills nothing", () => {
    assert.equal(readAssignPrefill("?chapter=ch-1"), null);
    assert.equal(readAssignPrefill("?from=analytics&chapter=c&activity=a&classLevel=5&section=A&course=x&students="), null);
    assert.equal(readAssignPrefill(""), null);
  });
});
