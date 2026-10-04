"use client";

import { forwardRef } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "accent" | "secondary" | "tinted" | "ghost" | "quiet" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "group relative inline-flex select-none items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-full font-semibold " +
  "transition duration-200 ease-spring focus-visible:outline-none focus-visible:ring-0 " +
  // Press reads as a real press: it snaps down fast (75ms) and eases back.
  "active:duration-75 " +
  "disabled:pointer-events-none disabled:opacity-55 " +
  // While loading the button is disabled but must not look greyed out --
  // it is working, not unavailable.
  "[&[aria-busy='true']]:opacity-100 [&[aria-busy='true']]:cursor-progress";

const VARIANTS: Record<ButtonVariant, string> = {
  // Deep ink -- the confident default for form submits and key actions.
  primary:
    "bg-brand-gradient text-content-inverse shadow-brand hover:-translate-y-0.5 hover:shadow-card-hover " +
    "active:translate-y-0 active:scale-[0.985] active:shadow-brand focus-visible:shadow-focus-ring",
  // Warm saffron -- reserved for the single most inviting action on a view.
  accent:
    "bg-accent-gradient text-brand-950 shadow-accent hover:-translate-y-0.5 hover:brightness-[1.04] " +
    "active:translate-y-0 active:scale-[0.985] focus-visible:shadow-focus-ring",
  // White and bordered -- the committed alternative beside a primary, or a
  // row's one action that needs doing now ("Mark Answers").
  secondary:
    "border border-line-strong bg-surface text-content shadow-xs hover:border-brand-300 hover:bg-surface-brand " +
    "hover:text-content-brand focus-visible:shadow-focus-ring",
  // Ink-tinted -- a standalone action that repeats down a list or sits alone
  // in a card ("Review", "Grant Extra Attempt"): visibly a button at rest,
  // but quiet enough to appear thirty times on one screen. Reach for it
  // whenever the action is the only one on offer; `secondary` when it is the
  // one to do next; `ghost` only beside a committed button.
  //
  // Added 2 Oct 2026 (Shailesh, from a screenshot of the assignment view:
  // "the buttons... appear like floating text giving away a very casual and
  // lanky feel"). Those row actions were `ghost`, which has no fill, border
  // or shadow until hover -- correct for a Cancel next to a Save, where the
  // neighbour supplies the "these are buttons" cue, and wrong for an action
  // on its own, where nothing does.
  //
  // The fill and border are the same pair Card tone="brand" and the info
  // AlertBanner already use, so no new colour enters the system. Label:
  // brand-700 on surface-brand 9.3:1 at rest, brand-900 on brand-100 11.7:1
  // on hover. The fill itself is only 1.1:1 against a white row and is not
  // what makes the control identifiable -- the label is; the fill is the
  // affordance cue (WCAG 1.4.11 asks 3:1 of a boundary only when the
  // boundary is the sole way to find the control).
  tinted:
    "border border-line-brand bg-surface-brand text-content-brand hover:border-brand-300 hover:bg-brand-100 " +
    "hover:text-brand-900 focus-visible:shadow-focus-ring",
  // No chrome at rest -- only for the de-emphasised half of a pair, where
  // the committed button beside it supplies the "these are buttons" cue
  // (Cancel next to Save). Never as a row's or a card's only action: that
  // is what `tinted` is for.
  ghost:
    "border border-transparent text-content-muted hover:bg-surface-brand hover:text-content-brand focus-visible:shadow-focus-ring",
  // For dark chrome (sidebar, brand panels).
  quiet:
    "border border-line-inverse bg-white/10 text-content-inverse backdrop-blur hover:bg-white/20 focus-visible:shadow-focus-ring",
  danger:
    "bg-coral-600 text-content-inverse shadow-xs hover:bg-coral-700 focus-visible:shadow-focus-ring",
};

// Filled variants get a lit top edge (shadow-sheen). Outline/ghost/quiet
// variants have no fill for light to catch, so they don't -- and neither
// does tinted: its fill is nearly as pale as the highlight (white at 20%
// over brand-50 moves it by about two levels in 255), so there is nothing
// for the eye to catch.
const HAS_SHEEN: Record<ButtonVariant, boolean> = {
  primary: true,
  accent: true,
  danger: true,
  secondary: false,
  tinted: false,
  ghost: false,
  quiet: false,
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-[0.8125rem]",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-7 text-[0.9375rem]",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = "primary",
    size = "md",
    loading = false,
    loadingLabel,
    leadingIcon,
    trailingIcon,
    fullWidth,
    disabled,
    children,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && "w-full", className)}
      {...props}
    >
      {/* Hover/press wash. A separate layer so it works over gradients and
          solid fills alike without every variant needing its own hover
          colour. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-white/0 transition-colors duration-200 group-hover:bg-white/[0.09] group-active:bg-black/[0.07]"
      />
      {/* rounded-[inherit] so the inset highlight follows the pill's curve
          instead of being clipped into a flat line at the ends. */}
      {HAS_SHEEN[variant] ? (
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-sheen" />
      ) : null}
      {/* Light sweeping across the surface while the action is in flight --
          the wait reads as progress rather than as a frozen button. */}
      {loading ? (
        <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <span className="absolute inset-y-0 left-0 w-1/3 bg-white/25 blur-lg animate-sweep" />
        </span>
      ) : null}

      <span className="relative z-10 inline-flex min-w-0 items-center gap-2">
        {loading ? (
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
        ) : leadingIcon ? (
          <span aria-hidden className="-ml-0.5 inline-flex shrink-0">
            {leadingIcon}
          </span>
        ) : null}
        <span className="truncate">{loading ? loadingLabel ?? children : children}</span>
        {!loading && trailingIcon ? (
          <span
            aria-hidden
            className="-mr-0.5 inline-flex shrink-0 transition-transform duration-200 ease-spring group-hover:translate-x-0.5"
          >
            {trailingIcon}
          </span>
        ) : null}
      </span>
    </button>
  );
});

/**
 * A link that looks exactly like a Button (1 Oct 2026). Navigation should be
 * a real <a> -- middle-click, "open in new tab", and screen readers
 * announcing "link" all depend on it -- but several actions ("View In
 * Tracker", "Mark Answers") are navigations that sit beside real buttons
 * and must look like them. Same variants and sizes; no loading state,
 * since a link never waits.
 */
export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  leadingIcon,
  trailingIcon,
  fullWidth,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Link>, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  fullWidth?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && "w-full", className)} {...props}>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-white/0 transition-colors duration-200 group-hover:bg-white/[0.09] group-active:bg-black/[0.07]"
      />
      {HAS_SHEEN[variant] ? (
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-sheen" />
      ) : null}
      <span className="relative z-10 inline-flex min-w-0 items-center gap-2">
        {leadingIcon ? (
          <span aria-hidden className="-ml-0.5 inline-flex shrink-0">
            {leadingIcon}
          </span>
        ) : null}
        <span className="truncate">{children}</span>
        {trailingIcon ? (
          <span
            aria-hidden
            className="-mr-0.5 inline-flex shrink-0 transition-transform duration-200 ease-spring group-hover:translate-x-0.5"
          >
            {trailingIcon}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
