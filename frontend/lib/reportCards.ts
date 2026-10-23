/**
 * Report cards' words and checks for the screens (#188). Pure: no React, no
 * network, so tests/unit/reportCards.test.mjs covers it directly. The server
 * checks everything again (report_card_service.py); these checks only let a
 * teacher see a mistake in the box where they made it.
 */
import type { CardTerm, IssueStatus, RecordTerm, TermRecordRow } from "@/types/reportCards";

export const RECORD_TERMS: RecordTerm[] = ["TERM_1", "TERM_2"];
export const CARD_TERMS: CardTerm[] = ["TERM_1", "YEAR_END"];

export const RECORD_TERM_LABEL: Record<RecordTerm, string> = { TERM_1: "Term 1", TERM_2: "Term 2" };
export const CARD_TERM_LABEL: Record<CardTerm, string> = { TERM_1: "Term 1 Card", YEAR_END: "Year-End Card" };
export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = { ISSUED: "Issued", WITHDRAWN: "Withdrawn" };

export const MAX_DAYS = 366;
export const MAX_REMARK = 300;

/** One student's row as typed: text boxes, so "" means "not recorded yet". */
export interface RecordForm {
  workingDays: string;
  daysPresent: string;
  grades: Record<string, string>;
  remark: string;
}

/** A row's boxes from what is saved. With `labels` (today's scale), a grade
 *  left from an earlier scale is dropped, as the cards drop it: otherwise it
 *  would hide in the form and the server would refuse the row. */
export function recordFormFrom(row: TermRecordRow, labels?: string[]): RecordForm {
  const grades = Object.fromEntries(
    Object.entries(row.grades).filter(([, label]) => !labels || labels.includes(label)),
  );
  return {
    workingDays: row.workingDays === null ? "" : String(row.workingDays),
    daysPresent: row.daysPresent === null ? "" : String(row.daysPresent),
    grades,
    remark: row.remark ?? "",
  };
}

/** A days box: null when empty, a whole number, or an error sentence. */
export function readDays(text: string): { value: number | null } | { error: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { value: null };
  if (!/^\d+$/.test(trimmed) || Number(trimmed) > MAX_DAYS) {
    return { error: `A whole number from 0 to ${MAX_DAYS}.` };
  }
  return { value: Number(trimmed) };
}

/** The problems with one row as typed, by box ("workingDays", "daysPresent", "remark"). */
export function rowProblems(form: RecordForm): Partial<Record<"workingDays" | "daysPresent" | "remark", string>> {
  const out: Partial<Record<"workingDays" | "daysPresent" | "remark", string>> = {};
  const working = readDays(form.workingDays);
  const present = readDays(form.daysPresent);
  if ("error" in working) out.workingDays = working.error;
  if ("error" in present) out.daysPresent = present.error;
  if ("value" in working && "value" in present && working.value !== null && present.value !== null && present.value > working.value) {
    out.daysPresent = "More than the working days.";
  }
  if (form.remark.trim().length > MAX_REMARK) out.remark = `At most ${MAX_REMARK} characters.`;
  return out;
}

/** The PUT entry for one row (only called once rowProblems is empty). */
export function recordEntry(studentId: string, form: RecordForm, areas: string[]) {
  const working = readDays(form.workingDays);
  const present = readDays(form.daysPresent);
  const grades: Record<string, string> = {};
  for (const area of areas) {
    const label = (form.grades[area] ?? "").trim();
    if (label) grades[area] = label;
  }
  return {
    studentId,
    workingDays: "value" in working ? working.value : null,
    daysPresent: "value" in present ? present.value : null,
    grades,
    remark: form.remark.trim() === "" ? null : form.remark.trim(),
  };
}

/** Whether a row differs from what is saved (" 96 " is the same as 96). */
export function recordChanged(row: TermRecordRow, form: RecordForm, areas: string[], labels?: string[]): boolean {
  const entry = recordEntry(row.studentId, form, areas);
  const saved = recordEntry(row.studentId, recordFormFrom(row, labels), areas);
  return JSON.stringify(entry) !== JSON.stringify(saved);
}

/** The same days for every row that has none yet ("Fill Working Days"). */
export function fillWorkingDays(forms: Record<string, RecordForm>, days: string): Record<string, RecordForm> {
  if ("error" in readDays(days)) return forms;
  const next: Record<string, RecordForm> = {};
  for (const [id, form] of Object.entries(forms)) {
    next[id] = form.workingDays.trim() === "" ? { ...form, workingDays: days.trim() } : form;
  }
  return next;
}

/** "91.0%" or "—". */
export function percentText(value: string | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : `${value}%`;
}

/** A component's cell on a card: its marks, AB, EX or —. */
export function markText(status: string, marks: string | null): string {
  if (status === "MARKS") return marks ?? "—";
  if (status === "ABSENT") return "AB";
  if (status === "EXEMPT") return "EX";
  return "—";
}

/** A file name from parts: letters, numbers and dashes only. */
export function pdfName(...parts: Array<string | null | undefined>): string {
  const name = parts
    .filter(Boolean)
    .join(" ")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return `${name || "Report-Card"}.pdf`;
}
