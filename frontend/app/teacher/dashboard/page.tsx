"use client";

/**
 * Teacher dashboard.
 *
 * Phase 2b pass (30 Sep 2026). This page used to be entirely hardcoded: a
 * five-row READINESS list ("Class rosters linked to you: Not Started",
 * "Assignments and marking: Planned", ...) and a "No Classes Linked Yet"
 * empty state that said the same thing to every teacher forever --
 * including teachers who already had sections, a published calendar and
 * assignments with scored attempts behind them. Same class of bug as the
 * Admin dashboard's old "Rollout Status" (fixed in Phase 2a).
 *
 * Every claim on the page is now either derived from a live response or,
 * where no endpoint available to a TEACHER can prove it, stated as a
 * dated static claim with the evidence beside it. Sources -- all four are
 * already called by the TEACHER role elsewhere, nothing new on the backend:
 *  - GET /teacher-assignments/my-sections   (get_current_teacher; the
 *    teacher's own current TeacherSectionAssignment rows)
 *  - GET /curriculum-admin/school-curriculum-maps   (TEACHER-readable via
 *    _resolve_school_id_for_read; always the teacher's own school)
 *  - GET /learning/activities?chapterId=   (ADMIN/SUPER_ADMIN/TEACHER;
 *    used by teacher/assignments today)
 *  - GET /learning/assignments   (for a TEACHER, only rows where
 *    assigned_by_user_id is them -- routes_learning.list_assignments)
 * Each is loaded and fails independently: one endpoint being down turns
 * only its own rows into "Couldn't check", never into a guess.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Circle,
  CircleDashed,
  ClipboardCheck,
  ClipboardList,
  Compass,
  IdCard,
  ListChecks,
  Users,
} from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardIcon, CardTitle } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { DetailRow, ModuleCard } from "@/components/ui/ModuleCard";
import { RosterIllustration } from "@/components/brand/Graphics";
import { api, apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ACTIVITY_TYPE_LABEL } from "@/types/learning";
import type { Assignment, LearningActivity } from "@/types/learning";
import type { SchoolCurriculumMapEntry } from "@/types/curriculum";

/** Date the static claims below (the "planned" checklist row and the
 *  toolkit statuses) were last checked against the code. The live rows
 *  need no date -- they are re-read on every visit. */
const STATIC_CLAIMS_VERIFIED_ON = "30 Sep 2026";

/** One of the teacher's own current sections -- the subset of
 *  routes_teacher_assignments.py's _assignment_dict this page reads. Same
 *  shape as teacher/assignments/page.tsx's; declared locally to keep this
 *  change inside the teacher pages. boardCourseName is the course's
 *  display name (e.g. "Mathematics"), not the board. */
type TeacherSection = {
  id: string;
  classLevelCode: string | null;
  section: string;
  boardCourseId: string;
  boardCourseName: string | null;
};

type Loadable<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "error"; message: string };

const LOADING = { state: "loading" } as const;

/** How many of the school's published, mapped chapters have at least one
 *  published learning activity -- i.e. something a teacher can actually
 *  pick in Assign Practice (which filters to PUBLISHED activities too). */
type PracticeCoverage = { chapters: number; withPractice: number };

function useTeacherSignals(enabled: boolean) {
  const [sections, setSections] = useState<Loadable<TeacherSection[]>>(LOADING);
  const [maps, setMaps] = useState<Loadable<SchoolCurriculumMapEntry[]>>(LOADING);
  const [practice, setPractice] = useState<Loadable<PracticeCoverage>>(LOADING);
  const [assignments, setAssignments] = useState<Loadable<Assignment[]>>(LOADING);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const fail = (set: (value: Loadable<never>) => void) => (err: unknown) => {
      if (!cancelled) set({ state: "error", message: apiErrorMessage(err) });
    };

    api
      .get<{ sections: TeacherSection[] }>("/teacher-assignments/my-sections")
      .then(({ data }) => {
        if (!cancelled) setSections({ state: "ok", data: [...data.sections].sort(compareSections) });
      })
      .catch(fail(setSections));

    api
      .get<{ assignments: Assignment[] }>("/learning/assignments")
      .then(({ data }) => {
        if (cancelled) return;
        const newestFirst = [...data.assignments].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
        setAssignments({ state: "ok", data: newestFirst });
      })
      .catch(fail(setAssignments));

    api
      .get<{ schoolCurriculumMaps: SchoolCurriculumMapEntry[] }>("/curriculum-admin/school-curriculum-maps")
      .then(async ({ data }) => {
        if (cancelled) return;
        const rows = data.schoolCurriculumMaps;
        setMaps({ state: "ok", data: rows });

        // One request per distinct published chapter in the calendar. A
        // school's calendar is a term's worth of chapters (Class 5 Maths is
        // 15), so this stays small; unpublished chapters are skipped
        // because Assign Practice never offers them anyway.
        const chapterIds = Array.from(
          new Set(rows.filter((m) => m.chapterStatus === "PUBLISHED").map((m) => m.chapterId)),
        );
        try {
          const flags = await Promise.all(
            chapterIds.map((chapterId) =>
              api
                .get<{ activities: LearningActivity[] }>("/learning/activities", { params: { chapterId } })
                .then(({ data: body }) => body.activities.some((a) => a.status === "PUBLISHED")),
            ),
          );
          if (!cancelled) {
            setPractice({ state: "ok", data: { chapters: chapterIds.length, withPractice: flags.filter(Boolean).length } });
          }
        } catch (err) {
          // All or nothing: a partial count would under-report and read as
          // a real number.
          fail(setPractice)(err);
        }
      })
      .catch((err) => {
        fail(setMaps)(err);
        fail(setPractice)(err);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { sections, maps, practice, assignments };
}

type Signals = ReturnType<typeof useTeacherSignals>;

/** Class numerically ("10" after "9"), then section, then course. */
function compareSections(a: TeacherSection, b: TeacherSection): number {
  const byClass = (Number(a.classLevelCode) || 0) - (Number(b.classLevelCode) || 0);
  if (byClass !== 0) return byClass;
  return a.section.localeCompare(b.section) || (a.boardCourseName ?? "").localeCompare(b.boardCourseName ?? "");
}

/** The calendar rows that apply to one section: same class AND same
 *  course. A mapping is one schedule per class, shared by every section
 *  (curriculum.py: section was removed from SchoolCurriculumMap on 19 Aug
 *  2026), so class + course is the full match. */
function mapsForSection(maps: SchoolCurriculumMapEntry[], section: TeacherSection) {
  return maps.filter((m) => m.className === section.classLevelCode && m.boardCourseId === section.boardCourseId);
}

// --- small helpers, same behaviour as admin/dashboard's ------------------

/** Local YYYY-MM-DD, so "running now" is the viewer's own calendar day, not
 *  UTC's (at 4am IST, UTC is still on yesterday). */
function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "2026-09-14" -> "14 Sep", parsed as a local date (new Date("2026-09-14")
 *  is UTC midnight, which renders as the 13th west of Greenwich). */
function formatDay(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(date);
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Placeholder bars while live data loads -- the shape of what's coming,
 *  not a spinner. Pulse is switched off under prefers-reduced-motion
 *  (globals.css). */
function SkeletonLine({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block animate-pulse rounded-full bg-ink-100", className)} />;
}

/** A link that reads as a quiet text action. brand-700 on white is 10.3:1,
 *  on the brand-tinted card 9.3:1. */
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

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="min-w-0">
      <p className="font-display text-display-sm tabular text-content">{value}</p>
      {/* content-subtle on white: 6.4:1. */}
      <p className="mt-0.5 text-xs font-medium text-content-subtle">{label}</p>
    </div>
  );
}

/** coral-700 on white: 7.3:1; the icon carries the state as well. */
function InlineError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 text-[0.8125rem] font-medium leading-relaxed text-coral-700">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

// --- readiness checklist ---------------------------------------------------

type CheckState = "ready" | "partial" | "waiting" | "planned" | "checking" | "unknown";

type Check = {
  title: string;
  state: CheckState;
  /** One line of evidence: the number or fact the state was derived from. */
  detail: string;
  /** Overrides the state's default badge wording where it would misread. */
  badge?: string;
};

/** Half-filled ring for "partly ready" -- lucide has none, and it is the
 *  same glyph the Admin dashboard's rollout rail uses for a half-shipped
 *  stage, so the two pages speak one visual language. */
function PartialGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 1.75a6.25 6.25 0 0 1 0 12.5Z" fill="currentColor" />
    </svg>
  );
}

// Each disc is a graphic, so the bar is WCAG 1.4.11's 3:1 non-text contrast
// against its own fill: white on jade-500 3.4:1, jade-600 on jade-50 4.8:1,
// ink-600 on ink-100 6.3:1, ink-600 on ink-200 5.5:1, coral-700 on coral-50
// 6.7:1. The badge beside every row states the same thing in words, so
// colour is never the only carrier (WCAG 1.4.1).
const CHECK_STYLE: Record<CheckState, { badge: string; tone: BadgeTone; icon: React.ReactNode; disc: string }> = {
  ready: {
    badge: "Ready",
    tone: "success",
    icon: <CheckCircle2 className="h-4 w-4" aria-hidden />,
    disc: "bg-jade-500 text-white",
  },
  partial: {
    badge: "In Progress",
    tone: "warning",
    icon: <PartialGlyph />,
    disc: "bg-jade-50 text-jade-600 ring-1 ring-inset ring-jade-100",
  },
  waiting: {
    badge: "Not Started",
    tone: "neutral",
    icon: <CircleDashed className="h-4 w-4" aria-hidden />,
    disc: "bg-ink-100 text-ink-600",
  },
  planned: {
    badge: "Planned",
    tone: "neutral",
    icon: <Circle className="h-4 w-4" aria-hidden />,
    disc: "bg-ink-200 text-ink-600",
  },
  checking: {
    badge: "Checking",
    tone: "neutral",
    icon: <CircleDashed className="h-4 w-4 animate-spin-slow" aria-hidden />,
    disc: "bg-ink-100 text-ink-600",
  },
  unknown: {
    badge: "Couldn't Check",
    tone: "neutral",
    icon: <AlertCircle className="h-4 w-4" aria-hidden />,
    disc: "bg-coral-50 text-coral-700 ring-1 ring-inset ring-coral-100",
  },
};

function buildChecklist({ sections, maps, practice, assignments }: Signals): Check[] {
  const checks: Check[] = [];

  // Static, and true by construction: useProtectedPage only lets this page
  // render (status "ready") after GET /auth/me confirmed a live, server-side
  // TEACHER session -- anything else is redirected to /login first.
  checks.push({
    title: "Your account and secure sign-in",
    state: "ready",
    detail: "Your session was verified by the server when this page opened.",
  });

  // Was the static "Class rosters linked to you: Not Started".
  checks.push(
    sections.state === "loading"
      ? { title: "Sections assigned to you", state: "checking", detail: "" }
      : sections.state === "error"
        ? { title: "Sections assigned to you", state: "unknown", detail: `Couldn't load your sections (${sections.message}).` }
        : sections.data.length > 0
          ? {
              title: "Sections assigned to you",
              state: "ready",
              detail: `${plural(sections.data.length, "section")}: ${sections.data
                .map((s) => `${s.classLevelCode ?? "?"}${s.section}`)
                .join(", ")}.`,
            }
          : {
              title: "Sections assigned to you",
              state: "waiting",
              detail: "None yet. Your school admin assigns each teacher to the sections they teach.",
            },
  );

  // Was the static "School curriculum imported: In Progress". Renamed on
  // purpose: import is a platform step a TEACHER can't observe
  // (GET /curriculum-admin/chapters is ADMIN/SUPER_ADMIN-only). What a
  // teacher can see -- and what actually gates their work -- is whether
  // chapters are mapped into their own school's calendar.
  const mapRows = maps.state === "ok" ? maps.data : [];
  const mappedChapterIds = new Set(mapRows.map((m) => m.chapterId));
  const classCount = new Set(mapRows.map((m) => m.className).filter(Boolean)).size;
  checks.push(
    maps.state === "loading"
      ? { title: "Chapters in your school's calendar", state: "checking", detail: "" }
      : maps.state === "error"
        ? { title: "Chapters in your school's calendar", state: "unknown", detail: `Couldn't load the calendar (${maps.message}).` }
        : mappedChapterIds.size > 0
          ? {
              title: "Chapters in your school's calendar",
              state: "ready",
              detail: `${plural(mappedChapterIds.size, "chapter")} mapped${classCount > 0 ? ` across ${plural(classCount, "class", "classes")}` : ""}.`,
            }
          : {
              title: "Chapters in your school's calendar",
              state: "waiting",
              detail: "Your school admin hasn't mapped a chapter into the calendar yet.",
            },
  );

  // Was the static "Question bank reviewed and published: In Progress".
  // Derived from each mapped chapter's chapterStatus. What PUBLISHED
  // proves: routes_curriculum_admin.py refuses to publish a chapter unless
  // every one of its concept lessons has at least one APPROVED/PUBLISHED
  // question (CHAPTER_NOT_READY). It does NOT prove every question in the
  // chapter was reviewed -- hence "chapters", not "question bank".
  // A chapter must be PUBLISHED to be mapped, but can later be moved back,
  // so this can legitimately be partial.
  const publishedIds = new Set(mapRows.filter((m) => m.chapterStatus === "PUBLISHED").map((m) => m.chapterId));
  checks.push(
    maps.state === "loading"
      ? { title: "Chapters reviewed and published", state: "checking", detail: "" }
      : maps.state === "error"
        ? { title: "Chapters reviewed and published", state: "unknown", detail: "Depends on the calendar, which couldn't load." }
        : mappedChapterIds.size === 0
          ? { title: "Chapters reviewed and published", state: "waiting", detail: "Nothing in the calendar to review yet." }
          : publishedIds.size === mappedChapterIds.size
            ? {
                title: "Chapters reviewed and published",
                state: "ready",
                detail: `All ${plural(mappedChapterIds.size, "mapped chapter")} — every lesson has approved questions.`,
              }
            : {
                title: "Chapters reviewed and published",
                state: publishedIds.size > 0 ? "partial" : "waiting",
                detail: `${publishedIds.size} of ${mappedChapterIds.size} mapped chapters published; the rest are back in review.`,
              },
  );

  // New row. The real gate on assigning: a chapter only offers practice
  // once its learning activities are generated and published, and both are
  // SUPER_ADMIN-only calls (routes_learning.py generate_activities /
  // publish_activity) with no UI yet -- so "published chapter" and "can be
  // assigned" are genuinely different facts. Counted the same way Assign
  // Practice filters (status === "PUBLISHED").
  checks.push(
    practice.state === "loading"
      ? { title: "Practice ready to assign", state: "checking", detail: "" }
      : practice.state === "error"
        ? { title: "Practice ready to assign", state: "unknown", detail: `Couldn't check practice (${practice.message}).` }
        : practice.data.chapters === 0
          ? { title: "Practice ready to assign", state: "waiting", detail: "No published chapter in the calendar yet." }
          : practice.data.withPractice === practice.data.chapters
            ? {
                title: "Practice ready to assign",
                state: "ready",
                detail: `Every published chapter in the calendar has practice (${practice.data.chapters}).`,
              }
            : {
                title: "Practice ready to assign",
                state: practice.data.withPractice > 0 ? "partial" : "waiting",
                detail: `${practice.data.withPractice} of ${plural(practice.data.chapters, "published chapter")} ${practice.data.withPractice === 1 ? "has" : "have"} practice; the platform team publishes the rest.`,
              },
  );

  // Was the static "Assignments and marking: Planned". Assigning, attempting
  // and auto-marking are live end to end (admin/dashboard.tsx's "Daily
  // Learning Loop" evidence: POST /learning/assignments -> student attempt
  // -> learning_service.grade_answer marks on submit). "In Use" rather than
  // "Ready" once they have assigned, since that is the stronger fact.
  checks.push(
    assignments.state === "loading"
      ? { title: "Assigning and auto-marking practice", state: "checking", detail: "" }
      : assignments.state === "error"
        ? {
            title: "Assigning and auto-marking practice",
            state: "unknown",
            detail: `Couldn't load your assignments (${assignments.message}).`,
          }
        : assignments.data.length > 0
          ? {
              title: "Assigning and auto-marking practice",
              state: "ready",
              badge: "In Use",
              detail: `You've set ${plural(assignments.data.length, "assignment")}; each is marked the moment a student submits.`,
            }
          : {
              title: "Assigning and auto-marking practice",
              state: "waiting",
              badge: "Not Used Yet",
              detail: "Live, and waiting for your first assignment.",
            },
  );

  // Static, checked 30 Sep 2026 -- nothing a TEACHER can call could prove
  // otherwise, because it doesn't exist: grade_answer is all-or-nothing per
  // question; Evaluation.final_score always equals auto_score (teacher
  // score/rubric/override fields are deferred to Phase 4 in
  // models/learning.py); no endpoint writes a manual score. README records
  // Phase 4 (School marking engine) as "not started".
  checks.push({
    title: "Part marks and teacher-awarded scores",
    state: "planned",
    detail: "Answers are marked right or wrong today; part marks arrive with the marking engine.",
  });

  return checks;
}

function ReadinessCard({ checks }: { checks: Check[] }) {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <CardIcon tone="accent">
          <ListChecks className="h-5 w-5" aria-hidden />
        </CardIcon>
        <div>
          <CardTitle>Ready to Teach?</CardTitle>
          <p className="mt-0.5 text-xs text-content-subtle">Checked live against your school each time you open this page</p>
        </div>
      </div>

      <ol className="space-y-4">
        {checks.map((check) => {
          const style = CHECK_STYLE[check.state];
          return (
            <li key={check.title} className="flex gap-3.5">
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", style.disc)}>
                {style.icon}
              </span>
              <span className="min-w-0 flex-1 pt-0.5">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold text-content">{check.title}</span>
                  <Badge tone={style.tone} size="sm">
                    {check.badge ?? style.badge}
                  </Badge>
                </span>
                {check.state === "checking" ? (
                  <SkeletonLine className="mt-2 h-3 w-48" />
                ) : (
                  // content-muted on white: 8.6:1.
                  <span className="mt-1 block text-[0.8125rem] leading-relaxed text-content-muted">{check.detail}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="border-t border-line pt-4 text-xs text-content-subtle">
        Live rows are re-read on every visit. The planned row was checked against the build on{" "}
        {STATIC_CLAIMS_VERIFIED_ON}.
      </p>
    </div>
  );
}

// --- next step ---------------------------------------------------------------

type NextStep = { title: string; body: string; action?: { href: string; label: string } };

/** The single most useful thing to do next, from the same signals as the
 *  checklist -- walked in the order the work actually unblocks. A signal
 *  that failed to load is skipped rather than guessed at; the checklist
 *  already shows it as "Couldn't Check". Returns null while loading. */
function deriveNextStep({ sections, maps, practice, assignments }: Signals): NextStep | null {
  if ([sections, maps, practice, assignments].some((s) => s.state === "loading")) return null;

  if (sections.state === "ok" && sections.data.length === 0) {
    return {
      title: "Ask your school admin to assign your sections",
      body: "Practice is set per section, and only an admin can assign a teacher to one. As soon as they do, your sections appear here and in Assign Practice.",
    };
  }
  if (maps.state === "ok" && maps.data.length === 0) {
    return {
      title: "Waiting on your school's calendar",
      body: "Your school admin maps chapters into the calendar class by class. Once one is mapped, you can assign its practice from here.",
    };
  }
  if (practice.state === "ok" && practice.data.chapters > 0 && practice.data.withPractice === 0) {
    return {
      title: "Practice for your chapters is on its way",
      body: "Chapters are in the calendar, but their practice sets haven't been published yet. That step is done by the platform team — nothing is needed from you.",
    };
  }
  if (assignments.state === "ok" && assignments.data.length === 0) {
    return {
      title: "Assign your first practice",
      body: "Pick a chapter, an activity and one of your sections. Students see it straight away, and every answer is marked when they submit.",
      action: { href: "/teacher/assignments", label: "Assign Practice" },
    };
  }
  if (assignments.state === "ok") {
    return {
      title: "See how your sections did",
      body: "Open any assignment to see each student's score and answers, and grant another attempt where it would help.",
      action: { href: "/teacher/assignments", label: "View Results" },
    };
  }
  return {
    title: "Some of your setup couldn't be checked",
    body: "Part of this page couldn't load just now; the checklist shows which. Everything is still available from Assignments.",
    action: { href: "/teacher/assignments", label: "Open Assignments" },
  };
}

function NextStepCard({ step }: { step: NextStep | null }) {
  return (
    <Card tone="brand" className="animate-fade-up">
      {/* A saffron edge marks this as the one card that asks something of
          the teacher -- the same accent rule the page eyebrows use. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-accent-gradient" />
      <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
        <CardIcon tone="accent">
          <Compass className="h-5 w-5" aria-hidden />
        </CardIcon>
        {step ? (
          <div className="min-w-0 flex-1 space-y-1" aria-live="polite">
            {/* brand-700 on the brand-tinted card: 9.3:1. */}
            <p className="text-eyebrow font-bold uppercase text-content-brand">Your next step</p>
            <p className="font-display text-lg font-semibold tracking-tight text-content">{step.title}</p>
            {/* content-muted on surface-brand: 7.8:1. */}
            <p className="max-w-prose text-[0.875rem] leading-relaxed text-content-muted">{step.body}</p>
          </div>
        ) : (
          <div className="min-w-0 flex-1 space-y-2" aria-busy="true">
            <span className="sr-only" role="status">
              Checking your setup
            </span>
            <SkeletonLine className="h-3 w-24 bg-brand-100" />
            <SkeletonLine className="h-5 w-72 max-w-full bg-brand-100" />
            <SkeletonLine className="h-3 w-96 max-w-full bg-brand-100" />
          </div>
        )}
        {step?.action ? (
          <div className="shrink-0 sm:pl-2">
            <TextLink href={step.action.href}>{step.action.label}</TextLink>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

// --- your sections -----------------------------------------------------------

function SectionsPanel({ sections, maps, assignments }: Pick<Signals, "sections" | "maps" | "assignments">) {
  if (sections.state === "loading") {
    return (
      <div className="space-y-5" aria-busy="true">
        <span className="sr-only" role="status">
          Loading your sections
        </span>
        <SectionsHeading />
        <div className="grid grid-cols-3 gap-4 border-y border-line py-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <SkeletonLine className="h-7 w-10" />
              <SkeletonLine className="h-3 w-20" />
            </div>
          ))}
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <SkeletonLine className="h-12 w-12 rounded-2xl" />
            <div className="flex-1 space-y-2">
              <SkeletonLine className="h-4 w-40" />
              <SkeletonLine className="h-3 w-64" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (sections.state === "error") {
    return (
      <div className="space-y-4">
        <SectionsHeading />
        <InlineError>Couldn&rsquo;t load your sections just now ({sections.message}). Refresh to try again.</InlineError>
      </div>
    );
  }

  if (sections.data.length === 0) {
    // Replaces an always-on "No Classes Linked Yet" state, which promised
    // things that don't exist (per-student "where they are stuck",
    // "ordered by what needs you first"). This one only describes what
    // will really happen: the section appears here and in Assign Practice.
    return (
      <EmptyState
        illustration={<RosterIllustration />}
        status={{ label: "No Sections Assigned", tone: "neutral" }}
        title="No sections are linked to you yet"
        description="Your school admin assigns each teacher to the sections they teach. Once they assign yours, each one appears here with its course and where it is in the calendar — and you can assign practice to it straight away."
      />
    );
  }

  const today = todayIso();
  const mapRows = maps.state === "ok" ? maps.data : null;
  const classCount = new Set(sections.data.map((s) => s.classLevelCode)).size;

  return (
    <div className="space-y-6">
      <SectionsHeading />

      <div className="grid grid-cols-3 gap-4 border-y border-line py-4">
        <Stat value={sections.data.length} label={sections.data.length === 1 ? "Section" : "Sections"} />
        <Stat value={classCount} label={classCount === 1 ? "Class" : "Classes"} />
        <Stat
          value={assignments.state === "ok" ? assignments.data.length : "—"}
          label={assignments.state === "ok" && assignments.data.length === 1 ? "Assignment set" : "Assignments set"}
        />
      </div>

      <ul className="space-y-2.5">
        {sections.data.map((section, index) => {
          const rows = mapRows ? mapsForSection(mapRows, section) : [];
          // Running now: started on or before today and not yet ended.
          // Otherwise the soonest one still to start.
          const running = rows.find(
            (m) => m.plannedStartDate && m.plannedStartDate <= today && (!m.plannedEndDate || m.plannedEndDate >= today),
          );
          const upcoming = running
            ? undefined
            : rows
                .filter((m) => m.plannedStartDate && m.plannedStartDate > today)
                .sort((a, b) => (a.plannedStartDate ?? "").localeCompare(b.plannedStartDate ?? ""))[0];
          const focus = running ?? upcoming;
          const focusTitle = focus ? (focus.chapterTitle ?? focus.chapterCode ?? "Chapter") : null;

          let calendarLine: string;
          if (!mapRows) calendarLine = maps.state === "error" ? "Calendar couldn't load" : "Checking the calendar…";
          else if (rows.length === 0) calendarLine = "No chapters in the calendar for this class yet";
          else if (running)
            calendarLine = `Now: ${focusTitle}${running.plannedEndDate ? ` · until ${formatDay(running.plannedEndDate)}` : ""}`;
          else if (upcoming) calendarLine = `Next: ${focusTitle} · from ${formatDay(upcoming.plannedStartDate)}`;
          else calendarLine = `${plural(rows.length, "chapter")} in the calendar, none scheduled ahead`;

          return (
            <li
              key={section.id}
              className={cn(
                "flex items-center gap-3.5 rounded-2xl border border-line bg-surface-muted/70 px-3.5 py-3 animate-fade-up",
                ["delay-70", "delay-140", "delay-210", "delay-280", "delay-350", "delay-420"][index] ?? "delay-420",
              )}
            >
              {/* Monogram tile: brand-700 on brand-50, 9.3:1. */}
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 font-display text-lg font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
                {section.classLevelCode ?? "?"}
                {section.section}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-content">
                  Class {section.classLevelCode ?? "?"} &middot; Section {section.section}
                  {section.boardCourseName ? (
                    <span className="font-medium text-content-muted"> &middot; {section.boardCourseName}</span>
                  ) : null}
                </span>
                {/* content-subtle on the muted row: 6.1:1. */}
                <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-content-subtle">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{calendarLine}</span>
                </span>
              </span>
              {running ? (
                <Badge tone="success" dot className="shrink-0">
                  Now
                </Badge>
              ) : upcoming ? (
                <Badge tone="brand" className="shrink-0">
                  Upcoming
                </Badge>
              ) : null}
            </li>
          );
        })}
      </ul>

      <TextLink href="/teacher/assignments">Assign practice to a section</TextLink>
    </div>
  );
}

function SectionsHeading() {
  return (
    <div className="flex items-start gap-3">
      <CardIcon tone="brand">
        <Users className="h-5 w-5" aria-hidden />
      </CardIcon>
      <div>
        <CardTitle>Your Sections</CardTitle>
        <p className="mt-0.5 text-xs text-content-subtle">Assigned by your school admin, with where each is in the calendar</p>
      </div>
    </div>
  );
}

// --- recent practice ---------------------------------------------------------

const ASSIGNMENT_STATUS: Record<Assignment["status"], { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: "Active", tone: "success" },
  CLOSED: { label: "Closed", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
};

function RecentPractice({ assignments }: Pick<Signals, "assignments">) {
  const heading = (
    <div className="flex items-start gap-3">
      <CardIcon tone="jade">
        <ClipboardList className="h-5 w-5" aria-hidden />
      </CardIcon>
      <div>
        <CardTitle>Recent Practice</CardTitle>
        <p className="mt-0.5 text-xs text-content-subtle">What you&rsquo;ve assigned, newest first</p>
      </div>
    </div>
  );

  if (assignments.state === "loading") {
    return (
      <div className="space-y-5" aria-busy="true">
        <span className="sr-only" role="status">
          Loading your assignments
        </span>
        {heading}
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <SkeletonLine className="h-4 w-56" />
            <SkeletonLine className="h-3 w-40" />
          </div>
        ))}
      </div>
    );
  }

  if (assignments.state === "error") {
    return (
      <div className="space-y-4">
        {heading}
        <InlineError>Couldn&rsquo;t load your assignments just now ({assignments.message}).</InlineError>
        <TextLink href="/teacher/assignments">Open Assignments</TextLink>
      </div>
    );
  }

  const rows = assignments.data;
  const active = rows.filter((a) => a.status === "ACTIVE").length;

  return (
    <div className="space-y-5">
      {heading}
      {rows.length === 0 ? (
        <p className="text-[0.875rem] leading-relaxed text-content-muted">
          Nothing assigned yet. Your first assignment will show up here with how many students it reached.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 border-y border-line py-4">
            <Stat value={rows.length} label={rows.length === 1 ? "Assignment" : "Assignments"} />
            <Stat value={active} label="Active now" />
          </div>
          <ul className="space-y-3">
            {rows.slice(0, 3).map((assignment) => {
              const status = ASSIGNMENT_STATUS[assignment.status];
              return (
                <li key={assignment.id} className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-content">
                      {assignment.learningActivityTitle ?? "Learning activity"}
                    </span>
                    {/* Assignment.className holds the class only -- the
                        section a teacher picked isn't stored on the
                        assignment row (no column for it), so this can't
                        name it. */}
                    <span className="block truncate text-xs text-content-subtle">
                      {[
                        assignment.className ? `Class ${assignment.className}` : null,
                        plural(assignment.targetCount, "student"),
                        assignment.learningActivityType ? ACTIVITY_TYPE_LABEL[assignment.learningActivityType] : null,
                        assignment.dueDate ? `due ${formatDay(assignment.dueDate)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <Badge tone={status.tone} dot className="shrink-0">
                    {status.label}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <TextLink href="/teacher/assignments">{rows.length === 0 ? "Assign Practice" : "Open Assignments"}</TextLink>
    </div>
  );
}

// --- toolkit -----------------------------------------------------------------

type ModuleStatus = "live" | "soon" | "planned";

const MODULE_STATUS: Record<ModuleStatus, { label: string; tone: BadgeTone }> = {
  live: { label: "Live", tone: "success" },
  soon: { label: "Soon", tone: "neutral" },
  planned: { label: "Planned", tone: "neutral" },
};

type Module = {
  icon: React.ReactNode;
  title: string;
  description: string;
  tone: "brand" | "accent" | "jade" | "coral";
  status: ModuleStatus;
  /** Only live modules link anywhere -- RoleShell's rule too. */
  href?: string;
};

// Every card used to say "Soon", including Assignments, which has been live
// since 20 Aug 2026. Statuses re-checked on STATIC_CLAIMS_VERIFIED_ON.
const MODULES: Module[] = [
  {
    icon: <ClipboardList className="h-5 w-5" aria-hidden />,
    title: "Assignments",
    // Was "Set a chapter, a practice set or a mock paper ...". There is no
    // paper/mock model or route anywhere (admin dashboard: checked 30 Sep
    // 2026), so the mock paper is gone from the promise.
    description: "Assign a chapter's published practice to one of your sections, then review every student's answers.",
    tone: "accent",
    // Live: /teacher/assignments is a real route in RoleShell's NAV.
    status: "live",
    href: "/teacher/assignments",
  },
  {
    icon: <Users className="h-5 w-5" aria-hidden />,
    title: "My Classes",
    description: "A page for each section you teach, with every student's progress through the chapter.",
    tone: "brand",
    // "Soon": still `soon: true` in RoleShell's NAV with no route. Your
    // Sections above is the foundation (real sections, real calendar), but
    // there is no per-section or per-student view yet.
    status: "soon",
  },
  {
    icon: <ClipboardCheck className="h-5 w-5" aria-hidden />,
    title: "Marking",
    description: "School-style marking with part marks, so scores here mean the same thing they do on paper.",
    tone: "jade",
    // "Planned": same evidence as the checklist's planned row. Reviewing
    // auto-marked answers and granting re-attempts already live inside
    // Assignments; teacher-awarded marks do not exist yet.
    status: "planned",
  },
  {
    icon: <BarChart3 className="h-5 w-5" aria-hidden />,
    title: "Class Analytics",
    description: "Chapter-level mastery across a section, so reteaching targets the right two topics.",
    tone: "brand",
    // "Planned": the per-assignment results view (GET /learning/assignments/
    // {id}/targets) is one assignment's scores, not mastery analytics; no
    // analytics route exists.
    status: "planned",
  },
];

const STAGGER = ["delay-70", "delay-140", "delay-210", "delay-280"];

// --- page --------------------------------------------------------------------

export default function TeacherDashboardPage() {
  const { user, status } = useProtectedPage("TEACHER");
  const signals = useTeacherSignals(status === "ready");

  if (status !== "ready") {
    return <LoadingScreen />;
  }

  const teacher = user?.teacher ?? null;
  const checks = buildChecklist(signals);
  const checkable = checks.filter((c) => c.state !== "planned");
  const stillChecking = checkable.some((c) => c.state === "checking");
  const readyCount = checkable.filter((c) => c.state === "ready").length;
  const liveModules = MODULES.filter((m) => m.status === "live").length;

  return (
    <RoleShell role="TEACHER" user={user}>
      <div className="space-y-10">
        <PageHeader
          // Not "Teaching Workspace": RoleShell's breadcrumb already says
          // exactly that one line above (ROLE_TAGLINE.TEACHER).
          eyebrow="Your Teaching at a Glance"
          title={
            <>
              Welcome, <span className="text-gradient-brand">{user?.fullName ?? "Teacher"}</span>
            </>
          }
          // Was "Right now the workspace is waiting on the school's
          // curriculum import" -- true for no one in particular, forever.
          description="Your sections, your school's calendar and the practice you've set, checked live every time you open this page."
          meta={
            <>
              {teacher?.designation ? <Badge tone="brand">{teacher.designation}</Badge> : null}
              {teacher?.subjectSpecialization ? <Badge tone="neutral">{teacher.subjectSpecialization}</Badge> : null}
              {/* Derived from the checklist, so the header can never
                  disagree with it (the old "Setup in Progress" pulse was
                  hardcoded). */}
              {stillChecking ? (
                <Badge tone="neutral" dot pulse>
                  Checking Your Setup
                </Badge>
              ) : readyCount === checkable.length ? (
                <Badge tone="success" dot>
                  Ready to Teach
                </Badge>
              ) : (
                <Badge tone="accent" dot pulse>
                  {readyCount} of {checkable.length} Ready
                </Badge>
              )}
            </>
          }
        />

        <NextStepCard step={deriveNextStep(signals)} />

        {/* Two independent columns rather than two grid rows: the checklist
            is naturally taller than a short section list, and in a row
            layout that left a card-height gap under Your Sections. Stacked,
            each column just flows. Order on a phone: sections, practice,
            checklist, profile. */}
        <div className="grid items-start gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <Card className="animate-fade-up delay-70">
              <CardBody className="sm:p-8">
                <SectionsPanel sections={signals.sections} maps={signals.maps} assignments={signals.assignments} />
              </CardBody>
            </Card>

            <Card className="animate-fade-up delay-210">
              <CardBody>
                <RecentPractice assignments={signals.assignments} />
              </CardBody>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="animate-fade-up delay-140">
              <CardBody>
                <ReadinessCard checks={checks} />
              </CardBody>
            </Card>

            <Card tone="brand" className="animate-fade-up delay-280">
              <CardBody className="space-y-4">
                <div className="flex items-center gap-3">
                  <CardIcon tone="brand">
                    <IdCard className="h-5 w-5" aria-hidden />
                  </CardIcon>
                  <CardTitle>Your Profile</CardTitle>
                </div>
                <dl className="-mt-1">
                  <DetailRow label="Name" value={user?.fullName ?? "—"} />
                  <DetailRow label="Teacher Code" value={teacher?.teacherCode ?? "—"} />
                  <DetailRow label="Designation" value={teacher?.designation ?? "Not set"} />
                  <DetailRow label="Subject" value={teacher?.subjectSpecialization ?? "Not set"} />
                </dl>
              </CardBody>
            </Card>
          </div>
        </div>

        <section aria-labelledby="toolkit-heading" className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="toolkit-heading" className="font-display text-display-sm text-content">
                Your Toolkit
              </h2>
              <p className="mt-1 text-sm text-content-muted">
                Built for the way Indian schools actually teach &mdash; chapter by chapter, section by section.
              </p>
            </div>
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
                <li key={module.title} className={cn("animate-fade-up", STAGGER[index])}>
                  {module.href ? (
                    // Only a live module is wrapped in a link, so the card's
                    // hover lift never promises a click that goes nowhere.
                    // rounded-3xl keeps the focus outline on the card's corners.
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
