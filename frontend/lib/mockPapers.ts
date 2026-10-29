/**
 * Mock papers (#166 step 3): the words and small sums the test builder and
 * the paper page share. The rules are on the server (mock_paper_service,
 * paper_formats); these only describe them.
 */
import type { FormatSection, PaperFormat, PaperStatus, QuestionKind, SitPlace, SitSection } from "@/types/mockPapers";

export const STATUS_LABEL: Record<PaperStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Approved, Not Open Yet",
  OPEN: "Open",
  CLOSED: "Closed",
  WITHDRAWN: "Withdrawn",
};

export const STATUS_TONE: Record<PaperStatus, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  DRAFT: "warning",
  SCHEDULED: "brand",
  OPEN: "success",
  CLOSED: "neutral",
  WITHDRAWN: "danger",
};

export const KIND_LABEL: Record<QuestionKind, string> = {
  ANY: "Any kind",
  CHOICE: "Multiple choice",
  NUMBER: "Number or short answer",
  WRITTEN: "Long answer in steps",
  CASE_STUDY: "Case study",
};

export const DIFFICULTY_LABEL = { easy: "Easy", medium: "Medium", hard: "Challenging" } as const;

export const MARK_CHOICES = [1, 2, 3, 4, 5] as const;

/** The kinds a question of these marks can be (4 marks is the case study;
 *  long answers in steps are 3 or 5 marks, #208). */
export function kindsFor(marks: number): QuestionKind[] {
  if (marks === 4) return ["CASE_STUDY"];
  if (marks <= 2) return ["ANY", "CHOICE", "NUMBER"];
  return ["ANY", "NUMBER", "WRITTEN"];
}

/** A section with its marks changed, its kind kept if it still fits. */
export function withMarks(section: FormatSection, marks: number): FormatSection {
  const kinds = kindsFor(marks);
  return { ...section, marks, kind: kinds.includes(section.kind) ? section.kind : kinds[0] };
}

export function sectionMarks(section: Pick<FormatSection, "marks" | "count">): number {
  return (Number(section.marks) || 0) * (Number(section.count) || 0);
}

export function totalMarks(format: Pick<PaperFormat, "sections">): number {
  return format.sections.reduce((sum, s) => sum + sectionMarks(s), 0);
}

/** "15 questions × 1 mark, 1 either/or" */
export function sectionText(section: Pick<FormatSection, "marks" | "count" | "choices">): string {
  const q = `${section.count} ${section.count === 1 ? "question" : "questions"} × ${section.marks} ${section.marks === 1 ? "mark" : "marks"}`;
  return section.choices > 0 ? `${q}, ${section.choices} with an either/or choice` : q;
}

/** "2 hours", "1 hour 30 minutes", "40 minutes" */
export function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const parts = [];
  if (h) parts.push(`${h} ${h === 1 ? "hour" : "hours"}`);
  if (m || !h) parts.push(`${m} ${m === 1 ? "minute" : "minutes"}`);
  return parts.join(" ");
}

export function nextSectionName(sections: Pick<FormatSection, "name">[]): string {
  const used = new Set(sections.map((s) => s.name));
  for (let i = 0; i < 26; i += 1) {
    const name = `Section ${String.fromCharCode(65 + i)}`;
    if (!used.has(name)) return name;
  }
  return `Section ${sections.length + 1}`;
}

export function blankSection(sections: FormatSection[]): FormatSection {
  return { name: nextSectionName(sections), marks: 1, count: 5, choices: 0, kind: "ANY" };
}

/** The value a <input type="datetime-local"> shows for a moment, in the
 *  viewer's own time zone. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** What the server is sent for a datetime-local value: the same moment with
 *  its offset, so "9:00 am" means 9:00 am where the teacher is. */
export function fromLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** A paper opens tomorrow at 9 am and closes a week later, unless changed. */
export function defaultWindow(now: Date): { opens: string; closes: string } {
  const opens = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0);
  const closes = new Date(opens.getTime() + 7 * 24 * 60 * 60 * 1000);
  closes.setHours(18, 0, 0, 0);
  return { opens: toLocalInput(opens), closes: toLocalInput(closes) };
}

/** The format as the server takes it, from what the builder holds (numbers
 *  typed as text become numbers; an empty field stays as given so the
 *  server can say what's missing). */
export function formatForServer(format: PaperFormat): PaperFormat {
  const num = (v: unknown) => (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : v) as number;
  return {
    ...format,
    sections: format.sections.map((s) => ({ ...s, marks: num(s.marks), count: num(s.count), choices: num(s.choices) })),
    timeMinutes: num(format.timeMinutes),
    readingMinutes: num(format.readingMinutes),
    applicationMin: format.applicationMin === null ? null : num(format.applicationMin),
    difficulty: format.difficulty
      ? { easy: num(format.difficulty.easy), medium: num(format.difficulty.medium), hard: num(format.difficulty.hard) }
      : null,
  };
}

// --- step 4: sitting the paper ------------------------------------------------------------

/** "1:05:09" or "04:59": the time left, never below zero. */
export function countdownText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** The half of a place the student is answering: the chosen one of an
 *  either/or pair (none yet: the first), or the only one. */
export function activeHalf(place: SitPlace) {
  if (!place.choiceGroup) return place.halves[0];
  return place.halves.find((h) => h.slotId === place.chosenSlotId) ?? null;
}

/** A place counts as answered when every part of the half being answered
 *  has something in it. `answers` holds what is typed now, by question. */
export function placeAnswered(place: SitPlace, answers: Record<string, string>): boolean {
  const half = activeHalf(place);
  if (!half) return false;
  return half.parts.every((p) => (answers[p.id] ?? "").replace(/;/g, "").trim() !== "");
}

export function answeredCount(sections: SitSection[], answers: Record<string, string>): { answered: number; total: number } {
  let answered = 0;
  let total = 0;
  for (const s of sections) {
    for (const place of s.places) {
      total += 1;
      if (placeAnswered(place, answers)) answered += 1;
    }
  }
  return { answered, total };
}

/** How the paper was handed in, in words. */
export function handedInText(how: string | null): string {
  if (how === "TIME") return "Handed in when the time ran out, with the answers you had saved.";
  if (how === "CLOSED") return "Handed in when the paper closed, with the answers you had saved.";
  return "You handed in your paper.";
}

export const RESULT_STATE_LABEL = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "Sitting Now",
  TO_MARK: "To Mark",
  MARKED: "Marked",
} as const;
