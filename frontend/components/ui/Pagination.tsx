"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * Footer for a server-paginated table: "Showing 26–50 of 312" plus
 * Previous / Page x of y / Next. Purely presentational -- the caller owns
 * the page number (the Practice Tracker keeps it in the URL) and re-fetches.
 *
 * Same look as admin/people's client-side roster footer, so the two kinds
 * of table read as one family; the difference is only where the rows come
 * from.
 */
export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  noun = "result",
  nounPlural,
  label = "Pages",
  busy = false,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  noun?: string;
  nounPlural?: string;
  label?: string;
  busy?: boolean;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const many = nounPlural ?? `${noun}s`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <p className="text-[0.75rem] text-content-subtle tabular" aria-live="polite">
        {totalPages > 1 ? (
          <>
            Showing {first}&ndash;{last} of {total}
          </>
        ) : (
          <>
            {total} {total === 1 ? noun : many}
          </>
        )}
      </p>
      {totalPages > 1 ? (
        <nav aria-label={label} className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={page <= 1 || busy}
            onClick={() => onPageChange(page - 1)}
            leadingIcon={<ChevronLeft className="h-3.5 w-3.5" />}
          >
            Previous
          </Button>
          <span className="text-[0.75rem] font-semibold text-content-muted tabular">
            Page {page} of {totalPages}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={page >= totalPages || busy}
            onClick={() => onPageChange(page + 1)}
            trailingIcon={<ChevronRight className="h-3.5 w-3.5" />}
          >
            Next
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
