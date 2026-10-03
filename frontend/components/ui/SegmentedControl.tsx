"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

export interface Segment<K extends string> {
  key: K;
  label: string;
  icon?: React.ReactNode;
}

/**
 * One choice out of a few, shown side by side with a thumb that slides to
 * the chosen one (3 Oct 2026, for the sign-in page's "Student / Teacher /
 * Admin").
 *
 * A radio group, not tabs: choosing changes how the same form speaks, it
 * does not swap one panel for another. So it carries radiogroup semantics
 * and behaves like one -- Tab moves into the group and out of it as a
 * single stop, the arrow keys move the choice, and a screen reader hears
 * "Student, radio button, 1 of 3, selected".
 *
 * For a page's own sub-navigation (each choice a URL) use SubTabs instead.
 */
export function SegmentedControl<K extends string>({
  label,
  segments,
  value,
  onChange,
  disabled = false,
  className,
}: {
  /** What is being chosen, for assistive tech: "Who is signing in". */
  label: string;
  segments: Segment<K>[];
  value: K;
  onChange: (key: K) => void;
  disabled?: boolean;
  className?: string;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(
    0,
    segments.findIndex((segment) => segment.key === value),
  );

  function move(to: number) {
    const index = (to + segments.length) % segments.length;
    onChange(segments[index].key);
    // In a radio group, moving with the arrows moves focus with the choice.
    buttons.current[index]?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      move(index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      move(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      move(0);
    } else if (event.key === "End") {
      event.preventDefault();
      move(segments.length - 1);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn("relative grid rounded-2xl border border-line bg-surface-sunken p-1", className)}
      style={{ gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))` }}
    >
      {/* The thumb. One element that slides, rather than a background on
          the selected button: the movement is what says "this changed
          because of what you did". Width is one column; the transform moves
          it by whole columns. */}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-1 left-1 top-1 rounded-xl bg-surface shadow-card ring-1 ring-inset ring-line-brand transition-transform duration-300 ease-spring motion-reduce:transition-none"
        style={{
          width: `calc((100% - 0.5rem) / ${segments.length})`,
          transform: `translateX(${selectedIndex * 100}%)`,
        }}
      />
      {segments.map((segment, index) => {
        const selected = index === selectedIndex;
        return (
          <button
            key={segment.key}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            // Roving tabindex: the group is one Tab stop, on the chosen one.
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(segment.key)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "relative z-10 flex h-10 min-w-0 items-center justify-center gap-2 rounded-xl px-2 text-[0.875rem] font-semibold outline-none",
              "transition-colors duration-200 focus-visible:shadow-focus disabled:cursor-not-allowed",
              // brand-800 on white 12:1; content-muted on surface-sunken 7.6:1.
              selected ? "text-brand-800" : "text-content-muted hover:text-content",
            )}
          >
            {segment.icon ? (
              <span aria-hidden className={cn("inline-flex shrink-0 transition-colors duration-200", selected ? "text-brand-600" : "text-content-faint")}>
                {segment.icon}
              </span>
            ) : null}
            <span className="truncate">{segment.label}</span>
          </button>
        );
      })}
    </div>
  );
}
