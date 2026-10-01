"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Archive,
  BookMarked,
  Building2,
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
import { Badge, Eyebrow, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { SelectField, TextField } from "@/components/ui/Field";
import { PanelStack, SplitLayout, StretchCard } from "@/components/ui/SplitLayout";
import { BlueprintIllustration } from "@/components/brand/Graphics";
import { api, apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
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

/** Human wording for the status enums. The raw values (SME_REVIEW, ...) are
 *  API vocabulary; a reviewer should read "SME Review". */
const STATUS_LABEL: Record<ChapterStatus | QuestionStatus, string> = {
  DRAFT: "Draft",
  REVIEW: "In Review",
  SME_REVIEW: "SME Review",
  APPROVED: "Approved",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

/** The option letters a Select-type question's stored answer names
 *  ("B", or "A, C" for Multi Select), so the card can mark them in place.
 *  Anything else (numeric, text, ordering) returns an empty set and the
 *  "Correct answer" line below carries it alone. */
function correctLetters(question: QuestionDetail): Set<string> {
  if (!/select/i.test(question.questionType)) return new Set();
  return new Set(
    question.correctAnswer
      .split(",")
      .map((part) => part.trim().toUpperCase())
      .filter((part) => /^[A-D]$/.test(part)),
  );
}

function QuestionCard({
  question,
  pendingStatus,
  onAdvance,
}: {
  question: QuestionDetail;
  /** The status this card is currently being moved to, if any -- so only
   *  the button that was pressed shows progress (both used to spin). */
  pendingStatus: QuestionStatus | null;
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
  const correct = correctLetters(question);
  const busy = pendingStatus !== null;

  return (
    <article
      aria-label={`Question ${question.code}`}
      className={cn(
        "flex flex-col gap-3 rounded-2xl border p-4",
        question.qualityStatus === "FLAGGED" ? "border-coral-300 bg-coral-50/40" : "border-line bg-surface",
      )}
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
            {STATUS_LABEL[question.status]}
          </Badge>
          <Badge tone={QUALITY_STATUS_TONE[question.qualityStatus]} size="sm" icon={<QualityIcon className="h-3 w-3" />}>
            {QUALITY_STATUS_LABEL[question.qualityStatus]}
          </Badge>
        </div>
      </div>

      {question.qualityFlags.length > 0 ? (
        // coral-800 on coral-50: 8.7:1.
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
          {options.map(([letter, text]) => {
            const isCorrect = correct.has(letter);
            return (
              <li
                key={letter}
                className={cn(
                  "flex items-start gap-2 rounded-lg px-2 py-1 text-sm",
                  // The keyed option is marked where it sits, so a reviewer
                  // checks it against the stem in one glance instead of
                  // cross-reading a letter from the line below. Tick + words
                  // for screen readers, not colour alone.
                  isCorrect ? "bg-jade-50 text-content ring-1 ring-inset ring-jade-200" : "text-content-muted",
                )}
              >
                <span className={cn("w-4 shrink-0 font-semibold", isCorrect ? "text-jade-700" : "text-content-subtle")}>
                  {letter}.
                </span>
                <span className="min-w-0 flex-1">{text}</span>
                {isCorrect ? (
                  <>
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-jade-600" aria-hidden />
                    <span className="sr-only">(correct answer)</span>
                  </>
                ) : null}
              </li>
            );
          })}
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

      {forward || back ? (
        <div className="mt-auto flex flex-wrap gap-2 border-t border-line/70 pt-3">
          {forward ? (
            <Button
              size="sm"
              variant="secondary"
              loading={pendingStatus === forward.next}
              disabled={busy && pendingStatus !== forward.next}
              onClick={() => onAdvance(forward.next)}
            >
              {forward.label}
            </Button>
          ) : null}
          {back ? (
            <Button
              size="sm"
              variant="ghost"
              loading={pendingStatus === back.next}
              disabled={busy && pendingStatus !== back.next}
              onClick={() => onAdvance(back.next)}
            >
              {back.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
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

type ChapterFilter = ChapterStatus | "ALL";
const CHAPTER_FILTERS: ChapterFilter[] = ["ALL", "DRAFT", "REVIEW", "PUBLISHED", "ARCHIVED"];

/** Placeholder rows in the chapter grid's own shape, so the list doesn't
 *  jump from one line of "Loading…" into a three-column grid. */
function ChapterListSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">
        Loading chapters
      </span>
      <ul aria-hidden className="-mx-2 grid gap-1.5 sm:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="flex items-center gap-3 rounded-2xl px-3 py-3">
            <span className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-ink-100" />
            <span className="flex-1 space-y-2">
              <span className="block h-3.5 w-3/4 animate-pulse rounded-full bg-ink-100" />
              <span className="block h-3 w-1/2 animate-pulse rounded-full bg-ink-100" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Content-governance view: every chapter, any status, with the
 * draft -> review -> publish state machine exposed directly. SUPER_ADMIN
 * only -- see routes_curriculum_admin.py's module docstring for why a
 * school's own ADMIN never gets these controls.
 *
 * Phase 2a pass (30 Sep 2026), the parts that change behaviour rather than
 * just look:
 *  - "Send All to Review" now sends the Draft chapters *listed on screen*
 *    (the endpoint's optional chapterIds), not every Draft on the platform
 *    regardless of the Board/Class/Subject filters above it. With no
 *    filters set that is the same set as before. It also asks once first.
 *  - "Also Approve Unverified" asks once first: it approves questions that
 *    no automated check could confirm, which is the one bulk action here
 *    that can publish a wrong answer key.
 *  - Every multi-button row shows progress only on the button pressed.
 */
function ChapterStudio() {
  const [chapters, setChapters] = useState<ChapterSummary[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ChapterFilter>("ALL");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChapterDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [pendingChapterStatus, setPendingChapterStatus] = useState<ChapterStatus | null>(null);
  const [lessonAction, setLessonAction] = useState<{ id: string; status: ConceptLessonStatus } | null>(null);

  // Question-level content review -- expanding a lesson is the only way to
  // actually see what's being approved/published, not just its status.
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
  const [questionsByLesson, setQuestionsByLesson] = useState<Record<string, QuestionDetail[]>>({});
  const [loadingQuestionsFor, setLoadingQuestionsFor] = useState<string | null>(null);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  const [questionAction, setQuestionAction] = useState<{ id: string; status: QuestionStatus } | null>(null);

  // Bulk actions (18 Aug 2026: reviewing/approving hundreds of questions
  // one at a time doesn't scale -- see question_quality_service.py).
  const [confirmBulkReview, setConfirmBulkReview] = useState(false);
  const [bulkReviewBusy, setBulkReviewBusy] = useState(false);
  const [bulkReviewResult, setBulkReviewResult] = useState<string | null>(null);
  const [bulkApproveMode, setBulkApproveMode] = useState<"verified" | "unverified" | null>(null);
  const [confirmUnverified, setConfirmUnverified] = useState(false);
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
  const anyScopeFilter = Boolean(filterBoardId || filterClassLevelId || filterDisciplineId);

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
    setBulkApproveResult(null);
    setConfirmUnverified(false);
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
    setQuestionAction({ id: questionId, status });
    setQuestionsError(null);
    try {
      await api.patch(`/curriculum-admin/questions/${questionId}/status`, { status });
      await loadQuestions(lessonId);
    } catch (err) {
      setQuestionsError(apiErrorMessage(err));
    } finally {
      setQuestionAction(null);
    }
  }

  async function transitionChapter(status: ChapterStatus) {
    if (!selectedId) return;
    setPendingChapterStatus(status);
    setDetailError(null);
    try {
      await api.patch(`/curriculum-admin/chapters/${selectedId}/status`, { status });
      await Promise.all([loadDetail(selectedId), loadChapters()]);
    } catch (err) {
      setDetailError(apiErrorMessage(err));
    } finally {
      setPendingChapterStatus(null);
    }
  }

  async function advanceLesson(lessonId: string, status: ConceptLessonStatus) {
    setLessonAction({ id: lessonId, status });
    setDetailError(null);
    try {
      await api.patch(`/curriculum-admin/concept-lessons/${lessonId}/status`, { status });
      if (selectedId) await loadDetail(selectedId);
    } catch (err) {
      setDetailError(apiErrorMessage(err));
    } finally {
      setLessonAction(null);
    }
  }

  const listedDrafts = useMemo(() => chapters.filter((c) => c.status === "DRAFT"), [chapters]);

  async function sendListedDraftsToReview() {
    setBulkReviewBusy(true);
    setBulkReviewResult(null);
    setListError(null);
    try {
      const { data } = await api.post<{ updatedChapters: string[]; skippedChapters: string[] }>(
        "/curriculum-admin/chapters/bulk-status",
        { status: "REVIEW", chapterIds: listedDrafts.map((c) => c.id) },
      );
      setBulkReviewResult(
        data.updatedChapters.length === 0
          ? "No chapters were eligible — only Draft chapters move to Review."
          : `Moved ${data.updatedChapters.length} chapter${data.updatedChapters.length === 1 ? "" : "s"} to Review.`,
      );
      setConfirmBulkReview(false);
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
    setBulkApproveMode(includeUnverified ? "unverified" : "verified");
    setBulkApproveResult(null);
    setDetailError(null);
    try {
      const { data } = await api.post<BulkApproveResult>(
        `/curriculum-admin/chapters/${selectedId}/questions/bulk-approve`,
        { includeUnverified },
      );
      setBulkApproveResult(data);
      setConfirmUnverified(false);
      // Statuses changed underneath whatever's cached -- drop it so
      // re-opening a lesson shows fresh status/quality info instead of
      // stale pre-bulk-approve data.
      setQuestionsByLesson({});
      setExpandedLessonId(null);
      await Promise.all([loadDetail(selectedId), loadChapters()]);
    } catch (err) {
      setDetailError(apiErrorMessage(err));
    } finally {
      setBulkApproveMode(null);
    }
  }

  const statusCounts = useMemo(() => {
    const counts: Record<ChapterFilter, number> = { ALL: chapters.length, DRAFT: 0, REVIEW: 0, PUBLISHED: 0, ARCHIVED: 0 };
    for (const chapter of chapters) counts[chapter.status] += 1;
    return counts;
  }, [chapters]);
  const visibleChapters = statusFilter === "ALL" ? chapters : chapters.filter((c) => c.status === statusFilter);

  const selected = chapters.find((c) => c.id === selectedId) ?? null;
  // The open chapter's own detail, never the previous chapter's while the
  // next one is still loading.
  const currentDetail = detail && detail.id === selectedId ? detail : null;
  const lessons = currentDetail?.conceptLessons ?? [];
  const publishedLessons = lessons.filter((l) => l.status === "PUBLISHED").length;

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
                  Every chapter, at any status — open one to review its lessons and questions
                </p>
              </div>
            </div>
            {!confirmBulkReview ? (
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<Send className="h-4 w-4" />}
                disabled={loadingChapters || listedDrafts.length === 0}
                onClick={() => {
                  setBulkReviewResult(null);
                  setConfirmBulkReview(true);
                }}
              >
                {listedDrafts.length === 0 && !loadingChapters
                  ? "No Drafts to Send"
                  : `Send ${anyScopeFilter ? "Listed" : "All"} Drafts to Review`}
              </Button>
            ) : null}
          </div>

          {confirmBulkReview ? (
            // brand-700 on surface-brand for the lead line: 9.3:1.
            <div role="group" aria-label="Confirm sending drafts to review" className="flex flex-wrap items-center gap-3 rounded-2xl border border-line-brand bg-surface-brand px-4 py-3 animate-scale-in">
              <p className="mr-auto text-[0.8125rem] leading-relaxed text-content-muted">
                <strong className="font-semibold text-content-brand">
                  Move {listedDrafts.length} Draft {listedDrafts.length === 1 ? "chapter" : "chapters"} into Review?
                </strong>{" "}
                {anyScopeFilter ? "Only the chapters matching the filters below. " : ""}Review isn&rsquo;t visible to any
                school &mdash; only Published is.
              </p>
              <Button size="sm" variant="secondary" loading={bulkReviewBusy} loadingLabel="Moving" onClick={sendListedDraftsToReview}>
                Move to Review
              </Button>
              <Button size="sm" variant="ghost" disabled={bulkReviewBusy} onClick={() => setConfirmBulkReview(false)}>
                Cancel
              </Button>
            </div>
          ) : null}

          {bulkReviewResult ? (
            // jade-800 on jade-50: 8.9:1.
            <p role="status" className="flex items-center gap-2 rounded-xl bg-jade-50 px-3 py-2 text-xs font-medium text-jade-800">
              <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {bulkReviewResult}
            </p>
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
              hint={!filterBoardId ? "Pick a board first" : undefined}
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

          {/* Status is the question a content owner actually asks of this
              list ("what's still waiting on me?"), so it gets one-tap
              filters with live counts. Client-side: the list is already
              scoped by the selects above and is at most a few hundred rows. */}
          {!loadingChapters && chapters.length > 0 ? (
            <div role="group" aria-label="Filter by status" className="flex flex-wrap items-center gap-1.5">
              {CHAPTER_FILTERS.map((filter) => {
                const pressed = statusFilter === filter;
                const count = statusCounts[filter];
                return (
                  <button
                    key={filter}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => setStatusFilter(filter)}
                    disabled={filter !== "ALL" && count === 0 && !pressed}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[0.75rem] font-semibold transition disabled:pointer-events-none disabled:opacity-50",
                      pressed
                        ? "border border-brand-300 bg-surface-brand text-content-brand"
                        : "border border-line-strong bg-surface text-content-muted hover:border-brand-300",
                    )}
                  >
                    {filter === "ALL" ? "All" : STATUS_LABEL[filter]}
                    <span className={cn("tabular", pressed ? "text-brand-600" : "text-content-subtle")}>{count}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {listError ? <ErrorBanner message={listError} /> : null}

          {loadingChapters ? (
            <ChapterListSkeleton />
          ) : chapters.length === 0 ? (
            <EmptyState
              illustration={anyScopeFilter ? undefined : <BlueprintIllustration />}
              status={{
                label: anyScopeFilter ? "No Matches" : "Nothing Imported Yet",
                tone: "neutral",
              }}
              title={anyScopeFilter ? "No chapters match these filters" : "No chapters yet"}
              description={
                anyScopeFilter
                  ? "Try widening the board, class or subject filter above."
                  : "Import a chapter workbook to see it here — it lands in Draft, ready for review."
              }
            />
          ) : visibleChapters.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-content-subtle">
              No {STATUS_LABEL[statusFilter as ChapterStatus].toLowerCase()} chapters in this view.
            </p>
          ) : (
            // Three across only from 2xl. At xl (a 1440px laptop with the
            // rail open) three columns left each row ~330px, and with the
            // status badge and chevron beside it nearly every title and
            // its lesson/question counts were cut off mid-word.
            <ul className="-mx-2 grid gap-1.5 sm:grid-cols-2 2xl:grid-cols-3">
              {visibleChapters.map((chapter) => (
                <li key={chapter.id}>
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    onClick={() => setSelectedId(chapter.id)}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition duration-200 ease-spring",
                      chapter.id === selectedId
                        ? "bg-surface-brand ring-1 ring-inset ring-brand-200"
                        : "hover:bg-surface-muted",
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-xs font-bold text-brand-700 ring-1 ring-inset ring-brand-100 tabular">
                      {chapter.chapterNo}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-content">{chapter.title}</span>
                      <span className="block truncate text-xs text-content-subtle">
                        {chapter.code} &middot; {chapter.conceptLessonCount} lessons &middot; {chapter.questionCount} questions
                      </span>
                    </span>
                    <Badge tone={CHAPTER_STATUS_TONE[chapter.status]} size="sm">
                      {STATUS_LABEL[chapter.status]}
                    </Badge>
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-content-faint transition-transform duration-200 ease-spring group-hover:translate-x-0.5"
                      aria-hidden
                    />
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
        eyebrow={selected ? `${selected.code} · Chapter ${selected.chapterNo}` : undefined}
        title={selected?.title ?? "Chapter"}
        meta={
          selected ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={CHAPTER_STATUS_TONE[selected.status]} dot>
                {STATUS_LABEL[selected.status]}
              </Badge>
              <span className="text-xs text-content-subtle tabular">
                {selected.conceptLessonCount} lessons &middot; {selected.questionCount} questions
              </span>
            </div>
          ) : null
        }
      >
        {!selected ? null : (
          <div className="mx-auto max-w-[96rem] space-y-6">
            {detailError ? <ErrorBanner message={detailError} /> : null}

            {/* Two decks side by side on wide screens: the chapter's own
                lifecycle on the left, the question bulk-approve on the right
                -- the two decisions a reviewer makes before reading lessons. */}
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
              <section aria-labelledby="chapter-lifecycle" className="space-y-4 rounded-2xl border border-line p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 id="chapter-lifecycle" className="font-sans text-eyebrow font-bold uppercase text-content-subtle">
                    Chapter status
                  </h3>
                  {lessons.length > 0 ? (
                    <span className="text-xs font-medium text-content-subtle tabular">
                      {publishedLessons} of {lessons.length} lessons published
                    </span>
                  ) : null}
                </div>
                {lessons.length > 0 ? (
                  <div
                    role="img"
                    aria-label={`${publishedLessons} of ${lessons.length} lessons published`}
                    className="h-1.5 overflow-hidden rounded-full bg-ink-100"
                  >
                    <span
                      className="block h-full rounded-full bg-jade-500 transition-[width] duration-500 ease-out-expo"
                      style={{ width: `${(publishedLessons / lessons.length) * 100}%` }}
                    />
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2.5">
                  {selected.status === "DRAFT" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      leadingIcon={<Send className="h-4 w-4" />}
                      loading={pendingChapterStatus === "REVIEW"}
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
                        loading={pendingChapterStatus === "PUBLISHED"}
                        disabled={pendingChapterStatus === "DRAFT"}
                        onClick={() => transitionChapter("PUBLISHED")}
                      >
                        Publish Chapter
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        leadingIcon={<RotateCcw className="h-4 w-4" />}
                        loading={pendingChapterStatus === "DRAFT"}
                        disabled={pendingChapterStatus === "PUBLISHED"}
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
                      loading={pendingChapterStatus === "ARCHIVED"}
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
                      loading={pendingChapterStatus === "DRAFT"}
                      onClick={() => transitionChapter("DRAFT")}
                    >
                      Restore to Draft
                    </Button>
                  ) : null}
                </div>
              </section>

              <section aria-labelledby="bulk-approve" className="space-y-3 rounded-2xl border border-line bg-surface-muted/60 p-4 sm:p-5">
                <div className="flex items-start gap-2.5">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                  <div>
                    <h3 id="bulk-approve" className="font-sans text-sm font-semibold text-content">
                      Bulk-approve this chapter&apos;s questions
                    </h3>
                    <p className="mt-0.5 text-xs leading-relaxed text-content-subtle">
                      Runs the free automated checks (structural + computed-answer verification), then approves only
                      the questions those checks actually confirmed are correct. Anything flagged, or that no check
                      could verify either way, is left untouched for you to look at individually.
                    </p>
                  </div>
                </div>
                {!confirmUnverified ? (
                  <div className="flex flex-wrap gap-2.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      leadingIcon={<ShieldCheck className="h-4 w-4" />}
                      loading={bulkApproveMode === "verified"}
                      loadingLabel="Checking and approving"
                      disabled={bulkApproveMode === "unverified"}
                      onClick={() => bulkApproveChapterQuestions(false)}
                    >
                      Approve All Verified
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      leadingIcon={<ShieldAlert className="h-4 w-4" />}
                      disabled={bulkApproveMode !== null}
                      onClick={() => setConfirmUnverified(true)}
                    >
                      Also Approve Unverified&hellip;
                    </Button>
                  </div>
                ) : (
                  // saffron-900 on saffron-50: 9.3:1.
                  <div role="group" aria-label="Confirm approving unverified questions" className="space-y-3 rounded-xl border border-saffron-200 bg-saffron-50 p-3.5 animate-scale-in">
                    <p className="flex items-start gap-2 text-[0.8125rem] leading-relaxed text-saffron-900">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-saffron-700" aria-hidden />
                      <span>
                        <strong className="font-semibold">This also approves questions no check could verify.</strong>{" "}
                        Their answer keys haven&rsquo;t been confirmed by anything but the import. Flagged questions
                        are still skipped, and any approved question can be sent back later.
                      </span>
                    </p>
                    <div className="flex flex-wrap gap-2.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={bulkApproveMode === "unverified"}
                        loadingLabel="Approving"
                        onClick={() => bulkApproveChapterQuestions(true)}
                      >
                        Approve Verified and Unverified
                      </Button>
                      <Button size="sm" variant="ghost" disabled={bulkApproveMode !== null} onClick={() => setConfirmUnverified(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
                {bulkApproveResult ? (
                  <p role="status" className="text-xs leading-[1.6] text-content-muted">
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
              </section>
            </div>

            <section aria-labelledby="concept-lessons" className="space-y-3 border-t border-line pt-5">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 id="concept-lessons" className="font-sans text-eyebrow font-bold uppercase text-content-subtle">
                    Concept lessons
                  </h3>
                  {/* content-subtle, not content-faint: this is instruction,
                      not decoration, and deserves the stronger step (6.4:1). */}
                  <p className="mt-1 max-w-prose text-xs leading-relaxed text-content-subtle">
                    Open a lesson to read every question&apos;s actual text, options and correct answer before approving
                    it — a status badge alone doesn&apos;t tell you what&apos;s about to publish.
                  </p>
                </div>
              </div>
              {questionsError ? <ErrorBanner message={questionsError} /> : null}
              {loadingDetail && !currentDetail ? (
                <div aria-busy="true" className="space-y-2">
                  <span className="sr-only" role="status">
                    Loading lessons
                  </span>
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} aria-hidden className="flex items-center gap-3 rounded-2xl border border-line px-3.5 py-3.5">
                      <span className="h-4 w-4 animate-pulse rounded bg-ink-100" />
                      <span className="h-3.5 w-1/3 animate-pulse rounded-full bg-ink-100" />
                      <span className="ml-auto h-6 w-20 animate-pulse rounded-full bg-ink-100" />
                    </div>
                  ))}
                </div>
              ) : lessons.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-content-subtle">
                  No concept lessons on this chapter.
                </p>
              ) : (
                <ul className="space-y-2">
                  {lessons.map((lesson) => {
                    const isExpanded = expandedLessonId === lesson.id;
                    const lessonQuestions = questionsByLesson[lesson.id];
                    const panelId = `lesson-panel-${lesson.id}`;
                    const pending = lessonAction?.id === lesson.id ? lessonAction.status : null;
                    return (
                      <li
                        key={lesson.id}
                        className={cn(
                          "overflow-hidden rounded-2xl border transition-colors",
                          isExpanded ? "border-line-brand bg-surface shadow-xs" : "border-line bg-surface-muted/60",
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                          {/* Pointer shortcut only (tabIndex -1): the
                              labelled button beside it is the one keyboard
                              stop for the same action -- two stops that do
                              the same thing is noise. */}
                          <button
                            type="button"
                            tabIndex={-1}
                            onClick={() => toggleLesson(lesson.id)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            <ChevronRight
                              className={cn(
                                "h-4 w-4 shrink-0 text-content-faint transition-transform duration-200 ease-spring",
                                isExpanded && "rotate-90 text-brand-600",
                              )}
                              aria-hidden
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-content">{lesson.title}</span>
                              <span className="block truncate text-xs text-content-subtle tabular">
                                {lesson.code} &middot; {lesson.questionCount} question
                                {lesson.questionCount === 1 ? "" : "s"}
                              </span>
                            </span>
                          </button>
                          <Badge tone={LESSON_STATUS_TONE[lesson.status]} size="sm">
                            {STATUS_LABEL[lesson.status]}
                          </Badge>
                          <Button
                            size="sm"
                            variant={isExpanded ? "secondary" : "ghost"}
                            aria-expanded={isExpanded}
                            aria-controls={panelId}
                            leadingIcon={isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            onClick={() => toggleLesson(lesson.id)}
                          >
                            {isExpanded ? "Hide Questions" : "Review Questions"}
                          </Button>
                          {lesson.status === "DRAFT" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={pending === "REVIEW"}
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
                                loading={pending === "PUBLISHED"}
                                disabled={pending === "DRAFT"}
                                onClick={() => advanceLesson(lesson.id, "PUBLISHED")}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                loading={pending === "DRAFT"}
                                disabled={pending === "PUBLISHED"}
                                onClick={() => advanceLesson(lesson.id, "DRAFT")}
                              >
                                Back to Draft
                              </Button>
                            </>
                          ) : null}
                        </div>

                        {isExpanded ? (
                          <div id={panelId} className="border-t border-line bg-surface-muted/40 px-3.5 py-3.5">
                            {loadingQuestionsFor === lesson.id ? (
                              <div aria-busy="true" className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                                <span className="sr-only" role="status">
                                  Loading questions
                                </span>
                                {[0, 1].map((i) => (
                                  <div key={i} aria-hidden className="space-y-3 rounded-2xl border border-line bg-surface p-4">
                                    <span className="block h-3 w-1/3 animate-pulse rounded-full bg-ink-100" />
                                    <span className="block h-3.5 w-full animate-pulse rounded-full bg-ink-100" />
                                    <span className="block h-3.5 w-4/5 animate-pulse rounded-full bg-ink-100" />
                                  </div>
                                ))}
                              </div>
                            ) : !lessonQuestions || lessonQuestions.length === 0 ? (
                              <p className="text-sm text-content-subtle">No questions in this lesson yet.</p>
                            ) : (
                              <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                                {lessonQuestions.map((question) => (
                                  <QuestionCard
                                    key={question.id}
                                    question={question}
                                    pendingStatus={questionAction?.id === question.id ? questionAction.status : null}
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
            </section>
          </div>
        )}
      </Modal>
    </>
  );
}

/** "2026-09-14" -> "14 Sep 2026" for the map's planned dates, which the
 *  API stores as plain ISO days. Parsed as a local date on purpose: new
 *  Date("2026-09-14") is UTC midnight, which renders as the 13th anywhere
 *  west of Greenwich. Anything unparseable is shown exactly as stored. */
function formatPlannedDay(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
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
  // Removing a mapping takes a chapter out of a school's calendar -- and
  // out of what its teachers can assign practice from -- so it asks once.
  // (It was a single ghost-button click, sitting right beside "Edit
  // Schedule".)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

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
      setConfirmRemoveId(null);
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
    // SplitLayout: the form and the map always stretch to one height, and
    // whichever is shorter centres its empty state in the space it's given
    // rather than leaving a bare lower half.
    <SplitLayout columns="lg:grid-cols-[1fr_1.05fr]">
      <StretchCard className="animate-fade-up">
        <PanelStack gap="gap-5">
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
            <div className="flex flex-1 flex-col justify-center">
              <EmptyState
                status={{ label: "No School Selected", tone: "neutral" }}
                title="Pick a school above"
                description="Choose which school you're mapping this chapter into, then filter down to a chapter by board, class and subject."
              />
            </div>
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
        </PanelStack>
      </StretchCard>

      <StretchCard className="animate-fade-up delay-70">
        <PanelStack gap="gap-5">
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

          {!schoolContextReady ? (
            // Was `null`: a super admin who hadn't picked a school yet saw
            // this card as a title over ~250px of nothing. A dashed
            // placeholder -- the same treatment as "No concept lessons on
            // this chapter" in the review modal -- marks where the map will
            // appear, and fills whatever height the form beside it sets.
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-muted text-content-faint ring-1 ring-inset ring-line">
                <Building2 className="h-5 w-5" aria-hidden />
              </span>
              <p className="max-w-[18rem] text-sm leading-relaxed text-content-subtle">
                Choose a school on the left to see the chapters in its calendar.
              </p>
            </div>
          ) : loading ? (
            <div aria-busy="true" className="space-y-2">
              <span className="sr-only" role="status">
                Loading curriculum map
              </span>
              {[0, 1, 2].map((i) => (
                <div key={i} aria-hidden className="flex items-center gap-3 rounded-2xl border border-line px-3.5 py-3">
                  <span className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-ink-100" />
                  <span className="flex-1 space-y-2">
                    <span className="block h-3.5 w-1/2 animate-pulse rounded-full bg-ink-100" />
                    <span className="block h-3 w-1/3 animate-pulse rounded-full bg-ink-100" />
                  </span>
                </div>
              ))}
            </div>
          ) : mappings.length === 0 ? (
            <div className="flex flex-1 flex-col justify-center">
              <EmptyState
                status={{ label: "Nothing Mapped Yet", tone: "neutral" }}
                title="No chapters mapped yet"
                description={
                  isPlatformAdmin
                    ? "Use the form to place a published chapter into one of this school's classes. Its teachers can assign practice from it straight away."
                    : "Use the form to place a published chapter into a class. Your teachers can assign practice from it straight away."
                }
              />
            </div>
          ) : (
            <ul className="space-y-2">
              {mappings.map((mapping) => {
                // Title from the mapping itself (the list endpoint enriches
                // every row with chapterTitle/chapterCode). It used to come
                // from chapterById, which only holds the *form's* current
                // chapter options -- published chapters matching whatever
                // Board/Class/Subject is picked on the left -- so changing
                // those selects turned every other mapped row into a bare
                // "Chapter". The lookup stays as a fallback only.
                const chapter = chapterById.get(mapping.chapterId);
                const chapterTitle = mapping.chapterTitle ?? chapter?.title ?? "Chapter";
                const chapterCode = mapping.chapterCode ?? chapter?.code ?? null;
                const boardCourse = boardCourseById.get(mapping.boardCourseId);
                const isRescheduling = reschedulingId === mapping.id;
                const isConfirmingRemove = confirmRemoveId === mapping.id;
                const start = formatPlannedDay(mapping.plannedStartDate);
                const end = formatPlannedDay(mapping.plannedEndDate);
                return (
                  <li
                    key={mapping.id}
                    className={cn(
                      "rounded-2xl border px-3.5 py-3 transition-colors",
                      isConfirmingRemove ? "border-coral-200 bg-coral-50/50" : "border-line bg-surface-muted/60",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-jade-50 text-jade-700 ring-1 ring-inset ring-jade-100">
                        <BookMarked className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-content">{chapterTitle}</span>
                        <span className="block truncate text-xs text-content-subtle">
                          {chapterCode ? `${chapterCode} · ` : ""}
                          {boardCourse?.displayName ?? "Board course"}
                          {mapping.className ? ` · Class ${mapping.className}` : ""}
                        </span>
                        {!isRescheduling ? (
                          // content-subtle (6.2:1 on this row), not
                          // content-faint: faint measured 4.48:1 on the
                          // muted row -- just under AA, for the one line that
                          // tells a coordinator *when*.
                          <span className="mt-0.5 flex items-center gap-1.5 text-[0.75rem] text-content-subtle tabular">
                            <CalendarRange className="h-3 w-3 shrink-0" aria-hidden />
                            {start || end ? (
                              <>
                                {start ?? "No start date"} &rarr; {end ?? "No end date"}
                              </>
                            ) : (
                              "Dates not set"
                            )}
                          </span>
                        ) : null}
                      </span>
                      {isRescheduling || isConfirmingRemove ? null : (
                        <span className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Edit schedule for ${chapterTitle}`}
                            leadingIcon={<Pencil className="h-4 w-4" />}
                            onClick={() => {
                              setConfirmRemoveId(null);
                              startReschedule(mapping);
                            }}
                          >
                            Edit Schedule
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Remove ${chapterTitle} from the map`}
                            leadingIcon={<Trash2 className="h-4 w-4" />}
                            onClick={() => setConfirmRemoveId(mapping.id)}
                          >
                            Remove
                          </Button>
                        </span>
                      )}
                    </div>

                    {isConfirmingRemove ? (
                      // coral-800 on the coral-50 wash: 8.7:1.
                      <div role="group" aria-label={`Confirm removing ${chapterTitle}`} className="mt-3 flex flex-wrap items-center gap-2 border-t border-coral-200 pt-3 animate-fade-in">
                        <p className="mr-auto text-[0.8125rem] leading-relaxed text-coral-800">
                          Remove it from {mapping.className ? `Class ${mapping.className}'s` : "this"} calendar? Teachers
                          won&rsquo;t be able to assign new practice from it. The chapter itself isn&rsquo;t affected.
                        </p>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={deletingId === mapping.id}
                          loadingLabel="Removing"
                          onClick={() => handleDelete(mapping.id)}
                        >
                          Remove
                        </Button>
                        <Button size="sm" variant="ghost" disabled={deletingId === mapping.id} onClick={() => setConfirmRemoveId(null)}>
                          Keep It
                        </Button>
                      </div>
                    ) : null}

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
        </PanelStack>
      </StretchCard>
    </SplitLayout>
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
            {/* Numbered, because it is a sequence: nothing in step 2 can
                be mapped until step 1 has published it. The Eyebrow's
                saffron rule ties both back to the page title above. */}
            <section aria-labelledby="studio-review" className="space-y-5">
              <div className="space-y-1.5">
                <Eyebrow>Step 1 &middot; Content</Eyebrow>
                <h2 id="studio-review" className="font-display text-display-sm text-content">
                  Review &amp; Publish
                </h2>
                <p className="text-sm text-content-muted">
                  Draft &rarr; review &rarr; publish. Nothing reaches any school until it&apos;s published here.
                </p>
              </div>
              <ChapterStudio />
            </section>

            <section aria-labelledby="studio-map" className="space-y-5 border-t border-line pt-10">
              <div className="space-y-1.5">
                <Eyebrow>Step 2 &middot; Schools</Eyebrow>
                <h2 id="studio-map" className="font-display text-display-sm text-content">
                  Map Into a School
                </h2>
                <p className="text-sm text-content-muted">
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
