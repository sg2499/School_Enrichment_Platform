"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, CalendarClock, CheckCircle2, ClipboardList, PlayCircle, RefreshCcw, Sparkles } from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { PathIllustration } from "@/components/brand/Graphics";
import { api, apiErrorMessage } from "@/lib/api";
import { ACTIVITY_TYPE_LABEL } from "@/types/learning";
import type { StudentAssignmentSummary } from "@/types/learning";

const STATUS_TONE: Record<StudentAssignmentSummary["status"], BadgeTone> = {
  PENDING: "brand",
  IN_PROGRESS: "warning",
  COMPLETED: "success",
  SKIPPED: "neutral",
};

const STATUS_LABEL: Record<StudentAssignmentSummary["status"], string> = {
  PENDING: "Not Started",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  SKIPPED: "Skipped",
};

// Today's Practice sorts the not-yet-done work to the top -- a student
// opening this page should see what's waiting on them before what's
// already behind them.
const STATUS_ORDER: Record<StudentAssignmentSummary["status"], number> = {
  IN_PROGRESS: 0,
  PENDING: 1,
  COMPLETED: 2,
  SKIPPED: 3,
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function actionForAssignment(item: StudentAssignmentSummary): { label: string; tone: "primary" | "secondary"; href: string } {
  const base = `/student/practice/${item.assignmentTargetId}`;
  if (item.status === "COMPLETED" && item.latestAttempt) {
    // Route straight to the result view for the existing attempt -- the
    // detail page must NOT call POST /attempts here, or "View Result"
    // would silently burn a re-attempt every time a student re-opens it.
    return { label: "View Result", tone: "secondary", href: `${base}?attemptId=${item.latestAttempt.id}&view=result` };
  }
  if (item.status === "IN_PROGRESS") return { label: "Continue", tone: "primary", href: base };
  return { label: "Start", tone: "primary", href: base };
}

export default function StudentPracticePage() {
  const { user, status } = useProtectedPage("STUDENT");
  const [assignments, setAssignments] = useState<StudentAssignmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<{ assignments: StudentAssignmentSummary[] }>("/learning/assignments");
      const sorted = [...data.assignments].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
      setAssignments(sorted);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    load();
  }, [status, load]);

  if (status !== "ready") {
    return <LoadingScreen />;
  }

  const firstName = user?.fullName?.trim().split(/\s+/)[0] ?? "there";

  return (
    <RoleShell role="STUDENT" user={user}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Daily Practice"
          title={
            <>
              Today&apos;s Practice, <span className="text-gradient-brand">{firstName}</span>
            </>
          }
          description="A short set of questions built from the chapter you're on right now. Finish what's pending, then come back tomorrow for the next one."
          meta={
            assignments && assignments.length > 0 ? (
              <Badge tone="brand" dot pulse>
                {assignments.filter((a) => a.status !== "COMPLETED").length} Pending
              </Badge>
            ) : null
          }
          actions={
            <Button variant="secondary" size="sm" leadingIcon={<RefreshCcw className="h-4 w-4" />} onClick={load} loading={loading}>
              Refresh
            </Button>
          }
        />

        {error ? (
          <div role="alert" className="flex items-start gap-3 rounded-2xl border border-coral-200 bg-coral-50 p-4 animate-scale-in">
            <AlertCircle className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-coral-600" aria-hidden />
            <p className="text-[0.875rem] font-medium leading-[1.55] text-coral-800">{error}</p>
          </div>
        ) : null}

        {!error && assignments && assignments.length === 0 ? (
          <Card className="animate-fade-up">
            <CardBody className="sm:p-9">
              <EmptyState
                illustration={<PathIllustration />}
                status={{ label: "Nothing Assigned Yet", tone: "brand" }}
                title="Nothing to practise today"
                description="When your teacher assigns your first practice set, it will show up here — usually ten to fifteen minutes' work."
                points={["Your streak starts counting from your first practice", "Anything you get wrong comes back later, not never"]}
              />
            </CardBody>
          </Card>
        ) : null}

        {assignments && assignments.length > 0 ? (
          <div className="space-y-3">
            {assignments.map((item, index) => {
              const action = actionForAssignment(item);
              const dueDate = formatDate(item.dueDate);
              const score = item.latestAttempt?.evaluation;
              return (
                <Card key={item.assignmentTargetId} className={`animate-fade-up ${["delay-70", "delay-140", "delay-210"][index % 3] ?? ""}`}>
                  <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={STATUS_TONE[item.status]} dot>
                          {STATUS_LABEL[item.status]}
                        </Badge>
                        <Badge tone="neutral">{ACTIVITY_TYPE_LABEL[item.learningActivity.activityType]}</Badge>
                        {score && item.status === "COMPLETED" ? (
                          <Badge tone={score.finalScore === score.maxScore ? "success" : "accent"} icon={<CheckCircle2 className="h-3 w-3" />}>
                            {score.finalScore}/{score.maxScore}
                          </Badge>
                        ) : null}
                      </div>
                      <h3 className="font-display text-base font-semibold text-content">{item.learningActivity.title}</h3>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-content-subtle">
                        {item.learningActivity.estimatedMinutes ? <span>{item.learningActivity.estimatedMinutes} min</span> : null}
                        {dueDate ? (
                          <span className="flex items-center gap-1">
                            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                            Due {dueDate}
                          </span>
                        ) : null}
                        <span>
                          Attempt {Math.min((item.latestAttempt?.attemptNumber ?? 0) + (item.status === "COMPLETED" ? 0 : 1), item.maxAttempts)} of{" "}
                          {item.maxAttempts}
                        </span>
                      </div>
                    </div>
                    <Link href={action.href} className="shrink-0">
                      <Button variant={action.tone} leadingIcon={<PlayCircle className="h-4 w-4" />}>
                        {action.label}
                      </Button>
                    </Link>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        ) : null}

        {loading && !assignments ? (
          <Card className="animate-fade-up">
            <CardBody className="flex items-center gap-3 text-sm text-content-muted">
              <ClipboardList className="h-4 w-4 animate-pulse" aria-hidden />
              Loading your practice list…
            </CardBody>
          </Card>
        ) : null}

        <Card tone="brand" className="animate-fade-up">
          <CardBody className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            <p className="text-[0.8125rem] leading-relaxed text-content-muted">
              Answers save automatically as you go, so it&apos;s safe to close this and come back later — nothing is lost until you submit.
            </p>
          </CardBody>
        </Card>
      </div>
    </RoleShell>
  );
}
