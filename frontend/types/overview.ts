// What GET /api/overview/* returns (#224). Counts and settings only.

export type Counts = Record<string, number>;

export interface BankSkill {
  id: string;
  code: string;
  title: string;
  questions: number;
  approved: number;
  byDifficulty: Counts;
  inReview?: number;
  flagged?: number;
}

export interface BankChapter {
  id: string;
  code: string;
  chapterNo: number;
  title: string;
  board: string;
  classCode: string;
  subject: string;
  status: string;
  skillCount: number;
  questions: number;
  approved: number;
  byDifficulty: Counts;
  byType: Counts;
  skills: BankSkill[];
  inReview?: number;
  flagged?: number;
}

export interface QuestionBankOverview {
  scope: "platform" | "school";
  totals: {
    chapters: number;
    skills: number;
    questions: number;
    approved: number;
    inReview?: number;
    flagged?: number;
    byDifficulty: Counts;
    byType: Counts;
  };
  chapters: BankChapter[];
}

export interface PatternChapter {
  id: string;
  chapterNo: number;
  title: string;
  board: string;
  classCode: string;
  subject: string;
  patterns: number;
  approved: number;
  draft: number;
  retired: number;
  byMarks: Counts;
}

export interface PatternOverview {
  totals: { total: number; byStatus: Counts; byMarks: Counts };
  chapters: PatternChapter[];
  papersByStatus: Counts;
}

export interface UsageSchool {
  id: string;
  name: string;
  board: string | null;
  city: string | null;
  isActive: boolean;
  students: number;
  teachers: number;
  sections: number;
  notSignedIn: number;
  lastActiveAt: string | null;
  assignmentsSet: number;
  setsHandedIn: number;
  papersSet: number;
  papersHandedIn: number;
  reportCardSets: number;
  weeklyReportSets: number;
}

export interface UsageOverview {
  schools: UsageSchool[];
  totals: Record<string, number>;
  asOf: string;
}

export interface SignInRule {
  role: string;
  label: string;
  idleMinutes: number;
  idle: string;
  maxMinutes: number | null;
  max: string;
  twoFactor: string;
}

export interface PlatformSettings {
  product: { name: string; company: string; environment: string };
  platform: { schools: number; activeSchools: number; boards: string[] };
  signIn: { rules: SignInRule[]; lockoutAttempts: number; lockoutMinutes: number };
}

export interface ActivityItem {
  id: string;
  at: string | null;
  event: string;
  group: string;
  who: string | null;
  role: string | null;
}

export interface ActivityPage {
  items: ActivityItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  groups: string[];
}

export interface ChapterWindow {
  chapterNo: number;
  title: string;
  start: string | null;
  end: string | null;
}

export interface MyClass {
  id: string;
  classCode: string;
  className: string;
  section: string;
  course: string | null;
  students: number;
  practiceSet: number;
  practiceActive: number;
  papers: number;
  runningChapter: ChapterWindow | null;
  nextChapter: ChapterWindow | null;
  since: string | null;
}
