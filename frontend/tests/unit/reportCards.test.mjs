/**
 * lib/reportCards.ts -- the report card screens' checks (#188). What
 * matters: a days box reads the way the server will take it, a teacher sees
 * "more than the working days" where they typed it, an unchanged row is not
 * sent again, and only the school's own areas are sent.
 *
 * Run with `npm test` (scripts/run-unit-tests.mjs).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  fillWorkingDays,
  markText,
  pdfName,
  percentText,
  readDays,
  recordChanged,
  recordEntry,
  recordFormFrom,
  rowProblems,
} from "../../.test-build/lib/reportCards.mjs";

const ROW = {
  studentId: "s1",
  studentCode: "STU-1",
  studentName: "Asha",
  workingDays: 100,
  daysPresent: 96,
  grades: { Art: "A" },
  remark: "Works steadily.",
  updatedAt: null,
};

describe("a days box", () => {
  test("reads whole numbers, empty as not recorded", () => {
    assert.deepEqual(readDays(" 96 "), { value: 96 });
    assert.deepEqual(readDays(""), { value: null });
    assert.deepEqual(readDays("9.5"), { error: "A whole number from 0 to 366." });
    assert.deepEqual(readDays("400"), { error: "A whole number from 0 to 366." });
    assert.deepEqual(readDays("-1"), { error: "A whole number from 0 to 366." });
  });

  test("present can't be more than working", () => {
    const form = { ...recordFormFrom(ROW), daysPresent: "101" };
    assert.deepEqual(rowProblems(form), { daysPresent: "More than the working days." });
    assert.deepEqual(rowProblems({ ...form, remark: "x".repeat(301) }).remark, "At most 300 characters.");
    assert.deepEqual(rowProblems(recordFormFrom(ROW)), {});
  });
});

describe("a row", () => {
  test("is sent with the school's areas only, and blanks as null", () => {
    const form = { ...recordFormFrom(ROW), grades: { Art: "B", Gone: "A", Sports: " " }, remark: "  " };
    assert.deepEqual(recordEntry("s1", form, ["Art", "Sports"]), {
      studentId: "s1",
      workingDays: 100,
      daysPresent: 96,
      grades: { Art: "B" },
      remark: null,
    });
  });

  test("knows when it differs from what is saved", () => {
    assert.equal(recordChanged(ROW, recordFormFrom(ROW), ["Art"]), false);
    assert.equal(recordChanged(ROW, { ...recordFormFrom(ROW), workingDays: " 100 " }, ["Art"]), false);
    assert.equal(recordChanged(ROW, { ...recordFormFrom(ROW), remark: "Better." }, ["Art"]), true);
  });

  test("a grade from an earlier scale is dropped, not hidden", () => {
    const stale = { ...ROW, grades: { Art: "D" } };
    assert.deepEqual(recordFormFrom(stale, ["A", "B", "C"]).grades, {});
    assert.equal(recordChanged(stale, recordFormFrom(stale, ["A", "B", "C"]), ["Art"], ["A", "B", "C"]), false);
    assert.deepEqual(fillWorkingDays({ a: { ...recordFormFrom(ROW), workingDays: "" } }, "abc").a.workingDays, "");
  });

  test("Fill Working Days leaves rows that have days", () => {
    const filled = fillWorkingDays(
      { a: recordFormFrom(ROW), b: { ...recordFormFrom(ROW), workingDays: "" } },
      " 110 ",
    );
    assert.equal(filled.a.workingDays, "100");
    assert.equal(filled.b.workingDays, "110");
  });
});

describe("words", () => {
  test("marks, percentages and file names", () => {
    assert.equal(markText("ABSENT", null), "AB");
    assert.equal(markText("EXEMPT", null), "EX");
    assert.equal(markText("MARKS", "17.5"), "17.5");
    assert.equal(percentText("91.0"), "91.0%");
    assert.equal(percentText(null), "—");
    assert.equal(pdfName("Class 5", "A", "Term 1 Card"), "Class-5-A-Term-1-Card.pdf");
  });
});
