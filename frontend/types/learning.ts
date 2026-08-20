// Mirrors backend/app/api/routes_learning.py's response shapes (Phase 3,
// the five-day learning loop) and the chapter-enrichment fields added to
// GET /curriculum-admin/school-curriculum-maps for the teacher Assign
// workspace (20 Aug 2026).

export type ActivityType =
  | "PREREQUISITE_CHECK"
  | "CONCEPT_SIMPLE"
  | "CORE_PRACTICE"
  | "EXTRA_PRACTICE"
  | "REMEDIATION"
  | "CHALLENGE"
  | "CASE_STUDY"
  | "CHAPTER_MASTERY";

export type ActivityStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export type LearningActivity = {
  id: string;
  chapterId: string;
  conceptLessonId: string | null;
  activityType: ActivityType;
  title: string;
  sequence: number;
  pacingDay: number | null;
  evaluationMode: string;
  isRequired: boolean;
  estimatedMinutes: number | null;
  status: ActivityStatus;
  sourceAssignmentCode: string | null;
};

export type AssignmentReason =
  | "SCHEDULED"
  | "PREREQUISITE_GAP"
  | "LOW_ACCURACY"
  | "LOW_FLUENCY"
  | "MISSED_PRACTICE"
  | "TEACHER_SELECTED"
  | "RE_ATTEMPT"
  | "ADMIN_APPROVED";

export type Assignment = {
  id: string;
  schoolId: string;
  learningActivityId: string;
  learningActivityTitle?: string | null;
  learningActivityType?: ActivityType | null;
  className: string | null;
  reason: AssignmentReason;
  pacingMode: string;
  dueDate: string | null;
  availableFrom: string | null;
  maxAttempts: number;
  status: "ACTIVE" | "CLOSED" | "CANCELLED";
  targetCount: number;
  createdAt: string | null;
};

export type EvaluationResult = {
  attemptId: string;
  autoScore: number;
  maxScore: number;
  finalScore: number;
  reviewStatus: "AUTO_FINALISED" | "PENDING_REVIEW";
  evaluatedAt: string | null;
};

export type AttemptStatus = "IN_PROGRESS" | "SUBMITTED" | "EVALUATED" | "ABANDONED";

export type LatestAttemptSummary = {
  id: string;
  attemptNumber: number;
  status: AttemptStatus;
  evaluation: EvaluationResult | null;
};

// One row of GET /api/learning/assignments as seen by a STUDENT -- "Today's
// Practice".
export type StudentAssignmentSummary = {
  assignmentTargetId: string;
  assignmentId: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED";
  learningActivity: LearningActivity;
  dueDate: string | null;
  reason: AssignmentReason;
  maxAttempts: number;
  latestAttempt: LatestAttemptSummary | null;
};

// One row of GET /api/learning/assignments/{id}/targets -- the teacher
// results/review view. Extended 20 Aug 2026 with full attempt history and
// the fields the reattempt-approval action needs.
export type AssignmentTargetResult = {
  assignmentTargetId: string;
  studentId: string;
  studentName: string | null;
  studentCode: string;
  className: string | null;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED";
  maxAttempts: number;
  bonusAttempts: number;
  attemptsUsed: number;
  attempts: LatestAttemptSummary[];
  latestAttempt: LatestAttemptSummary | null;
};

// POST /api/learning/assignments/{id}/targets/{targetId}/grant-attempt's
// response -- just the counters the row needs to refresh itself.
export type GrantExtraAttemptResult = {
  assignmentTargetId: string;
  maxAttempts: number;
  bonusAttempts: number;
  attemptsUsed: number;
};

// A question as sent to a student mid-attempt -- never the answer key (see
// routes_learning.py's _question_public_dict).
export type AttemptQuestion = {
  id: string;
  code: string;
  questionType: string;
  stem: string;
  optionA: string | null;
  optionB: string | null;
  optionC: string | null;
  optionD: string | null;
  marks: number;
  timeSeconds: number | null;
  responseFormat: string | null;
};

export type AttemptDetail = {
  id: string;
  assignmentTargetId: string;
  attemptNumber: number;
  status: AttemptStatus;
  startedAt: string | null;
  activity: LearningActivity;
  questions: AttemptQuestion[];
};

// One row of GET /api/learning/attempts/{id}/result's "answers" array --
// the answer key IS included here, only here, post-submission.
export type AttemptAnswerResult = {
  questionId: string;
  stem: string;
  responseText: string | null;
  isCorrect: boolean | null;
  autoScore: number | null;
  maxScore: number;
  correctAnswer: string;
  explanation: string | null;
};

export type AttemptResult = EvaluationResult & {
  attemptNumber: number;
  answers: AttemptAnswerResult[];
};

// SchoolCurriculumMapEntry itself (GET /api/curriculum-admin/school-
// curriculum-maps) already lives in types/curriculum.ts -- the teacher
// Assign workspace imports that one directly rather than duplicating it
// here; see its chapterTitle/chapterCode/chapterStatus fields, added
// 20 Aug 2026 for exactly this use.

export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  PREREQUISITE_CHECK: "Prerequisite Check",
  CONCEPT_SIMPLE: "Concept",
  CORE_PRACTICE: "Core Practice",
  EXTRA_PRACTICE: "Extra Practice",
  REMEDIATION: "Remediation",
  CHALLENGE: "Challenge",
  CASE_STUDY: "Case Study",
  CHAPTER_MASTERY: "Chapter Mastery",
};
