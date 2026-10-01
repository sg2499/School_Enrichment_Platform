"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  RefreshCcw,
  RotateCcw,
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
import type {
  Assignment,
  AssignmentReason,
  AssignmentTargetResult,
  AttemptResult,
  GrantExtraAttemptResult,
  LearningActivity,
} from "@/types/learning";
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

/**
 * One of the signed-in teacher's own current sections, from
 * GET /teacher-assignments/my-sections -- mirrors the subset of
 * routes_teacher_assignments.py's _assignment_dict this page reads.
 * Declared here rather than in types/ to keep this change inside the two
 * teacher pages; the dashboard declares the same shape.
 *
 * classLevelCode is ClassLevel.code ("5".."10"), the same format
 * routes_roster.py stores in Student.class_name, and section is stored
 * verbatim in both places -- so the pair is exactly what
 * POST /learning/assignments needs to reach one section's students.
 * boardCourseName is the course's display name (e.g. "Mathematics"), not
 * the board; the endpoint does not return the board code.
 */
type TeacherSection = {
  id: string;
  classLevelCode: string | null;
  section: string;
  boardCourseId: string;
  boardCourseName: string | null;
};

function sectionLabel(section: TeacherSection): string {
  return [`Class ${section.classLevelCode ?? "?"}`, `Section ${section.section}`, section.boardCourseName]
    .filter(Boolean)
    .join(" · ");
}

/** Class numerically ("10" after "9", not after "1"), then section, then
 *  course -- the order a timetable lists them in. */
function compareSections(a: TeacherSection, b: TeacherSection): number {
  const byClass = (Number(a.classLevelCode) || 0) - (Number(b.classLevelCode) || 0);
  if (byClass !== 0) return byClass;
  return a.section.localeCompare(b.section) || (a.boardCourseName ?? "").localeCompare(b.boardCourseName ?? "");
}

/**
 * The teacher's sections this chapter's mapping plausibly belongs to: same
 * class AND same board course. A mapping (SchoolCurriculumMap) is one
 * schedule per class and course, shared by every section of that class
 * (curriculum.py: section was removed from it on 19 Aug 2026), so the
 * mapping alone never says which section is meant -- only the teacher's
 * own roster can narrow it down.
 */
function sectionsForChapter(mapping: SchoolCurriculumMapEntry | undefined, sections: TeacherSection[]): TeacherSection[] {
  if (!mapping?.className) return [];
  return sections.filter((s) => s.classLevelCode === mapping.className && s.boardCourseId === mapping.boardCourseId);
}

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

// One student's row inside the results modal -- expands to the full attempt
// history, lets the teacher drill into any evaluated attempt's per-question
// answers, and (once every allowed attempt is used up) offers to approve
// one more (20 Aug 2026, the teacher review/reattempt-approval surface).
function TargetRow({
  target,
  expanded,
  onToggle,
  viewingAttemptId,
  onViewAttempt,
  attemptDetail,
  attemptDetailLoading,
  attemptDetailError,
  onGrant,
  granting,
}: {
  target: AssignmentTargetResult;
  expanded: boolean;
  onToggle: () => void;
  viewingAttemptId: string | null;
  onViewAttempt: (attemptId: string) => void;
  attemptDetail: AttemptResult | null;
  attemptDetailLoading: boolean;
  attemptDetailError: string | null;
  onGrant: () => void;
  granting: boolean;
}) {
  const attemptsAllowed = target.maxAttempts + target.bonusAttempts;
  const hasOpenAttempt = target.attempts.some((a) => a.status === "IN_PROGRESS");
  const exhausted = target.attemptsUsed >= attemptsAllowed && !hasOpenAttempt;

  return (
    <div className="rounded-2xl border border-line-strong">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-content">{target.studentName ?? target.studentCode}</p>
          <p className="text-xs text-content-subtle">
            {target.studentCode} &middot; {target.attemptsUsed}/{attemptsAllowed} attempt{attemptsAllowed === 1 ? "" : "s"} used
            {target.bonusAttempts > 0 ? ` (${target.bonusAttempts} granted)` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {target.status === "COMPLETED" && target.latestAttempt?.evaluation ? (
            <Badge
              tone={target.latestAttempt.evaluation.finalScore === target.latestAttempt.evaluation.maxScore ? "success" : "accent"}
              icon={<CheckCircle2 className="h-3 w-3" />}
            >
              {target.latestAttempt.evaluation.finalScore}/{target.latestAttempt.evaluation.maxScore}
            </Badge>
          ) : target.status === "IN_PROGRESS" ? (
            <Badge tone="warning">In Progress</Badge>
          ) : (
            <Badge tone="neutral" icon={<XCircle className="h-3 w-3" />}>
              Not Started
            </Badge>
          )}
          <ChevronDown className={`h-4 w-4 text-content-subtle transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
        </div>
      </button>

      {expanded ? (
        <div className="space-y-3 border-t border-line-strong px-4 py-3">
          {target.attempts.length === 0 ? (
            <p className="text-sm text-content-muted">Not started yet.</p>
          ) : (
            <div className="space-y-2">
              {target.attempts.map((attempt) => (
                <div key={attempt.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-content-muted">
                    Attempt {attempt.attemptNumber} &middot; {attempt.status}
                    {attempt.evaluation ? ` · ${attempt.evaluation.finalScore}/${attempt.evaluation.maxScore}` : ""}
                  </span>
                  {attempt.evaluation ? (
                    <Button variant="ghost" size="sm" onClick={() => onViewAttempt(attempt.id)}>
                      {viewingAttemptId === attempt.id ? "Hide Answers" : "View Answers"}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {viewingAttemptId ? (
            <div className="space-y-2 rounded-2xl bg-surface-brand p-3">
              {attemptDetailLoading ? <p className="text-sm text-content-muted">Loading answers…</p> : null}
              {attemptDetailError ? <AlertBanner tone="error" message={attemptDetailError} /> : null}
              {attemptDetail
                ? attemptDetail.answers.map((answer, index) => (
                    <div key={answer.questionId} className="space-y-1 rounded-xl bg-surface p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase tracking-eyebrow text-content-subtle">Question {index + 1}</span>
                        {answer.isCorrect === true ? (
                          <Badge tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>
                            Correct
                          </Badge>
                        ) : answer.isCorrect === false ? (
                          <Badge tone="danger" icon={<XCircle className="h-3 w-3" />}>
                            Incorrect
                          </Badge>
                        ) : (
                          <Badge tone="neutral">Pending Review</Badge>
                        )}
                      </div>
                      <p className="font-medium text-content">{answer.stem}</p>
                      <p className="text-content-muted">
                        <span className="font-semibold text-content-subtle">Answer: </span>
                        {answer.responseText || <span className="italic text-content-faint">Not answered</span>}
                      </p>
                      {answer.isCorrect === false ? (
                        <p className="text-content-muted">
                          <span className="font-semibold text-content-subtle">Correct answer: </span>
                          {answer.correctAnswer}
                        </p>
                      ) : null}
                    </div>
                  ))
                : null}
            </div>
          ) : null}

          {exhausted ? (
            <Button variant="secondary" size="sm" leadingIcon={<RotateCcw className="h-4 w-4" />} onClick={onGrant} loading={granting}>
              Grant Extra Attempt
            </Button>
          ) : null}
        </div>
      ) : null}
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

  // Replaces a free-text "Class" box (30 Sep 2026). Its own hint said "e.g.
  // 5A", but students store class and section separately (class_name "5",
  // section "A"), so "5A" matched nobody and "5" reached every section of
  // Class 5 -- a teacher could not target one section at all. The picker
  // only offers sections an admin has actually assigned to this teacher.
  const [sections, setSections] = useState<TeacherSection[]>([]);
  const [sectionsLoading, setSectionsLoading] = useState(true);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  // True only while the current pick is one this page made for the teacher
  // (see handleChapterChange), so a later chapter change can withdraw its
  // own guess without ever discarding a section the teacher chose.
  const [sectionAutoFilled, setSectionAutoFilled] = useState(false);

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

  // Per-student review/reattempt-approval state (20 Aug 2026) -- lives at
  // the modal level rather than inside TargetRow so switching which
  // student's row is expanded doesn't need to hoist state back up anyway.
  const [expandedTargetId, setExpandedTargetId] = useState<string | null>(null);
  const [viewingAttemptId, setViewingAttemptId] = useState<string | null>(null);
  const [attemptDetail, setAttemptDetail] = useState<AttemptResult | null>(null);
  const [attemptDetailLoading, setAttemptDetailLoading] = useState(false);
  const [attemptDetailError, setAttemptDetailError] = useState<string | null>(null);
  const [grantingTargetId, setGrantingTargetId] = useState<string | null>(null);
  const [grantError, setGrantError] = useState<string | null>(null);

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

  const loadSections = useCallback(async () => {
    setSectionsLoading(true);
    setSectionsError(null);
    try {
      const { data } = await api.get<{ sections: TeacherSection[] }>("/teacher-assignments/my-sections");
      setSections([...data.sections].sort(compareSections));
    } catch (err) {
      setSectionsError(apiErrorMessage(err));
    } finally {
      setSectionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    loadMappings();
    loadSections();
    loadAssignments();
  }, [status, loadMappings, loadSections, loadAssignments]);

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

  /**
   * Chapter first, then (maybe) the section.
   *
   * This used to copy the chapter mapping's class straight into the Class
   * box. A mapping names a class, never a section, and a teacher routinely
   * teaches several sections of one class ("Maths to 4 sections in the 5th
   * standard" -- teacher_assignment.py's own docstring), so copying it
   * across would be a guess. Now the section is filled in only when the
   * guess can't be wrong: exactly one of this teacher's sections has the
   * chapter's class and course. Two or more, none, or a chapter mapped for
   * no particular class, and the teacher picks.
   *
   * Done here, in the change handler, rather than in an effect watching the
   * chapter: an effect would also re-run when the section list or mappings
   * reload, and could then overwrite a section the teacher had already
   * chosen by hand. The chapter select stays disabled until the sections
   * have loaded, so the list is always ready when this runs.
   */
  function handleChapterChange(chapterId: string) {
    setSelectedChapterId(chapterId);
    const candidates = sectionsForChapter(
      mappings.find((m) => m.chapterId === chapterId),
      sections,
    );
    if (candidates.length === 1) {
      setSelectedSectionId(candidates[0].id);
      setSectionAutoFilled(true);
    } else if (sectionAutoFilled) {
      // Withdraw our own earlier guess -- it was made for a different
      // chapter. A section the teacher picked themselves is left alone.
      setSelectedSectionId("");
      setSectionAutoFilled(false);
    }
  }

  async function handleAssign(event: React.FormEvent) {
    event.preventDefault();
    setAssignError(null);
    setAssignSuccess(null);
    if (!selectedActivityId) {
      setAssignError("Choose an activity to assign first.");
      return;
    }
    const target = sections.find((s) => s.id === selectedSectionId);
    if (!target || !target.classLevelCode) {
      setAssignError("Choose which of your sections to assign this to.");
      return;
    }
    setAssigning(true);
    try {
      const { data } = await api.post<Assignment>("/learning/assignments", {
        learningActivityId: selectedActivityId,
        // classLevelCode matches Student.class_name's format and section
        // matches Student.section, so this reaches exactly one section
        // (learning_service.create_assignment's section filter).
        className: target.classLevelCode,
        section: target.section,
        reason,
        dueDate: dueDate || null,
        maxAttempts,
      });
      setAssignSuccess(
        `Assigned to ${data.targetCount} student${data.targetCount === 1 ? "" : "s"} in Class ${target.classLevelCode} · Section ${target.section}.`,
      );
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
    setExpandedTargetId(null);
    setViewingAttemptId(null);
    setAttemptDetail(null);
    setAttemptDetailError(null);
    setGrantError(null);
    try {
      const { data } = await api.get<{ targets: AssignmentTargetResult[] }>(`/learning/assignments/${assignment.id}/targets`);
      setResultsRows(data.targets);
    } catch (err) {
      setResultsError(apiErrorMessage(err));
    }
  }

  function toggleExpanded(targetId: string) {
    setExpandedTargetId((prev) => (prev === targetId ? null : targetId));
    setViewingAttemptId(null);
    setAttemptDetail(null);
    setAttemptDetailError(null);
  }

  async function viewAttempt(attemptId: string) {
    if (viewingAttemptId === attemptId) {
      setViewingAttemptId(null);
      setAttemptDetail(null);
      return;
    }
    setViewingAttemptId(attemptId);
    setAttemptDetail(null);
    setAttemptDetailError(null);
    setAttemptDetailLoading(true);
    try {
      const { data } = await api.get<AttemptResult>(`/learning/attempts/${attemptId}/result`);
      setAttemptDetail(data);
    } catch (err) {
      setAttemptDetailError(apiErrorMessage(err));
    } finally {
      setAttemptDetailLoading(false);
    }
  }

  async function grantExtraAttempt(target: AssignmentTargetResult) {
    if (!resultsAssignment) return;
    setGrantingTargetId(target.assignmentTargetId);
    setGrantError(null);
    try {
      await api.post<GrantExtraAttemptResult>(
        `/learning/assignments/${resultsAssignment.id}/targets/${target.assignmentTargetId}/grant-attempt`,
      );
      // Refresh the whole row set so the counters/status this row (and the
      // student's own "Today's Practice" list, next time they load it)
      // read from stay in sync with the grant that just landed.
      const { data } = await api.get<{ targets: AssignmentTargetResult[] }>(`/learning/assignments/${resultsAssignment.id}/targets`);
      setResultsRows(data.targets);
    } catch (err) {
      setGrantError(apiErrorMessage(err));
    } finally {
      setGrantingTargetId(null);
    }
  }

  const selectedChapterLabel = useMemo(() => {
    const mapping = mappings.find((m) => m.chapterId === selectedChapterId);
    return mapping ? `${mapping.chapterTitle ?? mapping.chapterCode ?? "Chapter"}` : null;
  }, [mappings, selectedChapterId]);

  const selectedMapping = mappings.find((m) => m.chapterId === selectedChapterId);
  const chapterSections = sectionsForChapter(selectedMapping, sections);
  const selectedSection = sections.find((s) => s.id === selectedSectionId) ?? null;
  // Assigning across classes is allowed (a teacher may deliberately set an
  // earlier class's chapter as revision), so this is a note, not a block --
  // but it should never happen silently.
  const classMismatch = Boolean(
    selectedMapping?.className && selectedSection && selectedSection.classLevelCode !== selectedMapping.className,
  );

  // The short hint on the Section label: says *why* a section is already
  // chosen, or why one isn't, so the teacher never wonders whether the page
  // guessed.
  const sectionHint = sectionAutoFilled
    ? "Matched to this chapter"
    : selectedMapping?.className && chapterSections.length > 1 && !selectedSectionId
      ? `You teach ${chapterSections.length} sections of Class ${selectedMapping.className}`
      : undefined;
  const sectionsBlocked = !sectionsLoading && !sectionsError && sections.length === 0;
  const formLoading = mappingsLoading || sectionsLoading;

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
                <p className="mt-0.5 text-xs text-content-subtle">Pick a published chapter, an activity, and one of your sections</p>
              </div>
            </div>

            {mappingsError ? <AlertBanner tone="error" message={mappingsError} /> : null}
            {sectionsError ? (
              <AlertBanner tone="error" message={`Couldn't load your sections (${sectionsError}). Refresh the page to try again.`} />
            ) : null}

            {sectionsBlocked ? (
              // Blocked, not broken: with no section to aim at, the form
              // could only ever fail on submit. A teacher can't fix this
              // themselves -- sections are assigned by an admin
              // (routes_teacher_assignments.py: writes are ADMIN/SUPER_ADMIN
              // only) -- so the copy says who to ask.
              <EmptyState
                illustration={<RosterIllustration />}
                status={{ label: "No Sections Assigned", tone: "neutral" }}
                title="You don't have any sections yet"
                description="Practice is assigned to a section you teach, and none are assigned to you yet. Ask your school admin to assign you to your sections — they'll appear here straight away."
              />
            ) : !mappingsLoading && !mappingsError && mappings.length === 0 ? (
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
                    onChange={(event) => handleChapterChange(event.target.value)}
                    disabled={formLoading}
                  >
                    <option value="">{formLoading ? "Loading…" : "Choose a chapter"}</option>
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
                  <SelectField
                    label="Section"
                    hint={sectionHint}
                    value={selectedSectionId}
                    onChange={(event) => {
                      setSelectedSectionId(event.target.value);
                      setSectionAutoFilled(false);
                    }}
                    disabled={sectionsLoading || Boolean(sectionsError)}
                  >
                    <option value="">
                      {sectionsLoading ? "Loading…" : sectionsError ? "Couldn't load sections" : "Choose a section"}
                    </option>
                    {sections.map((section) => (
                      <option key={section.id} value={section.id} disabled={!section.classLevelCode}>
                        {sectionLabel(section)}
                      </option>
                    ))}
                  </SelectField>
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

                {classMismatch && selectedSection && selectedMapping ? (
                  // saffron-900 on saffron-50 is 9.3:1 (the same "heads up,
                  // nothing is wrong yet" treatment as Field.tsx's Caps Lock
                  // note). The icon carries the state as well as the colour.
                  <p className="flex items-start gap-2 rounded-2xl bg-saffron-50 px-3.5 py-2.5 text-[0.8125rem] font-medium leading-snug text-saffron-900 ring-1 ring-inset ring-saffron-200 animate-scale-in">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>
                      This chapter is in Class {selectedMapping.className}&rsquo;s calendar, but you&rsquo;ve picked a
                      Class {selectedSection.classLevelCode} section. You can still assign it &mdash; just check
                      it&rsquo;s the one you meant.
                    </span>
                  </p>
                ) : null}

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
                  Assign to Section
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
        size="xl"
      >
        {resultsError ? <AlertBanner tone="error" message={resultsError} /> : null}
        {grantError ? <AlertBanner tone="error" message={grantError} /> : null}
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
              <TargetRow
                key={row.assignmentTargetId}
                target={row}
                expanded={expandedTargetId === row.assignmentTargetId}
                onToggle={() => toggleExpanded(row.assignmentTargetId)}
                viewingAttemptId={expandedTargetId === row.assignmentTargetId ? viewingAttemptId : null}
                onViewAttempt={viewAttempt}
                attemptDetail={attemptDetail}
                attemptDetailLoading={attemptDetailLoading}
                attemptDetailError={attemptDetailError}
                onGrant={() => grantExtraAttempt(row)}
                granting={grantingTargetId === row.assignmentTargetId}
              />
            ))}
          </div>
        ) : null}
      </Modal>
    </RoleShell>
  );
}
