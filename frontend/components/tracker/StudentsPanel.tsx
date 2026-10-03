"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { Pagination } from "@/components/ui/Pagination";
import { SearchInput } from "@/components/ui/SearchInput";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { RosterIllustration } from "@/components/brand/Graphics";
import { Initials, PercentText, scopeParams } from "@/components/tracker/TrackerBits";
import { formatDateTime, studentClassLabel } from "@/lib/tracker";
import type { Paginated, TrackerStudentRow } from "@/types/tracker";

/**
 * A section's students and their practice numbers. With "All My Sections"
 * it lists every student on a current section's roster (plus anyone a
 * readable assignment reached); picking a section narrows it to that
 * section. The numbers only ever count assignments this teacher can see,
 * so after a handover they reflect the teacher's own window.
 */
export function StudentsPanel({
  scopeKey,
  page,
  q,
  onChange,
}: {
  scopeKey: string;
  page: number;
  q: string;
  onChange: (updates: Record<string, string | number | null>) => void;
}) {
  const router = useRouter();
  const { data, error, loading } = useApiQuery<Paginated<TrackerStudentRow>>("/learning/tracker/students", {
    ...scopeParams(scopeKey),
    q,
    page,
    pageSize: 25,
  });

  // Carry the section into the student's page, so 5A's tracker opens 5A's
  // history for that student (the page can widen it back out).
  const studentHref = (id: string) =>
    `/teacher/tracker/students/${id}${scopeKey ? `?scope=${encodeURIComponent(scopeKey)}` : ""}`;

  return (
    <div className="space-y-4">
      <SearchInput value={q} onSearch={(value) => onChange({ q: value, page: null })} label="Search students by name or code" />

      {error ? <AlertBanner tone="error" message={`Couldn't load students (${error}).`} /> : null}

      {!data && loading ? (
        <TableSkeleton label="Loading students" />
      ) : data && data.total === 0 ? (
        q ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center">
            <Users className="h-5 w-5 text-content-faint" aria-hidden />
            <p className="text-[0.875rem] font-semibold text-content">No students match that</p>
            {/* `tinted`, not `ghost` (2 Oct 2026): this is the only action in
                the box, and Button.tsx's rule is that an action on its own
                needs chrome of its own -- ghost left it as a grey word
                under the message. */}
            <Button type="button" variant="tinted" size="sm" onClick={() => onChange({ q: null, page: null })}>
              Clear Search
            </Button>
          </div>
        ) : (
          <EmptyState
            illustration={<RosterIllustration />}
            status={{ label: "No Students Yet", tone: "neutral" }}
            title="No students to show"
            description="Students appear here once your school admin assigns you a section and adds its students to the roster."
          />
        )
      ) : data ? (
        <>
          <Table caption={`Students, page ${data.page} of ${data.totalPages}`} busy={loading} minWidth="52rem">
            <THead>
              <TH>Student</TH>
              <TH>Class</TH>
              <TH align="right">Assigned</TH>
              <TH align="right">Completed</TH>
              <TH align="right">Average</TH>
              <TH align="center">To Mark</TH>
              <TH>Last Submitted</TH>
            </THead>
            <TBody>
              {data.items.map((row) => {
                const href = studentHref(row.studentId);
                return (
                  <TR key={row.studentId} onClick={() => router.push(href)}>
                    <TD>
                      <span className="flex items-center gap-3">
                        <Initials name={row.studentName} muted={!row.isActive} />
                        <span className="min-w-0">
                          <Link
                            href={href}
                            onClick={(event) => event.stopPropagation()}
                            className="block truncate font-semibold text-content hover:text-content-brand"
                          >
                            {row.studentName ?? row.studentCode}
                          </Link>
                          <span className="block font-mono text-[0.75rem] text-content-subtle">
                            {row.studentCode}
                            {!row.isActive ? " · Inactive" : ""}
                          </span>
                        </span>
                      </span>
                    </TD>
                    <TD className="text-content-muted">{studentClassLabel(row.className, row.section)}</TD>
                    <TD align="right" className="tabular text-content-muted">
                      {row.stats.assigned}
                    </TD>
                    <TD align="right" className="tabular text-content-muted">
                      {row.stats.completed} of {row.stats.assigned}
                    </TD>
                    <TD align="right">
                      <PercentText percent={row.stats.averagePercent} />
                    </TD>
                    <TD align="center">
                      {row.stats.needsReview > 0 ? (
                        <Badge tone="warning">{row.stats.needsReview}</Badge>
                      ) : (
                        <span className="text-content-faint">&mdash;</span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-content-muted">{formatDateTime(row.stats.lastSubmittedAt) ?? "—"}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            totalPages={data.totalPages}
            onPageChange={(next) => onChange({ page: next })}
            noun="student"
            label="Student pages"
            busy={loading}
          />
        </>
      ) : null}
    </div>
  );
}
