import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/Badge";

export interface PageHeaderProps {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}

/** Consistent top-of-page block: eyebrow, display title, one line of context,
 *  and a right-aligned action slot. */
export function PageHeader({ eyebrow, title, description, actions, meta, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between", className)}>
      <div className="min-w-0 space-y-2">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className="font-display text-display-md text-balance text-content sm:text-display-lg">{title}</h1>
        {/* No max-w cap here (19 Aug 2026, Shailesh: this was wrapping onto a
            second line with plenty of room left on the first) --
            max-w-prose is a 65-character reading-width limit meant for a
            paragraph of body text, not a single header sentence sitting in
            a wide flex row that's already bounded by the page's own
            max-w-shell container and the actions slot beside it. Letting it
            fill the space it actually has means it only wraps when the
            container genuinely runs out of room. */}
        {description ? (
          <p className="text-[0.9375rem] leading-relaxed text-content-muted text-pretty">{description}</p>
        ) : null}
        {meta ? <div className="flex flex-wrap items-center gap-2 pt-1">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
