import { cn } from "@/lib/utils";

export type CardTone = "default" | "muted" | "brand" | "accent" | "inverse";

const TONES: Record<CardTone, string> = {
  default: "bg-surface border-line",
  muted: "bg-surface-muted border-line",
  brand: "bg-surface-brand border-line-brand",
  accent: "bg-surface-accent border-saffron-200",
  inverse: "bg-brand-gradient border-white/10 text-content-inverse",
};

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
  /** Adds a hover lift. Use only when the whole card is actionable. */
  interactive?: boolean;
  as?: "div" | "section" | "article" | "li";
}

export function Card({
  className,
  tone = "default",
  interactive = false,
  as: Tag = "div",
  children,
  ...props
}: CardProps) {
  // `as` only ever renders a plain block element; the cast keeps the prop
  // types simple without widening CardProps to every element's attributes.
  const Element = Tag as "div";
  return (
    <Element
      className={cn(
        "relative overflow-hidden rounded-3xl border shadow-card transition duration-300 ease-spring",
        TONES[tone],
        interactive && "hover:-translate-y-1 hover:shadow-card-hover",
        className,
      )}
      {...props}
    >
      {children}
    </Element>
  );
}

export function CardHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-start justify-between gap-4 p-6 pb-0 sm:p-7 sm:pb-0", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn("font-display text-lg font-semibold tracking-tight", className)} {...props}>
      {children}
    </h3>
  );
}

export function CardDescription({ className, children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("mt-1.5 text-sm leading-relaxed text-content-muted", className)} {...props}>
      {children}
    </p>
  );
}

export function CardBody({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("p-6 sm:p-7", className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-3 border-t border-line/70 px-6 py-4 sm:px-7", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/** Small icon plate used at the top of feature/empty cards. */
export function CardIcon({
  tone = "brand",
  className,
  children,
}: {
  tone?: "brand" | "accent" | "jade" | "coral" | "inverse";
  className?: string;
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    brand: "bg-brand-50 text-brand-700 ring-brand-100",
    accent: "bg-saffron-50 text-saffron-700 ring-saffron-100",
    jade: "bg-jade-50 text-jade-700 ring-jade-100",
    coral: "bg-coral-50 text-coral-700 ring-coral-100",
    inverse: "bg-white/12 text-content-inverse ring-white/15",
  };
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
