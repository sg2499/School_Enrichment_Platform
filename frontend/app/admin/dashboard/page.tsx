"use client";

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
import { MastheadNextStep, type NextStep } from "@/components/ui/MastheadNextStep";
import { PageHeader, type PageHeaderStat } from "@/components/ui/PageHeader";
import { Card, CardBody, CardIcon, CardTitle } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { LoadError } from "@/components/ui/AlertBanner";
import { EmptyState } from "@/components/ui/EmptyState";
import { SessionGate } from "@/components/SessionGate";
import { DetailRow, ModuleCard } from "@/components/ui/ModuleCard";
import { PanelFooter, PanelStack, SplitColumn, SplitLayout, StretchCard } from "@/components/ui/SplitLayout";
import { BlueprintIllustration } from "@/components/brand/Graphics";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { PRODUCT_NAME } from "@/lib/brand";
import { ROLE_LABEL } from "@/lib/pageTitle";
import { classLabel, cn } from "@/lib/utils";
import type { ChapterStatus, ChapterSummary, SchoolCurriculumMapEntry, SchoolOption } from "@/types/curriculum";

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
  /** The same claim as a Super Admin reads it, where `body` speaks to one
   *  school ("your leadership team"). Most stages read the same for both. */
  platformBody?: string;
  state: StageState;
  /** Only for "partial": what is usable today vs. still to come, so the
   *  split is stated, not left to the reader to guess from one badge. */
  shipped?: string[];
  pending?: string[];
};

const STAGES: Stage[] = [
  {
    title: "Platform and Secure Sign-In",
    body: "Separate sign-ins for admins, teachers and students, with two-factor required for every admin.",
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
    body: `Practice that teachers assign, students attempt, and ${PRODUCT_NAME} marks the moment it is submitted.`,
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
    platformBody: "Board-format papers and the analytics a school's leadership team will ask for.",
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
    badge: "In Progress",
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
  build: { label: "In Progress", tone: "warning" },
  soon: { label: "Soon", tone: "neutral" },
  planned: { label: "Planned", tone: "neutral" },
};

type Module = {
  icon: React.ReactNode;
  title: string;
  description: string;
  /** What the same module is to a Super Admin, who does it for every
   *  school rather than for "your school". */
  platformDescription?: string;
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
    // A school admin cannot review or publish (routes_curriculum_admin.py:
    // the status ladders are SUPER_ADMIN only), so their card no longer
    // says they can.
    description: "Map published chapters into your school's calendar, class by class, and reschedule them when dates slip.",
    platformDescription: "Review and publish chapters, then map them into any school's calendar, class by class.",
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
    description: "Create teacher and student accounts, import rosters in bulk, reset a forgotten password, and deactivate anyone who leaves.",
    platformDescription: "Create admin, teacher and student accounts for any school, reset a forgotten password, and deactivate anyone who leaves.",
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
    // A school admin neither imports nor reviews questions (both are the
    // Super Admin's, inside Curriculum Studio), so their card says what the
    // bank is to them rather than what they cannot do in it.
    description: "The reviewed questions behind every published chapter.",
    platformDescription: "Import from spreadsheets, review quality, and map every question to a chapter.",
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
function CurriculumPanel({
  isPlatformAdmin,
  chapters,
  mappings,
  failed,
}: {
  isPlatformAdmin: boolean;
  /** null while loading. The page loads these once and gives the same rows
   *  to the masthead's figures, so the two can never disagree. */
  chapters: ChapterSummary[] | null;
  mappings: SchoolCurriculumMapEntry[] | null;
  /** Which of the two reads failed. They fail separately, and this card
   *  must not say "your calendar couldn't be loaded" under a masthead that
   *  has just counted it. */
  failed: { chapters: boolean; mappings: boolean };
}) {
  // What this card cannot be drawn without: the chapter list for a Super
  // Admin, the calendar for a school admin. A school admin's card can still
  // list their calendar when only the published list is missing.
  const error = isPlatformAdmin ? failed.chapters : failed.mappings;
  const loading = !error && (isPlatformAdmin ? chapters === null : mappings === null || (chapters === null && !failed.chapters));

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <span className="sr-only" role="status">
          {isPlatformAdmin ? "Loading the chapter list" : "Loading your curriculum"}
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
    // Said once, in the banner under the masthead, with the way to try
    // again. Here it is only why this card is empty: repeating the server's
    // sentence a second time on one page helps nobody (and two alerts for
    // one failure is two interruptions for a screen reader).
    return (
      <PanelStack gap="gap-4">
        <PanelHeading isPlatformAdmin={isPlatformAdmin} />
        {/* content-muted on white: 8.6:1. */}
        <p className="text-[0.8125rem] leading-relaxed text-content-muted">
          {isPlatformAdmin ? "The chapter list couldn’t be loaded just now." : "Your calendar couldn’t be loaded just now."}{" "}
          The note under the panel above has the details.
        </p>
        <PanelFooter>
          <TextLink href="/admin/curriculum">Open Curriculum Studio</TextLink>
        </PanelFooter>
      </PanelStack>
    );
  }

  const chapterRows = chapters ?? [];
  // The published list, when it is the one read that failed: the calendar
  // below is still true, but nothing can be said about what is left to map.
  const publishedKnown = chapters !== null;

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
            !publishedKnown
              ? { label: "Nothing Mapped Yet", tone: "neutral" }
              : available > 0
                ? { label: `${available} ${available === 1 ? "Chapter" : "Chapters"} Ready to Map`, tone: "brand" }
                : { label: "No Chapters Published Yet", tone: "neutral" }
          }
          title="Nothing is in your school's calendar yet"
          description={
            !publishedKnown
              ? "The list of published chapters couldn’t be loaded just now, so this can’t say what is ready to map. Curriculum Studio has the full list."
              : available > 0
              ? "Published chapters are ready for you. Map one into a class to add it to that class's calendar. Its teachers can assign practice from it once that practice is published."
              : "Chapters move through draft, review and publish before any school can use them. As soon as one is published, you can map it here."
          }
          actions={available > 0 || !publishedKnown ? <TextLink href="/admin/curriculum">{publishedKnown ? "Map a Chapter" : "Open Curriculum Studio"}</TextLink> : undefined}
        />
      </div>
    );
  }

  const today = todayIso();
  const classCount = new Set(mapRows.map((m) => m.className).filter(Boolean)).size;
  const mappedIds = new Set(mapRows.map((m) => m.chapterId));
  // The same count the masthead's "Ready To Map" shows, made the same way.
  const readyToMap = chapterRows.filter((chapter) => !mappedIds.has(chapter.id)).length;
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

      {/* The three figures that used to open this card (in your calendar,
          published to map, classes covered) are in the masthead now, where
          they count up. A row of figures already on the page moves up into
          the masthead rather than being repeated under it (PageHeader.tsx).
          What stays is the one line the masthead has no room for. */}
      <p className="border-y border-line py-3.5 text-[0.8125rem] leading-relaxed text-content-muted">
        {mapRows.length} {mapRows.length === 1 ? "chapter" : "chapters"} across {classCount}{" "}
        {classCount === 1 ? "class" : "classes"}.{" "}
        {!publishedKnown
          ? ""
          : readyToMap > 0
          ? `${readyToMap} more published and ready to map.`
          : "Every published chapter is already in your calendar."}
      </p>

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
                      {classLabel(mapping.className) ?? "All classes"}
                      {start || end ? ` · ${start ?? "No start date"} – ${end ?? "No end date"}` : " · Dates not set"}
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
            ? `Every chapter in ${PRODUCT_NAME}, by where it sits in review`
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

/** The slice of a roster row the dashboard's figures need (GET
 *  /roster/people; the People page has the full shape). */
type RosterPerson = {
  role: "ADMIN" | "TEACHER" | "STUDENT";
  isActive: boolean;
  className?: string | null;
  schoolId?: string | null;
};

/** The schools nobody can run yet: no admin account that can still sign in.
 *  Until a school has one, nobody can create its teachers or students or
 *  map its calendar, so it is the first thing a Super Admin is told. */
function schoolsWithoutAdmin(schools: SchoolOption[], admins: RosterPerson[]): SchoolOption[] {
  const covered = new Set(admins.filter((admin) => admin.isActive && admin.schoolId).map((admin) => admin.schoolId));
  return schools.filter((school) => !covered.has(school.id));
}

/** "3 inactive", or the reassuring opposite. */
function inactiveHint(inactive: number): string {
  return inactive > 0 ? `${inactive} inactive` : "All active";
}

/**
 * The single most useful thing for a school admin to do next, walked in the
 * order a school is actually set up: people first (nobody can be assigned
 * anything until accounts exist), then the calendar (teachers can only
 * assign practice from chapters mapped into it). A source that failed to
 * load is skipped rather than guessed at. null while anything is loading.
 */
function schoolNextStep(input: {
  loading: boolean;
  people: RosterPerson[] | null;
  chapters: ChapterSummary[] | null;
  mappings: SchoolCurriculumMapEntry[] | null;
}): NextStep | null {
  if (input.loading) return null;
  const { people, chapters, mappings } = input;
  // Accounts that can sign in. A school whose only teacher has been
  // deactivated has no teacher to assign anything.
  const has = (role: RosterPerson["role"]) => Boolean(people?.some((person) => person.role === role && person.isActive));
  if (people && !has("TEACHER")) {
    return {
      title: "Add your teachers",
      body: "Each teacher gets a teacher code and a temporary password from you, and chooses their own password the first time they sign in.",
      action: { href: "/admin/people", label: "Open People" },
    };
  }
  if (people && !has("STUDENT")) {
    return {
      title: "Add your students",
      body: "Add them one at a time, or upload a whole class list in one file. Each student gets a student code and a temporary password.",
      action: { href: "/admin/people", label: "Open People" },
    };
  }
  // Both lists are needed to say which of the two it is: "nothing is
  // published" must never be said because the published list failed to load.
  if (mappings && mappings.length === 0 && chapters) {
    return chapters.length > 0
      ? {
          title: "Map your first chapter",
          body: "Published chapters are ready for you. Map one into a class to add it to that class's calendar. Its teachers can assign practice from it once that practice is published.",
          action: { href: "/admin/curriculum", label: "Open Curriculum Studio" },
        }
      : {
          title: "Waiting on published chapters",
          body: `Chapters are reviewed and published by the ${PRODUCT_NAME} team before any school can use them. As soon as one is published you can map it into your calendar. Nothing is needed from you.`,
        };
  }
  if (people && mappings && chapters) {
    return {
      title: "Keep your calendar current",
      body: "Your accounts and chapters are in place. When dates slip, reschedule a chapter in two clicks; when a class is ready, map its next one.",
      action: { href: "/admin/curriculum", label: "Open Curriculum Studio" },
    };
  }
  return COULD_NOT_CHECK;
}

/** Shown when a read failed: no step is suggested from half the facts. */
const COULD_NOT_CHECK: NextStep = {
  title: "Some figures couldn't be loaded",
  body: "A figure shown as a dash couldn't be loaded just now. The note under this panel says which.",
};

/**
 * The same question for a Super Admin, whose work is the platform's. In
 * order: a school that nobody can run (it has no admin, so it can do
 * nothing at all), then the review queue (nothing reaches any school until
 * it is published), then the first publish. A school without an admin comes
 * before the queue because a queue can stay non-empty for weeks while
 * chapters are worked through, and would hide a school that is stuck.
 */
function platformNextStep(input: {
  loading: boolean;
  schools: SchoolOption[] | null;
  admins: RosterPerson[] | null;
  chapters: ChapterSummary[] | null;
}): NextStep | null {
  if (input.loading) return null;
  const { schools, admins, chapters } = input;
  if (schools && schools.length === 0) {
    return {
      title: `No schools on ${PRODUCT_NAME} yet`,
      body: "A new school is set up outside these screens. Once one exists, create its first admin in People.",
    };
  }
  if (schools && admins) {
    const waiting = schoolsWithoutAdmin(schools, admins);
    if (waiting.length > 0) {
      return {
        // "No active admin", not "no admin yet": the school may have had
        // one who was deactivated, and then the answer is to reactivate.
        title: waiting.length === 1 ? `${waiting[0].name} has no active admin` : `${waiting.length} schools have no active admin`,
        body: "A school's admin creates its teachers and students and maps its calendar, so nothing can happen there without one. Create one, or reactivate the one it had, in People. Only a Super Admin can.",
        action: { href: "/admin/people", label: "Open People" },
      };
    }
  }
  const inReview = chapters ? chapters.filter((chapter) => chapter.status === "REVIEW").length : 0;
  if (inReview > 0) {
    return {
      title: inReview === 1 ? "1 chapter is waiting for review" : `${inReview} chapters are waiting for review`,
      body: "Nothing reaches any school until it is published. Check the questions, then publish, in Curriculum Studio.",
      action: { href: "/admin/curriculum", label: "Review Chapters" },
    };
  }
  if (chapters && !chapters.some((chapter) => chapter.status === "PUBLISHED")) {
    return {
      title: "Publish the first chapter",
      body: "Imported chapters arrive as drafts. Move one through review and publish it, and every school can map it into its calendar.",
      action: { href: "/admin/curriculum", label: "Open Curriculum Studio" },
    };
  }
  if (schools && admins && chapters) {
    return {
      title: "Nothing is waiting on you",
      body: "Every school has an admin and the review queue is empty. Map published chapters into a school's calendar, or create accounts for a school, whenever one is ready.",
      action: { href: "/admin/curriculum", label: "Open Curriculum Studio" },
    };
  }
  return COULD_NOT_CHECK;
}

export default function AdminDashboardPage() {
  const session = useProtectedPage("ADMIN");
  const { user, status } = session;
  const ready = status === "ready" && Boolean(user);
  const isPlatformAdmin = user?.role === "SUPER_ADMIN";

  // Loaded once, here, and handed to both the masthead's figures and the
  // cards beneath it (3 Oct 2026). The curriculum card used to fetch its
  // own copy; two reads of the same thing can disagree, and a masthead that
  // says "4 in your calendar" over a card that lists three is worse than
  // either being wrong alone. Nothing new on the backend: every path here
  // was already called by People or Curriculum Studio.
  const chaptersQuery = useApiQuery<{ chapters: ChapterSummary[] }>(
    ready ? "/curriculum-admin/chapters" : null,
    {},
    { action: isPlatformAdmin ? "load the chapter list" : "load your published chapters" },
  );
  // A school's own calendar. A Super Admin has no single school, so no
  // calendar to read: theirs is the platform-wide pipeline instead.
  const mapsQuery = useApiQuery<{ schoolCurriculumMaps: SchoolCurriculumMapEntry[] }>(
    ready && !isPlatformAdmin ? "/curriculum-admin/school-curriculum-maps" : null,
    {},
    { action: "load your school's calendar" },
  );
  // For a school admin: their school's teachers and students. For a Super
  // Admin with no school chosen, the same path answers with every school's
  // admins (routes_roster.py, list_people) -- which is the figure a
  // platform owner wants here.
  const peopleQuery = useApiQuery<{ people: RosterPerson[] }>(
    ready ? "/roster/people" : null,
    { includeInactive: "true" },
    { action: isPlatformAdmin ? "load the school admins" : "load your school's accounts" },
  );
  const schoolsQuery = useApiQuery<{ schools: SchoolOption[] }>(
    ready && isPlatformAdmin ? "/curriculum-admin/schools" : null,
    {},
    { action: "load the list of schools" },
  );

  if (status !== "ready") {
    return <SessionGate session={session} />;
  }

  const schoolName = user?.admin?.schoolName ?? null;
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

  // A read that has failed is treated as not known, even when an older
  // answer is still held from before (useApiQuery keeps the last one): a
  // number that may no longer be true is not shown as though it were.
  const chapters = chaptersQuery.problem ? null : (chaptersQuery.data?.chapters ?? null);
  const mappings = mapsQuery.problem ? null : (mapsQuery.data?.schoolCurriculumMaps ?? null);
  const people = peopleQuery.problem ? null : (peopleQuery.data?.people ?? null);
  const schools = schoolsQuery.problem ? null : (schoolsQuery.data?.schools ?? null);

  // The masthead's figures. `null` while a source loads (a placeholder
  // bar); "—" if it failed, with the banner below saying why -- never a
  // zero, which would read as a real count. Same rule as the Practice
  // Tracker's masthead. A hint appears only once the number it describes
  // is known.
  const figure = (query: { data: unknown; problem: unknown }, value: number | undefined) =>
    query.problem ? "—" : query.data ? (value ?? 0) : null;

  let stats: PageHeaderStat[];
  if (isPlatformAdmin) {
    const admins = people ?? [];
    const activeAdmins = admins.filter((person) => person.isActive).length;
    // Needs both lists; 0 until both are in, so nothing is flagged early.
    const unstaffed = schools && people ? schoolsWithoutAdmin(schools, admins).length : 0;
    const published = chapters?.filter((chapter) => chapter.status === "PUBLISHED").length;
    const inReview = chapters?.filter((chapter) => chapter.status === "REVIEW").length;
    const drafts = chapters?.filter((chapter) => chapter.status === "DRAFT").length ?? 0;
    stats = [
      {
        label: "Schools",
        value: figure(schoolsQuery, schools?.length),
        hint: schools ? (schools.length === 0 ? "None set up yet" : `Active on ${PRODUCT_NAME}`) : undefined,
      },
      {
        label: "School Admins",
        value: figure(peopleQuery, activeAdmins),
        hint: people
          ? admins.length === 0
            ? "None created yet"
            : unstaffed > 0
              ? `${unstaffed} ${unstaffed === 1 ? "school has" : "schools have"} none`
              : inactiveHint(admins.length - activeAdmins)
          : undefined,
        // A school with no admin is a school that cannot start.
        tone: unstaffed > 0 ? "attention" : "default",
      },
      {
        label: "Chapters Published",
        value: figure(chaptersQuery, published),
        hint: chapters ? `${chapters.length} ${chapters.length === 1 ? "chapter" : "chapters"} in all` : undefined,
        tone: published ? "good" : "default",
      },
      {
        label: "Waiting In Review",
        value: figure(chaptersQuery, inReview),
        hint: chapters
          ? inReview
            ? "Open Curriculum Studio to review"
            : drafts > 0
              ? `Nothing waiting · ${drafts} in draft`
              : "Nothing waiting"
          : undefined,
        tone: inReview ? "attention" : "default",
      },
    ];
  } else {
    const roster = people ?? [];
    const teachers = roster.filter((person) => person.role === "TEACHER");
    const students = roster.filter((person) => person.role === "STUDENT");
    const activeTeachers = teachers.filter((person) => person.isActive).length;
    const activeStudents = students.filter((person) => person.isActive);
    const classes = new Set(activeStudents.map((person) => person.className).filter(Boolean)).size;
    const today = todayIso();
    const running = (mappings ?? []).filter(
      (m) => Boolean(m.plannedStartDate) && m.plannedStartDate! <= today && (!m.plannedEndDate || m.plannedEndDate >= today),
    ).length;
    // Counted chapter by chapter, not as "published minus mapped": a
    // chapter mapped earlier and since withdrawn is in the calendar but no
    // longer in the published list, and a subtraction would under-count.
    const mappedIds = new Set((mappings ?? []).map((m) => m.chapterId));
    const readyToMap = chapters && mappings ? chapters.filter((chapter) => !mappedIds.has(chapter.id)).length : undefined;
    stats = [
      {
        label: "Teachers",
        value: figure(peopleQuery, activeTeachers),
        hint: people ? (teachers.length === 0 ? "None yet: add them in People" : inactiveHint(teachers.length - activeTeachers)) : undefined,
      },
      {
        label: "Students",
        value: figure(peopleQuery, activeStudents.length),
        hint: people
          ? students.length === 0
            ? "None yet: add them in People"
            : classes > 0
              ? `Across ${classes} ${classes === 1 ? "class" : "classes"}`
              : inactiveHint(students.length - activeStudents.length)
          : undefined,
      },
      {
        label: "In Your Calendar",
        value: figure(mapsQuery, mappings?.length),
        hint: mappings
          ? mappings.length === 0
            ? "Nothing mapped yet"
            : running > 0
              ? `${running} running now`
              : "None running today"
          : undefined,
        tone: running > 0 ? "good" : "default",
      },
      {
        label: "Ready To Map",
        // Needs both sources: published chapters, less the ones already in
        // the calendar. If either failed, there is no honest number.
        value: chaptersQuery.problem || mapsQuery.problem ? "—" : readyToMap !== undefined ? readyToMap : null,
        hint: readyToMap !== undefined ? (readyToMap > 0 ? "Published, not in your calendar" : "Nothing waiting") : undefined,
        // Only when the calendar is empty is this something waiting on the
        // admin; with a calendar under way, chapters for later in the year
        // (or for classes the school does not run) are not a to-do.
        tone: readyToMap && mappings && mappings.length === 0 ? "attention" : "default",
      },
    ];
  }

  const pending = [chaptersQuery, peopleQuery, isPlatformAdmin ? schoolsQuery : mapsQuery].some(
    (query) => !query.data && !query.problem,
  );
  const nextStep = isPlatformAdmin
    ? platformNextStep({ loading: pending, schools, admins: people, chapters })
    : schoolNextStep({ loading: pending, people, chapters, mappings });

  // What failed, for the banner under the masthead -- and which figures it
  // took with it, because the server's sentence for a failure ("Something
  // went wrong on our side...") does not say what it was loading. One
  // banner for every read on the page, so "Try Again" is in one place.
  const sources = [
    { query: schoolsQuery, figures: "Schools" },
    { query: peopleQuery, figures: isPlatformAdmin ? "School Admins" : "Teachers and Students" },
    { query: chaptersQuery, figures: isPlatformAdmin ? "Chapters" : "Published chapters" },
    { query: mapsQuery, figures: "Your calendar" },
  ].filter((source) => source.query.problem);
  // One sentence is shown. If any of the failures can be retried, it is
  // that one's, so that "Try Again" is offered whenever trying again can help.
  const figureProblem = (sources.find((source) => source.query.problem?.retryable) ?? sources[0])?.query.problem ?? null;
  const missingFigures = sources.map((source) => source.figures);
  const missingTitle =
    missingFigures.length > 1
      ? `${missingFigures.slice(0, -1).join(", ")} and ${missingFigures[missingFigures.length - 1]} couldn’t be loaded`
      : `${missingFigures[0]} couldn’t be loaded`;
  const retryFigures = () => sources.forEach((source) => source.query.reload());

  return (
    // The dashboard level of the workspace wash, as on the Teacher
    // dashboard: the stronger of the two, and the only one that drifts.
    // components/brand/Ambience.tsx has the measurements behind both.
    <RoleShell role={roleForShell} user={user} ambience="dashboard">
      <div className="space-y-10">
        <PageHeader
          surface="masthead"
          size="lg"
          // The one admin masthead that drifts; PageHeader.tsx has why.
          drift
          // Not "School Control Centre": RoleShell's breadcrumb already
          // starts with exactly that, one line above -- and for a super
          // admin it says "Platform Control Centre", so repeating the
          // school wording here contradicted it.
          eyebrow={isPlatformAdmin ? "The Platform at a Glance" : schoolName ? `${schoolName} at a Glance` : "Your School at a Glance"}
          title={
            <>
              {/* text-gradient-warm, as on the Teacher dashboard: the brand
                  gradient this used on the canvas is indigo on indigo here. */}
              Welcome, <span className="text-gradient-warm">{user?.fullName ?? (isPlatformAdmin ? "Super Admin" : "Admin")}</span>
            </>
          }
          // Was one sentence for both roles: "Set up the school, shape the
          // curriculum, and control what teachers and students see." A
          // school admin does not shape the curriculum, and a Super Admin
          // has no one school to set up.
          description={
            isPlatformAdmin
              ? `Every school on ${PRODUCT_NAME} and the curriculum they all draw from, counted live each time you open this page.`
              : "Your school's accounts and its calendar, counted live each time you open this page."
          }
          stats={stats}
          meta={
            <>
              <Badge tone="success" dot onDark>
                {liveCount} of {STAGES.length} Stages Live
              </Badge>
              {currentStage ? (
                <Badge tone="inverse" dot pulse>
                  In Progress: {currentStage.title}
                </Badge>
              ) : null}
            </>
          }
        >
          <MastheadNextStep
            step={nextStep}
            checkingLabel={isPlatformAdmin ? "Checking every school" : "Checking your school's setup"}
          />
        </PageHeader>

        {figureProblem ? <LoadError title={missingTitle} problem={figureProblem} onRetry={retryFigures} /> : null}

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
                  <p className="mt-0.5 text-xs text-content-subtle">
                    {isPlatformAdmin ? "What every school can use today, and what’s next" : "What your school can use today, and what’s next"}
                  </p>
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
                          {isPlatformAdmin ? (stage.platformBody ?? stage.body) : stage.body}
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
                  Status last verified on {ROLLOUT_VERIFIED_ON}.
                </p>
              </PanelFooter>
            </PanelStack>
          </StretchCard>

          <SplitColumn fill="first">
            <StretchCard className="animate-fade-up delay-70" bodyClassName="sm:p-8">
              <CurriculumPanel
                isPlatformAdmin={isPlatformAdmin}
                chapters={chapters}
                mappings={mappings}
                failed={{ chapters: Boolean(chaptersQuery.problem), mappings: Boolean(mapsQuery.problem) }}
              />
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
                  {/* The KIND of access, so the plain role name
                      (lib/pageTitle.ts ROLE_LABEL) and not the label the
                      rail and the tab use: that one puts the school's name
                      in front, and the school is the very next row. This
                      row once said "Platform Admin", a third name for one
                      role. */}
                  <DetailRow label="Access Level" value={ROLE_LABEL[isPlatformAdmin ? "SUPER_ADMIN" : "ADMIN"]} />
                  {isPlatformAdmin ? (
                    <DetailRow label="Reach" value={`Every school on ${PRODUCT_NAME}`} />
                  ) : (
                    // The school's internal ID used to be printed under this
                    // row. Nobody is ever asked for it, and a 36-character
                    // identifier on a dashboard reads as an error.
                    <DetailRow label="School" value={schoolName ?? "—"} />
                  )}
                </dl>
              </CardBody>
            </Card>
          </SplitColumn>
        </SplitLayout>

        <section aria-labelledby="modules-heading" className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="modules-heading" className="font-display text-display-sm text-content">
                What&rsquo;s in {PRODUCT_NAME}
              </h2>
              <p className="mt-1 text-sm text-content-muted">
                Open what is live from here. The rest appears when it is released; there is nothing to install.
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
                  description={isPlatformAdmin ? (module.platformDescription ?? module.description) : module.description}
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
