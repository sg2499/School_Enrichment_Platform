"use client";

/**
 * What Curriculum Studio's parts share (#212, 29 Oct 2026): the status
 * wording and colours, the Board / Class / Subject lookups, dates, and the
 * error line. Moved out of app/admin/curriculum/page.tsx when the page was
 * split into sub-tabs and a page per chapter.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { BadgeTone } from "@/components/ui/Badge";
import type { MapTiming } from "@/lib/curriculumStudio";
import type {
  BoardCourseOption,
  BoardOption,
  ChapterStatus,
  ConceptLessonStatus,
  DisciplineOption,
  QualityStatus,
  QuestionStatus,
} from "@/types/curriculum";

/** Where the chapter list was left (its filters), so a chapter's "All Chapters" link goes back to it. */
export const LIST_KEY = "krama_curriculum_list";

export const CHAPTER_STATUS_TONE: Record<ChapterStatus, BadgeTone> = {
  DRAFT: "neutral",
  REVIEW: "warning",
  PUBLISHED: "success",
  ARCHIVED: "danger",
};

export const LESSON_STATUS_TONE: Record<ConceptLessonStatus, BadgeTone> = CHAPTER_STATUS_TONE;

export const QUESTION_STATUS_TONE: Record<QuestionStatus, BadgeTone> = {
  DRAFT: "neutral",
  SME_REVIEW: "warning",
  APPROVED: "success",
  PUBLISHED: "success",
};

// Quality is a separate axis from status: see question_quality_service.py.
export const QUALITY_STATUS_TONE: Record<QualityStatus, BadgeTone> = {
  UNCHECKED: "neutral",
  FLAGGED: "danger",
  VERIFIED: "success",
  UNVERIFIED: "neutral",
};
export const QUALITY_STATUS_LABEL: Record<QualityStatus, string> = {
  UNCHECKED: "Not checked yet",
  FLAGGED: "Flagged: needs review",
  VERIFIED: "Verified correct",
  UNVERIFIED: "Not auto-verifiable",
};

/** Human wording for the status enums; the raw values are API vocabulary. */
export const STATUS_LABEL: Record<ChapterStatus | QuestionStatus, string> = {
  DRAFT: "Draft",
  REVIEW: "In Review",
  SME_REVIEW: "In Review",
  APPROVED: "Approved",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

export { countOf, formatPlannedDay, mapTiming, todayIso, type MapTiming } from "@/lib/curriculumStudio";

export const TIMING_LABEL: Record<MapTiming, string> = {
  running: "Running Now",
  upcoming: "Coming Up",
  finished: "Finished",
  undated: "Dates Not Set",
};
export const TIMING_TONE: Record<MapTiming, BadgeTone> = {
  running: "success",
  upcoming: "brand",
  finished: "neutral",
  undated: "warning",
};

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-2xl border border-coral-200 bg-coral-50 p-4 animate-scale-in">
      <AlertCircle className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-coral-600" aria-hidden />
      <p className="text-[0.875rem] font-medium leading-[1.55] text-coral-800">{message}</p>
    </div>
  );
}

export type ClassLevelOption = { id: string; code: string; displayName: string };

/** Boards, subjects and board courses, with the classes each board has. */
export function useCurriculumFilterLookups() {
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
      .then(([b, d, c]) => {
        if (cancelled) return;
        setBoards(b.data.boards);
        setDisciplines(d.data.disciplines);
        setBoardCourses(c.data.boardCourses);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "load the board, class and subject lists"));
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
            seen.set(bc.classLevelId, { id: bc.classLevelId, code: bc.classLevelCode, displayName: bc.classLevelDisplayName });
          }
        });
      return Array.from(seen.values()).sort((a, b) => Number(a.code) - Number(b.code));
    },
    [boardCourses],
  );

  return { boards, disciplines, boardCourses, classLevelsForBoard, error };
}
