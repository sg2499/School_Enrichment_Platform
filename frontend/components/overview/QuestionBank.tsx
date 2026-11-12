"use client";

/**
 * Question Bank (#224, 12 Nov 2026): how much content there is, by chapter
 * and skill, and how far it is reviewed. Counts only -- never the question
 * wording, the answers or the explanations. A Super Admin sees every
 * chapter and the review counts; a school's admin sees the published
 * chapters of the school's own board.
 */
import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { difficultyLine, plural, sharePercent, waitingApproval } from "@/lib/overview";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadError } from "@/components/ui/AlertBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { QuestionBankOverview } from "@/types/overview";

export function QuestionBank() {
  const bank = useApiQuery<QuestionBankOverview>("/overview/question-bank", {}, { action: "load the question bank" });
  const [open, setOpen] = useState<string | null>(null);
  const data = bank.data;
  const platform = data?.scope === "platform";
  const value = (n: number | undefined) => (bank.problem ? "—" : data && n !== undefined ? n : null);

  const groups = useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>["chapters"]>();
    for (const chapter of data?.chapters ?? []) {
      const key = `${chapter.board} · Class ${chapter.classCode} · ${chapter.subject}`;
      map.set(key, [...(map.get(key) ?? []), chapter]);
    }
    return [...map.entries()];
  }, [data]);

  return (
    <div className="space-y-6">
      <PageHeader
        surface="masthead"
        eyebrow="Content"
        title="Question Bank"
        description={
          platform
            ? "How many questions each chapter and skill has, and how far they are reviewed. Counts only: the questions themselves are opened in Curriculum Studio."
            : "How many questions your school's published chapters have, by skill. Counts only: the questions themselves are not shown here."
        }
        stats={[
          { label: "Chapters", value: value(data?.totals.chapters) },
          { label: "Skills", value: value(data?.totals.skills) },
          { label: "Questions", value: value(data?.totals.questions) },
          {
            label: "Approved",
            value: value(data?.totals.approved),
            hint: data ? `${sharePercent(data.totals.approved, data.totals.questions)} of all questions` : undefined,
          },
        ]}
      />

      {bank.problem ? <LoadError problem={bank.problem} onRetry={bank.reload} /> : null}
      {!data && !bank.problem ? <TableSkeleton label="Loading the question bank" rows={6} /> : null}

      {data && data.chapters.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            title="No Chapters Yet"
            description={platform ? "Chapters appear here once they are added in Curriculum Studio." : "Your school's board has no published chapters yet."}
          />
        </Card>
      ) : null}

      {groups.map(([label, chapters]) => (
        <Card key={label}>
          <CardHeader>
            <CardTitle>{label}</CardTitle>
            <CardDescription>{plural(chapters.length, "chapter")}</CardDescription>
          </CardHeader>
          <CardBody>
            <Table caption={`Questions in ${label}, by chapter`} minWidth="46rem">
              <THead>
                <tr>
                  <TH>Chapter</TH>
                  <TH align="right">Skills</TH>
                  <TH align="right">Questions</TH>
                  <TH align="right">Approved</TH>
                  {platform ? <TH align="right">In Review</TH> : null}
                  {platform ? <TH align="right">Flagged</TH> : null}
                  <TH>Difficulty</TH>
                </tr>
              </THead>
              <TBody>
                {chapters.map((chapter) => {
                  const expanded = open === chapter.id;
                  const Chevron = expanded ? ChevronDown : ChevronRight;
                  return (
                    <Fragment key={chapter.id}>
                      <TR>
                        <TD>
                          <button
                            type="button"
                            className="flex items-center gap-2 text-left font-semibold text-content hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                            aria-expanded={expanded}
                            onClick={() => setOpen(expanded ? null : chapter.id)}
                          >
                            <Chevron className="h-4 w-4 shrink-0" aria-hidden />
                            <span>
                              {chapter.chapterNo}. {chapter.title}
                            </span>
                          </button>
                          {chapter.status !== "PUBLISHED" ? (
                            <Badge tone="neutral" className="ml-6 mt-1">
                              {chapter.status === "DRAFT" ? "Draft" : "In Review"}
                            </Badge>
                          ) : null}
                        </TD>
                        <TD align="right" className="tabular">{chapter.skillCount}</TD>
                        <TD align="right" className="tabular">{chapter.questions}</TD>
                        <TD align="right" className="tabular">
                          {chapter.approved}
                          {waitingApproval(chapter.questions, chapter.approved) > 0 ? (
                            <span className="block text-[0.6875rem] text-content-subtle">
                              {waitingApproval(chapter.questions, chapter.approved)} waiting
                            </span>
                          ) : null}
                        </TD>
                        {platform ? <TD align="right" className="tabular">{chapter.inReview ?? 0}</TD> : null}
                        {platform ? <TD align="right" className="tabular">{chapter.flagged ?? 0}</TD> : null}
                        <TD className="text-content-muted">{difficultyLine(chapter.byDifficulty)}</TD>
                      </TR>
                      {expanded
                        ? chapter.skills.map((skill) => (
                            <TR key={skill.id} className="bg-surface-muted/40">
                              <TD className="pl-10">
                                <span className="font-mono text-[0.75rem] text-content-subtle">{skill.code}</span>
                                <span className="ml-2">{skill.title}</span>
                              </TD>
                              <TD align="right">&nbsp;</TD>
                              <TD align="right" className="tabular">{skill.questions}</TD>
                              <TD align="right" className="tabular">{skill.approved}</TD>
                              {platform ? <TD align="right" className="tabular">{skill.inReview ?? 0}</TD> : null}
                              {platform ? <TD align="right" className="tabular">{skill.flagged ?? 0}</TD> : null}
                              <TD className="text-content-muted">{difficultyLine(skill.byDifficulty)}</TD>
                            </TR>
                          ))
                        : null}
                    </Fragment>
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
