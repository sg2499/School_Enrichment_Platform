/**
 * lib/marking.ts -- a measured answer's marking settings in words, and the
 * Curriculum Studio form's request (Phase 4, #164). What matters: the card
 * says nothing for a plain number, says where a default came from, and an
 * emptied field is sent as a clear, never as an empty string.
 *
 * Run with `npm test` (scripts/run-unit-tests.mjs).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  UNIT_RULE_LABEL,
  hasMarkingSettings,
  markingFormFrom,
  markingRequest,
  markingSummary,
  unitGroups,
} from "../../.test-build/lib/marking.mjs";

const plain = {
  answerUnitLabel: null,
  effectiveUnitRule: "NONE",
  unitRule: null,
  allowUnitConversion: false,
  numericTolerance: null,
  decimalPlaces: null,
  unitMark: null,
  marks: 1,
};

describe("markingSummary", () => {
  test("a plain number says nothing", () => {
    assert.deepEqual(markingSummary(plain), []);
    assert.deepEqual(markingSummary({ marks: 1 }), []); // an older server
  });

  test("a unit stated by default says where the rule came from, and that the unit is missing", () => {
    assert.deepEqual(markingSummary({ ...plain, effectiveUnitRule: "STATED" }), [
      "Unit: not recorded, stated in the question (from the Response Format)",
    ]);
  });

  test("a unit read from the question says so; a recorded one does not", () => {
    assert.deepEqual(
      markingSummary({ ...plain, effectiveUnitRule: "STATED", effectiveAnswerUnitLabel: "centimetres", answerUnitSource: "QUESTION" }),
      ["Unit: centimetres (read from the question), stated in the question (from the Response Format)"],
    );
    assert.deepEqual(
      markingSummary({ ...plain, effectiveUnitRule: "STATED", unitRule: "STATED", answerUnitLabel: "grams", effectiveAnswerUnitLabel: "grams", answerUnitSource: "RECORDED" }),
      ["Unit: grams, stated in the question"],
    );
  });

  test("a required unit on a longer question names the unit mark", () => {
    const lines = markingSummary({
      ...plain,
      effectiveUnitRule: "REQUIRED",
      unitRule: "REQUIRED",
      answerUnitLabel: "grams",
      allowUnitConversion: true,
      unitMark: 2,
      marks: 3,
    });
    assert.deepEqual(lines, ["Unit: grams, must be written", "Another unit of the same kind is accepted", "A missing unit costs 2 marks"]);
    assert.deepEqual(
      markingSummary({ ...plain, effectiveUnitRule: "REQUIRED", unitRule: "REQUIRED", answerUnitLabel: "cm", marks: 1 }),
      ["Unit: cm, must be written"],
    );
  });

  test("tolerance and rounding", () => {
    assert.deepEqual(markingSummary({ ...plain, numericTolerance: "0.5", decimalPlaces: 1 }), [
      "Allowed difference: 0.5",
      "Rounded to 1 decimal place first",
    ]);
    assert.deepEqual(markingSummary({ ...plain, numericTolerance: "0", decimalPlaces: 0 }), ["Rounded to a whole number first"]);
    assert.deepEqual(markingSummary({ ...plain, decimalPlaces: 2 }), ["Rounded to 2 decimal places first"]);
  });
});

describe("the form", () => {
  test("round trip, with empty fields sent as null", () => {
    const form = markingFormFrom({ answerUnit: "g", unitRule: null, allowUnitConversion: true, numericTolerance: null, decimalPlaces: 0, unitMark: null });
    assert.deepEqual(form, { answerUnit: "g", unitRule: "", allowUnitConversion: true, numericTolerance: "", decimalPlaces: "0", unitMark: "" });
    assert.deepEqual(markingRequest({ ...form, numericTolerance: " 0.5 " }), {
      answerUnit: "g",
      unitRule: null,
      allowUnitConversion: true,
      numericTolerance: "0.5",
      decimalPlaces: "0",
      unitMark: null,
    });
  });

  test("only Numeric Entry has the settings", () => {
    assert.equal(hasMarkingSettings({ questionType: "Numeric Entry" }), true);
    assert.equal(hasMarkingSettings({ questionType: "Text Entry" }), false);
  });

  test("labels are Title Case, short words lowercase", () => {
    assert.deepEqual(Object.values(UNIT_RULE_LABEL), ["No Unit", "Stated in the Question", "Must Be Written"]);
  });
});

describe("unitGroups", () => {
  test("grouped by kind in a fixed order, unknown kinds last", () => {
    const groups = unitGroups([
      { code: "g", kind: "mass", label: "grams", singular: "gram" },
      { code: "cm", kind: "length", label: "centimetres", singular: "centimetre" },
      { code: "x", kind: "other", label: "xs", singular: "x" },
      { code: "kg", kind: "mass", label: "kilograms", singular: "kilogram" },
    ]);
    assert.deepEqual(groups.map((group) => group.label), ["Length", "Weight", "other"]);
    assert.deepEqual(groups[1].units.map((unit) => unit.code), ["g", "kg"]);
  });
});
