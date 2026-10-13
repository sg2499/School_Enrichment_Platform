/**
 * How a measured answer is marked, as a reviewer reads it (Phase 4, #164;
 * PHASE4_UNITS_DESIGN.md). The rules themselves live on the server
 * (learning_service); this only says them in words and turns the
 * Curriculum Studio form into the request.
 *
 * Type-only imports, so it is unit-tested directly
 * (scripts/run-unit-tests.mjs).
 */
import type { MarkingUnit, QuestionDetail, UnitRule } from "@/types/curriculum";

export const UNIT_RULE_LABEL: Record<UnitRule, string> = {
  NONE: "No Unit",
  STATED: "Stated in the Question",
  REQUIRED: "Must Be Written",
};

/** What each rule means for the child, under the choice in the form. */
export const UNIT_RULE_MEANING: Record<UnitRule, string> = {
  NONE: "The number alone is marked.",
  STATED: "The number alone is enough; a unit, if written, must be the right one.",
  REQUIRED: "The unit must be written. On a 1-mark question a missing unit is wrong; on a longer one it costs the unit mark.",
};

/** The kinds, in the order the unit list shows them. */
export const UNIT_KIND_LABEL: Record<string, string> = {
  length: "Length",
  mass: "Weight",
  capacity: "Capacity",
  time: "Time",
  money: "Money",
  angle: "Angle",
  area: "Area",
  percent: "Percent",
};

/** True for the questions the marking settings apply to. */
export function hasMarkingSettings(question: Pick<QuestionDetail, "questionType">): boolean {
  return question.questionType === "Numeric Entry";
}

type MarkingFields = Pick<
  QuestionDetail,
  "answerUnitLabel" | "effectiveUnitRule" | "unitRule" | "allowUnitConversion" | "numericTolerance" | "decimalPlaces" | "unitMark" | "marks"
>;

/** The settings in a line each, for the card. Empty when nothing about
 *  the question's marking differs from a plain number. */
export function markingSummary(question: MarkingFields): string[] {
  const lines: string[] = [];
  const rule = question.effectiveUnitRule ?? "NONE";
  if (rule !== "NONE") {
    const unit = question.answerUnitLabel ? `Unit: ${question.answerUnitLabel}` : "Unit: not recorded";
    const ruleWords = rule === "STATED" ? "stated in the question" : "must be written";
    const defaulted = question.unitRule ? "" : " (from the Response Format)";
    lines.push(`${unit}, ${ruleWords}${defaulted}`);
    if (question.allowUnitConversion) lines.push("Another unit of the same kind is accepted");
    if (rule === "REQUIRED" && question.marks > 1) {
      const mark = question.unitMark ?? 1;
      lines.push(`A missing unit costs ${mark} mark${mark === 1 ? "" : "s"}`);
    }
  }
  if (question.numericTolerance && Number(question.numericTolerance) > 0) {
    lines.push(`Allowed difference: ${question.numericTolerance}`);
  }
  if (typeof question.decimalPlaces === "number") {
    const places = question.decimalPlaces;
    lines.push(
      places === 0 ? "Rounded to a whole number first" : `Rounded to ${places} decimal place${places === 1 ? "" : "s"} first`,
    );
  }
  return lines;
}

/** The form's own state: every field as text, as the inputs hold it. */
export interface MarkingForm {
  answerUnit: string;
  /** "" means "use the default". */
  unitRule: "" | UnitRule;
  allowUnitConversion: boolean;
  numericTolerance: string;
  decimalPlaces: string;
  unitMark: string;
}

export function markingFormFrom(question: Partial<MarkingFields> & Pick<QuestionDetail, "answerUnit">): MarkingForm {
  return {
    answerUnit: question.answerUnit ?? "",
    unitRule: question.unitRule ?? "",
    allowUnitConversion: Boolean(question.allowUnitConversion),
    numericTolerance: question.numericTolerance ?? "",
    decimalPlaces: typeof question.decimalPlaces === "number" ? String(question.decimalPlaces) : "",
    unitMark: typeof question.unitMark === "number" ? String(question.unitMark) : "",
  };
}

/** The PATCH body: every field, an empty one sent as null so it is cleared.
 *  Numbers are sent as typed; the server checks them and says what is
 *  wrong in words. */
export function markingRequest(form: MarkingForm): Record<string, string | boolean | null> {
  const text = (value: string) => (value.trim() === "" ? null : value.trim());
  return {
    answerUnit: text(form.answerUnit),
    unitRule: form.unitRule === "" ? null : form.unitRule,
    allowUnitConversion: form.allowUnitConversion,
    numericTolerance: text(form.numericTolerance),
    decimalPlaces: text(form.decimalPlaces),
    unitMark: text(form.unitMark),
  };
}

/** The units grouped by kind, in UNIT_KIND_LABEL's order, for the list. */
export function unitGroups(units: readonly MarkingUnit[]): { kind: string; label: string; units: MarkingUnit[] }[] {
  const order = Object.keys(UNIT_KIND_LABEL);
  const kinds = [...new Set(units.map((unit) => unit.kind))].sort(
    (a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)),
  );
  return kinds.map((kind) => ({
    kind,
    label: UNIT_KIND_LABEL[kind] ?? kind,
    units: units.filter((unit) => unit.kind === kind),
  }));
}
