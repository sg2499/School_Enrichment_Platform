"use client";

/**
 * Chapter Preview (20 Nov 2026, Shailesh): an admin opens any chapter in the
 * Question Bank and sees its questions exactly as a student is given them, so
 * content can be checked and fixed before a school's teachers and students
 * use it. Built from the same pieces as the student's practice page (the
 * answer controls, MathText, the figure, the "Your Working" box), so a
 * question that reads or draws wrongly here would read or draw wrongly there.
 *
 * Nothing is stored: what is typed into an answer box stays in this page. A
 * school's admin sees only what a student can be given (approved questions)
 * and no answer key. A Super Admin sees every question at any status and can
 * turn on the answer, accepted answers, hint and explanation.
 */
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { QuestionInput, WorkingBox } from "@/components/practice/AnswerInput";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadError, AlertBanner } from "@/components/ui/AlertBanner";
import { InlineLink } from "@/components/ui/InlineLink";
import { MathText } from "@/components/ui/MathText";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { QuestionFigure } from "@/components/ui/QuestionFigure";
import { TableSkeleton } from "@/components/ui/Table";
import type { ChapterPreviewPage, PreviewQuestion } from "@/types/overview";

const PAGE_SIZE = 20;
const DIFFICULTY_NAME: Record<number, string> = { 1: "Easy", 2: "Medium", 3: "Hard", 4: "Challenge" };

function AnswerKey({ question }: { question: PreviewQuestion }) {
  const rows: [string, string | null | undefined][] = [
    ["Answer", question.correctAnswer],
    ["Also accepted", question.acceptedVariants],
    ["Hint", question.hint],
    ["Explanation", question.explanation],
  ];
  return (
    <dl className="space-y-2 rounded-2xl border border-line bg-surface-muted/50 p-4 text-sm">
      {rows
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-semibold uppercase tracking-eyebrow text-content-subtle">{label}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap wrap-break-word text-content">
              <MathText>{value as string}</MathText>
            </dd>
          </div>
        ))}
    </dl>
  );
}

export function ChapterPreview({ chapterId, backHref }: { chapterId: string; backHref: string }) {
  const [page, setPage] = useState(1);
  const [skillId, setSkillId] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [workings, setWorkings] = useState<Record<string, string>>({});

  const preview = useApiQuery<ChapterPreviewPage>(
    `/overview/question-bank/chapters/${chapterId}/preview`,
    { page, pageSize: PAGE_SIZE, skillId },
    { action: "load the chapter preview" },
  );
  const data = preview.data;
  const chapter = data?.chapter;
  const canSeeKey = data?.showsAnswers === true;

  return (
    <div className="space-y-6">
      <PageHeader
        surface="masthead"
        eyebrow="Chapter Preview"
        title={chapter ? `${chapter.chapterNo}. ${chapter.title}` : "Chapter Preview"}
        back={
          <InlineLink href={backHref} direction="back" tone="inverse" size="sm">
            Question Bank
          </InlineLink>
        }
        meta={
          chapter && chapter.status !== "PUBLISHED" ? (
            <Badge tone="neutral" onDark>
              {chapter.status === "DRAFT" ? "Draft" : "In Review"}
            </Badge>
          ) : undefined
        }
        facts={
          chapter
            ? [
                { label: "Board", value: chapter.board },
                { label: "Class", value: chapter.classCode },
                { label: "Subject", value: chapter.subject },
                { label: "Questions shown", value: data?.total ?? 0 },
              ]
            : undefined
        }
      />

      <AlertBanner
        tone="info"
        message={
          canSeeKey
            ? "This is how students see it. Every question at any status is listed. Turn on the answer key to check answers, hints and explanations. Nothing you type is saved."
            : "This is how students see it. Only questions a student can be given are listed, and there is no answer key. Nothing you type is saved."
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold uppercase tracking-eyebrow text-content-subtle">
          Skill
          <select
            className="max-w-full rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm font-normal normal-case tracking-normal text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            value={skillId}
            onChange={(event) => {
              setSkillId(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All skills</option>
            {(data?.skills ?? []).map((skill) => (
              <option key={skill.id} value={skill.id}>
                {skill.code} · {skill.title}
              </option>
            ))}
          </select>
        </label>
        {canSeeKey ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leadingIcon={showKey ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            onClick={() => setShowKey((on) => !on)}
            aria-pressed={showKey}
          >
            {showKey ? "Hide Answer Key" : "Show Answer Key"}
          </Button>
        ) : null}
      </div>

      {preview.problem ? <LoadError problem={preview.problem} onRetry={preview.reload} /> : null}
      {!data && !preview.problem ? <TableSkeleton label="Loading the questions" rows={5} /> : null}
      {data && data.items.length === 0 ? (
        <Card className="p-6">
          <EmptyState title="No Questions To Show" description="This chapter or skill has no questions a student can be given yet." />
        </Card>
      ) : null}

      <ol className="space-y-4">
        {(data?.items ?? []).map((question, index) => {
          const number = (data!.page - 1) * data!.pageSize + index + 1;
          return (
            <Card key={question.id} as="li">
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-700 font-display text-sm font-semibold tabular text-white shadow-brand"
                    >
                      {number}
                    </span>
                    <p className="text-xs font-semibold uppercase tracking-eyebrow text-content-subtle">
                      Question {number} of {data!.total} &middot; {question.marks} mark{question.marks === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-content-subtle">
                    <span className="font-mono">{question.code}</span>
                    <span aria-hidden>&middot;</span>
                    <span>{question.skillCode}</span>
                    {question.difficulty ? <Badge tone="neutral">{DIFFICULTY_NAME[question.difficulty] ?? `Level ${question.difficulty}`}</Badge> : null}
                    {canSeeKey && question.status && question.status !== "APPROVED" && question.status !== "PUBLISHED" ? (
                      <Badge tone="warning">{question.status.replace("_", " ").toLowerCase()}</Badge>
                    ) : null}
                    {canSeeKey && question.qualityStatus === "FLAGGED" ? <Badge tone="danger">flagged</Badge> : null}
                  </div>
                </div>
                <p className="text-[1rem] font-medium leading-relaxed text-content text-pretty">
                  <MathText>{question.stem}</MathText>
                </p>
                <QuestionFigure svg={question.figureSvg} />
                <QuestionInput
                  question={question}
                  value={answers[question.id] ?? ""}
                  onChange={(value) => setAnswers((prev) => ({ ...prev, [question.id]: value }))}
                />
                {question.acceptsWorking ? (
                  <WorkingBox
                    question={question}
                    value={workings[question.id] ?? ""}
                    disabled={false}
                    onChange={(text) => setWorkings((prev) => ({ ...prev, [question.id]: text }))}
                  />
                ) : null}
                {question.uploadRule && question.uploadRule !== "NONE" ? (
                  <p className="rounded-xl border border-dashed border-line-strong px-3 py-2 text-xs text-content-muted">
                    {question.uploadRule === "REQUIRED" ? "A PDF of working is required here." : "A PDF of working or a drawing can be added here."}
                  </p>
                ) : null}
                {canSeeKey && showKey ? <AnswerKey question={question} /> : null}
              </CardBody>
            </Card>
          );
        })}
      </ol>

      {data ? (
        <Pagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          totalPages={data.totalPages}
          onPageChange={(next) => {
            setPage(next);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          noun="question"
          label="Question pages"
          busy={preview.loading}
        />
      ) : null}
    </div>
  );
}
