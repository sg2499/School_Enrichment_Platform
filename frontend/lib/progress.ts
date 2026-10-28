/**
 * My Progress (#184): how a skill's band is named and coloured, and the
 * words around a skill's score. The bands themselves are worked out on the
 * server (progress_service.band_for); this only presents them.
 */
import type { BadgeTone } from "@/components/ui/Badge";
import { PRACTICE_LIST_HREF, resultHref } from "@/lib/studentPractice";
import type { ChapterProgress, SelfPracticeHistoryItem, SkillBand, SkillProgress, StandingBand } from "@/types/progress";

export const MY_PROGRESS_HREF = "/student/progress";
export const MY_PROGRESS_NAME = "My Progress";

export const BAND_LABEL: Record<SkillBand, string> = {
  STRONG: "Strong",
  GETTING_THERE: "Getting There",
  NEEDS_WORK: "Needs Work",
  JUST_STARTED: "Just Started",
  NOT_STARTED: "Not Started",
};

export const BAND_TONE: Record<SkillBand, BadgeTone> = {
  STRONG: "success",
  GETTING_THERE: "accent",
  NEEDS_WORK: "danger",
  JUST_STARTED: "brand",
  NOT_STARTED: "neutral",
};

/** The bar's fill for each band. */
export const BAND_BAR: Record<SkillBand, string> = {
  STRONG: "bg-jade-500",
  GETTING_THERE: "bg-saffron-500",
  NEEDS_WORK: "bg-coral-500",
  JUST_STARTED: "bg-brand-400",
  NOT_STARTED: "bg-ink-200",
};

/** Strongest first, then the ones still to work on, then not yet tried. */
export const BAND_ORDER: SkillBand[] = ["STRONG", "GETTING_THERE", "NEEDS_WORK", "JUST_STARTED", "NOT_STARTED"];

/** Whole percent, rounded down: 79.6% is "79%", so it never reads as the
 *  80% that Strong needs beside a Getting There badge. */
export function percentText(percent: number | null | undefined): string {
  if (percent === null || percent === undefined || Number.isNaN(percent)) return "—";
  return `${Math.floor(percent + 1e-9)}%`;
}

/** A mock paper's marks: "34 / 60 (56%)", "so far" while a written answer
 *  waits for its mark, or "—". */
export function mockMarksText(m: { score: number | null; maxScore: number | null; percent: number | null; waiting?: number }): string {
  if (m.score === null || !m.maxScore) return "—";
  const marks = m.percent === null ? `${m.score} / ${m.maxScore}` : `${m.score} / ${m.maxScore} (${percentText(m.percent)})`;
  return m.waiting ? `${marks} so far` : marks;
}

/** The self-practice button's words for a set the student already has. */
export function selfPracticeAction(openTargetId: string | null, status: string | null | undefined): string {
  if (!openTargetId) return "Practise on My Own";
  if (status === "IN_PROGRESS") return "Continue";
  if (status === "COMPLETED") return "Try Again";
  return "Start";
}

/** "6 questions" / "1 question" / "Not practised yet". */
export function answeredText(answered: number): string {
  if (answered <= 0) return "Not practised yet";
  return `${answered} ${answered === 1 ? "question" : "questions"}`;
}

/** What a band means, in a sentence a student reads. */
export function bandMeaning(band: SkillBand, minAnswers: number): string {
  switch (band) {
    case "STRONG":
      return "You get most of these right.";
    case "GETTING_THERE":
      return "Nearly there: a little more practice.";
    case "NEEDS_WORK":
      return "Practise this one next.";
    case "JUST_STARTED":
      return `Answer ${minAnswers} or more questions to see how you're doing.`;
    default:
      return "You haven't practised this skill yet.";
  }
}

/** How many skills of a chapter are in each band, in BAND_ORDER. */
export function chapterCounts(chapter: ChapterProgress): { band: SkillBand; count: number }[] {
  const counts = new Map<SkillBand, number>();
  for (const skill of chapter.skills) counts.set(skill.band, (counts.get(skill.band) ?? 0) + 1);
  return BAND_ORDER.filter((band) => (counts.get(band) ?? 0) > 0).map((band) => ({ band, count: counts.get(band) ?? 0 }));
}

/** A chapter with anything practised opens by itself; one never tried stays closed. */
export function chapterStarted(chapter: ChapterProgress): boolean {
  return chapter.skills.some((s) => s.band !== "NOT_STARTED");
}

/** Skills whose name or code contains the search, in each chapter; empty chapters drop out. */
export function filterChapters(chapters: ChapterProgress[], search: string, band: SkillBand | "ALL"): ChapterProgress[] {
  const term = search.trim().toLowerCase();
  return chapters
    .map((chapter) => ({
      ...chapter,
      skills: chapter.skills.filter(
        (s: SkillProgress) =>
          (band === "ALL" || s.band === band) &&
          (!term || s.title.toLowerCase().includes(term) || s.code.toLowerCase().includes(term)),
      ),
    }))
    .filter((chapter) => chapter.skills.length > 0);
}

/** A self-practice set's line: its score, or where it stands. */
export function selfPracticeStatus(item: SelfPracticeHistoryItem): string {
  const latest = item.latestAttempt;
  if (!latest) return "Not started yet";
  if (latest.status === "IN_PROGRESS") return `Attempt ${latest.attemptNumber} in progress`;
  if (latest.reviewStatus === "PENDING_REVIEW") return `Waiting for your teacher's marks`;
  if (latest.finalScore !== null && latest.maxScore) return `${latest.finalScore} / ${latest.maxScore}`;
  return "Handed in";
}

/** Where opening a self-practice set goes: the set itself, or its last result. */
export function selfPracticeHref(item: SelfPracticeHistoryItem): { label: "Continue" | "Start" | "View Result"; href: string } {
  const latest = item.latestAttempt;
  if (latest && latest.status === "IN_PROGRESS") return { label: "Continue", href: `${PRACTICE_LIST_HREF}/${item.assignmentTargetId}` };
  if (latest) return { label: "View Result", href: resultHref(item.assignmentTargetId, latest.id) };
  return { label: "Start", href: `${PRACTICE_LIST_HREF}/${item.assignmentTargetId}` };
}

// --- Class standing (#185) ---------------------------------------------------

export const STANDING_LABEL: Record<StandingBand, string> = {
  TOP_10: "Top 10%",
  TOP_25: "Top 25%",
  TOP_HALF: "Top Half",
};

/** "Top 25% of Class 5", or just the band when the class isn't known. */
export function standingText(band: StandingBand, classLabel: string | null | undefined): string {
  return classLabel ? `${STANDING_LABEL[band]} of ${classLabel}` : STANDING_LABEL[band];
}

/** The chapters the student has a standing in, in the map's order. */
export function chaptersWithStanding(chapters: ChapterProgress[]): (ChapterProgress & { standing: StandingBand })[] {
  return chapters.filter((c): c is ChapterProgress & { standing: StandingBand } => Boolean(c.standing));
}
