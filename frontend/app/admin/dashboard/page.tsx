"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BookMarked,
  Building2,
  Check,
  CheckCircle2,
  Circle,
  CircleDashed,
  Database,
  FileSpreadsheet,
  GraduationCap,
  Library,
  ShieldCheck,
  Users,
} from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardIcon, CardTitle } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SessionGate } from "@/components/SessionGate";
import { DetailRow, ModuleCard } from "@/components/ui/ModuleCard";
import { PanelFooter, PanelStack, SplitColumn, SplitLayout, StretchCard } from "@/components/ui/SplitLayout";
import { BlueprintIllustration } from "@/components/brand/Graphics";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ChapterStatus, ChapterSummary, SchoolCurriculumMapEntry } from "@/types/curriculum";

/*
 * Build status shown to schools.
 *
 * Real schools read this page to decide what they can actually use, so
 * every state below is a factual claim, not decoration: over-claiming
 * sends a coordinator looking for a feature that isn't there, and
 * under-claiming hides one they're already paying for. Each non-obvious
 * state carries a comment saying exactly what was checked, in the code
 * and in the project's own status record (README "Status", reconciled 30
 * Sep 2026, and IMPLEMENTATION_ROADMAP.md's "where we are" block, which
 * agree with each other).
 *
 * Re-verified 30 Sep 2026 (Phase 2a admin pass) after a live-product audit
 * found a real, completed student practice attempt with a real score while
 * this list still called the whole learning loop "planned". Update
 * ROLLOUT_VERIFIED_ON whenever a state here is re-checked.
 */
const ROLLOUT_VERIFIED_ON = "30 Sep 2026";

// "partial" (added 30 Sep 2026) exists because the learning loop is
// genuinely half-shipped: its core is in students' hands, but part of what
// the stage promises is not. Neither "Live" nor "In Build" was true on its
// own, and picking either one misstates it.
type StageState = "done" | "partial" | "active" | "planned";

type Stage = {
  title: string;
  body: string;
  state: StageState;
  /** Only for "partial": what is usable today vs. still to come, so the
   *  split is stated, not left to the reader to guess from one badge. */
  shipped?: string[];
  pending?: string[];
};

const STAGES: Stage[] = [
  {
    title: "Platform and Secure Sign-In",
    body: "Role-based access for admins, teachers and students, with server-verified sessions and mandatory two-factor for admins.",
    state: "done",
  },
  {
    title: "Curriculum and Question Bank",
    body: "Chapters and their questions are reviewed, quality-checked and published, then mapped into each school's calendar.",
    // Was "active" (In Build). Changed 30 Sep 2026 -- evidence:
    //  - routes_curriculum_admin.py serves the full chapter/lesson/question
    //    status ladders, bulk-approve with automated quality checks, and
    //    school-curriculum-map create/reschedule/delete; app/admin/curriculum
    //    calls every one of them.
    //  - README "Status" and IMPLEMENTATION_ROADMAP.md both record Phase 2
    //    (Curriculum Studio) as done: all 15 Class 5 CBSE Maths chapters
    //    imported, reviewed and published. PROJECT_REFERENCE.md records a
    //    live production check of GET /curriculum-admin/chapters returning
    //    Chapter 1 as PUBLISHED with 500 questions, mapped into a school.
    // Scope note: question *import* is still an operator script
    // (backend/scripts/import_class5_maths.py) with no in-app upload -- that
    // gap is why the separate "Question Bank" module below stays In Build.
    state: "done",
  },
  {
    title: "Daily Learning Loop",
    body: "Practice that teachers assign, students attempt, and the platform marks the moment it's submitted.",
    // Was "planned". Changed to "partial" 30 Sep 2026 -- evidence:
    //  LIVE end to end: teacher POST /learning/assignments
    //  (app/teacher/assign since 1 Oct 2026) -> student POST /learning/attempts, PUT
    //  .../answers, POST .../submit, GET .../result
    //  (app/student/practice/[assignmentTargetId]) -> learning_service
    //  .grade_answer auto-marks and writes an Evaluation. Teachers also
    //  see per-question answers and can grant a re-attempt
    //  (POST .../targets/{id}/grant-attempt). PROJECT_REFERENCE.md records
    //  this proven through the real production UI (an 8/9 scored attempt),
    //  and the roadmap marks Phase 3 "underway, core loop live".
    //  NOT LIVE: (1) the five-day cycle -- models/learning.py documents
    //  pacing_day/pacing_mode as advisory only ("nothing in the attempt
    //  lifecycle reads or enforces it"), and no frontend file reads
    //  pacingDay beyond its type declaration; practice is released when a
    //  teacher assigns it, not on a schedule. (2) chapter lessons --
    //  CONCEPT_SIMPLE activities are never generated (learning.py's own
    //  docstring) and the student "My Lessons" nav row is still `soon`.
    // Operational caveat, not a status claim: learning activities are
    // generated/published through SUPER_ADMIN-only API calls with no UI yet,
    // so a chapter only has assignable practice once a platform operator
    // has run that step for it.
    state: "partial",
    shipped: [
      "Teachers assign published practice to a class",
      "Students attempt it and get an instant, auto-marked score",
      "Teachers review each answer and can grant a re-attempt",
    ],
    pending: ["Chapter lessons for students", "Automatic release on a five-day cycle"],
  },
  {
    title: "School Marking Engine",
    body: "Part marks, method marks and teacher-awarded scores, so results match what teachers give on paper.",
    // "planned" until 1 Oct 2026, now "partial". LIVE: teacher-awarded
    // marks for answers auto-marking can't score -- Constructed Response
    // attempts land in the Practice Tracker's Needs Review queue and a
    // teacher marks each answer 0..its marks (POST
    // /learning/tracker/attempts/{id}/grades; Evaluation.teacher_score,
    // final_score = auto + teacher, FINALISED once all are marked).
    // NOT LIVE: grade_answer is still all-or-nothing on auto-marked
    // questions (no method/part marks there, no teacher override of an
    // automatic mark), no rubric tables, and the measurement/unit-tolerance
    // spec is its own separate pass.
    state: "partial",
    shipped: ["Teachers mark written answers question by question"],
    pending: ["Part and method marks on auto-marked questions", "Unit and tolerance rules for measurement answers"],
  },
  {
    title: "Papers, Mocks and Reports",
    body: "Board-format papers and the analytics your leadership team will ask for.",
    // Left "planned" after checking, 30 Sep 2026: no paper/mock/report
    // model, route or page exists in backend/app or frontend/app. README
    // records Phases 5-8 as "not started".
    state: "planned",
  },
];

/** The rail glyph for a half-shipped stage: a ring with its right half
 *  filled. Drawn by hand because lucide has no half-filled circle, and the
 *  shape itself is the message -- somewhere between the empty ring of
 *  "planned" and the solid check of "live". */
function PartialGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 1.75a6.25 6.25 0 0 1 0 12.5Z" fill="currentColor" />
    </svg>
  );
}

// Every rail colour is a graphic, not text, so the bar is WCAG's 3:1
// non-text contrast against its own disc: white on jade-500 3.4:1,
// jade-600 on jade-50 4.8:1, brand-950 on saffron-400 9.2:1, ink-600 on
// ink-200 5.5:1. The badge beside each one carries the state in words.
const STAGE_STYLE: Record<StageState, { badge: string; tone: BadgeTone; icon: React.ReactNode; rail: string }> = {
  done: {
    badge: "Live",
    tone: "success",
    icon: <CheckCircle2 className="h-4 w-4" aria-hidden />,
    rail: "bg-jade-500 text-white ring-jade-100",
  },
  partial: {
    badge: "Partly Live",
    tone: "success",
    icon: <PartialGlyph />,
    rail: "bg-jade-50 text-jade-600 ring-jade-100",
  },
  active: {
    badge: "In Build",
    tone: "warning",
    icon: <CircleDashed className="h-4 w-4" aria-hidden />,
    rail: "bg-saffron-400 text-brand-950 ring-saffron-100",
  },
  planned: {
    badge: "Planned",
    tone: "neutral",
    icon: <Circle className="h-4 w-4" aria-hidden />,
    rail: "bg-ink-200 text-ink-600 ring-ink-100",
  },
};

type ModuleStatus = "live" | "build" | "soon" | "planned";

const MODULE_STATUS: Record<ModuleStatus, { label: string; tone: BadgeTone }> = {
  live: { label: "Live", tone: "success" },
  build: { label: "In Build", tone: "warning" },
  soon: { label: "Soon", tone: "neutral" },
  planned: { label: "Planned", tone: "neutral" },
};

type Module = {
  icon: React.ReactNode;
  title: string;
  description: string;
  tone: "brand" | "accent" | "jade" | "coral";
  status: ModuleStatus;
  /** Only live modules link anywhere -- the same rule RoleShell's rail
   *  follows (no href, no pretend link). */
  href?: string;
};

// Ordered by what an admin can use today, then by how close the rest are.
// The first question anyone opening this grid has is "what can I click?".
const MODULES: Module[] = [
  {
    icon: <Library className="h-5 w-5" aria-hidden />,
    title: "Curriculum Studio",
    description: "Review and publish chapters, then map them into your school's calendar, class by class.",
    tone: "brand",
    // Was "In Build". Live since Phase 2 -- same evidence as the Curriculum
    // stage above; /admin/curriculum is a real route in RoleShell's NAV.
    status: "live",
    href: "/admin/curriculum",
  },
  {
    icon: <Users className="h-5 w-5" aria-hidden />,
    title: "People",
    // Description narrowed 30 Sep 2026: it used to promise "who can see
    // which section". Teacher-to-section assignment exists only as an API
    // (routes_teacher_assignments.py) that no frontend file calls yet, so
    // that part belongs to Classes & Sections below, not here.
    description: "Create staff and student accounts, import rosters in bulk, and deactivate anyone who leaves.",
    tone: "jade",
    // Was "Soon". Live since 19 Aug 2026: /admin/people is a real route in
    // RoleShell's NAV, backed by routes_roster.py (create, list, bulk
    // import, activate/deactivate).
    status: "live",
    href: "/admin/people",
  },
  {
    icon: <Database className="h-5 w-5" aria-hidden />,
    title: "Question Bank",
    description: "Import from spreadsheets, review quality, and map every question to a chapter.",
    tone: "accent",
    // Left "In Build" after checking, 30 Sep 2026: question review and the
    // automated quality checks are live, but only inside Curriculum
    // Studio's chapter review. There is no import endpoint or upload UI
    // (import is backend/scripts/import_class5_maths.py, run by an
    // operator) and no standalone Question Bank route (RoleShell: soon).
    status: "build",
  },
  {
    icon: <GraduationCap className="h-5 w-5" aria-hidden />,
    title: "Classes & Sections",
    description: "The structure everything else hangs off — classes, sections and which teacher owns each.",
    tone: "brand",
    // Left "Soon" after checking, 30 Sep 2026: the teacher<->section
    // assignment API landed 20 Aug 2026 (routes_teacher_assignments.py,
    // mounted in main.py), but no page calls it and there is no route
    // (RoleShell: soon). Class and section are still free-text fields on
    // each student. Foundation laid, nothing an admin can open yet.
    status: "soon",
  },
  {
    icon: <FileSpreadsheet className="h-5 w-5" aria-hidden />,
    title: "Papers & Mocks",
    description: "Generate board-format papers from published content, with answer keys.",
    tone: "accent",
    // Left "Planned": no paper/mock model, route or page exists (checked 30 Sep 2026).
    status: "planned",
  },
  {
    icon: <BarChart3 className="h-5 w-5" aria-hidden />,
    title: "Reports",
    description: "Chapter mastery and cohort trends for class teachers and school leadership.",
    tone: "jade",
    // Left "Planned" (checked 30 Sep 2026). Teachers do have a per-
    // assignment results view (GET /learning/assignments/{id}/targets), but
    // that is one assignment's scores, not the mastery/cohort reporting
    // this card describes, and nothing reaches an admin.
    status: "planned",
  },
];

const STAGGER = ["delay-70", "delay-140", "delay-210", "delay-280", "delay-350", "delay-420"];

/** Local YYYY-MM-DD, so "is this chapter running now" compares against the
 *  viewer's own calendar day rather than UTC's -- at 4am IST, UTC is still
 *  on yesterday. */
function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "2026-09-14" -> "14 Sep". Parsed as a local date on purpose: new
 *  Date("2026-09-14") is UTC midnight, which renders as the 13th anywhere
 *  west of Greenwich. Anything unparseable is shown as stored. */
function formatDay(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(date);
}

/** Quiet placeholder bars while live data loads -- the shape of what is
 *  coming, not a spinner. Pulse is switched off with the rest of the
 *  motion under prefers-reduced-motion (globals.css). */
function SkeletonLine({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block animate-pulse rounded-full bg-ink-100", className)} />;
}

/** A link that reads as a quiet text action. brand-700 on white is 10.3:1. */
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

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-0">
      <p className="font-display text-display-sm tabular text-content">{value}</p>
      {/* content-subtle on white: 6.4:1. */}
      <p className="mt-0.5 text-xs font-medium text-content-subtle">{label}</p>
    </div>
  );
}

/**
 * The right-hand "what's actually live for us" panel.
 *
 * Replaces a hardcoded "Nothing is live for your school yet / No
 * Curriculum Published" empty state (30 Sep 2026), which was the same
 * class of bug as the stale Rollout list: it said the same thing to every
 * school forever, including the production school that had Chapter 1
 * published and mapped since August. It now reads the two endpoints the
 * Curriculum Studio page already uses -- nothing new on the backend:
 *  - ADMIN: their own school's map (school resolved server-side) plus the
 *    chapters they're allowed to map (published, in a published edition).
 *  - SUPER_ADMIN: school maps need a schoolId, and a platform admin has no
 *    single school, so this shows the platform-wide chapter pipeline
 *    instead.
 */
function CurriculumPanel({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  const [chapters, setChapters] = useState<ChapterSummary[] | null>(null);
  const [mappings, setMappings] = useState<SchoolCurriculumMapEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const requests: [Promise<ChapterSummary[]>, Promise<SchoolCurriculumMapEntry[] | null>] = [
      api.get<{ chapters: ChapterSummary[] }>("/curriculum-admin/chapters").then(({ data }) => data.chapters),
      isPlatformAdmin
        ? Promise.resolve(null)
        : api
            .get<{ schoolCurriculumMaps: SchoolCurriculumMapEntry[] }>("/curriculum-admin/school-curriculum-maps")
            .then(({ data }) => data.schoolCurriculumMaps),
    ];
    Promise.all(requests)
      .then(([chapterRows, mapRows]) => {
        if (cancelled) return;
        setChapters(chapterRows);
        setMappings(mapRows);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "load the curriculum status"));
      });
    return () => {
      cancelled = true;
    };
  }, [isPlatformAdmin]);

  const loading = !error && chapters === null;

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <span className="sr-only" role="status">
          Loading your curriculum
        </span>
        <div className="flex items-center gap-3">
          <SkeletonLine className="h-11 w-11 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <SkeletonLine className="h-4 w-40" />
            <SkeletonLine className="h-3 w-56" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <SkeletonLine className="h-7 w-10" />
              <SkeletonLine className="h-3 w-20" />
            </div>
          ))}
        </div>
        <SkeletonLine className="h-12 w-full rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <PanelStack gap="gap-4">
        <PanelHeading isPlatformAdmin={isPlatformAdmin} />
        {/* coral-700 on white: 7.3:1. */}
        <p role="alert" className="text-[0.8125rem] font-medium leading-relaxed text-coral-700">
          {error} Everything is still available in Curriculum Studio.
        </p>
        <PanelFooter>
          <TextLink href="/admin/curriculum">Open Curriculum Studio</TextLink>
        </PanelFooter>
      </PanelStack>
    );
  }

  const chapterRows = chapters ?? [];

  if (isPlatformAdmin) {
    return <PlatformPipeline chapters={chapterRows} />;
  }

  const mapRows = mappings ?? [];
  const available = chapterRows.length;

  if (mapRows.length === 0) {
    // Centred in whatever height the card is given: when the Rollout card
    // beside it stretches this one, a top-pinned empty state would leave
    // its lower half bare.
    return (
      <div className="flex flex-1 flex-col justify-center">
        <EmptyState
          illustration={<BlueprintIllustration />}
          status={
            available > 0
              ? { label: `${available} ${available === 1 ? "Chapter" : "Chapters"} Ready to Map`, tone: "brand" }
              : { label: "No Chapters Published Yet", tone: "neutral" }
          }
          title="Nothing is in your school's calendar yet"
          description={
            available > 0
              ? "Published chapters are ready for you. Map one into a class and its teachers can start assigning practice from it straight away."
              : "Chapters move through draft, review and publish before any school can use them. As soon as one is published, you can map it here."
          }
          actions={available > 0 ? <TextLink href="/admin/curriculum">Map a Chapter</TextLink> : undefined}
        />
      </div>
    );
  }

  const today = todayIso();
  const classCount = new Set(mapRows.map((m) => m.className).filter(Boolean)).size;
  // What's running now first, then what's next, then anything undated;
  // finished chapters drop off -- this is a "what's live" glance, not the
  // full map (that's one click away).
  const upcoming = mapRows
    .filter((m) => !m.plannedEndDate || m.plannedEndDate >= today)
    .sort((a, b) => (a.plannedStartDate ?? "9999").localeCompare(b.plannedStartDate ?? "9999"))
    .slice(0, 3);

  return (
    <PanelStack>
      <PanelHeading isPlatformAdmin={false} />

      <div className="grid grid-cols-3 gap-4 border-y border-line py-4">
        <Stat value={mapRows.length} label="In your calendar" />
        <Stat value={available} label="Published to map" />
        <Stat value={classCount} label={classCount === 1 ? "Class covered" : "Classes covered"} />
      </div>

      {upcoming.length > 0 ? (
        <div className="space-y-2.5">
          <p className="text-eyebrow font-bold uppercase text-content-subtle">Next in the calendar</p>
          <ul className="space-y-2">
            {upcoming.map((mapping) => {
              const running =
                Boolean(mapping.plannedStartDate) && mapping.plannedStartDate! <= today;
              const start = formatDay(mapping.plannedStartDate);
              const end = formatDay(mapping.plannedEndDate);
              return (
                <li
                  key={mapping.id}
                  className="flex items-center gap-3 rounded-2xl border border-line bg-surface-muted/70 px-3.5 py-3"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-jade-50 text-jade-700 ring-1 ring-inset ring-jade-100">
                    <BookMarked className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-content">
                      {mapping.chapterTitle ?? mapping.chapterCode ?? "Chapter"}
                    </span>
                    {/* content-subtle on the muted row: 6.2:1. */}
                    <span className="block truncate text-xs text-content-subtle">
                      {mapping.className ? `Class ${mapping.className}` : "All classes"}
                      {start || end ? ` · ${start ?? "—"} – ${end ?? "—"}` : " · Dates not set"}
                    </span>
                  </span>
                  {running ? (
                    <Badge tone="success" dot>
                      Now
                    </Badge>
                  ) : start ? (
                    <Badge tone="brand">Upcoming</Badge>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <PanelFooter>
        <TextLink href="/admin/curriculum">Manage in Curriculum Studio</TextLink>
      </PanelFooter>
    </PanelStack>
  );
}

function PanelHeading({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <CardIcon tone="jade">
        <BookMarked className="h-5 w-5" aria-hidden />
      </CardIcon>
      <div>
        <CardTitle>{isPlatformAdmin ? "Platform Curriculum" : "Your Curriculum"}</CardTitle>
        <p className="mt-0.5 text-xs text-content-subtle">
          {isPlatformAdmin
            ? "Every chapter on the platform, by where it sits in review"
            : "What your teachers can assign practice from"}
        </p>
      </div>
    </div>
  );
}

// Pipeline order and colour. Each segment is labelled in the legend with
// its count, so colour is never the only carrier (WCAG 1.4.1).
const PIPELINE: { status: ChapterStatus; label: string; bar: string }[] = [
  { status: "PUBLISHED", label: "Published", bar: "bg-jade-500" },
  { status: "REVIEW", label: "In review", bar: "bg-saffron-400" },
  { status: "DRAFT", label: "Draft", bar: "bg-ink-300" },
  { status: "ARCHIVED", label: "Archived", bar: "bg-coral-300" },
];

function PlatformPipeline({ chapters }: { chapters: ChapterSummary[] }) {
  const counts = PIPELINE.map((step) => ({
    ...step,
    count: chapters.filter((c) => c.status === step.status).length,
  }));
  const total = chapters.length;
  const summary = counts.map((c) => `${c.count} ${c.label.toLowerCase()}`).join(", ");

  return (
    <PanelStack>
      <PanelHeading isPlatformAdmin />

      {/* The pipeline is centred in whatever height the card is given.
          For a super admin this card sits beside the full Rollout timeline
          and is stretched to match it (SplitLayout), so a top-pinned block
          left most of the card bare. The legend is a per-status breakdown
          for the same reason: the same four counts, each on its own row
          with its own share of the total, instead of one wrapping line. */}
      <div className="relative flex flex-1 flex-col justify-center">
        {/* The kit's graph-paper wash (globals.css .bg-grid, "behind hero
            and empty-state areas"), radially masked: under a short card it
            is a faint halo behind the figures, and when the card is
            stretched it gives the extra height a surface to sit on. */}
        <span aria-hidden className="pointer-events-none absolute -inset-x-6 inset-y-0 bg-grid mask-fade-radial opacity-70 sm:-inset-x-8" />
        {total === 0 ? (
          <p className="relative text-sm leading-relaxed text-content-muted">
            No chapters have been imported yet. Imported chapters arrive in Draft and appear here.
          </p>
        ) : (
          <div className="relative space-y-5">
            <p className="flex items-baseline gap-2">
              <span className="font-display text-display-md tabular text-content">{total}</span>
              <span className="text-sm text-content-muted">{total === 1 ? "chapter" : "chapters"} in total</span>
            </p>
            {/* One bar, four segments, widths in proportion. A 2px paper gap
                between segments keeps adjacent colours from reading as one
                block on low-contrast projectors. */}
            <div role="img" aria-label={`Chapter pipeline: ${summary}.`} className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-ink-100">
              {counts
                .filter((c) => c.count > 0)
                .map((c) => (
                  <span key={c.status} className={cn("h-full first:rounded-l-full last:rounded-r-full", c.bar)} style={{ width: `${(c.count / total) * 100}%` }} />
                ))}
            </div>
            {/* Decorative repeat of the bar above, row by row; the bar's
                aria-label already says all of it, so the tracks are hidden. */}
            <ul className="divide-y divide-line/70 border-y border-line/70">
              {counts.map((c) => (
                <li key={c.status} className="flex items-center gap-3 py-2.5">
                  <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", c.bar)} />
                  <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-content-muted">{c.label}</span>
                  <span aria-hidden className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-ink-100 sm:block">
                    <span className={cn("block h-full rounded-full", c.bar)} style={{ width: `${(c.count / total) * 100}%` }} />
                  </span>
                  <span className="w-8 text-right text-[0.8125rem] font-semibold tabular text-content">{c.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <PanelFooter>
        <TextLink href="/admin/curriculum">Open Curriculum Studio</TextLink>
      </PanelFooter>
    </PanelStack>
  );
}

export default function AdminDashboardPage() {
  const session = useProtectedPage("ADMIN");
  const { user, status } = session;

  if (status !== "ready") {
    return <SessionGate session={session} />;
  }

  const schoolId = user?.admin?.schoolId ?? null;
  const isPlatformAdmin = user?.role === "SUPER_ADMIN";
  // The page itself is shared by both admin variants (useProtectedPage's
  // "ADMIN" argument above just means "either kind of admin may load this
  // page" -- see its own docstring), so the actual role shown in the
  // sidebar has to come from the real signed-in user, not that literal
  // string, or a super admin's tab would always display as a plain admin.
  const roleForShell = isPlatformAdmin ? "SUPER_ADMIN" : "ADMIN";

  // Derived from STAGES rather than typed out, so the header can never
  // disagree with the timeline under it again. (It used to say "Curriculum
  // in Build" in its own hardcoded badge long after that stopped being
  // true.)
  const liveCount = STAGES.filter((s) => s.state === "done").length;
  const currentStage = STAGES.find((s) => s.state === "partial" || s.state === "active");
  const liveModules = MODULES.filter((m) => m.status === "live").length;

  return (
    <RoleShell role={roleForShell} user={user}>
      <div className="space-y-10">
        <PageHeader
          // Not "School Control Centre": RoleShell's breadcrumb already
          // starts with exactly that, one line above -- and for a super
          // admin it says "Platform Control Centre", so repeating the
          // school wording here contradicted it.
          eyebrow={isPlatformAdmin ? "The Platform at a Glance" : "Your School at a Glance"}
          title={
            <>
              Welcome, <span className="text-gradient-brand">{user?.fullName ?? "Admin"}</span>
            </>
          }
          description="Set up the school, shape the curriculum, and control what teachers and students see. Modules open here as each one goes live."
          meta={
            <>
              <Badge tone="success" dot>
                {liveCount} of {STAGES.length} Stages Live
              </Badge>
              {currentStage ? (
                <Badge tone="brand" dot pulse>
                  Now Building: {currentStage.title}
                </Badge>
              ) : null}
              {isPlatformAdmin ? <Badge tone="neutral">Platform Admin</Badge> : null}
            </>
          }
        />

        {/* SplitLayout: both columns finish level. The grid already
            stretched here, but the right column was a plain space-y-4
            block, so its two cards stopped ~230px (school admin) to ~480px
            (super admin) short of Rollout's bottom edge and the gap sat on
            the bare canvas above Modules. Now the curriculum card takes up
            the slack and its link pins to its footer. */}
        <SplitLayout columns="lg:grid-cols-[0.95fr_1.05fr]">
          <StretchCard className="animate-fade-up">
            <PanelStack>
              <div className="flex items-start gap-3">
                <CardIcon tone="brand">
                  <ShieldCheck className="h-5 w-5" aria-hidden />
                </CardIcon>
                <div>
                  <CardTitle>Rollout</CardTitle>
                  <p className="mt-0.5 text-xs text-content-subtle">What your school can use today, and what&rsquo;s next</p>
                </div>
              </div>

              <ol className="space-y-5">
                {STAGES.map((stage, index) => {
                  const style = STAGE_STYLE[stage.state];
                  const isLast = index === STAGES.length - 1;
                  return (
                    <li key={stage.title} className="relative flex gap-4">
                      {/* One connector per stage, from this node down to the
                          next, instead of a single line behind the whole list:
                          the track can then be coloured by progress -- jade
                          past everything live, fading out of a half-shipped
                          stage, plain line beyond. It is also centred on the
                          node now (1rem); the old shared line sat ~0.3rem
                          left of centre, hidden only where a node covered it. */}
                      {!isLast ? (
                        <span
                          aria-hidden
                          className={cn(
                            "absolute left-[calc(1rem-0.5px)] top-8 -bottom-5 w-px",
                            stage.state === "done"
                              ? "bg-jade-300"
                              : stage.state === "partial"
                                ? "bg-gradient-to-b from-jade-300 to-line"
                                : "bg-line",
                          )}
                        />
                      ) : null}
                      <span
                        className={cn(
                          "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-surface",
                          style.rail,
                        )}
                      >
                        {style.icon}
                      </span>
                      <span className="min-w-0 flex-1 pt-0.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-content">{stage.title}</span>
                          <Badge tone={style.tone} size="sm">
                            {style.badge}
                          </Badge>
                        </span>
                        <span className="mt-1 block text-[0.8125rem] leading-relaxed text-content-muted">
                          {stage.body}
                        </span>
                        {stage.shipped || stage.pending ? (
                          <span className="mt-3 grid gap-3 rounded-2xl border border-line bg-surface-muted/70 p-3.5 sm:grid-cols-2">
                            {stage.shipped ? (
                              <span className="block space-y-1.5">
                                {/* jade-700 on the muted panel: 7.0:1. */}
                                <span className="block text-[0.625rem] font-bold uppercase tracking-eyebrow text-jade-700">
                                  Live now
                                </span>
                                {stage.shipped.map((item) => (
                                  <span key={item} className="flex items-start gap-2 text-[0.8125rem] leading-snug text-content-muted">
                                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-jade-600" aria-hidden />
                                    {item}
                                  </span>
                                ))}
                              </span>
                            ) : null}
                            {stage.pending ? (
                              <span className="block space-y-1.5">
                                <span className="block text-[0.625rem] font-bold uppercase tracking-eyebrow text-content-subtle">
                                  Still to come
                                </span>
                                {stage.pending.map((item) => (
                                  <span key={item} className="flex items-start gap-2 text-[0.8125rem] leading-snug text-content-muted">
                                    <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-content-subtle" aria-hidden />
                                    {item}
                                  </span>
                                ))}
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ol>

              {/* Dated, so a reader can judge how fresh the claims above are
                  -- and so the next person editing STAGES has a visible
                  reason to re-check them rather than just add to them. */}
              <PanelFooter>
                <p className="text-xs text-content-subtle">
                  Status checked against the live build on {ROLLOUT_VERIFIED_ON}.
                </p>
              </PanelFooter>
            </PanelStack>
          </StretchCard>

          <SplitColumn fill="first">
            <StretchCard className="animate-fade-up delay-70" bodyClassName="sm:p-8">
              <CurriculumPanel isPlatformAdmin={isPlatformAdmin} />
            </StretchCard>

            <Card tone="brand" className="animate-fade-up delay-140">
              <CardBody className="space-y-4">
                <div className="flex items-center gap-3">
                  <CardIcon tone="brand">
                    <Building2 className="h-5 w-5" aria-hidden />
                  </CardIcon>
                  <CardTitle>{isPlatformAdmin ? "Your Access" : "Your School"}</CardTitle>
                </div>
                <dl className="-mt-1">
                  <DetailRow label="Administrator" value={user?.fullName ?? "—"} />
                  <DetailRow label="Access Level" value={isPlatformAdmin ? "Platform Admin" : "School Admin"} />
                  <DetailRow
                    label="School ID"
                    value={
                      schoolId ? (
                        <span className="font-mono text-[0.75rem]">{schoolId}</span>
                      ) : (
                        "Platform-Wide Access"
                      )
                    }
                  />
                </dl>
              </CardBody>
            </Card>
          </SplitColumn>
        </SplitLayout>

        <section aria-labelledby="modules-heading" className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="modules-heading" className="font-display text-display-sm text-content">
                Modules
              </h2>
              <p className="mt-1 text-sm text-content-muted">
                Live modules open from here; the rest arrive here the moment they ship &mdash; nothing to install.
              </p>
            </div>
            <Badge tone="neutral">
              {liveModules} Live &middot; {MODULES.length - liveModules} Coming
            </Badge>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
                    // The card's own hover lift promises "this is clickable"
                    // -- only live modules are wrapped in a link to make that
                    // promise true. rounded-3xl matches the card so the focus
                    // outline follows its corners.
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
