"use client";

import Link from "next/link";
import { CheckCircle2, PenLine } from "lucide-react";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { Pagination } from "@/components/ui/Pagination";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Initials, scopeParams } from "@/components/tracker/TrackerBits";
import { formatDateTime, plural, scopeShort } from "@/lib/tracker";
import type { Paginated, ReviewQueueRow } from "@/types/tracker";

/**
 * Submitted attempts with written answers waiting for this teacher's marks,
 * oldest first. Only attempts the teacher can actually mark are listed --
 * a handed-over section's pending work isn't "waiting for you"; it stays
 * visible, read-only, on its assignment's page.
 */
export function ReviewQueuePanel({
  scopeKey,
  page,
  onChange,
}: {
  scopeKey: string;
  page: number;
  q: string;
  onChange: (updates: Record<string, string | number | null>) => void;
}) {
  const { data, error, loading } = useApiQuery<Paginated<ReviewQueueRow>>("/learning/tracker/review-queue", {
    ...scopeParams(scopeKey),
    page,
    pageSize: 20,
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-content-muted">
        Answers that can&rsquo;t be marked automatically &mdash; written explanations and other open responses &mdash; wait
        here, oldest submission first. Scores stay provisional until every answer in the attempt is marked.
      </p>

      {error ? <AlertBanner tone="error" message={`Couldn't load the marking queue (${error}).`} /> : null}

      {!data && loading ? (
        <TableSkeleton label="Loading the marking queue" />
      ) : data && data.total === 0 ? (
        <EmptyState
          illustration={
            <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-jade-50 text-jade-600 ring-1 ring-inset ring-jade-100">
              <CheckCircle2 className="h-9 w-9" />
            </span>
          }
          status={{ label: "All Caught Up", tone: "success" }}
          title="Nothing waiting for your marks"
          description="When a student submits an answer that needs a teacher's judgement, it lands here."
        />
      ) : data ? (
        <>
          <Table caption={`Attempts waiting for marks, page ${data.page} of ${data.totalPages}`} busy={loading} minWidth="52rem">
            <THead>
              <TH>Student</TH>
              <TH>Practice</TH>
              <TH>Section</TH>
              <TH>Submitted</TH>
              <TH>To Mark</TH>
              <TH align="right">
                <span className="sr-only">Actions</span>
              </TH>
            </THead>
            <TBody>
              {data.items.map((row) => (
                <TR key={row.attemptId}>
                  <TD>
                    <span className="flex items-center gap-3">
                      <Initials name={row.studentName} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-content">{row.studentName ?? row.studentCode}</span>
                        <span className="block font-mono text-[0.75rem] text-content-subtle">{row.studentCode}</span>
                      </span>
                    </span>
                  </TD>
                  <TD className="max-w-[18rem]">
                    <Link
                      href={`/teacher/tracker/assignments/${row.assignment.id}`}
                      className="block truncate font-medium text-content hover:text-content-brand"
                    >
                      {row.assignment.title ?? "Learning Activity"}
                    </Link>
                    <span className="block text-xs text-content-subtle">Attempt {row.attemptNumber}</span>
                  </TD>
                  <TD className="whitespace-nowrap text-content-muted">{scopeShort(row.assignment)}</TD>
                  <TD className="whitespace-nowrap text-content-muted">{formatDateTime(row.submittedAt) ?? "—"}</TD>
                  <TD className="whitespace-nowrap text-content-muted">
                    <span className="font-semibold text-content">{plural(row.answersToMark, "answer")}</span>
                    {row.answersMarked > 0 ? <span className="text-content-subtle"> · {row.answersMarked} done</span> : null}
                  </TD>
                  <TD align="right">
                    <ButtonLink
                      href={`/teacher/tracker/attempts/${row.attemptId}?from=review`}
                      variant="secondary"
                      size="sm"
                      leadingIcon={<PenLine className="h-3.5 w-3.5" />}
                      aria-label={`Mark ${row.studentName ?? row.studentCode}'s attempt ${row.attemptNumber}`}
                    >
                      Mark Answers
                    </ButtonLink>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            totalPages={data.totalPages}
            onPageChange={(next) => onChange({ page: next })}
            noun="attempt"
            label="Marking queue pages"
            busy={loading}
          />
        </>
      ) : null}
    </div>
  );
}
