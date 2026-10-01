import { cn } from "@/lib/utils";

/**
 * The product's data-table treatment (first drawn in admin/people's
 * roster), as small wrappers so every table reads the same: a rounded,
 * hairline-bordered frame that scrolls sideways on a phone instead of
 * squashing columns, an uppercase eyebrow header row, and quiet row hover.
 *
 * `busy` dims the body while the next server page loads -- the old rows
 * stay put rather than the table collapsing to a spinner and back.
 */
export function Table({
  caption,
  minWidth = "44rem",
  busy = false,
  className,
  children,
}: {
  caption: string;
  minWidth?: string;
  busy?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("overflow-x-auto rounded-2xl border border-line", className)}>
      <table
        aria-busy={busy || undefined}
        style={{ minWidth }}
        className={cn(
          "w-full border-collapse text-left text-[0.8125rem] transition-opacity duration-200",
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
