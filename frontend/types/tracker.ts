// Mirrors backend/app/api/routes_practice_tracker.py (1 Oct 2026) -- the
// teacher's Practice Tracker read models and the manual-grading payload.
// Every list endpoint there returns the same Paginated<T> envelope
// (backend/app/core/pagination.py).

import type { ActivityType, AssignmentReason, AttemptStatus, ReviewStatus } from "@/types/learning";

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

/** Where an assignment was set: class level, section and course. Any part
 *  can be null for a whole-class or single-student assignment. */
export type SectionScope = {
  classLevelId: string | null;
  classLevelCode: string | null;
  section: string | null;
  boardCourseId: string | null;
  boardCourseName: string | null;
  className: string | null;
};

export type TrackerSection = {
  key: string;
  classLevelId: string;
  classLevelCode: string | null;
  section: string;
  boardCourseId: string;
  boardCourseName: string | null;
  /** False for a section the teacher has since been transferred off -- its
   *  history stays readable, but nothing in it can be changed. */
  isCurrent: boolean;
};

export type TrackerOverview = {
  sections: TrackerSection[];
  counts: {
    assignments: number;
    activeAssignments: number;
    needsReview: number;
    studentsOnRoster: number | null;
  };
};

export type AssignmentProgress = {
  targeted: number;
  notStarted: number;
  inProgress: number;
  completed: number;
  needsReview: number;
  /** Pooled over each student's latest attempt with a final score; null
   *  until someone has one. */
  averagePercent: number | null;
};

export type TrackerAssignmentStatus = "ACTIVE" | "CLOSED" | "CANCELLED";

export type TrackerAssignmentRow = SectionScope & {
  id: string;
  title: string | null;
  activityType: ActivityType | null;
  reason: AssignmentReason;
  dueDate: string | null;
  createdAt: string | null;
  status: TrackerAssignmentStatus;
  maxAttempts: number;
  assignedByName: string | null;
  isMine: boolean;
  canAct: boolean;
  progress: AssignmentProgress;
};

export type TrackerAssignmentDetail = TrackerAssignmentRow & {
  questionCount: number;
  availableFrom: string | null;
  pacingMode: string;
};

export type TrackerEvaluation = {
  attemptId: string;
  autoScore: number;
  teacherScore: number | null;
  maxScore: number;
  finalScore: number;
  reviewStatus: ReviewStatus;
  evaluatedAt: string | null;
  finalisedAt: string | null;
};

export type TrackerAttempt = {
  id: string;
  attemptNumber: number;
  status: AttemptStatus;
  startedAt: string | null;
  submittedAt: string | null;
  evaluation: TrackerEvaluation | null;
};

export type TargetStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED";

export type TargetSummary = {
  assignmentTargetId: string;
  status: TargetStatus;
  maxAttempts: number;
  bonusAttempts: number;
  attemptsUsed: number;
  attemptsAllowed: number;
  hasOpenAttempt: boolean;
  needsReviewCount: number;
  attempts: TrackerAttempt[];
  latestAttempt: TrackerAttempt | null;
  canGrantAttempt: boolean;
};

export type StudentBasics = {
  studentId: string;
  studentName: string | null;
  studentCode: string;
  className: string | null;
  section: string | null;
  isActive: boolean;
};

export type AssignmentStudentRow = StudentBasics & TargetSummary;

export type StudentFilter = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "NEEDS_REVIEW";

export type AssignmentStudentsPage = Paginated<AssignmentStudentRow> & {
  counts: { all: number; notStarted: number; inProgress: number; completed: number; needsReview: number };
  canAct: boolean;
};

export type StudentStats = {
  assigned: number;
  completed: number;
  needsReview: number;
  averagePercent: number | null;
  lastSubmittedAt: string | null;
};

export type TrackerStudentRow = StudentBasics & { stats: StudentStats };

export type StudentHistoryItem = TargetSummary & {
  assignment: SectionScope & {
    id: string;
    title: string | null;
    activityType: ActivityType | null;
    dueDate: string | null;
    createdAt: string | null;
    status: TrackerAssignmentStatus;
    canAct: boolean;
  };
};

export type StudentHistoryPage = Paginated<StudentHistoryItem> & {
  student: TrackerStudentRow;
};

export type ReviewQueueRow = StudentBasics & {
  attemptId: string;
  attemptNumber: number;
  submittedAt: string | null;
  answersToMark: number;
  answersMarked: number;
  evaluation: TrackerEvaluation;
  assignment: SectionScope & { id: string; title: string | null; activityType: ActivityType | null };
};

export type ReviewAnswer = {
  questionId: string;
  questionCode: string;
  questionType: string;
  stem: string;
  options: Partial<Record<"A" | "B" | "C" | "D", string>>;
  responseText: string | null;
  isCorrect: boolean | null;
  autoScore: number | null;
  manualScore: number | null;
  maxScore: number;
  /** True when auto-marking couldn't score this answer -- the only answers
   *  a teacher marks. */
  needsManualGrade: boolean;
  correctAnswer: string;
  explanation: string | null;
  teacherNote: string | null;
  gradedByName: string | null;
  gradedAt: string | null;
};

export type AttemptReview = {
  attempt: {
    id: string;
    attemptNumber: number;
    status: AttemptStatus;
    startedAt: string | null;
    submittedAt: string | null;
    timeSpentSeconds: number | null;
  };
  evaluation: TrackerEvaluation & { finalisedByName: string | null };
  student: StudentBasics;
  assignment: SectionScope & {
    id: string;
    title: string | null;
    activityType: ActivityType | null;
    status: TrackerAssignmentStatus;
  };
  target: TargetSummary;
  canGrade: boolean;
  answers: ReviewAnswer[];
};
