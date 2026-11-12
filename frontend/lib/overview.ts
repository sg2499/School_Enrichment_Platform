/** Wording for the overview screens (#224). Pure, so it is unit tested. */

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 of 4" as a whole-number percent, rounded DOWN, the one rule for every percentage (lib/studentPractice.ts wholePercent); "—" when there is nothing to divide. */
export function sharePercent(part: number, whole: number): string {
  if (!whole) return "—";
  return `${Math.floor((part / whole) * 100 + 1e-9)}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Nov" from an ISO date ("2026-11-12") or timestamp. "" if it is not a date. */
export function shortDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "";
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month}` : "";
}

/** "5 Oct – 19 Oct", "From 5 Oct", "Until 19 Oct" or "Not scheduled". */
export function dateRange(start: string | null | undefined, end: string | null | undefined): string {
  const a = shortDate(start);
  const b = shortDate(end);
  if (a && b) return `${a} – ${b}`;
  if (a) return `From ${a}`;
  if (b) return `Until ${b}`;
  return "Not scheduled";
}

/** When something happened, in IST: "12 Nov, 3:05 pm". */
export function activityTime(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(t.getTime())) return "";
  const ist = new Date(t.getTime() + 5.5 * 3600_000);
  const h = ist.getUTCHours();
  const minutes = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]}, ${h % 12 || 12}:${minutes} ${h < 12 ? "am" : "pm"}`;
}

export const DIFFICULTY_LABEL: Record<string, string> = { "1": "Easy", "2": "Medium", "3": "Hard", "4": "Challenge" };

/** "Easy 4 · Medium 10", in difficulty order; "No questions yet" when empty. */
export function difficultyLine(byDifficulty: Record<string, number>): string {
  const parts = ["1", "2", "3", "4"]
    .filter((k) => (byDifficulty[k] ?? 0) > 0)
    .map((k) => `${DIFFICULTY_LABEL[k]} ${byDifficulty[k]}`);
  return parts.length ? parts.join(" · ") : "No questions yet";
}

/** The questions a chapter still needs approved. */
export function waitingApproval(questions: number, approved: number): number {
  return Math.max(0, questions - approved);
}
