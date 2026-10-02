"use client";

/**
 * One student, full screen (1 Oct 2026, Practice Tracker).
 *
 * Everything this teacher can see that was set for the student -- newest
 * assignment first, paged by the server -- with every attempt, its score,
 * and a way into each one to review or mark it. Opened from the Students
 * tab with the tracker's section carried along (`?scope=`), so 5A's tracker
 * shows 5A's history; "Show All Practice" widens it to every section this
 * teacher can see for the student.
 *
 * The student's numbers and history only ever include assignments the
 * teacher may read (practice_access_service): after a handover, an outgoing
 * teacher sees what they set, never what came after.
 *
 * UI revamp, Phase A (2 Oct 2026): same standard as the assignment page --
 * InlineLink back link grouped with the header, the student code as a
 * header fact rather than a lone line of monospace, `tinted` for each
 * standalone row/card action (Review, Grant Extra Attempt) with `secondary`
 * kept for Mark Answers, and the section-scope note as a proper banner.
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Eye, IdCard, PenLine, RotateCcw } from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { pageFromParam, useUrlState } from "@/lib/hooks/useUrlState";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader, type PageHeaderFact } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { InlineLink } from "@/components/ui/InlineLink";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { Pagination } from "@/components/ui/Pagination";
import {
  AssignmentStatusBadge,
  PercentText,
  ReadOnlyBadge,
  ScoreBadge,
  StatTile,
  TargetStatusBadge,
  TeacherAmbience,
  scopeParams,
} from "@/components/tracker/TrackerBits";
import { formatDateTime, formatDay, plural, scopeLabel, scopeShort, studentClassLabel } from "@/lib/tracker";
import { ACTIVITY_TYPE_LABEL } from "@/types/learning";
import type { StudentHistoryItem, StudentHistoryPage, TrackerOverview } from "@/types/tracker";

const STAGGER = ["", "delay-70", "delay-140", "delay-210"];

function HistoryCard({
  item,
  index,
  granting,
  grantDisabled,
  onGrant,
}: {
  item: StudentHistoryItem;
  index: number;
  granting: boolean;
  grantDisabled: boolean;
  onGrant: () => void;
}) {
  const a = item.assignment;
  return (
    <Card as="li" className={`animate-fade-up ${STAGGER[Math.min(index, STAGGER.length - 1)]}`}>
      <CardBody className="space-y-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <Link
              href={`/teacher/tracker/assignments/${a.id}`}
              className="block truncate font-display text-base font-semibold text-content hover:text-content-brand"
            >
              {a.title ?? "Learning Activity"}
            </Link>
            <p className="text-xs text-content-subtle">
              {[
                scopeShort(a),
                a.activityType ? ACTIVITY_TYPE_LABEL[a.activityType] : null,
                a.createdAt ? `Set ${formatDay(a.createdAt)}` : null,
                a.dueDate ? `Due ${formatDay(a.dueDate)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <span className="flex shrink-0 flex-wrap items-center gap-1.5">
            <TargetStatusBadge status={item.status} />
            {a.status !== "ACTIVE" ? <AssignmentStatusBadge status={a.status} /> : null}
            {!a.canAct ? <ReadOnlyBadge /> : null}
          </span>
        </div>

        {item.attempts.length === 0 ? (
          <p className="rounded-2xl bg-surface-muted px-4 py-3 text-sm text-content-muted">Not started yet.</p>
        ) : (
          <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {item.attempts.map((attempt) => {
              const needsMarks = attempt.evaluation?.reviewStatus === "PENDING_REVIEW";
              const markable = needsMarks && a.canAct;
              return (
                <li key={attempt.id} className="flex flex-wrap items-center justify-between gap-3 bg-surface px-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-content">Attempt {attempt.attemptNumber}</span>
                    <span className="block text-xs text-content-subtle">
                      {attempt.status === "IN_PROGRESS"
                        ? `Started ${formatDateTime(attempt.startedAt) ?? ""} · Not submitted yet`
                        : `Submitted ${formatDateTime(attempt.submittedAt) ?? "—"}`}
                    </span>
                  </span>
                  {/* flex-wrap: on a phone the row is ~278px wide, and a
                      "Needs Marking" badge beside "Mark Answers" needs
                      ~283. Without it the badge's two words wrapped inside
                      its fixed height and the button truncated to
                      "Mark Ans…"; now the button drops to its own line. */}
                  <span className="flex flex-wrap items-center gap-2">
                    <ScoreBadge evaluation={attempt.evaluation} />
                    {attempt.evaluation ? (
                      // secondary when it needs this teacher's marks,
                      // tinted when it is just a look; never ghost -- it
                      // is the row's only action (Button.tsx has the rule).
                      <ButtonLink
                        href={`/teacher/tracker/attempts/${attempt.id}`}
                        variant={markable ? "secondary" : "tinted"}
                        size="sm"
                        leadingIcon={markable ? <PenLine className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        aria-label={`${markable ? "Mark" : "Review"} attempt ${attempt.attemptNumber} of ${a.title ?? "this practice"}`}
                      >
                        {markable ? "Mark Answers" : "Review"}
                      </ButtonLink>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-content-subtle tabular">
            {item.attemptsUsed} of {item.attemptsAllowed} attempts used
            {item.bonusAttempts > 0 ? ` · ${plural(item.bonusAttempts, "extra attempt")} granted` : ""}
          </p>
          {item.canGrantAttempt ? (
            <Button
              type="button"
              variant="tinted"
              size="sm"
              leadingIcon={<RotateCcw className="h-3.5 w-3.5" />}
              loading={granting}
              loadingLabel="Granting"
              disabled={grantDisabled}
              onClick={onGrant}
            >
              Grant Extra Attempt
            </Button>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

function StudentWorkspace() {
  const { studentId } = useParams<{ studentId: string }>();
  const { user, status } = useProtectedPage("TEACHER");
  const ready = status === "ready";
  const url = useUrlState();
  const scope = url.get("scope") ?? "";
  const page = pageFromParam(url.get("page"));

  const history = useApiQuery<StudentHistoryPage>(
    `/learning/tracker/students/${studentId}`,
    { ...scopeParams(scope), page, pageSize: 10 },
    ready,
  );
  // Only for naming the section in the "Showing ... only" note.
  const overview = useApiQuery<TrackerOverview>("/learning/tracker/overview", {}, ready && Boolean(scope));
  const scopeSection = overview.data?.sections.find((s) => s.key === scope) ?? null;

  const [grantingId, setGrantingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; message: string } | null>(null);

  async function grant(item: StudentHistoryItem) {
    setGrantingId(item.assignmentTargetId);
    setNotice(null);
    try {
      await api.post(`/learning/assignments/${item.assignment.id}/targets/${item.assignmentTargetId}/grant-attempt`);
      setNotice({ tone: "success", message: `One more attempt granted on ${item.assignment.title ?? "this practice"}.` });
      history.reload();
    } catch (err) {
      setNotice({ tone: "error", message: apiErrorMessage(err) });
    } finally {
      setGrantingId(null);
    }
  }

  if (!ready) return <LoadingScreen />;

  const data = history.data;
  const student = data?.student;

  // The student code used to be the header's whole description: one line of
  // monospace with nothing around it. It is the same fact, labelled.
  const facts: PageHeaderFact[] = student
    ? [
        {
          label: "Student Code",
          value: <span className="font-mono">{student.studentCode}</span>,
          icon: <IdCard className="h-3.5 w-3.5" />,
        },
      ]
    : [];

  return (
    <RoleShell role="TEACHER" user={user}>
      <TeacherAmbience />
      {/* space-y-8: the working-page rhythm (Assign, People, Security, Daily
          Practice); dashboards use space-y-10. This family alone was 7.
          `relative` so the page paints above the ambience. */}
      <div className="relative space-y-8">
        {/* Back link and header as one block -- see the assignment page. */}
        <div className="space-y-5">
          <InlineLink href={`/teacher/tracker?tab=students${scope ? `&scope=${encodeURIComponent(scope)}` : ""}`} direction="back">
            Students
          </InlineLink>

          {history.error ? <AlertBanner tone="error" message={`Couldn't open this student (${history.error}).`} /> : null}

          {student ? (
            <PageHeader
              eyebrow={`Class ${studentClassLabel(student.className, student.section)}`}
              title={student.studentName ?? student.studentCode}
              facts={facts}
              // Was " · Inactive" appended to the code in plain text. A
              // state belongs in a badge, like every other state here.
              meta={!student.isActive ? <Badge tone="neutral">Inactive</Badge> : undefined}
            />
          ) : !history.error ? (
            <div aria-hidden className="space-y-3">
              <span className="block h-4 w-32 animate-pulse rounded-full bg-ink-100" />
              <span className="block h-9 w-72 max-w-full animate-pulse rounded-full bg-ink-100" />
              <span className="block h-11 w-56 max-w-full animate-pulse rounded-2xl bg-ink-100" />
            </div>
          ) : null}
        </div>

        {student ? (
          <>
            {scope ? (
              // The scope note was a loose paragraph: a badge, a sentence
              // and an underlined text link in a row on the bare canvas. It
              // is a status with one action, which is what AlertBanner is
              // for. The action is `secondary` rather than `tinted` because
              // tinted's fill is surface-brand -- the info banner's own
              // colour -- and would vanish on it; a white button on a
              // tinted banner is the same pairing Assign Practice's success
              // banner uses.
              //
              // The button rides inside `message` rather than in
              // AlertBanner's fixed `action` column, so on a phone it drops
              // under the sentence instead of squeezing it (Assign Practice
              // does the same, and says why at more length).
              <AlertBanner
                tone="info"
                className="sm:items-center"
                message={
                  <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
                    <span>
                      Showing practice for{" "}
                      <span className="font-semibold">
                        {scopeSection ? scopeLabel({ ...scopeSection, className: null }) : "one section"}
                      </span>{" "}
                      only.
                    </span>
                    <ButtonLink href={`/teacher/tracker/students/${studentId}`} variant="secondary" size="sm">
                      Show All Practice
                    </ButtonLink>
                  </span>
                }
              />
            ) : null}

            <div className="grid grid-cols-2 gap-3 animate-fade-up lg:grid-cols-4">
              <StatTile label="Assigned" value={student.stats.assigned} />
              <StatTile
                label="Completed"
                value={student.stats.completed}
                hint={student.stats.assigned > 0 ? `of ${student.stats.assigned}` : undefined}
              />
              <StatTile
                label="Average"
                value={<PercentText percent={student.stats.averagePercent} animated />}
                hint="Latest final scores"
              />
              <StatTile
                label="To Mark"
                value={student.stats.needsReview}
                tone={student.stats.needsReview > 0 ? "attention" : "default"}
                hint={student.stats.lastSubmittedAt ? `Last submitted ${formatDateTime(student.stats.lastSubmittedAt)}` : "Nothing submitted yet"}
              />
            </div>
          </>
        ) : null}

        {notice ? <AlertBanner tone={notice.tone} message={notice.message} /> : null}

        {data ? (
          data.total === 0 ? (
            <Card>
              <CardBody className="sm:p-9">
                <EmptyState
                  status={{ label: "No Practice Yet", tone: "neutral" }}
                  title="Nothing set for this student yet"
                  description="Practice you assign to their section will appear here, with every attempt and score."
                />
              </CardBody>
            </Card>
          ) : (
            <section aria-labelledby="history-heading" className="space-y-4">
              <h2 id="history-heading" className="font-display text-display-sm text-content">
                Practice History
              </h2>
              <ol className={`space-y-4 transition-opacity ${history.loading ? "opacity-60" : ""}`}>
                {data.items.map((item, index) => (
                  <HistoryCard
                    key={item.assignmentTargetId}
                    item={item}
                    index={index}
                    granting={grantingId === item.assignmentTargetId}
                    grantDisabled={Boolean(grantingId) && grantingId !== item.assignmentTargetId}
                    onGrant={() => grant(item)}
                  />
                ))}
              </ol>
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                totalPages={data.totalPages}
                onPageChange={(next) => url.set({ page: next })}
                noun="assignment"
                label="Practice history pages"
                busy={history.loading}
              />
            </section>
          )
        ) : null}
      </div>
    </RoleShell>
  );
}

export default function TrackerStudentPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <StudentWorkspace />
    </Suspense>
  );
}
