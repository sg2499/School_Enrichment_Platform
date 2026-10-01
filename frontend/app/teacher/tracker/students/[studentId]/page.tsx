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
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Eye, PenLine, RotateCcw } from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { pageFromParam, useUrlState } from "@/lib/hooks/useUrlState";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { Pagination } from "@/components/ui/Pagination";
import {
  AssignmentStatusBadge,
  BackLink,
  PercentText,
  ReadOnlyBadge,
  ScoreBadge,
  StatTile,
  TargetStatusBadge,
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
                  <span className="flex items-center gap-2">
                    <ScoreBadge evaluation={attempt.evaluation} />
                    {attempt.evaluation ? (
                      <ButtonLink
                        href={`/teacher/tracker/attempts/${attempt.id}`}
                        variant={markable ? "secondary" : "ghost"}
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
              variant="ghost"
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

  return (
    <RoleShell role="TEACHER" user={user}>
      <div className="space-y-7">
        <BackLink href={`/teacher/tracker?tab=students${scope ? `&scope=${encodeURIComponent(scope)}` : ""}`}>
          Students
        </BackLink>

        {history.error ? <AlertBanner tone="error" message={`Couldn't open this student (${history.error}).`} /> : null}

        {student ? (
          <>
            <PageHeader
              eyebrow={`Class ${studentClassLabel(student.className, student.section)}`}
              title={student.studentName ?? student.studentCode}
              description={
                <span className="font-mono text-[0.875rem]">
                  {student.studentCode}
                  {!student.isActive ? " · Inactive" : ""}
                </span>
              }
            />

            {scope ? (
              <p className="flex flex-wrap items-center gap-2 text-sm text-content-muted">
                <Badge tone="brand">{scopeSection ? scopeLabel({ ...scopeSection, className: null }) : "One Section"}</Badge>
                Showing practice for this section only.
                <Link
                  href={`/teacher/tracker/students/${studentId}`}
                  className="font-semibold text-content-brand underline-offset-4 hover:underline"
                >
                  Show All Practice
                </Link>
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-3 animate-fade-up lg:grid-cols-4">
              <StatTile label="Assigned" value={student.stats.assigned} />
              <StatTile
                label="Completed"
                value={student.stats.completed}
                hint={student.stats.assigned > 0 ? `of ${student.stats.assigned}` : undefined}
              />
              <StatTile label="Average" value={<PercentText percent={student.stats.averagePercent} />} hint="Latest final scores" />
              <StatTile
                label="To Mark"
                value={student.stats.needsReview}
                tone={student.stats.needsReview > 0 ? "attention" : "default"}
                hint={student.stats.lastSubmittedAt ? `Last submitted ${formatDateTime(student.stats.lastSubmittedAt)}` : "Nothing submitted yet"}
              />
            </div>
          </>
        ) : !history.error ? (
          <div aria-hidden className="space-y-3">
            <span className="block h-4 w-32 animate-pulse rounded-full bg-ink-100" />
            <span className="block h-9 w-72 max-w-full animate-pulse rounded-full bg-ink-100" />
          </div>
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
