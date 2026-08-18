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
        {description ? (
          <p className="max-w-prose text-[0.9375rem] leading-relaxed text-content-muted text-pretty">{description}</p>
        ) : null}
        {meta ? <div className="flex flex-wrap items-center gap-2 pt-1">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
