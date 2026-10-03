"use client";

import { useId } from "react";
import { AlertCircle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { MASTHEAD_WELL } from "@/components/ui/PageHeader";

/**
 * A native select inside a masthead (3 Oct 2026, Super Admin screens).
 *
 * A Super Admin's People page is about one school at a time, and which
 * school is the first decision on the page. It used to be a card of its own
 * under a header that was text on the canvas; with the header a lit panel,
 * the choice belongs in it -- the panel then says "People, at <this
 * school>", and the figures beside the picker are that school's.
 *
 * The field itself stays the paper-white one every other select in the
 * product is (SelectField): a form control should look like a form control
 * wherever it sits, and white on the well is the strongest edge available.
 * What changes for the panel is everything around it -- the label and the
 * helper line are set on the well in the inverse ramp (label saffron-200
 * 8.0:1, helper content-inverse-muted 7.2:1, error coral-200 7.1:1; the
 * pairs measured in PageHeader.tsx), and focus uses the masthead's solid
 * ring rather than the paper-tinted one, which all but vanishes on indigo.
 */
export function MastheadSelect({
  label,
  helper,
  error,
  className,
  children,
  id,
  ...props
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  label: string;
  /** One line beside the label saying what choosing does. */
  helper?: string;
  error?: string | null;
}) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const helperId = `${selectId}-helper`;
  const errorId = `${selectId}-error`;
  return (
    <div className={cn("rounded-2xl p-4 ring-1 ring-inset sm:p-5", MASTHEAD_WELL.default.cell, className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-6">
        <div className="min-w-0 lg:w-[19rem] lg:shrink-0">
          <label htmlFor={selectId} className="block text-eyebrow font-bold uppercase text-saffron-200">
            {label}
          </label>
          {helper ? (
            <p id={helperId} className="mt-1 text-[0.8125rem] leading-snug text-content-inverse-muted text-pretty">
              {helper}
            </p>
          ) : null}
        </div>
        <div className="relative min-w-0 flex-1">
          <select
            id={selectId}
            aria-invalid={error ? true : undefined}
            aria-describedby={[error ? errorId : null, helper ? helperId : null].filter(Boolean).join(" ") || undefined}
            className={cn(
              "peer h-12 w-full appearance-none rounded-2xl border bg-surface px-4 pr-11 text-base text-content shadow-xs outline-none",
              "transition duration-200 ease-spring focus:shadow-focus-inverse disabled:cursor-progress disabled:opacity-80",
              error ? "border-coral-300" : "border-white/20",
            )}
            {...props}
          >
            {children}
          </select>
          <span aria-hidden className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-content-faint">
            <ChevronDown className="h-4 w-4" />
          </span>
        </div>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-3 flex items-start gap-2 text-[0.8125rem] font-medium leading-snug text-coral-200">
          <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
