"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Archive,
  BookMarked,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Filter,
  HelpCircle,
  Layers,
  ListChecks,
  Map as MapIcon,
  Pencil,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardIcon, CardTitle } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { SelectField, TextField } from "@/components/ui/Field";
import { api, apiErrorMessage } from "@/lib/api";
import type {
  BoardCourseOption,
  BoardOption,
  BulkApproveResult,
  ChapterDetail,
  ChapterStatus,
  ChapterSummary,
  ConceptLessonStatus,
  DisciplineOption,
  QualityStatus,
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

// Quality is a SEPARATE axis from question status -- see question_quality_service.py.
// UNCHECKED shouldn't normally reach the UI (the API computes it lazily on
// read), but is included for completeness/safety.
const QUALITY_STATUS_TONE: Record<QualityStatus, BadgeTone> = {
  UNCHECKED: "neutral",
  FLAGGED: "danger",
  VERIFIED: "success",
  UNVERIFIED: "neutral",
};
const QUALITY_STATUS_LABEL: Record<QualityStatus, string> = {
  UNCHECKED: "Not checked yet",
  FLAGGED: "Flagged — needs review",
  VERIFIED: "Verified correct",
  UNVERIFIED: "Not auto-verifiable",
};
const QUALITY_STATUS_ICON: Record<QualityStatus, typeof ShieldCheck> = {
  UNCHECKED: HelpCircle,
  FLAGGED: ShieldAlert,
  VERIFIED: ShieldCheck,
  UNVERIFIED: HelpCircle,
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
  const QualityIcon = QUALITY_STATUS_ICON[question.qualityStatus];

  return (
    <div
      className={`rounded-2xl border p-4 space-y-3 ${
        question.qualityStatus === "FLAGGED" ? "border-coral-300 bg-coral-50/40" : "border-line bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-eyebrow text-content-subtle">
            {question.code} &middot; {question.questionType}
            {question.difficulty ? ` · Difficulty ${question.difficulty}` : ""} &middot; {question.marks} mark
            {question.marks === 1 ? "" : "s"}
          </p>
          <p className="mt-1 text-sm font-medium leading-[1.5] text-content">{question.stem}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge tone={QUESTION_STATUS_TONE[question.status]} size="sm">
            {question.status.replace("_", " ")}
          </Badge>
          <Badge tone={QUALITY_STATUS_TONE[question.qualityStatus]} size="sm">
            <QualityIcon className="mr-1 h-3 w-3" aria-hidden />
            {QUALITY_STATUS_LABEL[question.qualityStatus]}
          </Badge>
        </div>
      </div>

      {question.qualityFlags.length > 0 ? (
        <ul className="space-y-1 rounded-xl border border-coral-200 bg-coral-50 px-3 py-2">
          {question.qualityFlags.map((flag, i) => (
            <li key={i} className="flex gap-1.5 text-xs leading-[1.5] text-coral-800">
              <span aria-hidden>&bull;</span>
              <span>{flag}</span>
            </li>
          ))}
        </ul>
      ) : null}

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

type ClassLevelOption = { id: string; code: string; displayName: string };

/**
 * Shared Board -> Class -> Subject filter data (19 Aug 2026, Shailesh: the
 * chapter list and the mapping form should both filter by board/class/
 * subject instead of showing one flat list). Boards and Disciplines (the
 * real "Subject" concept -- see curriculum.py's module docstring) come
 * straight from their own lookup endpoints; Class options are derived from
 * board-courses per board since ClassLevel itself has no dedicated
 * endpoint and is otherwise only ever seen bundled into a BoardCourse.
 */
function useCurriculumFilterLookups() {
  const [boards, setBoards] = useState<BoardOption[]>([]);
  const [disciplines, setDisciplines] = useState<DisciplineOption[]>([]);
  const [boardCourses, setBoardCourses] = useState<BoardCourseOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<{ boards: BoardOption[] }>("/curriculum-admin/boards"),
      api.get<{ disciplines: DisciplineOption[] }>("/curriculum-admin/disciplines"),
      api.get<{ boardCourses: BoardCourseOption[] }>("/curriculum-admin/board-courses"),
    ])
      .then(([boardsRes, disciplinesRes, boardCoursesRes]) => {
        if (cancelled) return;
        setBoards(boardsRes.data.boards);
        setDisciplines(disciplinesRes.data.disciplines);
        setBoardCourses(boardCoursesRes.data.boardCourses);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const classLevelsForBoard = useCallback(
    (boardId: string): ClassLevelOption[] => {
      const seen = new Map<string, ClassLevelOption>();
      boardCourses
        .filter((bc) => !boardId || bc.boardId === boardId)
        .forEach((bc) => {
          if (!seen.has(bc.classLevelId)) {
            seen.set(bc.classLevelId, {
              id: bc.classLevelId,
              code: bc.classLevelCode,
              displayName: bc.classLevelDisplayName,
            });
          }
        });
      return Array.from(seen.values()).sort((a, b) => Number(a.code) - Number(b.code));
    },
    [boardCourses],
  );

  return { boards, disciplines, boardCourses, classLevelsForBoard, error };
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

  // Bulk actions (18 Aug 2026: reviewing/approving hundreds of questions
  // one at a time doesn't scale -- see question_quality_service.py).
  const [bulkReviewBusy, setBulkReviewBusy] = useState(false);
  const [bulkReviewResult, setBulkReviewResult] = useState<string | null>(null);
  const [bulkApproveBusy, setBulkApproveBusy] = useState(false);
  const [bulkApproveResult, setBulkApproveResult] = useState<BulkApproveResult | null>(null);

  // Board -> Class -> Subject filters (19 Aug 2026) -- replaces the single
  // flat unfiltered list.
  const { boards, disciplines, classLevelsForBoard } = useCurriculumFilterLookups();
  const [filterBoardId, setFilterBoardId] = useState("");
  const [filterClassLevelId, setFilterClassLevelId] = useState("");
  const [filterDisciplineId, setFilterDisciplineId] = useState("");
  const classLevelOptions = useMemo(
    () => classLevelsForBoard(filterBoardId),
    [classLevelsForBoard, filterBoardId],
  );

  function handleFilterBoardChange(id: string) {
    setFilterBoardId(id);
    setFilterClassLevelId("");
  }

  const loadChapters = useCallback(async () => {
    setLoadingChapters(true);
    setListError(null);
    try {
      const { data } = await api.get<{ chapters: ChapterSummary[] }>("/curriculum-admin/chapters", {
        params: {
          board_id: filterBoardId || undefined,
          class_level_id: filterClassLevelId || undefined,
          discipline_id: filterDisciplineId || undefined,
        },
      });
      setChapters(data.chapters);
    } catch (err) {
      setListError(apiErrorMessage(err));
    } finally {
      setLoadingChapters(false);
    }
  }, [filterBoardId, filterClassLevelId, filterDisciplineId]);

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

  async function sendAllChaptersToReview() {
    setBulkReviewBusy(true);
    setBulkReviewResult(null);
    setListError(null);
    try {
      const { data } = await api.post<{ updatedChapters: string[]; skippedChapters: string[] }>(
        "/curriculum-admin/chapters/bulk-status",
        { status: "REVIEW" },
      );
      setBulkReviewResult(
        data.updatedChapters.length === 0
          ? "No chapters were eligible — only Draft chapters move to Review."
          : `Moved ${data.updatedChapters.length} chapter${data.updatedChapters.length === 1 ? "" : "s"} to Review.`,
      );
      await loadChapters();
      if (selectedId) await loadDetail(selectedId);
    } catch (err) {
      setListError(apiErrorMessage(err));
    } finally {
      setBulkReviewBusy(false);
    }
  }

  async function bulkApproveChapterQuestions(includeUnverified: boolean) {
    if (!selectedId) return;
    setBulkApproveBusy(true);
    setBulkApproveResult(null);
    setDetailError(null);
    try {
      const { data } = await api.post<BulkApproveResult>(
        `/curriculum-admin/chapters/${selectedId}/questions/bulk-approve`,
        { includeUnverified },
      );
      setBulkApproveResult(data);
      // Statuses changed underneath whatever's cached -- drop it so
      // re-opening a lesson shows fresh status/quality info instead of
      // stale pre-bulk-approve data.
      setQuestionsByLesson({});
      setExpandedLessonId(null);
      await Promise.all([loadDetail(selectedId), loadChapters()]);
    } catch (err) {
      setDetailError(apiErrorMessage(err));
    } finally {
      setBulkApproveBusy(false);
    }
  }

  const selected = chapters.find((c) => c.id === selectedId) ?? null;

  function closeChapterReview() {
    setSelectedId(null);
  }

  return (
    <>
      <Card className="animate-fade-up">
        <CardBody className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <CardIcon tone="brand">
                <Layers className="h-5 w-5" aria-hidden />
              </CardIcon>
              <div>
                <CardTitle>Chapters</CardTitle>
                <p className="mt-0.5 text-xs text-content-subtle">
                  Every chapter, at any status — click one to open its dedicated review window
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<Send className="h-4 w-4" />}
              loading={bulkReviewBusy}
              onClick={sendAllChaptersToReview}
            >
              Send All to Review
            </Button>
          </div>

          {bulkReviewResult ? (
            <p className="rounded-xl bg-jade-50 px-3 py-2 text-xs font-medium text-jade-800">{bulkReviewResult}</p>
          ) : null}

          <div className="grid grid-cols-1 gap-3 rounded-2xl border border-line bg-surface-muted/60 p-3.5 sm:grid-cols-3">
            <div className="col-span-full flex items-center gap-1.5 text-xs font-semibold text-content-subtle">
              <Filter className="h-3.5 w-3.5" aria-hidden />
              Filter by Board, Class and Subject
            </div>
            <SelectField
              label="Board"
              value={filterBoardId}
              onChange={(e) => handleFilterBoardChange(e.target.value)}
            >
              <option value="">All Boards</option>
              {boards.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Class"
              value={filterClassLevelId}
              onChange={(e) => setFilterClassLevelId(e.target.value)}
              disabled={!filterBoardId}
            >
              <option value="">All Classes</option>
              {classLevelOptions.map((cl) => (
                <option key={cl.id} value={cl.id}>
                  {cl.displayName}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Subject"
              value={filterDisciplineId}
              onChange={(e) => setFilterDisciplineId(e.target.value)}
            >
              <option value="">All Subjects</option>
              {disciplines.map((discipline) => (
                <option key={discipline.id} value={discipline.id}>
                  {discipline.displayName}
                </option>
              ))}
            </SelectField>
          </div>

          {listError ? <ErrorBanner message={listError} /> : null}

          {loadingChapters ? (
            <p className="text-sm text-content-subtle">Loading chapters&hellip;</p>
          ) : chapters.length === 0 ? (
            <EmptyState
              status={{
                label: filterBoardId || filterClassLevelId || filterDisciplineId ? "No Matches" : "Nothing Imported Yet",
                tone: "neutral",
              }}
              title={filterBoardId || filterClassLevelId || filterDisciplineId ? "No chapters match these filters" : "No chapters yet"}
              description={
                filterBoardId || filterClassLevelId || filterDisciplineId
                  ? "Try widening the board, class or subject filter above."
                  : "Import a chapter workbook to see it here — it lands in Draft, ready for review."
              }
            />
          ) : (
            <ul className="-mx-2 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
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

      <Modal
        open={Boolean(selected)}
        onClose={closeChapterReview}
        size="fullscreen"
        eyebrow={selected?.code}
        title={selected?.title ?? "Chapter"}
        meta={selected ? <Badge tone={CHAPTER_STATUS_TONE[selected.status]}>{selected.status}</Badge> : null}
      >
        {!selected ? null : (
          <div className="space-y-6">
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

              <div className="space-y-2.5 rounded-2xl border border-line bg-surface-muted/60 p-4">
                <div className="flex items-start gap-2.5">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                  <div>
                    <p className="text-sm font-semibold text-content">Bulk-approve this chapter&apos;s questions</p>
                    <p className="mt-0.5 text-xs text-content-subtle">
                      Runs the free automated checks (structural + computed-answer verification), then approves only
                      the questions those checks actually confirmed are correct. Anything flagged, or that no check
                      could verify either way, is left untouched for you to look at individually.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    leadingIcon={<ShieldCheck className="h-4 w-4" />}
                    loading={bulkApproveBusy}
                    onClick={() => bulkApproveChapterQuestions(false)}
                  >
                    Approve All Verified
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<ShieldAlert className="h-4 w-4" />}
                    loading={bulkApproveBusy}
                    onClick={() => bulkApproveChapterQuestions(true)}
                  >
                    Also Approve Unverified
                  </Button>
                </div>
                {bulkApproveResult ? (
                  <p className="text-xs leading-[1.6] text-content-muted">
                    Approved <strong className="text-jade-700">{bulkApproveResult.approvedCount}</strong>.
                    {bulkApproveResult.skippedFlaggedCount > 0
                      ? ` ${bulkApproveResult.skippedFlaggedCount} flagged — needs your review.`
                      : ""}
                    {bulkApproveResult.skippedUnverifiedCount > 0
                      ? ` ${bulkApproveResult.skippedUnverifiedCount} left unverified — not auto-checkable.`
                      : ""}
                    {bulkApproveResult.skippedAlreadyDoneCount > 0
                      ? ` ${bulkApproveResult.skippedAlreadyDoneCount} were already approved/published.`
                      : ""}
                  </p>
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
                            <div className="border-t border-line px-3.5 py-3.5">
                              {loadingQuestionsFor === lesson.id ? (
                                <p className="text-sm text-content-subtle">Loading questions&hellip;</p>
                              ) : !lessonQuestions || lessonQuestions.length === 0 ? (
                                <p className="text-sm text-content-subtle">No questions in this lesson yet.</p>
                              ) : (
                                <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                                  {lessonQuestions.map((question) => (
                                    <QuestionCard
                                      key={question.id}
                                      question={question}
                                      busy={questionActionBusyId === question.id}
                                      onAdvance={(status) => advanceQuestion(lesson.id, question.id, status)}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
          </div>
        )}
      </Modal>
    </>
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
  // Board -> Class -> Subject -> Chapter cascading filters replace the old
  // single unfiltered chapter dropdown + free-text Class/Section fields
  // (19 Aug 2026). Section is gone entirely -- "n number of sections for a
  // class in a school ... all will follow the same syllabus no matter
  // what" (Shailesh) -- a mapping is one schedule for the whole class.
  const { boards, disciplines, boardCourses, classLevelsForBoard } = useCurriculumFilterLookups();
  const [chapters, setChapters] = useState<ChapterSummary[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [mappings, setMappings] = useState<SchoolCurriculumMapEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [loadingSchools, setLoadingSchools] = useState(isPlatformAdmin);
  const [selectedSchoolId, setSelectedSchoolId] = useState("");

  const [boardId, setBoardId] = useState("");
  const [classLevelId, setClassLevelId] = useState("");
  const [disciplineId, setDisciplineId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [plannedStartDate, setPlannedStartDate] = useState("");
  const [plannedEndDate, setPlannedEndDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Reschedule (19 Aug 2026) -- the actual fix for dates slipping because of
  // holidays, elections, festivals, health closures and the rest: a two-
  // click edit on the existing mapping instead of deleting and recreating
  // it. See migration d8a3f6c1b2e7's docstring.
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [rescheduleStart, setRescheduleStart] = useState("");
  const [rescheduleEnd, setRescheduleEnd] = useState("");
  const [reschedulingBusy, setReschedulingBusy] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  // A SUPER_ADMIN needs a school picked before "which school's map" means
  // anything; a school's own ADMIN always has exactly one, implicitly.
  const schoolContextReady = !isPlatformAdmin || Boolean(selectedSchoolId);

  const classLevelOptions = useMemo(() => classLevelsForBoard(boardId), [classLevelsForBoard, boardId]);

  function handleBoardChange(id: string) {
    setBoardId(id);
    setClassLevelId("");
    setChapterId("");
  }
  function handleClassChange(id: string) {
    setClassLevelId(id);
    setChapterId("");
  }
  function handleDisciplineChange(id: string) {
    setDisciplineId(id);
    setChapterId("");
  }

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

  // Chapter options narrow as Board/Class/Subject are picked -- only ever
  // PUBLISHED chapters are offered here, matching the old behaviour.
  useEffect(() => {
    let cancelled = false;
    setLoadingChapters(true);
    api
      .get<{ chapters: ChapterSummary[] }>("/curriculum-admin/chapters", {
        params: {
          board_id: boardId || undefined,
          class_level_id: classLevelId || undefined,
          discipline_id: disciplineId || undefined,
        },
      })
      .then(({ data }) => {
        if (!cancelled) setChapters(data.chapters.filter((c) => c.status === "PUBLISHED"));
      })
      .catch((err) => {
        if (!cancelled) setLoadError(apiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingChapters(false);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId, classLevelId, disciplineId]);

  const chapterById = useMemo(() => new Map(chapters.map((c) => [c.id, c])), [chapters]);
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
    const chapter = chapterId ? chapterById.get(chapterId) : null;
    if (!chapter) {
      setFormError("Choose a board, class, subject and chapter.");
      return;
    }
    const boardCourse = boardCourseById.get(chapter.boardCourseId);
    const classLevel = classLevelOptions.find((cl) => cl.id === classLevelId);
    setSaving(true);
    try {
      await api.post("/curriculum-admin/school-curriculum-maps", {
        schoolId: isPlatformAdmin ? selectedSchoolId : undefined,
        boardCourseId: chapter.boardCourseId,
        chapterId,
        className: classLevel?.displayName ?? boardCourse?.classLevelDisplayName ?? null,
        plannedStartDate: plannedStartDate || null,
        plannedEndDate: plannedEndDate || null,
      });
      setChapterId("");
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

  function startReschedule(mapping: SchoolCurriculumMapEntry) {
    setReschedulingId(mapping.id);
    setRescheduleStart(mapping.plannedStartDate ?? "");
    setRescheduleEnd(mapping.plannedEndDate ?? "");
    setRescheduleError(null);
  }

  function cancelReschedule() {
    setReschedulingId(null);
    setRescheduleError(null);
  }

  async function saveReschedule(mapId: string) {
    setReschedulingBusy(true);
    setRescheduleError(null);
    try {
      await api.patch(`/curriculum-admin/school-curriculum-maps/${mapId}`, {
        plannedStartDate: rescheduleStart || null,
        plannedEndDate: rescheduleEnd || null,
      });
      setReschedulingId(null);
      await loadMappings();
    } catch (err) {
      setRescheduleError(apiErrorMessage(err));
    } finally {
      setReschedulingBusy(false);
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

          {isPlatformAdmin && !selectedSchoolId ? (
            <EmptyState
              status={{ label: "No School Selected", tone: "neutral" }}
              title="Pick a school above"
              description="Choose which school you're mapping this chapter into, then filter down to a chapter by board, class and subject."
            />
          ) : (
            <form onSubmit={handleCreateMapping} className="space-y-4">
              <SelectField label="Board" value={boardId} onChange={(e) => handleBoardChange(e.target.value)} required>
                <option value="" disabled>
                  Choose a board
                </option>
                {boards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.name}
                  </option>
                ))}
              </SelectField>

              <SelectField
                label="Class"
                value={classLevelId}
                onChange={(e) => handleClassChange(e.target.value)}
                disabled={!boardId}
                required
              >
                <option value="" disabled>
                  {boardId ? "Choose a class" : "Choose a board first"}
                </option>
                {classLevelOptions.map((cl) => (
                  <option key={cl.id} value={cl.id}>
                    {cl.displayName}
                  </option>
                ))}
              </SelectField>

              <SelectField
                label="Subject"
                value={disciplineId}
                onChange={(e) => handleDisciplineChange(e.target.value)}
                required
              >
                <option value="" disabled>
                  Choose a subject
                </option>
                {disciplines.map((discipline) => (
                  <option key={discipline.id} value={discipline.id}>
                    {discipline.displayName}
                  </option>
                ))}
              </SelectField>

              <SelectField
                label="Chapter"
                value={chapterId}
                onChange={(e) => setChapterId(e.target.value)}
                disabled={!boardId || !classLevelId || !disciplineId || loadingChapters}
                required
              >
                <option value="" disabled>
                  {loadingChapters
                    ? "Loading chapters…"
                    : chapters.length === 0
                      ? "No published chapters match this board/class/subject"
                      : "Choose a published chapter"}
                </option>
                {chapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.code} &middot; {chapter.title}
                  </option>
                ))}
              </SelectField>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              status={{ label: "Nothing Mapped Yet", tone: "neutral" }}
              title="No chapters mapped yet"
              description="Use the form on the left to place a published chapter into a class."
            />
          ) : (
            <ul className="space-y-2">
              {mappings.map((mapping) => {
                const chapter = chapterById.get(mapping.chapterId);
                const boardCourse = boardCourseById.get(mapping.boardCourseId);
                const isRescheduling = reschedulingId === mapping.id;
                return (
                  <li
                    key={mapping.id}
                    className="rounded-2xl border border-line bg-surface-muted/60 px-3.5 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-3">
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
                        </span>
                        {!isRescheduling && (mapping.plannedStartDate || mapping.plannedEndDate) ? (
                          <span className="mt-0.5 flex items-center gap-1.5 text-[0.6875rem] text-content-faint">
                            <CalendarRange className="h-3 w-3" aria-hidden />
                            {mapping.plannedStartDate ?? "—"} &rarr; {mapping.plannedEndDate ?? "—"}
                          </span>
                        ) : null}
                      </span>
                      {isRescheduling ? null : (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            leadingIcon={<Pencil className="h-4 w-4" />}
                            onClick={() => startReschedule(mapping)}
                          >
                            Edit Schedule
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            leadingIcon={<Trash2 className="h-4 w-4" />}
                            loading={deletingId === mapping.id}
                            onClick={() => handleDelete(mapping.id)}
                          >
                            Remove
                          </Button>
                        </>
                      )}
                    </div>

                    {isRescheduling ? (
                      <div className="mt-3 space-y-3 border-t border-line pt-3">
                        <p className="text-xs text-content-subtle">
                          Shift the planned dates &mdash; for a holiday, election, festival or other disruption &mdash;
                          without deleting this mapping.
                        </p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <TextField
                            label="Planned Start"
                            type="date"
                            value={rescheduleStart}
                            onChange={(e) => setRescheduleStart(e.target.value)}
                          />
                          <TextField
                            label="Planned End"
                            type="date"
                            value={rescheduleEnd}
                            onChange={(e) => setRescheduleEnd(e.target.value)}
                          />
                        </div>
                        {rescheduleError ? <ErrorBanner message={rescheduleError} /> : null}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            leadingIcon={<Check className="h-4 w-4" />}
                            loading={reschedulingBusy}
                            onClick={() => saveReschedule(mapping.id)}
                          >
                            Save Schedule
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            leadingIcon={<X className="h-4 w-4" />}
                            onClick={cancelReschedule}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : null}
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
  // Same reasoning as admin/dashboard/page.tsx: this page is shared by both
  // admin variants, so RoleShell's role prop has to reflect the real
  // signed-in user, not a literal "ADMIN" -- otherwise a super admin's tab
  // always displays as a plain admin in the sidebar.
  const roleForShell = isPlatformAdmin ? "SUPER_ADMIN" : "ADMIN";

  return (
    <RoleShell role={roleForShell} user={user}>
      <div className="space-y-10">
        <PageHeader
          eyebrow="Content Workflow"
          title="Curriculum Studio"
          description={
            isPlatformAdmin
              ? "Review and publish chapters, then map any of them straight into a school's calendar — all in one place."
              : "Bring a published chapter into your school's own calendar — filter by board, class and subject, and you're set."
          }
          meta={
            <Badge tone={isPlatformAdmin ? "brand" : "success"} dot>
              {isPlatformAdmin ? "Platform Admin View" : "School Admin View"}
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
