/**
 * The report cards API's shapes (#188; backend/app/api/routes_report_cards.py).
 * A card (ReportCardData) is the card exactly as issued: the server keeps it
 * as printed, so these figures never change after issue.
 */

export type RecordTerm = "TERM_1" | "TERM_2";
export type CardTerm = "TERM_1" | "YEAR_END";
export type IssueStatus = "ISSUED" | "WITHDRAWN";

export interface ScaleGrade {
  label: string;
  meaning: string;
}

export interface ReportSettings {
  areas: string[];
  scale: ScaleGrade[];
  /** False while the school uses the defaults. */
  saved: boolean;
}

export interface IssueSummary {
  id: string;
  cardTerm: CardTerm;
  status: IssueStatus;
  section: string;
  classLevel: { id: string; displayName: string };
  yearLabel: string | null;
  issuedAt: string | null;
  withdrawnAt: string | null;
  withdrawReason: string | null;
  cardCount: number;
}

export interface OverviewSection {
  classLevel: { id: string; displayName: string };
  section: string;
  canRecord: boolean;
  issues: Record<CardTerm, IssueSummary | null>;
}

export interface ReportOverview {
  school: { id: string; name: string };
  year: { id: string; label: string; isCurrent: boolean };
  settings: ReportSettings;
  canManage: boolean;
  sections: OverviewSection[];
}

export interface TermRecordRow {
  studentId: string;
  studentCode: string;
  studentName: string | null;
  workingDays: number | null;
  daysPresent: number | null;
  grades: Record<string, string>;
  remark: string | null;
  updatedAt: string | null;
}

export interface TermRecords {
  settings: ReportSettings;
  canRecord: boolean;
  rows: TermRecordRow[];
}

export interface Readiness {
  problems: string[];
  warnings: string[];
  students: number;
  subjects: string[];
  issue: IssueSummary | null;
  canIssue: boolean;
}

export interface IssueCardSummary {
  id: string;
  studentId: string;
  studentCode: string;
  studentName: string;
  subjects: { subject: string; result: string | null; grade: string | null; outcomeLabel: string | null }[];
}

export interface IssueDetail extends IssueSummary {
  cards: IssueCardSummary[];
}

export interface CardComponent {
  name: string;
  term: string;
  maxMarks: string;
  status: "MARKS" | "ABSENT" | "EXEMPT" | "MISSING";
  marks: string | null;
}

export interface CardSubject {
  subject: string;
  schemeName: string;
  components: CardComponent[];
  terms?: Partial<Record<RecordTerm, { result: string | null; grade: string | null }>>;
  result: string | null;
  grade: string | null;
  outcome: "PASS" | "BELOW_PASS" | null;
  outcomeLabel: string | null;
  notes: string[];
  gradeBands: { label: string; minPercent: string }[];
}

export interface ReportCardData {
  cardTerm: CardTerm;
  title: string;
  school: { name: string; city: string | null };
  year: string;
  student: { id: string; name: string; code: string; classLevel: string; section: string; dob: string | null };
  subjects: CardSubject[];
  coScholastic: { areas: string[]; scale: ScaleGrade[]; grades: Partial<Record<RecordTerm, Record<string, string>>> };
  attendance: Partial<Record<RecordTerm, { workingDays: number | null; daysPresent: number | null }>>;
  remark: string | null;
  issuedAt?: string;
}

export interface MyCard {
  id: string;
  title: string;
  year: string;
  issuedAt: string | null;
}
