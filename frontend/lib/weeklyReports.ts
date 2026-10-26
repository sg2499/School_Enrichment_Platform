/**
 * The weekly parent report's words for the screens (#187). Pure: no React,
 * no network, so tests/unit/weeklyReports.test.mjs covers it directly. The
 * server checks the notes again (weekly_report_service.py).
 */
import type { SetStatus, WeekNumbers, WeekTotals, WeeklySection } from "@/types/weeklyReports";

export const MAX_NOTE = 300;

export const STATUS_TONE: Record<SetStatus, "success" | "warning" | "danger" | "neutral"> = {
  DONE_ON_TIME: "success",
  DONE: "success",
  DONE_LATE: "warning",
  NOT_DONE: "danger",
  IN_PROGRESS: "neutral",
  NOT_STARTED: "neutral",
};

export function sectionKey(s: { classLevelId: string; section: string }): string {
  return `${s.classLevelId}|${s.section}`;
}

export function sectionName(s: WeeklySection): string {
  return `${s.classLevel} · Section ${s.section}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "2 of 3 sets done · 1 late · 1 not done", or "No practice set". */
export function totalsText(t: WeekTotals): string {
  if (t.given === 0) return "No practice set";
  const parts = [`${t.done} of ${plural(t.given, "set")} done`];
  if (t.late) parts.push(`${t.late} late`);
  if (t.notDone) parts.push(`${t.notDone} not done`);
  if (t.open) parts.push(`${t.open} still open`);
  return parts.join(" · ");
}

/** "18 answers · 82% of marks", plus their own practice. */
export function numbersText(n: WeekNumbers): string {
  if (n.answered === 0) return n.ownPractice ? `${plural(n.ownPractice, "set")} of their own` : "Nothing handed in";
  const parts = [plural(n.answered, "answer")];
  if (n.percent !== null) parts.push(`${n.percent}% of marks`);
  if (n.ownPractice) parts.push(`${plural(n.ownPractice, "set")} of their own`);
  return parts.join(" · ");
}

/** The note as it will be saved (spaces tidied), and whether it is too long. */
export function cleanNote(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(" ");
}

export function noteProblem(text: string): string | null {
  return cleanNote(text).length > MAX_NOTE ? `At most ${MAX_NOTE} characters.` : null;
}

/** The notes that differ from what is saved, for the PUT. */
export function changedNotes(drafts: Record<string, string>, saved: Record<string, string | null>): { studentId: string; note: string | null }[] {
  return Object.entries(drafts)
    .filter(([id, text]) => cleanNote(text) !== (saved[id] ?? ""))
    .map(([studentId, text]) => ({ studentId, note: cleanNote(text) || null }));
}

/** "21 Oct" from "2026-10-21". */
export function shortDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "—";
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return month ? `${d} ${month}` : "—";
}

export function scoreText(score: number | null, possible: number | null, marksToCome = false): string {
  if (score === null || !possible) return marksToCome ? "Marks to come" : "—";
  return `${score} / ${possible}${marksToCome ? " (marks to come)" : ""}`;
}

/** A file name for a download: letters, digits and dashes. */
export function pdfName(...parts: (string | null | undefined)[]): string {
  const text = parts.filter(Boolean).join("-").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${text.slice(0, 90) || "Weekly-Report"}.pdf`;
}
