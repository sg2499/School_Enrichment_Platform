"use client";

/**
 * Papers & Mocks (#224) for the Super Admin: how many question patterns each
 * chapter has for building mock papers, and how many papers schools have
 * approved. Counts only -- never a pattern's specification. Mock papers
 * themselves belong to one school; the school's admin and teachers see them.
 */
import { useMemo } from "react";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { plural } from "@/lib/overview";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadError } from "@/components/ui/AlertBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { PatternOverview as Overview } from "@/types/overview";

function marksLine(byMarks: Record<string, number>): string {
  const parts = Object.keys(byMarks)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => `${k} ${Number(k) === 1 ? "mark" : "marks"}: ${byMarks[k]}`);
  return parts.length ? parts.join(" · ") : "None yet";
}

export function PatternOverview() {
  const overview = useApiQuery<Overview>("/overview/patterns", {}, { action: "load the mock paper patterns" });
  const data = overview.data;
  const value = (n: number | undefined) => (overview.problem ? "—" : data && n !== undefined ? n : null);
  const groups = useMemo(() => {
    const map = new Map<string, Overview["chapters"]>();
    for (const chapter of data?.chapters ?? []) {
      if (chapter.patterns === 0) continue;
      const key = `${chapter.board} · Class ${chapter.classCode} · ${chapter.subject}`;
      map.set(key, [...(map.get(key) ?? []), chapter]);
    }
    return [...map.entries()];
  }, [data]);
  const papers = data?.papersByStatus ?? {};

  return (
    <div className="space-y-6">
      <PageHeader
        surface="masthead"
        eyebrow="Content"
        title="Papers & Mocks"
        description="The question patterns mock papers are built from, and how many papers schools have approved. Each paper belongs to one school: its admin and teachers open them."
        stats={[
          { label: "Patterns", value: value(data?.totals.total) },
          { label: "Approved", value: value(data?.totals.byStatus.APPROVED), hint: "Ready to build papers" },
          { label: "In Draft", value: value(data?.totals.byStatus.DRAFT), hint: "Waiting for review" },
          { label: "Papers Approved", value: value(papers.APPROVED ?? 0), hint: "Across all schools" },
        ]}
      />

      {overview.problem ? <LoadError problem={overview.problem} onRetry={overview.reload} /> : null}
      {!data && !overview.problem ? <TableSkeleton label="Loading the patterns" rows={5} /> : null}

      {data && groups.length === 0 ? (
        <Card className="p-6">
          <EmptyState title="No Patterns Yet" description="Question patterns appear here once they are loaded and approved." />
        </Card>
      ) : null}

      {groups.map(([label, chapters]) => (
        <Card key={label}>
          <CardHeader>
            <CardTitle>{label}</CardTitle>
            <CardDescription>{plural(chapters.length, "chapter")} with patterns</CardDescription>
          </CardHeader>
          <CardBody>
            <Table caption={`Mock paper patterns in ${label}, by chapter`} minWidth="40rem">
              <THead>
                <tr>
                  <TH>Chapter</TH>
                  <TH align="right">Patterns</TH>
                  <TH align="right">Approved</TH>
                  <TH align="right">Draft</TH>
                  <TH align="right">Retired</TH>
                  <TH>By Marks</TH>
                </tr>
              </THead>
              <TBody>
                {chapters.map((chapter) => (
                  <TR key={chapter.id}>
                    <TD className="font-semibold">
                      {chapter.chapterNo}. {chapter.title}
                    </TD>
                    <TD align="right" className="tabular">{chapter.patterns}</TD>
                    <TD align="right" className="tabular">{chapter.approved}</TD>
                    <TD align="right" className="tabular">{chapter.draft}</TD>
                    <TD align="right" className="tabular">{chapter.retired}</TD>
                    <TD className="text-content-muted">{marksLine(chapter.byMarks)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
