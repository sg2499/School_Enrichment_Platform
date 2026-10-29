"use client";

/**
 * Class Analytics (#186, 26 Oct 2026), for a section's teacher and the
 * school's admin: a question-by-student grid for each practice set the
 * section was given, and the misconceptions the section holds in each
 * chapter, with a way to set the right practice for those students.
 *
 * The student's first handed-in attempt counts unless the reader switches
 * to the latest (after handing in, students see the right answers).
 */
import { useState } from "react";
import { ArrowLeft, ClipboardList, Users } from "lucide-react";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { useUrlState } from "@/lib/hooks/useUrlState";
import {
  assignHref,
  CELL_CLASS,
  CELL_LABEL,
  CELL_SYMBOL,
  cellText,
  flaggedText,
  percentCorrectText,
  questionTone,
  sectionName,
} from "@/lib/analytics";
import { formatDay } from "@/lib/tracker";
import { cn } from "@/lib/utils";
import { LoadError } from "@/components/ui/AlertBanner";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectField } from "@/components/ui/Field";
import { MastheadSelect } from "@/components/ui/MastheadSelect";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { TableSkeleton } from "@/components/ui/Table";
import { ACTIVITY_TYPE_LABEL } from "@/types/learning";
import type {
  AnalyticsSection,
  AnalyticsSet,
  AnalyticsSets,
  AttemptChoice,
  CellState,
  MisconceptionItem,
  MisconceptionReport,
  SetGrid,
} from "@/types/analytics";

type View = "sets" | "misconceptions";

const LEGEND: CellState[] = ["CORRECT", "PARTIAL", "WRONG", "BLANK", "PENDING"];

const TONE_TEXT = { low: "text-coral-700", mid: "text-saffron-800", high: "text-jade-700", none: "text-content-subtle" } as const;

function SetList({ sets, onOpen }: { sets: AnalyticsSet[]; onOpen: (id: string) => void }) {
  if (sets.length === 0) {
    return (
      <Card>
        <CardBody className="sm:p-7">
          <EmptyState
            title="No Practice Set Yet"
            description="Practice you assign to this section appears here once it is set, with a question-by-student grid of how it went."
          />
        </CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <ul className="divide-y divide-line">
        {sets.map((set) => (
          <li key={set.learningActivityId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-content">{set.title}</span>
              <span className="block text-xs text-content-subtle">
                {[
                  set.chapterNo ? `Chapter ${set.chapterNo}` : null,
                  ACTIVITY_TYPE_LABEL[set.activityType],
                  `${set.handedIn} of ${set.students} handed in`,
                  set.lastSetAt ? `Set ${formatDay(set.lastSetAt)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <Button type="button" size="sm" variant="tinted" onClick={() => onOpen(set.learningActivityId)}>
              Open Grid
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Grid({ grid }: { grid: SetGrid }) {
  const [shownQuestion, setShownQuestion] = useState<number | null>(null);
  if (grid.students.length === 0) {
    return (
      <Card className="p-6">
        <EmptyState title="Nobody Yet" description="No student in this section was given this set." />
      </Card>
    );
  }
  const question = shownQuestion !== null ? grid.questions[shownQuestion] : null;
  return (
    <div className="space-y-4">
      <ul className="flex flex-wrap gap-2 text-xs" aria-label="What the cells mean">
        {LEGEND.map((state) => (
          <li key={state} className="flex items-center gap-1.5">
            <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-md font-bold", CELL_CLASS[state])} aria-hidden="true">
              {CELL_SYMBOL[state]}
            </span>
            <span className="text-content-muted">{CELL_LABEL[state]}</span>
          </li>
        ))}
      </ul>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <caption className="sr-only">
              {grid.activity.title}: each student&apos;s answer to each question, {grid.attempt === "first" ? "first attempt" : "latest attempt"}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 min-w-[8.5rem] border-b sm:min-w-[12rem] border-line bg-surface px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-content-subtle">
                  Student
                </th>
                {grid.questions.map((q, i) => (
                  <th key={q.id} scope="col" className="border-b border-line bg-surface px-1 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => setShownQuestion(shownQuestion === i ? null : i)}
                      aria-pressed={shownQuestion === i}
                      title={q.stem}
                      className={cn(
                        "flex w-11 flex-col items-center rounded-lg px-1 py-1 hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
                        shownQuestion === i && "bg-surface-brand",
                      )}
                    >
                      <span className="text-xs font-semibold text-content">Q{q.number}</span>
                      <span className={cn("text-[0.6875rem] font-semibold tabular", TONE_TEXT[questionTone(q.percentCorrect)])}>
                        {percentCorrectText(q.percentCorrect)}
                      </span>
                    </button>
                  </th>
                ))}
                <th scope="col" className="border-b border-line bg-surface px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-content-subtle">
                  Score
                </th>
              </tr>
            </thead>
            <tbody>
              {grid.students.map((s) => (
                <tr key={s.id}>
                  <th scope="row" className="sticky left-0 z-10 border-b border-line bg-surface px-4 py-2 text-left font-normal">
                    <span className="block text-sm font-semibold text-content">{s.name ?? s.studentCode}</span>
                    <span className="block text-xs text-content-subtle">{s.studentCode}</span>
                  </th>
                  {s.cells.map((cell, i) => (
                    <td key={grid.questions[i].id} className="border-b border-line px-1 py-2 text-center">
                      <span
                        role="img"
                        aria-label={cellText(cell, i + 1)}
                        title={cellText(cell, i + 1)}
                        className={cn(
                          "mx-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold",
                          cell ? CELL_CLASS[cell.state] : "bg-ink-50 text-ink-300",
                        )}
                      >
                        {cell ? CELL_SYMBOL[cell.state] : "·"}
                      </span>
                    </td>
                  ))}
                  <td className="border-b border-line px-4 py-2 text-right text-sm font-semibold tabular text-content">
                    {s.handedIn ? `${s.score} / ${s.possible}` : <span className="font-normal text-content-subtle">Not handed in</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {question ? (
        <Card>
          <CardBody className="space-y-2 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle">
              Question {question.number} · {question.questionType} · {question.marks} {question.marks === 1 ? "mark" : "marks"}
            </p>
            <p className="text-sm text-content">{question.stem}</p>
            <p className="text-sm text-content-muted">
              Skill: {question.skillTitle} · {percentCorrectText(question.percentCorrect)} of {question.answered}{" "}
              {question.answered === 1 ? "student" : "students"} got it fully right
            </p>
            {question.misconception ? (
              <p className="text-sm text-content-muted">Common mistake: {question.misconception}</p>
            ) : null}
          </CardBody>
        </Card>
      ) : (
        <p className="text-xs text-content-subtle">Choose a question number to see the question, its skill and its common mistake.</p>
      )}
    </div>
  );
}

function MisconceptionCard({
  item,
  index,
  chapterId,
  section,
  canAssign,
}: {
  item: MisconceptionItem;
  index: number;
  chapterId: string;
  section: AnalyticsSection;
  canAssign: boolean;
}) {
  const [open, setOpen] = useState(false);
  const listId = `mc-${index}`;
  // Practice is set only for students in this section today.
  const here = item.students.filter((s) => s.inSection);
  const away = item.students.length - here.length;
  return (
    <Card as="li">
      <CardBody className="space-y-3 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold text-content">
              {flaggedText(item.students.length, item.studentsAnswered)}
            </p>
            <p className="text-sm text-content">{item.misconception}</p>
            {item.nextStep ? (
              <p className="mt-1 text-sm text-content-muted">
                <span className="font-semibold text-content">Next Step:</span> {item.nextStep}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-content-subtle">
              {item.skill.title} · {item.questionsAsked}{" "}
              {item.questionsAsked === 1 ? "question" : "questions"} that test it
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            leadingIcon={<Users className="h-3.5 w-3.5" />}
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen(!open)}
          >
            {open ? "Hide Students" : "Show Students"}
          </Button>
        </div>
        {open ? (
          <ul id={listId} className="grid gap-1 sm:grid-cols-2" aria-label="Students with this mistake">
            {item.students.map((s) => (
              <li key={s.id} className="rounded-xl bg-surface-muted px-3 py-2 text-sm">
                <span className="font-semibold text-content">{s.name ?? s.studentCode}</span>
                <span className="text-content-subtle">
                  {" "}
                  · missed {s.missed} of {s.answered}
                  {s.inSection ? "" : " · no longer in this section"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {canAssign && here.length > 0 ? (
          item.practiceSet ? (
            <div className="flex flex-wrap items-center gap-3">
              <ButtonLink
                href={assignHref({
                  chapterId,
                  learningActivityId: item.practiceSet.learningActivityId,
                  section,
                  studentIds: here.map((s) => s.id),
                })}
                size="sm"
                variant="secondary"
                leadingIcon={<ClipboardList className="h-3.5 w-3.5" />}
              >
                Set Practice for These Students
              </ButtonLink>
              <span className="text-xs text-content-subtle">
                {item.practiceSet.title}
                {away > 0 ? `, for the ${here.length} still in this section` : ""}. You check it before it&apos;s assigned.
              </span>
            </div>
          ) : (
            <p className="text-xs text-content-subtle">
              This skill has no published Remediation or Extra Practice set yet, so there&apos;s nothing to set from here.
            </p>
          )
        ) : null}
      </CardBody>
    </Card>
  );
}

function Misconceptions({
  report,
  section,
  canAssign,
}: {
  report: MisconceptionReport;
  section: AnalyticsSection;
  canAssign: boolean;
}) {
  const flagged = report.misconceptions.filter((m) => m.students.length > 0);
  const clear = report.misconceptions.filter((m) => m.students.length === 0);
  const waiting = report.awaitingReview ?? 0;
  const waitingNote =
    waiting > 0 ? (
      <p className="text-xs text-content-subtle">
        {waiting} more {waiting === 1 ? "mistake" : "mistakes"} made by students here{" "}
        {waiting === 1 ? "is" : "are"} waiting for our subject expert&apos;s review and will show once approved.
      </p>
    ) : null;
  if (report.misconceptions.length === 0) {
    return (
      <div className="space-y-4">
        <Card className="p-6">
          <EmptyState
            title={waiting > 0 ? "Notes Being Reviewed" : (report.heldForReview ?? 0) > 0 ? "No Pattern Yet" : "Nothing Answered Yet"}
            description={
              waiting === 0 && (report.heldForReview ?? 0) > 0
                ? `No student has missed ${report.missedThreshold} or more questions testing the same mistake in this chapter.`
                : waiting > 0
                ? `Students here show ${waiting} ${waiting === 1 ? "mistake" : "mistakes"} in this chapter whose ${waiting === 1 ? "note is" : "notes are"} still being checked by our subject expert. They appear here once approved.`
                : "Once this section hands in practice from this chapter, or a mock paper on it has its results out, the mistakes it makes most appear here."
            }
          />
        </Card>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {flagged.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            title="No Pattern Yet"
            description={`No student has missed ${report.missedThreshold} or more questions testing the same mistake in this chapter.`}
          />
        </Card>
      ) : (
        <ol className="space-y-3">
          {flagged.map((item, index) => (
            <MisconceptionCard
              key={`${item.skill.id}-${item.misconception}`}
              item={item}
              index={index}
              chapterId={report.chapter.id}
              section={section}
              canAssign={canAssign}
            />
          ))}
        </ol>
      )}
      {clear.length > 0 ? (
        <p className="text-xs text-content-subtle">
          {clear.length} more {clear.length === 1 ? "mistake was" : "mistakes were"} tested with no student missing{" "}
          {report.missedThreshold} or more.
        </p>
      ) : null}
      {waitingNote}
    </div>
  );
}

export function ClassAnalytics({ role }: { role: "TEACHER" | "ADMIN" | "SUPER_ADMIN" }) {
  const url = useUrlState();
  const scope = url.get("scope") ?? "";
  const view: View = url.get("view") === "misconceptions" ? "misconceptions" : "sets";
  const attempt: AttemptChoice = url.get("attempt") === "latest" ? "latest" : "first";
  const setId = url.get("set") ?? "";

  const sections = useApiQuery<{ sections: AnalyticsSection[] }>(
    role === "SUPER_ADMIN" ? null : "/learning/analytics/sections",
    {},
    { action: "load your sections" },
  );
  const list = sections.problem ? null : (sections.data?.sections ?? null);
  const section = list?.find((s) => s.key === scope) ?? list?.[0] ?? null;
  const activeScope = section?.key ?? "";

  const sets = useApiQuery<AnalyticsSets>(
    activeScope ? "/learning/analytics/sets" : null,
    { scope: activeScope },
    { action: "load this section's practice" },
  );
  // useApiQuery keeps the last answer while the next one loads: only an
  // answer for the section on screen is shown (#186 review).
  const setsData = !sets.problem && sets.data?.scope === activeScope ? sets.data : null;
  const chapterId = url.get("chapter") ?? setsData?.chapters[0]?.id ?? "";

  const grid = useApiQuery<SetGrid>(
    activeScope && view === "sets" && setId ? `/learning/analytics/sets/${setId}` : null,
    { scope: activeScope, attempt },
    { action: "open this practice set's grid" },
  );
  const report = useApiQuery<MisconceptionReport>(
    activeScope && view === "misconceptions" && chapterId ? `/learning/analytics/chapters/${chapterId}/misconceptions` : null,
    { scope: activeScope, attempt },
    { action: "load this chapter's misconceptions" },
  );

  // A teacher sets practice from the report only for a section they teach now.
  const canAssign = role === "TEACHER" && Boolean(section?.isCurrent);
  const chosenSet = setsData?.sets.find((s) => s.learningActivityId === setId) ?? null;

  return (
    <div className="space-y-8">
      <PageHeader
        surface="masthead"
        eyebrow="Insight"
        title="Class Analytics"
        description="How a section did on each question, and the mistakes it makes most, from the practice and mock papers it has handed in."
        stats={[
          { label: "Practice Sets", value: sets.problem ? "—" : setsData ? setsData.sets.length : activeScope ? null : "—" },
          { label: "Chapters", value: sets.problem ? "—" : setsData ? setsData.chapters.length : activeScope ? null : "—" },
        ]}
      >
        <MastheadSelect
          label="Section"
          helper={role === "TEACHER" ? "One of the sections you teach or taught." : "Any section in your school."}
          value={activeScope}
          disabled={!list || list.length === 0}
          error={sections.error}
          onChange={(e) => url.set({ scope: e.target.value, set: null, chapter: null }, { push: true })}
        >
          {!list ? <option value="">Loading sections…</option> : null}
          {list && list.length === 0 ? <option value="">No sections yet</option> : null}
          {(list ?? []).map((s) => (
            <option key={s.key} value={s.key}>
              {sectionName(s)}
              {s.isCurrent ? "" : " (earlier)"}
            </option>
          ))}
        </MastheadSelect>
      </PageHeader>

      {role === "SUPER_ADMIN" ? (
        <Card className="p-6">
          <EmptyState
            title="One School at a Time"
            description="Class Analytics shows a school's own sections. Sign in as that school's admin to see them."
          />
        </Card>
      ) : null}
      {sections.problem ? <LoadError problem={sections.problem} onRetry={sections.reload} /> : null}

      {list && list.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            title="No Section Yet"
            description={
              role === "TEACHER"
                ? "Class Analytics shows the sections you teach. Your school admin assigns them."
                : "Class Analytics shows each section once teachers are assigned to it or practice is set for it."
            }
          />
        </Card>
      ) : null}

      {section ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SegmentedControl<View>
              label="What to show"
              segments={[
                { key: "sets", label: "Practice Sets" },
                { key: "misconceptions", label: "Misconceptions" },
              ]}
              value={view}
              onChange={(next) => url.set({ view: next === "sets" ? null : next }, { push: true })}
            />
            <SegmentedControl<AttemptChoice>
              label="Which attempt"
              segments={[
                { key: "first", label: "First Attempt" },
                { key: "latest", label: "Latest Attempt" },
              ]}
              value={attempt}
              onChange={(next) => url.set({ attempt: next === "first" ? null : next })}
            />
          </div>
          <p className="-mt-4 text-xs text-content-subtle">
            {attempt === "first"
              ? "First attempts show what students understood before they saw the right answers."
              : "Latest attempts show where students are now, after seeing their results."}
          </p>

          {sets.problem ? <LoadError problem={sets.problem} onRetry={sets.reload} /> : null}

          {view === "sets" ? (
            setId ? (
              <section aria-labelledby="grid-heading" className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 id="grid-heading" className="font-display text-display-sm text-content">
                    {chosenSet?.title ?? grid.data?.activity.title ?? "Practice Set"}
                  </h2>
                  <Button type="button" size="sm" variant="ghost" leadingIcon={<ArrowLeft className="h-3.5 w-3.5" />} onClick={() => url.set({ set: null }, { push: true })}>
                    All Practice Sets
                  </Button>
                </div>
                {grid.problem ? (
                  <LoadError problem={grid.problem} onRetry={grid.reload} />
                ) : grid.data && grid.data.scope === activeScope && grid.data.activity.id === setId && grid.data.attempt === attempt ? (
                  <Grid grid={grid.data} />
                ) : (
                  <TableSkeleton label="Loading the grid" rows={5} />
                )}
              </section>
            ) : setsData ? (
              <section aria-labelledby="sets-heading" className="space-y-4">
                <h2 id="sets-heading" className="font-display text-display-sm text-content">
                  Practice Sets
                </h2>
                <SetList sets={setsData.sets} onOpen={(id) => url.set({ set: id }, { push: true })} />
              </section>
            ) : (
              <TableSkeleton label="Loading this section's practice" rows={4} />
            )
          ) : (
            <section aria-labelledby="mc-heading" className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 id="mc-heading" className="font-display text-display-sm text-content">
                    Misconceptions
                  </h2>
                  <p className="mt-1 text-sm text-content-muted">
                    A student counts when they missed {report.data?.missedThreshold ?? 2} or more questions that test the same mistake,
                    so one slip isn&apos;t a pattern.
                  </p>
                </div>
                {setsData && setsData.chapters.length > 0 ? (
                  <SelectField
                    label="Chapter"
                    containerClassName="sm:w-72"
                    value={chapterId}
                    onChange={(e) => url.set({ chapter: e.target.value }, { push: true })}
                  >
                    {setsData.chapters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.chapterNo ? `Chapter ${c.chapterNo}: ` : ""}
                        {c.title}
                      </option>
                    ))}
                  </SelectField>
                ) : null}
              </div>
              {sets.problem ? null : setsData && setsData.chapters.length === 0 ? (
                <Card className="p-6">
                  <EmptyState title="No Practice Yet" description="Misconceptions appear once this section has handed in practice or a mock paper." />
                </Card>
              ) : report.problem ? (
                <LoadError problem={report.problem} onRetry={report.reload} />
              ) : report.data && report.data.scope === activeScope && report.data.chapter.id === chapterId && report.data.attempt === attempt ? (
                <Misconceptions report={report.data} section={section} canAssign={canAssign} />
              ) : (
                <TableSkeleton label="Loading misconceptions" rows={3} />
              )}
            </section>
          )}
        </>
      ) : null}
    </div>
  );
}
