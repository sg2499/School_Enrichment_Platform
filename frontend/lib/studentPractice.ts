/**
 * What a student's own practice adds up to (4 Oct 2026, UI revamp Phase B,
 * slice 5: the Student workspace).
 *
 * The Student dashboard and the Daily Practice list read the same request
 * (GET /learning/assignments) and, until this slice, each kept its own copy
 * of the status labels, the sort and "what does pressing this row do" --
 * with a TODO in the dashboard asking for exactly this file. The mastheads
 * those two screens now open on print figures worked out from that list,
 * and a figure worked out twice can disagree with itself, so it is worked
 * out once, here, and tested.
 *
 * Everything here is arithmetic on what the server sent. Nothing claims
 * more than the data does:
 *
 *   - A set counts as Completed when the server says COMPLETED, and only then.
 *   - SKIPPED is neither waiting nor done. Nothing sets it today (it exists
 *     only as a column comment in models/learning.py), and if something
 *     ever does it must not be guessed into either pile.
 *   - A score "so far" is said to be so far: while a teacher still has
 *     written answers to mark (reviewStatus PENDING_REVIEW) the score is
 *     not the whole of it yet (learning_service: final = auto + teacher's
 *     marks). Nothing here calls a score "final", or says it can only go
 *     up: a teacher may change a mark they have given, at any time
 *     (learning_service.apply_manual_grades).
 *   - A set still waiting for marks has no percentage worth averaging: it
 *     is left out of the average until it is marked.
 *   - A written answer a teacher gave part marks to is neither right nor
 *     wrong. The server stores is_correct as "full marks or not" for it, so
 *     read naively it shows as Incorrect; answerState() reads the marks.
 *
 * Type-only imports, so it is unit-tested directly
 * (scripts/run-unit-tests.mjs).
 */
import type { AttemptAnswerResult, AttemptResult, StudentAssignmentSummary } from "@/types/learning";

type AssignmentStatus = StudentAssignmentSummary["status"];

/** The name of this screen, everywhere it is named: the rail, the tab, the
 *  way back from a set, a sentence that points at it. It was "Today's
 *  Practice" in some of those and "Daily Practice" in others. */
export const PRACTICE_LIST_NAME = "Daily Practice";
export const PRACTICE_LIST_HREF = "/student/practice";

export const STATUS_LABEL: Record<AssignmentStatus, string> = {
  PENDING: "Not Started",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  SKIPPED: "Skipped",
};

/** What is waiting comes before what is behind: in progress, then not
 *  started, then done. */
export const STATUS_ORDER: Record<AssignmentStatus, number> = {
  IN_PROGRESS: 0,
  PENDING: 1,
  COMPLETED: 2,
  SKIPPED: 3,
};

export type PracticeActionLabel = "Start" | "Continue" | "View Result";

/** What opening a set does, and where it goes. */
export function practiceAction(item: StudentAssignmentSummary): { label: PracticeActionLabel; href: string } {
  const base = `${PRACTICE_LIST_HREF}/${item.assignmentTargetId}`;
  if (item.status === "COMPLETED" && item.latestAttempt) {
    // Straight to the stored result. The attempt page must not start an
    // attempt for this, or looking at a result would use up a re-attempt.
    return { label: "View Result", href: `${base}?attemptId=${item.latestAttempt.id}&view=result` };
  }
  if (item.status === "IN_PROGRESS") return { label: "Continue", href: base };
  return { label: "Start", href: base };
}

export interface PracticeSummary {
  /** In progress first, then not started: the list's own order. */
  waiting: StudentAssignmentSummary[];
  inProgress: number;
  notStarted: number;
  /** Most recently marked first. */
  completed: StudentAssignmentSummary[];
  skipped: StudentAssignmentSummary[];
  /** Everything except SKIPPED. */
  countable: number;
}

export function summarisePractice(assignments: readonly StudentAssignmentSummary[]): PracticeSummary {
  const sorted = [...assignments].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const waiting = sorted.filter((a) => a.status === "IN_PROGRESS" || a.status === "PENDING");
  const completed = sorted
    .filter((a) => a.status === "COMPLETED")
    .sort((a, b) =>
      (b.latestAttempt?.evaluation?.evaluatedAt ?? "").localeCompare(a.latestAttempt?.evaluation?.evaluatedAt ?? ""),
    );
  return {
    waiting,
    inProgress: waiting.filter((a) => a.status === "IN_PROGRESS").length,
    notStarted: waiting.filter((a) => a.status === "PENDING").length,
    completed,
    skipped: sorted.filter((a) => a.status === "SKIPPED"),
    countable: waiting.length + completed.length,
  };
}

export interface LatestScore {
  finalScore: number;
  maxScore: number;
  /** The set it is the score of. */
  title: string;
  /** A teacher still has written answers of this set to mark. */
  stillBeingMarked: boolean;
}

/** The most recently marked set's score, or null when nothing is marked. */
export function latestScore(summary: PracticeSummary): LatestScore | null {
  for (const item of summary.completed) {
    const evaluation = item.latestAttempt?.evaluation;
    if (!evaluation) continue;
    return {
      finalScore: evaluation.finalScore,
      maxScore: evaluation.maxScore,
      title: item.learningActivity.title,
      stillBeingMarked: stillBeingMarked(item),
    };
  }
  return null;
}

/** A teacher still has written answers of this set to mark. */
export function stillBeingMarked(item: StudentAssignmentSummary): boolean {
  return item.latestAttempt?.evaluation?.reviewStatus === "PENDING_REVIEW";
}

/**
 * The mean of each marked set's own percentage, as a whole number, with how
 * many sets it is the mean of -- or null when no set has a score to take a
 * percentage of. Each set counts once, however many questions it has.
 *
 * A set whose written answers are still waiting for a teacher is not a
 * marked set: its score so far leaves those marks out, and averaging it in
 * would pull the figure down for work nobody has judged yet. It joins the
 * average when it is marked.
 */
export function averageScore(summary: PracticeSummary): { percent: number; sets: number } | null {
  const percents: number[] = [];
  for (const item of summary.completed) {
    const evaluation = item.latestAttempt?.evaluation;
    if (!evaluation || !(evaluation.maxScore > 0) || stillBeingMarked(item)) continue;
    percents.push((evaluation.finalScore / evaluation.maxScore) * 100);
  }
  if (percents.length === 0) return null;
  return { percent: Math.round(percents.reduce((sum, value) => sum + value, 0) / percents.length), sets: percents.length };
}

/** "set" or "sets". */
export function setWord(count: number): string {
  return count === 1 ? "set" : "sets";
}

/** The one thing worth doing next. The same shape MastheadNextStep draws
 *  (components/ui/MastheadNextStep.tsx), kept structural so this file has
 *  no component import. */
export interface StudentNextStep {
  title: string;
  body: string;
  action?: { href: string; label: string };
}

export type PracticeLoad = { kind: "loading" } | { kind: "error" } | { kind: "ready"; summary: PracticeSummary };

/**
 * What the dashboard's masthead tells a student to do next. null while the
 * list is still loading (the strip then draws its own placeholder).
 *
 * Every sentence is about this student's own list:
 *   - it could not be read: say so, and never fall back to "nothing to do",
 *     which would be a guess;
 *   - nothing has been assigned: say that, and what will happen when it is;
 *   - something is open or waiting: name it, and go straight to it;
 *   - everything is done: say so, with the results one click away.
 */
export function studentNextStep(load: PracticeLoad): StudentNextStep | null {
  if (load.kind === "loading") return null;

  if (load.kind === "error") {
    return {
      title: "We couldn't check your practice",
      body: `Nothing you've done is lost. Try again below, or open ${PRACTICE_LIST_NAME} directly.`,
      action: { href: PRACTICE_LIST_HREF, label: `Open ${PRACTICE_LIST_NAME}` },
    };
  }

  const { summary } = load;

  if (summary.countable === 0) {
    return {
      title: "No practice assigned yet",
      body: "When your teacher assigns your first practice set, it will appear right here.",
    };
  }

  const next = summary.waiting[0];

  if (!next) {
    const done = summary.completed.length;
    return {
      title: "You're all caught up",
      body: `${done === 1 ? "The practice set" : `All ${done} practice sets`} your teacher has assigned ${done === 1 ? "is" : "are"} done. The next one will show up here when your teacher assigns it.`,
      action: { href: PRACTICE_LIST_HREF, label: "See Your Results" },
    };
  }

  const waiting = summary.waiting.length;
  const action = practiceAction(next);
  const minutes = next.learningActivity.estimatedMinutes;
  const more = waiting - 1;
  const after = more > 0 ? ` ${more} more ${more === 1 ? "is" : "are"} waiting after that.` : "";

  if (next.status === "IN_PROGRESS") {
    return {
      title: "Pick up where you left off",
      body: `You started ${next.learningActivity.title}. It's still open, so carry on whenever you're ready.${after}`,
      action: { href: action.href, label: "Continue Practice" },
    };
  }

  return {
    title: waiting === 1 ? "One practice set is ready for you" : `${waiting} practice sets are ready for you`,
    body: `Next up: ${next.learningActivity.title}${minutes ? `, about ${minutes} minutes` : ""}.${after}`,
    action: { href: action.href, label: "Start Practice" },
  };
}

/** How one answer was marked. */
export type AnswerState = "correct" | "partial" | "incorrect" | "pending";

/**
 * A teacher's marks, when there are any, are the answer: full marks is
 * correct, none is incorrect, anything between is part marks. Otherwise it
 * is what automatic marking said, and an answer nothing has marked yet is
 * pending.
 */
export function answerState(answer: Pick<AttemptAnswerResult, "isCorrect" | "manualScore" | "maxScore">): AnswerState {
  const manual = answer.manualScore;
  if (typeof manual === "number") {
    if (manual >= answer.maxScore) return "correct";
    if (manual <= 0) return "incorrect";
    return "partial";
  }
  if (answer.isCorrect === true) return "correct";
  if (answer.isCorrect === false) return "incorrect";
  return "pending";
}

/** The marks an answer earned, or null while nothing has marked it. */
export function answerMarks(answer: Pick<AttemptAnswerResult, "autoScore" | "manualScore">): number | null {
  if (typeof answer.manualScore === "number") return answer.manualScore;
  if (typeof answer.autoScore === "number") return answer.autoScore;
  return null;
}

export interface ResultTally {
  correct: number;
  partial: number;
  incorrect: number;
  pending: number;
}

export function resultTally(answers: readonly Pick<AttemptAnswerResult, "isCorrect" | "manualScore" | "maxScore">[]): ResultTally {
  const tally: ResultTally = { correct: 0, partial: 0, incorrect: 0, pending: 0 };
  for (const answer of answers) tally[answerState(answer)] += 1;
  return tally;
}

/** One of a question's options, as a result shows it. */
export interface ResultOption {
  letter: string;
  text: string;
  /** The student picked it. */
  chosen: boolean;
  /** It is (one of) the right answer(s). Always false while `reveal` is
   *  off, so a caller cannot show the key by accident. */
  correct: boolean;
}

/**
 * How a result shows one answer.
 *
 *   - "options": a Single or Multi Select question. The server stores the
 *     answer and the key as letters ("B", "A,C"); read alone, "Your answer
 *     A, correct answer C" under "Which is the greatest?" tells a student
 *     nothing. The options are listed with what was picked and what was
 *     right marked on them.
 *   - "sequence": an Ordering question whose answer is a run of option
 *     letters ("C;A;B"), turned back into the things that were ordered.
 *   - "text": everything else (a number, a word, a written answer), and
 *     anything above that cannot be read with certainty -- shown exactly as
 *     it is stored rather than guessed at.
 */
export type AnswerPresentation =
  | { kind: "options"; options: ResultOption[]; answered: boolean }
  | { kind: "sequence"; yours: string[] | null; right: string[] | null }
  | { kind: "text" };

type PresentableAnswer = Pick<AttemptAnswerResult, "questionType" | "options" | "responseText" | "correctAnswer">;

function optionList(answer: PresentableAnswer): { letter: string; text: string }[] {
  const options = answer.options;
  if (!options) return [];
  return Object.keys(options)
    .sort()
    .map((letter) => ({ letter, text: options[letter] ?? "" }))
    .filter((option) => option.text.trim() !== "");
}

function letters(value: string | null | undefined, separator: string): string[] {
  return (value ?? "")
    .split(separator)
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * `reveal` is whether the right answer may be shown: the result screen
 * shows it for an answer that has been marked, never for one still waiting.
 */
export function answerPresentation(answer: PresentableAnswer, reveal: boolean): AnswerPresentation {
  const type = (answer.questionType ?? "").trim().toLowerCase();
  const options = optionList(answer);
  if (options.length === 0) return { kind: "text" };
  const known = new Set(options.map((option) => option.letter));

  if (type === "single select" || type === "multi select") {
    const chosen = letters(answer.responseText, ",");
    const right = letters(answer.correctAnswer, ",");
    // A stored answer or key that names something that is not one of the
    // options cannot be drawn on the options. Show it as stored.
    if (![...chosen, ...right].every((letter) => known.has(letter))) return { kind: "text" };
    return {
      kind: "options",
      answered: chosen.length > 0,
      options: options.map((option) => ({
        ...option,
        chosen: chosen.includes(option.letter),
        correct: reveal && right.includes(option.letter),
      })),
    };
  }

  if (type === "ordering") {
    const byLetter = new Map(options.map((option) => [option.letter, option.text]));
    const sequence = (value: string | null | undefined): string[] | null => {
      const run = letters(value, ";");
      if (run.length === 0 || !run.every((letter) => known.has(letter))) return null;
      return run.map((letter) => byLetter.get(letter) ?? letter);
    };
    const yours = sequence(answer.responseText);
    const right = reveal ? sequence(answer.correctAnswer) : null;
    // The key is written as the values themselves for some questions
    // ("12;15;20"). Unless both sides read as option letters, show both as
    // stored: one side as text and the other as letters would not compare.
    const answered = (answer.responseText ?? "").trim() !== "";
    if ((answered && !yours) || (reveal && !right)) return { kind: "text" };
    return { kind: "sequence", yours, right };
  }

  return { kind: "text" };
}

/** Attempts still to be had on this set. `attemptsUsed` counts the attempt
 *  the result is for (GET .../result); the ceiling is the one start_attempt
 *  enforces, the assignment's own plus any a teacher has granted. */
export function attemptsLeft(result: Pick<AttemptResult, "maxAttempts" | "bonusAttempts" | "attemptsUsed">): number {
  return Math.max(0, result.maxAttempts + result.bonusAttempts - result.attemptsUsed);
}

/** A score as a whole percentage, or null when there is nothing to take a
 *  percentage of. */
export function scorePercent(finalScore: number, maxScore: number): number | null {
  if (!(maxScore > 0)) return null;
  return Math.round((finalScore / maxScore) * 100);
}

/**
 * The sentence under a result's title. What it says depends on who has
 * marked what:
 *   - a teacher still has written answers to mark: the score is so far;
 *   - a teacher has marked them: each answer shows what it earned;
 *   - everything was marked automatically: full marks, or where to look.
 *
 * Never "final", and never "it can only go up": a teacher can change a mark
 * they have given (see the note at the top of this file).
 */
export function resultSentence(result: Pick<AttemptResult, "reviewStatus" | "finalScore" | "maxScore">): string {
  if (result.reviewStatus === "PENDING_REVIEW") {
    return "Your written answers are waiting for your teacher's marks, so this is your score so far.";
  }
  const full = result.maxScore > 0 && result.finalScore === result.maxScore;
  if (full) return "Full marks. Every answer right.";
  if (result.reviewStatus === "FINALISED") {
    return "Your teacher has marked your written answers. Each answer below shows what it earned.";
  }
  return "Look through what you missed below. Each one shows the correct answer.";
}
