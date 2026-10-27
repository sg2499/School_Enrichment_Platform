"use client";

/**
 * Mock Papers (#166 step 3, 27 Oct 2026): a section's papers, and the test
 * builder. A teacher builds any test the school needs (Shailesh: "the
 * teacher should have flexible options and can create whatever test they
 * wanna create"), starting from a full paper, a unit test, a class test or
 * a saved format; the builder shows as it goes whether the chosen chapters
 * have enough approved questions. The draft opens for preview and approval
 * on its own page.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Plus, Save, Trash2 } from "lucide-react";
import { api, describeApiError } from "@/lib/api";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { useUrlState } from "@/lib/hooks/useUrlState";
import { sectionName } from "@/lib/analytics";
import {
  blankSection,
  defaultWindow,
  DIFFICULTY_LABEL,
  durationText,
  formatForServer,
  fromLocalInput,
  KIND_LABEL,
  kindsFor,
  MARK_CHOICES,
  sectionMarks,
  STATUS_LABEL,
  STATUS_TONE,
  totalMarks,
  withMarks,
} from "@/lib/mockPapers";
import { formatDateTime } from "@/lib/tracker";
import { AlertBanner, LoadError } from "@/components/ui/AlertBanner";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectField, TextField } from "@/components/ui/Field";
import { MastheadSelect } from "@/components/ui/MastheadSelect";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Table";
import type {
  Difficulty,
  FormatSection,
  PaperChapter,
  PaperFormat,
  PaperSection,
  PaperSummary,
  SavedFormat,
  SupplyCheck,
} from "@/types/mockPapers";

type Role = "TEACHER" | "ADMIN" | "SUPER_ADMIN";

const OWNER_LABEL = { STARTING_POINT: "Starting Points", SCHOOL: "School Formats", MINE: "My Formats" } as const;

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  className,
}: {
  label: string;
  value: number | string;
  onChange: (value: number | string) => void;
  min: number;
  max: number;
  className?: string;
}) {
  return (
    <TextField
      label={label}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={value}
      containerClassName={className}
      onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
    />
  );
}

function SectionRow({
  section,
  index,
  supply,
  onChange,
  onRemove,
}: {
  section: FormatSection;
  index: number;
  supply: SupplyCheck["sections"][number] | undefined;
  onChange: (next: FormatSection) => void;
  onRemove: (() => void) | null;
}) {
  return (
    <li className="rounded-2xl border border-line p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_0.7fr_0.7fr_0.8fr_1.3fr_auto] lg:items-end">
        <TextField
          label="Section Name"
          value={section.name}
          maxLength={60}
          onChange={(e) => onChange({ ...section, name: e.target.value })}
        />
        <SelectField label="Marks Each" value={section.marks} onChange={(e) => onChange(withMarks(section, Number(e.target.value)))}>
          {MARK_CHOICES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </SelectField>
        <NumberInput
          label="Questions"
          min={1}
          max={50}
          value={section.count}
          onChange={(v) => onChange({ ...section, count: v as number })}
        />
        <NumberInput
          label="Either/Or"
          min={0}
          max={50}
          value={section.choices}
          onChange={(v) => onChange({ ...section, choices: v as number })}
        />
        <SelectField
          label="Kind of Question"
          value={section.kind}
          onChange={(e) => onChange({ ...section, kind: e.target.value as FormatSection["kind"] })}
        >
          {kindsFor(section.marks).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </SelectField>
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove ${section.name || `section ${index + 1}`}`}
            leadingIcon={<Trash2 className="h-4 w-4" />}
            onClick={onRemove}
          >
            Remove
          </Button>
        ) : (
          <span />
        )}
      </div>
      <p className="mt-3 text-xs text-content-subtle">
        {sectionMarks(section)} marks
        {supply ? (
          supply.enough ? (
            <span className="text-jade-700"> · enough approved questions ({supply.patterns} to choose from)</span>
          ) : (
            <span className="font-semibold text-coral-700">
              {" "}
              · not enough approved questions: {supply.filled} of {supply.places} places can be filled (each question can be used twice on a
              paper)
            </span>
          )
        ) : null}
      </p>
    </li>
  );
}

/**
 * The test builder. "paper": a teacher's new paper for a section. "format":
 * the school admin making or changing a school format (review: the admin
 * had no way to make one), with no chapters, dates or supply check.
 */
function Builder({
  section,
  role,
  onClose,
  mode = "paper",
  initialFormatId = "builtin-full",
  onSaved,
}: {
  section: PaperSection | null;
  role: Role;
  onClose: () => void;
  mode?: "paper" | "format";
  initialFormatId?: string;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const formats = useApiQuery<{ formats: SavedFormat[] }>("/mock-papers/formats", {}, { action: "load the test formats" });
  const chapters = useApiQuery<{ chapters: PaperChapter[] }>(
    mode === "paper" && section ? "/mock-papers/chapters" : null,
    { scope: section?.key },
    { action: "load the chapters" },
  );
  const [startId, setStartId] = useState(initialFormatId);
  const [format, setFormat] = useState<PaperFormat | null>(null);
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const window0 = useMemo(() => defaultWindow(new Date()), []);
  const [opens, setOpens] = useState(window0.opens);
  const [closes, setCloses] = useState(window0.closes);
  const [supply, setSupply] = useState<SupplyCheck | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = formats.data?.formats ?? [];
  const chosen = list.find((f) => f.id === startId) ?? null;
  useEffect(() => {
    if (format === null && chosen) setFormat(stripMeta(chosen));
  }, [chosen, format]);

  const chapterList = useMemo(() => chapters.data?.chapters ?? [], [chapters.data]);
  // The first chapter with approved questions is chosen once, on opening;
  // after that the teacher's choice stands, even none (review).
  const autoPicked = useRef(false);
  useEffect(() => {
    if (!autoPicked.current && chapterList.length > 0) {
      autoPicked.current = true;
      const first = chapterList.find((c) => c.approvedPatterns > 0);
      if (first) setPicked(new Set([first.id]));
    }
  }, [chapterList]);

  // The supply check, a moment after each change.
  // Only the answer to the latest request is shown (review).
  const supplyKey = JSON.stringify([format, [...picked].sort()]);
  const supplyRequest = useRef(0);
  useEffect(() => {
    if (!format || mode !== "paper" || !section) return;
    const id = ++supplyRequest.current;
    setSupply(null);
    const timer = window.setTimeout(() => {
      api
        .post<SupplyCheck>("/mock-papers/supply", { scope: section.key, format: formatForServer(format), chapterIds: [...picked] })
        .then(({ data }) => {
          if (id === supplyRequest.current) setSupply(data);
        })
        .catch(() => {
          if (id === supplyRequest.current) setSupply(null);
        });
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplyKey, section?.key, mode]);

  function update(next: Partial<PaperFormat>) {
    setFormat((f) => (f ? { ...f, ...next } : f));
    setSaved(null);
  }

  function setSection(i: number, next: FormatSection) {
    if (!format) return;
    update({ sections: format.sections.map((s, j) => (j === i ? next : s)) });
  }

  async function saveFormat() {
    if (!format) return;
    setBusy(true);
    setProblem(null);
    try {
      const editing = chosen && chosen.canEdit ? chosen.id : null;
      const body = { format: formatForServer(format) };
      const { data } = editing
        ? await api.put<{ id: string }>(`/mock-papers/formats/${editing}`, body)
        : await api.post<{ id: string }>("/mock-papers/formats", body);
      setStartId(data.id);
      setSaved(role === "ADMIN" ? "Saved for the whole school." : "Saved to My Formats.");
      formats.reload();
      onSaved?.();
    } catch (err) {
      setProblem(describeApiError(err, "save this format").message);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!format || !section) return;
    const opensAt = fromLocalInput(opens);
    const closesAt = fromLocalInput(closes);
    if (!opensAt || !closesAt) {
      setProblem("Choose when the paper opens and closes.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const { data } = await api.post<{ id: string }>("/mock-papers", {
        scope: section.key,
        title,
        format: formatForServer(format),
        chapterIds: [...picked],
        opensAt,
        closesAt,
      });
      router.push(`/teacher/papers/${data.id}`);
    } catch (err) {
      setProblem(describeApiError(err, "make this paper").message);
      setBusy(false);
    }
  }

  if (formats.problem) return <LoadError problem={formats.problem} onRetry={formats.reload} />;
  if (chapters.problem) return <LoadError problem={chapters.problem} onRetry={chapters.reload} />;
  if (!format || !formats.data || (mode === "paper" && !chapters.data)) return <TableSkeleton label="Opening the test builder" rows={4} />;

  const total = totalMarks(format);
  const groups = (["STARTING_POINT", "SCHOOL", "MINE"] as const).map((owner) => ({ owner, items: list.filter((f) => f.owner === owner) }));
  const anyShort = supply?.sections.some((s) => !s.enough) ?? false;
  const mix = format.difficulty;
  const mixSum = mix ? Number(mix.easy) + Number(mix.medium) + Number(mix.hard) : 100;

  return (
    <Card>
      <CardBody className="space-y-7 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-display-sm text-content">{mode === "paper" ? "New Mock Paper" : "School Format"}</h2>
            <p className="mt-1 text-sm text-content-muted">
              {mode === "paper" && section
                ? `For ${sectionName(section)}. Nothing reaches students until you preview and approve it.`
                : "Every teacher in the school can start a paper from this format."}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {mode === "paper" ? (
            <TextField
              label="Title"
              value={title}
              maxLength={120}
              placeholder="For example: Chapter 1 Practice Paper"
              onChange={(e) => setTitle(e.target.value)}
            />
          ) : null}
          <SelectField
            label="Start From"
            value={startId}
            onChange={(e) => {
              setStartId(e.target.value);
              const next = list.find((f) => f.id === e.target.value);
              if (next) setFormat(stripMeta(next));
              setSaved(null);
            }}
          >
            {groups
              .filter((g) => g.items.length > 0)
              .map((g) => (
                <optgroup key={g.owner} label={OWNER_LABEL[g.owner]}>
                  {g.items.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </optgroup>
              ))}
          </SelectField>
        </div>

        {mode === "paper" ? (
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-content">Chapters</legend>
            {chapterList.length === 0 ? (
              <p className="text-sm text-content-muted">This subject has no chapters yet.</p>
            ) : (
              <ul className="grid gap-1 sm:grid-cols-2">
                {chapterList.map((c) => (
                  <li key={c.id}>
                    <label
                      className={`flex items-center gap-3 rounded-xl p-2 ${c.approvedPatterns ? "cursor-pointer hover:bg-surface-muted" : "opacity-60"}`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand-600"
                        disabled={c.approvedPatterns === 0}
                        checked={picked.has(c.id)}
                        onChange={() => {
                          const next = new Set(picked);
                          if (next.has(c.id)) next.delete(c.id);
                          else next.add(c.id);
                          setPicked(next);
                        }}
                      />
                      <span className="text-sm text-content">
                        Chapter {c.chapterNo}: {c.title}
                        <span className="block text-xs text-content-subtle">
                          {c.approvedPatterns
                            ? `${c.approvedPatterns} approved question patterns`
                            : "Questions for papers not approved yet"}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        ) : null}

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-content">Sections</legend>
          <TextField label="Format Name" value={format.name} maxLength={80} onChange={(e) => update({ name: e.target.value })} />
          <ol className="space-y-3">
            {format.sections.map((s, i) => (
              <SectionRow
                key={i}
                section={s}
                index={i}
                supply={supply?.sections.find((x) => x.section === i)}
                onChange={(next) => setSection(i, next)}
                onRemove={format.sections.length > 1 ? () => update({ sections: format.sections.filter((_, j) => j !== i) }) : null}
              />
            ))}
          </ol>
          {format.sections.length < 10 ? (
            <Button
              type="button"
              variant="tinted"
              size="sm"
              leadingIcon={<Plus className="h-4 w-4" />}
              onClick={() => update({ sections: [...format.sections, blankSection(format.sections)] })}
            >
              Add Section
            </Button>
          ) : null}
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="mb-3 text-sm font-semibold text-content">Time and Rules</legend>
          <NumberInput
            label="Time Allowed (Minutes)"
            min={5}
            max={240}
            value={format.timeMinutes}
            onChange={(v) => update({ timeMinutes: v as number })}
          />
          <NumberInput
            label="Reading Time (Minutes)"
            min={0}
            max={15}
            value={format.readingMinutes}
            onChange={(v) => update({ readingMinutes: v as number })}
          />
          <SelectField
            label="Moving Between Sections"
            value={format.navigation}
            onChange={(e) => update({ navigation: e.target.value as PaperFormat["navigation"] })}
          >
            <option value="FREE">Any order</option>
            <option value="FORWARD">One way, in order</option>
          </SelectField>
          <SelectField
            label="Question Order"
            value={format.shuffle ? "yes" : "no"}
            onChange={(e) => update({ shuffle: e.target.value === "yes" })}
          >
            <option value="no">The same for everyone</option>
            <option value="yes">Each student&apos;s own order</option>
          </SelectField>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-content">Balance</legend>
          <label className="flex items-center gap-3 text-sm text-content">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={mix !== null}
              onChange={(e) => update({ difficulty: e.target.checked ? { easy: 30, medium: 50, hard: 20 } : null })}
            />
            Aim for a difficulty mix (share of marks)
          </label>
          {mix ? (
            <div className="grid gap-4 sm:grid-cols-3">
              {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((k) => (
                <NumberInput
                  key={k}
                  label={`${DIFFICULTY_LABEL[k]} (%)`}
                  min={0}
                  max={100}
                  value={mix[k]}
                  onChange={(v) => update({ difficulty: { ...mix, [k]: v as number } })}
                />
              ))}
            </div>
          ) : null}
          {mix && mixSum !== 100 ? (
            <p className="text-xs font-semibold text-coral-700">The mix adds up to {mixSum}%; make it 100%.</p>
          ) : null}
          <label className="flex items-center gap-3 text-sm text-content">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={format.applicationMin !== null}
              onChange={(e) => update({ applicationMin: e.target.checked ? 50 : null })}
            />
            Ask for a least share of application and reasoning marks
          </label>
          {format.applicationMin !== null ? (
            <NumberInput
              label="At Least (%)"
              min={0}
              max={100}
              value={format.applicationMin}
              className="sm:max-w-xs"
              onChange={(v) => update({ applicationMin: v as number })}
            />
          ) : null}
        </fieldset>

        {mode === "paper" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Opens" type="datetime-local" value={opens} onChange={(e) => setOpens(e.target.value)} />
            <TextField label="Closes" type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} />
          </div>
        ) : null}

        <div className="rounded-2xl bg-surface-muted p-4 text-sm text-content">
          <p className="font-semibold">
            {total} marks · {durationText(Number(format.timeMinutes) || 0)}
            {Number(format.readingMinutes) ? ` + ${format.readingMinutes} minutes reading` : ""}
          </p>
          {supply?.problems.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-coral-800">
              {supply.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : anyShort ? (
            <p className="mt-1 text-coral-800">
              Some sections need more approved questions than these chapters have. Add chapters or change those sections; places left empty
              will be marked on the draft.
            </p>
          ) : supply ? (
            <p className="mt-1 text-jade-800">The chosen chapters have enough approved questions for every section.</p>
          ) : null}
        </div>

        {problem ? <AlertBanner tone="error" message={problem} /> : null}
        {saved ? <AlertBanner tone="success" message={saved} /> : null}

        <div className="flex flex-wrap justify-end gap-3">
          {role === "TEACHER" || mode === "format" ? (
            <Button
              type="button"
              variant={mode === "format" ? "primary" : "secondary"}
              loading={busy}
              leadingIcon={<Save className="h-4 w-4" />}
              onClick={() => void saveFormat()}
            >
              {chosen?.canEdit ? "Update This Format" : role === "ADMIN" ? "Save as School Format" : "Save as My Format"}
            </Button>
          ) : null}
          {mode === "paper" ? (
            <Button
              type="button"
              variant="primary"
              loading={busy}
              loadingLabel="Choosing questions"
              leadingIcon={<FilePlus2 className="h-4 w-4" />}
              disabled={picked.size === 0 || Boolean(supply?.problems.length)}
              onClick={() => void create()}
            >
              Make Draft Paper
            </Button>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

function stripMeta(f: SavedFormat): PaperFormat {
  return {
    name: f.name,
    sections: f.sections.map((s) => ({ ...s })),
    timeMinutes: f.timeMinutes,
    readingMinutes: f.readingMinutes,
    difficulty: f.difficulty ? { ...f.difficulty } : null,
    applicationMin: f.applicationMin,
    shuffle: f.shuffle,
    navigation: f.navigation,
  };
}

/** The school admin makes, changes and removes the school's own formats. */
function SchoolFormats() {
  const formats = useApiQuery<{ formats: SavedFormat[] }>("/mock-papers/formats", {}, { action: "load the test formats" });
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  if (formats.problem) return <LoadError problem={formats.problem} onRetry={formats.reload} />;
  if (!formats.data) return null;
  const school = formats.data.formats.filter((f) => f.owner === "SCHOOL");
  if (editing) {
    return (
      <Builder
        key={editing}
        section={null}
        role="ADMIN"
        mode="format"
        initialFormatId={editing}
        onClose={() => setEditing(null)}
        onSaved={() => formats.reload()}
      />
    );
  }
  return (
    <section aria-labelledby="formats-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="formats-heading" className="font-display text-display-sm text-content">
          School Formats
        </h2>
        <Button
          type="button"
          size="sm"
          variant="tinted"
          leadingIcon={<Plus className="h-4 w-4" />}
          onClick={() => setEditing("builtin-full")}
        >
          New School Format
        </Button>
      </div>
      <p className="text-sm text-content-muted">Teachers start their papers from these, or from the three built in.</p>
      {problem ? <AlertBanner tone="error" message={problem} /> : null}
      {school.length === 0 ? (
        <p className="text-sm text-content-subtle">No school formats yet.</p>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {school.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <span className="text-sm text-content">
                  <span className="font-semibold">{f.name}</span>
                  <span className="block text-xs text-content-subtle">
                    {totalMarks(f)} marks · {f.sections.length} {f.sections.length === 1 ? "section" : "sections"} ·{" "}
                    {durationText(f.timeMinutes)}
                  </span>
                </span>
                <span className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(f.id)}>
                    Edit
                  </Button>
                  {removing === f.id ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      leadingIcon={<Trash2 className="h-4 w-4" />}
                      onClick={async () => {
                        setProblem(null);
                        try {
                          await api.delete(`/mock-papers/formats/${f.id}`);
                          setRemoving(null);
                          formats.reload();
                        } catch (err) {
                          setProblem(describeApiError(err, "remove this format").message);
                        }
                      }}
                    >
                      Confirm Remove
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      leadingIcon={<Trash2 className="h-4 w-4" />}
                      onClick={() => setRemoving(f.id)}
                    >
                      Remove
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function PaperList({ papers, basePath }: { papers: PaperSummary[]; basePath: string }) {
  return (
    <Card>
      <ul className="divide-y divide-line">
        {papers.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-content">{p.title}</span>
                <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
              </span>
              <span className="block text-xs text-content-subtle">
                {[
                  `${p.totalMarks} marks`,
                  durationText(p.timeMinutes),
                  `Opens ${formatDateTime(p.opensAt)}`,
                  `Closes ${formatDateTime(p.closesAt)}`,
                  p.status !== "DRAFT" && p.status !== "WITHDRAWN" ? `${p.versions} ${p.versions === 1 ? "student" : "students"}` : null,
                  p.createdBy ? `By ${p.createdBy}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <ButtonLink href={`${basePath}/${p.id}`} size="sm" variant="tinted">
              {p.status === "DRAFT" ? "Preview" : "Open"}
            </ButtonLink>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function MockPapers({ role }: { role: Role }) {
  const url = useUrlState();
  const scope = url.get("scope") ?? "";
  const building = url.get("new") === "1";
  const basePath = role === "TEACHER" ? "/teacher/papers" : "/admin/papers";

  const sections = useApiQuery<{ sections: PaperSection[] }>(
    role === "SUPER_ADMIN" ? null : "/mock-papers/sections",
    {},
    { action: "load your sections" },
  );
  const papers = useApiQuery<{ papers: PaperSummary[] }>(
    role === "SUPER_ADMIN" ? null : "/mock-papers",
    {},
    { action: "load the mock papers" },
  );
  const list = sections.problem ? null : (sections.data?.sections ?? null);
  const section = list?.find((s) => s.key === scope) ?? list?.[0] ?? null;
  const shown = (papers.data?.papers ?? []).filter((p) => p.scope === section?.key);
  const canBuild = role === "TEACHER" && Boolean(section?.canChange);

  return (
    <div className="space-y-8">
      <PageHeader
        surface="masthead"
        eyebrow="Assessment"
        title="Mock Papers"
        description="Practice papers for exams and tests, with fresh questions for every student. You preview and approve each paper; students then each get their own version."
        stats={[
          { label: "Papers", value: papers.problem ? "—" : papers.data ? shown.length : section ? null : "—" },
          {
            label: "Drafts",
            value: papers.problem ? "—" : papers.data ? shown.filter((p) => p.status === "DRAFT").length : section ? null : "—",
          },
        ]}
        actions={
          canBuild && !building ? (
            <Button
              type="button"
              variant="accent"
              leadingIcon={<FilePlus2 className="h-4 w-4" />}
              onClick={() => url.set({ new: "1" }, { push: true })}
            >
              New Paper
            </Button>
          ) : null
        }
      >
        <MastheadSelect
          label="Section"
          helper={role === "TEACHER" ? "One of the sections you teach or taught." : "Any section in your school."}
          value={section?.key ?? ""}
          disabled={!list || list.length === 0}
          error={sections.error}
          onChange={(e) => url.set({ scope: e.target.value, new: null }, { push: true })}
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
            description="Mock papers belong to a school. Sign in as that school's admin to see them."
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
                ? "Mock papers are made for the sections you teach. Your school admin assigns them."
                : "Sections appear once teachers are assigned to them."
            }
          />
        </Card>
      ) : null}

      {section && building && canBuild ? (
        <Builder key={section.key} section={section} role={role} onClose={() => url.set({ new: null }, { push: true })} />
      ) : null}

      {section && !building ? (
        <section aria-labelledby="papers-heading" className="space-y-4">
          <h2 id="papers-heading" className="font-display text-display-sm text-content">
            Papers for {sectionName(section)}
          </h2>
          {papers.problem ? (
            <LoadError problem={papers.problem} onRetry={papers.reload} />
          ) : !papers.data ? (
            <TableSkeleton label="Loading the papers" rows={3} />
          ) : shown.length === 0 ? (
            <Card className="p-6">
              <EmptyState
                title="No Paper Yet"
                description={
                  canBuild
                    ? "Choose New Paper to build one: a full paper, a unit test, a class test, or any format your school uses."
                    : "Papers the section's teacher makes appear here."
                }
              />
            </Card>
          ) : (
            <PaperList papers={shown} basePath={basePath} />
          )}
        </section>
      ) : null}

      {role === "ADMIN" && !building ? <SchoolFormats /> : null}
    </div>
  );
}
