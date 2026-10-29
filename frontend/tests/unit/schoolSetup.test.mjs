// School setup and sign-in slips (#210): slip wording, the sign-in file,
// pages of eight, and the check summary.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { checkSummary, slipDetail, slipPages, slipsCsv, slipWayIn } from "../../.test-build/lib/schoolSetup.mjs";
import { csvCell } from "../../.test-build/lib/csv.mjs";

const student = {
  role: "STUDENT",
  fullName: "Aarav Sharma",
  code: "STU-TEST-0001",
  initialPassword: "=abcDEF23456",
  className: "5",
  section: "A",
  rollNumber: "3",
  teaches: [],
};
const teacher = {
  role: "TEACHER",
  fullName: "Anita Rao",
  code: "TCH-TEST-0001",
  initialPassword: "pqrSTU789xyz",
  className: null,
  section: null,
  rollNumber: null,
  teaches: ["5A Mathematics", "5B Mathematics"],
};

describe("sign-in slips", () => {
  test("say who and where", () => {
    assert.equal(slipDetail(student), "Class 5 · Section A · Roll 3");
    assert.equal(slipDetail({ ...student, rollNumber: null }), "Class 5 · Section A");
    assert.equal(slipDetail(teacher), "Teacher · 5A Mathematics, 5B Mathematics");
    assert.equal(slipWayIn(student), "Student");
    assert.equal(slipWayIn(teacher), "Teacher");
  });
  test("come eight to a page", () => {
    const many = Array.from({ length: 17 }, (_, i) => ({ ...student, code: `STU-${i}` }));
    assert.deepEqual(
      slipPages(many).map((p) => p.length),
      [8, 8, 1],
    );
    assert.deepEqual(slipPages([]), []);
  });
  test("the sign-in file keeps passwords exact and names safe", () => {
    const csv = slipsCsv([teacher, { ...student, fullName: "=HYPERLINK(1)" }]);
    assert.ok(csv.startsWith("﻿Full Name,Role,Class,Section,Roll Number,Code,First Password\r\n"));
    assert.ok(csv.includes("Anita Rao,Teacher,,,,TCH-TEST-0001,pqrSTU789xyz\r\n"));
    assert.ok(csv.includes("'=HYPERLINK(1),Student,5,A,3,STU-TEST-0001,=abcDEF23456\r\n"));
    assert.equal(csvCell('a "b", c'), '"a ""b"", c"');
  });
});

describe("the check summary", () => {
  const base = {
    ok: true,
    problems: [],
    newTeachers: 0,
    teachersAlreadyHere: 0,
    newStudents: 0,
    studentsAlreadyHere: 0,
    newSectionsTaught: 0,
    sections: [],
  };
  test("counts what is new, in words", () => {
    assert.equal(
      checkSummary({ ...base, newTeachers: 2, newStudents: 31, newSectionsTaught: 3 }),
      "Ready to import: 2 new teachers, 31 new students, 3 sections to be taught.",
    );
    assert.equal(checkSummary({ ...base, newStudents: 1 }), "Ready to import: 1 new student.");
  });
  test("says when nothing is new", () => {
    assert.equal(
      checkSummary({ ...base, studentsAlreadyHere: 1 }),
      "Nothing new to import. 1 person is already on Krama and will be left as they are.",
    );
    assert.equal(
      checkSummary({ ...base, teachersAlreadyHere: 2, studentsAlreadyHere: 3, newStudents: 1 }),
      "Ready to import: 1 new student. 5 people are already on Krama and will be left as they are.",
    );
  });
});
