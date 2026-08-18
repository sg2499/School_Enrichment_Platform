// Mirrors backend/app/api/routes_curriculum_admin.py's response shapes.

export type ChapterStatus = "DRAFT" | "REVIEW" | "PUBLISHED" | "ARCHIVED";
export type ConceptLessonStatus = "DRAFT" | "REVIEW" | "PUBLISHED" | "ARCHIVED";
export type QuestionStatus = "DRAFT" | "SME_REVIEW" | "APPROVED" | "PUBLISHED";

export type ChapterSummary = {
  id: string;
  code: string;
  chapterNo: number;
  title: string;
  status: ChapterStatus;
  disciplineId: string;
  termId: string | null;
  sequence: number;
  conceptLessonCount: number;
  questionCount: number;
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
};

export type BoardCourseOption = {
  id: string;
  code: string;
  displayName: string;
  boardCode: string;
  classLevelCode: string;
  classLevelDisplayName: string;
};

export type SchoolOption = {
  id: string;
  name: string;
  board: string | null;
  city: string | null;
};

export type SchoolCurriculumMapEntry = {
  id: string;
  schoolId: string;
  boardCourseId: string;
  chapterId: string;
  className: string | null;
  section: string | null;
  teacherId: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  textbookReference: string | null;
  sequence: number;
};
