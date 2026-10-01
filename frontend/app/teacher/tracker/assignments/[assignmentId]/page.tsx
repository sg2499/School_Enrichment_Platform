"use client";

/**
 * One assignment, full screen (1 Oct 2026, Practice Tracker).
 *
 * The paginated successor to the old results modal: every targeted student
 * as a table row (paged by the server, filterable by where they've got to,
 * searchable), each with their attempts, latest score, and the two actions
 * a teacher takes from here -- open an attempt to review or mark it, and
 * grant one more attempt to a student who has used all of theirs.
 *
 * RoleShell collapses the sidebar on this route (FOCUS_ROUTES) so the table
 * gets the whole width. Filter, search and page live in the URL.
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Eye, PenLine, RotateCcw, Search } from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { pageFromParam, useUrlState } from "@/lib/hooks/useUrlState";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { FilterChips } from "@/components/ui/FilterChips";
import { Pagination } from "@/components/ui/Pagination";
import { SearchInput } from "@/components/ui/SearchInput";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import {
  AssignmentStatusBadge,
  BackLink,
  Initials,
  PercentText,
  ReadOnlyBadge,
  ScoreBadge,
  StatTile,
  TargetStatusBadge,
} from "@/components/tracker/TrackerBits";
import { formatDay, plural, scopeLabel, studentClassLabel } from "@/lib/tracker";
import { ACTIVITY_TYPE_LABEL } from "@/types/learning";
import type { AssignmentStudentRow, AssignmentStudentsPage, StudentFilter, TrackerAssignmentDetail } from "@/types/tracker";

const FILTERS: StudentFilter[] = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "NEEDS_REVIEW"];

function filterFromParam(value: string | null): StudentFilter | "" {
  return FILTERS.includes(value as StudentFilter) ? (value as StudentFilter) : "";
}

/** The attempt a row's main action should open: the oldest one still
 *  waiting for marks if there is one (first in, first marked), otherwise
 *  the latest submitted one. */
function attemptToOpen(row: AssignmentStudentRow) {
  const pending = row.attempts.find((a) => a.evaluation?.reviewStatus === "PENDING_REVIEW");
  if (pending) return { attempt: pending, needsMarks: true };
  const submitted = [...row.attempts].reverse().find((a) => a.evaluation);
  return submitted ? { attempt: submitted, needsMarks: false } : null;
}

function AssignmentWorkspace() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { user, status } = useProtectedPage("TEACHER");
  const ready = status === "ready";
  const url = useUrlState();

  const filter = filterFromParam(url.get("status"));
  const q = url.get("q") ?? "";
  const page = pageFromParam(url.get("page"));

  const header = useApiQuery<TrackerAssignmentDetail>(`/learning/tracker/assignments/${assignmentId}`, {}, ready);
  const students = useApiQuery<AssignmentStudentsPage>(
    `/learning/tracker/assignments/${assignmentId}/students`,
    { status: filter, q, page, pageSize: 25 },
    ready,
  );

  const [grantingId, setGrantingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; message: string } | null>(null);

  async function grantAttempt(row: AssignmentStudentRow) {
    setGrantingId(row.assignmentTargetId);
    setNotice(null);
    try {
      await api.post(`/learning/assignments/${assignmentId}/targets/${row.assignmentTargetId}/grant-attempt`);
      setNotice({ tone: "success", message: `${row.studentName ?? row.studentCode} can now make one more attempt.` });
      students.reload();
    } catch (err) {
      setNotice({ tone: "error", message: apiErrorMessage(err) });
    } finally {
      setGrantingId(null);
    }
  }

  if (!ready) return <LoadingScreen />;

  const a = header.data;
  const counts = students.data?.counts;
  const filterOptions = [
    { value: "" as const, label: "All", count: counts?.all },
    { value: "NOT_STARTED" as const, label: "Not Started", count: counts?.notStarted },
    { value: "IN_PROGRESS" as const, label: "In Progress", count: counts?.inProgress },
    { value: "COMPLETED" as const, label: "Completed", count: counts?.completed },
    { value: "NEEDS_REVIEW" as const, label: "Needs Marking", count: counts?.needsReview },
  ];

  return (
    <RoleShell role="TEACHER" user={user}>
      <div className="space-y-7">
        <BackLink href="/teacher/tracker">Practice Tracker</BackLink>

        {header.error ? (
          <AlertBanner tone="error" message={`Couldn't open this assignment (${header.error}).`} />
        ) : null}

        {a ? (
          <>
            <PageHeader
              eyebrow={scopeLabel(a)}
              title={a.title ?? "Learning Activity"}
              description={[
                a.isMine ? "Set by you" : a.assignedByName ? `Set by ${a.assignedByName}` : "Set by your school",
                a.createdAt ? `on ${formatDay(a.createdAt)}` : null,
                a.dueDate ? `· Due ${formatDay(a.dueDate)}` : null,
                `· ${plural(a.questionCount, "question")}`,
                `· Up to ${plural(a.maxAttempts, "attempt")} each`,
              ]
                .filter(Boolean)
                .join(" ")}
              meta={
                <>
                  <AssignmentStatusBadge status={a.status} />
                  {a.activityType ? <Badge tone="brand">{ACTIVITY_TYPE_LABEL[a.activityType]}</Badge> : null}
                  {!a.canAct ? <ReadOnlyBadge /> : null}
                </>
              }
            />

            {!a.canAct ? (
              <AlertBanner
                tone="info"
                message="This section has been handed over to another teacher. You can still see everything that happened while you taught it, but marking and extra attempts are now theirs to give."
              />
            ) : null}

            <div className="grid grid-cols-2 gap-3 animate-fade-up sm:grid-cols-3 xl:grid-cols-6">
              <StatTile label="Students" value={a.progress.targeted} />
              <StatTile label="Completed" value={a.progress.completed} tone={a.progress.completed > 0 ? "good" : "default"} />
              <StatTile label="In Progress" value={a.progress.inProgress} />
              <StatTile label="Not Started" value={a.progress.notStarted} />
              <StatTile
                label="To Mark"
                value={a.progress.needsReview}
                tone={a.progress.needsReview > 0 ? "attention" : "default"}
                hint={a.progress.needsReview > 0 ? "Students with written answers" : undefined}
              />
              <StatTile label="Average" value={<PercentText percent={a.progress.averagePercent} />} hint="Latest final scores" />
            </div>
          </>
        ) : !header.error ? (
          <div aria-hidden className="space-y-3">
            <span className="block h-4 w-48 animate-pulse rounded-full bg-ink-100" />
            <span className="block h-9 w-96 max-w-full animate-pulse rounded-full bg-ink-100" />
          </div>
        ) : null}

        {!header.error ? (
          <Card className="animate-fade-up delay-70">
            <div className="flex flex-col gap-3 border-b border-line bg-surface-muted/60 px-5 py-3.5 sm:px-6 xl:flex-row xl:items-center">
              <FilterChips
                label="Filter students"
                options={filterOptions}
                value={filter}
                onChange={(value) => url.set({ status: value, page: null })}
              />
              <SearchInput
                className="xl:ml-auto xl:max-w-sm"
                value={q}
                onSearch={(value) => url.set({ q: value, page: null })}
                label="Search students by name or code"
              />
            </div>
            <div className="space-y-4 p-5 sm:p-6">
              {notice ? <AlertBanner tone={notice.tone} message={notice.message} /> : null}
              {students.error ? <AlertBanner tone="error" message={`Couldn't load students (${students.error}).`} /> : null}

              {!students.data && students.loading ? (
                <TableSkeleton label="Loading students" />
              ) : students.data && students.data.total === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center">
                  <Search className="h-5 w-5 text-content-faint" aria-hidden />
                  <p className="text-[0.875rem] font-semibold text-content">
                    {filter || q ? "No students match that" : "Nobody was targeted by this assignment"}
                  </p>
                  {filter || q ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => url.set({ status: null, q: null, page: null })}>
                      Clear Search And Filters
                    </Button>
                  ) : null}
                </div>
              ) : students.data ? (
                <>
                  <Table
                    caption={`Students on this assignment, page ${students.data.page} of ${students.data.totalPages}`}
                    busy={students.loading}
                    minWidth="56rem"
                  >
                    <THead>
                      <TH>Student</TH>
                      <TH>Status</TH>
                      <TH>Attempts</TH>
                      <TH>Latest Score</TH>
                      <TH align="right">
                        <span className="sr-only">Actions</span>
                      </TH>
                    </THead>
                    <TBody>
                      {students.data.items.map((row) => {
                        const open = attemptToOpen(row);
                        const studentHref = `/teacher/tracker/students/${row.studentId}`;
                        return (
                          <TR key={row.assignmentTargetId}>
                            <TD>
                              <span className="flex items-center gap-3">
                                <Initials name={row.studentName} muted={!row.isActive} />
                                <span className="min-w-0">
                                  <Link href={studentHref} className="block truncate font-semibold text-content hover:text-content-brand">
                                    {row.studentName ?? row.studentCode}
                                  </Link>
                                  <span className="block font-mono text-[0.75rem] text-content-subtle">
                                    {row.studentCode} · {studentClassLabel(row.className, row.section)}
                                  </span>
                                </span>
                              </span>
                            </TD>
                            <TD>
                              <TargetStatusBadge status={row.status} />
                            </TD>
                            <TD className="whitespace-nowrap text-content-muted tabular">
                              {row.attemptsUsed} of {row.attemptsAllowed} used
                              {row.bonusAttempts > 0 ? (
                                <span className="block text-xs text-content-subtle">{plural(row.bonusAttempts, "extra attempt")} granted</span>
                              ) : null}
                            </TD>
                            <TD>
                              <ScoreBadge evaluation={row.latestAttempt?.evaluation ?? null} />
                            </TD>
                            <TD align="right">
                              <span className="inline-flex flex-wrap items-center justify-end gap-2">
                                {open ? (
                                  <ButtonLink
                                    href={`/teacher/tracker/attempts/${open.attempt.id}`}
                                    variant={open.needsMarks && students.data?.canAct ? "secondary" : "ghost"}
                                    size="sm"
                                    leadingIcon={
                                      open.needsMarks && students.data?.canAct ? (
                                        <PenLine className="h-3.5 w-3.5" />
                                      ) : (
                                        <Eye className="h-3.5 w-3.5" />
                                      )
                                    }
                                    aria-label={`${open.needsMarks && students.data?.canAct ? "Mark" : "Review"} ${row.studentName ?? row.studentCode}'s attempt ${open.attempt.attemptNumber}`}
                                  >
                                    {open.needsMarks && students.data?.canAct ? "Mark Answers" : "Review"}
                                  </ButtonLink>
                                ) : null}
                                {row.canGrantAttempt ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    leadingIcon={<RotateCcw className="h-3.5 w-3.5" />}
                                    loading={grantingId === row.assignmentTargetId}
                                    loadingLabel="Granting"
                                    disabled={Boolean(grantingId) && grantingId !== row.assignmentTargetId}
                                    onClick={() => grantAttempt(row)}
                                    aria-label={`Grant ${row.studentName ?? row.studentCode} an extra attempt`}
                                  >
                                    Grant Extra Attempt
                                  </Button>
                                ) : null}
                              </span>
                            </TD>
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                  <Pagination
                    page={students.data.page}
                    pageSize={students.data.pageSize}
                    total={students.data.total}
                    totalPages={students.data.totalPages}
                    onPageChange={(next) => url.set({ page: next })}
                    noun="student"
                    label="Student pages"
                    busy={students.loading}
                  />
                </>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>
    </RoleShell>
  );
}

export default function TrackerAssignmentPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <AssignmentWorkspace />
    </Suspense>
  );
}
