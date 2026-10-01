"use client";

import Link from "next/link";
import { ArrowLeft, CheckCircle2, CircleDashed, Clock3, Hourglass, Lock, PenLine, XCircle } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { cn, initialsFromName } from "@/lib/utils";
import { percentOf, percentTone, sectionOptionLabel } from "@/lib/tracker";
import type { TargetStatus, TrackerAssignmentStatus, TrackerEvaluation, TrackerSection } from "@/types/tracker";

// --- status badges -------------------------------------------------------------

const ASSIGNMENT_STATUS: Record<TrackerAssignmentStatus, { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: "Active", tone: "success" },
  CLOSED: { label: "Closed", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
};

export function AssignmentStatusBadge({ status }: { status: TrackerAssignmentStatus }) {
  const s = ASSIGNMENT_STATUS[status];
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

const TARGET_STATUS: Record<TargetStatus, { label: string; tone: BadgeTone; icon: React.ReactNode }> = {
  PENDING: { label: "Not Started", tone: "neutral", icon: <CircleDashed className="h-3 w-3" /> },
  IN_PROGRESS: { label: "In Progress", tone: "warning", icon: <Clock3 className="h-3 w-3" /> },
  COMPLETED: { label: "Completed", tone: "success", icon: <CheckCircle2 className="h-3 w-3" /> },
  SKIPPED: { label: "Skipped", tone: "neutral", icon: <XCircle className="h-3 w-3" /> },
};

export function TargetStatusBadge({ status }: { status: TargetStatus }) {
  const s = TARGET_STATUS[status];
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  );
}

/**
 * One attempt's score as a chip. A PENDING_REVIEW score is provisional --
 * it only counts what has been marked so far -- so it says "Needs Marking"
 * rather than showing a number that will change. FINALISED gets a pen
 * glyph so a teacher-marked score is distinguishable from an auto one.
 */
export function ScoreBadge({ evaluation }: { evaluation: TrackerEvaluation | null }) {
  if (!evaluation) return <span className="text-content-faint">&mdash;</span>;
  if (evaluation.reviewStatus === "PENDING_REVIEW") {
    return (
      <Badge tone="warning" icon={<Hourglass className="h-3 w-3" />}>
        Needs Marking
      </Badge>
    );
  }
  const percent = percentOf(evaluation.finalScore, evaluation.maxScore);
  return (
    <Badge
      tone={percentTone(percent)}
      icon={evaluation.reviewStatus === "FINALISED" ? <PenLine className="h-3 w-3" /> : undefined}
      title={evaluation.reviewStatus === "FINALISED" ? "Includes marks awarded by a teacher" : "Marked automatically"}
    >
      <span className="tabular">
        {evaluation.finalScore}/{evaluation.maxScore}
      </span>
    </Badge>
  );
}

export function PercentText({ percent }: { percent: number | null }) {
  if (percent === null) return <span className="text-content-faint">&mdash;</span>;
  const tone = percentTone(percent);
  return (
    <span
      className={cn(
        "font-semibold tabular",
        tone === "success" && "text-jade-700",
        tone === "accent" && "text-saffron-800",
        tone === "danger" && "text-coral-700",
      )}
    >
      {percent}%
    </span>
  );
}

export function ReadOnlyBadge() {
  return (
    <Badge tone="neutral" icon={<Lock className="h-3 w-3" />} title="You taught this section before a handover. You can review it, but not change it.">
      Read Only
    </Badge>
  );
}

// --- layout pieces ------------------------------------------------------------

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "attention" | "good";
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-2xl border px-4 py-3.5",
        tone === "attention" ? "border-saffron-200 bg-surface-accent" : tone === "good" ? "border-jade-200 bg-jade-50/60" : "border-line bg-surface",
      )}
    >
      {/* content-subtle on white 6.4:1, on surface-accent 6.1:1. */}
      <p className="text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-subtle">{label}</p>
      <p className="mt-1 font-display text-display-sm leading-none text-content tabular">{value}</p>
      {hint ? <p className="mt-1.5 truncate text-xs text-content-subtle">{hint}</p> : null}
    </div>
  );
}

/** The back link at the top of every full-screen tracker view. */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1.5 rounded-full text-sm font-semibold text-content-brand transition-colors hover:text-brand-900"
    >
      <ArrowLeft aria-hidden className="h-4 w-4 transition-transform duration-200 ease-spring group-hover:-translate-x-0.5" />
      {children}
    </Link>
  );
}

/**
 * Compact section picker for the tracker's toolbar. Lists current sections
 * first, then any the teacher has handed over (marked "Past"), whose
 * history stays readable. Native select, same reasoning as SelectField.
 */
export function SectionPicker({
  sections,
  value,
  onChange,
  disabled,
}: {
  sections: TrackerSection[];
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-[0.8125rem] font-semibold text-content">
      <span className="shrink-0">Section</span>
      <span className="relative min-w-0">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="h-10 w-full max-w-[22rem] appearance-none truncate rounded-xl border border-line-strong bg-surface pl-3.5 pr-9 text-[0.8125rem] font-medium text-content shadow-xs outline-none transition hover:border-ink-300 focus:border-brand-400 focus:shadow-focus disabled:opacity-60"
        >
          <option value="">All My Sections</option>
          {sections.map((section) => (
            <option key={section.key} value={section.key}>
              {sectionOptionLabel(section)}
            </option>
          ))}
        </select>
        <svg aria-hidden viewBox="0 0 16 16" className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-faint">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </label>
  );
}

/** Splits a section key ("classLevelId|section|boardCourseId") back into the
 *  query params the tracker endpoints filter on. */
export function scopeParams(key: string | null): { classLevelId?: string; section?: string; boardCourseId?: string } {
  if (!key) return {};
  const [classLevelId, section, boardCourseId] = key.split("|");
  if (!classLevelId || !section || !boardCourseId) return {};
  return { classLevelId, section, boardCourseId };
}

/** Initials avatar for table rows; brand-700 on brand-50 9.3:1. */
export function Initials({ name, muted = false }: { name: string | null; muted?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-bold ring-1 ring-inset",
        muted ? "bg-ink-100 text-ink-600 ring-ink-200" : "bg-brand-50 text-brand-700 ring-brand-100",
      )}
    >
      {initialsFromName(name)}
    </span>
  );
}
