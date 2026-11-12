"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * The product's data-table treatment (first drawn in admin/people's
 * roster), as small wrappers so every table reads the same: a rounded,
 * hairline-bordered frame that scrolls sideways on a phone instead of
 * squashing columns, an uppercase eyebrow header row, and quiet row hover.
 *
 * On a phone (below the sm breakpoint) a table with several columns cannot
 * show its values without a sideways scroll that hides most of them, so each
 * row is drawn as a small card instead: the header row is kept for screen
 * readers, and every cell shows its column name beside its value (copied from
 * the header row at runtime, so no table needs its own labels). Pass
 * `stack={false}` for a table of form inputs that must stay a grid.
 *
 * `busy` dims the body while the next server page loads -- the old rows
 * stay put rather than the table collapsing to a spinner and back.
 */
const STACKED =
  "max-sm:block max-sm:min-w-0 max-sm:[&_thead]:sr-only max-sm:[&_tbody]:block max-sm:[&_tr]:block max-sm:[&_tbody_tr]:px-4 max-sm:[&_tbody_tr]:py-3 " +
  "max-sm:[&_td]:flex max-sm:[&_td]:flex-wrap max-sm:[&_td]:items-baseline max-sm:[&_td]:justify-between max-sm:[&_td]:gap-x-4 max-sm:[&_td]:gap-y-1 max-sm:[&_td]:px-0 max-sm:[&_td]:py-1.5 max-sm:[&_td]:text-right " +
  "max-sm:[&_td[data-label]]:before:shrink-0 max-sm:[&_td[data-label]]:before:text-left max-sm:[&_td[data-label]]:before:text-[0.6875rem] max-sm:[&_td[data-label]]:before:font-bold max-sm:[&_td[data-label]]:before:uppercase max-sm:[&_td[data-label]]:before:tracking-eyebrow max-sm:[&_td[data-label]]:before:text-content-subtle max-sm:[&_td[data-label]]:before:content-[attr(data-label)]";

/** Copies each header cell's text onto the cells beneath it as data-label. */
function labelCells(table: HTMLTableElement) {
  const heads = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"));
  const names: string[] = [];
  for (const th of heads) {
    const text = (th.textContent ?? "").trim();
    for (let i = 0; i < Math.max(1, th.colSpan); i += 1) names.push(text);
  }
  for (const row of Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"))) {
    let col = 0;
    for (const cell of Array.from(row.cells)) {
      const name = names[col];
      if (name && cell.colSpan === 1 && !cell.hasAttribute("data-unlabelled")) {
        if (cell.getAttribute("data-label") !== name) cell.setAttribute("data-label", name);
      }
      col += Math.max(1, cell.colSpan);
    }
  }
}

export function Table({
  caption,
  minWidth = "44rem",
  busy = false,
  stack = true,
  className,
  children,
}: {
  caption: string;
  minWidth?: string;
  busy?: boolean;
  /** Draw each row as a card on a phone (default). Turn off for input grids. */
  stack?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLTableElement>(null);
  useEffect(() => {
    const table = ref.current;
    if (!stack || !table) return;
    labelCells(table);
    const watcher = new MutationObserver(() => labelCells(table));
    watcher.observe(table, { childList: true, subtree: true });
    return () => watcher.disconnect();
  }, [stack]);

  return (
    <div className={cn("rounded-2xl border border-line", stack ? "sm:overflow-x-auto" : "overflow-x-auto", className)}>
      <table
        ref={ref}
        aria-busy={busy || undefined}
        style={{ "--table-min": minWidth } as React.CSSProperties}
        className={cn(
          "w-full min-w-[var(--table-min)] border-collapse text-left text-[0.8125rem] transition-opacity duration-200",
          stack && STACKED,
          busy && "opacity-60",
        )}
      >
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

/** content-subtle on surface-muted: 6.0:1. */
export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="bg-surface-muted text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-subtle">
      <tr>{children}</tr>
    </thead>
  );
}

export function TH({
  children,
  className,
  align = "left",
}: {
  children?: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      scope="col"
      className={cn("whitespace-nowrap px-4 py-3", align === "right" && "text-right", align === "center" && "text-center", className)}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>;
}

export function TR({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  /** Whole-row click as a pointer convenience only. Every clickable row
   *  must also hold a real link or button in one of its cells -- that is
   *  the keyboard and screen-reader route. */
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        "bg-surface transition-colors hover:bg-surface-muted/60",
        onClick && "cursor-pointer",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function TD({
  children,
  className,
  align = "left",
}: {
  children?: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  return (
    <td className={cn("px-4 py-3 align-middle", align === "right" && "text-right", align === "center" && "text-center", className)}>
      {children}
    </td>
  );
}

/** Placeholder rows in the table's own shape for the very first load. */
export function TableSkeleton({ rows = 5, label }: { rows?: number; label: string }) {
  return (
    <div aria-busy="true" className="overflow-hidden rounded-2xl border border-line">
      <span className="sr-only" role="status">
        {label}
      </span>
      <div className="h-10 bg-surface-muted" />
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} aria-hidden className="flex items-center gap-3 border-t border-line px-4 py-3.5">
          <span className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-ink-100" />
          <span className="h-3 w-48 animate-pulse rounded-full bg-ink-100" />
          <span className="ml-auto h-3 w-24 animate-pulse rounded-full bg-ink-100" />
          <span className="hidden h-3 w-16 animate-pulse rounded-full bg-ink-100 sm:block" />
        </div>
      ))}
    </div>
  );
}
