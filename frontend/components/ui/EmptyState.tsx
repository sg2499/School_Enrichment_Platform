import { cn } from "@/lib/utils";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

export interface EmptyStateProps {
  /** Inline SVG illustration -- see components/brand/Graphics.tsx. */
  illustration?: React.ReactNode;
  status?: { label: string; tone?: BadgeTone };
  title: string;
  description: string;
  /** Short, honest bullet list of what will land here. */
  points?: string[];
  actions?: React.ReactNode;
  align?: "left" | "center";
  className?: string;
}

/**
 * The workhorse of this release. Almost every screen is legitimately empty
 * until curriculum and rosters are loaded, so "empty" has to look designed
 * and reassuring rather than broken -- illustration, a status chip that
 * tells the truth about where the feature is, and a plain-language note on
 * what will appear.
 */
export function EmptyState({
  illustration,
  status,
  title,
  description,
  points,
  actions,
  align = "left",
  className,
}: EmptyStateProps) {
  const centered = align === "center";
  return (
    <div
      className={cn(
        "relative flex flex-col gap-6 sm:flex-row sm:items-center",
        centered && "sm:flex-col sm:text-center",
        className,
      )}
    >
      {illustration ? (
        <div className={cn("shrink-0", centered ? "mx-auto" : "sm:order-2")} aria-hidden>
          {illustration}
        </div>
      ) : null}

      <div className={cn("min-w-0 flex-1 space-y-3", centered && "mx-auto max-w-prose")}>
        {status ? (
          <Badge tone={status.tone ?? "brand"} dot>
            {status.label}
          </Badge>
        ) : null}
        <h3 className="font-display text-display-sm text-balance text-content">{title}</h3>
        <p className={cn("max-w-prose text-[0.9375rem] leading-relaxed text-content-muted", centered && "mx-auto")}>
          {description}
        </p>

        {points && points.length > 0 ? (
          <ul className={cn("space-y-2 pt-1", centered && "inline-block text-left")}>
            {points.map((point) => (
              <li key={point} className="flex items-start gap-2.5 text-sm text-content-muted">
                <span aria-hidden className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-saffron-400" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {actions ? <div className={cn("flex flex-wrap items-center gap-3 pt-2", centered && "justify-center")}>{actions}</div> : null}
      </div>
    </div>
  );
}
