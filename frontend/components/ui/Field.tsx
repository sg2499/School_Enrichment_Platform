"use client";

import { forwardRef, useId, useState } from "react";
import { AlertCircle, ArrowBigUpDash, ChevronDown, Eye, EyeOff } from "lucide-react";
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

/** Joins the ids of every message that describes a control, so a screen
 *  reader hears the hint, the error and any live warning -- not just
 *  whichever one happened to be wired up. */
function describedBy(...ids: (string | null | undefined | false)[]) {
  const joined = ids.filter(Boolean).join(" ");
  return joined || undefined;
}

/** Error line shared by TextField and SelectField. The icon means the state
 *  is never carried by colour alone (WCAG 1.4.1), and coral-700 on white is
 *  7.3:1. */
function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-[0.8125rem] font-semibold leading-snug text-coral-700 animate-fade-in">
      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/**
 * One text input treatment for the whole product: generous 44px+ hit area,
 * visible label (never placeholder-only), inline hint slot for things like
 * "Forgot password?", and an error state that colours the border *and*
 * announces via aria-describedby.
 *
 * Password fields (type="password" or `revealable`) also warn when Caps Lock
 * is on (30 Sep 2026). On a shared school laptop Caps Lock is very often
 * left on by the previous user, and "wrong password" is otherwise the only
 * clue -- which for a Class 5 student reads as "I forgot my password".
 * Detected from the key events the field already receives, so there is
 * nothing to configure and every password field in the product gets it.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  {
    label,
    hint,
    error,
    icon,
    revealable = false,
    className,
    containerClassName,
    id,
    type = "text",
    onKeyDown,
    onKeyUp,
    onBlur,
    "aria-describedby": callerDescribedBy,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedById = `${inputId}-message`;
  const hintId = `${inputId}-hint`;
  const capsId = `${inputId}-caps`;
  const [revealed, setRevealed] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const resolvedType = revealable ? (revealed ? "text" : "password") : type;
  const isSecret = revealable || type === "password";
  const showCapsWarning = isSecret && capsLockOn;

  // Read on both keydown and keyup: macOS reports the Caps Lock key itself
  // on keydown when it turns on but on keyup when it turns off, so either
  // one alone misses half the toggles. getModifierState can be missing on
  // events synthesised by some on-screen keyboards -- then we just don't
  // warn, which is the safe failure.
  function syncCapsLock(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!isSecret || typeof event.getModifierState !== "function") return;
    setCapsLockOn(event.getModifierState("CapsLock"));
  }

  return (
    <div className={cn("group/field space-y-2", containerClassName)}>
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={inputId}
          className="text-[0.875rem] font-semibold text-content transition-colors duration-200 group-focus-within/field:text-brand-700"
        >
          {label}
        </label>
        {hint ? (
          <span id={hintId} className="text-[0.8125rem] font-medium text-content-subtle">
            {hint}
          </span>
        ) : null}
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
          aria-describedby={describedBy(
            callerDescribedBy,
            error && describedById,
            hint && hintId,
            showCapsWarning && capsId,
          )}
          onKeyDown={(event) => {
            syncCapsLock(event);
            onKeyDown?.(event);
          }}
          onKeyUp={(event) => {
            syncCapsLock(event);
            onKeyUp?.(event);
          }}
          onBlur={(event) => {
            // The state can change while focus is elsewhere, so a stale
            // warning is worse than none; the next keystroke re-reads it.
            setCapsLockOn(false);
            onBlur?.(event);
          }}
          className={cn(
            // The outline. At rest line-field, 3.2:1 on the white of the
            // box (it was line-strong, 1.5:1: see tailwind.config.ts);
            // hovered ink-500, 4.6:1; focused brand-500, 5.9:1 (it was
            // brand-400, 3.7:1, which against the new resting outline was
            // barely a change, and lighter than the hover it follows); in
            // error coral-500, 3.8:1 (it was coral-400, 2.7:1). Rest, hover
            // and focus each get darker, and nothing is under 3:1.
            //
            // 1rem text is deliberate: it is the legibility floor the product
            // owner asked for, and it also stops iOS Safari zooming the page
            // whenever a student taps into a field.
            "peer relative h-12 w-full rounded-2xl border bg-surface px-4 text-base text-content shadow-xs outline-none",
            "placeholder:text-content-faint",
            "transition duration-200 ease-spring",
            "focus:border-brand-500 focus:shadow-focus-field",
            icon && "pl-11",
            revealable && "pr-12",
            error ? "border-coral-500 focus:border-coral-600" : "border-line-field hover:border-ink-500",
            // A caller that shows the message itself, somewhere else (the
            // sign-in card's one message for two boxes), marks the box with
            // aria-invalid and no `error`: the box still turns coral.
            "aria-[invalid=true]:border-coral-500 aria-[invalid=true]:focus:border-coral-600",
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
            aria-pressed={revealed}
            className="absolute right-2 top-1/2 z-10 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-content-subtle transition hover:bg-surface-brand hover:text-content-brand"
          >
            {revealed ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
          </button>
        ) : null}
        {/* Always mounted, so assistive tech is already watching it when the
            warning appears (a live region inserted together with its text
            is often not announced). Visually hidden and absolutely
            positioned -- it never takes up space in the field's rhythm. */}
        {isSecret ? (
          <span className="sr-only" aria-live="polite">
            {showCapsWarning ? "Caps Lock is on." : ""}
          </span>
        ) : null}
      </div>

      {showCapsWarning ? (
        // saffron-900 on saffron-50 is 9.3:1. Warm "heads up" rather than
        // coral: nothing has gone wrong yet, and it shouldn't look like it.
        <p
          id={capsId}
          className="inline-flex items-center gap-1.5 rounded-full bg-saffron-50 px-2.5 py-1 text-[0.75rem] font-semibold text-saffron-900 ring-1 ring-inset ring-saffron-200 animate-scale-in"
        >
          <ArrowBigUpDash className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Caps Lock is on
        </p>
      ) : null}

      {error ? <FieldError id={describedById}>{error}</FieldError> : null}
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
  { label, hint, error, className, containerClassName, id, children, "aria-describedby": callerDescribedBy, ...props },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const describedById = `${selectId}-message`;
  const hintId = `${selectId}-hint`;

  return (
    <div className={cn("group/field space-y-2", containerClassName)}>
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={selectId}
          className="text-[0.875rem] font-semibold text-content transition-colors duration-200 group-focus-within/field:text-brand-700"
        >
          {label}
        </label>
        {hint ? (
          <span id={hintId} className="text-[0.8125rem] font-medium text-content-subtle">
            {hint}
          </span>
        ) : null}
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
          aria-describedby={describedBy(callerDescribedBy, error && describedById, hint && hintId)}
          className={cn(
            "peer relative h-12 w-full appearance-none rounded-2xl border bg-surface px-4 pr-11 text-base text-content shadow-xs outline-none",
            "transition duration-200 ease-spring",
            "focus:border-brand-500 focus:shadow-focus-field",
            error ? "border-coral-500 focus:border-coral-600" : "border-line-field hover:border-ink-500",
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

      {error ? <FieldError id={describedById}>{error}</FieldError> : null}
    </div>
  );
});
