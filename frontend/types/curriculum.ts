// Mirrors backend/app/api/routes_curriculum_admin.py's response shapes.

export type ChapterStatus = "DRAFT" | "REVIEW" | "PUBLISHED" | "ARCHIVED";
export type ConceptLessonStatus = "DRAFT" | "REVIEW" | "PUBLISHED" | "ARCHIVED";
export type QuestionStatus = "DRAFT" | "SME_REVIEW" | "APPROVED" | "PUBLISHED";

// The free automated content-quality check (question_quality_service.py),
// separate from QuestionStatus above -- this is "does the content look
// right", not "where is it in the review workflow". FLAGGED always needs a
// human; VERIFIED means a computed check confirmed the stored answer is
// correct; UNVERIFIED means nothing could check it either way, and is
// deliberately never treated the same as VERIFIED.
export type QualityStatus = "UNCHECKED" | "FLAGGED" | "VERIFIED" | "UNVERIFIED";

export type ChapterSummary = {
  id: string;
  code: string;
  chapterNo: number;
  title: string;
  status: ChapterStatus;
  disciplineId: string;
  // A chapter's real identity is (boardCourseId, disciplineId,
  // curriculumVersionId, code) -- not just disciplineId+code -- so the same
  // human-facing code can safely coexist across different classes and
  // syllabus editions (18 Aug 2026, see backend Chapter model docstring).
  boardCourseId: string;
  curriculumVersionId: string;
  termId: string | null;
  sequence: number;
  conceptLessonCount: number;
  questionCount: number;
  createdAt: string | null;
  updatedAt: string | null;
};

// "DRAFT" | "REVIEW" | "PUBLISHED" | "ARCHIVED" -- same lifecycle shape as
// ChapterStatus/ConceptLessonStatus. A school ADMIN only ever sees chapters
// belonging to a PUBLISHED curriculum version (enforced server-side).
export type CurriculumVersionStatus = "DRAFT" | "REVIEW" | "PUBLISHED" | "ARCHIVED";

export type CurriculumVersion = {
  id: string;
  boardId: string;
  code: string;
  label: string;
  status: CurriculumVersionStatus;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ConceptLessonSummary = {
  id: string;
  code: string;
  title: string;
  status: ConceptLessonStatus;
  sequence: number;
  questionCount: number;
};

export type ChapterDetail = ChapterSummary & {
  conceptLessons: ConceptLessonSummary[];
};

// Full content for one question -- the actual review surface (stem, every
// option, correct answer, explanation), not just a status badge. Mirrors
// GET /curriculum-admin/concept-lessons/{id}/questions.
export type QuestionDetail = {
  id: string;
  code: string;
  conceptLessonId: string;
  questionType: string;
  difficulty: number | null;
  competency: string | null;
  stem: string;
  optionA: string | null;
  optionB: string | null;
  optionC: string | null;
  optionD: string | null;
  correctAnswer: string;
  acceptedVariants: string | null;
  hint: string | null;
  explanation: string | null;
  misconceptionTag: string | null;
  marks: number;
  timeSeconds: number | null;
  autoGradable: boolean;
  shuffleOptions: boolean;
  responseFormat: string | null;
  mediaRequired: string | null;
  teacherNote: string | null;
  status: QuestionStatus;
  qualityStatus: QualityStatus;
  qualityFlags: string[];
};

export type BulkApproveResult = {
  approvedCount: number;
  skippedFlaggedCount: number;
  skippedUnverifiedCount: number;
  skippedAlreadyDoneCount: number;
};

export type BoardCourseOption = {
  id: string;
  code: string;
  displayName: string;
  boardId: string;
  boardCode: string;
  classLevelId: string;
  classLevelCode: string;
  classLevelDisplayName: string;
};

// Board -> Class -> Subject cascading filter lookups (19 Aug 2026), backing
// GET /curriculum-admin/boards and GET /curriculum-admin/disciplines.
export type BoardOption = {
  id: string;
  code: string;
  name: string;
};

export type DisciplineOption = {
  id: string;
  code: string;
  displayName: string;
  subjectGroupId: string;
};

export type SchoolOption = {
  id: string;
  name: string;
  board: string | null;
  city: string | null;
};

// section was dropped 19 Aug 2026 -- "n number of sections for a class in a
// school ... all will follow the same syllabus no matter what" (Shailesh).
// A mapping is one schedule per class; see migration d8a3f6c1b2e7.
export type SchoolCurriculumMapEntry = {
  id: string;
  schoolId: string;
  boardCourseId: string;
  chapterId: string;
  className: string | null;
  teacherId: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  textbookReference: string | null;
  sequence: number;
};
