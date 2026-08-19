"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ModalSize = "lg" | "xl" | "full" | "fullscreen";

const SIZES: Record<Exclude<ModalSize, "fullscreen">, string> = {
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  // Near-fullscreen -- generous margin, still visibly a floating dialog.
  full: "max-w-[min(96vw,88rem)]",
};

/**
 * A dedicated, full-attention window for reviewing something that doesn't
 * fit in a shared page column (Shailesh, 18 Aug 2026: the old inline
 * chapter-detail panel was "very small ... clumsy" for reviewing questions
 * -- this replaces it with a proper modal that gets the whole viewport's
 * width and height to work with).
 *
 * Body scroll is locked while open, Escape closes it, and clicking the
 * backdrop closes it -- the same conventions as RoleShell's mobile nav
 * drawer, just centered instead of a side sheet.
 *
 * Rendered via a portal straight into document.body (18 Aug 2026, fixing a
 * real bug Shailesh caught from a screenshot: a page-level ancestor with
 * its own z-index -- RoleShell's `<main className="relative z-10">` --
 * creates a stacking context, which trapped this modal's z-50 *inside*
 * that context no matter how high the number, so it painted BEHIND
 * RoleShell's z-40 sidebar instead of above it. A portal escapes every
 * ancestor's stacking context entirely, which is the actual fix -- raising
 * this component's z-index alone could never have solved it).
 *
 * size="fullscreen" (18 Aug 2026, Shailesh: the review window should feel
 * "full screen ... professional ... world class", not just a large floating
 * card) is a distinct mode from size="full" -- it drops the outer margin,
 * backdrop, and rounded corners entirely and occupies the exact viewport
 * edge-to-edge, the same as a native full-screen app window rather than a
 * dialog sitting on top of one.
 */
export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  meta,
  size = "xl",
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  meta?: React.ReactNode;
  size?: ModalSize;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const isFullscreen = size === "fullscreen";

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[100] flex",
        isFullscreen ? "items-stretch justify-stretch" : "items-center justify-center p-3 sm:p-6",
      )}
    >
      {!isFullscreen ? (
        <button
          type="button"
          aria-label="Close dialog"
          onClick={onClose}
          className="absolute inset-0 bg-brand-950/55 backdrop-blur-sm animate-fade-in"
        />
      ) : null}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative flex w-full flex-col overflow-hidden bg-surface animate-scale-in",
          isFullscreen
            ? "h-full max-h-none rounded-none border-0 shadow-none"
            : cn("max-h-[92vh] rounded-4xl border border-line shadow-panel", SIZES[size]),
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-6 py-5 sm:px-8 sm:py-6">
          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-xs font-semibold uppercase tracking-eyebrow text-content-subtle">{eyebrow}</p>
            ) : null}
            <h2 className="mt-0.5 truncate font-display text-lg font-semibold text-content sm:text-xl">{title}</h2>
            {meta ? <div className="mt-2">{meta}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-line-strong bg-surface text-content-muted transition hover:border-brand-300 hover:text-content-brand"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-8 sm:py-7">{children}</div>

        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line px-6 py-4 sm:px-8">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
