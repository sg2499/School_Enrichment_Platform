"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  RotateCcw,
  Send,
  XCircle,
} from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { api, apiErrorMessage } from "@/lib/api";
import { ACTIVITY_TYPE_LABEL } from "@/types/learning";
import type { AttemptDetail, AttemptQuestion, AttemptResult } from "@/types/learning";

const OPTION_LETTERS: string[] = ["A", "B", "C", "D"];

type QuestionOption = { letter: string; text: string };

function questionOptions(question: AttemptQuestion): QuestionOption[] {
  const options: QuestionOption[] = [];
  const byLetter: Record<string, string | null> = {
    A: question.optionA,
    B: question.optionB,
    C: question.optionC,
    D: question.optionD,
  };
  for (const letter of OPTION_LETTERS) {
    const text = byLetter[letter];
    if (text) options.push({ letter, text });
  }
  return options;
}

/** One question's answer control, shaped to what learning_service.grade_answer
 * actually parses (see backend/app/services/learning_service.py):
 * - Single Select: the chosen option letter, verbatim.
 * - Multi Select: chosen letters, comma-joined -- compared as a set, so
 *   order doesn't matter.
 * - Numeric/Text Entry: raw text, compared normalized (case/whitespace/
 *   comma-insensitive). This deliberately renders as ONE field even though
 *   the backend can compare a ";"-joined multi-blank answer -- Chapter 1's
 *   real content is overwhelmingly single-value, and a true multi-blank
 *   editor is tracked as a follow-up, not silently assumed unnecessary.
 * - Ordering: reordered via the up/down controls below, sent as the chosen
 *   sequence of option letters joined by ";". This is a best-effort shape
 *   (the exact real-content convention for Ordering answers wasn't
 *   available to verify against) -- questions with no lettered options fall
 *   back to a free-text sequence field instead.
 * - Anything else (Constructed Response, unrecognised types): a plain
 *   textarea. It still saves and submits, but grade_answer deliberately
 *   returns "not auto-graded" for it -- the result view marks these
 *   "Awaiting Teacher Review" rather than right/wrong.
 */
function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: AttemptQuestion;
  value: string;
  onChange: (next: string) => void;
}) {
  const options = questionOptions(question);

  if (question.questionType === "Single Select" && options.length > 0) {
    return (
      <div className="space-y-2">
        {options.map((option) => (
          <label
            key={option.letter}
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
              value === option.letter ? "border-brand-400 bg-surface-brand" : "border-line-strong hover:border-brand-200"
            }`}
          >
            <input
              type="radio"
              name={question.id}
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
              checked={value === option.letter}
              onChange={() => onChange(option.letter)}
            />
            <span className="min-w-0">
              <span className="mr-1.5 font-semibold text-content-subtle">{option.letter}.</span>
              {option.text}
            </span>
          </label>
        ))}
      </div>
    );
  }

  if (question.questionType === "Multi Select" && options.length > 0) {
    const selected = new Set(value.split(",").map((v) => v.trim().toUpperCase()).filter(Boolean));
    return (
      <div className="space-y-2">
        {options.map((option) => (
          <label
            key={option.letter}
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
              selected.has(option.letter) ? "border-brand-400 bg-surface-brand" : "border-line-strong hover:border-brand-200"
            }`}
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
              checked={selected.has(option.letter)}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(option.letter);
                else next.delete(option.letter);
                onChange(Array.from(next).sort().join(","));
              }}
            />
            <span className="min-w-0">
              <span className="mr-1.5 font-semibold text-content-subtle">{option.letter}.</span>
              {option.text}
            </span>
          </label>
        ))}
      </div>
    );
  }

  if (question.questionType === "Ordering" && options.length > 0) {
    const order = value ? value.split(";").map((v) => v.trim().toUpperCase()).filter(Boolean) : options.map((o) => o.letter);
    const ordered = order.map((letter) => options.find((o) => o.letter === letter)).filter((o): o is { letter: string; text: string } => Boolean(o));
    const missing = options.filter((o) => !order.includes(o.letter));
    const items = [...ordered, ...missing];

    function move(index: number, direction: -1 | 1) {
      const next = [...items.map((i) => i.letter)];
      const target = index + direction;
      if (target < 0 || target >= next.length) return;
      [next[index], next[target]] = [next[target]!, next[index]!];
      onChange(next.join(";"));
    }

    return (
      <div className="space-y-2">
        <p className="text-xs text-content-subtle">Put these in the right order, top to bottom.</p>
        {items.map((option, index) => (
          <div key={option.letter} className="flex items-center gap-3 rounded-2xl border border-line-strong px-4 py-3 text-sm">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface-brand text-xs font-bold text-content-brand">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">{option.text}</span>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label="Move up"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-line-strong text-content-muted transition hover:border-brand-300 hover:text-content-brand disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronUp className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === items.length - 1}
                aria-label="Move down"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-line-strong text-content-muted transition hover:border-brand-300 hover:text-content-brand disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (question.questionType === "Numeric Entry") {
    return (
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Type your answer"
        className="h-12 w-full max-w-xs rounded-2xl border border-line-strong bg-surface px-4 text-base text-content shadow-xs outline-none transition focus:border-brand-400 focus:shadow-focus-field"
      />
    );
  }

  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={question.questionType === "Constructed Response" ? 5 : 2}
      placeholder="Type your answer"
      className="w-full rounded-2xl border border-line-strong bg-surface px-4 py-3 text-base text-content shadow-xs outline-none transition focus:border-brand-400 focus:shadow-focus-field"
    />
  );
}

type Phase = "loading" | "answering" | "submitting" | "result" | "blocked";

export default function StudentAttemptPage() {
  const params = useParams<{ assignmentTargetId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, status } = useProtectedPage("STUDENT");

  const [phase, setPhase] = useState<Phase>("loading");
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const startedRef = useRef(false);

  const viewOnlyAttemptId = searchParams.get("view") === "result" ? searchParams.get("attemptId") : null;

  const loadResult = useCallback(async (attemptId: string) => {
    setPhase("loading");
    try {
      const { data } = await api.get<AttemptResult>(`/learning/attempts/${attemptId}/result`);
      setResult(data);
      setPhase("result");
    } catch (err) {
      setBlockedMessage(apiErrorMessage(err));
      setPhase("blocked");
    }
  }, []);

  const startOrResume = useCallback(async () => {
    setPhase("loading");
    setBlockedMessage(null);
    try {
      const { data } = await api.post<AttemptDetail>("/learning/attempts", {
        assignmentTargetId: params.assignmentTargetId,
      });
      setAttempt(data);
      setAnswers({});
      setPhase("answering");
    } catch (err) {
      setBlockedMessage(apiErrorMessage(err));
      setPhase("blocked");
    }
  }, [params.assignmentTargetId]);

  useEffect(() => {
    if (status !== "ready" || startedRef.current) return;
    startedRef.current = true;
    if (viewOnlyAttemptId) {
      loadResult(viewOnlyAttemptId);
    } else {
      startOrResume();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const totalQuestions = attempt?.questions.length ?? 0;
  const answeredCount = useMemo(
    () => Object.values(answers).filter((v) => v && v.trim().length > 0).length,
    [answers],
  );

  async function handleAnswerChange(question: AttemptQuestion, value: string) {
    setAnswers((prev) => ({ ...prev, [question.id]: value }));
    if (!attempt) return;
    setSavingIds((prev) => new Set(prev).add(question.id));
    try {
      await api.put(`/learning/attempts/${attempt.id}/answers`, { questionId: question.id, responseText: value });
    } catch {
      // Best-effort autosave -- submit re-sends nothing itself (the backend
      // grades whatever was last saved per question), so a transient save
      // failure here just means that one answer may need re-entering before
      // submit; not worth interrupting the student mid-attempt over.
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(question.id);
        return next;
      });
    }
  }

  async function handleSubmit() {
    if (!attempt) return;
    setPhase("submitting");
    try {
      await api.post(`/learning/attempts/${attempt.id}/submit`);
      const { data } = await api.get<AttemptResult>(`/learning/attempts/${attempt.id}/result`);
      setResult(data);
      setPhase("result");
    } catch (err) {
      setBlockedMessage(apiErrorMessage(err));
      setPhase("blocked");
    }
  }

  if (status !== "ready") {
    return <LoadingScreen />;
  }

  return (
    <RoleShell role="STUDENT" user={user}>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Today's Practice"
          title={attempt?.activity.title ?? (result ? "Your Result" : "Practice")}
          description={attempt ? ACTIVITY_TYPE_LABEL[attempt.activity.activityType] : undefined}
          actions={
            <Link href="/student/practice">
              <Button variant="secondary" size="sm" leadingIcon={<ArrowLeft className="h-4 w-4" />}>
                Back to List
              </Button>
            </Link>
          }
        />

        {phase === "loading" ? (
          <Card>
            <CardBody className="flex items-center gap-3 text-sm text-content-muted">
              <Clock className="h-4 w-4 animate-pulse" aria-hidden />
              Loading…
            </CardBody>
          </Card>
        ) : null}

        {phase === "blocked" ? (
          <Card>
            <CardBody className="space-y-4">
              <div role="alert" className="flex items-start gap-3 rounded-2xl border border-coral-200 bg-coral-50 p-4">
                <AlertCircle className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-coral-600" aria-hidden />
                <p className="text-[0.875rem] font-medium leading-[1.55] text-coral-800">{blockedMessage}</p>
              </div>
              <Link href="/student/practice">
                <Button variant="secondary" leadingIcon={<ArrowLeft className="h-4 w-4" />}>
                  Back to Today&apos;s Practice
                </Button>
              </Link>
            </CardBody>
          </Card>
        ) : null}

        {phase === "answering" || phase === "submitting" ? (
          <>
            <Card>
              <CardBody className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-content-muted">
                  {answeredCount} of {totalQuestions} answered
                </p>
                <div className="h-2 w-40 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className="h-full rounded-full bg-brand-gradient transition-all duration-300"
                    style={{ width: `${totalQuestions ? (answeredCount / totalQuestions) * 100 : 0}%` }}
                  />
                </div>
              </CardBody>
            </Card>

            <div className="space-y-4">
              {attempt?.questions.map((question, index) => (
                <Card key={question.id}>
                  <CardBody className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-eyebrow text-content-subtle">
                        Question {index + 1} of {totalQuestions} &middot; {question.marks} mark{question.marks === 1 ? "" : "s"}
                      </p>
                      {savingIds.has(question.id) ? <span className="text-xs text-content-faint">Saving…</span> : null}
                    </div>
                    <p className="text-[0.9375rem] font-medium leading-relaxed text-content">{question.stem}</p>
                    <QuestionInput
                      question={question}
                      value={answers[question.id] ?? ""}
                      onChange={(value) => handleAnswerChange(question, value)}
                    />
                  </CardBody>
                </Card>
              ))}
            </div>

            <Card tone="brand">
              <CardBody className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                <p className="text-sm text-content-muted">
                  Once you submit, you can&apos;t change your answers for this attempt.
                </p>
                <Button variant="primary" leadingIcon={<Send className="h-4 w-4" />} loading={phase === "submitting"} onClick={handleSubmit}>
                  Submit Practice
                </Button>
              </CardBody>
            </Card>
          </>
        ) : null}

        {phase === "result" && result ? (
          <>
            <Card tone={result.reviewStatus === "PENDING_REVIEW" ? "accent" : "inverse"}>
              <CardBody className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-eyebrow text-content-inverse/70">Your Score</p>
                  <p className="mt-1 font-display text-display-md text-content-inverse">
                    {result.finalScore} / {result.maxScore}
                  </p>
                </div>
                {result.reviewStatus === "PENDING_REVIEW" ? (
                  <Badge tone="warning">Awaiting Teacher Review</Badge>
                ) : (
                  <Badge tone="inverse" dot>
                    Auto-Scored
                  </Badge>
                )}
              </CardBody>
            </Card>

            <div className="space-y-4">
              {result.answers.map((answer, index) => (
                <Card key={answer.questionId}>
                  <CardBody className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-eyebrow text-content-subtle">Question {index + 1}</p>
                      {answer.isCorrect === true ? (
                        <Badge tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>
                          Correct
                        </Badge>
                      ) : answer.isCorrect === false ? (
                        <Badge tone="danger" icon={<XCircle className="h-3 w-3" />}>
                          Incorrect
                        </Badge>
                      ) : (
                        <Badge tone="neutral">Pending Review</Badge>
                      )}
                    </div>
                    <p className="text-[0.9375rem] font-medium leading-relaxed text-content">{answer.stem}</p>
                    <p className="text-sm text-content-muted">
                      <span className="font-semibold text-content-subtle">Your answer: </span>
                      {answer.responseText || <span className="italic text-content-faint">Not answered</span>}
                    </p>
                    {answer.isCorrect === false ? (
                      <p className="text-sm text-content-muted">
                        <span className="font-semibold text-content-subtle">Correct answer: </span>
                        {answer.correctAnswer}
                      </p>
                    ) : null}
                    {answer.explanation ? (
                      <p className="rounded-2xl bg-surface-brand p-3 text-sm leading-relaxed text-content-muted">
                        <span className="font-semibold text-content-subtle">Explanation: </span>
                        {answer.explanation}
                      </p>
                    ) : null}
                  </CardBody>
                </Card>
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              <Link href="/student/practice">
                <Button variant="secondary" leadingIcon={<ArrowLeft className="h-4 w-4" />}>
                  Back to Today&apos;s Practice
                </Button>
              </Link>
              <Button
                variant="primary"
                leadingIcon={<RotateCcw className="h-4 w-4" />}
                onClick={() => {
                  router.replace(`/student/practice/${params.assignmentTargetId}`);
                  startedRef.current = false;
                  startOrResume();
                }}
              >
                Try Again
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </RoleShell>
  );
}
