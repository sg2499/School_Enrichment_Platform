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

// --- step 4: sitting the paper ---------------------------------------------------------

export interface PaperBrief {
  id: string;
  title: string;
  status: PaperStatus;
  totalMarks: number;
  timeMinutes: number;
  readingMinutes: number;
  navigation: "FREE" | "FORWARD";
  sections: { name: string; marks: number; count: number; choices: number }[];
  opensAt: string;
  closesAt: string;
  // #208: the right answers and solutions show once the paper has closed.
  solutionsOpen: boolean;
}

export interface MyPaper extends PaperBrief {
  sitting: "IN_PROGRESS" | "SUBMITTED" | null;
  // From hand-in; with `waiting` written answers still to be marked, so far.
  score: number | null;
  waiting: number;
}

export interface SitPart {
  id: string;
  label: string | null;
  text: string;
  questionType: string;
  optionA: string | null;
  optionB: string | null;
  optionC: string | null;
  optionD: string | null;
  marks: number;
  answerInstruction: string | null;
  answerNeedsUnit: boolean;
  acceptsWorking: boolean;
  answerBlanks: number;
  answerBlankLabels: string[] | null;
  response: string | null;
  working: string | null;
}

export interface SitPlace {
  number: number;
  marks: number;
  choiceGroup: number | null;
  chosenSlotId: string | null;
  halves: { slotId: string; stimulus: string | null; parts: SitPart[] }[];
}

export interface SitSection {
  index: number;
  name: string;
  marks: number;
  count: number;
  choices: number;
  places: SitPlace[];
}

export interface Sitting {
  status: "IN_PROGRESS" | "SUBMITTED";
  phase: "READING" | "WRITING" | "HANDED_IN";
  startedAt: string;
  writingStartsAt: string;
  deadlineAt: string;
  submittedAt: string | null;
  submittedHow: "STUDENT" | "TIME" | "CLOSED" | null;
  sectionIndex: number;
  serverNow: string;
}

export interface ResultPart extends SitPart {
  score: number | null;
  maxScore: number;
  correctAnswer: string | null;
  acceptedVariants: string | null;
  explanation: string | null;
  markingSteps: string | null;
  note: string | null;
}

export interface PaperResult {
  // Final once nothing waits for a teacher; until then null, with scoreSoFar.
  score: number | null;
  scoreSoFar: number;
  waiting: number;
  solutionsOpen: boolean;
  solutionsAt: string;
  maxScore: number;
  sections: {
    name: string;
    marks: number;
    maxMarks: number;
    places: { number: number; marks: number; choice: boolean; stimulus: string | null; parts: ResultPart[] }[];
  }[];
}

export interface SittingView {
  paper: PaperBrief;
  sitting: Sitting | null;
  sections: SitSection[];
  result?: PaperResult;
}

export interface ResultsGrid {
  canChange: boolean;
  shuffled: boolean;
  status: PaperStatus;
  columns: { key: string; number: number; sectionIndex: number; marks: number; choice: boolean }[];
  sections: { name: string; marks: number }[];
  totalMarks: number;
  students: {
    studentId: string;
    name: string;
    studentCode: string;
    state: "NOT_STARTED" | "IN_PROGRESS" | "TO_MARK" | "MARKED";
    score: number | null;
    autoScore: number | null;
    submittedHow: string | null;
    cells: Record<string, { score: number; max: number; waiting: boolean; blank: boolean }>;
    sectionMarks: number[];
  }[];
  handedIn: number;
  toMark: number;
  inProgress: number;
  solutionsOpen: boolean;
  closesAt: string;
}

export interface MarkingView {
  canMark: boolean;
  shuffled: boolean;
  toMark: number;
  questions: {
    key: string;
    number: number | null;
    sectionIndex: number;
    marks: number;
    answers: {
      answerId: string;
      student: string;
      studentCode: string;
      question: string;
      response: string | null;
      working: string | null;
      autoScore: number | null;
      maxScore: number;
      score: number | null;
      modelAnswer: string | null;
      markingSteps: string | null;
      markedAt: string | null;
    }[];
  }[];
}
