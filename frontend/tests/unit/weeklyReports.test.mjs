// The weekly parent report (#187): the words on the section screen, the
// notes as saved, and the download names.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  changedNotes,
  cleanNote,
  noteProblem,
  numbersText,
  pdfName,
  scoreText,
  sectionKey,
  shortDay,
  STATUS_TONE,
  totalsText,
} from "../../.test-build/lib/weeklyReports.mjs";

describe("words", () => {
  test("a week's totals", () => {
    assert.equal(totalsText({ given: 0, done: 0, onTime: 0, late: 0, notDone: 0, open: 0 }), "No practice set");
    assert.equal(totalsText({ given: 1, done: 1, onTime: 1, late: 0, notDone: 0, open: 0 }), "1 of 1 set done");
    assert.equal(
      totalsText({ given: 4, done: 2, onTime: 1, late: 1, notDone: 1, open: 1 }),
      "2 of 4 sets done · 1 late · 1 not done · 1 still open",
    );
  });

  test("a week's answers", () => {
    assert.equal(numbersText({ answered: 0, marked: 0, percent: null, ownPractice: 0 }), "Nothing handed in");
    assert.equal(numbersText({ answered: 1, marked: 1, percent: 100, ownPractice: 0 }), "1 answer · 100% of marks");
    assert.equal(numbersText({ answered: 18, marked: 17, percent: 82, ownPractice: 2 }), "18 answers · 82% of marks · 2 sets of their own");
  });

  test("every status has a tone", () => {
    for (const s of ["DONE_ON_TIME", "DONE_LATE", "DONE", "NOT_DONE", "IN_PROGRESS", "NOT_STARTED"]) assert.ok(STATUS_TONE[s]);
    assert.equal(STATUS_TONE.NOT_DONE, "danger");
  });

  test("days, scores and file names", () => {
    assert.equal(shortDay("2026-10-21"), "21 Oct");
    assert.equal(shortDay(null), "—");
    assert.equal(shortDay("junk"), "—");
    assert.equal(scoreText(8, 9), "8 / 9");
    assert.equal(scoreText(7, 9, true), "7 / 9 (marks to come)");
    assert.equal(scoreText(null, null), "—");
    assert.equal(scoreText(null, null, true), "Marks to come");
    assert.equal(pdfName("Class 5 · Section A", "Weekly-Reports", "2026-10-19"), "Class-5-Section-A-Weekly-Reports-2026-10-19.pdf");
    assert.equal(sectionKey({ classLevelId: "c5", section: "A" }), "c5|A");
  });
});

describe("notes", () => {
  test("spaces are tidied and the limit is 300", () => {
    assert.equal(cleanNote("  Test on \n Friday. "), "Test on Friday.");
    assert.equal(noteProblem("x".repeat(300)), null);
    assert.equal(noteProblem("x".repeat(301)), "At most 300 characters.");
    assert.equal(noteProblem(`${"x".repeat(299)}    `), null);
  });

  test("only changed notes are sent, an emptied one as null", () => {
    const saved = { a: "Well done.", b: null, c: "Keep going." };
    assert.deepEqual(changedNotes({ a: " Well done. ", b: "", c: "" }, saved), [{ studentId: "c", note: null }]);
    assert.deepEqual(changedNotes({ b: "New" }, saved), [{ studentId: "b", note: "New" }]);
  });
});
