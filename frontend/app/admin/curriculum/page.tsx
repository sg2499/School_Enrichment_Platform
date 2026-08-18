"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Archive,
  BookMarked,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  Layers,
  ListChecks,
  Map as MapIcon,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardIcon, CardTitle } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { SelectField, TextField } from "@/components/ui/Field";
import { api, apiErrorMessage } from "@/lib/api";
import type {
  BoardCourseOption,
  ChapterDetail,
  ChapterStatus,
  ChapterSummary,
  ConceptLessonStatus,
  SchoolCurriculumMapEntry,
} from "@/types/curriculum";

const CHAPTER_STATUS_TONE: Record<ChapterStatus, BadgeTone> = {
  DRAFT: "neutral",
  REVIEW: "warning",
  PUBLISHED: "success",
  ARCHIVED: "danger",
};

const LESSON_STATUS_TONE: Record<ConceptLessonStatus, BadgeTone> = {
  DRAFT: "neutral",
  REVIEW: "warning",
  PUBLISHED: "success",
  ARCHIVED: "danger",
};

function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-2xl border border-coral-200 bg-coral-50 p-4 animate-scale-in">
      <AlertCircle className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-coral-600" aria-hidden />
      <p className="text-[0.875rem] font-medium leading-[1.55] text-coral-800">{message}</p>
    </div>
  );
}

/**
 * Content-governance view: every chapter, any status, with the
 * draft -> review -> publish state machine exposed directly. SUPER_ADMIN
 * only -- see routes_curriculum_admin.py's module docstring for why a
 * school's own ADMIN never gets these controls.
 */
function ChapterStudio() {
  const [chapters, setChapters] = useState<ChapterSummary[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChapterDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [chapterActionBusy, setChapterActionBusy] = useState(false);
  const [lessonActionBusyId, setLessonActionBusyId] = useState<string | null>(null);

  const loadChapters = useCallback(async () => {
    setLoadingChapters(true);
    setListError(null);
    try {
      const { data } = await api.get<{ chapters: ChapterSummary[] }>("/curriculum-admin/chapters");
      setChapters(data.chapters);
    } catch (err) {
      setListError(apiErrorMessage(err));
    } finally {
      setLoadingChapters(false);
    }
  }, []);

  const loadDetail = useCallback(async (chapterId: string) => {
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const { data } = await api.get<ChapterDetail>(`/curriculum-admin/chapters/${chapterId}`);
      setDetail(data);
    } catch (err) {
      setDetailError(apiErrorMessage(err));
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    loadChapters();
  }, [loadChapters]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  async function transitionChapter(status: ChapterStatus) {
    if (!selectedId) return;
    setChapterActionBusy(true);
    setDetailError(null);
    try {
      await api.patch(`/curriculum-admin/chapters/${selectedId}/status`, { status });
      await Promise.all([loadDetail(selectedId), loadChapters()]);
    } catch (err) {
      setDetailError(apiErrorMessage(err));
    } finally {
      setChapterActionBusy(false);
    }
  }

  async function advanceLesson(lessonId: string, status: ConceptLessonStatus) {
    setLessonActionBusyId(lessonId);
    setDetailError(null);
    try {
      await api.patch(`/curriculum-admin/concept-lessons/${lessonId}/status`, { status });
      if (selectedId) await loadDetail(selectedId);
    } catch (err) {
      setDetailError(apiErrorMessage(err));
    } finally {
      setLessonActionBusyId(null);
    }
  }

  const selected = chapters.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.15fr]">
      <Card className="animate-fade-up">
        <CardBody className="space-y-5">
          <div className="flex items-start gap-3">
            <CardIcon tone="brand">
              <Layers className="h-5 w-5" aria-hidden />
            </CardIcon>
            <div>
              <CardTitle>Chapters</CardTitle>
              <p className="mt-0.5 text-xs text-content-subtle">Every chapter, at any status</p>
            </div>
          </div>

          {listError ? <ErrorBanner message={listError} /> : null}

          {loadingChapters ? (
            <p className="text-sm text-content-subtle">Loading chapters&hellip;</p>
          ) : chapters.length === 0 ? (
            <EmptyState
              status={{ label: "Nothing imported yet", tone: "neutral" }}
              title="No chapters yet"
              description="Import a chapter workbook to see it here — it lands in Draft, ready for review."
            />
          ) : (
            <ul className="-mx-2 space-y-1">
              {chapters.map((chapter) => (
                <li key={chapter.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(chapter.id)}
                    className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition duration-200 ease-spring ${
                      chapter.id === selectedId
                        ? "bg-surface-brand ring-1 ring-inset ring-brand-200"
                        : "hover:bg-surface-muted"
                    }`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-xs font-bold text-brand-700 ring-1 ring-inset ring-brand-100">
                      {chapter.chapterNo}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-content">{chapter.title}</span>
                      <span className="block truncate text-xs text-content-subtle">
                        {chapter.code} &middot; {chapter.conceptLessonCount} lessons &middot; {chapter.questionCount} questions
                      </span>
                    </span>
                    <Badge tone={CHAPTER_STATUS_TONE[chapter.status]} size="sm">
                      {chapter.status}
                    </Badge>
                    <ChevronRight className="h-4 w-4 shrink-0 text-content-faint" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card className="animate-fade-up delay-70">
        <CardBody className="space-y-5">
          {!selected ? (
            <EmptyState
              status={{ label: "Nothing selected", tone: "neutral" }}
              title="Pick a chapter"
              description="Select a chapter on the left to review its concept lessons and move it through draft, review and publish."
            />
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-eyebrow text-content-subtle">
                    {selected.code}
                  </p>
                  <h3 className="mt-0.5 font-display text-lg font-semibold text-content">{selected.title}</h3>
                </div>
                <Badge tone={CHAPTER_STATUS_TONE[selected.status]}>{selected.status}</Badge>
              </div>

              {detailError ? <ErrorBanner message={detailError} /> : null}

              <div className="flex flex-wrap gap-2.5">
                {selected.status === "DRAFT" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    leadingIcon={<Send className="h-4 w-4" />}
                    loading={chapterActionBusy}
                    onClick={() => transitionChapter("REVIEW")}
                  >
                    Send to Review
                  </Button>
                ) : null}
                {selected.status === "REVIEW" ? (
                  <>
                    <Button
                      size="sm"
                      variant="accent"
                      leadingIcon={<CheckCircle2 className="h-4 w-4" />}
                      loading={chapterActionBusy}
                      onClick={() => transitionChapter("PUBLISHED")}
                    >
                      Publish Chapter
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      leadingIcon={<RotateCcw className="h-4 w-4" />}
                      loading={chapterActionBusy}
                      onClick={() => transitionChapter("DRAFT")}
                    >
                      Send Back to Draft
                    </Button>
                  </>
                ) : null}
                {selected.status === "PUBLISHED" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<Archive className="h-4 w-4" />}
                    loading={chapterActionBusy}
                    onClick={() => transitionChapter("ARCHIVED")}
                  >
                    Archive
                  </Button>
                ) : null}
                {selected.status === "ARCHIVED" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    leadingIcon={<RotateCcw className="h-4 w-4" />}
                    loading={chapterActionBusy}
                    onClick={() => transitionChapter("DRAFT")}
                  >
                    Restore to Draft
                  </Button>
                ) : null}
              </div>

              <div className="space-y-2 border-t border-line pt-4">
                <p className="text-xs font-semibold uppercase tracking-eyebrow text-content-subtle">Concept lessons</p>
                {loadingDetail ? (
                  <p className="text-sm text-content-subtle">Loading&hellip;</p>
                ) : !detail || detail.conceptLessons.length === 0 ? (
                  <p className="text-sm text-content-subtle">No concept lessons on this chapter.</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.conceptLessons.map((lesson) => (
                      <li
                        key={lesson.id}
                        className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface-muted/60 px-3.5 py-3"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-content">{lesson.title}</span>
                          <span className="block truncate text-xs text-content-subtle">
                            {lesson.code} &middot; {lesson.questionCount} question{lesson.questionCount === 1 ? "" : "s"}
                          </span>
                        </span>
                        <Badge tone={LESSON_STATUS_TONE[lesson.status]} size="sm">
                          {lesson.status}
                        </Badge>
                        {lesson.status === "DRAFT" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={lessonActionBusyId === lesson.id}
                            onClick={() => advanceLesson(lesson.id, "REVIEW")}
                          >
                            Send to Review
                          </Button>
                        ) : null}
                        {lesson.status === "REVIEW" ? (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={lessonActionBusyId === lesson.id}
                              onClick={() => advanceLesson(lesson.id, "PUBLISHED")}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={lessonActionBusyId === lesson.id}
                              onClick={() => advanceLesson(lesson.id, "DRAFT")}
                            >
                              Back to Draft
                            </Button>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

/**
 * School-scoped view: pick a published chapter and map it into this
 * school's own calendar. Available to ADMIN (own school, resolved
 * server-side) -- see routes_curriculum_admin.py's _resolve_school_id().
 */
function CurriculumMapPanel() {
  const [publishedChapters, setPublishedChapters] = useState<ChapterSummary[]>([]);
  const [boardCourses, setBoardCourses] = useState<BoardCourseOption[]>([]);
  const [mappings, setMappings] = useState<SchoolCurriculumMapEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [boardCourseId, setBoardCourseId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [className, setClassName] = useState("");
  const [section, setSection] = useState("");
  const [plannedStartDate, setPlannedStartDate] = useState("");
  const [plannedEndDate, setPlannedEndDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [chaptersRes, boardCoursesRes, mappingsRes] = await Promise.all([
        api.get<{ chapters: ChapterSummary[] }>("/curriculum-admin/chapters"),
        api.get<{ boardCourses: BoardCourseOption[] }>("/curriculum-admin/board-courses"),
        api.get<{ schoolCurriculumMaps: SchoolCurriculumMapEntry[] }>("/curriculum-admin/school-curriculum-maps"),
      ]);
      setPublishedChapters(chaptersRes.data.chapters.filter((c) => c.status === "PUBLISHED"));
      setBoardCourses(boardCoursesRes.data.boardCourses);
      setMappings(mappingsRes.data.schoolCurriculumMaps);
    } catch (err) {
      setLoadError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const chapterById = useMemo(() => new Map(publishedChapters.map((c) => [c.id, c])), [publishedChapters]);
  const boardCourseById = useMemo(() => new Map(boardCourses.map((bc) => [bc.id, bc])), [boardCourses]);

  async function handleCreateMapping(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!boardCourseId || !chapterId) {
      setFormError("Choose a board course and a chapter.");
      return;
    }
    setSaving(true);
    try {
      await api.post("/curriculum-admin/school-curriculum-maps", {
        boardCourseId,
        chapterId,
        className: className.trim() || null,
        section: section.trim() || null,
        plannedStartDate: plannedStartDate || null,
        plannedEndDate: plannedEndDate || null,
      });
      setClassName("");
      setSection("");
      setPlannedStartDate("");
      setPlannedEndDate("");
      await loadAll();
    } catch (err) {
      setFormError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(mapId: string) {
    setDeletingId(mapId);
    setLoadError(null);
    try {
      await api.delete(`/curriculum-admin/school-curriculum-maps/${mapId}`);
      await loadAll();
    } catch (err) {
      setLoadError(apiErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.05fr]">
      <Card className="animate-fade-up">
        <CardBody className="space-y-5">
          <div className="flex items-start gap-3">
            <CardIcon tone="accent">
              <MapIcon className="h-5 w-5" aria-hidden />
            </CardIcon>
            <div>
              <CardTitle>Map a Published Chapter</CardTitle>
              <p className="mt-0.5 text-xs text-content-subtle">Places it in your school&apos;s own calendar</p>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-content-subtle">Loading&hellip;</p>
          ) : publishedChapters.length === 0 ? (
            <EmptyState
              status={{ label: "Nothing published yet", tone: "neutral" }}
              title="No published chapters yet"
              description="Once a platform admin publishes a chapter, it appears here ready to map into your school's classes."
            />
          ) : (
            <form onSubmit={handleCreateMapping} className="space-y-4">
              <SelectField
                label="Board Course"
                value={boardCourseId}
                onChange={(e) => setBoardCourseId(e.target.value)}
                required
              >
                <option value="" disabled>
                  Choose a board course
                </option>
                {boardCourses.map((bc) => (
                  <option key={bc.id} value={bc.id}>
                    {bc.boardCode} &middot; {bc.classLevelDisplayName} &middot; {bc.displayName}
                  </option>
                ))}
              </SelectField>

              <SelectField
                label="Chapter"
                value={chapterId}
                onChange={(e) => setChapterId(e.target.value)}
                required
              >
                <option value="" disabled>
                  Choose a published chapter
                </option>
                {publishedChapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.code} &middot; {chapter.title}
                  </option>
                ))}
              </SelectField>

              <div className="grid grid-cols-2 gap-4">
                <TextField label="Class" hint="e.g. 5" value={className} onChange={(e) => setClassName(e.target.value)} />
                <TextField label="Section" hint="e.g. A" value={section} onChange={(e) => setSection(e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <TextField
                  label="Planned Start"
                  type="date"
                  value={plannedStartDate}
                  onChange={(e) => setPlannedStartDate(e.target.value)}
                />
                <TextField
                  label="Planned End"
                  type="date"
                  value={plannedEndDate}
                  onChange={(e) => setPlannedEndDate(e.target.value)}
                />
              </div>

              {formError ? <ErrorBanner message={formError} /> : null}

              <Button type="submit" fullWidth loading={saving} leadingIcon={<ArrowRight className="h-4 w-4" />}>
                Add to Curriculum Map
              </Button>
            </form>
          )}
        </CardBody>
      </Card>

      <Card className="animate-fade-up delay-70">
        <CardBody className="space-y-5">
          <div className="flex items-start gap-3">
            <CardIcon tone="jade">
              <ListChecks className="h-5 w-5" aria-hidden />
            </CardIcon>
            <div>
              <CardTitle>Your School&apos;s Curriculum Map</CardTitle>
              <p className="mt-0.5 text-xs text-content-subtle">
                {mappings.length} chapter{mappings.length === 1 ? "" : "s"} mapped
              </p>
            </div>
          </div>

          {loadError ? <ErrorBanner message={loadError} /> : null}

          {loading ? (
            <p className="text-sm text-content-subtle">Loading&hellip;</p>
          ) : mappings.length === 0 ? (
            <EmptyState
              status={{ label: "Nothing mapped yet", tone: "neutral" }}
              title="No chapters mapped yet"
              description="Use the form on the left to place a published chapter into a class and section."
            />
          ) : (
            <ul className="space-y-2">
              {mappings.map((mapping) => {
                const chapter = chapterById.get(mapping.chapterId);
                const boardCourse = boardCourseById.get(mapping.boardCourseId);
                return (
                  <li
                    key={mapping.id}
                    className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface-muted/60 px-3.5 py-3"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-jade-50 text-jade-700 ring-1 ring-inset ring-jade-100">
                      <BookMarked className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-content">
                        {chapter?.title ?? "Chapter"}
                      </span>
                      <span className="block truncate text-xs text-content-subtle">
                        {boardCourse?.displayName ?? "Board course"}
                        {mapping.className ? ` · Class ${mapping.className}` : ""}
                        {mapping.section ? ` · Section ${mapping.section}` : ""}
                      </span>
                      {mapping.plannedStartDate || mapping.plannedEndDate ? (
                        <span className="mt-0.5 flex items-center gap-1.5 text-[0.6875rem] text-content-faint">
                          <CalendarRange className="h-3 w-3" aria-hidden />
                          {mapping.plannedStartDate ?? "—"} &rarr; {mapping.plannedEndDate ?? "—"}
                        </span>
                      ) : null}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      leadingIcon={<Trash2 className="h-4 w-4" />}
                      loading={deletingId === mapping.id}
                      onClick={() => handleDelete(mapping.id)}
                    >
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export default function CurriculumStudioPage() {
  const { user, status } = useProtectedPage("ADMIN");

  if (status !== "ready") {
    return <LoadingScreen />;
  }

  const isPlatformAdmin = user?.role === "SUPER_ADMIN";

  return (
    <RoleShell role="ADMIN" user={user}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Content workflow"
          title="Curriculum Studio"
          description={
            isPlatformAdmin
              ? "Move chapters through draft, review and publish. Nothing reaches a school until it's published here."
              : "Bring a published chapter into your school's own calendar — pick a class, a section, and you're set."
          }
          meta={
            <Badge tone={isPlatformAdmin ? "brand" : "success"} dot>
              {isPlatformAdmin ? "Platform admin view" : "School admin view"}
            </Badge>
          }
        />

        {isPlatformAdmin ? <ChapterStudio /> : <CurriculumMapPanel />}
      </div>
    </RoleShell>
  );
}
