/**
 * The Assessment Scheme API's shapes (#165; backend/app/api/routes_assessment.py).
 * Decimal values (marks, weights, percentages) arrive as exact decimal text
 * ("17.5", "40"), never floats.
 */

export type SchemeStatus = "DRAFT" | "PUBLISHED" | "SUPERSEDED";
export type AttemptRule = "BEST" | "FIRST" | "LATEST";
export type ComponentKind =
  | "PERIODIC_TEST"
  | "HALF_YEARLY"
  | "ANNUAL"
  | "PRACTICAL"
  | "PROJECT"
  | "NOTEBOOK"
  | "SUBJECT_ENRICHMENT"
  | "PLATFORM_PRACTICE"
  | "OTHER";
export type ComponentTerm = "TERM_1" | "TERM_2" | "WHOLE_YEAR";
export type ComponentSource = "ENTERED" | "PLATFORM";
export type MarkStatus = "ENTERED" | "ABSENT" | "EXEMPT";
/** A component's state in one student's result. */
export type ComponentResultStatus = "MARKS" | "ABSENT" | "EXEMPT" | "MISSING";

export interface AcademicYear {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

export interface SchemeSummary {
  id: string;
  lineageId: string;
  version: number;
  status: SchemeStatus;
  name: string;
  description: string | null;
  isTemplate: boolean;
  schoolId: string | null;
  academicYear: AcademicYear | null;
  classLevel: { id: string; displayName: string } | null;
  boardCourse: { id: string; displayName: string } | null;
  publishedAt: string | null;
  updatedAt: string | null;
}

export interface SchemeComponent {
  id: string;
  componentKey: string;
  name: string;
  kind: ComponentKind;
  term: ComponentTerm;
  source: ComponentSource;
  maxMarks: string;
  weightPercent: string;
  minPassPercent: string | null;
  activities: { id: string; title: string | null }[];
}

export interface GradeBand {
  label: string;
  minPercent: string;
}

export interface SchemeDetail extends SchemeSummary {
  attemptRule: AttemptRule;
  passPercent: string;
  passLabel: string;
  failLabel: string;
  decimalPlaces: number;
  components: SchemeComponent[];
  gradeBands: GradeBand[];
  canManage: boolean;
  publishProblems: string[];
  newerVersion: { id: string; version: number; status: SchemeStatus } | null;
}

export interface LinkableActivity {
  id: string;
  title: string;
  activityType: string;
  chapter: { id: string; title: string; chapterNo: number };
}

export interface SchemeSection {
  section: string;
  canEnterMarks: boolean;
}

export interface MarksSheetRow {
  studentId: string;
  studentCode: string;
  studentName: string | null;
  status: MarkStatus | null;
  marks: string | null;
  updatedAt: string | null;
}

export interface MarksSheet {
  component: { id: string; name: string; source: ComponentSource; maxMarks: string };
  canEnterMarks: boolean;
  rows: MarksSheetRow[];
}

export interface ResultComponentCell {
  componentId: string;
  status: ComponentResultStatus;
  marks: string | null;
  percent: string | null;
  pendingReview: boolean;
  meetsOwnMinimum: boolean | null;
}

export interface ResultRow {
  studentId: string;
  studentCode: string;
  studentName: string | null;
  components: ResultComponentCell[];
  result: string | null;
  unrounded: string | null;
  grade: string | null;
  outcome: "PASS" | "BELOW_PASS" | null;
  outcomeLabel: string | null;
  provisional: boolean;
  notes: string[];
}

export interface SchemeResults {
  scheme: SchemeSummary;
  components: { id: string; name: string; maxMarks: string; weightPercent: string; source: ComponentSource }[];
  rows: ResultRow[];
}
