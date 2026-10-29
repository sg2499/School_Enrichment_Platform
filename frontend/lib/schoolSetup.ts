/** School setup and sign-in slips (#210): the words and the sign-in file. */
import { PRODUCT_NAME } from "@/lib/brand";
import { csvCell } from "@/lib/csv";
import type { SetupCheck, SignInSlip } from "@/types/schoolSetup";

export const SLIPS_PER_PAGE = 8;

/** "Class 5 · Section A · Roll 3", or a teacher's sections. */
export function slipDetail(slip: SignInSlip): string {
  if (slip.role === "TEACHER") return slip.teaches.length ? `Teacher · ${slip.teaches.join(", ")}` : "Teacher";
  const parts = [`Class ${slip.className}`, `Section ${slip.section}`];
  if (slip.rollNumber) parts.push(`Roll ${slip.rollNumber}`);
  return parts.join(" · ");
}

/** The way in to choose on the sign-in page, in its own words. */
export function slipWayIn(slip: SignInSlip): string {
  return slip.role === "TEACHER" ? "Teacher" : "Student";
}

/** The sign-in details as a spreadsheet: built in the browser, never sent anywhere.
 *  The leading BOM makes Excel read non-ASCII names as UTF-8. */
export function slipsCsv(slips: SignInSlip[]): string {
  const lines = [
    "Full Name,Role,Class,Section,Roll Number,Code,First Password",
    ...slips.map((s) =>
      [
        csvCell(s.fullName),
        s.role === "TEACHER" ? "Teacher" : "Student",
        csvCell(s.className ?? ""),
        csvCell(s.section ?? ""),
        csvCell(s.rollNumber ?? ""),
        csvCell(s.code),
        csvCell(s.initialPassword, { exact: true }),
      ].join(","),
    ),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Slips in pages of eight, for printing. */
export function slipPages(slips: SignInSlip[]): SignInSlip[][] {
  const pages: SignInSlip[][] = [];
  for (let i = 0; i < slips.length; i += SLIPS_PER_PAGE) pages.push(slips.slice(i, i + SLIPS_PER_PAGE));
  return pages;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What importing the checked workbook will do, in one sentence. */
export function checkSummary(check: SetupCheck): string {
  const parts: string[] = [];
  if (check.newTeachers) parts.push(plural(check.newTeachers, "new teacher"));
  if (check.newStudents) parts.push(plural(check.newStudents, "new student"));
  if (check.newSectionsTaught) parts.push(plural(check.newSectionsTaught, "section to be taught", "sections to be taught"));
  const already = check.teachersAlreadyHere + check.studentsAlreadyHere;
  const tail = already ? ` ${plural(already, "person is", "people are")} already on ${PRODUCT_NAME} and will be left as they are.` : "";
  if (!parts.length) return `Nothing new to import.${tail}`;
  return `Ready to import: ${parts.join(", ")}.${tail}`;
}
