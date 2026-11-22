"use client";

/**
 * Question Bank (#224, 12 Nov 2026): how much content there is, by chapter
 * and skill, and how far it is reviewed. Counts here; each chapter's
 * Preview Questions opens ChapterPreview, the questions as a student sees them. A Super Admin sees every
 * chapter and the review counts; a school's admin sees the published
 * chapters of the school's own board.
 */
import { Fragment, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { difficultyLine, plural, sharePercent, waitingApproval } from "@/lib/overview";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectField } from "@/components/ui/Field";
import { LoadError } from "@/components/ui/AlertBanner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { QuestionBankOverview } from "@/types/overview";

export function QuestionBank() {
  const bank = useApiQuery<QuestionBankOverview>("/overview/question-bank", {}, { action: "load the question bank" });
  const [open, setOpen] = useState<string | null>(null);
  const data = bank.data;

  // Board, class and subject filters (20 Nov 2026, Shailesh: the Super Admin
  // sees 60 chapters across four courses and it read as clutter). Kept in the
  // address so Back from a chapter preview returns to the same view. Each list
  // only offers what the earlier choices leave, so no choice can be empty.
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const all = useMemo(() => data?.chapters ?? [], [data]);
  const boardOptions = useMemo(() => [...new Set(all.map((c) => c.board))].sort(), [all]);
  const picked = {
    board: boardOptions.includes(search.get("board") ?? "") ? (search.get("board") as string) : "",
    classCode: "",
    subject: "",
  };
  const inBoard = all.filter((c) => !picked.board || c.board === picked.board);
  const classOptions = [...new Set(inBoard.map((c) => c.classCode))].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  picked.classCode = classOptions.includes(search.get("class") ?? "") ? (search.get("class") as string) : "";
  const inClass = inBoard.filter((c) => !picked.classCode || c.classCode === picked.classCode);
  const subjectOptions = [...new Set(inClass.map((c) => c.subject))].sort();
  picked.subject = subjectOptions.includes(search.get("subject") ?? "") ? (search.get("subject") as string) : "";
  const shown = inClass.filter((c) => !picked.subject || c.subject === picked.subject);
  const filtered = Boolean(picked.board || picked.classCode || picked.subject);
  // The filters ride along to a chapter's preview so its back link returns here.
  const filterQuery = new URLSearchParams(
    [["board", picked.board], ["class", picked.classCode], ["subject", picked.subject]].filter(([, v]) => v),
  ).toString();
  const setFilter = (key: "board" | "class" | "subject", value: string) => {
    const next = new URLSearchParams(search.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // A narrower choice can make a later one impossible: drop it.
    if (key === "board") {
      next.delete("class");
      next.delete("subject");
    }
    if (key === "class") next.delete("subject");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  const platform = data?.scope === "platform";
  const value = (n: number | undefined) => (bank.problem ? "—" : data && n !== undefined ? n.toLocaleString("en-IN") : null);

  const groups = useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>["chapters"]>();
    for (const chapter of shown) {
      const key = `${chapter.board} · Class ${chapter.classCode} · ${chapter.subject}`;
      map.set(key, [...(map.get(key) ?? []), chapter]);
    }
    return [...map.entries()];
  }, [shown]);

  return (
    <div className="space-y-6">
      <PageHeader
        surface="masthead"
        eyebrow="Content"
        title="Question Bank"
        description={
          platform
            ? "How many questions each chapter and skill has, and how far they are reviewed. Open Preview Questions on any chapter, at any status, to see its questions as a student does, with the answer key."
            : "How many questions your school's published chapters have, by skill. Open Preview Questions on any chapter to see its questions exactly as a student does."
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

      {data && all.length > 0 ? (
        <Card>
          <CardBody className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3" role="group" aria-label="Filter the question bank">
              <SelectField label="Board" value={picked.board} onChange={(event) => setFilter("board", event.target.value)}>
                <option value="">All Boards</option>
                {boardOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </SelectField>
              <SelectField label="Class" value={picked.classCode} onChange={(event) => setFilter("class", event.target.value)}>
                <option value="">All Classes</option>
                {classOptions.map((option) => (
                  <option key={option} value={option}>
                    {`Class ${option}`}
                  </option>
                ))}
              </SelectField>
              <SelectField label="Subject" value={picked.subject} onChange={(event) => setFilter("subject", event.target.value)}>
                <option value="">All Subjects</option>
                {subjectOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </SelectField>
            </div>
            <p className="text-sm text-content-muted" aria-live="polite">
              {plural(shown.length, "chapter")} of {all.length}
              {filtered ? (
                <>
                  {" "}
                  &middot;{" "}
                  <button
                    type="button"
                    className="font-semibold text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    onClick={() => router.replace(pathname, { scroll: false })}
                  >
                    Clear Filters
                  </button>
                </>
              ) : null}
            </p>
          </CardBody>
        </Card>
      ) : null}

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
          <CardHeader className="flex-col items-start gap-1 [&>h3]:max-w-none">
            <CardTitle>{label}</CardTitle>
            <CardDescription>{plural(chapters.length, "chapter")}</CardDescription>
          </CardHeader>
          <CardBody>
            <Table caption={`Questions in ${label}, by chapter`} minWidth="52rem">
              <THead>
                  <TH>Chapter</TH>
                  <TH align="right">Skills</TH>
                  <TH align="right">Questions</TH>
                  <TH align="right">Approved</TH>
                  {platform ? <TH align="right">In Review</TH> : null}
                  {platform ? <TH align="right">Flagged</TH> : null}
                  <TH>Difficulty</TH>
                  <TH align="right">
                    <span className="sr-only">Preview</span>
                  </TH>
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
                        <TD align="right">
                          <ButtonLink
                            href={`/admin/question-bank/${chapter.id}${filterQuery ? `?${filterQuery}` : ""}`}
                            variant="secondary"
                            size="sm"
                            aria-label={`Preview questions in ${chapter.title}`}
                          >
                            Preview
                          </ButtonLink>
                        </TD>
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
                              <TD align="right">&nbsp;</TD>
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
