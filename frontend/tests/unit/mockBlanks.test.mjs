// 25 Nov 2026: the Hand In warning on a mock paper used to list every
// unfinished place as "not answered" and say "Questions left blank get no
// marks" -- including a two-part question with one box filled, which is
// neither blank nor worth no marks. The progress count still means finished;
// the warning now means empty.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { answeredCount, blankCount, placeAnswered, placeBlank } from "../../.test-build/lib/mockPapers.mjs";

const place = (number, parts) => ({
  number,
  choiceGroup: null,
  chosenSlotId: null,
  halves: [{ slotId: `s${number}`, parts }],
});
const part = (id, teacherMarked = false) => ({ id, teacherMarked, attachment: null });

describe("a part-filled place", () => {
  const two = place(1, [part("a"), part("b")]);
  const sections = [{ places: [two] }];

  test("is not finished, so the progress count does not include it", () => {
    assert.equal(placeAnswered(two, { a: "7" }, {}), false);
    assert.equal(answeredCount(sections, { a: "7" }, {}).answered, 0);
  });

  test("is NOT blank, so the warning does not name it", () => {
    assert.equal(placeBlank(two, { a: "7" }, {}), false);
    assert.equal(blankCount(sections, { a: "7" }, {}), 0);
  });

  test("with nothing in either box it is blank and is named", () => {
    assert.equal(placeBlank(two, {}, {}), true);
    assert.equal(blankCount(sections, { a: "   " }, {}), 1);
  });

  test("fully filled is both finished and not blank", () => {
    assert.equal(placeAnswered(two, { a: "7", b: "8" }, {}), true);
    assert.equal(placeBlank(two, { a: "7", b: "8" }, {}), false);
  });
});

describe("a PDF is an answer on a teacher-marked part", () => {
  const written = place(2, [part("w", true)]);
  const sections = [{ places: [written] }];
  const pdf = { id: "att1" };

  test("counts as answered and not blank", () => {
    assert.equal(placeBlank(written, {}, { w: pdf }), false);
    assert.equal(blankCount(sections, {}, { w: pdf }), 0);
    assert.equal(placeAnswered(written, {}, { w: pdf }), true);
  });

  test("a removed file falls back to blank, not to the file the paper loaded with", () => {
    assert.equal(placeBlank(written, {}, { w: null }), true);
  });
});
