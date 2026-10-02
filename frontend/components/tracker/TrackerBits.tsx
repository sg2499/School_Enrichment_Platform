"use client";

import { CheckCircle2, CircleDashed, Clock3, Hourglass, Lock, PenLine, XCircle } from "lucide-react";
import { AuroraBackdrop } from "@/components/brand/Graphics";
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

/**
 * A percentage, coloured by how good it is (the number is always printed,
 * so colour is never the only carrier).
 *
 * `animated` counts it up from zero (2 Oct 2026). Off by default and meant
 * for a StatTile's headline figure only: the same component fills the
 * Average column of the assignments and students tables, and a column of
 * thirty percentages all ticking at once is exactly the distraction a
 * working table must not have.
 */
export function PercentText({ percent, animated = false }: { percent: number | null; animated?: boolean }) {
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
      {animated ? <CountUp value={percent} suffix="%" /> : `${percent}%`}
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

const STAT_TONES = {
  default: "border-line bg-surface",
  attention: "border-saffron-200 bg-surface-accent",
  good: "border-jade-200 bg-jade-50/60",
} as const;

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  adornment,
}: {
  label: string;
  /** A plain number counts up from zero when the tile appears, and moves
   *  from its old value when it changes (useCountUp; it stays still under
   *  prefers-reduced-motion). Anything else -- a "–" placeholder while
   *  loading, a <PercentText> -- is rendered exactly as given. */
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: keyof typeof STAT_TONES;
  /** A small mark in the tile's top-right corner, for the rare tile that
   *  has something to celebrate (the AchievementSpark on To Mark). */
  adornment?: React.ReactNode;
}) {
  return (
    // shadow-xs (2 Oct 2026): the tiles sat completely flat between a page
    // title and a card that casts shadow-card, so the row read as outlines
    // drawn on the page rather than as objects on it. The smallest shadow
    // in the scale is enough to seat them without competing with the card.
    <div className={cn("relative min-w-0 rounded-2xl border px-4 py-3.5 shadow-xs", STAT_TONES[tone])}>
      {/* content-subtle on white 6.4:1, on surface-accent 6.1:1, on the
          good tile (jade-50 at 60% over the canvas) 6.0:1. */}
      <p className={cn("text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-subtle", adornment ? "pr-9" : null)}>
        {label}
      </p>
      <p className="mt-1 font-display text-display-sm leading-none text-content tabular">
        {typeof value === "number" ? <CountUp value={value} /> : value}
      </p>
      {/* Wraps rather than truncates: tiles sit in an equal-height grid,
          so a two-line hint costs nothing, while truncate cut the one
          tile whose hint mattered ("Students with written answe…"). */}
      {hint ? <p className="mt-1.5 text-xs leading-snug text-content-subtle text-pretty">{hint}</p> : null}
      {adornment ? <span className="absolute right-3 top-3 inline-flex">{adornment}</span> : null}
    </div>
  );
}

/**
 * The quiet colour wash behind every Teacher screen (2 Oct 2026).
 *
 * It is AuroraBackdrop -- the same graphic the session-check LoadingScreen
 * shows at full strength immediately before any of these pages appears --
 * turned well down and pinned to the viewport. Nothing new is drawn. The
 * effect is that the loading screen's atmosphere settles into the workspace
 * instead of being cut to bare canvas the instant the page arrives.
 *
 * Two levels. Both numbers come from measurement, not from taste, and the
 * measurement is why they are as low as they are.
 *
 * What was measured: the page rendered in Chromium with everything hidden
 * except the canvas, RoleShell's canvas-glow and this backdrop, then every
 * pixel of the content column tested against content-subtle -- the
 * quietest text that sits directly on the canvas (the shell's footer and
 * date line, a table's "8 students" count). Eleven widths from 320 to
 * 2560px, with the rail both expanded and collapsed to its icon column
 * (which uncovers more of the lilac blob). The figure quoted is the single
 * worst pixel, in the spirit of the inverse ramp in tailwind.config.ts
 * ("measured against the lightest point of that chrome, not its average").
 *
 * The starting point matters: the shell's own glow already takes
 * content-subtle from 6.0:1 on plain canvas down to 4.9:1 at its peak on a
 * phone, before this component adds anything. There was 0.4 of headroom
 * above AA's 4.5:1 to spend, and no more.
 *
 *  - `dashboard` -- opacity 0.30, blobs drifting. Worst pixel 4.54:1 (a
 *    320px phone; 4.60:1 at 390px, 4.69:1 on a laptop with the rail
 *    collapsed, 4.9:1 with it expanded), taken as the minimum across the
 *    whole drift cycle. The next step up, 0.35, measured 4.51:1 -- inside
 *    the rounding of an 8-bit screenshot, so not something to call a pass
 *    -- and 0.40 fails outright at 4.49:1. The dashboard is the landing
 *    view, so it keeps the slow drift; its fuller atmosphere is carried by
 *    the hero card (teacher/dashboard's NextStepCard), where the edges are
 *    designed and the text is on the inverse ramp, not by pushing this
 *    wash past what bare-canvas text can take.
 *
 *  - `working` -- opacity 0.25, and completely still. Worst pixel 4.64:1
 *    (320px; 4.73:1 on a laptop with the rail collapsed). Assign Practice
 *    and the four Practice Tracker screens are where a teacher reads a
 *    table for minutes at a time, so this one is meant to be barely there.
 *    The drift is switched off for the reason RoleShell gives for its own
 *    static rail -- it "sits in peripheral vision for a whole school day,
 *    where ambient motion is a distraction" -- and a thing moving at the
 *    edge of a table you are reading is the one kind of decoration that
 *    actively costs attention. It also means these pages put nothing on
 *    the compositor's per-frame bill on a school's cheapest laptop.
 *
 * Every other canvas text colour is far clear at both levels: at 0.30 the
 * worst pixel gives content-muted 6.1:1, brand-700 7.2:1, content 12.0:1.
 * No parallax and no grain at either level -- the sign-in page's
 * cursor-following depth is a first-impression moment, not something to
 * live with all day, and grain is for dithering large dark gradients.
 *
 * Worth knowing when judging it: every card, table, tile and banner on
 * these pages is opaque, so the wash is never actually *behind* the data a
 * teacher is reading. It shows only in the page margins, the gaps between
 * cards, and behind the page title.
 *
 * `fixed`, not `absolute`. AuroraBackdrop places its blobs on the corners
 * of its own box and clips them there, which is right when the box's edges
 * are real edges (a full screen, a card). <main> is not that: on a wide
 * monitor it is a centred 84rem column, and an absolutely positioned
 * backdrop would be cut off along the column's sides, leaving a hard
 * vertical seam of tint against plain canvas. Pinned to the viewport, its
 * edges are the screen's edges at every width and the sidebar simply sits
 * over the left of it. It also puts the blobs exactly where the
 * LoadingScreen had them, which is what makes the hand-over seamless.
 *
 * Usage: first child of RoleShell, with the page's content wrapper marked
 * `relative` so it paints above this (both are positioned, so document
 * order decides -- no z-index, and no reliance on the shell's stacking).
 *
 * Lives here because the Teacher pages are its only users today. If Admin
 * and Student get an ambience of their own, its natural home is RoleShell
 * itself, next to the canvas-glow it sits on top of -- and whoever moves it
 * should re-measure, since the two glows are what set the ceiling.
 */
const AMBIENCE = {
  dashboard: "opacity-30",
  // [&_*]:animate-none freezes AuroraBackdrop's drift from the outside; the
  // graphic has no "still" option of its own, and this pass reuses it as it
  // is rather than editing Graphics.tsx.
  working: "opacity-25 [&_*]:animate-none",
} as const;

export function TeacherAmbience({ level = "working" }: { level?: keyof typeof AMBIENCE }) {
  return <AuroraBackdrop className={cn("fixed", AMBIENCE[level])} />;
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
