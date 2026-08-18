"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Archive,
  BookMarked,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
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
  QuestionDetail,
  QuestionStatus,
  SchoolCurriculumMapEntry,
  SchoolOption,
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

const QUESTION_STATUS_TONE: Record<QuestionStatus, BadgeTone> = {
  DRAFT: "neutral",
  SME_REVIEW: "warning",
  APPROVED: "success",
  PUBLISHED: "success",
};

/** Question.status's DRAFT -> SME_REVIEW -> APPROVED -> PUBLISHED ladder
 * (mirrors _QUESTION_TRANSITIONS in routes_curriculum_admin.py) rendered as
 * the one action a reviewer takes after actually reading a question's
 * content below -- see QuestionCard.
 */
const QUESTION_NEXT_ACTION: Partial<Record<QuestionStatus, { label: string; next: QuestionStatus }>> = {
  DRAFT: { label: "Send to Review", next: "SME_REVIEW" },
  SME_REVIEW: { label: "Approve", next: "APPROVED" },
  APPROVED: { label: "Publish", next: "PUBLISHED" },
};
const QUESTION_BACK_ACTION: Partial<Record<QuestionStatus, { label: string; next: QuestionStatus }>> = {
  SME_REVIEW: { label: "Reject to Draft", next: "DRAFT" },
  APPROVED: { label: "Send Back", next: "SME_REVIEW" },
  PUBLISHED: { label: "Send Back for Rework", next: "SME_REVIEW" },
};

function QuestionCard({
  question,
  busy,
  onAdvance,
}: {
  question: QuestionDetail;
  busy: boolean;
  onAdvance: (status: QuestionStatus) => void;
}) {
  const options: Array<[string, string | null]> = [
    ["A", question.optionA],
    ["B", question.optionB],
    ["C", question.optionC],
    ["D", question.optionD],
  ].filter(([, text]) => Boolean(text)) as Array<[string, string | null]>;
  const forward = QUESTION_NEXT_ACTION[question.status];
  const back = QUESTION_BACK_ACTION[question.status];

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-eyebrow text-content-subtle">
            {question.code} &middot; {question.questionType}
            {question.difficulty ? ` · Difficulty ${question.difficulty}` : ""} &middot; {question.marks} mark
            {question.marks === 1 ? "" : "s"}
          </p>
          <p className="mt-1 text-sm font-medium leading-[1.5] text-content">{question.stem}</p>
        </div>
        <Badge tone={QUESTION_STATUS_TONE[question.status]} size="sm">
          {question.status.replace("_", " ")}
        </Badge>
      </div>

      {options.length > 0 ? (
        <ul className="space-y-1">
          {options.map(([letter, text]) => (
            <li key={letter} className="flex gap-2 text-sm text-content-muted">
              <span className="font-semibold text-content-subtle">{letter}.</span>
              <span>{text}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-sm">
        <span className="font-semibold text-content-subtle">Correct answer: </span>
        <span className="text-content">{question.correctAnswer}</span>
      </p>

      {question.explanation ? (
        <p className="text-sm text-content-muted">
          <span className="font-semibold text-content-subtle">Explanation: </span>
          {question.explanation}
        </p>
      ) : null}

      {question.hint ? (
        <p className="text-sm text-content-muted">
          <span className="font-semibold text-content-subtle">Hint: </span>
          {question.hint}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        {forward ? (
          <Button size="sm" variant="secondary" loading={busy} onClick={() => onAdvance(forward.next)}>
            {forward.label}
          </Button>
        ) : null}
        {back ? (
          <Button size="sm" variant="ghost" loading={busy} onClick={() => onAdvance(back.next)}>
            {back.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

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

  // Question-level content review -- expanding a lesson is the only way to
  // actually see what's being approved/published, not just its status.
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
  const [questionsByLesson, setQuestionsByLesson] = useState<Record<string, QuestionDetail[]>>({});
  const [loadingQuestionsFor, setLoadingQuestionsFor] = useState<string | null>(null);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  const [questionActionBusyId, setQuestionActionBusyId] = useState<string | null>(null);

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
    // Switching chapters -- collapse any open lesson and drop cached
    // questions from the previous chapter rather than showing stale content.
    setExpandedLessonId(null);
    setQuestionsByLesson({});
    setQuestionsError(null);
  }, [selectedId, loadDetail]);

  const loadQuestions = useCallback(async (lessonId: string) => {
    setLoadingQuestionsFor(lessonId);
    setQuestionsError(null);
    try {
      const { data } = await api.get<{ questions: QuestionDetail[] }>(
        `/curriculum-admin/concept-lessons/${lessonId}/questions`,
      );
      setQuestionsByLesson((prev) => ({ ...prev, [lessonId]: data.questions }));
    } catch (err) {
      setQuestionsError(apiErrorMessage(err));
    } finally {
      setLoadingQuestionsFor(null);
    }
  }, []);

  function toggleLesson(lessonId: string) {
    const opening = expandedLessonId !== lessonId;
    setExpandedLessonId(opening ? lessonId : null);
    if (opening && !questionsByLesson[lessonId]) {
      loadQuestions(lessonId);
    }
  }

  async function advanceQuestion(lessonId: string, questionId: string, status: QuestionStatus) {
    setQuestionActionBusyId(questionId);
    setQuestionsError(null);
    try {
      await api.patch(`/curriculum-admin/questions/${questionId}/status`, { status });
      await loadQuestions(lessonId);
    } catch (err) {
      setQuestionsError(apiErrorMessage(err));
    } finally {
      setQuestionActionBusyId(null);
    }
  }

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
                <p className="text-xs text-content-faint">
                  Open a lesson to read every question&apos;s actual text, options and correct answer before approving
                  it — a status badge alone doesn&apos;t tell you what&apos;s about to publish.
                </p>
                {questionsError ? <ErrorBanner message={questionsError} /> : null}
                {loadingDetail ? (
                  <p className="text-sm text-content-subtle">Loading&hellip;</p>
                ) : !detail || detail.conceptLessons.length === 0 ? (
                  <p className="text-sm text-content-subtle">No concept lessons on this chapter.</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.conceptLessons.map((lesson) => {
                      const isExpanded = expandedLessonId === lesson.id;
                      const lessonQuestions = questionsByLesson[lesson.id];
                      return (
                        <li key={lesson.id} className="rounded-2xl border border-line bg-surface-muted/60">
                          <div className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                            <button
                              type="button"
                              onClick={() => toggleLesson(lesson.id)}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 shrink-0 text-content-faint" aria-hidden />
                              ) : (
                                <ChevronRight className="h-4 w-4 shrink-0 text-content-faint" aria-hidden />
                              )}
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-content">{lesson.title}</span>
                                <span className="block truncate text-xs text-content-subtle">
                                  {lesson.code} &middot; {lesson.questionCount} question
                                  {lesson.questionCount === 1 ? "" : "s"}
                                </span>
                              </span>
                            </button>
                            <Badge tone={LESSON_STATUS_TONE[lesson.status]} size="sm">
                              {lesson.status}
                            </Badge>
                            <Button
                              size="sm"
                              variant={isExpanded ? "secondary" : "ghost"}
                              leadingIcon={isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              onClick={() => toggleLesson(lesson.id)}
                            >
                              {isExpanded ? "Hide Questions" : "Review Questions"}
                            </Button>
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
                          </div>

                          {isExpanded ? (
                            <div className="space-y-3 border-t border-line px-3.5 py-3.5">
                              {loadingQuestionsFor === lesson.id ? (
                                <p className="text-sm text-content-subtle">Loading questions&hellip;</p>
                              ) : !lessonQuestions || lessonQuestions.length === 0 ? (
                                <p className="text-sm text-content-subtle">No questions in this lesson yet.</p>
                              ) : (
                                lessonQuestions.map((question) => (
                                  <QuestionCard
                                    key={question.id}
                                    question={question}
                                    busy={questionActionBusyId === question.id}
                                    onAdvance={(status) => advanceQuestion(lesson.id, question.id, status)}
                                  />
                                ))
                              )}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
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
 * Maps a published chapter into a school's own calendar. For a school's own
 * ADMIN this is always their own school (resolved server-side from their
 * SchoolAdmin row -- see routes_curriculum_admin.py's _resolve_school_id()).
 * For SUPER_ADMIN it can be any school, picked explicitly here -- lets one
 * person hold the platform-operator account and still do the whole
 * draft-to-mapped loop for any school without a second login, per Shailesh's
 * 18 Aug 2026 decision to centralize master controls with SUPER_ADMIN.
 */
function CurriculumMapPanel({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  const [publishedChapters, setPublishedChapters] = useState<ChapterSummary[]>([]);
  const [boardCourses, setBoardCourses] = useState<BoardCourseOption[]>([]);
  const [mappings, setMappings] = useState<SchoolCurriculumMapEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [loadingSchools, setLoadingSchools] = useState(isPlatformAdmin);
  const [selectedSchoolId, setSelectedSchoolId] = useState("");

  const [boardCourseId, setBoardCourseId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [className, setClassName] = useState("");
  const [section, setSection] = useState("");
  const [plannedStartDate, setPlannedStartDate] = useState("");
  const [plannedEndDate, setPlannedEndDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // A SUPER_ADMIN needs a school picked before "which school's map" means
  // anything; a school's own ADMIN always has exactly one, implicitly.
  const schoolContextReady = !isPlatformAdmin || Boolean(selectedSchoolId);

  const loadChaptersAndBoardCourses = useCallback(async () => {
    try {
      const [chaptersRes, boardCoursesRes] = await Promise.all([
        api.get<{ chapters: ChapterSummary[] }>("/curriculum-admin/chapters"),
        api.get<{ boardCourses: BoardCourseOption[] }>("/curriculum-admin/board-courses"),
      ]);
      setPublishedChapters(chaptersRes.data.chapters.filter((c) => c.status === "PUBLISHED"));
      setBoardCourses(boardCoursesRes.data.boardCourses);
    } catch (err) {
      setLoadError(apiErrorMessage(err));
    }
  }, []);

  const loadMappings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await api.get<{ schoolCurriculumMaps: SchoolCurriculumMapEntry[] }>(
        "/curriculum-admin/school-curriculum-maps",
        { params: isPlatformAdmin ? { schoolId: selectedSchoolId } : undefined },
      );
      setMappings(data.schoolCurriculumMaps);
    } catch (err) {
      setLoadError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [isPlatformAdmin, selectedSchoolId]);

  useEffect(() => {
    loadChaptersAndBoardCourses();
  }, [loadChaptersAndBoardCourses]);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    setLoadingSchools(true);
    api
      .get<{ schools: SchoolOption[] }>("/curriculum-admin/schools")
      .then(({ data }) => setSchools(data.schools))
      .catch((err) => setLoadError(apiErrorMessage(err)))
      .finally(() => setLoadingSchools(false));
  }, [isPlatformAdmin]);

  useEffect(() => {
    if (schoolContextReady) {
      loadMappings();
    } else {
      setLoading(false);
    }
  }, [schoolContextReady, loadMappings]);

  const chapterById = useMemo(() => new Map(publishedChapters.map((c) => [c.id, c])), [publishedChapters]);
  const boardCourseById = useMemo(() => new Map(boardCourses.map((bc) => [bc.id, bc])), [boardCourses]);
  const selectedSchool = useMemo(
    () => schools.find((s) => s.id === selectedSchoolId) ?? null,
    [schools, selectedSchoolId],
  );

  async function handleCreateMapping(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (isPlatformAdmin && !selectedSchoolId) {
      setFormError("Choose a school first.");
      return;
    }
    if (!boardCourseId || !chapterId) {
      setFormError("Choose a board course and a chapter.");
      return;
    }
    setSaving(true);
    try {
      await api.post("/curriculum-admin/school-curriculum-maps", {
        schoolId: isPlatformAdmin ? selectedSchoolId : undefined,
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
      await loadMappings();
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
      await loadMappings();
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
              <p className="mt-0.5 text-xs text-content-subtle">
                {isPlatformAdmin ? "Places it in any school's calendar" : "Places it in your school’s own calendar"}
              </p>
            </div>
          </div>

          {isPlatformAdmin ? (
            <SelectField
              label="School"
              value={selectedSchoolId}
              onChange={(e) => setSelectedSchoolId(e.target.value)}
              disabled={loadingSchools}
              required
            >
              <option value="" disabled>
                {loadingSchools ? "Loading schools…" : "Choose a school"}
              </option>
              {schools.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                  {school.board ? ` · ${school.board}` : ""}
                  {school.city ? ` · ${school.city}` : ""}
                </option>
              ))}
            </SelectField>
          ) : null}

          {loading ? (
            <p className="text-sm text-content-subtle">Loading&hellip;</p>
          ) : isPlatformAdmin && !selectedSchoolId ? (
            <EmptyState
              status={{ label: "No school selected", tone: "neutral" }}
              title="Pick a school above"
              description="Choose which school you're mapping this chapter into, then pick a board course and a published chapter."
            />
          ) : publishedChapters.length === 0 ? (
            <EmptyState
              status={{ label: "Nothing published yet", tone: "neutral" }}
              title="No published chapters yet"
              description="Once a platform admin publishes a chapter, it appears here ready to map into a school's classes."
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
              <CardTitle>
                {isPlatformAdmin ? (selectedSchool ? `${selectedSchool.name}’s Curriculum Map` : "Curriculum Map") : "Your School’s Curriculum Map"}
              </CardTitle>
              <p className="mt-0.5 text-xs text-content-subtle">
                {schoolContextReady ? `${mappings.length} chapter${mappings.length === 1 ? "" : "s"} mapped` : "Pick a school to see its map"}
              </p>
            </div>
          </div>

          {loadError ? <ErrorBanner message={loadError} /> : null}

          {!schoolContextReady ? null : loading ? (
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
      <div className="space-y-10">
        <PageHeader
          eyebrow="Content workflow"
          title="Curriculum Studio"
          description={
            isPlatformAdmin
              ? "Review and publish chapters, then map any of them straight into a school's calendar — all in one place."
              : "Bring a published chapter into your school's own calendar — pick a class, a section, and you're set."
          }
          meta={
            <Badge tone={isPlatformAdmin ? "brand" : "success"} dot>
              {isPlatformAdmin ? "Platform admin view" : "School admin view"}
            </Badge>
          }
        />

        {isPlatformAdmin ? (
          <>
            <section className="space-y-4">
              <div>
                <h2 className="font-display text-display-sm text-content">Review &amp; Publish</h2>
                <p className="mt-1 text-sm text-content-muted">
                  Draft &rarr; review &rarr; publish. Nothing reaches any school until it&apos;s published here.
                </p>
              </div>
              <ChapterStudio />
            </section>

            <section className="space-y-4 border-t border-line pt-8">
              <div>
                <h2 className="font-display text-display-sm text-content">Map Into a School</h2>
                <p className="mt-1 text-sm text-content-muted">
                  Pick any school and place a published chapter into its calendar — no second login needed.
                </p>
              </div>
              <CurriculumMapPanel isPlatformAdmin />
            </section>
          </>
        ) : (
          <CurriculumMapPanel isPlatformAdmin={false} />
        )}
      </div>
    </RoleShell>
  );
}
