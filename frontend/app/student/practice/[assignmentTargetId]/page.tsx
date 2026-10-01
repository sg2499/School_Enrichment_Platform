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
  Hourglass,
  Loader2,
  RotateCcw,
  Send,
  XCircle,
} from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardIcon, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { api, apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ACTIVITY_TYPE_LABEL } from "@/types/learning";
import type { AttemptDetail, AttemptQuestion, AttemptResult } from "@/types/learning";

/*
 * Taking a practice set, and reading its result -- Phase 2b/c visual pass
 * (30 Sep 2026).
 *
 * Presentation only. The attempt lifecycle (start/resume, debounced and
 * serialised autosave, flush-then-submit, view-only result) and every
 * handler are untouched. What changed:
 *  - Loading is a skeleton of the real layout, not the word "Loading".
 *  - The answered-count strip sticks under the top of the screen, and is a
 *    real progressbar to assistive tech.
 *  - Options have a clear chosen state (border, fill *and* a filled letter
 *    chip -- never colour alone) and a visible keyboard focus ring.
 *  - The result leads with the score as a ring plus a right/wrong/awaiting
 *    tally, and each answer card is marked by icon and words, not colour.
 *  - Fixed: a result awaiting teacher review sat on the light saffron card
 *    tone but kept the dark card's white text -- the score was white on
 *    #FFF9EC, effectively invisible (1.05:1).
 *
 * Correctness follow-up, same day -- no longer presentation only:
 *  - Resuming an attempt shows the answers already saved (POST /attempts
 *    now returns each question's responseText); it used to open blank.
 *  - "Try Again" is offered only while attempts remain (GET .../result now
 *    returns maxAttempts, bonusAttempts and attemptsUsed).
 *  - Navigation actions are links styled as buttons, not <Button> inside
 *    <Link>.
 */

const STAGGER = ["delay-70", "delay-140", "delay-210", "delay-280", "delay-350", "delay-420"];

/** A chosen option: brand-400 border (3.7:1 on white, past 1.4.11's 3:1),
 *  brand fill, and the letter chip turns solid -- three cues, so "which
 *  one did I pick" never rests on colour alone. focus-within draws the
 *  keyboard ring round the whole row, not just the tiny native control. */
function optionRowClass(selected: boolean): string {
  return cn(
    "group/option flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 text-sm leading-relaxed text-content transition duration-200 ease-spring",
    "focus-within:shadow-focus",
    selected
      ? "border-brand-400 bg-surface-brand shadow-xs"
      : "border-line-strong bg-surface hover:border-brand-200 hover:bg-surface-brand/50",
  );
}

/** Option letter. Chosen: white on brand-700 10.3:1; otherwise brand-700 on
 *  brand-50 9.3:1. */
function OptionLetter({ letter, selected }: { letter: string; selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold transition-colors duration-200",
        selected ? "bg-brand-700 text-white" : "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100",
      )}
    >
      {letter}
    </span>
  );
}

/** Placeholder bar for the loading skeleton. Pulse stops under
 *  prefers-reduced-motion (globals.css). */
function SkeletonLine({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block animate-pulse rounded-full bg-ink-100", className)} />;
}

/**
 * A navigation action that looks like a Button but *is* a link (30 Sep 2026).
 *
 * This page's "Back" actions used to wrap <Button> in <Link> -- one
 * interactive element nested in another (invalid HTML, and two tab stops
 * for one action). Same fix, same reasoning, as the student dashboard's
 * HeroAction and /student/practice's LinkAction. Class strings copy
 * components/ui/Button's BASE, VARIANTS.primary / VARIANTS.secondary,
 * SIZES.sm / SIZES.md and HAS_SHEEN verbatim, including the hover/press
 * wash and the primary sheen layer (Button doesn't export them -- keep in
 * step). Only BASE's disabled: and aria-busy classes are left out: a link
 * has no disabled or loading state. Focus is Button's own shadow-focus
 * ring. `sm` is here for the header's "Back to List", which was
 * size="sm".
 */
function LinkAction({
  href,
  variant,
  size = "md",
  icon,
  className,
  children,
}: {
  href: string;
  variant: "primary" | "secondary";
  size?: "sm" | "md";
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group relative inline-flex select-none items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-full font-semibold",
        "transition duration-200 ease-spring focus-visible:outline-none focus-visible:ring-0 active:duration-75",
        variant === "primary"
          ? "bg-brand-gradient text-content-inverse shadow-brand hover:-translate-y-0.5 hover:shadow-card-hover active:translate-y-0 active:scale-[0.985] active:shadow-brand focus-visible:shadow-focus"
          : "border border-line-strong bg-surface text-content shadow-xs hover:border-brand-300 hover:bg-surface-brand hover:text-content-brand focus-visible:shadow-focus",
        size === "sm" ? "h-9 px-4 text-[0.8125rem]" : "h-11 px-5 text-sm",
        className,
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-white/0 transition-colors duration-200 group-hover:bg-white/[0.09] group-active:bg-black/[0.07]"
      />
      {variant === "primary" ? (
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-sheen" />
      ) : null}
      <span className="relative z-10 inline-flex min-w-0 items-center gap-2">
        {icon ? (
          <span aria-hidden className="-ml-0.5 inline-flex shrink-0">
            {icon}
          </span>
        ) : null}
        <span className="truncate">{children}</span>
      </span>
    </Link>
  );
}

/** Score ring for the result card. On the dark card: jade-300 arc, 5.7:1
 *  against the gradient's lightest stop (brand-700; this card has no aurora
 *  over it). On the light review card: saffron-600 arc, 3.5:1 on
 *  surface-accent. Both past WCAG 1.4.11's 3:1 for a graphic; the tracks
 *  are decoration. The score is always printed in words beside it. */
function ScoreRing({ score, max, tone }: { score: number; max: number; tone: "inverse" | "accent" }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const fraction = max > 0 ? Math.min(Math.max(score / max, 0), 1) : 0;
  return (
    <svg viewBox="0 0 100 100" aria-hidden className="h-24 w-24 shrink-0 -rotate-90 sm:h-28 sm:w-28">
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        stroke={tone === "inverse" ? "rgba(255,255,255,0.15)" : "#FDDC92"}
        strokeWidth="9"
      />
      {fraction > 0 ? (
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={tone === "inverse" ? "#68D5A8" : "#D06B06"}
          strokeWidth="9"
          strokeLinecap={fraction === 1 ? "butt" : "round"}
          strokeDasharray={`${fraction * circumference} ${circumference}`}
        />
      ) : null}
    </svg>
  );
}

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
          <label key={option.letter} className={optionRowClass(value === option.letter)}>
            <input
              type="radio"
              name={question.id}
              className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
              checked={value === option.letter}
              onChange={() => onChange(option.letter)}
            />
            <OptionLetter letter={option.letter} selected={value === option.letter} />
            <span className="min-w-0 pt-0.5">{option.text}</span>
          </label>
        ))}
      </div>
    );
  }

  if (question.questionType === "Multi Select" && options.length > 0) {
    const selected = new Set(value.split(",").map((v) => v.trim().toUpperCase()).filter(Boolean));
    return (
      <div className="space-y-2">
        {/* content-subtle on white: 6.4:1. */}
        <p className="text-xs text-content-subtle">Choose every answer that applies.</p>
        {options.map((option) => (
          <label key={option.letter} className={optionRowClass(selected.has(option.letter))}>
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
              checked={selected.has(option.letter)}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(option.letter);
                else next.delete(option.letter);
                onChange(Array.from(next).sort().join(","));
              }}
            />
            <OptionLetter letter={option.letter} selected={selected.has(option.letter)} />
            <span className="min-w-0 pt-0.5">{option.text}</span>
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
          <div
            key={option.letter}
            className="flex items-center gap-3 rounded-2xl border border-line-strong bg-surface px-4 py-3 text-sm leading-relaxed text-content transition duration-200 ease-spring hover:border-brand-200"
          >
            {/* content-brand on surface-brand: 9.3:1. */}
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface-brand text-xs font-bold tabular text-content-brand ring-1 ring-inset ring-brand-100">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">{option.text}</span>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label="Move up"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong text-content-muted transition hover:border-brand-300 hover:bg-surface-brand hover:text-content-brand disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronUp className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === items.length - 1}
                aria-label="Move down"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong text-content-muted transition hover:border-brand-300 hover:bg-surface-brand hover:text-content-brand disabled:pointer-events-none disabled:opacity-40"
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
        className="h-12 w-full max-w-xs rounded-2xl border border-line-strong bg-surface px-4 text-base tabular text-content shadow-xs outline-none transition placeholder:text-content-faint hover:border-brand-200 focus:border-brand-400 focus:shadow-focus-field"
      />
    );
  }

  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={question.questionType === "Constructed Response" ? 5 : 2}
      placeholder="Type your answer"
      className="w-full rounded-2xl border border-line-strong bg-surface px-4 py-3 text-base leading-relaxed text-content shadow-xs outline-none transition placeholder:text-content-faint hover:border-brand-200 focus:border-brand-400 focus:shadow-focus-field"
    />
  );
}

/**
 * The marked result. Presentation of an AttemptResult, nothing more -- the
 * actions under it (and their handlers) are passed in from the page.
 */
function ResultView({ result, children }: { result: AttemptResult; children: React.ReactNode }) {
  const awaitingReview = result.reviewStatus === "PENDING_REVIEW";
  const correct = result.answers.filter((a) => a.isCorrect === true).length;
  const incorrect = result.answers.filter((a) => a.isCorrect === false).length;
  const pending = result.answers.length - correct - incorrect;
  const fullMarks = result.maxScore > 0 && result.finalScore === result.maxScore;

  const tally = [
    { label: "Correct", count: correct, icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> },
    { label: "Incorrect", count: incorrect, icon: <XCircle className="h-3.5 w-3.5" aria-hidden /> },
    ...(pending > 0
      ? [{ label: "Awaiting review", count: pending, icon: <Hourglass className="h-3.5 w-3.5" aria-hidden /> }]
      : []),
  ];

  return (
    <>
      {/* Two tones, and each now has text that belongs on it. The review
          tone used to keep the dark tone's white text on a light saffron
          card (1.05:1). Dark: white on brand-700 10.3:1, the /80 labels
          7.2:1. Light: content on surface-accent 16.2:1, saffron-900 9.3:1. */}
      <Card tone={awaitingReview ? "accent" : "inverse"} className="animate-scale-in">
        <CardBody className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div className="flex items-center gap-5">
            <div className="relative">
              <ScoreRing score={result.finalScore} max={result.maxScore} tone={awaitingReview ? "accent" : "inverse"} />
              <span
                aria-hidden
                className={cn(
                  "absolute inset-0 flex items-center justify-center font-display text-lg font-semibold tabular",
                  awaitingReview ? "text-saffron-900" : "text-white",
                )}
              >
                {result.maxScore > 0 ? `${Math.round((result.finalScore / result.maxScore) * 100)}%` : "—"}
              </span>
            </div>
            <div>
              <p
                className={cn(
                  "text-xs font-semibold uppercase tracking-eyebrow",
                  awaitingReview ? "text-saffron-900" : "text-white/80",
                )}
              >
                Your Score
              </p>
              <p
                className={cn(
                  "mt-1 font-display text-display-md tabular",
                  awaitingReview ? "text-content" : "text-content-inverse",
                )}
              >
                {result.finalScore} / {result.maxScore}
              </p>
              <p className={cn("mt-1 text-sm", awaitingReview ? "text-content-muted" : "text-white/80")}>
                {/* Deliberately no "this may still go up": nothing can write a
                    teacher's mark yet (final_score always equals auto_score,
                    and teacher scoring is Phase 4, per models/learning.py
                    and README). This says only what is true today. */}
                {awaitingReview
                  ? "Some written answers can't be marked automatically, so they aren't counted in this score."
                  : fullMarks
                    ? "Full marks. Every answer right."
                    : "Look through what you missed below — each one shows the right answer."}
              </p>
            </div>
          </div>
          {awaitingReview ? (
            <Badge tone="warning" icon={<Hourglass className="h-3 w-3" />}>
              Awaiting Teacher Review
            </Badge>
          ) : (
            <Badge tone="inverse" dot>
              Auto-Scored
            </Badge>
          )}
        </CardBody>
      </Card>

      {/* The tally, in words and numbers -- the icons and colours only echo
          them. jade-700 / coral-700 / saffron-900 on their 50 tints: 6.8,
          6.7 and 9.3:1. */}
      <ul className="flex flex-wrap gap-2 animate-fade-up delay-70" aria-label="How your answers were marked">
        {tally.map((item) => (
          <li
            key={item.label}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.8125rem] font-semibold ring-1 ring-inset",
              item.label === "Correct" && "bg-jade-50 text-jade-700 ring-jade-200",
              item.label === "Incorrect" && "bg-coral-50 text-coral-700 ring-coral-200",
              item.label === "Awaiting review" && "bg-saffron-50 text-saffron-900 ring-saffron-200",
            )}
          >
            {item.icon}
            <span className="tabular">{item.count}</span> {item.label}
          </li>
        ))}
      </ul>

      <ol className="space-y-4">
        {result.answers.map((answer, index) => {
          const state = answer.isCorrect === true ? "correct" : answer.isCorrect === false ? "incorrect" : "pending";
          return (
            <Card
              as="li"
              key={answer.questionId}
              className={cn("animate-fade-up", STAGGER[Math.min(index + 1, STAGGER.length - 1)])}
            >
              {/* Edge rail: decoration only -- the Badge names the state. */}
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-0 left-0 w-1",
                  state === "correct" && "bg-jade-400",
                  state === "incorrect" && "bg-coral-400",
                  state === "pending" && "bg-saffron-300",
                )}
              />
              <CardBody className="space-y-3.5">
                {/* items-center: the one-line label and the 24px badge share
                    a centre line (items-start left the label riding ~2px
                    high of the badge's text). */}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-eyebrow text-content-subtle">Question {index + 1}</p>
                  {state === "correct" ? (
                    <Badge tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>
                      Correct
                    </Badge>
                  ) : state === "incorrect" ? (
                    <Badge tone="danger" icon={<XCircle className="h-3 w-3" />}>
                      Incorrect
                    </Badge>
                  ) : (
                    <Badge tone="neutral" icon={<Hourglass className="h-3 w-3" />}>
                      Pending Review
                    </Badge>
                  )}
                </div>
                <p className="text-[0.9375rem] font-medium leading-relaxed text-content text-pretty">{answer.stem}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {/* Answer panels. Labels content-subtle on surface-muted
                      6.0:1 (coral tint 6.1:1); the answer itself content
                      16:1. "Not answered" was content-faint, which is 4.6:1
                      on white but 4.4:1 on these tints -- so subtle here. */}
                  <div
                    className={cn(
                      "rounded-2xl border px-3.5 py-3",
                      state === "incorrect" ? "border-coral-200 bg-coral-50/60" : "border-line bg-surface-muted",
                    )}
                  >
                    <p className="text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-subtle">Your answer</p>
                    <p className="mt-1 text-sm font-medium text-content">
                      {answer.responseText || <span className="font-normal italic text-content-subtle">Not answered</span>}
                    </p>
                  </div>
                  {answer.isCorrect === false ? (
                    // jade-800 on jade-50: 8.9:1.
                    <div className="rounded-2xl border border-jade-200 bg-jade-50 px-3.5 py-3">
                      <p className="text-[0.6875rem] font-bold uppercase tracking-eyebrow text-jade-800">Correct answer</p>
                      <p className="mt-1 text-sm font-medium text-jade-800">{answer.correctAnswer}</p>
                    </div>
                  ) : null}
                </div>
                {answer.explanation ? (
                  // content-muted on surface-brand: 7.8:1.
                  <p className="rounded-2xl bg-surface-brand p-3.5 text-sm leading-relaxed text-content-muted">
                    <span className="font-semibold text-content-brand">Why: </span>
                    {answer.explanation}
                  </p>
                ) : null}
              </CardBody>
            </Card>
          );
        })}
      </ol>

      {children}
    </>
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
  // Autosave used to fire one PUT per keystroke with no ordering guard, so a
  // fast typist could have an earlier (shorter) keystroke's request resolve
  // AFTER a later, more-complete one and silently overwrite it -- the screen
  // still showed the full answer, but the server (and therefore auto-
  // grading) kept a truncated one. Found during the 20 Aug 2026 end-to-end
  // scan: reproduced twice, independent of typing speed. Fixed by (1)
  // debouncing so a burst of keystrokes collapses into one save, and (2)
  // chaining each question's saves onto a per-question promise so, even if
  // two saves do fire close together, the network calls are serialized in
  // the order they were issued rather than racing.
  const answerTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const saveQueueRef = useRef<Record<string, Promise<unknown>>>({});
  const AUTOSAVE_DEBOUNCE_MS = 400;

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
      // Seed from what the server already has for this attempt (30 Sep
      // 2026). This used to be setAnswers({}), so a refresh or a return
      // mid-attempt showed every question blank -- even though autosave had
      // stored each answer (PUT .../answers) and submit would have graded
      // them. The data was never lost; the screen just didn't show it back.
      // POST /attempts now returns each question's own responseText (null
      // when fresh or unanswered).
      setAnswers(Object.fromEntries(data.questions.map((q) => [q.id, q.responseText ?? ""])));
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

  const persistAnswer = useCallback(
    (question: AttemptQuestion, value: string) => {
      if (!attempt) return Promise.resolve();
      setSavingIds((prev) => new Set(prev).add(question.id));
      const attemptId = attempt.id;
      const previous = saveQueueRef.current[question.id] ?? Promise.resolve();
      // Chain onto the previous save for this question rather than firing
      // concurrently, so network responses can't land out of order and
      // overwrite a newer answer with a stale one.
      const thisSave = previous
        .catch(() => {})
        .then(() => api.put(`/learning/attempts/${attemptId}/answers`, { questionId: question.id, responseText: value }))
        .catch(() => {
          // Best-effort autosave -- submit re-sends nothing itself (the
          // backend grades whatever was last saved per question), so a
          // transient save failure here just means that one answer may
          // need re-entering before submit; not worth interrupting the
          // student mid-attempt over.
        })
        .finally(() => {
          setSavingIds((prev) => {
            const next = new Set(prev);
            next.delete(question.id);
            return next;
          });
        });
      saveQueueRef.current[question.id] = thisSave;
      return thisSave;
    },
    [attempt],
  );

  function handleAnswerChange(question: AttemptQuestion, value: string) {
    setAnswers((prev) => ({ ...prev, [question.id]: value }));
    if (!attempt) return;
    const timers = answerTimersRef.current;
    if (timers[question.id]) clearTimeout(timers[question.id]);
    timers[question.id] = setTimeout(() => {
      delete timers[question.id];
      void persistAnswer(question, value);
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  async function flushPendingSaves() {
    if (!attempt) return;
    const timers = answerTimersRef.current;
    const pendingQuestionIds = Object.keys(timers);
    pendingQuestionIds.forEach((id) => clearTimeout(timers[id]));
    answerTimersRef.current = {};
    // Fire the latest value immediately for any question whose debounce
    // hadn't elapsed yet, then wait for every question's save chain
    // (freshly fired or already in flight) to settle before submitting --
    // otherwise a submit right after typing could grade a stale answer.
    for (const questionId of pendingQuestionIds) {
      const question = attempt.questions.find((q) => q.id === questionId);
      if (question) persistAnswer(question, answers[questionId] ?? "");
    }
    await Promise.all(Object.values(saveQueueRef.current).map((p) => p.catch(() => {})));
  }

  async function handleSubmit() {
    if (!attempt) return;
    setPhase("submitting");
    try {
      await flushPendingSaves();
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

  // attemptsUsed includes the attempt this result is for (GET .../result).
  const attemptsRemaining = result ? result.maxAttempts + result.bonusAttempts - result.attemptsUsed : 0;

  return (
    <RoleShell role="STUDENT" user={user}>
      {/* space-y-8, the working-page rhythm shared with Daily Practice
          itself (was 6, the only page on that step). */}
      <div className="space-y-8">
        <PageHeader
          eyebrow="Today's Practice"
          title={attempt?.activity.title ?? (result ? "Your Result" : "Practice")}
          description={attempt ? ACTIVITY_TYPE_LABEL[attempt.activity.activityType] : undefined}
          actions={
            <LinkAction href="/student/practice" variant="secondary" size="sm" icon={<ArrowLeft className="h-4 w-4" />}>
              Back to List
            </LinkAction>
          }
        />

        {phase === "loading" ? (
          // The shape of what's coming -- a progress strip and two question
          // cards -- rather than the word "Loading".
          <div aria-busy="true" className="space-y-4">
            <span className="sr-only" role="status">
              Loading your practice
            </span>
            <Card aria-hidden className="animate-fade-up">
              <CardBody className="flex items-center justify-between gap-4 py-5 sm:py-5">
                <SkeletonLine className="h-4 w-32" />
                <SkeletonLine className="h-2.5 w-40" />
              </CardBody>
            </Card>
            {[0, 1].map((i) => (
              <Card key={i} aria-hidden className={cn("animate-fade-up", STAGGER[i])}>
                <CardBody className="space-y-4">
                  <div className="flex items-center gap-3">
                    <SkeletonLine className="h-9 w-9 rounded-xl" />
                    <SkeletonLine className="h-3 w-40" />
                  </div>
                  <SkeletonLine className="h-4 w-4/5" />
                  <div className="space-y-2">
                    {[0, 1, 2].map((j) => (
                      <SkeletonLine key={j} className="h-12 w-full rounded-2xl" />
                    ))}
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        ) : null}

        {phase === "blocked" ? (
          <Card className="animate-fade-up">
            <CardBody className="space-y-5">
              <div className="flex items-start gap-3">
                <CardIcon tone="coral">
                  <AlertCircle className="h-5 w-5" aria-hidden />
                </CardIcon>
                <div className="min-w-0 space-y-1.5">
                  <CardTitle>That didn&rsquo;t go through</CardTitle>
                  {/* coral-700 on white: 7.3:1. The message itself is the
                      server's own (apiErrorMessage), shown verbatim. */}
                  <p role="alert" className="text-[0.875rem] font-medium leading-[1.55] text-coral-700">
                    {blockedMessage}
                  </p>
                </div>
              </div>
              <LinkAction href="/student/practice" variant="secondary" icon={<ArrowLeft className="h-4 w-4" />}>
                Back to Today&apos;s Practice
              </LinkAction>
            </CardBody>
          </Card>
        ) : null}

        {phase === "answering" || phase === "submitting" ? (
          <>
            {/* Sticks under the top of the screen, so "how far through am
                I" never scrolls away mid-set. top-20 clears the mobile
                top bar (RoleShell, sticky, z-40); the desktop context bar
                doesn't stick, so lg:top-4. */}
            <Card className="sticky top-20 z-20 animate-fade-up lg:top-4">
              <CardBody className="flex flex-wrap items-center justify-between gap-3 py-4 sm:py-4">
                <p className="text-sm text-content-muted">
                  <span className="font-semibold tabular text-content">
                    {answeredCount} of {totalQuestions}
                  </span>{" "}
                  answered
                </p>
                {/* The track is decoration; the fill is brand on ink-100 and
                    the count is printed beside it. role="progressbar" so a
                    screen reader hears the same count. */}
                <div
                  role="progressbar"
                  aria-label="Questions answered"
                  aria-valuemin={0}
                  aria-valuemax={totalQuestions}
                  aria-valuenow={answeredCount}
                  className="h-2 w-40 overflow-hidden rounded-full bg-ink-100 sm:w-56"
                >
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-300",
                      totalQuestions > 0 && answeredCount === totalQuestions ? "bg-jade-gradient" : "bg-brand-gradient",
                    )}
                    style={{ width: `${totalQuestions ? (answeredCount / totalQuestions) * 100 : 0}%` }}
                  />
                </div>
              </CardBody>
            </Card>

            <ol className="space-y-4">
              {attempt?.questions.map((question, index) => (
                <Card
                  as="li"
                  key={question.id}
                  className={cn("animate-fade-up", STAGGER[Math.min(index, STAGGER.length - 1)])}
                >
                  <CardBody className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {/* white on brand-700: 10.3:1. */}
                        <span
                          aria-hidden
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-700 font-display text-sm font-semibold tabular text-white shadow-brand"
                        >
                          {index + 1}
                        </span>
                        {/* content-subtle on white: 6.4:1. */}
                        <p className="text-xs font-semibold uppercase tracking-eyebrow text-content-subtle">
                          Question {index + 1} of {totalQuestions} &middot; {question.marks} mark{question.marks === 1 ? "" : "s"}
                        </p>
                      </div>
                      {/* Polite, so the save is announced without cutting off
                          whatever is being read. content-faint on white:
                          4.6:1. */}
                      <span aria-live="polite" className="min-h-[1rem] shrink-0 text-xs text-content-faint">
                        {savingIds.has(question.id) ? (
                          <span className="inline-flex items-center gap-1.5 animate-fade-in">
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                            Saving…
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <p className="text-[1rem] font-medium leading-relaxed text-content text-pretty">{question.stem}</p>
                    <QuestionInput
                      question={question}
                      value={answers[question.id] ?? ""}
                      onChange={(value) => handleAnswerChange(question, value)}
                    />
                  </CardBody>
                </Card>
              ))}
            </ol>

            <Card tone="brand" className="animate-fade-up">
              <CardBody className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-content">Ready to hand it in?</p>
                  {/* content-muted on surface-brand: 7.8:1. */}
                  <p className="text-[0.8125rem] leading-relaxed text-content-muted">
                    Once you submit, you can&apos;t change your answers for this attempt.
                  </p>
                </div>
                <Button variant="primary" leadingIcon={<Send className="h-4 w-4" />} loading={phase === "submitting"} onClick={handleSubmit}>
                  Submit Practice
                </Button>
              </CardBody>
            </Card>
          </>
        ) : null}

        {phase === "result" && result ? (
          <ResultView result={result}>
            <div className="flex flex-wrap items-center gap-3">
              <LinkAction href="/student/practice" variant="secondary" icon={<ArrowLeft className="h-4 w-4" />}>
                Back to Today&apos;s Practice
              </LinkAction>
              {/* Only offered while an attempt is actually left (30 Sep
                  2026). It used to show unconditionally, so a student out of
                  attempts pressed it and landed on the "That didn't go
                  through" error card -- start_attempt's
                  ATTEMPT_LIMIT_REACHED. Same sum start_attempt checks
                  (learning_service.py: attempt_count >= max_attempts +
                  bonus_attempts). Still a real <Button>, not a link: it
                  runs startOrResume, it doesn't just navigate. */}
              {attemptsRemaining > 0 ? (
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
              ) : (
                // Wording follows start_attempt's own ATTEMPT_LIMIT_REACHED
                // message, so the student is told the same thing either
                // way. content-muted on the canvas: 8.2:1.
                <p className="text-[0.8125rem] leading-relaxed text-content-muted">
                  No re-attempts remaining for this assignment. Ask your teacher for an additional attempt.
                </p>
              )}
            </div>
          </ResultView>
        ) : null}
      </div>
    </RoleShell>
  );
}
