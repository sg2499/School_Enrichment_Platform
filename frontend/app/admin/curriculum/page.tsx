"use client";

/**
 * Curriculum Studio (#212, 29 Oct 2026: rebuilt into sub-tabs).
 *
 * Super Admin, two tabs (?tab=):
 *   Chapters          every chapter with its review progress; each opens on
 *                     its own page (./chapters/<id>) to review and publish
 *   School Calendars  a chosen school's calendar (?school=), to add chapters
 *                     to and move dates in
 *
 * A school's admin, two tabs:
 *   Calendar            their school's calendar, class by class
 *   Published Chapters  what they can add, and what is already in
 *
 * Until #212 everything was one long page: the chapter list and its
 * filters, then a side-by-side form and calendar, with a chapter opening in
 * a full-screen pop-up holding up to 500 questions.
 */
import { Suspense, useCallback } from "react";
import { CalendarRange, Layers, Library } from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { CalendarWorkspace, PublishedChapters } from "@/components/curriculum/CalendarWorkspace";
import { ChapterLibrary } from "@/components/curriculum/ChapterLibrary";
import { mapTiming, todayIso } from "@/components/curriculum/shared";
import { LoadError } from "@/components/ui/AlertBanner";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { PageHeader, type PageHeaderStat } from "@/components/ui/PageHeader";
import { SubTabs, type SubTab } from "@/components/ui/SubTabs";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { useUrlState } from "@/lib/hooks/useUrlState";
import type { ChapterStatus, ChapterSummary, SchoolCurriculumMapEntry } from "@/types/curriculum";

type PlatformTab = "chapters" | "calendars";
type SchoolTab = "calendar" | "published";

function StudioPage() {
  const session = useProtectedPage("ADMIN");
  const { user, status } = session;
  const url = useUrlState();
  const ready = status === "ready" && Boolean(user);
  const isPlatformAdmin = user?.role === "SUPER_ADMIN";

  // The masthead's own reads; the tabs below keep their own lists and say
  // when they have changed something, so the figures move with the work.
  const chaptersQuery = useApiQuery<{ chapters: ChapterSummary[] }>(
    ready ? "/curriculum-admin/chapters" : null,
    {},
    { action: isPlatformAdmin ? "load the chapter list" : "load your published chapters" },
  );
  const mapsQuery = useApiQuery<{ schoolCurriculumMaps: SchoolCurriculumMapEntry[] }>(
    ready && !isPlatformAdmin ? "/curriculum-admin/school-curriculum-maps" : null,
    {},
    { action: "load your school's calendar" },
  );
  const reloadChapters = chaptersQuery.reload;
  const reloadMaps = mapsQuery.reload;
  const refreshFigures = useCallback(() => {
    reloadChapters();
    reloadMaps();
  }, [reloadChapters, reloadMaps]);

  if (status !== "ready" || !user) return <SessionGate session={session} />;

  const chapters = chaptersQuery.problem ? null : (chaptersQuery.data?.chapters ?? null);
  const mappings = mapsQuery.problem ? null : (mapsQuery.data?.schoolCurriculumMaps ?? null);
  const figure = (query: { data: unknown; problem: unknown }, value: number | undefined) =>
    query.problem ? "—" : query.data ? (value ?? 0) : null;
  const by = (state: ChapterStatus) => chapters?.filter((c) => c.status === state).length;

  let stats: PageHeaderStat[];
  let tabs: SubTab<string>[];
  let active: string;
  if (isPlatformAdmin) {
    const questions = chapters?.reduce((n, c) => n + (c.questionCount ?? 0), 0) ?? 0;
    const approved = chapters?.reduce((n, c) => n + (c.approvedQuestionCount ?? 0), 0) ?? 0;
    const inReview = by("REVIEW");
    stats = [
      {
        label: "Chapters",
        value: figure(chaptersQuery, chapters?.length),
        hint: chapters ? `${questions.toLocaleString("en-IN")} questions in all` : undefined,
      },
      {
        label: "Published",
        value: figure(chaptersQuery, by("PUBLISHED")),
        hint: chapters ? "Schools can add these" : undefined,
        tone: by("PUBLISHED") ? "good" : "default",
      },
      {
        label: "In Review",
        value: figure(chaptersQuery, inReview),
        hint: chapters ? (inReview ? "Waiting for you to publish" : "Nothing waiting") : undefined,
        tone: inReview ? "attention" : "default",
      },
      {
        label: "Questions Approved",
        value: figure(chaptersQuery, approved),
        hint: chapters && questions ? `${Math.round((approved / questions) * 100)}% of the question bank` : undefined,
      },
    ];
    const t: PlatformTab = url.get("tab") === "calendars" ? "calendars" : "chapters";
    active = t;
    tabs = [
      {
        key: "chapters",
        label: "Chapters",
        href: url.get("school") ? `/admin/curriculum?school=${url.get("school")}` : "/admin/curriculum",
        icon: <Layers className="h-4 w-4" />,
        count: chapters ? chapters.length : null,
      },
      {
        key: "calendars",
        label: "School Calendars",
        href: `/admin/curriculum?tab=calendars${url.get("school") ? `&school=${url.get("school")}` : ""}`,
        icon: <CalendarRange className="h-4 w-4" />,
      },
    ];
  } else {
    const today = todayIso();
    const rows = mappings ?? [];
    const running = rows.filter((m) => mapTiming(m, today) === "running").length;
    const upcoming = rows.filter((m) => mapTiming(m, today) === "upcoming").length;
    const classes = new Set(rows.map((m) => m.className).filter(Boolean)).size;
    const mapped = new Set(rows.map((m) => m.chapterId));
    const notIn = chapters && mappings ? chapters.filter((c) => !mapped.has(c.id)).length : undefined;
    stats = [
      {
        label: "In Your Calendar",
        value: figure(mapsQuery, rows.length),
        hint: mappings ? (rows.length ? `Across ${classes} ${classes === 1 ? "class" : "classes"}` : "Nothing added yet") : undefined,
      },
      {
        label: "Running Now",
        value: figure(mapsQuery, running),
        hint: mappings ? (running ? "Within their dates today" : "None within their dates today") : undefined,
        tone: running ? "good" : "default",
      },
      { label: "Coming Up", value: figure(mapsQuery, upcoming), hint: mappings ? "Starting later" : undefined },
      {
        label: "Not in Your Calendar",
        value: chaptersQuery.problem || mapsQuery.problem ? "—" : notIn !== undefined ? notIn : null,
        hint: notIn !== undefined ? (notIn ? "Published, ready to add" : "Every published chapter is in") : undefined,
        tone: notIn && rows.length === 0 ? "attention" : "default",
      },
    ];
    const t: SchoolTab = url.get("tab") === "published" ? "published" : "calendar";
    active = t;
    tabs = [
      {
        key: "calendar",
        label: "Calendar",
        href: "/admin/curriculum",
        icon: <CalendarRange className="h-4 w-4" />,
        count: mappings ? mappings.length : null,
      },
      {
        key: "published",
        label: "Published Chapters",
        href: "/admin/curriculum?tab=published",
        icon: <Library className="h-4 w-4" />,
        count: chapters ? chapters.length : null,
      },
    ];
  }

  const figureProblem = chaptersQuery.problem ?? mapsQuery.problem ?? null;
  return (
    <RoleShell role={isPlatformAdmin ? "SUPER_ADMIN" : "ADMIN"} user={user} ambience="working">
      <div className="space-y-6">
        <PageHeader
          surface="masthead"
          eyebrow={isPlatformAdmin ? "Content, for Every School" : "Your School's Curriculum"}
          title="Curriculum Studio"
          description={
            isPlatformAdmin
              ? "Review and publish chapters, then add them to a school's calendar. Nothing reaches a school until it is published here."
              : "Add published chapters to your school's calendar, class by class, and move their dates when the term does."
          }
          stats={stats}
        />
        {figureProblem ? <LoadError title="Some figures couldn’t be loaded" problem={figureProblem} onRetry={refreshFigures} /> : null}
        <SubTabs label="Curriculum Studio views" tabs={tabs} active={active} />
        {isPlatformAdmin ? (
          active === "calendars" ? (
            <CalendarWorkspace
              isPlatformAdmin
              onChanged={refreshFigures}
              schoolId={url.get("school") ?? ""}
              onSchoolChange={(id) => url.set({ school: id })}
            />
          ) : (
            <ChapterLibrary onChanged={refreshFigures} />
          )
        ) : active === "published" ? (
          <PublishedChapters onChanged={refreshFigures} />
        ) : (
          <CalendarWorkspace isPlatformAdmin={false} onChanged={refreshFigures} />
        )}
      </div>
    </RoleShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <StudioPage />
    </Suspense>
  );
}
