// A-013, 24 Nov 2026: the progress strip at the top of a practice set counts
// an attached PDF as an answer where a teacher marks the question, the same
// rule the Submit confirmation uses. Found live on production: a child with a
// PDF on question 2 saw the strip say "1 of 20 answered" while the
// confirmation said "2 of 20".
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { practiceStripAnswered } from "../../.test-build/lib/studentPractice.mjs";

const pdf = { id: "a1", name: "working.pdf" };

describe("practiceStripAnswered", () => {
  test("a PDF with nothing typed counts, on a question a teacher marks", () => {
    const questions = [{ id: "q1", teacherMarked: true }];
    assert.equal(practiceStripAnswered(questions, {}, { q1: pdf }), 1);
    // The live case: one typed, one PDF-only. The strip used to say 1.
    const two = [{ id: "q1", teacherMarked: true }, { id: "q2", teacherMarked: true }];
    assert.equal(practiceStripAnswered(two, { q1: "498 m" }, { q2: pdf }), 2);
  });

  test("a PDF does not count where the platform marks the answer itself", () => {
    // A reviewer may put an upload box on an auto-marked question, and there a
    // PDF with nothing typed still scores 0 -- so the strip must not promise
    // the child it was answered.
    const questions = [{ id: "q1", teacherMarked: false }];
    assert.equal(practiceStripAnswered(questions, {}, { q1: pdf }), 0);
  });

  test("nothing typed and nothing attached is not answered", () => {
    const questions = [{ id: "q1", teacherMarked: true }, { id: "q2", teacherMarked: true }];
    assert.equal(practiceStripAnswered(questions, { q1: "   " }, {}), 0);
  });

  test("an answer in parts still counts only once every box is filled", () => {
    const questions = [{ id: "q1", questionType: "Numeric Entry", answerBlanks: 2 }];
    assert.equal(practiceStripAnswered(questions, { q1: "3;" }, {}), 0);
    assert.equal(practiceStripAnswered(questions, { q1: "3;4" }, {}), 1);
  });

  test("a part-filled answer with a PDF beside it still counts", () => {
    // ";" is not blank to trim(), but it is blank to the child. The strip
    // must still see the PDF, or it and the confirmation disagree again.
    const questions = [{ id: "q1", questionType: "Numeric Entry", answerBlanks: 2, teacherMarked: true }];
    assert.equal(practiceStripAnswered(questions, { q1: ";" }, {}), 0);
    assert.equal(practiceStripAnswered(questions, { q1: ";" }, { q1: pdf }), 1);
  });

  test("a written answer keeps its semicolons and is not read as parts", () => {
    const questions = [{ id: "q1", questionType: "Constructed Response", answerBlanks: 2 }];
    assert.equal(practiceStripAnswered(questions, { q1: "first; then second" }, {}), 1);
  });
});
