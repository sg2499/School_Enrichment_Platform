"use client";

import { cn } from "@/lib/utils";

export type FilterChipOption<V extends string> = { value: V; label: string; count?: number | null };

/**
 * A row of pressed/unpressed filter buttons with optional counts -- the
 * admin/people status filter, made reusable. A labelled group of
 * aria-pressed buttons rather than a radio group or tablist: plain Tab
 * stops, nothing to explain to a screen reader. brand-700 on surface-brand
 * (pressed) 9.3:1; content-muted on white 8.7:1.
 */
export function FilterChips<V extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: FilterChipOption<V>[];
  value: V;
  onChange: (value: V) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[0.75rem] font-semibold transition",
              pressed
                ? "border border-brand-300 bg-surface-brand text-content-brand"
                : "border border-line-strong bg-surface text-content-muted hover:border-brand-300",
            )}
          >
            {option.label}
            {option.count !== undefined && option.count !== null ? (
              <span className={cn("tabular", pressed ? "text-brand-600" : "text-content-subtle")}>{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
