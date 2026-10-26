/**
 * Class Analytics (#186): how a grid cell is drawn and named, and the
 * address that opens Assign Practice with a misconception's students and
 * practice set already chosen. The rules themselves are on the server
 * (analytics_service).
 */
import type { AnalyticsSection, CellState, GridStudent } from "@/types/analytics";

export const CELL_LABEL: Record<CellState, string> = {
  CORRECT: "Right",
  PARTIAL: "Part marks",
  WRONG: "Wrong",
  BLANK: "Left blank",
  PENDING: "Waiting for marks",
};

/** The character in the cell, so the state never rests on colour alone. */
export const CELL_SYMBOL: Record<CellState, string> = {
  CORRECT: "✓",
  PARTIAL: "½",
  WRONG: "✗",
  BLANK: "–",
  PENDING: "…",
};

export const CELL_CLASS: Record<CellState, string> = {
  CORRECT: "bg-jade-100 text-jade-800",
  PARTIAL: "bg-saffron-100 text-saffron-900",
  WRONG: "bg-coral-100 text-coral-800",
  BLANK: "bg-coral-50 text-coral-700",
  PENDING: "bg-brand-50 text-brand-700",
};

export function sectionName(section: Pick<AnalyticsSection, "classLevelCode" | "section" | "boardCourseName">): string {
  return [`Class ${section.classLevelCode ?? "?"}`, `Section ${section.section}`, section.boardCourseName]
    .filter(Boolean)
    .join(" · ");
}

/** The cell's words for a screen reader and its tooltip. */
export function cellText(cell: GridStudent["cells"][number], questionNumber: number): string {
  if (!cell) return `Question ${questionNumber}: not answered`;
  const marks = cell.score === null ? "" : ` (${cell.score} of ${cell.max})`;
  return `Question ${questionNumber}: ${CELL_LABEL[cell.state]}${marks}`;
}

/** The question's share right, as a whole percent rounded down; "—" with no answers. */
export function percentCorrectText(percent: number | null | undefined): string {
  if (percent === null || percent === undefined) return "—";
  return `${Math.floor(percent + 1e-9)}%`;
}

/** A tone for a question's share right: under half is worth a look. */
export function questionTone(percent: number | null | undefined): "low" | "mid" | "high" | "none" {
  if (percent === null || percent === undefined) return "none";
  if (percent < 50) return "low";
  if (percent < 80) return "mid";
  return "high";
}

/** "14 of 32 students", the sentence the report leads with. */
export function flaggedText(flagged: number, answered: number): string {
  return `${flagged} of ${answered} ${answered === 1 ? "student" : "students"}`;
}

/**
 * Assign Practice, filled in: this section, the set, and these students
 * (the page reads it once, and the teacher checks and assigns).
 */
export function assignHref(opts: {
  chapterId: string;
  learningActivityId: string;
  section: Pick<AnalyticsSection, "classLevelCode" | "section" | "boardCourseId">;
  studentIds: string[];
}): string {
  const params = new URLSearchParams({
    chapter: opts.chapterId,
    activity: opts.learningActivityId,
    classLevel: opts.section.classLevelCode ?? "",
    section: opts.section.section,
    course: opts.section.boardCourseId,
    students: opts.studentIds.join(","),
    from: "analytics",
  });
  return `/teacher/assign?${params.toString()}`;
}

export interface AssignPrefill {
  chapterId: string;
  activityId: string;
  classLevel: string;
  section: string;
  courseId: string;
  studentIds: string[];
}

/** What assignHref put in the address, or null when it isn't all there. */
export function readAssignPrefill(search: string): AssignPrefill | null {
  const params = new URLSearchParams(search);
  if (params.get("from") !== "analytics") return null;
  const chapterId = params.get("chapter") ?? "";
  const activityId = params.get("activity") ?? "";
  const classLevel = params.get("classLevel") ?? "";
  const section = params.get("section") ?? "";
  const courseId = params.get("course") ?? "";
  const studentIds = (params.get("students") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);
  if (!chapterId || !activityId || !classLevel || !section || !courseId || studentIds.length === 0) return null;
  return { chapterId, activityId, classLevel, section, courseId, studentIds: [...new Set(studentIds)] };
}
