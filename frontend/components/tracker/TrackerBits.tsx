"use client";

import { CheckCircle2, CircleDashed, Clock3, Hourglass, Lock, PenLine, XCircle } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { CountUp } from "@/components/ui/CountUp";
import { cn, initialsFromName } from "@/lib/utils";
import { percentOf, percentTone, sectionOptionLabel } from "@/lib/tracker";
import type { TargetStatus, TrackerAssignmentStatus, TrackerEvaluation, TrackerSection } from "@/types/tracker";

// --- status badges -------------------------------------------------------------

const ASSIGNMENT_STATUS: Record<TrackerAssignmentStatus, { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: "Active", tone: "success" },
  CLOSED: { label: "Closed", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
};

export function AssignmentStatusBadge({ status, onDark }: { status: TrackerAssignmentStatus; onDark?: boolean }) {
  const s = ASSIGNMENT_STATUS[status];
  return (
    <Badge tone={s.tone} dot onDark={onDark}>
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
export function ScoreBadge({ evaluation, onDark }: { evaluation: TrackerEvaluation | null; onDark?: boolean }) {
  if (!evaluation) return <span className={onDark ? "text-content-inverse-muted" : "text-content-faint"}>&mdash;</span>;
  if (evaluation.reviewStatus === "PENDING_REVIEW") {
    return (
      <Badge tone="warning" icon={<Hourglass className="h-3 w-3" />} onDark={onDark}>
        Needs Marking
      </Badge>
    );
  }
  const percent = percentOf(evaluation.finalScore, evaluation.maxScore);
  return (
    <Badge
      tone={percentTone(percent)}
      onDark={onDark}
      icon={evaluation.reviewStatus === "FINALISED" ? <PenLine className="h-3 w-3" /> : undefined}
      title={evaluation.reviewStatus === "FINALISED" ? "Includes marks awarded by a teacher" : "Marked automatically"}
    >
      <span className="tabular">
        {evaluation.finalScore}/{evaluation.maxScore}
      </span>
    </Badge>
  );
}

/**
 * A percentage, coloured by how good it is (the number is always printed,
 * so colour is never the only carrier).
 *
 * `animated` counts it up from zero (2 Oct 2026). Off by default and meant
 * for a headline figure only (a masthead's Average cell): the same component fills the
 * Average column of the assignments and students tables, and a column of
 * thirty percentages all ticking at once is exactly the distraction a
 * working table must not have.
 */
export function PercentText({
  percent,
  animated = false,
  onDark = false,
}: {
  percent: number | null;
  animated?: boolean;
  /** Inside a masthead cell: the 200 step of each scale instead of the
   *  700/800, which are ink colours for paper and all but vanish on indigo.
   *  PageHeader.tsx has their contrast on a well. */
  onDark?: boolean;
}) {
  if (percent === null) return <span className={onDark ? "text-content-inverse-muted" : "text-content-faint"}>&mdash;</span>;
  const tone = percentTone(percent);
  return (
    <span
      className={cn(
        "font-semibold tabular",
        tone === "success" && (onDark ? "text-jade-200" : "text-jade-700"),
        tone === "accent" && (onDark ? "text-saffron-200" : "text-saffron-800"),
        tone === "danger" && (onDark ? "text-coral-200" : "text-coral-700"),
      )}
    >
      {animated ? <CountUp value={percent} suffix="%" /> : `${percent}%`}
    </span>
  );
}

export function ReadOnlyBadge({ onDark }: { onDark?: boolean }) {
  return (
    <Badge tone="neutral" onDark={onDark} icon={<Lock className="h-3 w-3" />} title="You taught this section before a handover. You can review it, but not change it.">
      Read Only
    </Badge>
  );
}

// --- layout pieces ------------------------------------------------------------

// StatTile and TeacherAmbience used to live here. Both went with the masthead
// pass (2 Oct 2026): every Teacher screen's headline figures are now cells
// in PageHeader's masthead (PageHeaderStat), and the colour wash behind the
// workspace is components/brand/Ambience.tsx, switched on through
// RoleShell's `ambience` prop. Neither had a caller left.

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
