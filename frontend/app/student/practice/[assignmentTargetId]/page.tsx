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
  CloudOff,
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
import { AlertBanner } from "@/components/ui/AlertBanner";
import { SessionGate } from "@/components/SessionGate";
import { SignInAgainBanner } from "@/components/SignInAgainBanner";
import { api, describeApiError } from "@/lib/api";
import { wasRefused, type DescribedError } from "@/lib/errors";
import { useSessionReturn } from "@/lib/hooks/useSessionReturn";
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
 *
 * Failure handling, 3 Oct 2026 (UI revamp Phase B, slice 2). Converting
 * this page's errors to lib/errors.ts turned up four places where the
 * problem was not the wording:
 *  - An answer that failed to save was dropped silently, and Submit then
 *    graded whatever the server last had -- so a student on a flaky school
 *    connection could hand in a set with answers missing and never know.
 *    A failed save is now remembered, shown on its question ("Not saved
 *    yet"), sent again when the connection returns and again on Submit;
 *    and Submit does not hand anything in while an answer is unsaved.
 *  - A Submit that failed because the server could not be reached replaced
 *    the whole set with a dead-end error card. It now stays on the
 *    questions, says what happened, and Submit can be pressed again.
 *  - A Submit that worked, followed by a result that would not load, said
 *    "That didn't go through". It had gone through; it now says so.
 *  - A session that ends mid-set must not send the tab to the sign-in page
 *    (as lib/api.ts does everywhere else): answers not yet saved exist only
 *    on this screen. The page stays, and says how to sign in again in
 *    another tab.
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
 * has no disabled or loading state. Focus is Button's own
 * shadow-focus-ring. `sm` is here for the header's "Back to List", which was
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
          ? "bg-brand-gradient text-content-inverse shadow-brand hover:-translate-y-0.5 hover:shadow-card-hover active:translate-y-0 active:scale-[0.985] active:shadow-brand focus-visible:shadow-focus-ring"
          : "border border-line-strong bg-surface text-content shadow-xs hover:border-brand-300 hover:bg-surface-brand hover:text-content-brand focus-visible:shadow-focus-ring",
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

/** What the page shows in place of the questions when it cannot go on. */
type Blocked = {
  title: string;
  message: string;
  /** "done": nothing failed that matters -- the work is safe, only the next
   *  screen would not load. */
  tone: "problem" | "done";
  /** Present when doing the same thing again could work. */
  retry?: () => void;
};

/**
 * The server answered, and the answer was no. Trying again will be refused
 * again, so these end the attempt screen; everything else (no connection, a
 * timeout, the server restarting) leaves the questions where they are. So
 * does a session that has ended: that is cured by signing in again, with
 * the answers still on screen.
 */
function isRefusal(problem: DescribedError): boolean {
  // wasRefused: one of the server's own codes on a 4xx. A 403 or 404 with
  // no code came from something in front of the server, says nothing about
  // this attempt, and must not cost the student the questions on screen.
  // (A rate limit is the server's too, but waiting cures it.)
  return wasRefused(problem) && problem.kind !== "session" && problem.kind !== "rateLimited";
}

/** Failures whose own sentence is right to show above Submit as it stands. */
const SAYS_WHY: ReadonlySet<DescribedError["kind"]> = new Set(["offline", "network", "unavailable", "server", "rateLimited"]);

export default function StudentAttemptPage() {
  const params = useParams<{ assignmentTargetId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const session = useProtectedPage("STUDENT");
  const { user, status } = session;

  const [phase, setPhase] = useState<Phase>("loading");
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  // Shown above Submit when handing in could not happen this time but can be
  // tried again -- the questions stay on screen.
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Answers the server does not have: question id -> the value that failed
  // to save. A ref, because the save chain and Submit read it between
  // renders; `unsavedIds` mirrors its keys for the "Not saved yet" marker.
  const unsavedRef = useRef<Record<string, string>>({});
  const lastSaveProblemRef = useRef<DescribedError | null>(null);
  const [unsavedIds, setUnsavedIds] = useState<Set<string>>(new Set());
  // What is on screen for each question right now, readable from the save
  // chain and from event handlers without waiting for a render.
  const answersRef = useRef<Record<string, string>>({});
  // The value carried by the most recent save issued for each question.
  // Saves for one question run in order, so the last one issued is the last
  // to finish -- and only it may say whether the question is saved. Without
  // this, an older value succeeding (or failing) after a newer one was
  // queued would mark the question with the wrong answer's outcome.
  const issuedRef = useRef<Record<string, string>>({});
  // The server says this session is over. Set by a save or by Submit; the
  // page stays up (see SignInAgainBanner). Cleared by anything that shows
  // the session works again, or that fails for some other reason -- so the
  // banner never outlives what it says.
  const [sessionEnded, setSessionEnded] = useState(false);
  // A Submit that got no answer in time may have been accepted. Until one
  // gets a definite answer the questions stay locked: an edit now could be
  // an edit to a set that is already handed in.
  const [submitUnconfirmed, setSubmitUnconfirmed] = useState(false);
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

  // `justHandedIn`: this is the result of a set handed in a moment ago on
  // this screen. If it will not load, that must not read as the hand-in
  // having failed -- on the first try or on any Try Again after it.
  const loadResult = useCallback(async (attemptId: string, justHandedIn = false) => {
    setPhase("loading");
    try {
      const { data } = await api.get<AttemptResult>(`/learning/attempts/${attemptId}/result`);
      setResult(data);
      setPhase("result");
    } catch (err) {
      const retryWith = (problem: DescribedError) =>
        problem.retryable ? () => void loadResult(attemptId, justHandedIn) : undefined;
      if (justHandedIn) {
        const problem = describeApiError(err, "load your result");
        setBlocked({
          title: "Your practice is handed in",
          message: `${problem.message} Your answers are safe, and your result will be in Today's Practice.`,
          tone: "done",
          retry: retryWith(problem),
        });
      } else {
        // No action phrase: the title says what failed, so the sentence
        // under it only has to say why.
        const problem = describeApiError(err);
        setBlocked({ title: "We couldn't load your result", message: problem.message, tone: "problem", retry: retryWith(problem) });
      }
      setPhase("blocked");
    }
  }, []);

  const startOrResume = useCallback(async () => {
    setPhase("loading");
    setBlocked(null);
    setSubmitError(null);
    unsavedRef.current = {};
    issuedRef.current = {};
    lastSaveProblemRef.current = null;
    setUnsavedIds(new Set());
    setSessionEnded(false);
    setSubmitUnconfirmed(false);
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
      const seeded = Object.fromEntries(data.questions.map((q) => [q.id, q.responseText ?? ""]));
      answersRef.current = seeded;
      setAnswers(seeded);
      setPhase("answering");
    } catch (err) {
      const problem = describeApiError(err);
      setBlocked({
        title: "We couldn't open this practice",
        message: problem.message,
        tone: "problem",
        retry: problem.retryable ? () => void startOrResume() : undefined,
      });
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
      issuedRef.current[question.id] = value;
      const isNewest = () => issuedRef.current[question.id] === value;
      const previous = saveQueueRef.current[question.id] ?? Promise.resolve();
      // Chain onto the previous save for this question rather than firing
      // concurrently, so network responses can't land out of order and
      // overwrite a newer answer with a stale one.
      const thisSave = previous
        .catch(() => {})
        .then(() =>
          api.put(
            `/learning/attempts/${attemptId}/answers`,
            { questionId: question.id, responseText: value },
            // If the session has ended, stay here: see SignInAgainBanner.
            { keepPageOnSessionEnd: true },
          ),
        )
        .then(() => {
          // The session works (again).
          setSessionEnded(false);
          // A newer value for this question is queued behind this one and
          // will have the last word on whether the question is saved.
          if (!isNewest()) return;
          if (question.id in unsavedRef.current) {
            delete unsavedRef.current[question.id];
            setUnsavedIds(new Set(Object.keys(unsavedRef.current)));
          }
        })
        .catch((err) => {
          const problem = describeApiError(err, "save your answers");
          setSessionEnded(problem.kind === "session");
          if (!isNewest()) return;
          // The server grades whatever it last stored for each question, so
          // an answer that did not save must not be forgotten: it is sent
          // again when the connection returns and again before Submit, and
          // Submit will not hand the set in without it. (Until 3 Oct 2026
          // this was an empty catch. The student saw their answer on screen,
          // the server never had it, and Submit graded it as blank.)
          unsavedRef.current[question.id] = value;
          lastSaveProblemRef.current = problem;
          setUnsavedIds(new Set(Object.keys(unsavedRef.current)));
        })
        .finally(() => {
          // Only the last save queued for this question takes "Saving…"
          // down; an earlier one finishing while another is still to run
          // would otherwise clear it with a save in flight.
          if (saveQueueRef.current[question.id] !== thisSave) return;
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

  /**
   * Sends, now, the answer on screen for every question that is waiting on
   * a debounce timer or whose last save failed. Always the value on screen
   * (answersRef), never the value that failed: by the time this runs the
   * student may have changed it, and re-sending the old one behind the new
   * one would leave the server holding the old one.
   */
  const sendWaitingAnswers = useCallback(() => {
    if (!attempt) return;
    const timers = answerTimersRef.current;
    const waiting = new Set([...Object.keys(timers), ...Object.keys(unsavedRef.current)]);
    for (const questionId of waiting) {
      if (timers[questionId]) {
        clearTimeout(timers[questionId]);
        delete timers[questionId];
      }
      const question = attempt.questions.find((q) => q.id === questionId);
      if (question) void persistAnswer(question, answersRef.current[questionId] ?? "");
    }
  }, [attempt, persistAnswer]);

  // The moment the browser reports a connection again, send whatever is
  // waiting -- so by the time the student reaches Submit there is usually
  // nothing left to catch up on.
  useEffect(() => {
    window.addEventListener("online", sendWaitingAnswers);
    return () => window.removeEventListener("online", sendWaitingAnswers);
  }, [sendWaitingAnswers]);

  // They signed in again in another tab and came back: take the banner
  // down and send whatever was waiting.
  const resumeAfterSignIn = useCallback(() => {
    setSessionEnded(false);
    sendWaitingAnswers();
  }, [sendWaitingAnswers]);
  useSessionReturn(sessionEnded, user?.id, resumeAfterSignIn);

  // Handing in is under way, or may already have happened: what is (being)
  // handed in is what was on screen when Submit was pressed. An edit now
  // could be saved after the set is graded, and would be shown as the
  // answer when it was not.
  const locked = phase === "submitting" || submitUnconfirmed;

  function handleAnswerChange(question: AttemptQuestion, value: string) {
    if (locked) return;
    answersRef.current = { ...answersRef.current, [question.id]: value };
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
    // Fire the latest value immediately for any question whose debounce
    // hadn't elapsed yet -- and for any whose last save failed -- then wait
    // for every question's save chain (freshly fired or already in flight)
    // to settle before submitting. Otherwise a submit right after typing
    // could grade a stale answer, and one after a dropped connection could
    // grade a missing one.
    sendWaitingAnswers();
    await Promise.all(Object.values(saveQueueRef.current).map((p) => p.catch(() => {})));
  }

  async function handleSubmit() {
    if (!attempt) return;
    setSubmitError(null);
    setPhase("submitting");

    // 1. Every answer must be on the server before anything is handed in.
    await flushPendingSaves();
    if (Object.keys(unsavedRef.current).length > 0) {
      const problem = lastSaveProblemRef.current;
      if (problem?.kind === "session") {
        // SignInAgainBanner says what to do.
        setSessionEnded(true);
        setPhase("answering");
        return;
      }
      setSessionEnded(false);
      if (problem && isRefusal(problem)) {
        // The server will not take answers for this attempt any more (it
        // was handed in from another tab, say). Its sentence says why.
        setBlocked({ title: "That didn't go through", message: problem.message, tone: "problem" });
        setPhase("blocked");
        return;
      }
      // Never "refresh the page" here: the answers that did not save exist
      // only on this screen, and a refresh reloads the set from the server.
      const why = !problem
        ? "We couldn't save some of your answers just now."
        : problem.kind === "timeout"
          ? "We didn't hear back in time, so some of your answers may not be saved yet."
          : SAYS_WHY.has(problem.kind)
            ? problem.message
            : "We couldn't save some of your answers just now.";
      setSubmitError(`${why} Your answers are still on this page, and nothing has been handed in yet. Press Submit to try again.`);
      setPhase("answering");
      return;
    }

    // 2. Hand it in.
    try {
      await api.post(`/learning/attempts/${attempt.id}/submit`, undefined, { keepPageOnSessionEnd: true });
      setSubmitUnconfirmed(false);
    } catch (err) {
      const problem = describeApiError(err, "hand in your practice");
      // No answer in time is the one outcome that leaves it unknown.
      setSubmitUnconfirmed(problem.kind === "timeout");
      if (problem.kind === "session") {
        setSessionEnded(true);
        setPhase("answering");
        return;
      }
      setSessionEnded(false);
      if (isRefusal(problem)) {
        setBlocked({ title: "That didn't go through", message: problem.message, tone: "problem" });
        setPhase("blocked");
        return;
      }
      // Not refused, just not reached. Keep the questions on screen.
      setSubmitError(
        problem.kind === "timeout"
          ? // It may have gone through. Pressing Submit again is safe -- the
            // server hands in a set once and answers a second request with
            // the same result (learning_service.submit_attempt) -- whereas
            // refreshing would start a new attempt if it had.
            "We didn't hear back in time, so we can't confirm your practice was handed in. Your answers are saved. Press Submit again to make sure: handing in twice does no harm."
          : SAYS_WHY.has(problem.kind)
            ? `${problem.message} Your answers are saved.`
            : "We couldn't hand in your practice just now. Your answers are saved. Press Submit to try again.",
      );
      setPhase("answering");
      return;
    }

    // 3. It is handed in. Showing the result is a separate request, and its
    // failing must not read as the hand-in failing.
    await loadResult(attempt.id, true);
  }

  if (status !== "ready") {
    return <SessionGate session={session} />;
  }

  // attemptsUsed includes the attempt this result is for (GET .../result).
  const attemptsRemaining = result ? result.maxAttempts + result.bonusAttempts - result.attemptsUsed : 0;

  return (
    <RoleShell role="STUDENT" user={user} title={[attempt?.activity.title ?? (result ? "Your Result" : null), "Daily Practice"]}>
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
                {blocked?.tone === "done" ? (
                  <CardIcon tone="jade">
                    <CheckCircle2 className="h-5 w-5" aria-hidden />
                  </CardIcon>
                ) : (
                  <CardIcon tone="coral">
                    <AlertCircle className="h-5 w-5" aria-hidden />
                  </CardIcon>
                )}
                <div className="min-w-0 space-y-1.5">
                  <CardTitle>{blocked?.title ?? "That didn’t go through"}</CardTitle>
                  {/* The sentence is written by lib/errors.ts or by the
                      server, never a raw error. coral-700 on white: 7.3:1;
                      content-muted on white: 8.6:1. */}
                  <p
                    role="alert"
                    className={cn(
                      "text-[0.875rem] font-medium leading-[1.55]",
                      blocked?.tone === "done" ? "text-content-muted" : "text-coral-700",
                    )}
                  >
                    {blocked?.message}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {blocked?.retry ? (
                  <Button variant="primary" leadingIcon={<RotateCcw className="h-4 w-4" />} onClick={blocked.retry}>
                    Try Again
                  </Button>
                ) : null}
                <LinkAction href="/student/practice" variant="secondary" icon={<ArrowLeft className="h-4 w-4" />}>
                  Back to Today&apos;s Practice
                </LinkAction>
              </div>
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
                  {/* This strip is the one thing always in view, so it is
                      where an unsaved answer further up the page is made
                      known. coral-700 on white: 7.3:1. */}
                  {unsavedIds.size > 0 ? (
                    <span className="font-semibold text-coral-700"> &middot; {unsavedIds.size} not saved yet</span>
                  ) : null}
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

            {/* While handing in -- or after a Submit that may have landed --
                the questions are what is (being) handed in: dimmed and
                inert (handleAnswerChange also ignores edits, for the
                keyboard). aria-busy tells assistive tech the same. */}
            <ol
              aria-busy={phase === "submitting"}
              className={cn("space-y-4 transition-opacity", locked && "pointer-events-none opacity-60")}
            >
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
                        ) : unsavedIds.has(question.id) ? (
                          // Said in words and with an icon, not by colour
                          // alone. coral-700 on white: 7.3:1.
                          <span className="inline-flex items-center gap-1.5 font-semibold text-coral-700 animate-fade-in">
                            <CloudOff className="h-3 w-3" aria-hidden />
                            Not saved yet
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

            {sessionEnded ? (
              <SignInAgainBanner>
                Your session has ended, so your answers can&rsquo;t be saved or handed in yet. Keep this page open:
                your answers are still here. Sign in again in a new tab, then come back to this page and carry on.
              </SignInAgainBanner>
            ) : submitError ? (
              <AlertBanner tone="error" message={submitError} />
            ) : null}

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
