/**
 * lib/assessment.ts -- the Assessment Scheme screens' words and sums (#165).
 * What matters: the weight total never drifts (12.5 + 87.5 is exactly 100),
 * the preview rounds half up and grades on the figure shown as the server
 * does, a marks box reads AB / EX / numbers the way the server will take
 * them, and the spreadsheet is safe to open in Excel.
 *
 * Run with `npm test` (scripts/run-unit-tests.mjs).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  cellChanged,
  formatResult,
  cellFrom,
  gradeFor,
  previewResult,
  readCell,
  resultsCsv,
  roundHalfUp,
  schemeRequest,
  weightTotal,
} from "../../.test-build/lib/assessment.mjs";

const BANDS = [
  { label: "A1", minPercent: "91" },
  { label: "A2", minPercent: "81" },
  { label: "E", minPercent: "0" },
];

function form(components, extra = {}) {
  return {
    name: "Maths",
    description: "",
    attemptRule: "BEST",
    passPercent: "33",
    passLabel: "Pass",
    failLabel: "Needs Improvement",
    decimalPlaces: 0,
    gradeBands: BANDS,
    components: components.map(([weight, minimum = ""]) => ({
      componentKey: null,
      name: "C",
      kind: "OTHER",
      term: "WHOLE_YEAR",
      source: "ENTERED",
      maxMarks: "100",
      weightPercent: weight,
      minPassPercent: minimum,
      activityIds: [],
    })),
    ...extra,
  };
}

describe("weightTotal", () => {
  test("adds exactly and says when it is 100", () => {
    assert.deepEqual(weightTotal(["5", "2.5", "2.5", "40", "5", "2.5", "2.5", "40"]), { total: "100", complete: true, unreadable: false });
    assert.deepEqual(weightTotal(["0.1", "0.2"]), { total: "0.3", complete: false, unreadable: false });
    assert.deepEqual(weightTotal(["60", "ten"]), { total: "60", complete: false, unreadable: true });
    assert.equal(weightTotal([]).complete, false);
    // What the server refuses as a weight never makes a green 100.
    assert.equal(weightTotal(["0", "100"]).complete, false);
    assert.equal(weightTotal(["-10", "110"]).complete, false);
    assert.equal(weightTotal(["33.333", "33.333", "33.334"]).unreadable, true);
  });
});

describe("the preview", () => {
  test("rounds half up and grades on the figure shown", () => {
    assert.equal(roundHalfUp(90.5, 0), 91);
    assert.equal(roundHalfUp(90.49, 0), 90);
    assert.equal(roundHalfUp(32.75, 1), 32.8);
    assert.equal(gradeFor(BANDS, 91), "A1");
    assert.equal(gradeFor(BANDS, 90), "A2");
    // 0.2*90 + 0.3*90 + 0.5*91.25 = 90.625 -> 91 -> A1, as the server's test.
    assert.deepEqual(previewResult(form([["20"], ["30"], ["50"]]), [90, 90, 91.25]), { shown: "91", grade: "A1", passed: true });
  });

  test("a component's own minimum, and a form that can't be read yet", () => {
    // At 1 place, 32.5% is under the component's own 33% (at 0 places it
    // would round up to 33 and pass, as on the server).
    assert.deepEqual(previewResult(form([["20"], ["80", "33"]], { decimalPlaces: 1 }), [100, 32.5]), { shown: "46.0", grade: "E", passed: false });
    assert.equal(previewResult(form([["20"], ["80", "33"]]), [100, 32.5]).passed, true);
    assert.equal(previewResult(form([["x"]]), [50]), null);
    assert.equal(previewResult(form([["100"]], { passPercent: "" }), [50]), null);
  });
});

describe("schemeRequest", () => {
  test("keeps the description, an empty one as null", () => {
    assert.equal(schemeRequest({ ...form([["100"]]), description: " Check with Ashalatha " }).description, "Check with Ashalatha");
    assert.equal(schemeRequest({ ...form([["100"]]), description: "  " }).description, null);
  });

  test("trims, sends an empty own pass mark as null, and drops sets from entered components", () => {
    const body = schemeRequest({
      ...form([[" 100 ", " "]]),
      name: "  Maths  ",
      components: [
        { ...form([["100"]]).components[0], name: " Annual ", minPassPercent: " ", activityIds: ["a1"] },
      ],
    });
    assert.equal(body.name, "Maths");
    assert.equal(body.components[0].name, "Annual");
    assert.equal(body.components[0].minPassPercent, null);
    assert.deepEqual(body.components[0].activityIds, []);
  });
});

describe("a marks box", () => {
  test("reads numbers, AB and EX as the server takes them", () => {
    assert.deepEqual(readCell("17.50", "20", "ENTERED"), { status: "ENTERED", marks: "17.5" });
    assert.deepEqual(readCell(" ab ", "20", "ENTERED"), { status: "ABSENT", marks: null });
    assert.deepEqual(readCell("Exempt", "20", "ENTERED"), { status: "EXEMPT", marks: null });
    assert.deepEqual(readCell("", "20", "ENTERED"), { status: null, marks: null });
    assert.deepEqual(readCell("21", "20", "ENTERED"), { error: "A number from 0 to 20, or AB or EX." });
    assert.deepEqual(readCell("-1", "20", "ENTERED"), { error: "A number from 0 to 20, or AB or EX." });
    assert.deepEqual(readCell("-0", "20", "ENTERED"), { error: "A number from 0 to 20, or AB or EX." });
    assert.deepEqual(readCell("10.125", "20", "ENTERED"), { error: "At most 2 decimal places." });
    assert.deepEqual(readCell("12", "20", "PLATFORM"), { error: "Only AB or EX: these marks come from the platform." });
  });

  test("knows when it differs from what is saved", () => {
    assert.equal(cellFrom("ABSENT", null), "AB");
    assert.equal(cellFrom("ENTERED", "17.5"), "17.5");
    assert.equal(cellChanged("17.50", { status: "ENTERED", marks: "17.5" }, "20", "ENTERED"), false);
    assert.equal(cellChanged("18", { status: "ENTERED", marks: "17.5" }, "20", "ENTERED"), true);
    assert.equal(cellChanged("", { status: null, marks: null }, "20", "ENTERED"), false);
  });
});

describe("formatResult", () => {
  test("shows the scheme's decimal places", () => {
    assert.equal(formatResult("91", 1), "91.0");
    assert.equal(formatResult("90.5", 1), "90.5");
    assert.equal(formatResult("76", 0), "76");
    assert.equal(formatResult(null, 1), null);
  });
});

describe("resultsCsv", () => {
  test("one row per student, words for Absent and Not Yet, formulas made safe", () => {
    const csv = resultsCsv(
      [{ id: "c1", name: "Annual", maxMarks: "80" }, { id: "c2", name: "Practice", maxMarks: "20" }],
      [
        {
          studentCode: "STU-1",
          studentName: "=HYPERLINK(\"x\")",
          components: [
            { componentId: "c1", status: "MARKS", marks: "60.5" },
            { componentId: "c2", status: "MISSING", marks: null },
          ],
          result: "76",
          grade: "B1",
          outcomeLabel: "Pass",
          provisional: true,
        },
        {
          studentCode: "STU-2",
          studentName: "Asha, R.",
          components: [{ componentId: "c1", status: "ABSENT", marks: "0" }],
          result: "0",
          grade: "E",
          outcomeLabel: "Needs Improvement",
          provisional: false,
        },
      ],
    );
    const lines = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
    assert.equal(lines[0], "Student Code,Student Name,Annual (out of 80),Practice (out of 20),Result (%),Grade,Outcome,Provisional");
    assert.equal(lines[1], `STU-1,"'=HYPERLINK(""x"")",60.5,Not Yet,76,B1,Pass,Yes`);
    assert.equal(lines[2], `STU-2,"Asha, R.",Absent,,0,E,Needs Improvement,No`);
    assert.ok(csv.startsWith("﻿"));
    const one = resultsCsv([{ id: "c1", name: "A", maxMarks: "10" }], [{ studentCode: "\tX", studentName: "B", components: [], result: "91", grade: "A1", outcomeLabel: "Pass", provisional: false }], 1);
    assert.equal(one.replace(/^﻿/, "").split("\r\n")[1], "'\tX,B,,91.0,A1,Pass,No");
  });
});
