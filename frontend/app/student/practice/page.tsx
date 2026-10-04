"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, CalendarClock, CheckCircle2, Circle, Clock, PlayCircle, RefreshCcw, Repeat, Sparkles } from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SessionGate } from "@/components/SessionGate";
import { PathIllustration } from "@/components/brand/Graphics";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ACTIVITY_TYPE_LABEL } from "@/types/learning";
import type { StudentAssignmentSummary } from "@/types/learning";

/*
 * Today's Practice -- Phase 2b/c visual pass (30 Sep 2026).
 *
 * Presentation only: the request, the sort, actionForAssignment and every
 * number on each card are exactly as they were. What changed is how it
 * reads -- skeleton cards while loading instead of one line of text, the
 * list split into "waiting" and "done" (the same sorted order, just with a
 * heading where the first finished set begins), a status disc and rail on
 * each card so the state reads at a glance, and measured contrast notes.
 *
 * Correctness follow-up, same day -- no longer presentation only:
 *  - "Attempt X of Y" counts against maxAttempts + bonusAttempts (the
 *    ceiling start_attempt enforces), not maxAttempts alone.
 *  - SKIPPED gets its own group, out of the "Done" count (matching the
 *    student dashboard's summarise()).
 *  - Due dates parse as local dates, not UTC midnight.
 *  - The header no longer promises a daily release that doesn't exist.
 *  - Card actions are links styled as buttons, not <Button> inside <Link>.
 */

const STATUS_TONE: Record<StudentAssignmentSummary["status"], BadgeTone> = {
  PENDING: "brand",
  IN_PROGRESS: "warning",
  COMPLETED: "success",
  SKIPPED: "neutral",
};

const STATUS_LABEL: Record<StudentAssignmentSummary["status"], string> = {
  PENDING: "Not Started",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  SKIPPED: "Skipped",
};

// Today's Practice sorts the not-yet-done work to the top -- a student
// opening this page should see what's waiting on them before what's
// already behind them.
const STATUS_ORDER: Record<StudentAssignmentSummary["status"], number> = {
  IN_PROGRESS: 0,
  PENDING: 1,
  COMPLETED: 2,
  SKIPPED: 3,
};

// Per-status card chrome. The disc is a graphic (3:1 minimum): brand-700 on
// brand-50 9.3:1, saffron-900 on saffron-100 8.6:1, jade-700 on jade-50
// 6.8:1, ink-600 on ink-100 6.3:1. The rail down the card's edge is pure
// decoration -- the status Badge beside the title always says it in words.
const STATUS_CHROME: Record<StudentAssignmentSummary["status"], { disc: string; rail: string; icon: React.ReactNode }> = {
  PENDING: {
    disc: "bg-brand-50 text-brand-700 ring-brand-100",
    rail: "bg-brand-300",
    icon: <Circle className="h-[1.15rem] w-[1.15rem]" aria-hidden />,
  },
  IN_PROGRESS: {
    disc: "bg-saffron-100 text-saffron-900 ring-saffron-200",
    rail: "bg-accent-gradient",
    icon: <PlayCircle className="h-[1.15rem] w-[1.15rem]" aria-hidden />,
  },
  COMPLETED: {
    disc: "bg-jade-50 text-jade-700 ring-jade-100",
    rail: "bg-jade-300",
    icon: <CheckCircle2 className="h-[1.15rem] w-[1.15rem]" aria-hidden />,
  },
  SKIPPED: {
    disc: "bg-ink-100 text-ink-600 ring-ink-200",
    rail: "bg-ink-200",
    icon: <Circle className="h-[1.15rem] w-[1.15rem]" aria-hidden />,
  },
};

const STAGGER = ["delay-70", "delay-140", "delay-210", "delay-280", "delay-350", "delay-420"];

/** "2026-09-14" -> "14 Sep 2026", parsed as a *local* date (30 Sep 2026).
 *  This used to be new Date(value), which reads a plain "YYYY-MM-DD" as UTC
 *  midnight -- so anywhere west of Greenwich the card said "Due 13 Sep" for
 *  a set due on the 14th. Same fix as the student dashboard's formatDay:
 *  teachers set dueDate from a plain <input type="date">
 *  (app/teacher/assignments), so this is the shape it arrives in; anything
 *  else is shown as stored. Output format unchanged. */
function formatDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * A navigation action that looks like a Button but *is* a link (30 Sep 2026).
 *
 * Each card used to wrap <Button> in <Link> -- one interactive element
 * nested in another (invalid HTML, and two tab stops for one action). Same
 * fix, same reasoning, as the student dashboard's HeroAction. The class
 * strings copy components/ui/Button's BASE, VARIANTS.primary /
 * VARIANTS.secondary, SIZES.md and HAS_SHEEN verbatim, including the
 * hover/press wash and the primary sheen layer (Button doesn't export them
 * -- keep in step). Only BASE's disabled: and aria-busy classes are left
 * out: a link has no disabled or loading state. Focus is Button's own
 * shadow-focus-ring, which reads on these white cards -- the dashboard's
 * white outline exists only for its indigo hero.
 */
function LinkAction({
  href,
  variant,
  icon,
  className,
  children,
}: {
  href: string;
  variant: "primary" | "secondary";
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
        "h-11 px-5 text-sm",
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

function actionForAssignment(item: StudentAssignmentSummary): { label: string; tone: "primary" | "secondary"; href: string } {
  const base = `/student/practice/${item.assignmentTargetId}`;
  if (item.status === "COMPLETED" && item.latestAttempt) {
    // Route straight to the result view for the existing attempt -- the
    // detail page must NOT call POST /attempts here, or "View Result"
    // would silently burn a re-attempt every time a student re-opens it.
    return { label: "View Result", tone: "secondary", href: `${base}?attemptId=${item.latestAttempt.id}&view=result` };
  }
  if (item.status === "IN_PROGRESS") return { label: "Continue", tone: "primary", href: base };
  return { label: "Start", tone: "primary", href: base };
}

export default function StudentPracticePage() {
  const session = useProtectedPage("STUDENT");
  const { user, status } = session;
  const [assignments, setAssignments] = useState<StudentAssignmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<{ assignments: StudentAssignmentSummary[] }>("/learning/assignments");
      const sorted = [...data.assignments].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
      setAssignments(sorted);
    } catch (err) {
      setError(errorMessage(err, "load your practice"));
    } finally {
      setLoading(false);
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

  // Display grouping only: `assignments` is already sorted by STATUS_ORDER
  // (in progress, not started, completed, skipped), so these three slices
  // are that same order with a heading where each group begins.
  //
  // Three groups, not two (30 Sep 2026): SKIPPED used to be lumped in with
  // COMPLETED under "Done", inflating its count. The student dashboard's
  // summarise() deliberately leaves SKIPPED out of both its "waiting" and
  // "done" counts -- a skipped set is neither -- so it gets its own group
  // here, below "Done" and never counted in it. Nothing in backend/app sets
  // SKIPPED today (grep: its only occurrence is the column comment on
  // AssignmentTarget.status, models/learning.py:251; learning_service only
  // ever writes IN_PROGRESS and COMPLETED), so this path is unreachable for
  // now -- it's here so the day something does skip a set, it isn't
  // silently miscounted or dropped.
  const waiting = assignments?.filter((a) => a.status === "IN_PROGRESS" || a.status === "PENDING") ?? [];
  const completed = assignments?.filter((a) => a.status === "COMPLETED") ?? [];
  const skipped = assignments?.filter((a) => a.status === "SKIPPED") ?? [];

  function renderCard(item: StudentAssignmentSummary, index: number) {
    const action = actionForAssignment(item);
    const dueDate = formatDate(item.dueDate);
    const score = item.latestAttempt?.evaluation;
    const chrome = STATUS_CHROME[item.status];
    // The real ceiling (30 Sep 2026): the assignment's shared maxAttempts
    // plus this student's own teacher-granted bonusAttempts -- the same sum
    // learning_service.start_attempt enforces. Dividing by maxAttempts alone
    // made a granted retry invisible: the card read "Attempt 2 of 2" while
    // a third was actually available.
    const allowedAttempts = item.maxAttempts + item.bonusAttempts;
    // 30 Sep 2026: while a set is IN_PROGRESS, latestAttempt IS the open
    // attempt itself (start_attempt returns the existing row on resume
    // rather than creating a new one, and _latest_attempt_summary just
    // mirrors that ordering) -- so attemptNumber already names the attempt
    // under way and must not be bumped again. The old "+1 unless COMPLETED"
    // rule bumped it anyway, so attempt 1 in progress read "Attempt 2 of Y"
    // until it was the very last attempt (where the Math.min cap happened
    // to hide it). Only PENDING (no attempt exists yet, latestAttempt is
    // always null -- target.status only ever moves PENDING -> IN_PROGRESS
    // -> COMPLETED, never back) needs the +1, to name the attempt about to
    // be started.
    const currentAttemptNumber =
      item.status === "PENDING" ? (item.latestAttempt?.attemptNumber ?? 0) + 1 : (item.latestAttempt?.attemptNumber ?? allowedAttempts);
    return (
      <Card
        as="li"
        key={item.assignmentTargetId}
        className={cn("animate-fade-up", STAGGER[Math.min(index, STAGGER.length - 1)])}
      >
        <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", chrome.rail)} />
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <span
              aria-hidden
              className={cn(
                "hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset sm:flex",
                chrome.disc,
              )}
            >
              {chrome.icon}
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={STATUS_TONE[item.status]} dot pulse={item.status === "IN_PROGRESS"}>
                  {STATUS_LABEL[item.status]}
                </Badge>
                <Badge tone="neutral">{ACTIVITY_TYPE_LABEL[item.learningActivity.activityType]}</Badge>
                {score && item.status === "COMPLETED" ? (
                  <Badge
                    tone={score.finalScore === score.maxScore ? "success" : "accent"}
                    icon={<CheckCircle2 className="h-3 w-3" />}
                    className="tabular"
                  >
                    {score.finalScore}/{score.maxScore}
                  </Badge>
                ) : null}
              </div>
              <h3 className="font-display text-lg font-semibold leading-snug text-content text-balance">
                {item.learningActivity.title}
              </h3>
              {/* content-subtle on white: 6.4:1. Icons carry no meaning the
                  words beside them don't. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-content-subtle">
                {item.learningActivity.estimatedMinutes ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" aria-hidden />
                    {item.learningActivity.estimatedMinutes} min
                  </span>
                ) : null}
                {dueDate ? (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                    Due {dueDate}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1.5 tabular">
                  <Repeat className="h-3.5 w-3.5" aria-hidden />
                  Attempt {Math.min(currentAttemptNumber, allowedAttempts)} of {allowedAttempts}
                </span>
              </div>
            </div>
          </div>
          <LinkAction
            href={action.href}
            variant={action.tone}
            icon={<PlayCircle className="h-4 w-4" />}
            className="shrink-0"
          >
            {action.label}
          </LinkAction>
        </CardBody>
      </Card>
    );
  }

  return (
    <RoleShell role="STUDENT" user={user}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Daily Practice"
          title={
            <>
              Today&apos;s Practice, <span className="text-gradient-brand">{firstName}</span>
            </>
          }
          // Was "...Finish what's pending, then come back tomorrow for the
          // next one" -- a daily release that doesn't exist. models/
          // learning.py documents pacing_day as scheduling guidance "not a
          // constraint the attempt-lifecycle logic ... ever checks"; practice
          // arrives whenever a teacher assigns it (30 Sep 2026). The new
          // ending is what the shipped flow does, in the dashboard's words
          // ("it shows up right here first").
          description="Short sets of questions your teacher assigns from the chapter you're on. Finish what's waiting — anything new your teacher sets will show up right here."
          meta={
            assignments && assignments.length > 0 ? (
              // Counts the "Waiting for you" group exactly (30 Sep 2026):
              // it was every status but COMPLETED, which would have counted
              // a SKIPPED set as pending -- see the grouping note above.
              <Badge tone="brand" dot pulse>
                {waiting.length} Pending
              </Badge>
            ) : null
          }
          actions={
            <Button variant="secondary" size="sm" leadingIcon={<RefreshCcw className="h-4 w-4" />} onClick={load} loading={loading}>
              Refresh
            </Button>
          }
        />

        {error ? (
          // coral-800 on coral-50: 8.7:1.
          <div role="alert" className="flex items-start gap-3 rounded-2xl border border-coral-200 bg-coral-50 p-4 animate-scale-in">
            <AlertCircle className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-coral-600" aria-hidden />
            <div className="space-y-1">
              <p className="text-[0.875rem] font-medium leading-[1.55] text-coral-800">{error}</p>
              <p className="text-[0.8125rem] leading-relaxed text-coral-800">
                Nothing you&rsquo;ve done is lost. Use Refresh above to try again.
              </p>
            </div>
          </div>
        ) : null}

        {!error && assignments && assignments.length === 0 ? (
          <Card className="animate-fade-up">
            <CardBody className="sm:p-9">
              <EmptyState
                illustration={<PathIllustration />}
                status={{ label: "Nothing Assigned Yet", tone: "brand" }}
                title="Nothing to practise today"
                description="When your teacher assigns your first practice set, it will show up here — usually ten to fifteen minutes' work."
                // Copy corrected 30 Sep 2026 (the one non-visual change on
                // this page): it promised "Your streak starts counting" --
                // no streak exists anywhere in backend/ or frontend/ -- and
                // "Anything you get wrong comes back later, not never",
                // which is Foundation Repair, "not yet built" per README.
                // Both replacements are shipped behaviour (submit_attempt
                // marks on submit; GET .../result returns the correct answer
                // for each wrong one), and match the student dashboard.
                points={["Each set is marked the moment you submit it", "You'll see the right answer for anything you got wrong"]}
              />
            </CardBody>
          </Card>
        ) : null}

        {assignments && assignments.length > 0 ? (
          <div className="space-y-8">
            {/* font-sans on the group labels below: globals.css gives every
                h2 the display serif, so these small tracked uppercase labels
                were rendering in Fraunces -- the only eyebrow-style label in
                the product that wasn't in the sans (cf. Curriculum Studio's
                "Chapter status", the dashboards' "Next in the calendar"). */}
            {waiting.length > 0 ? (
              <section aria-labelledby="practice-waiting" className="space-y-3">
                <h2 id="practice-waiting" className="flex items-center gap-2 font-sans text-eyebrow font-bold uppercase text-content-subtle">
                  Waiting for you
                  <span className="tabular text-content">{waiting.length}</span>
                </h2>
                <ul className="space-y-3">{waiting.map((item, index) => renderCard(item, index))}</ul>
              </section>
            ) : null}
            {completed.length > 0 ? (
              <section aria-labelledby="practice-finished" className="space-y-3">
                <h2 id="practice-finished" className="flex items-center gap-2 font-sans text-eyebrow font-bold uppercase text-content-subtle">
                  Done
                  <span className="tabular text-content">{completed.length}</span>
                </h2>
                <ul className="space-y-3">
                  {completed.map((item, index) => renderCard(item, waiting.length + index))}
                </ul>
              </section>
            ) : null}
            {/* Unreachable today (nothing sets SKIPPED -- see the grouping
                note above), and kept out of "Done" when it isn't. */}
            {skipped.length > 0 ? (
              <section aria-labelledby="practice-skipped" className="space-y-3">
                <h2 id="practice-skipped" className="flex items-center gap-2 font-sans text-eyebrow font-bold uppercase text-content-subtle">
                  Skipped
                  <span className="tabular text-content">{skipped.length}</span>
                </h2>
                <ul className="space-y-3">
                  {skipped.map((item, index) => renderCard(item, waiting.length + completed.length + index))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}

        {loading && !assignments ? (
          // Placeholder cards in the shape of the real ones -- not a spinner.
          // Pulse stops under prefers-reduced-motion (globals.css).
          <div aria-busy="true" className="space-y-3">
            <span className="sr-only" role="status">
              Loading your practice list
            </span>
            {[0, 1, 2].map((i) => (
              <Card key={i} aria-hidden className={cn("animate-fade-up", STAGGER[i])}>
                <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <span className="hidden h-11 w-11 shrink-0 animate-pulse rounded-2xl bg-ink-100 sm:block" />
                  <span className="flex-1 space-y-2.5">
                    <span className="flex gap-2">
                      <span className="block h-6 w-24 animate-pulse rounded-full bg-ink-100" />
                      <span className="block h-6 w-20 animate-pulse rounded-full bg-ink-100" />
                    </span>
                    <span className="block h-5 w-2/3 animate-pulse rounded-full bg-ink-100" />
                    <span className="block h-3 w-1/3 animate-pulse rounded-full bg-ink-100" />
                  </span>
                  <span className="block h-11 w-28 shrink-0 animate-pulse rounded-full bg-ink-100" />
                </CardBody>
              </Card>
            ))}
          </div>
        ) : null}

        <Card tone="brand" className="animate-fade-up">
          <CardBody className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            {/* content-muted on surface-brand: 7.8:1. */}
            <p className="text-[0.8125rem] leading-relaxed text-content-muted">
              Answers save automatically as you go, so it&apos;s safe to close this and come back later — nothing is lost until you submit.
            </p>
          </CardBody>
        </Card>
      </div>
    </RoleShell>
  );
}
