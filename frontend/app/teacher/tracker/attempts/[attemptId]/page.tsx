"use client";

/**
 * One submitted attempt, full screen: review every answer, and mark the ones
 * auto-marking couldn't (1 Oct 2026 -- manual grading for PENDING_REVIEW
 * attempts, which until now had no endpoint and no UI at all).
 *
 * Left: each question with the student's answer beside the expected one,
 * any marking guidance from the question bank (Question.teacher_note), and
 * -- for a written answer -- a marks picker from 0 to that question's own
 * marks. Right, sticky: the score as it stands (automatic + teacher marks),
 * how many answers are still unmarked, and Save Marks.
 *
 * Marks can be saved a few at a time; the attempt is final once its last
 * written answer has a mark, and a saved mark can still be corrected later
 * (each save is audit-logged server-side). A teacher who has handed the
 * section over sees everything read-only -- the server refuses their marks
 * too (routes_practice_tracker.submit_manual_grades).
 *
 * UI revamp, Phase A (2 Oct 2026): back link and header metadata brought up
 * to the new shared standard (InlineLink, PageHeader `facts`), the headline
 * score counts, the rail's two text-only links became real controls, and a
 * save that finalises the attempt leaves a note for the assignment page's
 * achievement spark (recordAttemptFinalised, in saveMarks below).
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, ChevronRight, Clock3, Hourglass, IdCard, Lock, PenLine, Save, Users, XCircle } from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { recordAttemptFinalised } from "@/lib/hooks/useMarkingMilestone";
import { api, apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader, type PageHeaderFact } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { CountUp } from "@/components/ui/CountUp";
import { InlineLink } from "@/components/ui/InlineLink";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { ReadOnlyBadge, ScoreBadge, TeacherAmbience } from "@/components/tracker/TrackerBits";
import { formatDateTime, plural, scopeShort, studentClassLabel } from "@/lib/tracker";
import type { AttemptReview, Paginated, ReviewAnswer, ReviewQueueRow } from "@/types/tracker";

type Drafts = Record<string, number | null>;

function savedMarks(review: AttemptReview): Drafts {
  const marks: Drafts = {};
  for (const answer of review.answers) if (answer.needsManualGrade) marks[answer.questionId] = answer.manualScore;
  return marks;
}

/** Single/Multi Select answers are stored as option letters ("B", "A,C"). */
function chosenLetters(answer: ReviewAnswer): Set<string> {
  if (!answer.questionType.toLowerCase().includes("select")) return new Set();
  return new Set((answer.responseText ?? "").split(",").map((p) => p.trim().toUpperCase()).filter(Boolean));
}

function correctLetters(answer: ReviewAnswer): Set<string> {
  if (!answer.questionType.toLowerCase().includes("select")) return new Set();
  return new Set(answer.correctAnswer.split(",").map((p) => p.trim().toUpperCase()).filter(Boolean));
}

function AnswerState({ answer, draft }: { answer: ReviewAnswer; draft: number | null | undefined }) {
  if (answer.needsManualGrade) {
    if (answer.manualScore === null || answer.manualScore === undefined) {
      return (
        <Badge tone="warning" icon={<Hourglass className="h-3 w-3" />}>
          Needs Your Mark
        </Badge>
      );
    }
    return (
      <Badge tone="brand" icon={<PenLine className="h-3 w-3" />}>
        Marked {answer.manualScore}/{answer.maxScore}
        {draft !== answer.manualScore ? " · Edited" : ""}
      </Badge>
    );
  }
  if (answer.isCorrect) {
    return (
      <Badge tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>
        Correct
      </Badge>
    );
  }
  return (
    <Badge tone="danger" icon={<XCircle className="h-3 w-3" />}>
      Incorrect
    </Badge>
  );
}

/**
 * The marks picker. A row of buttons 0..max when the question is worth a
 * handful of marks (every real question today is), a number box beyond
 * ten. One click per answer, no typing, and the choice is visible at a
 * glance down the page. Buttons are aria-pressed in a labelled group.
 */
function MarksPicker({
  answer,
  index,
  value,
  disabled,
  onChange,
}: {
  answer: ReviewAnswer;
  index: number;
  value: number | null;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  const label = `Marks for question ${index + 1}, out of ${answer.maxScore}`;
  if (answer.maxScore > 10) {
    return (
      <label className="flex items-center gap-2 text-sm font-semibold text-content">
        Marks
        <input
          type="number"
          min={0}
          max={answer.maxScore}
          step={1}
          value={value ?? ""}
          disabled={disabled}
          aria-label={label}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === "") return onChange(null);
            const n = Math.round(Number(raw));
            onChange(Number.isFinite(n) ? Math.min(Math.max(n, 0), answer.maxScore) : null);
          }}
          className="h-10 w-20 rounded-xl border border-line-strong bg-surface px-3 text-base tabular text-content shadow-xs outline-none focus:border-brand-400 focus:shadow-focus disabled:opacity-60"
        />
        <span className="font-medium text-content-subtle">out of {answer.maxScore}</span>
      </label>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm font-semibold text-content" aria-hidden>
        Marks
      </span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        {Array.from({ length: answer.maxScore + 1 }, (_, mark) => {
          const pressed = value === mark;
          return (
            <button
              key={mark}
              type="button"
              aria-pressed={pressed}
              disabled={disabled}
              onClick={() => onChange(mark)}
              className={cn(
                "inline-flex h-10 min-w-[2.5rem] items-center justify-center rounded-xl px-3 text-sm font-bold tabular transition duration-200 ease-spring disabled:cursor-not-allowed disabled:opacity-60",
                pressed
                  ? "bg-brand-gradient text-content-inverse shadow-brand"
                  : "border border-line-strong bg-surface text-content-muted hover:border-brand-300 hover:text-content-brand",
              )}
            >
              {mark}
            </button>
          );
        })}
      </div>
      <span className="text-sm font-medium text-content-subtle">out of {answer.maxScore}</span>
    </div>
  );
}

// The first few answers arrive in sequence behind the header, the way the
// student page's history cards do; from the fifth on they share the last
// step, so a 20-question attempt never keeps a teacher waiting on a cascade.
const ANSWER_STAGGER = ["delay-70", "delay-140", "delay-210", "delay-280"];

function AnswerCard({
  answer,
  index,
  draft,
  canGrade,
  onDraft,
}: {
  answer: ReviewAnswer;
  index: number;
  draft: number | null | undefined;
  canGrade: boolean;
  onDraft: (value: number | null) => void;
}) {
  const chosen = chosenLetters(answer);
  const correct = correctLetters(answer);
  const optionEntries = Object.entries(answer.options) as [string, string][];
  const unmarked = answer.needsManualGrade && answer.manualScore === null;

  return (
    <Card
      as="li"
      id={`q-${index + 1}`}
      className={cn(
        "scroll-mt-24 animate-fade-up",
        ANSWER_STAGGER[Math.min(index, ANSWER_STAGGER.length - 1)],
        unmarked && canGrade && "ring-2 ring-inset ring-saffron-200",
      )}
    >
      {/* Edge rail: decoration only -- the badge names the state. */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          answer.needsManualGrade ? (unmarked ? "bg-saffron-300" : "bg-brand-400") : answer.isCorrect ? "bg-jade-400" : "bg-coral-400",
        )}
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-eyebrow text-content-subtle">Question {index + 1}</p>
            <Badge tone="neutral">{answer.questionType}</Badge>
            <span className="text-xs text-content-subtle tabular">{plural(answer.maxScore, "mark")}</span>
          </div>
          <AnswerState answer={answer} draft={draft} />
        </div>

        <p className="text-[0.9375rem] font-medium leading-relaxed text-content text-pretty">{answer.stem}</p>

        {optionEntries.length > 0 ? (
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {optionEntries.map(([letter, text]) => {
              const isChosen = chosen.has(letter);
              const isCorrect = correct.has(letter);
              return (
                <li
                  key={letter}
                  className={cn(
                    "flex items-start gap-2.5 rounded-xl px-3 py-2 text-sm",
                    isCorrect ? "bg-jade-50 text-content ring-1 ring-inset ring-jade-200" : isChosen ? "bg-coral-50 ring-1 ring-inset ring-coral-200" : "bg-surface-muted text-content-muted",
                  )}
                >
                  <span className={cn("w-4 shrink-0 font-semibold", isCorrect ? "text-jade-700" : isChosen ? "text-coral-700" : "text-content-subtle")}>
                    {letter}
                  </span>
                  <span className="min-w-0 flex-1">{text}</span>
                  {isChosen ? (
                    <span className="shrink-0 text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-subtle">Chosen</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {/* For a select question the option list above already shows what
            was chosen and what was right; the answer panels would only
            repeat the letters, so they're left out. */}
        {optionEntries.length > 0 && chosen.size + correct.size > 0 ? null : (
        <div className="grid gap-2 lg:grid-cols-2">
          {/* Labels content-subtle on surface-muted 6.0:1; answer text content 16:1. */}
          <div className="rounded-2xl border border-line bg-surface-muted px-3.5 py-3">
            <p className="text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-subtle">Student&rsquo;s Answer</p>
            <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-content">
              {answer.responseText || <span className="font-normal italic text-content-subtle">Not answered</span>}
            </p>
          </div>
          <div className="rounded-2xl border border-jade-200 bg-jade-50 px-3.5 py-3">
            {/* jade-800 on jade-50: 8.9:1. */}
            <p className="text-[0.6875rem] font-bold uppercase tracking-eyebrow text-jade-800">
              {answer.needsManualGrade ? "Model Answer" : "Correct Answer"}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-jade-800">{answer.correctAnswer}</p>
          </div>
        </div>
        )}
        {optionEntries.length > 0 && chosen.size === 0 ? (
          <p className="text-sm italic text-content-subtle">Not answered</p>
        ) : null}

        {answer.teacherNote ? (
          <p className="rounded-2xl bg-surface-accent px-3.5 py-3 text-sm leading-relaxed text-content-muted ring-1 ring-inset ring-saffron-200">
            <span className="font-semibold text-saffron-900">Marking Guidance: </span>
            {answer.teacherNote}
          </p>
        ) : null}
        {answer.explanation ? (
          <p className="rounded-2xl bg-surface-brand px-3.5 py-3 text-sm leading-relaxed text-content-muted">
            <span className="font-semibold text-content-brand">Why: </span>
            {answer.explanation}
          </p>
        ) : null}

        {answer.needsManualGrade ? (
          <div className="space-y-2 border-t border-line pt-4">
            <MarksPicker answer={answer} index={index} value={draft ?? null} disabled={!canGrade} onChange={onDraft} />
            {answer.gradedByName ? (
              <p className="text-xs text-content-subtle">
                Marked by {answer.gradedByName}
                {answer.gradedAt ? ` · ${formatDateTime(answer.gradedAt)}` : ""}
              </p>
            ) : !answer.responseText ? (
              <p className="text-xs text-content-subtle">Not answered &mdash; award 0 to finish marking this attempt.</p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-content-subtle tabular">
            {answer.autoScore ?? 0} / {answer.maxScore} &middot; Marked Automatically
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function ScoreRow({ label, value, strong = false }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-2", strong && "border-t border-line pt-3")}>
      <dt className={cn("text-[0.8125rem]", strong ? "font-semibold text-content" : "text-content-subtle")}>{label}</dt>
      <dd className={cn("tabular", strong ? "font-display text-display-sm text-content" : "text-sm font-semibold text-content")}>{value}</dd>
    </div>
  );
}

function AttemptWorkspace() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const searchParams = useSearchParams();
  const fromReview = searchParams.get("from") === "review";
  const router = useRouter();
  const { user, status } = useProtectedPage("TEACHER");
  const ready = status === "ready";

  const query = useApiQuery<AttemptReview>(`/learning/tracker/attempts/${attemptId}`, {}, ready);
  const review = query.data;

  const [drafts, setDrafts] = useState<Drafts>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  const [findingNext, setFindingNext] = useState(false);

  // Reset drafts to what's saved whenever a (new) review payload arrives.
  useEffect(() => {
    if (review) setDrafts(savedMarks(review));
  }, [review]);

  const saved = useMemo(() => (review ? savedMarks(review) : {}), [review]);
  const changed = Object.keys(drafts).filter((id) => drafts[id] !== null && drafts[id] !== saved[id]);
  const dirty = changed.length > 0;

  // Unsaved marks survive an accidental tab close only if the browser asks.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function saveMarks() {
    if (!review || !dirty) return;
    setSaving(true);
    setNotice(null);
    try {
      const { data } = await api.post<AttemptReview>(`/learning/tracker/attempts/${attemptId}/grades`, {
        grades: changed.map((questionId) => ({ questionId, score: drafts[questionId] })),
      });
      const wasPending = review.evaluation.reviewStatus === "PENDING_REVIEW";
      const justFinalised = wasPending && data.evaluation.reviewStatus === "FINALISED";
      query.setData(data);
      // This save gave the attempt its last outstanding mark. Leave a note
      // so the assignment's page can tell, when the teacher next opens it,
      // whether its To Mark count reached zero by their own hand -- the
      // achievement spark's trigger (2 Oct 2026; lib/hooks/
      // useMarkingMilestone.ts explains why the note is needed at all).
      // Client-side only: nothing is sent anywhere. A later correction to
      // an already-final attempt is not a finalisation and leaves no note.
      if (justFinalised) recordAttemptFinalised(data.assignment.id);
      setNotice({
        tone: "success",
        message: justFinalised
          ? `All answers marked. Final score ${data.evaluation.finalScore} / ${data.evaluation.maxScore}.`
          : `${plural(changed.length, "mark")} saved.`,
      });
    } catch (err) {
      setNotice({ tone: "error", message: apiErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  async function goToNextInQueue() {
    setFindingNext(true);
    try {
      const { data } = await api.get<Paginated<ReviewQueueRow>>("/learning/tracker/review-queue", {
        params: { page: 1, pageSize: 2 },
      });
      const next = data.items.find((row) => row.attemptId !== attemptId);
      if (next) router.push(`/teacher/tracker/attempts/${next.attemptId}?from=review`);
      else setNotice({ tone: "success", message: "That was the last one — nothing else is waiting for your marks." });
    } catch (err) {
      setNotice({ tone: "error", message: apiErrorMessage(err) });
    } finally {
      setFindingNext(false);
    }
  }

  if (!ready) return <LoadingScreen />;

  const manualAnswers = review?.answers.filter((a) => a.needsManualGrade) ?? [];
  const markedCount = manualAnswers.filter((a) => a.manualScore !== null).length;
  const pending = review?.evaluation.reviewStatus === "PENDING_REVIEW";
  const draftTeacherTotal = manualAnswers.reduce((sum, a) => sum + (drafts[a.questionId] ?? 0), 0);
  const draftFinal = review ? review.evaluation.autoScore + draftTeacherTotal : 0;
  const backHref = fromReview
    ? "/teacher/tracker?tab=review"
    : review
      ? `/teacher/tracker/assignments/${review.assignment.id}`
      : "/teacher/tracker";
  const backLabel = fromReview ? "Needs Review" : review?.assignment.title ?? "Practice Tracker";

  // The header's old description ("STU-1042 · Class 5A · Submitted 30 Sept,
  // 10:05 am") as the three facts it was. Submitted is left out when there
  // is no timestamp, as before.
  const submittedAt = review ? formatDateTime(review.attempt.submittedAt) : null;
  const facts: PageHeaderFact[] = review
    ? [
        {
          label: "Student Code",
          value: <span className="font-mono">{review.student.studentCode}</span>,
          icon: <IdCard className="h-3.5 w-3.5" />,
        },
        {
          label: "Class",
          value: studentClassLabel(review.student.className, review.student.section),
          icon: <Users className="h-3.5 w-3.5" />,
        },
        ...(submittedAt ? [{ label: "Submitted", value: submittedAt, icon: <Clock3 className="h-3.5 w-3.5" /> }] : []),
      ]
    : [];

  return (
    <RoleShell role="TEACHER" user={user}>
      <TeacherAmbience />
      {/* space-y-8: the working-page rhythm (Assign, People, Security, Daily
          Practice); dashboards use space-y-10. This family alone was 7.
          `relative` so the page paints above the ambience. */}
      <div className="relative space-y-8">
        {/* Back link and header as one block -- see the assignment page. */}
        <div className="space-y-5">
          <InlineLink href={backHref} direction="back">
            {backLabel}
          </InlineLink>

          {query.error ? <AlertBanner tone="error" message={`Couldn't open this attempt (${query.error}).`} /> : null}

          {!review && !query.error ? (
            <div aria-hidden className="space-y-3">
              <span className="block h-4 w-40 animate-pulse rounded-full bg-ink-100" />
              <span className="block h-9 w-80 max-w-full animate-pulse rounded-full bg-ink-100" />
              <span className="block h-11 w-[30rem] max-w-full animate-pulse rounded-2xl bg-ink-100" />
            </div>
          ) : null}

          {review ? (
            <PageHeader
              eyebrow={`${scopeShort(review.assignment)} · ${review.assignment.title ?? "Practice"}`}
              title={
                <>
                  {review.student.studentName ?? review.student.studentCode}
                  <span className="text-content-subtle"> &middot; Attempt {review.attempt.attemptNumber}</span>
                </>
              }
              facts={facts}
              meta={
                <>
                  <ScoreBadge evaluation={review.evaluation} />
                  {review.evaluation.reviewStatus === "FINALISED" ? <Badge tone="brand">Marked By Teacher</Badge> : null}
                  {review.evaluation.reviewStatus === "AUTO_FINALISED" ? <Badge tone="neutral">Marked Automatically</Badge> : null}
                  {!review.canGrade ? <ReadOnlyBadge /> : null}
                </>
              }
            />
          ) : null}
        </div>

        {review ? (
          <>

            {/* items-start is deliberate here, unlike the dashboards'
                SplitLayout: the right column is a sticky rail (xl:sticky
                below) that follows the teacher down a long answer list. A
                stretched grid item would be as tall as that list, leaving
                sticky no room to move -- so this one keeps its own height.
                Checked in the 1 Oct 2026 polish pass. */}
            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <ol className="space-y-4" aria-label="Answers">
                {review.answers.map((answer, index) => (
                  <AnswerCard
                    key={answer.questionId}
                    answer={answer}
                    index={index}
                    draft={drafts[answer.questionId]}
                    canGrade={review.canGrade}
                    onDraft={(value) => setDrafts((prev) => ({ ...prev, [answer.questionId]: value }))}
                  />
                ))}
              </ol>

              <aside className="space-y-4 animate-fade-up delay-70 xl:sticky xl:top-6" aria-label="Score and marking">
                <Card tone={pending ? "accent" : "default"}>
                  <CardBody className="space-y-4 sm:p-6">
                    <div>
                      <p className="text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-subtle">
                        {pending ? "Score So Far" : "Final Score"}
                      </p>
                      {/* Counts up when the attempt opens, and rolls to the
                          new total each time a mark is picked (from the
                          figure on screen, not from zero) -- so choosing a
                          mark visibly lands in the score. */}
                      <p className="mt-1 font-display text-display-md text-content tabular">
                        <CountUp value={dirty ? draftFinal : review.evaluation.finalScore} />
                        <span className="text-content-subtle"> / {review.evaluation.maxScore}</span>
                      </p>
                      {dirty ? <p className="text-xs font-semibold text-saffron-900">Includes unsaved marks</p> : null}
                    </div>
                    <dl>
                      <ScoreRow label="Marked Automatically" value={review.evaluation.autoScore} />
                      <ScoreRow
                        label="Teacher Marks"
                        value={manualAnswers.length === 0 ? "—" : dirty ? draftTeacherTotal : review.evaluation.teacherScore ?? 0}
                      />
                      {manualAnswers.length > 0 ? (
                        <ScoreRow label="Written Answers Marked" value={`${markedCount} of ${manualAnswers.length}`} />
                      ) : null}
                    </dl>

                    {notice ? <AlertBanner tone={notice.tone} message={notice.message} /> : null}

                    {manualAnswers.length === 0 ? (
                      <p className="text-sm text-content-muted">Every answer in this attempt was marked automatically.</p>
                    ) : review.canGrade ? (
                      <div className="space-y-3">
                        <Button
                          type="button"
                          variant="primary"
                          fullWidth
                          leadingIcon={<Save className="h-4 w-4" />}
                          loading={saving}
                          loadingLabel="Saving"
                          disabled={!dirty}
                          onClick={saveMarks}
                        >
                          {dirty ? `Save ${plural(changed.length, "Mark")}` : "Save Marks"}
                        </Button>
                        <p className="text-xs leading-relaxed text-content-subtle">
                          {pending
                            ? "You can save part of the marking now and finish later. The score is final once every written answer has a mark."
                            : "Marks can still be corrected; every change is recorded."}
                        </p>
                        {fromReview && !pending && !dirty ? (
                          <Button
                            type="button"
                            variant="accent"
                            fullWidth
                            trailingIcon={<ArrowRight className="h-4 w-4" />}
                            loading={findingNext}
                            loadingLabel="Finding next"
                            onClick={goToNextInQueue}
                          >
                            Mark Next Attempt
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <p className="flex items-start gap-2 text-sm leading-relaxed text-content-muted">
                        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-content-subtle" aria-hidden />
                        This section has been handed over, so marks here are now given by its current teacher.
                      </p>
                    )}
                    {review.evaluation.finalisedByName && review.evaluation.reviewStatus === "FINALISED" ? (
                      <p className="text-xs text-content-subtle">
                        Finalised by {review.evaluation.finalisedByName}
                        {review.evaluation.finalisedAt ? ` · ${formatDateTime(review.evaluation.finalisedAt)}` : ""}
                      </p>
                    ) : null}
                  </CardBody>
                </Card>

                {review.target.attempts.length > 1 ? (
                  <Card>
                    <CardBody className="space-y-3 sm:p-6">
                      <p className="text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-subtle">All Attempts</p>
                      {/* Rows, not a list of blue words. An attempt you can
                          open used to be bare brand-coloured text beside
                          its score, indistinguishable from a label until
                          hovered; now the whole row is the link, with a
                          border, a hover fill and a chevron. The row shape
                          is the one Assign Practice uses for Your Sections
                          (selected = brand border on surface-brand), so
                          "the one you are on" looks the same in both. */}
                      <ul className="space-y-2">
                        {review.target.attempts.map((attempt) => {
                          const current = attempt.id === review.attempt.id;
                          const row = "flex items-center justify-between gap-3 rounded-2xl border px-3 py-2";
                          return (
                            <li key={attempt.id}>
                              {attempt.evaluation && !current ? (
                                <Link
                                  href={`/teacher/tracker/attempts/${attempt.id}${fromReview ? "?from=review" : ""}`}
                                  className={cn(
                                    row,
                                    "group border-line bg-surface transition duration-200 ease-spring hover:border-brand-300 hover:bg-surface-brand",
                                  )}
                                >
                                  {/* brand-700 on white 10.3:1, on surface-brand 9.3:1. */}
                                  <span className="text-sm font-semibold text-content-brand">Attempt {attempt.attemptNumber}</span>
                                  <span className="flex items-center gap-1.5">
                                    <ScoreBadge evaluation={attempt.evaluation} />
                                    <ChevronRight
                                      aria-hidden
                                      className="h-4 w-4 text-content-faint transition-transform duration-200 ease-spring group-hover:translate-x-0.5 group-hover:text-content-brand"
                                    />
                                  </span>
                                </Link>
                              ) : (
                                <div className={cn(row, current ? "border-brand-200 bg-surface-brand" : "border-line bg-surface-muted")}>
                                  {/* content on surface-brand 15.3:1; content-muted on surface-muted 8.1:1. */}
                                  <span className={cn("text-sm", current ? "font-semibold text-content" : "text-content-muted")}>
                                    Attempt {attempt.attemptNumber}
                                    {current ? " (This One)" : attempt.status === "IN_PROGRESS" ? " · In Progress" : ""}
                                  </span>
                                  <ScoreBadge evaluation={attempt.evaluation} />
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </CardBody>
                  </Card>
                ) : null}

                {/* Was a hand-rolled bordered block of brand text with no
                    arrow -- this page's third home-made link style, after
                    the bare back link and the bare attempt links. It is the
                    rail's one standalone navigation, so it is a tinted
                    ButtonLink like every other "only action". */}
                <ButtonLink
                  href={`/teacher/tracker/students/${review.student.studentId}`}
                  variant="tinted"
                  fullWidth
                  trailingIcon={<ArrowRight className="h-4 w-4" />}
                >
                  View Practice History
                  <span className="sr-only"> for {review.student.studentName ?? review.student.studentCode}</span>
                </ButtonLink>
              </aside>
            </div>

            {/* Below xl the score panel sits after every answer, a long
                scroll away on a phone. While marks are unsaved, a slim bar
                pinned to the bottom keeps the running score and Save in
                reach. (xl has the sticky side panel instead.) */}
            {review.canGrade && dirty ? (
              // fade-up: it rises from the edge it is pinned to, on the
              // first mark picked, rather than snapping into place.
              <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 shadow-panel backdrop-blur animate-fade-up xl:hidden">
                <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
                  <p className="text-sm text-content-muted">
                    <span className="font-display text-lg font-semibold text-content tabular">
                      {draftFinal} / {review.evaluation.maxScore}
                    </span>{" "}
                    with unsaved marks
                  </p>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    leadingIcon={<Save className="h-4 w-4" />}
                    loading={saving}
                    loadingLabel="Saving"
                    onClick={saveMarks}
                  >
                    {`Save ${plural(changed.length, "Mark")}`}
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {review?.canGrade && dirty ? <div aria-hidden className="h-20 xl:hidden" /> : null}
    </RoleShell>
  );
}

export default function TrackerAttemptPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <AttemptWorkspace />
    </Suspense>
  );
}
