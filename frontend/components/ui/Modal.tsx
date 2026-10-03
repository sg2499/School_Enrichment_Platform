"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ModalSize = "sm" | "lg" | "xl" | "full" | "fullscreen";

const SIZES: Record<Exclude<ModalSize, "fullscreen">, string> = {
  // A question and two buttons ("Reset this password?") -- anything wider
  // makes a one-line decision look like a form.
  sm: "max-w-md",
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
 *
 * Focus (30 Sep 2026): opening moves keyboard focus into the dialog, Tab
 * and Shift+Tab cycle inside it rather than wandering into the page hidden
 * behind the backdrop, and closing hands focus back to whatever opened it.
 * The dialog is also named by its own title (aria-labelledby), so a screen
 * reader announces "Chapter review, dialog" instead of just "dialog". None
 * of this changes the props -- both callers get it for free.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Latest onClose in a ref, so the effect below depends on `open` alone.
  // Callers pass inline arrows (teacher/assignments does), which are a new
  // function every render -- with onClose in the dependency list, the
  // focus-on-open step would re-run and yank focus back to the dialog
  // frame on every keystroke typed inside it.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // After the portal has painted. The frame itself (tabIndex -1) takes
    // focus rather than the first control: in a long review dialog the
    // first control is usually the close button, and landing a keyboard
    // user on "Close" is an invitation to dismiss by accident.
    const frame = window.requestAnimationFrame(() => {
      const root = dialogRef.current;
      if (root && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      // offsetParent is null for anything display:none, so hidden controls
      // are skipped rather than becoming invisible tab stops.
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      // Only if it's still in the document -- the trigger may have been a
      // row that the action inside the dialog removed.
      if (returnFocusTo && returnFocusTo.isConnected) returnFocusTo.focus({ preventScroll: true });
    };
  }, [open]);

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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          // outline-none on the frame only: it receives programmatic focus
          // so Tab starts inside, but a ring around the whole dialog would
          // read as an error state. Every control inside keeps its ring.
          "relative flex w-full flex-col overflow-hidden bg-surface outline-none animate-dialog-in",
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
            <h2 id={titleId} className="mt-0.5 truncate font-display text-lg font-semibold text-content sm:text-xl">
              {title}
            </h2>
            {meta ? <div className="mt-2">{meta}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="group/close inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-line-strong bg-surface text-content-muted transition duration-200 ease-spring hover:border-brand-300 hover:bg-surface-brand hover:text-content-brand active:scale-95"
          >
            {/* The glyph turns a quarter on hover -- an X is symmetric, so it
                lands looking unchanged; only the motion says "this closes". */}
            <X className="h-4 w-4 transition-transform duration-300 ease-spring group-hover/close:rotate-90" aria-hidden />
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
