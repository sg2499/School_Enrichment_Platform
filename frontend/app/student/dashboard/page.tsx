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
 *  - none set:    the "nothing assigned yet" empty state -- honest in
 *                 exactly this case, so it's kept.
 *  - work waiting: how much, what's next, and a way straight into it.
 *  - caught up:   says so, with the latest results one click away.
 *
 * The masthead (4 Oct 2026, UI revamp Phase B, slice 5). The page used to
 * open on a greeting set straight on the canvas and, under it, a separate
 * indigo "hero" card -- the construction the Teacher and Admin dashboards
 * had before their own masthead pass, and the reason Shailesh, looking at
 * the three side by side, said the student one "has not been revamped".
 * It now opens the way they do: one lit panel (PageHeader surface
 * "masthead") carrying the greeting, the student's four figures and the
 * one next step, over the workspace wash.
 *
 * What moved where:
 *  - The hero's headline, sentence and button are the masthead's next step
 *    (MastheadNextStep), worded by lib/studentPractice.ts studentNextStep().
 *  - The hero's ring ("1/2 done", with Done / Started / Not started beside
 *    it) is the masthead's figures: Not Started, In Progress, Completed -- and a
 *    fourth it never had, the latest score.
 *  - "How practice works", which the hero showed a student with nothing
 *    set, is a card of its own below (HowPracticeWorks), shown in that same
 *    case only.
 *  - The class and student-code chips sit on the masthead; the third chip
 *    ("1 to Do" / "All Caught Up") said what the figures now say, and went.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  Check,
  CheckCircle2,
  Circle,
  FileSpreadsheet,
  MessageCircleQuestion,
  PlayCircle,
  RefreshCcw,
  Route,
  Target,
  TrendingUp,
} from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { cn, greetingForHour } from "@/lib/utils";
import { PageHeader, type PageHeaderStat } from "@/components/ui/PageHeader";
import { MastheadNextStep } from "@/components/ui/MastheadNextStep";
import { Card, CardBody, CardIcon, CardTitle } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { InlineLink } from "@/components/ui/InlineLink";
import { SessionGate } from "@/components/SessionGate";
import { ModuleCard, DetailRow } from "@/components/ui/ModuleCard";
import { PanelFooter, PanelStack, SplitLayout, StretchCard } from "@/components/ui/SplitLayout";
import { PathIllustration } from "@/components/brand/Graphics";
import { api, errorMessage } from "@/lib/api";
import {
  PRACTICE_LIST_HREF,
  PRACTICE_LIST_NAME,
  STATUS_LABEL,
  latestScore,
  practiceAction,
  setWord,
  stillBeingMarked,
  studentNextStep,
  summarisePractice,
  type PracticeSummary,
} from "@/lib/studentPractice";
import { ACTIVITY_TYPE_LABEL } from "@/types/learning";
import type { StudentAssignmentSummary } from "@/types/learning";

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
    // "most of them": written answers wait for a teacher's marks
    // (learning_service.submit_attempt sets PENDING_REVIEW), the same word
    // HOW_IT_WORKS below and the sign-in page use.
    description: "Short sets of questions your teacher assigns from the chapter you're on, most of them marked the moment you submit.",
    tone: "accent",
    // Was "Soon". Live -- evidence: /student/practice lists GET
    // /learning/assignments; /student/practice/[assignmentTargetId] runs
    // POST /learning/attempts -> PUT .../answers -> POST .../submit -> GET
    // .../result end to end; RoleShell's NAV gives "Daily Practice" a real
    // href. README "Status" records student "Today's Practice" as shipped,
    // and the admin dashboard's "Daily Learning Loop" stage lists "Students
    // attempt it and get an instant, auto-marked score" as live.
    status: "live",
    href: PRACTICE_LIST_HREF,
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
 * assigned yet, so the page teaches them what to expect (HowPracticeWorks,
 * below).
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
    step: "Your teacher assigns it",
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
    body: "Check the correct answer for anything you got wrong, and try again if you have attempts left.",
  },
];

// The "no app to install" promises, re-checked 30 Sep 2026. The last
// one was "Nothing is graded until you are ready", reworded to name the
// actual trigger (the Submit button -- learning_service.submit_attempt).
// The second was "Works on a shared phone or tablet" until 4 Oct 2026:
// "shared" was never checked on a real shared device, so it says only what
// is checked -- all three student screens are laid out for a 320px phone
// upwards (the slice 5 browser suite), and need nothing but a browser.
const GOOD_TO_KNOW = [
  "No app to install",
  "Works on a phone, a tablet or a laptop",
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
 *  (globals.css). */
function SkeletonLine({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block animate-pulse rounded-full bg-ink-100", className)} />;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; summary: PracticeSummary };

/** One practice set as a single link row: one tab stop, the whole row is
 *  the target (a Class 5 thumb on a shared tablet shouldn't have to find a
 *  small button). Mirrors a Daily Practice card, compressed, and reads its
 *  label and its destination from the same place that card does
 *  (lib/studentPractice.ts). */
function AssignmentRow({ item, today }: { item: StudentAssignmentSummary; today: string }) {
  const action = practiceAction(item);
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
          // Same tones, and the same "So Far", as Daily Practice's score
          // badge: a score a teacher has not finished marking is not shown
          // as if it were the whole of it.
          <Badge tone={stillBeingMarked(item) ? "neutral" : score.finalScore === score.maxScore ? "success" : "accent"} className="tabular">
            {score.finalScore}/{score.maxScore}
            {stillBeingMarked(item) ? " So Far" : ""}
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

/** The card under the masthead: what to do next, in the detail the
 *  masthead's one line skips. */
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
        {/* No max-w-prose (1 Oct 2026): the card bounds it, and on a
            single-column tablet layout the cap split it in two with the
            card's width still free. */}
        <p className="text-sm leading-relaxed text-content-muted text-pretty">
          School networks can be slow, and this usually works on a second try.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="secondary" size="sm" leadingIcon={<RefreshCcw className="h-4 w-4" />} onClick={onRetry}>
            Try Again
          </Button>
          <InlineLink href={PRACTICE_LIST_HREF}>Open {PRACTICE_LIST_NAME}</InlineLink>
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
          // The same words as the Daily Practice list in this state, so the
          // two screens a student moves between never describe it twice.
          status={{ label: "Nothing Assigned Yet", tone: "brand" }}
          title="Nothing to practise today"
          description="Your first practice set will show up here once your teacher assigns it. Each set says how long it should take."
          // Replaced 30 Sep 2026: "Your streak and progress start counting
          // from your first practice" (no streak exists anywhere in backend/
          // or frontend/) and "Anything you get wrong comes back later"
          // (README: Foundation Repair "not yet built"; nothing re-sets a
          // missed question automatically). Both below are shipped behaviour:
          // submit_attempt marks on submit (all but written answers, which
          // wait for a teacher -- hence "most"); GET .../result returns the
          // correct answer for each wrong one.
          points={[
            "Most questions are marked the moment you submit",
            "You'll see the correct answer for anything you got wrong",
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
              : `In the same order as your ${PRACTICE_LIST_NAME} list`}
          </p>
        </div>
      </div>
      <ul className="space-y-2">
        {rows.map((item) => (
          <AssignmentRow key={item.assignmentTargetId} item={item} today={today} />
        ))}
      </ul>
      <PanelFooter>
        <InlineLink href={PRACTICE_LIST_HREF}>
          {listCount > rows.length
            ? `See All ${listCount} In ${PRACTICE_LIST_NAME}`
            : caughtUp
              ? `See Everything In ${PRACTICE_LIST_NAME}`
              : `Open ${PRACTICE_LIST_NAME}`}
        </InlineLink>
      </PanelFooter>
    </PanelStack>
  );
}

/**
 * "How practice works", for a student nothing has been set for yet: four
 * things the shipped flow does, and four that are worth knowing before the
 * first set arrives. It was the right-hand panel of the old hero; as a card
 * of its own it has room to be read, and it is on paper, where a numbered
 * list is easier on a ten-year-old's eye than it was on frosted glass.
 */
function HowPracticeWorks() {
  return (
    <Card className="animate-fade-up delay-210">
      <CardBody className="space-y-6 sm:p-8">
        <div className="flex items-start gap-3">
          <CardIcon tone="brand">
            <Route className="h-5 w-5" aria-hidden />
          </CardIcon>
          <div>
            <CardTitle>How Practice Works</CardTitle>
            {/* content-subtle on white: 6.4:1. */}
            <p className="mt-0.5 text-xs text-content-subtle">Four steps, the same every time</p>
          </div>
        </div>
        <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {HOW_IT_WORKS.map((item, index) => (
            <li key={item.step} className="flex items-start gap-3 rounded-2xl border border-line bg-surface-muted/70 p-4">
              {/* White on brand-700: 10.3:1 -- the same numbered chip a
                  question carries on the practice page. */}
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-700 font-display text-sm font-semibold tabular text-white shadow-brand"
              >
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-content">{item.step}</span>
                {/* content-muted on the muted cell: 8.0:1. */}
                <span className="mt-0.5 block text-[0.8125rem] leading-relaxed text-content-muted">{item.body}</span>
              </span>
            </li>
          ))}
        </ol>
        <ul className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-5">
          {GOOD_TO_KNOW.map((point) => (
            // content-muted on white: 8.6:1; the tick is jade-600 (a graphic,
            // 3.4:1) and says nothing the words do not.
            <li key={point} className="flex items-center gap-2 text-[0.8125rem] font-medium text-content-muted">
              <Check className="h-4 w-4 shrink-0 text-jade-600" strokeWidth={2.6} aria-hidden />
              {point}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

export default function StudentDashboardPage() {
  const session = useProtectedPage("STUDENT");
  const { user, status } = session;
  const [assignments, setAssignments] = useState<StudentAssignmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Same request as Daily Practice's load(). Kept deliberately small: a
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
      ? { kind: "ready", summary: summarisePractice(assignments) }
      : { kind: "loading" };

  // The masthead's figures. `null` while the list loads (a placeholder
  // bar); a dash if it could not be read, with the card below saying why --
  // never a zero, which would read as "nothing to do". A hint appears only
  // once the number it describes is known. The same rules the Teacher and
  // Admin mastheads follow.
  const summary = state.kind === "ready" ? state.summary : null;
  const figure = (value: number | undefined) => (state.kind === "loading" ? null : state.kind === "error" ? "—" : (value ?? 0));
  // Under a dash, why it is a dash: the words the Teacher dashboard uses.
  const failed = state.kind === "error" ? "Couldn't load" : undefined;
  const latest = summary ? latestScore(summary) : null;
  const stats: PageHeaderStat[] = [
    {
      label: "Not Started",
      value: figure(summary?.notStarted),
      hint: summary ? (summary.notStarted > 0 ? "Waiting for you to begin" : "Nothing new waiting") : failed,
      // One tinted cell at most: the set that is already open comes before
      // the ones that are not, and that is the one the next step names.
      tone: summary && summary.inProgress === 0 && summary.notStarted > 0 ? "attention" : "default",
    },
    {
      label: "In Progress",
      value: figure(summary?.inProgress),
      hint: summary ? (summary.inProgress > 0 ? "Still open, so carry on any time" : "Nothing left half done") : failed,
      tone: summary && summary.inProgress > 0 ? "attention" : "default",
    },
    {
      label: "Completed",
      value: figure(summary?.completed.length),
      hint: summary
        ? summary.countable > 0
          ? `Of ${summary.countable} ${setWord(summary.countable)} from your teacher`
          : "Nothing assigned yet"
        : failed,
      // Jade once everything assigned is done: the tint says what "All 2 sets
      // are done" says in words (WCAG 1.4.1).
      tone: summary && summary.countable > 0 && summary.waiting.length === 0 ? "good" : "default",
    },
    {
      label: "Latest Score",
      value:
        state.kind === "loading" ? null : state.kind === "error" ? (
          "—"
        ) : latest ? (
          <>
            {latest.finalScore}
            <span className="text-content-inverse-muted"> / {latest.maxScore}</span>
          </>
        ) : (
          // Not a failure and not a zero: there is no marked set to have a
          // score. Quieter than a figure, as PercentText draws "no average
          // yet" on the Teacher mastheads; the hint says it in words.
          <span className="text-content-inverse-muted">&mdash;</span>
        ),
      hint: summary
        ? latest
          ? latest.stillBeingMarked
            ? `So far, in ${latest.title}, until your teacher's marks are in`
            : latest.title
          : "No marked set yet"
        : failed,
    },
  ];

  const liveModules = MODULES.filter((m) => m.status === "live").length;

  return (
    // The dashboard level of the workspace wash: the stronger of the two
    // and the only one that drifts, as on the Teacher and Admin dashboards.
    // components/brand/Ambience.tsx has the measurements behind both.
    <RoleShell role="STUDENT" user={user} ambience="dashboard">
      {/* space-y-10, the same rhythm as the Admin and Teacher dashboards. */}
      <div className="space-y-10">
        <PageHeader
          surface="masthead"
          size="lg"
          // The one masthead that drifts; PageHeader.tsx has why.
          drift
          eyebrow={greeting}
          title={
            <>
              {/* text-gradient-warm (white to saffron), as on the Teacher
                  dashboard: text-gradient-brand, which this used on the
                  canvas, is indigo on indigo here. PageHeader.tsx has its
                  contrast at the gradient's darkest stop. */}
              Hello, <span className="text-gradient-warm">{firstName}</span>
            </>
          }
          // Was "...your lessons and daily practice will show up right here".
          // Lessons aren't live (see MODULES), so it promises only what this
          // page actually shows.
          description="This is your learning space. Whenever your teacher assigns practice, it shows up right here first."
          stats={stats}
          meta={
            classLabel || student?.studentCode ? (
              <>
                {/* `inverse`, Badge's tone for indigo chrome. "Student
                    Code", the name the sign-in page, Your Details below and
                    the school's own roster give it; this chip alone said
                    "ID". */}
                {classLabel ? <Badge tone="inverse">{classLabel}</Badge> : null}
                {student?.studentCode ? <Badge tone="inverse">Student Code {student.studentCode}</Badge> : null}
              </>
            ) : undefined
          }
        >
          <MastheadNextStep step={studentNextStep(state)} checkingLabel="Checking your practice" />
        </PageHeader>

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
                <DetailRow label="Student Code" value={student?.studentCode ?? "—"} />
              </dl>
              {/* content-muted on surface-brand: 7.8:1. Pinned to the card's
                  foot (mt-auto) so it lines up with Up Next's footer link.
                  "Your teacher", not "your class teacher": the product has
                  no class-teacher role. And not "they can correct it": no
                  teacher screen edits a student's details -- the school
                  admin issues them (People). */}
              <p className="mt-auto flex items-start gap-2.5 rounded-2xl bg-surface-brand p-3.5 text-[0.8125rem] leading-relaxed text-content-muted">
                <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                Something here looks wrong? Tell your teacher. Your school admin looks after these details.
              </p>
            </PanelStack>
          </StretchCard>
        </SplitLayout>

        {state.kind === "ready" && state.summary.countable === 0 ? <HowPracticeWorks /> : null}

        <section aria-labelledby="modules-heading" className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="modules-heading" className="font-display text-display-sm text-content">
                What you&apos;ll find here
              </h2>
              {/* content-muted, not content-subtle: this sits straight on
                  the canvas, over the wash (Ambience.tsx's one rule). */}
              <p className="mt-1 text-sm text-content-muted">
                Anything marked Live opens from here. The others are not open yet. There is nothing to install.
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
