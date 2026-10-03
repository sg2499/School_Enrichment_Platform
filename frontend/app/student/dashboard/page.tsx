"use client";

/**
 * Student dashboard -- "Your Learning Space".
 *
 * Phase 2b/c pass (30 Sep 2026). Until this pass the page fetched nothing:
 * it told every student, forever, "Nothing to Do Yet -- your first chapter
 * is on its way" and "Nothing to practise today", while /student/practice
 * (the page one click away in the rail) was listing their real, live,
 * assigned practice. Same class of bug as the admin dashboard's hardcoded
 * "Nothing is live for your school yet" panel fixed in Phase 2a.
 *
 * It now reads GET /learning/assignments -- the exact endpoint, response
 * shape and status vocabulary /student/practice already uses (nothing new
 * on the backend) -- and says one of five things, each of them true:
 *  - loading:     skeletons in the shape of what's coming, no claims.
 *  - error:       says it couldn't check, offers a retry; never falls back
 *                 to "nothing to do", which would be a guess.
 *  - none set:    the original "waiting on your school" empty state --
 *                 honest in exactly this case, so it's kept.
 *  - work waiting: how much, what's next, and a way straight into it.
 *  - caught up:   says so, with the latest results one click away.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  Circle,
  FileSpreadsheet,
  MessageCircleQuestion,
  PlayCircle,
  RefreshCcw,
  Target,
  TrendingUp,
} from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { cn, greetingForHour } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardIcon, CardTitle } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SessionGate } from "@/components/SessionGate";
import { ModuleCard, DetailRow } from "@/components/ui/ModuleCard";
import { PanelFooter, PanelStack, SplitLayout, StretchCard } from "@/components/ui/SplitLayout";
import { AuroraBackdropInverse, PathIllustration } from "@/components/brand/Graphics";
import { api, errorMessage } from "@/lib/api";
import { ACTIVITY_TYPE_LABEL } from "@/types/learning";
import type { StudentAssignmentSummary } from "@/types/learning";

type AssignmentStatus = StudentAssignmentSummary["status"];

// ---------------------------------------------------------------------------
// Conventions shared with /student/practice.
//
// Copied verbatim from app/student/practice/page.tsx rather than imported:
// a Next.js page module may only export the page itself, and moving them to
// a shared lib/ module was outside this pass's file scope. The dashboard's
// "up next" list must be exactly the first rows of that page, with the same
// labels and the same buttons, so keep these in step with it.
// TODO: lift STATUS_* and actionForAssignment into lib/ (e.g.
// lib/learning.ts) so the two pages can't drift apart.
// ---------------------------------------------------------------------------

const STATUS_TONE: Record<AssignmentStatus, BadgeTone> = {
  PENDING: "brand",
  IN_PROGRESS: "warning",
  COMPLETED: "success",
  SKIPPED: "neutral",
};

const STATUS_LABEL: Record<AssignmentStatus, string> = {
  PENDING: "Not Started",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  SKIPPED: "Skipped",
};

const STATUS_ORDER: Record<AssignmentStatus, number> = {
  IN_PROGRESS: 0,
  PENDING: 1,
  COMPLETED: 2,
  SKIPPED: 3,
};

function actionForAssignment(item: StudentAssignmentSummary): { label: string; href: string } {
  const base = `/student/practice/${item.assignmentTargetId}`;
  if (item.status === "COMPLETED" && item.latestAttempt) {
    // Straight to the stored result -- the attempt page must not POST
    // /attempts for this, or "View Result" would burn a re-attempt.
    return { label: "View Result", href: `${base}?attemptId=${item.latestAttempt.id}&view=result` };
  }
  if (item.status === "IN_PROGRESS") return { label: "Continue", href: base };
  return { label: "Start", href: base };
}

// ---------------------------------------------------------------------------
// What "you'll find here" -- every status below is a factual claim.
//
// Re-verified 30 Sep 2026 against the code and README "Status" (reconciled
// the same day), using the same evidence -- and reaching the same verdicts
// -- as the admin dashboard's Rollout/Modules lists, so a student and their
// school admin are never told different things about the same feature.
// ---------------------------------------------------------------------------

type ModuleStatus = "live" | "soon" | "planned";

const MODULE_STATUS: Record<ModuleStatus, { label: string; tone: BadgeTone }> = {
  live: { label: "Live", tone: "success" },
  soon: { label: "Soon", tone: "neutral" },
  planned: { label: "Planned", tone: "neutral" },
};

type StudentModule = {
  icon: React.ReactNode;
  title: string;
  description: string;
  tone: "brand" | "accent" | "jade" | "coral";
  status: ModuleStatus;
  /** Only live modules link anywhere -- RoleShell's rule (no href, no
   *  pretend link), and the admin dashboard's. */
  href?: string;
};

// Live first: the first question anyone has of this grid is "what can I
// open?". Then by how close the rest are.
const MODULES: StudentModule[] = [
  {
    icon: <Target className="h-5 w-5" aria-hidden />,
    title: "Daily Practice",
    // Was "A short set of questions each day". Not every day: models/
    // learning.py documents pacing_day as advisory only ("never enforced
    // server-side"), so practice arrives when a teacher assigns it, not on
    // a daily clock. The "marked the moment you submit" half is
    // learning_service.submit_attempt, which grades on submit.
    description: "Short sets of questions your teacher assigns from the chapter you're on, marked the moment you submit.",
    tone: "accent",
    // Was "Soon". Live -- evidence: /student/practice lists GET
    // /learning/assignments; /student/practice/[assignmentTargetId] runs
    // POST /learning/attempts -> PUT .../answers -> POST .../submit -> GET
    // .../result end to end; RoleShell's NAV gives "Daily Practice" a real
    // href. README "Status" records student "Today's Practice" as shipped,
    // and the admin dashboard's "Daily Learning Loop" stage lists "Students
    // attempt it and get an instant, auto-marked score" as live.
    status: "live",
    href: "/student/practice",
  },
  {
    icon: <BookOpen className="h-5 w-5" aria-hidden />,
    title: "Chapter Lessons",
    description: "Read, watch and work through a chapter at your own pace, in the order your teacher sets.",
    tone: "brand",
    // Not live (certain): models/learning.py says CONCEPT_SIMPLE lesson
    // activities are never generated ("no such content exists in the
    // question bank"), RoleShell's "My Lessons" row is `soon`, and the admin
    // dashboard lists "Chapter lessons for students" as still to come.
    // TODO(verify): "Soon" vs "Planned". It's part of the stage currently
    // in build (hence "Soon", matching the rail), but the same docstring
    // calls the authoring flow for it "explicitly out of scope here", and
    // nothing in the repo shows anyone building it yet.
    status: "soon",
  },
  {
    icon: <TrendingUp className="h-5 w-5" aria-hidden />,
    title: "My Progress",
    description: "See which topics you have mastered and which ones deserve another go.",
    tone: "jade",
    // Was "Soon". "Planned" -- evidence: no endpoint returns progress or
    // mastery to a student (routes_learning.py's only mastery figure,
    // via foundation_repair_service.compute_concept_mastery, is behind
    // TEACHER/ADMIN-only routes, and README says Foundation Repair is "not
    // yet built"); README records analytics (Phases 5-8) as "not started";
    // the admin dashboard marks its equivalent "Reports" module Planned for
    // the same reason. What students *do* have today is each set's own
    // score, in Daily Practice -- that's a result, not this module.
    status: "planned",
  },
  {
    icon: <FileSpreadsheet className="h-5 w-5" aria-hidden />,
    title: "Mock Papers",
    description: "Full-length practice papers in your board's format, so exam day feels familiar.",
    tone: "coral",
    // Was "Soon". "Planned" -- evidence: no paper/mock model, route or page
    // exists anywhere in backend/app or frontend/app (checked 30 Sep 2026);
    // README records the paper/mock generator (Phases 5-8) as "not
    // started"; the admin dashboard's "Papers & Mocks" module is Planned.
    status: "planned",
  },
];

/**
 * How practice actually works, today -- shown to a student who has nothing
 * assigned yet, so the page teaches them what to expect.
 *
 * Replaces a five-step "Learn / Practise with hints / Check / Fix the bits
 * that wobbled / Master" loop (30 Sep 2026) that described the planned
 * five-day cycle as if it were running. It isn't yet: pacing_day is
 * advisory only (models/learning.py); hints are never sent to a student
 * (routes_learning._question_public_dict strips them, and the result view
 * doesn't return them either); and the "fix" step -- Foundation Repair --
 * is "not yet built" (README) and has no student-facing surface. Each step
 * below is something the shipped flow does.
 */
const HOW_IT_WORKS = [
  {
    step: "Your teacher sets it",
    // Teacher POST /learning/assignments (app/teacher/assignments).
    body: "Practice arrives when your teacher assigns it from the chapter you're on.",
  },
  {
    step: "Go at your own pace",
    // learning_service.start_attempt resumes an open attempt rather than
    // starting a new one, so leaving mid-set costs nothing.
    body: "You can stop and come back later. Your attempt stays open until you submit.",
  },
  {
    step: "Submit when you're ready",
    // learning_service.submit_attempt marks on submit. "Most", not "every":
    // written-answer questions go to PENDING_REVIEW instead.
    body: "Most questions are marked the moment you press Submit.",
  },
  {
    step: "See what you missed",
    // GET .../result returns correctAnswer for each wrong answer; the
    // re-attempt cap is the assignment's maxAttempts.
    body: "Check the right answer for anything you got wrong, and try again if you have attempts left.",
  },
];

// The hero's "no app to install" promises, re-checked 30 Sep 2026. The last
// one was "Nothing is graded until you are ready", reworded to name the
// actual trigger (the Submit button -- learning_service.submit_attempt).
// TODO(verify): "Works on a shared phone or tablet" is carried over from
// the original copy. Layouts are responsive and each role signs in with its
// own session cookie (core/cookies.py), but it hasn't been checked on a
// real shared device in this pass.
const HERO_POINTS = [
  "No app to install",
  "Works on a shared phone or tablet",
  "Your teacher sets the pace",
  "Nothing is marked until you press Submit",
];

const STAGGER = ["delay-70", "delay-140", "delay-210", "delay-280", "delay-350", "delay-420"];

/** Local YYYY-MM-DD, so "due today" is the student's calendar day, not
 *  UTC's -- at 4am IST, UTC is still on yesterday. */
function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "2026-09-14" -> "14 Sep", parsed as a *local* date: new
 *  Date("2026-09-14") is UTC midnight, which renders as the 13th anywhere
 *  west of Greenwich. Teachers set dueDate from a plain <input type="date">
 *  (app/teacher/assignments), so this is the shape it arrives in; anything
 *  else is shown as stored. */
function formatDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(date);
}

/** Plain-words due line. "Was due", not "Overdue": the backend doesn't
 *  enforce due dates (start_attempt never reads due_date), so the set is
 *  still open and the page shouldn't imply it has been locked. */
function dueLabel(dueDate: string | null, today: string): string | null {
  if (!dueDate) return null;
  const day = dueDate.slice(0, 10);
  if (day === today) return "Due today";
  if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day < today) return `Was due ${formatDay(dueDate)}`;
  return `Due ${formatDay(dueDate)}`;
}

/** Quiet placeholder bars while live data loads -- the shape of what's
 *  coming, not a spinner. Pulse stops under prefers-reduced-motion
 *  (globals.css). `inverse` for use on the indigo hero. */
function SkeletonLine({ className, inverse = false }: { className?: string; inverse?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("block animate-pulse rounded-full", inverse ? "bg-white/12" : "bg-ink-100", className)}
    />
  );
}

/** A link that reads as a quiet text action. content-brand on white 10.3:1. */
function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1.5 rounded-full text-sm font-semibold text-content-brand transition-colors hover:text-brand-900"
    >
      {children}
      <ArrowRight
        aria-hidden
        className="h-4 w-4 transition-transform duration-200 ease-spring group-hover:translate-x-0.5"
      />
    </Link>
  );
}

/**
 * A navigation action that looks like a Button but *is* a link.
 *
 * The practice pages wrap <Button> in <Link>, which nests one interactive
 * element in another (invalid HTML, and two tab stops for one action).
 * These two only ever navigate, so they're plain links wearing the Button
 * kit's accent/quiet variants (class strings mirror components/ui/Button,
 * which doesn't export them -- keep in step). Focus: a white outline, not
 * the global brand-500 one, which nearly vanishes on the indigo hero; white
 * on brand-700 is 10.3:1.
 */
function HeroAction({
  href,
  variant,
  icon,
  children,
}: {
  href: string;
  variant: "accent" | "quiet";
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group relative inline-flex h-11 min-w-0 select-none items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-full px-5 text-sm font-semibold",
        "transition duration-200 ease-spring active:duration-75 focus-visible:outline-white",
        variant === "accent"
          ? // brand-950 on the gradient's darkest stop (saffron-600) 4.9:1,
            // on its lightest (saffron-300) 11.2:1.
            "bg-accent-gradient text-brand-950 shadow-accent hover:-translate-y-0.5 hover:brightness-[1.04] active:translate-y-0 active:scale-[0.985]"
          : "border border-line-inverse bg-white/10 text-content-inverse backdrop-blur hover:bg-white/20",
      )}
    >
      {icon ? (
        <span aria-hidden className="-ml-0.5 inline-flex shrink-0">
          {icon}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
    </Link>
  );
}

type Summary = {
  /** In progress first, then not started -- the practice page's order. */
  waiting: StudentAssignmentSummary[];
  inProgress: number;
  notStarted: number;
  completed: StudentAssignmentSummary[];
  /** Everything except SKIPPED. Nothing in the backend sets SKIPPED today
   *  (the status exists only in models/learning.py's column comment), but
   *  a skipped set is neither "to do" nor "done", so it's left out of both
   *  rather than guessed into one. */
  countable: number;
};

function summarise(assignments: StudentAssignmentSummary[]): Summary {
  const sorted = [...assignments].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const waiting = sorted.filter((a) => a.status === "IN_PROGRESS" || a.status === "PENDING");
  // Most recently marked first, for the caught-up "latest results" list.
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
    countable: waiting.length + completed.length,
  };
}

/**
 * Done-of-set ring for the hero's glass panel. Two arcs on one track: jade
 * for done, saffron for started. As graphics on the frosted panel (measured
 * at its lightest -- glass over the aurora's glow): jade-300 3.2:1,
 * saffron-300 3.6:1, both past WCAG 1.4.11's 3:1. The legend beside it
 * carries every count in words, so colour is never the only carrier (1.4.1).
 */
function ProgressRing({ done, started, total }: { done: number; started: number; total: number }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const doneLength = total > 0 ? (done / total) * circumference : 0;
  const startedLength = total > 0 ? (started / total) * circumference : 0;
  // Butt caps keep each arc exactly proportional (round caps would add half
  // a stroke to both ends). A small gap between arcs so two colours meeting
  // don't read as one band on a washed-out projector.
  const gap = done > 0 && started > 0 ? 2 : 0;
  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label={`${done} of ${total} practice ${total === 1 ? "set" : "sets"} done${started > 0 ? `, ${started} started` : ""}.`}
      className="h-28 w-28 shrink-0 -rotate-90"
    >
      <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="9" />
      {doneLength > 0 ? (
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="#68D5A8"
          strokeWidth="9"
          strokeDasharray={`${Math.max(doneLength - gap, 0)} ${circumference}`}
        />
      ) : null}
      {startedLength > 0 ? (
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="#FBC559"
          strokeWidth="9"
          strokeDasharray={`${Math.max(startedLength - gap, 0)} ${circumference}`}
          strokeDashoffset={-doneLength}
        />
      ) : null}
    </svg>
  );
}

/** The hero's right-hand panel for a student with work set: the numbers. */
function ProgressPanel({ summary }: { summary: Summary }) {
  const done = summary.completed.length;
  const rows = [
    { label: "Done", count: done, dot: "bg-jade-300" },
    { label: "Started", count: summary.inProgress, dot: "bg-saffron-300" },
    { label: "Not started", count: summary.notStarted, dot: "bg-white/40" },
  ];
  // The dots are a key to the ring, not the carrier: each row names its
  // state in words, so the white/40 dot (2.3:1) needn't meet 3:1 itself.
  return (
    <div className="glass-panel rounded-3xl p-5 animate-scale-in">
      {/* saffron-100 on the panel's lightest point: 5.0:1. */}
      <p className="text-[0.6875rem] font-bold uppercase tracking-eyebrow text-saffron-100">Your practice so far</p>
      <div className="mt-4 flex items-center gap-5">
        <div className="relative">
          <ProgressRing done={done} started={summary.inProgress} total={summary.countable} />
          <span aria-hidden className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-display text-display-sm tabular leading-none text-content-inverse">
              {done}
              <span className="text-base text-content-inverse/90">/{summary.countable}</span>
            </span>
            <span className="mt-1 text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-content-inverse/90">
              Done
            </span>
          </span>
        </div>
        {/* White at 90% on the panel: 5.0:1; full white 5.7:1. */}
        <ul className="min-w-0 flex-1 space-y-2.5">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center justify-between gap-3 text-[0.8125rem]">
              <span className="flex min-w-0 items-center gap-2 text-content-inverse/90">
                <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", row.dot)} />
                <span className="truncate">{row.label}</span>
              </span>
              <span className="font-semibold tabular text-content-inverse">{row.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The hero's right-hand panel for a student with nothing set yet. */
function HowItWorksPanel() {
  return (
    <div className="glass-panel rounded-3xl p-5">
      <p className="text-[0.6875rem] font-bold uppercase tracking-eyebrow text-saffron-100">How practice works</p>
      <ol className="mt-4 space-y-3.5">
        {HOW_IT_WORKS.map((item, index) => (
          <li key={item.step} className="flex items-start gap-3">
            {/* A solid saffron disc: brand-950 on saffron-300 is 11.2:1.
                (It was white/12 with saffron-200 digits -- 3.3:1 once the
                frosted panel sits over the aurora's glow.) */}
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-saffron-300 text-[0.6875rem] font-bold tabular text-brand-950">
              {index + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-[0.8125rem] font-semibold text-content-inverse">{item.step}</span>
              {/* Was text-white/60 (3.2:1 here). White at 90%: 5.0:1. */}
              <span className="block text-[0.75rem] leading-relaxed text-content-inverse/90">{item.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; summary: Summary };

/** The hero's paragraphs carry no max-w-prose (1 Oct 2026). From lg up the
 *  grid's text column is already narrower than 68ch (about 360-735px), so
 *  the cap never engaged there. Below lg the column is the full card, and
 *  between roughly 870 and 1023px wide it did: it stranded a word on a
 *  line of its own ("...or open Daily" / "Practice directly.") with the
 *  card's width still free beside it. The skeleton bar matches. */
function Hero({ state, onRetry }: { state: LoadState; onRetry: () => void }) {
  if (state.kind === "loading") {
    return (
      <div className="grid items-center gap-8 lg:grid-cols-[1.25fr_0.75fr]" aria-busy="true">
        <span className="sr-only" role="status">
          Checking your practice
        </span>
        <div className="space-y-4">
          <SkeletonLine inverse className="h-6 w-32" />
          <SkeletonLine inverse className="h-9 w-4/5" />
          <div className="space-y-2 pt-1">
            <SkeletonLine inverse className="h-3.5 w-full" />
            <SkeletonLine inverse className="h-3.5 w-2/3" />
          </div>
          <div className="flex gap-3 pt-2">
            <SkeletonLine inverse className="h-11 w-36" />
            <SkeletonLine inverse className="h-11 w-32" />
          </div>
        </div>
        <SkeletonLine inverse className="h-48 w-full rounded-3xl" />
      </div>
    );
  }

  if (state.kind === "error") {
    // No claim either way about what's set -- the card under the hero says
    // what went wrong and offers the retry. This just stays welcoming.
    return (
      <div className="grid items-center gap-8 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-4">
          <h2 className="font-display text-display-md text-balance text-content-inverse">Your practice lives here.</h2>
          <p className="text-[0.9375rem] leading-relaxed text-content-inverse-muted text-pretty">
            We couldn&rsquo;t check what&rsquo;s been set for you just now. Try again in a moment, or open Daily
            Practice directly.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Button variant="quiet" leadingIcon={<RefreshCcw className="h-4 w-4" />} onClick={onRetry}>
              Try Again
            </Button>
            <HeroAction href="/student/practice" variant="quiet" icon={<Target className="h-4 w-4" />}>
              Open Daily Practice
            </HeroAction>
          </div>
        </div>
        <HowItWorksPanel />
      </div>
    );
  }

  const { summary } = state;

  if (summary.countable === 0) {
    // Nothing assigned yet: the original "on its way" hero, which is an
    // honest claim in exactly this case. Copy re-checked: it used to promise
    // "the lesson, the practice and a clear way to see how you are doing",
    // but only the practice (and its per-set result) is live.
    return (
      <div className="grid items-center gap-8 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-4">
          <Badge tone="inverse" dot pulse>
            Nothing to Do Yet
          </Badge>
          <h2 className="font-display text-display-md text-balance text-content-inverse">
            Your first practice is on its way.
          </h2>
          {/* content-inverse-muted over the aurora's glow: 5.7:1. */}
          <p className="text-[0.9375rem] leading-relaxed text-content-inverse-muted text-pretty">
            Your teachers are loading this year&apos;s syllabus into School Enrichment. When they set your first
            practice, it will appear right here &mdash; a short set of questions, marked the moment you submit, with the
            right answer for anything you missed.
          </p>
          <ul className="grid gap-2 pt-1 sm:grid-cols-2">
            {HERO_POINTS.map((point) => (
              // Was text-white/70 (5.0:1 on the glow); now the inverse-muted
              // token (5.7:1), so the hero's small text shares one step.
              <li key={point} className="flex items-start gap-2.5 text-[0.8125rem] text-content-inverse-muted">
                <span aria-hidden className="mt-[0.4rem] h-1.5 w-1.5 shrink-0 rounded-full bg-saffron-300" />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <HowItWorksPanel />
      </div>
    );
  }

  const next = summary.waiting[0];

  if (!next) {
    // Everything set is done.
    const done = summary.completed.length;
    return (
      <div className="grid items-center gap-8 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-4">
          <Badge tone="inverse" dot>
            All Caught Up
          </Badge>
          <h2 className="font-display text-display-md text-balance text-content-inverse">
            {/* Warm gradient at its darkest stop (saffron-400) over the glow:
                4.3:1 -- past the 3:1 large-text bar at display-md. */}
            You&rsquo;re all caught up. <span className="text-gradient-warm">Nice work.</span>
          </h2>
          <p className="text-[0.9375rem] leading-relaxed text-content-inverse-muted text-pretty">
            {done === 1 ? "The practice set" : `All ${done} practice sets`} your teacher has given you{" "}
            {done === 1 ? "is" : "are"} done. The next one will show up here the moment it&rsquo;s set &mdash; and
            your results are always there to look back on.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <HeroAction href="/student/practice" variant="quiet" icon={<CheckCircle2 className="h-4 w-4" />}>
              See Your Results
            </HeroAction>
          </div>
        </div>
        <ProgressPanel summary={summary} />
      </div>
    );
  }

  const waitingCount = summary.waiting.length;
  const action = actionForAssignment(next);
  const minutes = next.learningActivity.estimatedMinutes;
  const headline =
    summary.inProgress > 0
      ? "Pick up where you left off."
      : waitingCount === 1
        ? "One practice set is ready for you."
        : `${waitingCount} practice sets are ready for you.`;

  return (
    <div className="grid items-center gap-8 lg:grid-cols-[1.25fr_0.75fr]">
      <div className="space-y-4">
        <Badge tone="inverse" dot pulse>
          {waitingCount} Waiting
        </Badge>
        <h2 className="font-display text-display-md text-balance text-content-inverse">{headline}</h2>
        <p className="text-[0.9375rem] leading-relaxed text-content-inverse-muted text-pretty">
          {next.status === "IN_PROGRESS" ? (
            <>
              You started <strong className="font-semibold text-content-inverse">{next.learningActivity.title}</strong>
              . It&rsquo;s still open, so carry on whenever you&rsquo;re ready.
            </>
          ) : (
            <>
              Next up: <strong className="font-semibold text-content-inverse">{next.learningActivity.title}</strong>
              {minutes ? <> &mdash; about {minutes} minutes</> : null}.
            </>
          )}
          {waitingCount > 1 ? (
            <>
              {" "}
              {waitingCount - 1} more {waitingCount - 1 === 1 ? "is" : "are"} waiting after that.
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <HeroAction href={action.href} variant="accent" icon={<PlayCircle className="h-4 w-4" />}>
            {action.label === "Continue" ? "Continue Practice" : "Start Practice"}
          </HeroAction>
          <HeroAction href="/student/practice" variant="quiet">
            See All Practice
          </HeroAction>
        </div>
      </div>
      <ProgressPanel summary={summary} />
    </div>
  );
}

/** One practice set as a single link row: one tab stop, the whole row is
 *  the target (a Class 5 thumb on a shared tablet shouldn't have to find a
 *  small button). Mirrors a /student/practice card, compressed. */
function AssignmentRow({ item, today }: { item: StudentAssignmentSummary; today: string }) {
  const action = actionForAssignment(item);
  const due = item.status === "COMPLETED" ? null : dueLabel(item.dueDate, today);
  const score = item.status === "COMPLETED" ? item.latestAttempt?.evaluation : null;
  const minutes = item.learningActivity.estimatedMinutes;
  // Icon discs (graphics, 3:1 minimum): jade-700 on jade-50 6.8:1;
  // saffron-900 on saffron-100 8.4:1; brand-700 on brand-50 9.3:1.
  const disc =
    item.status === "COMPLETED"
      ? { className: "bg-jade-50 text-jade-700 ring-jade-100", icon: <CheckCircle2 className="h-4 w-4" aria-hidden /> }
      : item.status === "IN_PROGRESS"
        ? { className: "bg-saffron-100 text-saffron-900 ring-saffron-200", icon: <PlayCircle className="h-4 w-4" aria-hidden /> }
        : { className: "bg-brand-50 text-brand-700 ring-brand-100", icon: <Circle className="h-4 w-4" aria-hidden /> };
  return (
    <li>
      <Link
        href={action.href}
        className="group flex items-center gap-3 rounded-2xl border border-line bg-surface-muted/70 px-3.5 py-3 transition duration-200 ease-spring hover:border-brand-200 hover:bg-surface-brand"
      >
        <span
          className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset", disc.className)}
        >
          {disc.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-content">{item.learningActivity.title}</span>
          {/* content-subtle on the muted row: 6.2:1; on the brand hover 5.8:1. */}
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-content-subtle">
            <span>{STATUS_LABEL[item.status]}</span>
            <span aria-hidden>&middot;</span>
            <span>{ACTIVITY_TYPE_LABEL[item.learningActivity.activityType]}</span>
            {minutes && item.status !== "COMPLETED" ? (
              <>
                <span aria-hidden>&middot;</span>
                <span>{minutes} min</span>
              </>
            ) : null}
            {due ? (
              <>
                <span aria-hidden>&middot;</span>
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3 w-3" aria-hidden />
                  {due}
                </span>
              </>
            ) : null}
          </span>
        </span>
        {score ? (
          // Same tones as /student/practice's score badge.
          <Badge tone={score.finalScore === score.maxScore ? "success" : "accent"} className="tabular">
            {score.finalScore}/{score.maxScore}
          </Badge>
        ) : null}
        {/* The action in words, so the row says what clicking it does.
            content-brand on the row: 9.9:1, on its hover fill 9.2:1. */}
        <span className="hidden shrink-0 items-center gap-1 text-[0.8125rem] font-semibold text-content-brand sm:inline-flex">
          {action.label}
          <ArrowRight
            aria-hidden
            className="h-3.5 w-3.5 transition-transform duration-200 ease-spring group-hover:translate-x-0.5"
          />
        </span>
      </Link>
    </li>
  );
}

/** The card under the hero: what to do next, in the detail the hero skips. */
function PracticePanel({ state, onRetry }: { state: LoadState; onRetry: () => void }) {
  const today = todayIso();

  if (state.kind === "loading") {
    return (
      <div className="space-y-5" aria-hidden>
        <div className="flex items-center gap-3">
          <SkeletonLine className="h-11 w-11 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <SkeletonLine className="h-4 w-32" />
            <SkeletonLine className="h-3 w-52" />
          </div>
        </div>
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl border border-line px-3.5 py-3">
              <SkeletonLine className="h-9 w-9 rounded-xl" />
              <div className="flex-1 space-y-2">
                <SkeletonLine className="h-3.5 w-2/3" />
                <SkeletonLine className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <CardIcon tone="coral">
            <AlertCircle className="h-5 w-5" aria-hidden />
          </CardIcon>
          <div>
            <CardTitle>Couldn&rsquo;t load your practice</CardTitle>
            {/* coral-700 on white: 7.3:1. */}
            <p role="alert" className="mt-1 text-[0.8125rem] font-medium leading-relaxed text-coral-700">
              {state.message}
            </p>
          </div>
        </div>
        {/* No max-w-prose (1 Oct 2026), like the hero above: the card bounds
            it, and on a single-column tablet layout the cap split it in two
            with the card's width still free. */}
        <p className="text-sm leading-relaxed text-content-muted text-pretty">
          Nothing you&rsquo;ve done is lost &mdash; this page just couldn&rsquo;t reach the list. School networks can be
          slow; it usually works on a second try.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="secondary" size="sm" leadingIcon={<RefreshCcw className="h-4 w-4" />} onClick={onRetry}>
            Try Again
          </Button>
          <TextLink href="/student/practice">Open Daily Practice</TextLink>
        </div>
      </div>
    );
  }

  const { summary } = state;

  if (summary.countable === 0) {
    return (
      // Centred, so it stays balanced when Your Details beside it is the
      // taller card and this one is stretched to match (SplitLayout).
      <div className="flex flex-1 flex-col justify-center">
        <EmptyState
          illustration={<PathIllustration />}
          status={{ label: "Waiting on Your School", tone: "accent" }}
          title="Nothing to practise today"
          description="When your teacher sets your first practice, you'll see it here — usually ten to fifteen minutes' work, never a wall of homework."
          // Replaced 30 Sep 2026: "Your streak and progress start counting
          // from your first practice" (no streak exists anywhere in backend/
          // or frontend/) and "Anything you get wrong comes back later"
          // (README: Foundation Repair "not yet built"; nothing re-sets a
          // missed question automatically). Both below are shipped behaviour:
          // submit_attempt marks on submit; GET .../result returns the
          // correct answer for each wrong one.
          points={[
            "Each set is marked the moment you submit it",
            "You'll see the right answer for anything you got wrong",
          ]}
        />
      </div>
    );
  }

  const caughtUp = summary.waiting.length === 0;
  const rows = (caughtUp ? summary.completed : summary.waiting).slice(0, 3);
  const listCount = caughtUp ? summary.completed.length : summary.waiting.length;

  return (
    <PanelStack gap="gap-5">
      <div className="flex items-start gap-3">
        <CardIcon tone={caughtUp ? "jade" : "accent"}>
          {caughtUp ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <Target className="h-5 w-5" aria-hidden />}
        </CardIcon>
        <div>
          <CardTitle>{caughtUp ? "Your Latest Results" : "Up Next"}</CardTitle>
          <p className="mt-0.5 text-xs text-content-subtle">
            {caughtUp
              ? "Open one to see each answer, and the right one for anything you missed"
              : "In the same order as your Daily Practice list"}
          </p>
        </div>
      </div>
      <ul className="space-y-2">
        {rows.map((item) => (
          <AssignmentRow key={item.assignmentTargetId} item={item} today={today} />
        ))}
      </ul>
      <PanelFooter>
        <TextLink href="/student/practice">
          {listCount > rows.length
            ? `See all ${listCount} in Daily Practice`
            : caughtUp
              ? "See everything in Daily Practice"
              : "Open Daily Practice"}
        </TextLink>
      </PanelFooter>
    </PanelStack>
  );
}

export default function StudentDashboardPage() {
  const session = useProtectedPage("STUDENT");
  const { user, status } = session;
  const [assignments, setAssignments] = useState<StudentAssignmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Same request as /student/practice's load(). Kept deliberately small: a
  // retry clears the error, and the previous list (if any) stays on screen
  // until the new one lands, so a retry never flashes back to skeletons.
  const load = useCallback(async () => {
    setError(null);
    try {
      const { data } = await api.get<{ assignments: StudentAssignmentSummary[] }>("/learning/assignments");
      setAssignments(data.assignments);
    } catch (err) {
      // No action phrase: the card this lands in is headed "Couldn't load
      // your practice", so the sentence only has to say why.
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    load();
  }, [status, load]);

  if (status !== "ready") {
    return <SessionGate session={session} />;
  }

  const firstName = user?.fullName?.trim().split(/\s+/)[0] ?? "there";
  const greeting = greetingForHour(new Date().getHours());
  const student = user?.student ?? null;
  const classLabel = student?.className
    ? `Class ${student.className}${student.section ? ` ${student.section}` : ""}`
    : null;

  const state: LoadState = error
    ? { kind: "error", message: error }
    : assignments
      ? { kind: "ready", summary: summarise(assignments) }
      : { kind: "loading" };

  // The header chip follows the same data as the hero, so the two can't
  // disagree. (It used to say "Getting Set Up" to everyone, permanently.)
  let statusChip: React.ReactNode = null;
  if (state.kind === "ready") {
    const { summary } = state;
    statusChip =
      summary.countable === 0 ? (
        <Badge tone="accent" dot pulse>
          Getting Set Up
        </Badge>
      ) : summary.waiting.length > 0 ? (
        <Badge tone="brand" dot pulse>
          {summary.waiting.length} to Do
        </Badge>
      ) : (
        <Badge tone="success" dot>
          All Caught Up
        </Badge>
      );
  }

  const liveModules = MODULES.filter((m) => m.status === "live").length;

  return (
    <RoleShell role="STUDENT" user={user}>
      {/* space-y-10, the same rhythm as the Admin and Teacher dashboards
          (this one alone was space-y-8), so the three read as one family. */}
      <div className="space-y-10">
        <PageHeader
          eyebrow={greeting}
          title={
            <>
              Hello, <span className="text-gradient-brand">{firstName}</span>
            </>
          }
          // Was "...your lessons and daily practice will show up right here".
          // Lessons aren't live (see MODULES), so it now promises only what
          // this page actually shows.
          description="This is your learning space. Whenever your teacher sets practice, it shows up right here first."
          meta={
            <>
              {classLabel ? <Badge tone="brand">{classLabel}</Badge> : null}
              {student?.studentCode ? <Badge tone="neutral">ID {student.studentCode}</Badge> : null}
              {statusChip}
            </>
          }
        />

        <Card tone="inverse" className="animate-fade-up">
          <AuroraBackdropInverse />
          <CardBody className="relative z-10 sm:p-9">
            <Hero state={state} onRetry={load} />
          </CardBody>
        </Card>

        {/* SplitLayout, as on the other two dashboards: both cards end on
            one line, and each pins its closing element to the bottom. */}
        <SplitLayout columns="lg:grid-cols-[1.35fr_0.65fr]">
          <StretchCard
            className="animate-fade-up delay-70"
            bodyClassName={cn(state.kind === "ready" && state.summary.countable === 0 && "sm:p-9")}
          >
            <PracticePanel state={state} onRetry={load} />
          </StretchCard>

          <StretchCard className="animate-fade-up delay-140">
            <PanelStack gap="gap-5">
              <div className="flex items-center gap-3">
                <CardIcon tone="brand">
                  <CalendarCheck className="h-5 w-5" aria-hidden />
                </CardIcon>
                <CardTitle>Your Details</CardTitle>
              </div>
              <dl className="-mt-1">
                <DetailRow label="Name" value={user?.fullName ?? "—"} />
                <DetailRow label="Class" value={classLabel ?? "Not assigned yet"} />
                <DetailRow label="Student ID" value={student?.studentCode ?? "—"} />
              </dl>
              {/* content-muted on surface-brand: 7.8:1. Pinned to the card's
                  foot (mt-auto) so it lines up with Up Next's footer link. */}
              <p className="mt-auto flex items-start gap-2.5 rounded-2xl bg-surface-brand p-3.5 text-[0.8125rem] leading-relaxed text-content-muted">
                <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                Something here looks wrong? Tell your class teacher &mdash; they can correct it for you.
              </p>
            </PanelStack>
          </StretchCard>
        </SplitLayout>

        <section aria-labelledby="modules-heading" className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="modules-heading" className="font-display text-display-sm text-content">
                What you&apos;ll find here
              </h2>
              <p className="mt-1 text-sm text-content-muted">
                Anything marked Live opens from here. The rest will appear on their own when they&rsquo;re ready
                &mdash; nothing to install.
              </p>
            </div>
            {/* Counted from MODULES, so it can't disagree with the cards. */}
            <Badge tone="neutral">
              {liveModules} Live &middot; {MODULES.length - liveModules} Coming
            </Badge>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {MODULES.map((module, index) => {
              const card = (
                <ModuleCard
                  icon={module.icon}
                  title={module.title}
                  description={module.description}
                  tone={module.tone}
                  status={MODULE_STATUS[module.status]}
                />
              );
              return (
                <li key={module.title} className={cn("animate-fade-up", STAGGER[index + 2])}>
                  {module.href ? (
                    // The card's hover lift promises "clickable" -- only a
                    // live module is wrapped in a link to keep that promise.
                    // rounded-3xl so the focus outline follows the card.
                    <Link href={module.href} className="block h-full rounded-3xl">
                      {card}
                    </Link>
                  ) : (
                    card
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </RoleShell>
  );
}
