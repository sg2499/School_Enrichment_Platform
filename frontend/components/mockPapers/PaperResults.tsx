"use client";

/**
 * An approved paper's results and marking (#166 step 4), for the section's
 * teacher and the school's admin. Results: question by student, with
 * totals. Each student sees their marks at hand-in and the solutions once
 * the paper closes (#208: no release step). Marking: each written answer,
 * with that student's own question and marking steps (every student's
 * numbers differ); a mark can be changed at any time. With every long
 * answer in steps (#208 part 2) and no method marks on mocks, this tab is
 * normally empty.
 */
import { useState } from "react";
import { Save } from "lucide-react";
import { api, describeApiError } from "@/lib/api";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { RESULT_STATE_LABEL } from "@/lib/mockPapers";
import { formatDateTime } from "@/lib/tracker";
import { cn } from "@/lib/utils";
import { AlertBanner, LoadError } from "@/components/ui/AlertBanner";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { TableSkeleton } from "@/components/ui/Table";
import type { MarkingView, ResultsGrid } from "@/types/mockPapers";

const STATE_TONE = { NOT_STARTED: "neutral", IN_PROGRESS: "brand", TO_MARK: "warning", MARKED: "success" } as const;

export function ResultsPanel({ paperId, canAct }: { paperId: string; canAct: boolean }) {
  const grid = useApiQuery<ResultsGrid>(`/mock-papers/${paperId}/results`, {}, { action: "load the results" });
  if (grid.problem) return <LoadError problem={grid.problem} onRetry={grid.reload} />;
  if (!grid.data) return <TableSkeleton label="Loading the results" rows={5} />;
  const g = grid.data;
  // #208: no release step. Each student sees their marks at hand-in, and the
  // right answers and solutions once the paper closes.
  const why = [
    g.toMark ? `${g.toMark} written ${g.toMark === 1 ? "answer is" : "answers are"} still to be marked` : null,
    g.solutionsOpen
      ? "students see their marks and the solutions"
      : `students see their marks at once, the solutions when the paper closes (${formatDateTime(g.closesAt)})`,
  ]
    .filter(Boolean)
    .join("; ");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-content-muted">
          {g.handedIn} of {g.students.length} handed in{g.inProgress ? `, ${g.inProgress} sitting now` : ""} ·{" "}
          {why.replace(/^./, (c) => c.toUpperCase())}.
        </p>
      </div>
      {g.shuffled ? (
        <p className="text-xs text-content-subtle">Columns follow the paper as built; each student saw the questions in their own order.</p>
      ) : null}
      {g.students.length === 0 ? (
        <Card className="p-6">
          <EmptyState title="No Student Yet" description="Each student's results appear here once they sit the paper." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <caption className="sr-only">Each student&apos;s marks on each question</caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 z-10 min-w-[10rem] border-b border-line bg-surface px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-content-subtle"
                  >
                    Student
                  </th>
                  <th
                    scope="col"
                    className="border-b border-line bg-surface px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-content-subtle"
                  >
                    Total
                  </th>
                  {g.columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className="border-b border-line bg-surface px-1 py-3 text-center text-xs font-semibold text-content-subtle"
                      title={`${c.marks} marks${c.choice ? ", either/or" : ""}`}
                    >
                      Q{c.number}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.students.map((s) => (
                  <tr key={s.studentId}>
                    <th scope="row" className="sticky left-0 z-10 border-b border-line bg-surface px-4 py-2 text-left font-normal">
                      <span className="block font-semibold text-content">{s.name}</span>
                      <span className="block text-xs text-content-subtle">{s.studentCode}</span>
                    </th>
                    <td className="border-b border-line px-3 py-2 whitespace-nowrap">
                      {s.state === "MARKED" ? (
                        <span className="font-semibold text-content">
                          {s.score} / {g.totalMarks}
                        </span>
                      ) : (
                        <Badge tone={STATE_TONE[s.state]}>{RESULT_STATE_LABEL[s.state]}</Badge>
                      )}
                    </td>
                    {g.columns.map((c) => {
                      const cell = s.cells[c.key];
                      const text = !cell ? "–" : cell.waiting ? "…" : `${cell.score}`;
                      const label = !cell
                        ? `Question ${c.number}: not handed in`
                        : cell.waiting
                          ? `Question ${c.number}: waiting for marks`
                          : `Question ${c.number}: ${cell.score} of ${cell.max}${cell.blank ? ", left blank" : ""}`;
                      return (
                        <td key={c.key} className="border-b border-line px-1 py-2 text-center">
                          <span
                            role="img"
                            aria-label={label}
                            title={label}
                            className={cn(
                              "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1 text-xs font-bold",
                              !cell
                                ? "text-content-faint"
                                : cell.waiting
                                  ? "bg-brand-50 text-brand-700"
                                  : cell.score === cell.max
                                    ? "bg-jade-100 text-jade-800"
                                    : cell.score > 0
                                      ? "bg-saffron-100 text-saffron-900"
                                      : "bg-coral-100 text-coral-800",
                            )}
                          >
                            {text}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export function MarkingPanel({ paperId, canAct }: { paperId: string; canAct: boolean }) {
  const view = useApiQuery<MarkingView>(`/mock-papers/${paperId}/marking`, {}, { action: "load the written answers" });
  const [data, setData] = useState<MarkingView | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const shown = data ?? view.data;
  if (view.problem) return <LoadError problem={view.problem} onRetry={view.reload} />;
  if (!shown) return <TableSkeleton label="Loading the written answers" rows={4} />;
  const editable = canAct && shown.canMark;
  if (shown.questions.length === 0) {
    return (
      <Card className="p-6">
        <EmptyState
          title="Nothing to Mark"
          description="The platform marks every answer, step by step. A written answer from an older question would appear here for you to mark."
        />
      </Card>
    );
  }
  return (
    <div className="space-y-5">
      <p className="text-sm text-content-muted">
        {shown.toMark ? `${shown.toMark} written ${shown.toMark === 1 ? "answer" : "answers"} to mark.` : "Every written answer is marked."}{" "}
        Each student had their own numbers, so each answer shows that student&apos;s question and marking steps.
      </p>
      {shown.shuffled ? (
        <p className="text-xs text-content-subtle">
          Question numbers here are the paper as built; each student saw their own order, so their numbers may differ.
        </p>
      ) : null}
      {problem ? <AlertBanner tone="error" message={problem} /> : null}
      {notice ? <AlertBanner tone="success" message={notice} /> : null}
      {shown.questions.map((q) => {
        const changed = q.answers.filter((a) => draft[a.answerId] !== undefined && draft[a.answerId] !== String(a.score ?? ""));
        return (
          <section key={q.key} aria-label={`Question ${q.number}`} className="space-y-3">
            <h3 className="font-display text-lg text-content">
              Question {q.number} <span className="text-sm font-normal text-content-subtle">· {q.marks} marks</span>
            </h3>
            <ol className="space-y-3">
              {q.answers.map((a) => {
                const value = draft[a.answerId] ?? (a.score === null ? "" : String(a.score));
                return (
                  <li key={a.answerId}>
                    <Card>
                      <CardBody className="space-y-3 sm:p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <p className="text-sm">
                            <span className="font-semibold text-content">{a.student}</span>{" "}
                            <span className="text-xs text-content-subtle">{a.studentCode}</span>
                          </p>
                          <label className="flex items-center gap-2 text-sm font-semibold text-content">
                            Marks
                            <select
                              value={value}
                              disabled={!editable}
                              onChange={(e) => setDraft({ ...draft, [a.answerId]: e.target.value })}
                              className="h-10 rounded-xl border border-line-field bg-surface px-3 text-sm"
                            >
                              <option value="">Not marked</option>
                              {Array.from({ length: a.maxScore + 1 }, (_, i) => (
                                <option key={i} value={i}>
                                  {i} of {a.maxScore}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <p className="whitespace-pre-line text-sm text-content-muted">{a.question}</p>
                        <div className="rounded-xl border border-line p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle">Student&apos;s Answer</p>
                          <p className="mt-1 whitespace-pre-line text-sm text-content">{a.response || "Left blank"}</p>
                        </div>
                        <details className="rounded-xl bg-surface-muted px-3 py-2 text-sm text-content-muted" open>
                          <summary className="cursor-pointer font-semibold text-content">Marking Steps and Model Answer</summary>
                          {a.markingSteps ? <p className="mt-2 whitespace-pre-line">{a.markingSteps}</p> : null}
                          {a.modelAnswer ? (
                            <p className="mt-2 whitespace-pre-line">
                              <span className="font-semibold text-content">Model answer:</span> {a.modelAnswer}
                            </p>
                          ) : null}
                        </details>
                      </CardBody>
                    </Card>
                  </li>
                );
              })}
            </ol>
            {editable ? (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  leadingIcon={<Save className="h-4 w-4" />}
                  disabled={changed.length === 0}
                  loading={busy === q.key}
                  loadingLabel="Saving"
                  onClick={async () => {
                    setBusy(q.key);
                    setProblem(null);
                    setNotice(null);
                    try {
                      const { data: next } = await api.post<MarkingView>(`/mock-papers/${paperId}/marks`, {
                        marks: changed.map((a) => ({
                          answerId: a.answerId,
                          score: draft[a.answerId] === "" ? null : Number(draft[a.answerId]),
                        })),
                      });
                      setData(next);
                      setDraft((d) => {
                        const rest = { ...d };
                        for (const a of changed) delete rest[a.answerId];
                        return rest;
                      });
                      setNotice(`Saved marks for question ${q.number}.`);
                    } catch (err) {
                      setProblem(describeApiError(err, "save these marks").message);
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Save Marks
                </Button>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
