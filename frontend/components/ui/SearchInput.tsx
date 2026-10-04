"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact search box for a table toolbar (admin/people's roster search,
 * made reusable). Debounced: `onSearch` fires once typing pauses, not per
 * keystroke -- each call is a server round-trip on the Practice Tracker's
 * paginated lists. Escape clears.
 *
 * `value` is the committed search (e.g. read from the URL); the box keeps
 * its own draft while typing and re-syncs if `value` changes from outside
 * (Back button, "Clear Filters").
 */
export function SearchInput({
  value,
  onSearch,
  label,
  placeholder,
  delayMs = 350,
  className,
}: {
  value: string;
  onSearch: (value: string) => void;
  label: string;
  placeholder?: string;
  delayMs?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;
  const committed = useRef(value);

  useEffect(() => {
    committed.current = value;
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (draft === committed.current) return;
    const timer = window.setTimeout(() => {
      committed.current = draft;
      onSearchRef.current(draft.trim());
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [draft, delayMs]);

  return (
    <div className={cn("relative min-w-[14rem] flex-1", className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint"
      />
      <input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && draft) {
            event.preventDefault();
            setDraft("");
          }
        }}
        aria-label={label}
        placeholder={placeholder ?? label}
        className="h-10 w-full rounded-xl border border-line-field bg-surface pl-10 pr-10 text-[0.875rem] text-content shadow-xs outline-none transition placeholder:text-content-faint hover:border-ink-500 focus:border-brand-500 focus:shadow-focus [&::-webkit-search-cancel-button]:hidden"
      />
      {draft ? (
        <button
          type="button"
          onClick={() => setDraft("")}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-content-subtle transition hover:bg-surface-muted hover:text-content"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
