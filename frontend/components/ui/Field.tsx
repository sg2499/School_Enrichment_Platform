"use client";

import { forwardRef, useId, useState } from "react";
import { ChevronDown, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  hint?: string;
  error?: string | null;
  icon?: React.ReactNode;
  /** Renders a show/hide toggle and swaps the input type. */
  revealable?: boolean;
  containerClassName?: string;
}

/**
 * One text input treatment for the whole product: generous 44px+ hit area,
 * visible label (never placeholder-only), inline hint slot for things like
 * "Forgot password?", and an error state that colours the border *and*
 * announces via aria-describedby.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, icon, revealable = false, className, containerClassName, id, type = "text", ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedById = `${inputId}-message`;
  const [revealed, setRevealed] = useState(false);
  const resolvedType = revealable ? (revealed ? "text" : "password") : type;

  return (
    <div className={cn("group/field space-y-2", containerClassName)}>
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={inputId}
          className="text-[0.875rem] font-semibold text-content transition-colors duration-200 group-focus-within/field:text-brand-700"
        >
          {label}
        </label>
        {hint ? <span className="text-[0.8125rem] font-medium text-content-subtle">{hint}</span> : null}
      </div>

      {/* Wrapper lifts the whole field a hair on focus. The transform lives
          here rather than on the input so the icon and reveal button travel
          with it instead of drifting. */}
      <div className="relative transition-transform duration-300 ease-spring group-focus-within/field:-translate-y-px">
        {/* Soft aura behind the input -- reads as the field lighting up,
            which a border-colour swap alone never manages. */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute -inset-[3px] rounded-[1.15rem] opacity-0 blur-md transition-opacity duration-300",
            error ? "bg-coral-400/35" : "bg-brand-400/35",
            "group-focus-within/field:opacity-100",
          )}
        />
        <input
          ref={ref}
          id={inputId}
          type={resolvedType}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? describedById : undefined}
          className={cn(
            // 1rem text is deliberate: it is the legibility floor the product
            // owner asked for, and it also stops iOS Safari zooming the page
            // whenever a student taps into a field.
            "peer relative h-12 w-full rounded-2xl border bg-surface px-4 text-base text-content shadow-xs outline-none",
            "placeholder:text-content-faint",
            "transition duration-200 ease-spring",
            "focus:border-brand-400 focus:shadow-focus-field",
            icon && "pl-11",
            revealable && "pr-12",
            error ? "border-coral-400 focus:border-coral-500" : "border-line-strong hover:border-ink-300",
            className,
          )}
          {...props}
        />
        {/* Rendered after the input so Tailwind's `peer-focus:` sibling
            selector can tint the icon while the field is focused. */}
        {icon ? (
          <span
            aria-hidden
            className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-content-faint transition-colors duration-200 peer-focus:text-brand-600"
          >
            {icon}
          </span>
        ) : null}
        {revealable ? (
          <button
            type="button"
            onClick={() => setRevealed((value) => !value)}
            aria-label={revealed ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 z-10 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-content-subtle transition hover:bg-surface-brand hover:text-content-brand"
          >
            {revealed ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
          </button>
        ) : null}
      </div>

      {error ? (
        <p id={describedById} className="text-[0.8125rem] font-semibold text-coral-700">
          {error}
        </p>
      ) : null}
    </div>
  );
});

export interface SelectFieldProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label: string;
  hint?: string;
  error?: string | null;
  containerClassName?: string;
}

/** Same visual language as TextField, for the handful of places a plain
 *  native `<select>` is the right control (dropdowns of a few dozen items
 *  or fewer -- board courses, chapters, classes). Native rather than a
 *  custom listbox: full keyboard/screen-reader support for free, and every
 *  School Enrichment dropdown so far is short enough that a native picker
 *  is not a usability compromise. */
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, className, containerClassName, id, children, ...props },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const describedById = `${selectId}-message`;

  return (
    <div className={cn("group/field space-y-2", containerClassName)}>
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={selectId}
          className="text-[0.875rem] font-semibold text-content transition-colors duration-200 group-focus-within/field:text-brand-700"
        >
          {label}
        </label>
        {hint ? <span className="text-[0.8125rem] font-medium text-content-subtle">{hint}</span> : null}
      </div>

      <div className="relative transition-transform duration-300 ease-spring group-focus-within/field:-translate-y-px">
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute -inset-[3px] rounded-[1.15rem] opacity-0 blur-md transition-opacity duration-300",
            error ? "bg-coral-400/35" : "bg-brand-400/35",
            "group-focus-within/field:opacity-100",
          )}
        />
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? describedById : undefined}
          className={cn(
            "peer relative h-12 w-full appearance-none rounded-2xl border bg-surface px-4 pr-11 text-base text-content shadow-xs outline-none",
            "transition duration-200 ease-spring",
            "focus:border-brand-400 focus:shadow-focus-field",
            error ? "border-coral-400 focus:border-coral-500" : "border-line-strong hover:border-ink-300",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <span
          aria-hidden
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-content-faint transition-colors duration-200 peer-focus:text-brand-600"
        >
          <ChevronDown className="h-4 w-4" />
        </span>
      </div>

      {error ? (
        <p id={describedById} className="text-[0.8125rem] font-semibold text-coral-700">
          {error}
        </p>
      ) : null}
    </div>
  );
});
