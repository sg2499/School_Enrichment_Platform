"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  RefreshCcw,
  Send,
  Users,
  XCircle,
} from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardIcon, CardTitle } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { Modal } from "@/components/ui/Modal";
import { SelectField, TextField } from "@/components/ui/Field";
import { RosterIllustration } from "@/components/brand/Graphics";
import { api, apiErrorMessage } from "@/lib/api";
import { ACTIVITY_TYPE_LABEL } from "@/types/learning";
import type { Assignment, AssignmentReason, AssignmentTargetResult, LearningActivity } from "@/types/learning";
import type { SchoolCurriculumMapEntry } from "@/types/curriculum";

const REASON_OPTIONS: { value: AssignmentReason; label: string }[] = [
  { value: "SCHEDULED", label: "Scheduled Practice" },
  { value: "TEACHER_SELECTED", label: "Teacher Selected" },
  { value: "MISSED_PRACTICE", label: "Missed Practice (Catch-Up)" },
  { value: "RE_ATTEMPT", label: "Re-Attempt" },
];

const ASSIGNMENT_STATUS_TONE: Record<Assignment["status"], BadgeTone> = {
  ACTIVE: "success",
  CLOSED: "neutral",
  CANCELLED: "danger",
};

function AlertBanner({ tone, message }: { tone: "error" | "success"; message: string }) {
  const isError = tone === "error";
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-2xl border p-4 animate-scale-in ${
        isError ? "border-coral-200 bg-coral-50" : "border-jade-200 bg-jade-50"
      }`}
    >
      {isError ? (
        <AlertCircle className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-coral-600" aria-hidden />
      ) : (
        <CheckCircle2 className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-jade-600" aria-hidden />
      )}
      <p className={`text-[0.875rem] font-medium leading-[1.55] ${isError ? "text-coral-800" : "text-jade-800"}`}>{message}</p>
    </div>
  );
}

export default function TeacherAssignmentsPage() {
  const { user, status } = useProtectedPage("TEACHER");

  const [mappings, setMappings] = useState<SchoolCurriculumMapEntry[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(true);
  const [mappingsError, setMappingsError] = useState<string | null>(null);

  const [selectedChapterId, setSelectedChapterId] = useState("");
  const [activities, setActivities] = useState<LearningActivity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState("");

  const [className, setClassName] = useState("");
  const [reason, setReason] = useState<AssignmentReason>("SCHEDULED");
  const [dueDate, setDueDate] = useState("");
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState<string | null>(null);

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(true);
  const [assignmentsError, setAssignmentsError] = useState<string | null>(null);

  const [resultsAssignment, setResultsAssignment] = useState<Assignment | null>(null);
  const [resultsRows, setResultsRows] = useState<AssignmentTargetResult[] | null>(null);
  const [resultsError, setResultsError] = useState<string | null>(null);

  const loadMappings = useCallback(async () => {
    setMappingsLoading(true);
    setMappingsError(null);
    try {
      const { data } = await api.get<{ schoolCurriculumMaps: SchoolCurriculumMapEntry[] }>(
        "/curriculum-admin/school-curriculum-maps",
      );
      const published = data.schoolCurriculumMaps.filter((m) => m.chapterStatus === "PUBLISHED");
      setMappings(published);
    } catch (err) {
      setMappingsError(apiErrorMessage(err));
    } finally {
      setMappingsLoading(false);
    }
  }, []);

  const loadAssignments = useCallback(async () => {
    setAssignmentsLoading(true);
    setAssignmentsError(null);
    try {
      const { data } = await api.get<{ assignments: Assignment[] }>("/learning/assignments");
      setAssignments([...data.assignments].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")));
    } catch (err) {
      setAssignmentsError(apiErrorMessage(err));
    } finally {
      setAssignmentsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    loadMappings();
    loadAssignments();
  }, [status, loadMappings, loadAssignments]);

  useEffect(() => {
    if (!selectedChapterId) {
      setActivities([]);
      setSelectedActivityId("");
      return;
    }
    let cancelled = false;
    setActivitiesLoading(true);
    setActivitiesError(null);
    api
      .get<{ activities: LearningActivity[] }>("/learning/activities", { params: { chapterId: selectedChapterId } })
      .then(({ data }) => {
        if (cancelled) return;
        const published = data.activities.filter((a) => a.status === "PUBLISHED").sort((a, b) => a.sequence - b.sequence);
        setActivities(published);
      })
      .catch((err) => {
        if (!cancelled) setActivitiesError(apiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setActivitiesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedChapterId]);

  useEffect(() => {
    const mapping = mappings.find((m) => m.chapterId === selectedChapterId);
    if (mapping?.className) setClassName(mapping.className);
  }, [selectedChapterId, mappings]);

  async function handleAssign(event: React.FormEvent) {
    event.preventDefault();
    setAssignError(null);
    setAssignSuccess(null);
    if (!selectedActivityId) {
      setAssignError("Choose an activity to assign first.");
      return;
    }
    if (!className.trim()) {
      setAssignError("A class is required (e.g. 5A).");
      return;
    }
    setAssigning(true);
    try {
      const { data } = await api.post<Assignment>("/learning/assignments", {
        learningActivityId: selectedActivityId,
        className: className.trim(),
        reason,
        dueDate: dueDate || null,
        maxAttempts,
      });
      setAssignSuccess(`Assigned to ${data.targetCount} student${data.targetCount === 1 ? "" : "s"} in class ${className.trim()}.`);
      loadAssignments();
    } catch (err) {
      setAssignError(apiErrorMessage(err));
    } finally {
      setAssigning(false);
    }
  }

  async function openResults(assignment: Assignment) {
    setResultsAssignment(assignment);
    setResultsRows(null);
    setResultsError(null);
    try {
      const { data } = await api.get<{ targets: AssignmentTargetResult[] }>(`/learning/assignments/${assignment.id}/targets`);
      setResultsRows(data.targets);
    } catch (err) {
      setResultsError(apiErrorMessage(err));
    }
  }

  const selectedChapterLabel = useMemo(() => {
    const mapping = mappings.find((m) => m.chapterId === selectedChapterId);
    return mapping ? `${mapping.chapterTitle ?? mapping.chapterCode ?? "Chapter"}` : null;
  }, [mappings, selectedChapterId]);

  if (status !== "ready") {
    return <LoadingScreen />;
  }

  return (
    <RoleShell role="TEACHER" user={user}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Teaching Workspace"
          title="Assignments"
          description="Set a chapter's practice for a class in a few clicks, then check how they did once they've submitted."
        />

        <Card className="animate-fade-up">
          <CardBody className="space-y-6">
            <div className="flex items-center gap-3">
              <CardIcon tone="brand">
                <Send className="h-5 w-5" aria-hidden />
              </CardIcon>
              <div>
                <CardTitle>Assign Practice</CardTitle>
                <p className="mt-0.5 text-xs text-content-subtle">Pick a published chapter, an activity, and a class</p>
              </div>
            </div>

            {mappingsError ? <AlertBanner tone="error" message={mappingsError} /> : null}

            {!mappingsLoading && !mappingsError && mappings.length === 0 ? (
              <EmptyState
                status={{ label: "No Published Chapters Yet", tone: "brand" }}
                title="Nothing to assign yet"
                description="Once your school admin maps a published chapter into your school's calendar, it will show up here to assign."
              />
            ) : (
              <form onSubmit={handleAssign} className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField
                    label="Chapter"
                    value={selectedChapterId}
                    onChange={(event) => setSelectedChapterId(event.target.value)}
                    disabled={mappingsLoading}
                  >
                    <option value="">{mappingsLoading ? "Loading…" : "Choose a chapter"}</option>
                    {mappings.map((mapping) => (
                      <option key={mapping.id} value={mapping.chapterId}>
                        {mapping.chapterTitle ?? mapping.chapterCode ?? mapping.chapterId}
                        {mapping.className ? ` (Class ${mapping.className})` : ""}
                      </option>
                    ))}
                  </SelectField>

                  <SelectField
                    label="Activity"
                    value={selectedActivityId}
                    onChange={(event) => setSelectedActivityId(event.target.value)}
                    disabled={!selectedChapterId || activitiesLoading}
                  >
                    <option value="">
                      {!selectedChapterId ? "Choose a chapter first" : activitiesLoading ? "Loading…" : "Choose an activity"}
                    </option>
                    {activities.map((activity) => (
                      <option key={activity.id} value={activity.id}>
                        {activity.title} &middot; {ACTIVITY_TYPE_LABEL[activity.activityType]}
                      </option>
                    ))}
                  </SelectField>
                </div>

                {activitiesError ? <AlertBanner tone="error" message={activitiesError} /> : null}
                {selectedChapterId && !activitiesLoading && !activitiesError && activities.length === 0 ? (
                  <p className="text-sm text-content-muted">
                    No published activities yet for {selectedChapterLabel ?? "this chapter"}. Ask your platform admin to publish one.
                  </p>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-3">
                  <TextField
                    label="Class"
                    hint="e.g. 5A"
                    value={className}
                    onChange={(event) => setClassName(event.target.value)}
                    placeholder="5A"
                  />
                  <SelectField label="Reason" value={reason} onChange={(event) => setReason(event.target.value as AssignmentReason)}>
                    {REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </SelectField>
                  <TextField
                    label="Due Date"
                    hint="Optional"
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                  />
                </div>

                <TextField
                  label="Max Attempts"
                  type="number"
                  min={1}
                  max={5}
                  containerClassName="max-w-[10rem]"
                  value={maxAttempts}
                  onChange={(event) => setMaxAttempts(Number(event.target.value) || 1)}
                />

                {assignError ? <AlertBanner tone="error" message={assignError} /> : null}
                {assignSuccess ? <AlertBanner tone="success" message={assignSuccess} /> : null}

                <Button type="submit" variant="primary" loading={assigning} leadingIcon={<Send className="h-4 w-4" />}>
                  Assign to Class
                </Button>
              </form>
            )}
          </CardBody>
        </Card>

        <section className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-display-sm text-content">My Assignments</h2>
              <p className="mt-1 text-sm text-content-muted">Everything you&apos;ve assigned, most recent first.</p>
            </div>
            <Button variant="secondary" size="sm" leadingIcon={<RefreshCcw className="h-4 w-4" />} onClick={loadAssignments} loading={assignmentsLoading}>
              Refresh
            </Button>
          </div>

          {assignmentsError ? <AlertBanner tone="error" message={assignmentsError} /> : null}

          {!assignmentsLoading && !assignmentsError && assignments.length === 0 ? (
            <Card>
              <CardBody className="sm:p-9">
                <EmptyState
                  illustration={<RosterIllustration />}
                  status={{ label: "No Assignments Yet", tone: "brand" }}
                  title="Nothing assigned yet"
                  description="Use the form above to assign your first practice set to a class."
                />
              </CardBody>
            </Card>
          ) : null}

          <div className="space-y-3">
            {assignments.map((assignment) => (
              <Card key={assignment.id}>
                <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={ASSIGNMENT_STATUS_TONE[assignment.status]} dot>
                        {assignment.status}
                      </Badge>
                      {assignment.learningActivityType ? (
                        <Badge tone="neutral">{ACTIVITY_TYPE_LABEL[assignment.learningActivityType]}</Badge>
                      ) : null}
                      <Badge tone="brand">Class {assignment.className ?? "—"}</Badge>
                    </div>
                    <h3 className="font-display text-base font-semibold text-content">
                      {assignment.learningActivityTitle ?? "Learning Activity"}
                    </h3>
                    <p className="text-xs text-content-subtle">
                      {assignment.targetCount} student{assignment.targetCount === 1 ? "" : "s"} &middot; max {assignment.maxAttempts}{" "}
                      attempt{assignment.maxAttempts === 1 ? "" : "s"}
                      {assignment.dueDate ? ` · due ${assignment.dueDate}` : ""}
                    </p>
                  </div>
                  <Button variant="secondary" leadingIcon={<Users className="h-4 w-4" />} onClick={() => openResults(assignment)} className="shrink-0">
                    View Results
                  </Button>
                </CardBody>
              </Card>
            ))}
          </div>
        </section>
      </div>

      <Modal
        open={Boolean(resultsAssignment)}
        onClose={() => setResultsAssignment(null)}
        eyebrow="Assignment Results"
        title={resultsAssignment?.learningActivityTitle ?? "Results"}
        size="lg"
      >
        {resultsError ? <AlertBanner tone="error" message={resultsError} /> : null}
        {!resultsError && !resultsRows ? (
          <div className="flex items-center gap-3 text-sm text-content-muted">
            <ClipboardList className="h-4 w-4 animate-pulse" aria-hidden />
            Loading results…
          </div>
        ) : null}
        {resultsRows && resultsRows.length === 0 ? (
          <p className="text-sm text-content-muted">No students were targeted by this assignment.</p>
        ) : null}
        {resultsRows && resultsRows.length > 0 ? (
          <div className="space-y-2">
            {resultsRows.map((row) => (
              <div key={row.assignmentTargetId} className="flex items-center justify-between gap-3 rounded-2xl border border-line-strong px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-content">{row.studentName ?? row.studentCode}</p>
                  <p className="text-xs text-content-subtle">{row.studentCode}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {row.status === "COMPLETED" && row.latestAttempt?.evaluation ? (
                    <Badge
                      tone={row.latestAttempt.evaluation.finalScore === row.latestAttempt.evaluation.maxScore ? "success" : "accent"}
                      icon={<CheckCircle2 className="h-3 w-3" />}
                    >
                      {row.latestAttempt.evaluation.finalScore}/{row.latestAttempt.evaluation.maxScore}
                    </Badge>
                  ) : row.status === "IN_PROGRESS" ? (
                    <Badge tone="warning">In Progress</Badge>
                  ) : (
                    <Badge tone="neutral" icon={<XCircle className="h-3 w-3" />}>
                      Not Started
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Modal>
    </RoleShell>
  );
}
