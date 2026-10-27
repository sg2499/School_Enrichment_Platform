/** Mock papers (#166 step 3): what /api/mock-papers sends and takes. */

export type QuestionKind = "ANY" | "CHOICE" | "NUMBER" | "WRITTEN" | "CASE_STUDY";
export type PaperStatus = "DRAFT" | "SCHEDULED" | "OPEN" | "CLOSED" | "WITHDRAWN";
export type Difficulty = "easy" | "medium" | "hard";

export interface FormatSection {
  name: string;
  marks: number;
  count: number;
  choices: number;
  kind: QuestionKind;
}

export interface PaperFormat {
  name: string;
  sections: FormatSection[];
  timeMinutes: number;
  readingMinutes: number;
  difficulty: Record<Difficulty, number> | null;
  applicationMin: number | null;
  shuffle: boolean;
  navigation: "FREE" | "FORWARD";
  totalMarks?: number;
}

export interface SavedFormat extends PaperFormat {
  id: string;
  owner: "STARTING_POINT" | "SCHOOL" | "MINE";
  canEdit: boolean;
}

export interface PaperSection {
  key: string;
  classLevelId: string;
  classLevelCode: string | null;
  section: string;
  boardCourseId: string;
  boardCourseName: string | null;
  isCurrent: boolean;
  canChange: boolean;
}

export interface PaperChapter {
  id: string;
  chapterNo: number;
  title: string;
  approvedPatterns: number;
}

export interface SupplyLine {
  section: number;
  name: string;
  places: number;
  filled: number;
  patterns: number;
  enough: boolean;
}

export interface SupplyCheck {
  problems: string[];
  sections: SupplyLine[];
  totalMarks: number | null;
}

export interface PaperSummary {
  id: string;
  title: string;
  status: PaperStatus;
  scope: string;
  classLevel: string | null;
  classLevelCode: string | null;
  section: string;
  formatName: string;
  totalMarks: number;
  timeMinutes: number;
  readingMinutes: number;
  opensAt: string;
  closesAt: string;
  createdBy: string | null;
  approvedAt: string | null;
  versions: number;
  withdrawReason: string | null;
}

export interface SampleQuestion {
  text: string;
  questionType: string;
  marks: number;
  options: { letter: string; text: string }[] | null;
  answer: string;
  acceptedVariants: string | null;
  answerUnit: string | null;
  markingSteps: string | null;
  explanation: string | null;
}

export interface PaperSlot {
  slotId: string;
  position: number;
  marks: number;
  kind: QuestionKind;
  choiceGroup: number | null;
  alternative: boolean;
  pattern: {
    id: string;
    code: string;
    difficulty: Difficulty;
    application: boolean;
    chapterNo: number | null;
    skill: string | null;
  } | null;
  problem: string | null;
  sample: { stimulus: string | null; questions: SampleQuestion[] } | null;
}

export interface PaperCheck {
  key: string;
  label: string;
  ok: boolean;
  blocking: boolean;
  detail: string;
}

export interface PaperDetail extends PaperSummary {
  canChange: boolean;
  format: PaperFormat;
  chapters: { id: string; chapterNo: number; title: string }[];
  sections: (FormatSection & { index: number; kindLabel: string; slots: PaperSlot[] })[];
  checks: {
    items: PaperCheck[];
    marks: number;
    totalMarks: number;
    mix: Record<Difficulty, number>;
    applicationPercent: number;
    canApprove: boolean;
  };
  supply?: SupplyLine[];
}
