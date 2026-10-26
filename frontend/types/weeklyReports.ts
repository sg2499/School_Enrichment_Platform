// The weekly parent report (#187): GET/PUT/POST /api/weekly-reports/*.
import type { ActivityType } from "@/types/learning";

export type SetStatus = "DONE_ON_TIME" | "DONE_LATE" | "DONE" | "NOT_DONE" | "IN_PROGRESS" | "NOT_STARTED";
export type WeeklyIssueStatus = "ISSUED" | "WITHDRAWN";

export interface WeeklySection {
  classLevelId: string;
  classLevel: string;
  section: string;
  canChange: boolean;
  // The weeks this viewer may open (week starts), newest first.
  weeks: string[];
}

export interface WeekOption {
  start: string;
  label: string;
  isCurrent: boolean;
}

export interface WeeklySections {
  sections: WeeklySection[];
  weeks: WeekOption[];
  defaultWeek: string;
}

export interface WeekTotals {
  given: number;
  done: number;
  onTime: number;
  late: number;
  notDone: number;
  open: number;
}

export interface WeekNumbers {
  answered: number;
  marked: number;
  percent: number | null;
  ownPractice: number;
}

export interface WeeklyIssue {
  id: string;
  status: WeeklyIssueStatus;
  weekStart: string;
  weekLabel: string;
  classLevelId: string;
  classLevel: string | null;
  section: string;
  issuedAt: string | null;
  issuedBy: string | null;
  withdrawnAt: string | null;
  withdrawReason: string | null;
  reportCount: number;
}

export interface WeekStudentRow {
  studentId: string;
  studentName: string;
  studentCode: string;
  totals: WeekTotals;
  weekNumbers: WeekNumbers;
  note: string | null;
  // Set once the week is issued: this child's page.
  reportId: string | null;
}

export interface SectionWeek {
  // "classLevelId|section|weekStart": the page shows an answer only for the one on screen.
  scope: string;
  classLevel: { id: string; displayName: string };
  section: string;
  week: { start: string; label: string; isCurrent: boolean };
  canChange: boolean;
  // False for a former teacher with nothing issued that week: no drafts are shown.
  live: boolean;
  issue: WeeklyIssue | null;
  withdrawn: WeeklyIssue[];
  sectionNote: string | null;
  maxNote: number;
  students: WeekStudentRow[];
}

export interface WeeklySetRow {
  title: string;
  subject: string | null;
  chapterNo: number | null;
  activityType: ActivityType;
  activityLabel: string;
  setOn: string | null;
  dueDate: string | null;
  status: SetStatus;
  statusLabel: string;
  score: number | null;
  possible: number | null;
  marksToCome: boolean;
  attempts: number;
}

export interface WeeklySkill {
  title: string;
  chapter: string;
  chapterNo: number | null;
  percent: number | null;
  band: string;
}

export interface WeeklyReportData {
  title: string;
  school: { name: string; city: string | null };
  student: { id: string; name: string; code: string; classLevel: string; section: string };
  week: { start: string; end: string; label: string };
  sets: WeeklySetRow[];
  totals: WeekTotals;
  weekNumbers: WeekNumbers;
  skills?: { strong: WeeklySkill[]; workOn: WeeklySkill[] };
  notes: { section: string | null; child: string | null };
  madeOn: string;
  issuedAt?: string;
  issuedBy?: string | null;
}

export interface MyWeeklyReport {
  id: string;
  weekStart: string;
  weekLabel: string;
  issuedAt: string | null;
}
