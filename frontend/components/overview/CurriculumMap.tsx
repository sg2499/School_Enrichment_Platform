"use client";

/**
 * Curriculum Map (#224) for a teacher: the school's chapter calendar for the
 * classes they teach, in order, with where today falls. Read-only: the
 * school's admin sets and moves the dates in Curriculum Studio.
 */
import { useMemo } from "react";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { dateRange } from "@/lib/overview";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadError } from "@/components/ui/AlertBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { SchoolCurriculumMapEntry } from "@/types/curriculum";
import type { MyClass } from "@/types/overview";

type Entry = SchoolCurriculumMapEntry;

function todayIst(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

function when(entry: Entry, today: string): { label: string; tone: "success" | "neutral" | "brand" } {
  const { plannedStartDate: start, plannedEndDate: end } = entry;
  if (!start || !end) return { label: "Not Scheduled", tone: "neutral" };
  if (end < today) return { label: "Done", tone: "neutral" };
  if (start > today) return { label: "Coming Up", tone: "brand" };
  return { label: "Running Now", tone: "success" };
}

export function CurriculumMap() {
  const mine = useApiQuery<{ classes: MyClass[] }>("/overview/my-classes", {}, { action: "load your classes" });
  const maps = useApiQuery<{ schoolCurriculumMaps: Entry[] }>("/curriculum-admin/school-curriculum-maps", {}, { action: "load the curriculum map" });
  const today = todayIst();
  const codes = useMemo(() => new Set((mine.data?.classes ?? []).map((c) => c.classCode)), [mine.data]);
  const groups = useMemo(() => {
    const byClass = new Map<string, Entry[]>();
    for (const entry of maps.data?.schoolCurriculumMaps ?? []) {
      if (!entry.className || !codes.has(entry.className)) continue;
      byClass.set(entry.className, [...(byClass.get(entry.className) ?? []), entry]);
    }
    return [...byClass.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([code, list]) => [
        code,
        [...list].sort((x, y) => (x.plannedStartDate ?? "9999").localeCompare(y.plannedStartDate ?? "9999") || x.sequence - y.sequence),
      ] as const);
  }, [maps.data, codes]);
  const problem = mine.problem ?? maps.problem;
  const ready = Boolean(mine.data && maps.data);
  return (
    <div className="space-y-6">
      <PageHeader
        surface="masthead"
        eyebrow="Insight"
        title="Curriculum Map"
        description="When your school plans to teach each chapter, for the classes you teach. Your school's admin sets and moves these dates."
      />
      {problem ? <LoadError problem={problem} onRetry={mine.problem ? mine.reload : maps.reload} /> : null}
      {!ready && !problem ? <TableSkeleton label="Loading the curriculum map" rows={5} /> : null}
      {ready && groups.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            title="Nothing Planned Yet"
            description="Once your school's admin adds chapters to the calendar for your classes, they appear here in order."
          />
        </Card>
      ) : null}
      {groups.map(([code, entries]) => (
        <Card key={code}>
          <CardHeader className="flex-col items-start gap-1 [&>h3]:max-w-none">
            <CardTitle>Class {code}</CardTitle>
            <CardDescription>{entries.length} chapters on the calendar</CardDescription>
          </CardHeader>
          <CardBody>
            <Table caption={`Chapter calendar for Class ${code}`} minWidth="36rem">
              <THead>
                  <TH>Chapter</TH>
                  <TH>Planned</TH>
                  <TH>Textbook</TH>
                  <TH>Status</TH>
                </THead>
              <TBody>
                {entries.map((entry) => {
                  const state = when(entry, today);
                  return (
                    <TR key={entry.id}>
                      <TD className="font-semibold">{entry.chapterTitle ?? entry.chapterCode ?? "Chapter"}</TD>
                      <TD className="tabular">{dateRange(entry.plannedStartDate, entry.plannedEndDate)}</TD>
                      <TD className="text-content-muted">{entry.textbookReference || "—"}</TD>
                      <TD>
                        <Badge tone={state.tone}>{state.label}</Badge>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
