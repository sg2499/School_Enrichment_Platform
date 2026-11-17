/**
 * A child's PDF on an answer (#237, 17 Nov 2026): the checks made before a
 * file leaves the device and the words used about it. The server checks again
 * (a real PDF, 15 pages, no scripts); these checks only save the child a wait.
 * Pure, so tests/unit/attachments.test.mjs covers them.
 */
import type { AnswerAttachment, UploadRule } from "@/types/attachments";

export const PDF_MAX_BYTES = 20 * 1024 * 1024;
export const PDF_MAX_PAGES = 15;
export const PDF_LIMITS_NOTE = "A PDF, up to 20 MB and 15 pages. A scanner app on a phone makes one in a minute.";

/** Why a chosen file can't be attached, or null when it can. */
export function pdfFileProblem(file: { name: string; type: string; size: number }): string | null {
  const looksLikePdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!looksLikePdf) return "Please attach a PDF. A photo can be turned into a PDF with a scanner app.";
  if (file.size <= 0) return "That file is empty. Please choose your PDF again.";
  if (file.size > PDF_MAX_BYTES) return "That file is too big. A PDF can be up to 20 MB.";
  return null;
}

export function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileSummary(attachment: Pick<AnswerAttachment, "pageCount" | "sizeBytes">): string {
  const pages = `${attachment.pageCount} page${attachment.pageCount === 1 ? "" : "s"}`;
  return `${pages}, ${sizeText(attachment.sizeBytes)}`;
}

/** What the box says it is for. */
export function ruleHeading(rule: UploadRule): string {
  return rule === "REQUIRED" ? "Attach your work (PDF)" : "Attach your working (PDF)";
}

export function ruleHint(rule: UploadRule): string {
  return rule === "REQUIRED"
    ? "This question asks for a drawing or working on paper. Attach it as a PDF to earn full marks."
    : "You can attach your handwritten working. A typed answer is enough on its own.";
}

/** The questions that ask for a PDF and have none yet (a note, never a block). */
export function missingRequired(questions: { uploadRule?: UploadRule; attachment?: unknown | null }[]): number {
  return questions.filter((q) => q.uploadRule === "REQUIRED" && !q.attachment).length;
}

export function missingRequiredSentence(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "1 question asks for a PDF and has none attached yet."
    : `${count} questions ask for a PDF and have none attached yet.`;
}
