// My Progress (#184): GET /api/learning/my-progress and
// GET /api/learning/tracker/students/{id}/skills.
import type { ActivityType } from "@/types/learning";

export type SkillBand = "STRONG" | "GETTING_THERE" | "NEEDS_WORK" | "JUST_STARTED" | "NOT_STARTED";

export interface SkillProgress {
  id: string;
  code: string;
  title: string;
  percent: number | null;
  answered: number;
  band: SkillBand;
  lastPractisedAt: string | null;
}

// #185: the student's place in their class, as a band only.
export type StandingBand = "TOP_10" | "TOP_25" | "TOP_HALF";

export interface ChapterProgress {
  id: string;
  code: string;
  chapterNo: number;
  title: string;
  skills: SkillProgress[];
  // The student's own view only; null when nothing is said.
  standing?: StandingBand | null;
}

export interface SelfPracticeSet {
  learningActivityId: string;
  title: string;
  activityType: ActivityType;
  questionCount: number;
  estimatedMinutes: number | null;
  openTargetId: string | null;
  openTargetStatus?: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED" | null;
}

export interface AssignedSet {
  assignmentTargetId: string;
  learningActivityId: string;
  title: string;
  activityType: ActivityType;
  status: "PENDING" | "IN_PROGRESS";
  dueDate: string | null;
}

export interface PractiseNextItem {
  skill: SkillProgress & { chapterTitle: string };
  assigned: AssignedSet[];
  selfPractice: SelfPracticeSet[];
}

export interface SelfPracticeHistoryItem {
  assignmentTargetId: string;
  title: string | null;
  activityType: ActivityType | null;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED";
  startedAt: string | null;
  attemptsMade: number;
  maxAttempts: number;
  latestAttempt: {
    id: string;
    attemptNumber: number;
    status: string;
    finalScore: number | null;
    maxScore: number | null;
    reviewStatus: string | null;
  } | null;
}

export interface ProgressSummary {
  strong: number;
  gettingThere: number;
  needsWork: number;
  justStarted: number;
  notStarted: number;
  skills: number;
  overallPercent: number | null;
}

export interface MockPaperResult {
  paperId: string;
  title: string;
  handedInAt: string;
  score: number | null;
  maxScore: number | null;
  percent: number | null;
  // Written answers still to be marked: the marks are "so far".
  waiting?: number;
}

export interface ProgressPayload {
  student: {
    id: string;
    name: string | null;
    studentCode: string;
    className: string | null;
    section: string | null;
  };
  thresholds: { strong: number; gettingThere: number; minAnswers: number };
  summary: ProgressSummary;
  chapters: ChapterProgress[];
  practiseNext: PractiseNextItem[];
  // #207: the mock papers the student has handed in, newest first.
  mockPapers?: MockPaperResult[];
  // The student's own view only.
  selfPractice?: SelfPracticeHistoryItem[];
  standing?: {
    overall: StandingBand | null;
    classLabel: string | null;
  };
}
