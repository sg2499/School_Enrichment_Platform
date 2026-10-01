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
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Hourglass, Lock, PenLine, Save, XCircle } from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { api, apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { BackLink, ReadOnlyBadge, ScoreBadge } from "@/components/tracker/TrackerBits";
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
      className={cn("scroll-mt-24", unmarked && canGrade && "ring-2 ring-inset ring-saffron-200")}
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
      query.setData(data);
      setNotice({
        tone: "success",
        message:
          wasPending && data.evaluation.reviewStatus === "FINALISED"
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

  return (
    <RoleShell role="TEACHER" user={user}>
      <div className="space-y-7">
        <BackLink href={backHref}>{backLabel}</BackLink>

        {query.error ? <AlertBanner tone="error" message={`Couldn't open this attempt (${query.error}).`} /> : null}

        {!review && !query.error ? (
          <div aria-hidden className="space-y-3">
            <span className="block h-4 w-40 animate-pulse rounded-full bg-ink-100" />
            <span className="block h-9 w-80 max-w-full animate-pulse rounded-full bg-ink-100" />
          </div>
        ) : null}

        {review ? (
          <>
            <PageHeader
              eyebrow={`${scopeShort(review.assignment)} · ${review.assignment.title ?? "Practice"}`}
              title={
                <>
                  {review.student.studentName ?? review.student.studentCode}
                  <span className="text-content-subtle"> &middot; Attempt {review.attempt.attemptNumber}</span>
                </>
              }
              description={[
                `${review.student.studentCode} · Class ${studentClassLabel(review.student.className, review.student.section)}`,
                review.attempt.submittedAt ? `Submitted ${formatDateTime(review.attempt.submittedAt)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              meta={
                <>
                  <ScoreBadge evaluation={review.evaluation} />
                  {review.evaluation.reviewStatus === "FINALISED" ? <Badge tone="brand">Marked By Teacher</Badge> : null}
                  {review.evaluation.reviewStatus === "AUTO_FINALISED" ? <Badge tone="neutral">Marked Automatically</Badge> : null}
                  {!review.canGrade ? <ReadOnlyBadge /> : null}
                </>
              }
            />

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

              <aside className="space-y-4 xl:sticky xl:top-6" aria-label="Score and marking">
                <Card tone={pending ? "accent" : "default"}>
                  <CardBody className="space-y-4 sm:p-6">
                    <div>
                      <p className="text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-subtle">
                        {pending ? "Score So Far" : "Final Score"}
                      </p>
                      <p className="mt-1 font-display text-display-md text-content tabular">
                        {dirty ? draftFinal : review.evaluation.finalScore}
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
                      <ul className="space-y-1.5">
                        {review.target.attempts.map((attempt) => {
                          const current = attempt.id === review.attempt.id;
                          return (
                            <li key={attempt.id} className="flex items-center justify-between gap-3">
                              {attempt.evaluation && !current ? (
                                <Link
                                  href={`/teacher/tracker/attempts/${attempt.id}${fromReview ? "?from=review" : ""}`}
                                  className="text-sm font-semibold text-content-brand hover:text-brand-900"
                                >
                                  Attempt {attempt.attemptNumber}
                                </Link>
                              ) : (
                                <span className={cn("text-sm", current ? "font-semibold text-content" : "text-content-muted")}>
                                  Attempt {attempt.attemptNumber}
                                  {current ? " (This One)" : attempt.status === "IN_PROGRESS" ? " · In Progress" : ""}
                                </span>
                              )}
                              <ScoreBadge evaluation={attempt.evaluation} />
                            </li>
                          );
                        })}
                      </ul>
                    </CardBody>
                  </Card>
                ) : null}

                <Link
                  href={`/teacher/tracker/students/${review.student.studentId}`}
                  className="block rounded-2xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-content-brand transition hover:border-brand-300 hover:bg-surface-brand"
                >
                  View Practice History
                  <span className="sr-only"> for {review.student.studentName ?? review.student.studentCode}</span>
                </Link>
              </aside>
            </div>

            {/* Below xl the score panel sits after every answer, a long
                scroll away on a phone. While marks are unsaved, a slim bar
                pinned to the bottom keeps the running score and Save in
                reach. (xl has the sticky side panel instead.) */}
            {review.canGrade && dirty ? (
              <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 shadow-panel backdrop-blur xl:hidden">
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
