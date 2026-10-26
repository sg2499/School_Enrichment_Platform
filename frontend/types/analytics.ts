// Class Analytics (#186): GET /api/learning/analytics/*.
import type { ActivityType } from "@/types/learning";

export type AttemptChoice = "first" | "latest";

export interface AnalyticsSection {
  key: string;
  classLevelId: string;
  classLevelCode: string | null;
  section: string;
  boardCourseId: string;
  boardCourseName: string | null;
  isCurrent: boolean;
}

export interface AnalyticsSet {
  learningActivityId: string;
  title: string;
  activityType: ActivityType;
  chapterId: string;
  chapterTitle: string | null;
  chapterNo: number | null;
  students: number;
  handedIn: number;
  lastSetAt: string | null;
}

export interface AnalyticsSets {
  scope: string;
  sets: AnalyticsSet[];
  chapters: AnalyticsChapter[];
}

export interface AnalyticsChapter {
  id: string;
  chapterNo: number | null;
  title: string;
}

export type CellState = "CORRECT" | "PARTIAL" | "WRONG" | "BLANK" | "PENDING";

export interface GridQuestion {
  id: string;
  number: number;
  code: string;
  stem: string;
  questionType: string;
  marks: number;
  skillTitle: string;
  misconception: string | null;
  answered: number;
  percentCorrect: number | null;
}

export interface GridStudent {
  id: string;
  name: string | null;
  studentCode: string;
  isActive: boolean;
  handedIn: boolean;
  score: number | null;
  possible: number | null;
  cells: ({ state: CellState; score: number | null; max: number } | null)[];
}

export interface SetGrid {
  // Which section this answer is for (the page shows it only for that one).
  scope: string;
  activity: { id: string; title: string; activityType: ActivityType };
  attempt: AttemptChoice;
  questions: GridQuestion[];
  students: GridStudent[];
}

export interface FlaggedStudent {
  id: string;
  name: string | null;
  studentCode: string;
  isActive: boolean;
  missed: number;
  answered: number;
  // Practice can be set for them in this section today (not moved or left).
  inSection: boolean;
}

export interface MisconceptionItem {
  misconception: string;
  skill: { id: string; code: string; title: string };
  studentsAnswered: number;
  questionsAsked: number;
  students: FlaggedStudent[];
  practiceSet: { learningActivityId: string; title: string; activityType: ActivityType } | null;
}

export interface MisconceptionReport {
  scope: string;
  chapter: { id: string; chapterNo: number | null; title: string };
  attempt: AttemptChoice;
  missedThreshold: number;
  studentsInSection: number;
  misconceptions: MisconceptionItem[];
}
