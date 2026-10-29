/** Curriculum Studio's pure helpers (#212): counts, dates and where a calendar entry stands. Unit tested. */
import type { SchoolCurriculumMapEntry } from "@/types/curriculum";

/** "1 lesson", "12 lessons". */
export function countOf(count: number, noun: string, plural = `${noun}s`): string {
  return `${count.toLocaleString("en-IN")} ${count === 1 ? noun : plural}`;
}

/** "2026-09-14" -> "14 Sep 2026", read as a local date (not UTC midnight). */
export function formatPlannedDay(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

/** Local YYYY-MM-DD, so "running now" is judged on the viewer's own day. */
export function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export type MapTiming = "running" | "upcoming" | "finished" | "undated";

/** Where a calendar entry stands today. */
export function mapTiming(mapping: Pick<SchoolCurriculumMapEntry, "plannedStartDate" | "plannedEndDate">, today: string): MapTiming {
  const start = mapping.plannedStartDate;
  const end = mapping.plannedEndDate;
  if (!start) return "undated";
  if (start && start > today) return "upcoming";
  if (end && end < today) return "finished";
  return "running";
}
