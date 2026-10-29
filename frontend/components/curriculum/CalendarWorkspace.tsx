"use client";

/**
 * A school's curriculum calendar in Curriculum Studio (#212, 29 Oct 2026):
 * which published chapters each class follows, and when. A school's admin
 * sees their own; the Super Admin chooses a school. Grouped by class, each
 * entry with where it stands today, its dates to change and a way to take
 * it out. Adding a chapter is one pop-up (AddToCalendar), also opened from
 * the Published Chapters list with the chapter already chosen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, CalendarRange, Pencil, Plus, Trash2 } from "lucide-react";
import {
  ErrorBanner,
  TIMING_LABEL,
  TIMING_TONE,
  countOf,
  formatPlannedDay,
  mapTiming,
  todayIso,
  useCurriculumFilterLookups,
  type MapTiming,
} from "@/components/curriculum/shared";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectField, TextField } from "@/components/ui/Field";
import { FilterChips } from "@/components/ui/FilterChips";
import { Modal } from "@/components/ui/Modal";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { api, errorMessage } from "@/lib/api";
import { classLabel } from "@/lib/utils";
import type { ChapterSummary, SchoolCurriculumMapEntry, SchoolOption } from "@/types/curriculum";

/** The cascading Board -> Class -> Subject -> Chapter form, with dates. */
export function AddToCalendar({
  open,
  onClose,
  onAdded,
  schoolId,
  preset,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  /** The Super Admin's chosen school; omitted for a school's own admin. */
  schoolId?: string;
  /** Opened from a chapter's row: that chapter, already chosen. */
  preset?: ChapterSummary | null;
}) {
  const { boards, disciplines, boardCourses, classLevelsForBoard, error: lookupError } = useCurriculumFilterLookups();
  const [boardId, setBoardId] = useState("");
  const [classLevelId, setClassLevelId] = useState("");
  const [disciplineId, setDisciplineId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [chapters, setChapters] = useState<ChapterSummary[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const classes = useMemo(() => classLevelsForBoard(boardId), [classLevelsForBoard, boardId]);

  // Opening from a chapter's row fills in its board, class and subject.
  useEffect(() => {
    if (!open) return;
    setProblem(null);
    if (preset) {
      const course = boardCourses.find((bc) => bc.id === preset.boardCourseId);
      setBoardId(course?.boardId ?? "");
      setClassLevelId(course?.classLevelId ?? "");
      setDisciplineId(preset.disciplineId);
      setChapterId(preset.id);
    }
  }, [open, preset, boardCourses]);

  useEffect(() => {
    if (!open || !boardId || !classLevelId || !disciplineId) {
      setChapters([]);
      return;
    }
    let cancelled = false;
    setLoadingChapters(true);
    api
      .get<{ chapters: ChapterSummary[] }>("/curriculum-admin/chapters", {
        params: { board_id: boardId, class_level_id: classLevelId, discipline_id: disciplineId },
      })
      .then(({ data }) => {
        if (!cancelled) setChapters(data.chapters.filter((c) => c.status === "PUBLISHED"));
      })
      .catch((err) => {
        if (!cancelled) setProblem(errorMessage(err, "load the published chapters"));
      })
      .finally(() => {
        if (!cancelled) setLoadingChapters(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, boardId, classLevelId, disciplineId]);

  function reset() {
    setBoardId("");
    setClassLevelId("");
    setDisciplineId("");
    setChapterId("");
    setStart("");
    setEnd("");
    setProblem(null);
  }

  function close() {
    if (saving) return;
    reset();
    onClose();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const chapter = chapters.find((c) => c.id === chapterId);
    if (!chapter) {
      setProblem("Choose a board, class, subject and chapter.");
      return;
    }
    if (start && end && end < start) {
      setProblem("The planned end is before the planned start.");
      return;
    }
    const classLevel = classes.find((c) => c.id === classLevelId);
    setSaving(true);
    setProblem(null);
    try {
      await api.post("/curriculum-admin/school-curriculum-maps", {
        schoolId,
        boardCourseId: chapter.boardCourseId,
        chapterId,
        className: classLevel?.code ?? null,
        plannedStartDate: start || null,
        plannedEndDate: end || null,
      });
      onAdded();
      setSaving(false);
      reset();
      onClose();
    } catch (err) {
      setProblem(errorMessage(err, "add this chapter to the calendar"));
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title="Add a Chapter to the Calendar"
      footer={
        <>
          <Button type="button" variant="ghost" disabled={saving} onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="add-to-calendar"
            loading={saving}
            loadingLabel="Adding"
            leadingIcon={<CalendarPlus className="h-4 w-4" />}
          >
            Add to Calendar
          </Button>
        </>
      }
    >
      <form id="add-to-calendar" className="space-y-4" onSubmit={submit}>
        <p className="text-sm text-content-muted">
          The whole class follows it, every section. Its teachers can then assign practice from it.
        </p>
        {lookupError ? <ErrorBanner message={lookupError} /> : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField
            label="Board"
            value={boardId}
            onChange={(e) => {
              setBoardId(e.target.value);
              setClassLevelId("");
              setChapterId("");
            }}
            required
          >
            <option value="" disabled>
              Choose a board
            </option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Class"
            value={classLevelId}
            onChange={(e) => {
              setClassLevelId(e.target.value);
              setChapterId("");
            }}
            disabled={!boardId}
            required
          >
            <option value="" disabled>
              {boardId ? "Choose a class" : "Choose a board first"}
            </option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Subject"
            value={disciplineId}
            onChange={(e) => {
              setDisciplineId(e.target.value);
              setChapterId("");
            }}
            required
          >
            <option value="" disabled>
              Choose a subject
            </option>
            {disciplines.map((d) => (
              <option key={d.id} value={d.id}>
                {d.displayName}
              </option>
            ))}
          </SelectField>
        </div>
        <SelectField
          label="Chapter"
          value={chapterId}
          onChange={(e) => setChapterId(e.target.value)}
          disabled={!boardId || !classLevelId || !disciplineId || loadingChapters}
          required
        >
          <option value="" disabled>
            {loadingChapters
              ? "Loading chapters…"
              : !boardId || !classLevelId || !disciplineId
                ? "Choose the board, class and subject first"
                : chapters.length === 0
                  ? "No published chapter for this class and subject yet"
                  : "Choose a published chapter"}
          </option>
          {chapters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} · {c.title}
            </option>
          ))}
        </SelectField>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Planned Start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <TextField label="Planned End" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        {problem ? <ErrorBanner message={problem} /> : null}
      </form>
    </Modal>
  );
}

function DatesModal({ entry, onClose, onSaved }: { entry: SchoolCurriculumMapEntry | null; onClose: () => void; onSaved: () => void }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setStart(entry?.plannedStartDate ?? "");
    setEnd(entry?.plannedEndDate ?? "");
    setProblem(null);
  }, [entry]);

  async function save() {
    if (!entry) return;
    if (start && end && end < start) {
      setProblem("The planned end is before the planned start.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await api.patch(`/curriculum-admin/school-curriculum-maps/${entry.id}`, {
        plannedStartDate: start || null,
        plannedEndDate: end || null,
      });
      onSaved();
      onClose();
    } catch (err) {
      setProblem(errorMessage(err, "save the new dates"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={entry !== null}
      onClose={() => (busy ? undefined : onClose())}
      size="sm"
      title={entry ? `Dates for ${entry.chapterTitle ?? "this chapter"}` : ""}
      footer={
        <>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" loading={busy} loadingLabel="Saving" onClick={() => void save()}>
            Save Dates
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-content-muted">Move the dates for a holiday, an election or anything else that shifts the term.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Planned Start" type="date" value={start} onChange={(e) => setStart(e.target.value)} disabled={busy} />
          <TextField label="Planned End" type="date" value={end} onChange={(e) => setEnd(e.target.value)} disabled={busy} />
        </div>
        {problem ? <ErrorBanner message={problem} /> : null}
      </div>
    </Modal>
  );
}

type TimingFilter = MapTiming | "all";

export function CalendarWorkspace({
  isPlatformAdmin,
  onChanged,
  schoolId,
  onSchoolChange,
}: {
  isPlatformAdmin: boolean;
  onChanged: () => void;
  /** Super Admin: the chosen school (kept in the address by the page). */
  schoolId?: string;
  onSchoolChange?: (id: string) => void;
}) {
  const { boardCourses } = useCurriculumFilterLookups();
  const [schools, setSchools] = useState<SchoolOption[] | null>(isPlatformAdmin ? null : []);
  const [entries, setEntries] = useState<SchoolCurriculumMapEntry[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SchoolCurriculumMapEntry | null>(null);
  const [removing, setRemoving] = useState<SchoolCurriculumMapEntry | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [timing, setTiming] = useState<TimingFilter>("all");
  const ready = !isPlatformAdmin || Boolean(schoolId);
  const today = todayIso();

  useEffect(() => {
    if (!isPlatformAdmin) return;
    api
      .get<{ schools: SchoolOption[] }>("/curriculum-admin/schools")
      .then(({ data }) => setSchools(data.schools))
      .catch((err) => setProblem(errorMessage(err, "load the list of schools")));
  }, [isPlatformAdmin]);

  const latest = useRef(0);
  const load = useCallback(async () => {
    if (!ready) return;
    const ticket = ++latest.current;
    setProblem(null);
    try {
      const { data } = await api.get<{ schoolCurriculumMaps: SchoolCurriculumMapEntry[] }>("/curriculum-admin/school-curriculum-maps", {
        params: isPlatformAdmin ? { schoolId } : undefined,
      });
      // Only the school chosen last: a slow answer for another school is dropped.
      if (ticket === latest.current) setEntries(data.schoolCurriculumMaps);
    } catch (err) {
      if (ticket === latest.current) setProblem(errorMessage(err, "load the calendar"));
    }
  }, [ready, isPlatformAdmin, schoolId]);

  useEffect(() => {
    setEntries(null);
    void load();
  }, [load]);

  async function remove() {
    if (!removing) return;
    setRemoveBusy(true);
    setProblem(null);
    try {
      await api.delete(`/curriculum-admin/school-curriculum-maps/${removing.id}`);
      setRemoving(null);
      await load();
      onChanged();
    } catch (err) {
      setProblem(errorMessage(err, "take this chapter out of the calendar"));
      setRemoving(null);
    } finally {
      setRemoveBusy(false);
    }
  }

  const courseName = (id: string) => boardCourses.find((bc) => bc.id === id)?.displayName ?? "";
  const all = entries ?? [];
  const counts: Record<TimingFilter, number> = { all: all.length, running: 0, upcoming: 0, finished: 0, undated: 0 };
  for (const e of all) counts[mapTiming(e, today)] += 1;
  const shown = all.filter((e) => timing === "all" || mapTiming(e, today) === timing);
  const byClass = new Map<string, SchoolCurriculumMapEntry[]>();
  for (const e of shown) {
    const key = e.className ?? "";
    byClass.set(key, [...(byClass.get(key) ?? []), e]);
  }
  const classes = [...byClass.keys()].sort((a, b) => (Number(a) || 99) - (Number(b) || 99) || a.localeCompare(b));
  const schoolName = schools?.find((s) => s.id === schoolId)?.name;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <CardTitle>
            {isPlatformAdmin ? (schoolName ? `${schoolName}'s Calendar` : "A School's Calendar") : "Your School's Calendar"}
          </CardTitle>
          <CardDescription>Which published chapters each class follows, and when. Teachers assign practice from these.</CardDescription>
        </div>
        {ready ? (
          <Button type="button" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
            Add a Chapter
          </Button>
        ) : null}
      </CardHeader>
      <CardBody className="space-y-5">
        {isPlatformAdmin ? (
          <SelectField
            label="School"
            containerClassName="max-w-md"
            value={schoolId ?? ""}
            onChange={(e) => onSchoolChange?.(e.target.value)}
            disabled={!schools}
          >
            <option value="" disabled>
              {!schools ? "Loading schools…" : schools.length === 0 ? "No schools yet" : "Choose a school"}
            </option>
            {(schools ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.board ? ` · ${s.board}` : ""}
                {s.city ? ` · ${s.city}` : ""}
              </option>
            ))}
          </SelectField>
        ) : null}

        {problem ? <ErrorBanner message={problem} /> : null}

        {!ready ? (
          <EmptyState
            status={{ label: "No School Chosen", tone: "neutral" }}
            title="Choose a school"
            description="Its calendar opens here, and you can add chapters to it without signing in as its admin."
          />
        ) : entries === null && !problem ? (
          <TableSkeleton label="Loading the calendar" rows={4} />
        ) : all.length === 0 ? (
          <EmptyState
            status={{ label: "Nothing in the Calendar", tone: "neutral" }}
            title="No chapters in the calendar yet"
            description="Add a published chapter to a class. Its teachers can then assign practice from it."
          />
        ) : (
          <>
            <FilterChips
              label="Which chapters"
              value={timing}
              onChange={setTiming}
              options={(["all", "running", "upcoming", "undated", "finished"] as TimingFilter[]).map((k) => ({
                value: k,
                label: k === "all" ? "All" : TIMING_LABEL[k],
                count: counts[k],
              }))}
            />
            {shown.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-content-subtle">
                None in the calendar right now.
              </p>
            ) : (
              classes.map((cls) => (
                <section key={cls || "none"} aria-label={classLabel(cls) ?? "No class"} className="space-y-2">
                  <h3 className="flex items-baseline gap-2 font-semibold text-content">
                    {classLabel(cls) ?? "No Class"}
                    <span className="text-xs font-normal text-content-subtle">{countOf(byClass.get(cls)!.length, "chapter")}</span>
                  </h3>
                  <Table caption={`${classLabel(cls) ?? "No class"} calendar`} minWidth="46rem">
                    <THead>
                      <TH>Chapter</TH>
                      <TH>Dates</TH>
                      <TH>Now</TH>
                      <TH align="right">
                        <span className="sr-only">Actions</span>
                      </TH>
                    </THead>
                    <TBody>
                      {byClass.get(cls)!.map((e) => {
                        const start = formatPlannedDay(e.plannedStartDate);
                        const end = formatPlannedDay(e.plannedEndDate);
                        const when = mapTiming(e, today);
                        const title = e.chapterTitle ?? "Chapter";
                        return (
                          <TR key={e.id}>
                            <TD>
                              <span className="font-semibold text-content">{title}</span>
                              <span className="block text-xs text-content-subtle">
                                {[e.chapterCode, courseName(e.boardCourseId)].filter(Boolean).join(" · ")}
                              </span>
                            </TD>
                            <TD className="tabular">
                              {start || end ? (
                                <span className="inline-flex items-center gap-1.5 text-content-muted">
                                  <CalendarRange className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                  {`${start ?? "No start"} → ${end ?? "No end"}`}
                                </span>
                              ) : (
                                <span className="text-content-faint" aria-label="No dates set">
                                  —
                                </span>
                              )}
                            </TD>
                            <TD>
                              <Badge tone={TIMING_TONE[when]} size="sm">
                                {TIMING_LABEL[when]}
                              </Badge>
                            </TD>
                            <TD align="right">
                              <span className="flex justify-end gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  aria-label={`Change the dates for ${title}`}
                                  leadingIcon={<Pencil className="h-4 w-4" />}
                                  onClick={() => setEditing(e)}
                                >
                                  Dates
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  aria-label={`Take ${title} out of the calendar`}
                                  leadingIcon={<Trash2 className="h-4 w-4" />}
                                  onClick={() => setRemoving(e)}
                                >
                                  Remove
                                </Button>
                              </span>
                            </TD>
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                </section>
              ))
            )}
          </>
        )}
      </CardBody>

      <AddToCalendar
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={() => {
          void load();
          onChanged();
        }}
        schoolId={isPlatformAdmin ? schoolId : undefined}
      />
      <DatesModal
        entry={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          void load();
          onChanged();
        }}
      />
      <Modal
        open={removing !== null}
        onClose={() => (removeBusy ? undefined : setRemoving(null))}
        size="sm"
        title="Take It Out of the Calendar?"
        footer={
          <>
            <Button type="button" variant="ghost" disabled={removeBusy} onClick={() => setRemoving(null)}>
              Keep It
            </Button>
            <Button type="button" variant="danger" loading={removeBusy} loadingLabel="Removing" onClick={() => void remove()}>
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-content">
          {removing?.chapterTitle ?? "This chapter"} comes out of {removing?.className ? `${classLabel(removing.className)}'s` : "the"}{" "}
          calendar. Teachers won&apos;t be able to assign new practice from it. The chapter itself isn&apos;t changed.
        </p>
      </Modal>
    </Card>
  );
}

/** A school admin's Published Chapters tab: everything they can add, and what is already in their calendar. */
export function PublishedChapters({ onChanged }: { onChanged: () => void }) {
  const { boardCourses } = useCurriculumFilterLookups();
  const [chapters, setChapters] = useState<ChapterSummary[] | null>(null);
  const [entries, setEntries] = useState<SchoolCurriculumMapEntry[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [preset, setPreset] = useState<ChapterSummary | null>(null);

  const load = useCallback(async () => {
    setProblem(null);
    try {
      const [c, m] = await Promise.all([
        api.get<{ chapters: ChapterSummary[] }>("/curriculum-admin/chapters"),
        api.get<{ schoolCurriculumMaps: SchoolCurriculumMapEntry[] }>("/curriculum-admin/school-curriculum-maps"),
      ]);
      setChapters(c.data.chapters);
      setEntries(m.data.schoolCurriculumMaps);
    } catch (err) {
      setProblem(errorMessage(err, "load the published chapters"));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const inCalendar = (id: string) =>
    entries
      .filter((e) => e.chapterId === id)
      .map((e) => (e.className ? classLabel(e.className) : "a class"))
      .join(", ");

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1.5">
        <CardTitle>Published Chapters</CardTitle>
        <CardDescription>
          Every chapter the Krama team has published for your school&apos;s board, and whether it is in your calendar.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-4">
        {problem ? <ErrorBanner message={problem} /> : null}
        {chapters === null && !problem ? (
          <TableSkeleton label="Loading the published chapters" rows={4} />
        ) : chapters && chapters.length === 0 ? (
          <EmptyState
            status={{ label: "Nothing Published Yet", tone: "neutral" }}
            title="No published chapters yet"
            description="Chapters appear here once the Krama team publishes them."
          />
        ) : chapters ? (
          <Table caption="Published chapters" minWidth="44rem">
            <THead>
              <TH className="w-12">No.</TH>
              <TH>Chapter</TH>
              <TH align="right">Lessons</TH>
              <TH>In Your Calendar</TH>
              <TH align="right">
                <span className="sr-only">Actions</span>
              </TH>
            </THead>
            <TBody>
              {chapters.map((c) => {
                const where = inCalendar(c.id);
                return (
                  <TR key={c.id}>
                    <TD className="tabular text-content-subtle">{c.chapterNo}</TD>
                    <TD>
                      <span className="font-semibold text-content">{c.title}</span>
                      <span className="block text-xs text-content-subtle">
                        {[c.code, boardCourses.find((bc) => bc.id === c.boardCourseId)?.displayName].filter(Boolean).join(" · ")}
                      </span>
                    </TD>
                    <TD align="right" className="tabular">
                      {c.conceptLessonCount}
                    </TD>
                    <TD>
                      {where ? (
                        <Badge tone="success" size="sm">
                          {where}
                        </Badge>
                      ) : (
                        <span className="text-content-subtle">Not yet</span>
                      )}
                    </TD>
                    <TD align="right">
                      <Button
                        type="button"
                        size="sm"
                        variant={where ? "ghost" : "secondary"}
                        leadingIcon={<CalendarPlus className="h-4 w-4" />}
                        onClick={() => setPreset(c)}
                      >
                        Add to Calendar
                      </Button>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        ) : null}
      </CardBody>
      <AddToCalendar
        open={preset !== null}
        preset={preset}
        onClose={() => setPreset(null)}
        onAdded={() => {
          void load();
          onChanged();
        }}
      />
    </Card>
  );
}
