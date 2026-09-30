import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "brand" | "accent" | "success" | "warning" | "danger" | "inverse";
export type BadgeSize = "sm" | "md";

const TONES: Record<BadgeTone, { chip: string; dot: string }> = {
  neutral: { chip: "bg-ink-100 text-ink-700 ring-ink-200", dot: "bg-ink-400" },
  brand: { chip: "bg-brand-50 text-brand-700 ring-brand-200", dot: "bg-brand-500" },
  accent: { chip: "bg-saffron-50 text-saffron-800 ring-saffron-200", dot: "bg-saffron-500" },
  success: { chip: "bg-jade-50 text-jade-700 ring-jade-200", dot: "bg-jade-500" },
  warning: { chip: "bg-saffron-100 text-saffron-900 ring-saffron-300", dot: "bg-saffron-600" },
  danger: { chip: "bg-coral-50 text-coral-700 ring-coral-200", dot: "bg-coral-500" },
  inverse: { chip: "bg-white/12 text-white ring-white/20", dot: "bg-saffron-300" },
};

const SIZES: Record<BadgeSize, string> = {
  sm: "h-6 px-2.5 text-[0.6875rem]",
  md: "h-7 px-3 text-xs",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  /** Leading status dot. `pulse` adds a soft ping for live/in-progress states. */
  dot?: boolean;
  pulse?: boolean;
  icon?: React.ReactNode;
}

export function Badge({
  className,
  tone = "neutral",
  size = "sm",
  dot = false,
  pulse = false,
  icon,
  children,
  ...props
}: BadgeProps) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-semibold uppercase tracking-[0.08em] ring-1 ring-inset",
        t.chip,
        SIZES[size],
        className,
      )}
      {...props}
    >
      {dot ? (
        <span aria-hidden className="relative flex h-1.5 w-1.5">
          {/* pulse-ring rather than Tailwind's stock `animate-ping` (1s,
              scale 2x): the system's own ring is slower and smaller, and is
              the same "live" signal as the login page's Secure Sign-In dot,
              so every live indicator in the product breathes at one rate
              instead of some of them flickering. */}
          {pulse ? (
            <span className={cn("absolute inline-flex h-full w-full rounded-full", t.dot, "animate-pulse-ring")} />
          ) : null}
          <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", t.dot)} />
        </span>
      ) : null}
      {icon ? (
        <span aria-hidden className="inline-flex">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}

/**
 * Wide, letter-spaced label that sits above a heading.
 *
 * Led by a short saffron rule (30 Sep 2026) -- the one editorial mark that
 * ties every page title in the product back to the accent colour, the way a
 * printed section opener does. Decorative only (aria-hidden); the label's
 * own brand-700 text carries the meaning (9.7:1 on the paper canvas).
 */
export function Eyebrow({ className, children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("flex items-center gap-2.5 text-eyebrow font-bold uppercase text-content-brand", className)} {...props}>
      <span aria-hidden className="h-[2px] w-5 shrink-0 rounded-full bg-accent-gradient" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
