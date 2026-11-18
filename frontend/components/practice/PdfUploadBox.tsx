"use client";

/**
 * "Attach your work (PDF)" under a question that asks for a drawing or
 * working on paper (#237, 17 Nov 2026), and the button that opens an attached
 * PDF for a teacher, an admin or the child themselves. Shared by Daily Practice
 * and the mock papers.
 *
 * The box is only drawn when the server says the question takes a PDF
 * (uploadRule REQUIRED or OPTIONAL); it never blocks handing in: a missing
 * file is a note on the question and a line by the Submit button, because a
 * child with no scanner at hand must still be able to hand in.
 */
import { useRef, useState } from "react";
import { ExternalLink, FileText, Loader2, Paperclip, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { api, describeApiError } from "@/lib/api";
import { PDF_LIMITS_NOTE, fileSummary, pdfFileProblem, ruleHeading, ruleHint } from "@/lib/attachments";
import type { AnswerAttachment, UploadRule } from "@/types/attachments";

/** Opens a stored PDF in a new tab. The file is fetched with the person's own
 *  session (never a public link) and shown from a temporary address. */
export function OpenPdfButton({ attachment, label = "Open PDF", size = "sm" }: { attachment: AnswerAttachment; label?: string; size?: "sm" | "md" }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setProblem(null);
    // Opened first, filled after the download: a window opened after an
    // await is blocked as a pop-up by most browsers.
    const tab = window.open("about:blank", "_blank");
    try {
      const { data } = await api.get<Blob>(`/attachments/${attachment.id}`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      if (tab) {
        tab.location.href = url;
      } else {
        window.location.href = url;
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    } catch (error) {
      tab?.close();
      setProblem(describeApiError(error, "open this PDF").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button type="button" variant="secondary" size={size} loading={busy} leadingIcon={<ExternalLink className="h-4 w-4" />} onClick={open}>
        {label}
      </Button>
      {problem ? (
        <span role="alert" className="text-xs font-medium text-coral-700">
          {problem}
        </span>
      ) : null}
    </span>
  );
}

/** What a teacher or the child reads where a PDF may be: the file and a button
 *  to open it, or a plain note when one was asked for and none came. */
export function AttachmentLine({ rule, attachment }: { rule?: UploadRule; attachment?: AnswerAttachment | null }) {
  if (attachment) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface-sunken/60 px-4 py-3">
        <FileText className="h-4 w-4 shrink-0 text-brand-700" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-content">{attachment.filename}</p>
          <p className="text-xs text-content-subtle">{fileSummary(attachment)}</p>
        </div>
        <OpenPdfButton attachment={attachment} />
      </div>
    );
  }
  if (rule === "REQUIRED") {
    return <p className="text-sm text-content-muted">This question asked for a PDF of the work, and none was attached.</p>;
  }
  return null;
}

export function PdfUploadBox({
  questionId,
  rule,
  attachment,
  disabled,
  onUpload,
  onRemove,
}: {
  questionId: string;
  rule: UploadRule;
  attachment: AnswerAttachment | null;
  disabled: boolean;
  onUpload: (file: File) => Promise<AnswerAttachment>;
  onRemove: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const hintId = `pdf-hint-${questionId}`;

  async function choose(file: File | undefined) {
    if (!file) return;
    const refused = pdfFileProblem(file);
    if (refused) {
      setProblem(refused);
      return;
    }
    setProblem(null);
    setBusy("upload");
    try {
      await onUpload(file);
    } catch (error) {
      setProblem(describeApiError(error, "attach your PDF").message);
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setProblem(null);
    setBusy("remove");
    try {
      await onRemove();
    } catch (error) {
      setProblem(describeApiError(error, "remove your PDF").message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-content">{ruleHeading(rule)}</p>
        {rule === "REQUIRED" && attachment ? (
          <Badge tone="success" size="sm">
            Attached
          </Badge>
        ) : rule === "REQUIRED" ? (
          <Badge tone="warning" size="sm">
            Needed for full marks
          </Badge>
        ) : (
          <span className="text-sm font-normal text-content-subtle">(optional)</span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => choose(event.target.files?.[0])}
      />
      {attachment ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface-sunken/60 px-4 py-3">
          <FileText className="h-4 w-4 shrink-0 text-brand-700" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-content">{attachment.filename}</p>
            <p className="text-xs text-content-subtle">{fileSummary(attachment)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <OpenPdfButton attachment={attachment} />
            {!disabled ? (
              <>
                <Button type="button" variant="secondary" size="sm" loading={busy === "upload"} leadingIcon={<RefreshCw className="h-4 w-4" />} onClick={() => inputRef.current?.click()}>
                  Replace
                </Button>
                <Button type="button" variant="ghost" size="sm" loading={busy === "remove"} leadingIcon={<Trash2 className="h-4 w-4" />} onClick={remove}>
                  Remove
                </Button>
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <div>
          <Button type="button" variant="secondary" size="sm" disabled={disabled} loading={busy === "upload"} leadingIcon={busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />} onClick={() => inputRef.current?.click()} aria-describedby={hintId}>
            {busy === "upload" ? "Attaching…" : "Choose a PDF"}
          </Button>
        </div>
      )}
      <p id={hintId} className="text-xs leading-relaxed text-content-subtle">
        {ruleHint(rule)} {PDF_LIMITS_NOTE}
      </p>
      {problem ? (
        <p role="alert" className="text-sm font-medium text-coral-700">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
