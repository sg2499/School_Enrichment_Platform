"use client";

/**
 * My Classes (#224) for a teacher: each section they teach, with how many
 * students it has, the practice and papers set, and the chapter the school's
 * calendar has running. Counts and dates only -- no student is named here;
 * people are in Class Analytics and the Practice Tracker.
 */
import Link from "next/link";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { dateRange, plural } from "@/lib/overview";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadError } from "@/components/ui/AlertBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Table";
import type { ChapterWindow, MyClass } from "@/types/overview";

function Chapter({ label, chapter }: { label: string; chapter: ChapterWindow | null }) {
  return (
    <div>
      <dt className="text-[0.6875rem] font-semibold uppercase tracking-wide text-content-subtle">{label}</dt>
      <dd className="mt-1 text-sm text-content">
        {chapter ? (
          <>
            <span className="font-semibold">
              {chapter.chapterNo}. {chapter.title}
            </span>
            <span className="block text-content-muted">{dateRange(chapter.start, chapter.end)}</span>
          </>
        ) : (
          <span className="text-content-muted">Nothing scheduled</span>
        )}
      </dd>
    </div>
  );
}

export function MyClasses() {
  const mine = useApiQuery<{ classes: MyClass[] }>("/overview/my-classes", {}, { action: "load your classes" });
  const classes = mine.data?.classes ?? [];
  const value = (n: number) => (mine.problem ? "—" : mine.data ? n : null);
  return (
    <div className="space-y-6">
      <PageHeader
        surface="masthead"
        eyebrow="Teaching"
        title="My Classes"
        description="The sections you teach, and what each has going on."
        stats={[
          { label: "Sections", value: value(classes.length) },
          { label: "Students", value: value(classes.reduce((n, c) => n + c.students, 0)) },
          { label: "Practice Running", value: value(classes.reduce((n, c) => n + c.practiceActive, 0)), hint: "Sets you have open" },
          { label: "Mock Papers", value: value(classes.reduce((n, c) => n + c.papers, 0)) },
        ]}
      />
      {mine.problem ? <LoadError problem={mine.problem} onRetry={mine.reload} /> : null}
      {!mine.data && !mine.problem ? <TableSkeleton label="Loading your classes" rows={3} /> : null}
      {mine.data && classes.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            title="No Sections Yet"
            description="Your school's admin gives you a section under Classes & Sections. It will appear here as soon as they do."
          />
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {classes.map((c) => (
          <Card key={c.id}>
            <CardHeader>
              <CardTitle>
                {c.className} {c.section}
              </CardTitle>
              <CardDescription>
                {[c.course, plural(c.students, "student")].filter(Boolean).join(" · ")}
              </CardDescription>
            </CardHeader>
            <CardBody className="space-y-4">
              <dl className="grid gap-4 sm:grid-cols-2">
                <Chapter label="Running Now" chapter={c.runningChapter} />
                <Chapter label="Up Next" chapter={c.nextChapter} />
              </dl>
              <p className="text-sm text-content-muted">
                {plural(c.practiceSet, "practice set")} set by you ({c.practiceActive} open) &middot; {plural(c.papers, "mock paper")}
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
                <Link className="text-brand-700 hover:underline" href="/teacher/assign">Assign Practice</Link>
                <Link className="text-brand-700 hover:underline" href="/teacher/tracker">Practice Tracker</Link>
                <Link className="text-brand-700 hover:underline" href="/teacher/analytics">Class Analytics</Link>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
