/**
 * The Assessment Scheme's words and sums for the screens (#165, PR 2).
 * Pure: no React, no network, so tests/unit/assessment.test.mjs covers it
 * directly. The server decides every result (assessment_service.py); what
 * is worked out here is only for the editor -- the running weight total,
 * and the example result in its preview -- and is labelled as such.
 */
import type {
  AttemptRule,
  ComponentKind,
  ComponentResultStatus,
  ComponentSource,
  ComponentTerm,
  GradeBand,
  MarkStatus,
  SchemeDetail,
  SchemeStatus,
} from "@/types/assessment";

export const KIND_LABEL: Record<ComponentKind, string> = {
  PERIODIC_TEST: "Periodic Test",
  HALF_YEARLY: "Half-Yearly Examination",
  ANNUAL: "Annual Examination",
  PRACTICAL: "Practical",
  PROJECT: "Project",
  NOTEBOOK: "Notebook",
  SUBJECT_ENRICHMENT: "Subject Enrichment",
  PLATFORM_PRACTICE: "Practice on the Platform",
  OTHER: "Other",
};
export const KINDS = Object.keys(KIND_LABEL) as ComponentKind[];

export const TERM_LABEL: Record<ComponentTerm, string> = {
  TERM_1: "Term 1",
  TERM_2: "Term 2",
  WHOLE_YEAR: "Whole Year",
};
export const TERMS = Object.keys(TERM_LABEL) as ComponentTerm[];

export const SOURCE_LABEL: Record<ComponentSource, string> = {
  ENTERED: "Entered by Teachers",
  PLATFORM: "From Practice on the Platform",
};

export const ATTEMPT_RULE_LABEL: Record<AttemptRule, string> = {
  BEST: "Best Attempt",
  FIRST: "First Attempt",
  LATEST: "Latest Attempt",
};
export const ATTEMPT_RULE_MEANING: Record<AttemptRule, string> = {
  BEST: "The highest-scoring attempt that has been marked in full.",
  FIRST: "The first attempt the student submitted.",
  LATEST: "The most recent attempt the student submitted.",
};

export const STATUS_LABEL: Record<SchemeStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  SUPERSEDED: "Replaced",
};

export const MARK_STATUS_LABEL: Record<MarkStatus, string> = {
  ENTERED: "Marks",
  ABSENT: "Absent",
  EXEMPT: "Exempt",
};

export const RESULT_STATUS_LABEL: Record<ComponentResultStatus, string> = {
  MARKS: "Marks",
  ABSENT: "Absent",
  EXEMPT: "Exempt",
  MISSING: "Not Yet",
};

// --- numbers as decimal text ---------------------------------------------------

/** A number typed or sent as text ("17.5", " 40 "), or null when it is not one. */
export function parseNumber(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const trimmed = String(text).trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** A weight as whole hundredths, so adding never drifts (0.1 + 0.2); null
 *  for anything the server refuses as a weight: not above 0, or more than
 *  2 decimal places. */
function weightHundredths(text: string): number | null {
  const trimmed = String(text ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const value = Math.round(Number(trimmed) * 100);
  return value > 0 ? value : null;
}

/** "40" for 40, "2.5" for 2.5, "12.25" for 12.25. */
export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

/** The editor's running total of the weights typed so far, and whether it is exactly 100. */
export function weightTotal(weights: string[]): { total: string; complete: boolean; unreadable: boolean } {
  let sum = 0;
  let unreadable = false;
  for (const weight of weights) {
    const value = weightHundredths(weight);
    if (value === null) unreadable = true;
    else sum += value;
  }
  return { total: formatNumber(sum / 100), complete: !unreadable && sum === 10000 && weights.length > 0, unreadable };
}

// --- the editor's form ----------------------------------------------------------

export interface ComponentForm {
  componentKey: string | null;
  name: string;
  kind: ComponentKind;
  term: ComponentTerm;
  source: ComponentSource;
  maxMarks: string;
  weightPercent: string;
  minPassPercent: string;
  activityIds: string[];
}

export interface SchemeForm {
  name: string;
  description: string;
  attemptRule: AttemptRule;
  passPercent: string;
  passLabel: string;
  failLabel: string;
  decimalPlaces: 0 | 1;
  components: ComponentForm[];
  gradeBands: GradeBand[];
}

export function schemeFormFrom(scheme: SchemeDetail): SchemeForm {
  return {
    name: scheme.name,
    description: scheme.description ?? "",
    attemptRule: scheme.attemptRule,
    passPercent: scheme.passPercent,
    passLabel: scheme.passLabel,
    failLabel: scheme.failLabel,
    decimalPlaces: scheme.decimalPlaces === 1 ? 1 : 0,
    components: scheme.components.map((c) => ({
      componentKey: c.componentKey,
      name: c.name,
      kind: c.kind,
      term: c.term,
      source: c.source,
      maxMarks: c.maxMarks,
      weightPercent: c.weightPercent,
      minPassPercent: c.minPassPercent ?? "",
      activityIds: c.activities.map((a) => a.id),
    })),
    gradeBands: scheme.gradeBands.map((b) => ({ ...b })),
  };
}

export function blankComponent(): ComponentForm {
  return {
    componentKey: null,
    name: "",
    kind: "OTHER",
    term: "WHOLE_YEAR",
    source: "ENTERED",
    maxMarks: "",
    weightPercent: "",
    minPassPercent: "",
    activityIds: [],
  };
}

/** The PUT body. Text is trimmed; an empty own pass mark is sent as null
 *  (no minimum), and an entered component never carries practice sets. */
export function schemeRequest(form: SchemeForm) {
  return {
    name: form.name.trim(),
    description: form.description.trim() === "" ? null : form.description.trim(),
    attemptRule: form.attemptRule,
    passPercent: form.passPercent.trim(),
    passLabel: form.passLabel.trim(),
    failLabel: form.failLabel.trim(),
    decimalPlaces: form.decimalPlaces,
    components: form.components.map((c) => ({
      componentKey: c.componentKey,
      name: c.name.trim(),
      kind: c.kind,
      term: c.term,
      source: c.source,
      maxMarks: c.maxMarks.trim(),
      weightPercent: c.weightPercent.trim(),
      minPassPercent: c.minPassPercent.trim() === "" ? null : c.minPassPercent.trim(),
      activityIds: c.source === "PLATFORM" ? c.activityIds : [],
    })),
    gradeBands: form.gradeBands.map((b) => ({ label: b.label.trim(), minPercent: String(b.minPercent).trim() })),
  };
}

// --- the preview ------------------------------------------------------------------

/** Round half up, as the server does (assessment_service.round_half_up). */
export function roundHalfUp(value: number, places: number): number {
  const factor = 10 ** places;
  // The small nudge keeps 90.5 from becoming 90.4999999 on the way.
  return Math.floor(value * factor + 0.5 + 1e-9) / factor;
}

export function gradeFor(bands: GradeBand[], shown: number): string | null {
  const sorted = [...bands]
    .map((b) => ({ label: b.label, min: parseNumber(b.minPercent) }))
    .filter((b): b is { label: string; min: number } => b.min !== null)
    .sort((a, b) => b.min - a.min);
  return sorted.find((b) => shown >= b.min)?.label ?? null;
}

/**
 * The editor's example: one student's result from sample marks (as
 * percentages of each component), using the form as typed. Only the
 * weighted sum, rounding, grade and pass mark; Absent, Exempt and
 * provisional results are the server's. null while the form can't be read.
 */
export function previewResult(
  form: SchemeForm,
  samplePercents: number[],
): { shown: string; grade: string | null; passed: boolean } | null {
  let weighted = 0;
  let weights = 0;
  form.components.forEach((component, index) => {
    const weight = parseNumber(component.weightPercent);
    const percent = samplePercents[index];
    if (weight === null || weight <= 0 || percent === undefined) return;
    weighted += percent * weight;
    weights += weight;
  });
  const pass = parseNumber(form.passPercent);
  if (weights === 0 || pass === null) return null;
  const shownValue = roundHalfUp(weighted / weights, form.decimalPlaces);
  const ownMinimumFailed = form.components.some((component, index) => {
    const minimum = parseNumber(component.minPassPercent);
    const percent = samplePercents[index];
    return minimum !== null && percent !== undefined && roundHalfUp(percent, form.decimalPlaces) < minimum;
  });
  return {
    shown: shownValue.toFixed(form.decimalPlaces),
    grade: gradeFor(form.gradeBands, shownValue),
    passed: shownValue >= pass && !ownMinimumFailed,
  };
}

// --- results as a spreadsheet ------------------------------------------------------

/** A result as the scheme shows it: "91.0" in a one-decimal scheme, not "91". */
export function formatResult(value: string | null, decimalPlaces: number): string | null {
  const number = parseNumber(value);
  return number === null ? value : number.toFixed(decimalPlaces === 1 ? 1 : 0);
}

function csvCell(value: string | null | undefined): string {
  const text = value ?? "";
  // A leading =, +, -, @, tab or return could run as a formula in a
  // spreadsheet: written as text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function resultsCsv(
  components: { id: string; name: string; maxMarks: string }[],
  rows: {
    studentCode: string;
    studentName: string | null;
    components: { componentId: string; status: ComponentResultStatus; marks: string | null }[];
    result: string | null;
    grade: string | null;
    outcomeLabel: string | null;
    provisional: boolean;
  }[],
  decimalPlaces = 0,
): string {
  const header = [
    "Student Code",
    "Student Name",
    ...components.map((c) => `${c.name} (out of ${c.maxMarks})`),
    "Result (%)",
    "Grade",
    "Outcome",
    "Provisional",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    const byId = new Map(row.components.map((c) => [c.componentId, c]));
    const cells = components.map((c) => {
      const cell = byId.get(c.id);
      if (!cell) return "";
      if (cell.status === "MARKS") return cell.marks ?? "";
      return RESULT_STATUS_LABEL[cell.status];
    });
    lines.push(
      [
        row.studentCode,
        row.studentName ?? "",
        ...cells,
        formatResult(row.result, decimalPlaces) ?? "",
        row.grade ?? "",
        row.outcomeLabel ?? "",
        row.provisional ? "Yes" : "No",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  // A byte-order mark so Excel reads names in any script correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

// --- marks entry ----------------------------------------------------------------------

/** What a marks box holds: "" (nothing), a number as typed, "AB" or "EX". */
export type MarkCell = string;

export function cellFrom(status: MarkStatus | null, marks: string | null): MarkCell {
  if (status === "ABSENT") return "AB";
  if (status === "EXEMPT") return "EX";
  return marks ?? "";
}

/** A box's contents as what will be saved, or an error sentence. */
export function readCell(
  cell: MarkCell,
  maxMarks: string,
  source: ComponentSource,
): { status: MarkStatus | null; marks: string | null } | { error: string } {
  const text = cell.trim().toUpperCase();
  if (text === "") return { status: null, marks: null };
  if (text === "AB" || text === "A" || text === "ABSENT") return { status: "ABSENT", marks: null };
  if (text === "EX" || text === "E" || text === "EXEMPT") return { status: "EXEMPT", marks: null };
  if (source === "PLATFORM") return { error: "Only AB or EX: these marks come from the platform." };
  const value = parseNumber(text);
  const maximum = parseNumber(maxMarks);
  if (value === null || text.startsWith("-") || (maximum !== null && value > maximum)) {
    return { error: `A number from 0 to ${maxMarks}, or AB or EX.` };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: "At most 2 decimal places." };
  return { status: "ENTERED", marks: formatNumber(value) };
}

/** Whether a box differs from what is saved (17.50 is the same as 17.5). */
export function cellChanged(cell: MarkCell, saved: { status: MarkStatus | null; marks: string | null }, maxMarks: string, source: ComponentSource): boolean {
  const read = readCell(cell, maxMarks, source);
  if ("error" in read) return true;
  return read.status !== saved.status || (read.marks ?? null) !== (saved.marks ?? null);
}
