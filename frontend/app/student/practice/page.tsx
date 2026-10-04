"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, Circle, Clock, Hourglass, ListChecks, PlayCircle, RefreshCcw, Repeat, Sparkles } from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { PageHeader, type PageHeaderStat } from "@/components/ui/PageHeader";
import { LoadError } from "@/components/ui/AlertBanner";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SessionGate } from "@/components/SessionGate";
import { PathIllustration } from "@/components/brand/Graphics";
import { PercentText } from "@/components/tracker/TrackerBits";
import { api, describeApiError } from "@/lib/api";
import type { DescribedError } from "@/lib/errors";
import {
  PRACTICE_LIST_NAME,
  STATUS_LABEL,
  STATUS_ORDER,
  averageScore,
  practiceAction,
  setWord,
  stillBeingMarked,
  summarisePractice,
} from "@/lib/studentPractice";
import { cn } from "@/lib/utils";
import { ACTIVITY_TYPE_LABEL } from "@/types/learning";
import type { StudentAssignmentSummary } from "@/types/learning";

/*
 * Daily Practice -- Phase 2b/c visual pass (30 Sep 2026).
 *
 * Presentation only: the request, the sort, what a card's button does and
 * every number on each card are exactly as they were. What changed is how it
 * reads -- skeleton cards while loading instead of one line of text, the
 * list split into "waiting" and "done" (the same sorted order, just with a
 * heading where the first finished set begins), a status disc and rail on
 * each card so the state reads at a glance, and measured contrast notes.
 *
 * Correctness follow-up, same day -- no longer presentation only:
 *  - "Attempt X of Y" counts against maxAttempts + bonusAttempts (the
 *    ceiling start_attempt enforces), not maxAttempts alone.
 *  - SKIPPED gets its own group, out of the "Completed" count (matching
 *    the student dashboard, which counts with the same summarisePractice()).
 *  - Due dates parse as local dates, not UTC midnight.
 *  - The header no longer promises a daily release that doesn't exist.
 *  - Card actions are links styled as buttons (ButtonLink), not <Button>
 *    inside <Link>.
 *
 * The masthead (4 Oct 2026, UI revamp Phase B, slice 5). The page opened on
 * a title and a sentence set straight on the canvas, as every Student page
 * did after the Teacher and Admin ones had moved to the masthead. It now
 * opens on the same lit panel, carrying this list's own figures -- how many
 * sets are not started, in progress and done, and the average score across
 * the marked ones -- over the working level of the workspace wash.
 *
 *  - The page is called "Daily Practice", the name the rail gives it. Its
 *    title said "Today's Practice", and so did the way back from a set,
 *    which made one screen with two names.
 *  - The "N Pending" chip is the first two figures.
 *  - The three group labels sat on the canvas in content-subtle, which the
 *    wash leaves under 4.5:1 (Ambience.tsx's one rule); each is now a small
 *    surfaced chip.
 *  - The status vocabulary, the sort and what a card's button does come
 *    from lib/studentPractice.ts, shared with the dashboard.
 */

const STATUS_TONE: Record<StudentAssignmentSummary["status"], BadgeTone> = {
  PENDING: "brand",
  IN_PROGRESS: "warning",
  COMPLETED: "success",
  SKIPPED: "neutral",
};

// STATUS_LABEL and STATUS_ORDER are lib/studentPractice.ts's: the list sorts
// the not-yet-done work to the top -- a student opening this page should see
// what's waiting on them before what's already behind them.

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

/** A group's label -- "Waiting For You 2" -- as a small surfaced chip. It
 *  used to be bare text on the canvas in content-subtle, and with the wash
 *  behind the page that is under 4.5:1. On the chip (surface at 80%):
 *  content-subtle 6.0:1, the count in content 15:1. */
function GroupLabel({ id, count, children }: { id: string; count: number; children: React.ReactNode }) {
  return (
    // font-sans: globals.css gives every h2 the display serif, and this is
    // a small tracked label, like every other eyebrow in the product.
    <h2
      id={id}
      className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 px-3.5 py-1.5 font-sans text-eyebrow font-bold uppercase text-content-subtle shadow-xs backdrop-blur"
    >
      {children}
      <span className="tabular text-content">{count}</span>
    </h2>
  );
}

export default function StudentPracticePage() {
  const session = useProtectedPage("STUDENT");
  const { user, status } = session;
  const [assignments, setAssignments] = useState<StudentAssignmentSummary[] | null>(null);
  const [problem, setProblem] = useState<DescribedError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setProblem(null);
    try {
      const { data } = await api.get<{ assignments: StudentAssignmentSummary[] }>("/learning/assignments");
      const sorted = [...data.assignments].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
      setAssignments(sorted);
    } catch (err) {
      // No action phrase: the banner's own first line says what is missing.
      setProblem(describeApiError(err));
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

  // Display grouping only: `assignments` is already sorted by STATUS_ORDER
  // (in progress, not started, completed, skipped), so these three slices
  // are that same order with a heading where each group begins.
  //
  // Three groups, not two (30 Sep 2026): SKIPPED used to be lumped in with
  // COMPLETED under "Completed", inflating its count. summarisePractice()
  // (lib/studentPractice.ts) deliberately leaves SKIPPED out of both its
  // "waiting" and "completed" counts -- a skipped set is neither -- so it
  // gets its own group here, below "Completed" and never counted in it. Nothing in backend/app sets
  // SKIPPED today (grep: its only occurrence is the column comment on
  // AssignmentTarget.status, models/learning.py:251; learning_service only
  // ever writes IN_PROGRESS and COMPLETED), so this path is unreachable for
  // now -- it's here so the day something does skip a set, it isn't
  // silently miscounted or dropped.
  const waiting = assignments?.filter((a) => a.status === "IN_PROGRESS" || a.status === "PENDING") ?? [];
  const completed = assignments?.filter((a) => a.status === "COMPLETED") ?? [];
  const skipped = assignments?.filter((a) => a.status === "SKIPPED") ?? [];

  function renderCard(item: StudentAssignmentSummary, index: number) {
    const action = practiceAction(item);
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
                  // A score a teacher has not finished marking is said to
                  // be so far, here as on the result itself: "2/5" alone
                  // would read as the whole of it.
                  stillBeingMarked(item) ? (
                    <Badge tone="neutral" icon={<Hourglass className="h-3 w-3" />} className="tabular">
                      {score.finalScore}/{score.maxScore} So Far
                    </Badge>
                  ) : (
                    <Badge
                      tone={score.finalScore === score.maxScore ? "success" : "accent"}
                      icon={<CheckCircle2 className="h-3 w-3" />}
                      className="tabular"
                    >
                      {score.finalScore}/{score.maxScore}
                    </Badge>
                  )
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
          {/* A link that looks like a button (ButtonLink): one tab stop,
              and nothing interactive nested in anything interactive. */}
          <ButtonLink
            href={action.href}
            // A result is something to look back at; a set to start or carry
            // on with is the thing to do.
            variant={action.label === "View Result" ? "secondary" : "primary"}
            // A play mark for something to do, a list of ticks for something
            // to read: the result is not played.
            leadingIcon={action.label === "View Result" ? <ListChecks className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
            className="shrink-0"
          >
            {action.label}
          </ButtonLink>
        </CardBody>
      </Card>
    );
  }

  // The masthead's figures: the same list, counted. `null` while it loads
  // (a placeholder bar); a dash if it could not be read, with the banner
  // below saying why -- never a zero, which would read as "nothing to do".
  // If a refresh fails after a list has loaded, the list is still on screen
  // and so are its figures: what they count is what is shown.
  const summary = assignments ? summarisePractice(assignments) : null;
  const figure = (value: number | undefined) => (summary ? (value ?? 0) : problem ? "—" : null);
  // Under a dash, why it is a dash: the words the Teacher dashboard uses.
  const failed = !summary && problem ? "Couldn't load" : undefined;
  const average = summary ? averageScore(summary) : null;
  const stats: PageHeaderStat[] = [
    {
      label: "Not Started",
      value: figure(summary?.notStarted),
      hint: summary ? (summary.notStarted > 0 ? "Waiting for you to begin" : "Nothing new waiting") : failed,
      // One tinted cell at most: an open set comes before one not begun.
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
      tone: summary && summary.countable > 0 && summary.waiting.length === 0 ? "good" : "default",
    },
    {
      label: "Average Score",
      // PercentText prints a quiet dash when there is no marked set to
      // average -- not a failure, and not a zero. A set still waiting for
      // a teacher's marks is not a marked set (averageScore leaves it out).
      value: summary ? <PercentText percent={average ? average.percent : null} animated onDark /> : problem ? "—" : null,
      hint: summary ? (average ? `Across ${average.sets} marked ${setWord(average.sets)}` : "No marked set yet") : failed,
    },
  ];

  return (
    // The working level of the workspace wash: a step quieter than the
    // dashboard's and still, as on every Teacher and Admin working page.
    <RoleShell role="STUDENT" user={user} ambience="working">
      <div className="space-y-8">
        <PageHeader
          surface="masthead"
          eyebrow="Your Learning Space"
          title={PRACTICE_LIST_NAME}
          // Was "...Finish what's pending, then come back tomorrow for the
          // next one" -- a daily release that doesn't exist. models/
          // learning.py documents pacing_day as scheduling guidance "not a
          // constraint the attempt-lifecycle logic ... ever checks"; practice
          // arrives whenever a teacher assigns it (30 Sep 2026). The ending
          // is what the shipped flow does, in the dashboard's words ("it
          // shows up right here first").
          description="Short sets of questions your teacher assigns from the chapter you're on. Finish what's waiting. Anything new your teacher assigns will show up right here."
          stats={stats}
          actions={
            // `quiet`: Button's variant for indigo chrome. Its focus ring is
            // the masthead's (PageHeader applies it to everything inside).
            <Button variant="quiet" size="sm" leadingIcon={<RefreshCcw className="h-4 w-4" />} onClick={load} loading={loading}>
              Refresh
            </Button>
          }
        />

        {problem ? (
          <LoadError
            title="Your practice couldn’t be loaded. Nothing you’ve done is lost."
            problem={problem}
            onRetry={load}
          />
        ) : null}

        {!problem && assignments && assignments.length === 0 ? (
          <Card className="animate-fade-up">
            <CardBody className="sm:p-9">
              <EmptyState
                illustration={<PathIllustration />}
                status={{ label: "Nothing Assigned Yet", tone: "brand" }}
                title="Nothing to practise today"
                description="Your first practice set will show up here once your teacher assigns it. Each set says how long it should take before you start."
                // Copy corrected 30 Sep 2026 (the one non-visual change on
                // this page): it promised "Your streak starts counting" --
                // no streak exists anywhere in backend/ or frontend/ -- and
                // "Anything you get wrong comes back later, not never",
                // which is Foundation Repair, "not yet built" per README.
                // Both replacements are shipped behaviour (submit_attempt
                // marks on submit -- all but written answers, hence "most";
                // GET .../result returns the correct answer for each wrong
                // one), and match the student dashboard.
                points={["Most questions are marked the moment you submit", "You'll see the right answer for anything you got wrong"]}
              />
            </CardBody>
          </Card>
        ) : null}

        {assignments && assignments.length > 0 ? (
          <div className="space-y-8">
            {waiting.length > 0 ? (
              <section aria-labelledby="practice-waiting" className="space-y-3">
                <GroupLabel id="practice-waiting" count={waiting.length}>
                  Waiting For You
                </GroupLabel>
                <ul className="space-y-3">{waiting.map((item, index) => renderCard(item, index))}</ul>
              </section>
            ) : null}
            {completed.length > 0 ? (
              <section aria-labelledby="practice-finished" className="space-y-3">
                <GroupLabel id="practice-finished" count={completed.length}>
                  Completed
                </GroupLabel>
                <ul className="space-y-3">
                  {completed.map((item, index) => renderCard(item, waiting.length + index))}
                </ul>
              </section>
            ) : null}
            {/* Unreachable today (nothing sets SKIPPED -- see the grouping
                note above), and kept out of "Completed" when it isn't. */}
            {skipped.length > 0 ? (
              <section aria-labelledby="practice-skipped" className="space-y-3">
                <GroupLabel id="practice-skipped" count={skipped.length}>
                  Skipped
                </GroupLabel>
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
              Answers save automatically as you go, so it&apos;s safe to close a set and come back to it later. Nothing is handed in until you press Submit.
            </p>
          </CardBody>
        </Card>
      </div>
    </RoleShell>
  );
}
