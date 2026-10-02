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
 *
 * UI revamp, Phase A (2 Oct 2026). This is the screen the revamp started
 * from -- Shailesh's screenshot of it: "the buttons... appear like floating
 * text giving away a very casual and lanky feel". Three things were behind
 * that, all fixed here:
 *  - The row actions were `ghost` buttons (no fill, border or shadow until
 *    hover), so in the common case -- nothing to mark -- a row's actions
 *    were coloured words. They are `tinted` now, and "Mark Answers" stays
 *    `secondary` because it is the one that needs doing (Button.tsx has the
 *    rule).
 *  - The back link was bare text on the canvas. It is an InlineLink, and it
 *    sits with the header it belongs to instead of a full section-gap above
 *    it.
 *  - The header's metadata was one middle-dot sentence. It is passed to
 *    PageHeader as `facts` and drawn as a labelled strip.
 * It is also where the achievement spark is wired in: see the To Mark tile.
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CalendarClock, Eye, ListChecks, PenLine, Repeat2, RotateCcw, Search, UserRound } from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { pageFromParam, useUrlState } from "@/lib/hooks/useUrlState";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { useMarkingMilestone } from "@/lib/hooks/useMarkingMilestone";
import { api, apiErrorMessage } from "@/lib/api";
import { AchievementSpark } from "@/components/brand/AchievementSpark";
import { PageHeader, type PageHeaderFact } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { InlineLink } from "@/components/ui/InlineLink";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { FilterChips } from "@/components/ui/FilterChips";
import { Pagination } from "@/components/ui/Pagination";
import { SearchInput } from "@/components/ui/SearchInput";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import {
  AssignmentStatusBadge,
  Initials,
  PercentText,
  ReadOnlyBadge,
  ScoreBadge,
  StatTile,
  TargetStatusBadge,
  TeacherAmbience,
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

  // The achievement spark's trigger (2 Oct 2026). True when this page finds
  // To Mark at zero AND this teacher finalised an attempt on this
  // assignment earlier in the session -- i.e. the count reached zero by
  // their own marking, on the attempt page, not because the assignment
  // never had written answers. No request of its own: it reads the count
  // the header query above already fetched. useMarkingMilestone has the
  // full reasoning, including why this page can't simply watch its own
  // number fall (it isn't mounted while the marking happens).
  const justFinishedMarking = useMarkingMilestone(assignmentId, header.data?.progress.needsReview);

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

  // What used to be the header's one-sentence description ("Set by you on
  // 20 Aug · Due 25 Aug · 8 questions · Up to 3 attempts each"), as the
  // separate facts it always was. Same information, same conditions: Due is
  // left out when no due date was set, exactly as the sentence left it out.
  const setBy = a ? (a.isMine ? "You" : (a.assignedByName ?? "Your school")) : "";
  const setOn = a ? formatDay(a.createdAt) : null;
  const facts: PageHeaderFact[] = a
    ? [
        { label: "Set By", value: setOn ? `${setBy} on ${setOn}` : setBy, icon: <UserRound className="h-3.5 w-3.5" /> },
        ...(a.dueDate
          ? [{ label: "Due", value: formatDay(a.dueDate), icon: <CalendarClock className="h-3.5 w-3.5" /> }]
          : []),
        { label: "Questions", value: a.questionCount, icon: <ListChecks className="h-3.5 w-3.5" /> },
        { label: "Attempts", value: `Up to ${a.maxAttempts} each`, icon: <Repeat2 className="h-3.5 w-3.5" /> },
      ]
    : [];

  return (
    <RoleShell role="TEACHER" user={user}>
      <TeacherAmbience />
      {/* space-y-8: the working-page rhythm (Assign, People, Security, Daily
          Practice); dashboards use space-y-10. This family alone was 7.
          `relative` so the page paints above the ambience. */}
      <div className="relative space-y-8">
        {/* The back link and the header are one block. The link used to be
            a sibling of the header in the space-y-8 stack, a full 2rem
            section gap above the title it leads back from -- the distance
            that made it look like it belonged to nothing. */}
        <div className="space-y-5">
          <InlineLink href="/teacher/tracker" direction="back">
            Practice Tracker
          </InlineLink>

          {header.error ? (
            <AlertBanner tone="error" message={`Couldn't open this assignment (${header.error}).`} />
          ) : null}

          {a ? (
            <PageHeader
              eyebrow={scopeLabel(a)}
              title={a.title ?? "Learning Activity"}
              facts={facts}
              meta={
                <>
                  <AssignmentStatusBadge status={a.status} />
                  {a.activityType ? <Badge tone="brand">{ACTIVITY_TYPE_LABEL[a.activityType]}</Badge> : null}
                  {!a.canAct ? <ReadOnlyBadge /> : null}
                </>
              }
            />
          ) : !header.error ? (
            // The header's own shape while it loads: eyebrow, title, and
            // the facts band.
            <div aria-hidden className="space-y-3">
              <span className="block h-4 w-48 animate-pulse rounded-full bg-ink-100" />
              <span className="block h-9 w-96 max-w-full animate-pulse rounded-full bg-ink-100" />
              <span className="block h-11 w-[34rem] max-w-full animate-pulse rounded-2xl bg-ink-100" />
            </div>
          ) : null}
        </div>

        {a ? (
          <>
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
              {/* Where the achievement spark lands. When the teacher's own
                  marking has just taken this count to zero, the tile turns
                  to its "good" tone, says so in words, and the saffron
                  spark plays once in its corner (about a second) and stays
                  as a still mark for this visit. A page that merely loads
                  with nothing to mark gets none of it -- same quiet "0" as
                  before. */}
              <StatTile
                label="To Mark"
                value={a.progress.needsReview}
                tone={a.progress.needsReview > 0 ? "attention" : justFinishedMarking ? "good" : "default"}
                hint={
                  a.progress.needsReview > 0
                    ? "Students with written answers"
                    : justFinishedMarking
                      ? "Every written answer is marked"
                      : undefined
                }
                adornment={justFinishedMarking ? <AchievementSpark /> : undefined}
              />
              <StatTile
                label="Average"
                value={<PercentText percent={a.progress.averagePercent} animated />}
                hint="Latest final scores"
              />
            </div>
            {/* The same moment for someone who can't see the spark. */}
            {justFinishedMarking ? (
              <span className="sr-only" role="status">
                All written answers on this assignment are now marked.
              </span>
            ) : null}
          </>
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
                    // tinted, was ghost: it is the only action in this box.
                    <Button type="button" variant="tinted" size="sm" onClick={() => url.set({ status: null, q: null, page: null })}>
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
                        const marking = Boolean(open?.needsMarks && students.data?.canAct);
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
                                  {/* nowrap, here and on the status cell: on a
                                      phone the table scrolls sideways (minWidth
                                      56rem), but its columns still shrink to
                                      their narrowest wrap first -- the code
                                      broke as "STU-1041 ·" / "5A" and a
                                      two-word status ("IN PROGRESS") wrapped
                                      inside its fixed-height badge. */}
                                  <span className="block whitespace-nowrap font-mono text-[0.75rem] text-content-subtle">
                                    {row.studentCode} · {studentClassLabel(row.className, row.section)}
                                  </span>
                                </span>
                              </span>
                            </TD>
                            <TD className="whitespace-nowrap">
                              <TargetStatusBadge status={row.status} />
                            </TD>
                            <TD className="whitespace-nowrap text-content-muted tabular">
                              {row.attemptsUsed} of {row.attemptsAllowed} used
                              {row.bonusAttempts > 0 ? (
                                <span className="block text-xs text-content-subtle">{plural(row.bonusAttempts, "extra attempt")} granted</span>
                              ) : null}
                            </TD>
                            <TD className="whitespace-nowrap">
                              <ScoreBadge evaluation={row.latestAttempt?.evaluation ?? null} />
                            </TD>
                            <TD align="right">
                              {/* Grant first, Review/Mark last. Most rows have
                                  only the second, so with this order it
                                  forms one straight column down the table's
                                  right edge and the occasional Grant sits
                                  to its left. The other way round, "Review"
                                  jumped ~190px sideways on every row that
                                  also had a Grant. One line, never wrapped:
                                  the table scrolls sideways when it runs out
                                  of room, and two stacked buttons made that
                                  one row half as tall again as the rest. */}
                              <span className="inline-flex items-center justify-end gap-2 whitespace-nowrap">
                                {row.canGrantAttempt ? (
                                  <Button
                                    type="button"
                                    variant="tinted"
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
                                {open ? (
                                  // secondary when it needs this teacher's
                                  // marks (the row's one to-do), tinted
                                  // when it is just a look. Never ghost.
                                  <ButtonLink
                                    href={`/teacher/tracker/attempts/${open.attempt.id}`}
                                    variant={marking ? "secondary" : "tinted"}
                                    size="sm"
                                    leadingIcon={marking ? <PenLine className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                    aria-label={`${marking ? "Mark" : "Review"} ${row.studentName ?? row.studentCode}'s attempt ${open.attempt.attemptNumber}`}
                                  >
                                    {marking ? "Mark Answers" : "Review"}
                                  </ButtonLink>
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
