"use client";

/**
 * Small pieces shared by the report card screens (#188): downloading a PDF,
 * the issue status badge, and the year (and, for a Super Admin, school)
 * that a page is about.
 */
import { useState } from "react";
import { FileDown } from "lucide-react";
import { api, describeApiError } from "@/lib/api";
import { ISSUE_STATUS_LABEL } from "@/lib/reportCards";
import { Badge } from "@/components/ui/Badge";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import type { IssueStatus } from "@/types/reportCards";

/** Downloads a PDF the server makes (signed-in request), under `name`. */
export async function downloadPdf(path: string, name: string): Promise<void> {
  const { data } = await api.get<Blob>(path, { responseType: "blob" });
  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A button that downloads a PDF and says so if it fails. */
export function PdfButton({
  path,
  name,
  label = "Download PDF",
  variant = "secondary",
  size = "sm",
}: {
  path: string;
  name: string;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        variant={variant}
        size={size}
        leadingIcon={<FileDown className="h-4 w-4" aria-hidden="true" />}
        loading={busy}
        loadingLabel="Preparing"
        onClick={async () => {
          setBusy(true);
          setProblem(null);
          try {
            await downloadPdf(path, name);
          } catch (err) {
            setProblem(describeApiError(err, "download the report card").message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {label}
      </Button>
      {problem ? (
        <span role="alert" className="text-xs font-semibold text-coral-700">
          {problem}
        </span>
      ) : null}
    </span>
  );
}

export function IssueBadge({ status, onDark = false }: { status: IssueStatus | null; onDark?: boolean }) {
  if (status === null) {
    return (
      <Badge tone="neutral" onDark={onDark}>
        Not Issued
      </Badge>
    );
  }
  return (
    <Badge tone={status === "ISSUED" ? "success" : "warning"} dot onDark={onDark}>
      {ISSUE_STATUS_LABEL[status]}
    </Badge>
  );
}

/** "23 Oct 2026" in India. */
export function dayText(iso: string | null | undefined): string {
  if (!iso) return "";
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return "";
  return moment.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}
