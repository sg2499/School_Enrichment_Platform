"use client";

/**
 * Assign Practice (1 Oct 2026).
 *
 * This form used to share /teacher/assignments with a "My Assignments" list
 * and a results modal -- three jobs on one crammed page (Shailesh: "we need
 * dedicated sub tabs and each sub tab should have a dedicated full screen
 * view"). Setting practice now lives here on its own; reviewing it lives in
 * the Practice Tracker (/teacher/tracker), and /teacher/assignments
 * redirects there (next.config.mjs).
 *
 * The form's behaviour is unchanged from the 30 Sep 2026 version -- the
 * section picker offers only the sections an admin assigned to this
 * teacher (GET /teacher-assignments/my-sections), and the server enforces
 * the same thing (routes_learning.create_assignment: a TEACHER must name a
 * section they currently own; studentIds are refused).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, ClipboardCheck, Send, Users } from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardIcon, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { SelectField, TextField } from "@/components/ui/Field";
import { RosterIllustration } from "@/components/brand/Graphics";
import { api, apiErrorMessage } from "@/lib/api";
import { ACTIVITY_TYPE_LABEL } from "@/types/learning";
import type { Assignment, AssignmentReason, LearningActivity } from "@/types/learning";
import type { SchoolCurriculumMapEntry } from "@/types/curriculum";

const REASON_OPTIONS: { value: AssignmentReason; label: string }[] = [
  { value: "SCHEDULED", label: "Scheduled Practice" },
  { value: "TEACHER_SELECTED", label: "Teacher Selected" },
  { value: "MISSED_PRACTICE", label: "Missed Practice (Catch-Up)" },
  { value: "RE_ATTEMPT", label: "Re-Attempt" },
];

/**
 * One of the signed-in teacher's own current sections, from
 * GET /teacher-assignments/my-sections. classLevelCode is ClassLevel.code
 * ("5".."10"), the same format routes_roster.py stores in
 * Student.class_name, and section is stored verbatim in both places -- so
 * the pair is exactly what POST /learning/assignments needs to reach one
 * section's students. boardCourseName is the course's display name.
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

/** Class numerically ("10" after "9"), then section, then course. */
function compareSections(a: TeacherSection, b: TeacherSection): number {
  const byClass = (Number(a.classLevelCode) || 0) - (Number(b.classLevelCode) || 0);
  if (byClass !== 0) return byClass;
  return a.section.localeCompare(b.section) || (a.boardCourseName ?? "").localeCompare(b.boardCourseName ?? "");
}

/**
 * The teacher's sections this chapter's mapping plausibly belongs to: same
 * class AND same board course. A mapping (SchoolCurriculumMap) is one
 * schedule per class and course, shared by every section of that class, so
 * the mapping alone never says which section is meant.
 */
function sectionsForChapter(mapping: SchoolCurriculumMapEntry | undefined, sections: TeacherSection[]): TeacherSection[] {
  if (!mapping?.className) return [];
  return sections.filter((s) => s.classLevelCode === mapping.className && s.boardCourseId === mapping.boardCourseId);
}

type Assigned = { assignment: Assignment; section: TeacherSection };

export default function AssignPracticePage() {
  const { user, status } = useProtectedPage("TEACHER");

  const [mappings, setMappings] = useState<SchoolCurriculumMapEntry[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(true);
  const [mappingsError, setMappingsError] = useState<string | null>(null);

  const [selectedChapterId, setSelectedChapterId] = useState("");
  const [activities, setActivities] = useState<LearningActivity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState("");

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
  const [assigned, setAssigned] = useState<Assigned | null>(null);

  const loadMappings = useCallback(async () => {
    setMappingsLoading(true);
    setMappingsError(null);
    try {
      const { data } = await api.get<{ schoolCurriculumMaps: SchoolCurriculumMapEntry[] }>(
        "/curriculum-admin/school-curriculum-maps",
      );
      setMappings(data.schoolCurriculumMaps.filter((m) => m.chapterStatus === "PUBLISHED"));
    } catch (err) {
      setMappingsError(apiErrorMessage(err));
    } finally {
      setMappingsLoading(false);
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
  }, [status, loadMappings, loadSections]);

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
        setActivities(data.activities.filter((a) => a.status === "PUBLISHED").sort((a, b) => a.sequence - b.sequence));
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
   * Chapter first, then (maybe) the section. The section is filled in only
   * when the guess can't be wrong: exactly one of this teacher's sections
   * has the chapter's class and course. Done in the change handler rather
   * than an effect so a later reload of sections/mappings can never
   * overwrite a section the teacher chose by hand.
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
      setSelectedSectionId("");
      setSectionAutoFilled(false);
    }
  }

  async function handleAssign(event: React.FormEvent) {
    event.preventDefault();
    setAssignError(null);
    setAssigned(null);
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
        className: target.classLevelCode,
        section: target.section,
        reason,
        dueDate: dueDate || null,
        maxAttempts,
      });
      setAssigned({ assignment: data, section: target });
    } catch (err) {
      setAssignError(apiErrorMessage(err));
    } finally {
      setAssigning(false);
    }
  }

  const selectedChapterLabel = useMemo(() => {
    const mapping = mappings.find((m) => m.chapterId === selectedChapterId);
    return mapping ? `${mapping.chapterTitle ?? mapping.chapterCode ?? "Chapter"}` : null;
  }, [mappings, selectedChapterId]);

  const selectedMapping = mappings.find((m) => m.chapterId === selectedChapterId);
  const chapterSections = sectionsForChapter(selectedMapping, sections);
  const selectedSection = sections.find((s) => s.id === selectedSectionId) ?? null;
  const classMismatch = Boolean(
    selectedMapping?.className && selectedSection && selectedSection.classLevelCode !== selectedMapping.className,
  );
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
          title="Assign Practice"
          description="Pick a published chapter, one of its practice sets, and the section to send it to. Students see it straight away."
          actions={
            <ButtonLink href="/teacher/tracker" variant="secondary" leadingIcon={<ClipboardCheck className="h-4 w-4" />}>
              Open Practice Tracker
            </ButtonLink>
          }
        />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Card className="animate-fade-up">
            <CardBody className="space-y-6">
              <div className="flex items-center gap-3">
                <CardIcon tone="brand">
                  <Send className="h-5 w-5" aria-hidden />
                </CardIcon>
                <div>
                  <CardTitle>New Assignment</CardTitle>
                  <p className="mt-0.5 text-xs text-content-subtle">Chapter, activity and section are required</p>
                </div>
              </div>

              {mappingsError ? <AlertBanner tone="error" message={mappingsError} /> : null}
              {sectionsError ? (
                <AlertBanner tone="error" message={`Couldn't load your sections (${sectionsError}). Refresh the page to try again.`} />
              ) : null}

              {sectionsBlocked ? (
                // Blocked, not broken: sections are assigned by an admin
                // (routes_teacher_assignments.py), so the copy says who to ask.
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
                    // saffron-900 on saffron-50 is 9.3:1; the icon carries the state too.
                    <p className="flex items-start gap-2 rounded-2xl bg-saffron-50 px-3.5 py-2.5 text-[0.8125rem] font-medium leading-snug text-saffron-900 ring-1 ring-inset ring-saffron-200 animate-scale-in">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span>
                        This chapter is in Class {selectedMapping.className}&rsquo;s calendar, but you&rsquo;ve picked a Class{" "}
                        {selectedSection.classLevelCode} section. You can still assign it &mdash; just check it&rsquo;s the one you
                        meant.
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
                  {assigned ? (
                    <AlertBanner
                      tone="success"
                      message={
                        <>
                          Assigned to {assigned.assignment.targetCount} student{assigned.assignment.targetCount === 1 ? "" : "s"} in{" "}
                          {sectionLabel(assigned.section)}.
                        </>
                      }
                      action={
                        <ButtonLink
                          href={`/teacher/tracker/assignments/${assigned.assignment.id}`}
                          variant="ghost"
                          size="sm"
                          trailingIcon={<ArrowRight className="h-3.5 w-3.5" />}
                        >
                          View In Tracker
                        </ButtonLink>
                      }
                    />
                  ) : null}

                  <Button type="submit" variant="primary" loading={assigning} leadingIcon={<Send className="h-4 w-4" />}>
                    Assign to Section
                  </Button>
                </form>
              )}
            </CardBody>
          </Card>

          <aside className="space-y-4 animate-fade-up delay-70" aria-label="Your sections">
            <Card tone="muted">
              <CardBody className="space-y-4 sm:p-6">
                <div className="flex items-center gap-3">
                  <CardIcon tone="jade">
                    <Users className="h-5 w-5" aria-hidden />
                  </CardIcon>
                  <div>
                    <CardTitle className="text-base">Your Sections</CardTitle>
                    <p className="mt-0.5 text-xs text-content-subtle">Assigned by your school admin</p>
                  </div>
                </div>
                {sectionsLoading ? (
                  <p className="text-sm text-content-muted">Loading…</p>
                ) : sections.length === 0 ? (
                  <p className="text-sm text-content-muted">None yet.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {sections.map((section) => (
                      <li key={section.id}>
                        <Badge tone={section.id === selectedSectionId ? "brand" : "neutral"} size="md">
                          {section.classLevelCode}
                          {section.section} &middot; {section.boardCourseName ?? "Course"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card tone="brand">
              <CardBody className="space-y-2 sm:p-6">
                <p className="text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-brand">After You Assign</p>
                <p className="text-sm leading-relaxed text-content-muted">
                  Follow progress, mark written answers and grant extra attempts in the Practice Tracker. Each section&rsquo;s
                  assignments, students and marking queue have their own full-screen view there.
                </p>
              </CardBody>
            </Card>
          </aside>
        </div>
      </div>
    </RoleShell>
  );
}
