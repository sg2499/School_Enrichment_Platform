"use client";

/**
 * Small pieces shared by the Assessment Scheme screens (#165): the status
 * badge, the list of a refusal's reasons, and how a scheme is named.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { describeApiError } from "@/lib/api";
import { errorDetail } from "@/lib/errors";
import { STATUS_LABEL } from "@/lib/assessment";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { SchemeStatus, SchemeSummary } from "@/types/assessment";

const STATUS_TONE: Record<SchemeStatus, BadgeTone> = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  SUPERSEDED: "warning",
};

export function SchemeStatusBadge({ status, onDark = false }: { status: SchemeStatus; onDark?: boolean }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot onDark={onDark}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/** "Class 5 · CBSE Class 5 Mathematics · 2026-27", leaving out what isn't set. */
export function schemeScope(scheme: SchemeSummary): string {
  if (scheme.isTemplate) return "Template";
  return [scheme.classLevel?.displayName, scheme.boardCourse?.displayName, scheme.academicYear?.label]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Why a save or publish was refused, as the sentences to list. The scheme
 * API sends every reason at once (`details.problems`, written for the
 * person reading the editor); any other failure is one sentence from
 * lib/errors.ts.
 */
export function refusalReasons(error: unknown, action: string): string[] {
  const problems = errorDetail(error, "problems");
  if (Array.isArray(problems) && problems.length > 0 && problems.every((p) => typeof p === "string")) {
    return problems as string[];
  }
  return [describeApiError(error, action).message];
}

/** A short list of reasons, in a coral box. */
export function ReasonsBox({ title, reasons }: { title: string; reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <div role="alert" className="rounded-2xl border border-coral-200 bg-coral-50 p-4 text-sm text-coral-800">
      <p className="flex items-center gap-2 font-bold">
        <AlertCircle className="h-4 w-4 shrink-0 text-coral-600" aria-hidden="true" />
        {title}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-6">
        {reasons.map((reason, index) => (
          <li key={index}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}

/** Saves a text file the browser builds (the results spreadsheet). */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file name from a scheme's name: letters, numbers and dashes only. */
export function fileNameFor(...parts: Array<string | null | undefined>): string {
  return parts
    .filter(Boolean)
    .join(" ")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Keeps unsaved marks or edits from being dropped without a word. While
 * `dirty`, leaving the page (reload, closing the tab) asks the browser's
 * own question, and following a link inside the app -- the tabs, the back
 * link, the side menu -- asks first in a dialog. `confirm(action)` runs
 * `action` straight away when nothing is unsaved, and after a "Leave" when
 * something is (for moves that aren't links, such as choosing a section).
 */
export function useLeaveGuard(dirty: boolean) {
  const router = useRouter();
  const [pending, setPending] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    // Capture phase on the document runs before the app's own link
    // handling, so stopping it here stops the move.
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const to = new URL(link.href, window.location.href);
      if (to.origin !== window.location.origin) return;
      if (to.pathname === window.location.pathname && to.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      setPending(() => () => router.push(to.pathname + to.search + to.hash));
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, router]);

  const confirm = useCallback(
    (action: () => void) => {
      if (dirty) setPending(() => action);
      else action();
    },
    [dirty],
  );

  const dialog = (
    <Modal
      open={pending !== null}
      onClose={() => setPending(null)}
      title="Leave Without Saving?"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => setPending(null)}>
            Stay
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const action = pending;
              setPending(null);
              action?.();
            }}
          >
            Leave
          </Button>
        </>
      }
    >
      <p className="text-sm text-content">Your changes here haven&apos;t been saved. If you leave now, they are lost.</p>
    </Modal>
  );

  return { confirm, dialog };
}
