/** School setup in one workbook, and sign-in slips (#210). */

export interface SetupProblem {
  sheet: "Teachers" | "Students";
  row: number;
  message: string;
}

export interface SetupCheck {
  ok: boolean;
  problems: SetupProblem[];
  newTeachers: number;
  teachersAlreadyHere: number;
  newStudents: number;
  studentsAlreadyHere: number;
  newSectionsTaught: number;
  sections: string[];
}

/** One new account's sign-in details, shown once. */
export interface SignInSlip {
  role: "TEACHER" | "STUDENT";
  fullName: string;
  code: string;
  initialPassword: string;
  className: string | null;
  section: string | null;
  rollNumber: string | null;
  /** A teacher's sections and subjects, e.g. "5A Mathematics". */
  teaches: string[];
}

export interface SetupImport extends SetupCheck {
  schoolName: string;
  created: SignInSlip[];
}

export interface SectionSummary {
  className: string;
  section: string;
  students: number;
  awaitingFirstSignIn: number;
  teachers: { fullName: string; subject: string }[];
}

export interface SectionsView {
  schoolName: string;
  sections: SectionSummary[];
}

export interface SectionSlips {
  schoolName: string;
  slips: SignInSlip[];
  alreadySignedIn: number;
}
