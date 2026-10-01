// Small, pure formatting helpers shared by the Practice Tracker pages.

import type { SectionScope, TrackerSection } from "@/types/tracker";

/** "Class 5 · Section A · Mathematics", leaving out whatever isn't known.
 *  A whole-class assignment (no section) reads "Class 5 · All Sections". */
export function scopeLabel(scope: Pick<SectionScope, "classLevelCode" | "section" | "boardCourseName" | "className">): string {
  const classPart = scope.classLevelCode
    ? `Class ${scope.classLevelCode}`
    : scope.className
      ? `Class ${scope.className}`
      : null;
  const sectionPart = scope.section ? `Section ${scope.section}` : classPart ? "All Sections" : "Individual Students";
  return [classPart, sectionPart, scope.boardCourseName].filter(Boolean).join(" · ");
}

/** Compact form for tight table cells: "5A · Mathematics". */
export function scopeShort(scope: Pick<SectionScope, "classLevelCode" | "section" | "boardCourseName" | "className">): string {
  const cls = scope.classLevelCode ?? scope.className;
  const head = cls ? `${cls}${scope.section ?? ""}` : "Individual";
  return [head, scope.boardCourseName].filter(Boolean).join(" · ");
}

export function sectionOptionLabel(section: TrackerSection): string {
  const label = scopeLabel({ ...section, className: null });
  return section.isCurrent ? label : `${label} (Past)`;
}

/** Student's own class/section, e.g. "5A". */
export function studentClassLabel(className: string | null, section: string | null): string {
  if (!className) return "—";
  return section ? `${className}${section}` : className;
}

/** "2026-09-14" -> "14 Sep", parsed as a local calendar date (new Date on
 *  a bare ISO date is UTC midnight, which shows as the 13th west of
 *  Greenwich). */
export function formatDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(date);
  }
  return formatDateTime(value, { withTime: false });
}

/** A server timestamp in the viewer's own time zone: "14 Sep, 3:05 pm".
 *  Timestamps without an offset are the backend's UTC. */
export function formatDateTime(value: string | null | undefined, { withTime = true } = {}): string | null {
  if (!value) return null;
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value);
  const date = new Date(hasZone ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function percentOf(score: number, max: number): number | null {
  return max > 0 ? Math.round((score / max) * 100) : null;
}

/** Badge tone for a percentage: jade from 80, saffron from 50, coral below.
 *  The number itself is always printed beside the colour. */
export function percentTone(percent: number | null): "success" | "accent" | "danger" | "neutral" {
  if (percent === null) return "neutral";
  if (percent >= 80) return "success";
  if (percent >= 50) return "accent";
  return "danger";
}
