"use client";

/**
 * The skill map (#184): every skill of the student's chapters, grouped by
 * chapter, each with its score and band. Shared by the student's My
 * Progress page and the teacher's student page in the Practice Tracker.
 * Bands come from the server; the bar's width is the skill's %, and the
 * band is always said in words beside it, so colour never carries it alone.
 */
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterChips } from "@/components/ui/FilterChips";
import { SearchInput } from "@/components/ui/SearchInput";
import {
  answeredText,
  BAND_BAR,
  BAND_LABEL,
  BAND_TONE,
  chapterCounts,
  chapterStarted,
  filterChapters,
  percentText,
  standingText,
} from "@/lib/progress";
import { cn } from "@/lib/utils";
import type { ChapterProgress, ProgressSummary, SkillBand, SkillProgress } from "@/types/progress";

type BandFilter = SkillBand | "ALL";

function SkillRow({ skill }: { skill: SkillProgress }) {
  const width = skill.percent === null ? 0 : Math.max(2, Math.min(100, skill.percent));
  return (
    <li className="grid gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-center">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-content">{skill.title}</span>
        <span className="block text-xs text-content-subtle">
          <span className="font-mono">{skill.code}</span> · {answeredText(skill.answered)}
        </span>
      </span>
      <span className="flex items-center gap-3">
        <span className="h-2 w-full overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
          <span className={cn("block h-full rounded-full", BAND_BAR[skill.band])} style={{ width: `${width}%` }} />
        </span>
        <span className="w-10 shrink-0 text-right text-sm font-semibold tabular text-content">{percentText(skill.percent)}</span>
      </span>
      <span className="sm:justify-self-end">
        <Badge tone={BAND_TONE[skill.band]} size="sm">
          {BAND_LABEL[skill.band]}
        </Badge>
      </span>
    </li>
  );
}

function ChapterCard({
  chapter,
  open,
  onToggle,
  classLabel,
}: {
  chapter: ChapterProgress;
  open: boolean;
  onToggle: () => void;
  classLabel?: string | null;
}) {
  const counts = chapterCounts(chapter);
  const id = `chapter-${chapter.id}`;
  return (
    <Card as="li" className="overflow-hidden">
      {/* font-sans: the heading's own display face is for the chapter's
          name alone, not for the band chips beside it. */}
      <h3 className="font-sans">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 sm:px-6"
        >
          <span className="min-w-0">
            <span className="block text-xs font-semibold uppercase tracking-wide text-content-subtle">Chapter {chapter.chapterNo}</span>
            <span className="block font-display text-base font-semibold text-content">{chapter.title}</span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            {chapter.standing ? (
              <Badge tone="brand" size="sm">
                {standingText(chapter.standing, classLabel)}
              </Badge>
            ) : null}
            {counts.map(({ band, count }) => (
              <Badge key={band} tone={BAND_TONE[band]} size="sm">
                {count} {BAND_LABEL[band]}
              </Badge>
            ))}
            <ChevronDown className={cn("h-4 w-4 text-content-subtle transition-transform", open && "rotate-180")} aria-hidden="true" />
          </span>
        </button>
      </h3>
      {open ? (
        <ul id={id} className="divide-y divide-line border-t border-line" aria-label={`Skills in ${chapter.title}`}>
          {chapter.skills.map((skill) => (
            <SkillRow key={skill.id} skill={skill} />
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

export function SkillMap({
  chapters,
  summary,
  emptyText,
  classLabel,
}: {
  chapters: ChapterProgress[];
  summary: ProgressSummary;
  emptyText: string;
  /** #185: names the class in a chapter's standing ("Top 25% of Class 5"). */
  classLabel?: string | null;
}) {
  const [band, setBand] = useState<BandFilter>("ALL");
  const [search, setSearch] = useState("");
  // Which chapters are open: those with anything practised, until the
  // reader opens or closes one.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const shown = useMemo(() => filterChapters(chapters, search, band), [chapters, search, band]);
  const filtering = band !== "ALL" || search.trim() !== "";

  if (chapters.length === 0) {
    return (
      <Card className="p-6">
        <EmptyState title="No Skills Yet" description={emptyText} />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterChips<BandFilter>
          label="Show skills"
          value={band}
          onChange={setBand}
          options={[
            { value: "ALL", label: "All", count: summary.skills },
            { value: "NEEDS_WORK", label: BAND_LABEL.NEEDS_WORK, count: summary.needsWork },
            { value: "GETTING_THERE", label: BAND_LABEL.GETTING_THERE, count: summary.gettingThere },
            { value: "STRONG", label: BAND_LABEL.STRONG, count: summary.strong },
            { value: "JUST_STARTED", label: BAND_LABEL.JUST_STARTED, count: summary.justStarted },
            { value: "NOT_STARTED", label: BAND_LABEL.NOT_STARTED, count: summary.notStarted },
          ]}
        />
        <SearchInput label="Find a skill" placeholder="Skill name or code" value={search} onSearch={setSearch} delayMs={150} className="sm:w-64" />
      </div>
      {shown.length === 0 ? (
        <Card className="p-6">
          <EmptyState title="No Skills Match" description="Try another band, or clear the search." />
        </Card>
      ) : (
        <ol className="space-y-3">
          {shown.map((chapter) => {
            const open = toggled[chapter.id] ?? (filtering || chapterStarted(chapter));
            return (
              <ChapterCard
                key={chapter.id}
                chapter={chapter}
                open={open}
                classLabel={classLabel}
                onToggle={() => setToggled((prev) => ({ ...prev, [chapter.id]: !open }))}
              />
            );
          })}
        </ol>
      )}
    </div>
  );
}
