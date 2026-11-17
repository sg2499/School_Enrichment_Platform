// A child's PDF on an answer (#237, 17 Nov 2026).
export type UploadRule = "REQUIRED" | "OPTIONAL" | "NONE";

export type AnswerAttachment = {
  id: string;
  filename: string;
  sizeBytes: number;
  pageCount: number;
  uploadedAt: string | null;
};
