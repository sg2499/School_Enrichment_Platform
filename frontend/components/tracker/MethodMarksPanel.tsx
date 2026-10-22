"use client";

import Link from "next/link";
import { CheckCircle2, ListChecks } from "lucide-react";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadError } from "@/components/ui/AlertBanner";
import { Pagination } from "@/components/ui/Pagination";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Initials, scopeParams } from "@/components/tracker/TrackerBits";
import { formatDateTime, plural, scopeShort } from "@/lib/tracker";
import type { MethodMarksRow, Paginated } from "@/types/tracker";

/**
 * Part and method marks (#163, 22 Oct 2026). Attempts where a student typed
 * their working under an answer worth 2 or more marks and the automatic
 * mark fell short of full marks, oldest first. Nothing here is waiting on
 * the teacher in the way Needs Review is: the automatic mark already
 * stands, and reviewing the working is how the teacher gives marks for a
 * correct method. Only attempts the teacher can act on are listed, the same
 * rule as the marking queue.
 */
export function MethodMarksPanel({
  scopeKey,
  page,
  onChange,
}: {
  scopeKey: string;
  page: number;
  q: string;
  onChange: (updates: Record<string, string | number | null>) => void;
}) {
  const { data, problem, loading, reload } = useApiQuery<Paginated<MethodMarksRow>>(
    "/learning/tracker/method-marks",
    {
      ...scopeParams(scopeKey),
      page,
      pageSize: 20,
    },
    { action: "load the working to review" },
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-content-muted">
        Students can show their working on questions worth 2 or more marks. Where the automatic mark fell short of full
        marks, the working waits here, oldest first, so you can give marks for a correct method. The automatic mark stands
        until you change it.
      </p>

      {problem ? <LoadError problem={problem} onRetry={reload} /> : null}

      {!data && loading ? (
        <TableSkeleton label="Loading the working to review" />
      ) : data && data.total === 0 ? (
        <EmptyState
          illustration={
            <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-jade-50 text-jade-600 ring-1 ring-inset ring-jade-100">
              <CheckCircle2 className="h-9 w-9" />
            </span>
          }
          status={{ label: "All Caught Up", tone: "success" }}
          title="No working waiting for you"
          description="When a student shows their working on an answer that lost marks, it lands here."
        />
      ) : data ? (
        <>
          <Table caption={`Attempts with working to review, page ${data.page} of ${data.totalPages}`} busy={loading} minWidth="52rem">
            <THead>
              <TH>Student</TH>
              <TH>Practice</TH>
              <TH>Section</TH>
              <TH>Submitted</TH>
              <TH>To Review</TH>
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
                  <TD className="whitespace-nowrap font-semibold text-content">{plural(row.answersToReview, "answer")}</TD>
                  <TD align="right">
                    <ButtonLink
                      href={`/teacher/tracker/attempts/${row.attemptId}?from=method`}
                      variant="secondary"
                      size="sm"
                      leadingIcon={<ListChecks className="h-3.5 w-3.5" />}
                      aria-label={`Review the working in ${row.studentName ?? row.studentCode}'s attempt ${row.attemptNumber}`}
                    >
                      Review Working
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
            label="Method marks pages"
            busy={loading}
          />
        </>
      ) : null}
    </div>
  );
}
