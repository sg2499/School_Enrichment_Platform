import { cn } from "@/lib/utils";

export type ProgressSegment = { value: number; className: string; label: string };

/**
 * A thin stacked bar (e.g. Completed / In Progress / Not Started). The
 * accessible name spells every segment out in words, so colour is never
 * the only carrier (WCAG 1.4.1); visually the caller prints the headline
 * number beside it too.
 */
export function ProgressBar({
  segments,
  total,
  className,
}: {
  segments: ProgressSegment[];
  total: number;
  className?: string;
}) {
  const description = segments.map((s) => `${s.value} ${s.label}`).join(", ");
  return (
    <div
      role="img"
      aria-label={total > 0 ? description : "Nobody targeted"}
      className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-ink-100", className)}
    >
      {total > 0
        ? segments.map((segment) =>
            segment.value > 0 ? (
              <span
                key={segment.label}
                className={cn("h-full transition-[width] duration-500 ease-spring", segment.className)}
                style={{ width: `${(segment.value / total) * 100}%` }}
              />
            ) : null,
          )
        : null}
    </div>
  );
}
