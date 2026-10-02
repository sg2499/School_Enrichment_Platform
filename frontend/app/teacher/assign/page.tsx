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
 *
 * UI revamp, Phase A (2 Oct 2026). Still the same form with the same
 * fields, state and requests; what changed is how it is laid out:
 *  - Six fields in three even rows of two. They used to run 2 / 3 / 1, with
 *    Max Attempts alone on a line of its own at a quarter of the width --
 *    the one field that looked left over.
 *  - The submit button sits in a ruled footer pinned to the bottom of the
 *    card. The card is stretched to the rail's height (SplitLayout), and
 *    whenever the rail was the taller column the button used to float with
 *    a band of empty card under it; now any spare height opens above the
 *    rule, the way SplitLayout's PanelFooter intends.
 *  - "View In Tracker" in the success banner was a `ghost` button -- bare
 *    text on a green banner, and the only action in it. It is `secondary`.
 *  - The quiet teacher ambience sits behind the page.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, Check, ClipboardCheck, Send, Users } from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardIcon, CardTitle } from "@/components/ui/Card";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { SelectField, TextField } from "@/components/ui/Field";
import { PanelFooter, PanelStack, SplitColumn, SplitLayout, StretchCard } from "@/components/ui/SplitLayout";
import { RosterIllustration } from "@/components/brand/Graphics";
import { TeacherAmbience } from "@/components/tracker/TrackerBits";
import { cn } from "@/lib/utils";
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
      <TeacherAmbience />
      {/* `relative` so the page paints above the ambience. */}
      <div className="relative space-y-8">
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

        {/* SplitLayout: the rail's last card absorbs any height the form
            card has over it, so both columns end on one line instead of
            the rail stopping ~40px short. */}
        <SplitLayout columns="lg:grid-cols-[minmax(0,1fr)_20rem]" className="gap-6">
          {/* StretchCard + PanelStack so the form can pin its footer to the
              card's bottom edge (see the note at the top of this file). */}
          <StretchCard className="animate-fade-up">
            <PanelStack>
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
                // flex-1 column, gap instead of space-y: a sibling margin
                // from space-y would cancel the footer's mt-auto (the same
                // reason PanelStack takes a `gap`).
                <form onSubmit={handleAssign} className="flex flex-1 flex-col gap-5">
                  {/* What to assign. */}
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

                  {/* Who gets it, and why. */}
                  <div className="grid gap-4 sm:grid-cols-2">
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

                  {/* The limits. */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      label="Due Date"
                      hint="Optional"
                      type="date"
                      value={dueDate}
                      onChange={(event) => setDueDate(event.target.value)}
                    />
                    <TextField
                      label="Max Attempts"
                      hint="1 to 5"
                      type="number"
                      min={1}
                      max={5}
                      value={maxAttempts}
                      onChange={(event) => setMaxAttempts(Number(event.target.value) || 1)}
                    />
                  </div>

                  {assignError ? <AlertBanner tone="error" message={assignError} /> : null}
                  {assigned ? (
                    // The button is passed inside `message`, not as
                    // AlertBanner's `action`. `action` is a fixed column
                    // beside the text, which on a phone squeezed "Assigned
                    // to 32 students in Class 5 · Section A · Mathematics."
                    // into a five-line sliver next to the button; here the
                    // two share a wrapping row, so the button sits on the
                    // right while there is room and drops under the
                    // sentence when there isn't. sm:items-center lines the
                    // banner's icon up with them once they share a line.
                    <AlertBanner
                      tone="success"
                      className="sm:items-center"
                      message={
                        <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
                          <span>
                            Assigned to {assigned.assignment.targetCount} student
                            {assigned.assignment.targetCount === 1 ? "" : "s"} in {sectionLabel(assigned.section)}.
                          </span>
                          {/* secondary, was ghost. It is the banner's only
                              action and the obvious next step; `tinted`
                              would put a lilac pill on a green banner, so
                              it takes the white one. */}
                          <ButtonLink
                            href={`/teacher/tracker/assignments/${assigned.assignment.id}`}
                            variant="secondary"
                            size="sm"
                            trailingIcon={<ArrowRight className="h-3.5 w-3.5" />}
                          >
                            View In Tracker
                          </ButtonLink>
                        </span>
                      }
                    />
                  ) : null}

                  <PanelFooter>
                    <Button type="submit" variant="primary" loading={assigning} loadingLabel="Assigning" leadingIcon={<Send className="h-4 w-4" />}>
                      Assign to Section
                    </Button>
                    {/* The target, restated beside the button that commits
                        it: the section is chosen three rows up and is
                        sometimes filled in for the teacher (see
                        handleChapterChange), so this is the last look
                        before it goes to thirty students. content-subtle
                        on white 6.4:1, content-muted 8.6:1. */}
                    {selectedSection ? (
                      <p className="text-xs text-content-subtle">
                        Goes to <span className="font-semibold text-content-muted">{sectionLabel(selectedSection)}</span>
                      </p>
                    ) : null}
                  </PanelFooter>
                </form>
              )}
            </PanelStack>
          </StretchCard>

          <SplitColumn as="aside" fill="last" className="animate-fade-up delay-70" aria-label="Your sections">
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
                  // Skeleton rows in the shape of what's coming, like the
                  // dashboard's -- it used to be a bare "Loading…" line.
                  <div className="space-y-2" aria-busy="true">
                    <span className="sr-only" role="status">
                      Loading your sections
                    </span>
                    {[0, 1].map((i) => (
                      <div key={i} aria-hidden className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2.5">
                        <span className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-ink-100" />
                        <span className="h-3.5 w-28 animate-pulse rounded-full bg-ink-100" />
                      </div>
                    ))}
                  </div>
                ) : sections.length === 0 ? (
                  <p className="text-sm text-content-muted">None yet.</p>
                ) : (
                  // Rows, not pills. These were Badges, which are a fixed
                  // h-7 single line: a long course name ("Mathematics
                  // (Advanced Problem Solving)") wrapped to two lines and
                  // spilled out of the pill. Same monogram tile as the
                  // dashboard's Your Sections, so a section looks the same
                  // wherever a teacher meets it, and the name wraps freely.
                  <ul className="space-y-2">
                    {sections.map((section) => {
                      const selected = section.id === selectedSectionId;
                      return (
                        <li
                          key={section.id}
                          className={cn(
                            "flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors duration-200",
                            selected ? "border-brand-200 bg-surface-brand" : "border-line bg-surface",
                          )}
                        >
                          {/* brand-700 on brand-50: 9.3:1. */}
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 font-display text-sm font-semibold text-brand-700 ring-1 ring-inset ring-brand-100">
                            {section.classLevelCode}
                            {section.section}
                          </span>
                          <span className="min-w-0 flex-1 text-[0.8125rem] font-semibold leading-snug text-content">
                            {section.boardCourseName ?? "Course"}
                          </span>
                          {selected ? (
                            <>
                              <Check className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                              <span className="sr-only">(selected)</span>
                            </>
                          ) : null}
                        </li>
                      );
                    })}
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
          </SplitColumn>
        </SplitLayout>
      </div>
    </RoleShell>
  );
}
