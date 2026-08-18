"use client";

import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "quiet" | "danger";
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
    "active:translate-y-0 active:scale-[0.985] active:shadow-brand focus-visible:shadow-focus",
  // Warm saffron -- reserved for the single most inviting action on a view.
  accent:
    "bg-accent-gradient text-brand-950 shadow-accent hover:-translate-y-0.5 hover:brightness-[1.04] " +
    "active:translate-y-0 active:scale-[0.985] focus-visible:shadow-focus-accent",
  secondary:
    "border border-line-strong bg-surface text-content shadow-xs hover:border-brand-300 hover:bg-surface-brand " +
    "hover:text-content-brand focus-visible:shadow-focus",
  ghost:
    "border border-transparent text-content-muted hover:bg-surface-brand hover:text-content-brand focus-visible:shadow-focus",
  // For dark chrome (sidebar, brand panels).
  quiet:
    "border border-line-inverse bg-white/10 text-content-inverse backdrop-blur hover:bg-white/20 focus-visible:shadow-focus",
  danger:
    "bg-coral-600 text-content-inverse shadow-xs hover:bg-coral-700 focus-visible:shadow-focus",
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
