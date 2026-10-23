"use client";

/**
 * Entering one component's marks for one section (#165): a box per
 * student that takes a number, AB (Absent, counts as 0) or EX (Exempt).
 * Enter moves down the column, as on a paper register. Everything changed
 * is saved together, all or none; a mark that was already saved changes
 * only with a reason, asked for once for the whole save.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Save, Undo2 } from "lucide-react";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { cellChanged, cellFrom, readCell, type MarkCell } from "@/lib/assessment";
import { AlertBanner, LoadError } from "@/components/ui/AlertBanner";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { ReasonsBox, refusalReasons } from "@/components/assessment/common";
import type { MarkStatus, MarksSheet, SchemeComponent } from "@/types/assessment";

const MAX_IN_ONE_SAVE = 200;

interface PlannedEntry {
  studentId: string;
  status: MarkStatus | null;
  marks: string | null;
  /** A mark is already saved for this student, so the change needs a reason. */
  overwrites: boolean;
}

export function MarksEntry({
  schemeId,
  components,
  section,
  componentId,
  onComponentChange,
  onDirtyChange,
}: {
  schemeId: string;
  components: SchemeComponent[];
  section: string;
  componentId: string;
  onComponentChange: (id: string) => void;
  /** Whether there are unsaved marks, for the page's leave guard. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const sheet = useApiQuery<MarksSheet>(
    `/assessment/schemes/${schemeId}/components/${componentId}/marks`,
    { section },
    { action: "load these marks" },
  );
  const [cells, setCells] = useState<Record<string, MarkCell>>({});
  const [saving, setSaving] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [askReason, setAskReason] = useState(false);
  const [reason, setReason] = useState("");
  // What a save will send, worked out against the marks as saved at the
  // moment Save was pressed (someone else may have saved since the sheet
  // loaded): the entries, and which of them overwrite a saved mark.
  const [plan, setPlan] = useState<{ entries: PlannedEntry[]; overwrites: number; movedOn: number } | null>(null);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  const data = sheet.problem ? null : sheet.data;
  const component = data?.component;
  const maxMarks = component?.maxMarks ?? "0";
  const source = component?.source ?? "ENTERED";
  const canEnter = Boolean(data?.canEnterMarks);

  // The boxes start as what is saved, each time a sheet arrives.
  useEffect(() => {
    if (!data) return;
    setCells(Object.fromEntries(data.rows.map((row) => [row.studentId, cellFrom(row.status, row.marks)])));
  }, [data]);

  const changed = useMemo(
    () =>
      (data?.rows ?? []).filter((row) =>
        cellChanged(cells[row.studentId] ?? cellFrom(row.status, row.marks), row, maxMarks, source),
      ),
    [cells, data, maxMarks, source],
  );
  const invalid = changed.filter((row) => "error" in readCell(cells[row.studentId] ?? "", maxMarks, source));
  const dirty = changed.length > 0;

  // The page asks before leaving with unsaved marks (useLeaveGuard).
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  function discard() {
    if (!data) return;
    setCells(Object.fromEntries(data.rows.map((row) => [row.studentId, cellFrom(row.status, row.marks)])));
    setReasons([]);
  }

  const path = `/assessment/schemes/${schemeId}/components/${componentId}/marks`;

  async function save(toSend: PlannedEntry[], withReason: string | null) {
    setSaving(true);
    try {
      const entries = toSend.map((e) => ({
        studentId: e.studentId,
        status: e.status,
        marks: e.marks,
        reason: e.overwrites ? withReason : null,
      }));
      const { data: result } = await api.put<{ saved: number }>(path, { section, entries });
      setAskReason(false);
      setPlan(null);
      setReason("");
      setNotice(`Saved ${result.saved} ${result.saved === 1 ? "mark" : "marks"}.`);
      sheet.reload();
    } catch (err) {
      setAskReason(false);
      setReasons(refusalReasons(err, "save these marks"));
    } finally {
      setSaving(false);
    }
  }

  async function startSave() {
    setReasons([]);
    setNotice(null);
    if (invalid.length > 0) {
      setReasons([`${invalid.length} ${invalid.length === 1 ? "box needs" : "boxes need"} correcting first.`]);
      return;
    }
    if (changed.length > MAX_IN_ONE_SAVE) {
      setReasons([`At most ${MAX_IN_ONE_SAVE} marks can be saved at once.`]);
      return;
    }
    setSaving(true);
    let latest: MarksSheet;
    try {
      ({ data: latest } = await api.get<MarksSheet>(path, { params: { section } }));
    } catch (err) {
      setSaving(false);
      setReasons(refusalReasons(err, "save these marks"));
      return;
    }
    const now = new Map(latest.rows.map((row) => [row.studentId, row]));
    const entries: PlannedEntry[] = [];
    let movedOn = 0;
    for (const row of changed) {
      const read = readCell(cells[row.studentId] ?? "", maxMarks, source);
      const current = now.get(row.studentId);
      if ("error" in read || !current) continue;
      if (current.status !== row.status || current.marks !== row.marks) movedOn += 1;
      if (read.status === current.status && read.marks === current.marks) continue;
      entries.push({ studentId: row.studentId, status: read.status, marks: read.marks, overwrites: current.status !== null });
    }
    const overwrites = entries.filter((e) => e.overwrites).length;
    if (entries.length === 0) {
      setSaving(false);
      sheet.reload();
      return;
    }
    if (overwrites > 0) {
      setSaving(false);
      setPlan({ entries, overwrites, movedOn });
      setAskReason(true);
    } else {
      await save(entries, null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4">
        <SelectField
          label="Component"
          containerClassName="min-w-64"
          value={componentId}
          disabled={dirty}
          hint={dirty ? "Save or discard your changes first" : undefined}
          onChange={(e) => onComponentChange(e.target.value)}
        >
          {components.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} (out of {c.maxMarks})
            </option>
          ))}
        </SelectField>
        <p className="pb-3 text-sm text-content-muted">
          {source === "PLATFORM"
            ? "These scores come from practice on the platform. Type AB for Absent or EX for Exempt."
            : `Type marks out of ${maxMarks}, AB for Absent (counts as 0) or EX for Exempt.`}
        </p>
      </div>

      {sheet.problem ? <LoadError problem={sheet.problem} onRetry={sheet.reload} /> : null}
      {data && !canEnter ? (
        <AlertBanner
          tone="info"
          message="You can see these marks but not change them: the scheme isn't the published one, or you no longer teach this section."
        />
      ) : null}
      <ReasonsBox title="The marks weren't saved:" reasons={reasons} />
      {notice ? <AlertBanner tone="success" message={notice} /> : null}

      {!data && !sheet.problem ? (
        <TableSkeleton label="Loading marks" />
      ) : data && data.rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-content-muted">
          No students are in section {section} of this class yet.
        </p>
      ) : data ? (
        <Table caption={`${component?.name} marks for section ${section}`} minWidth="36rem" busy={sheet.loading}>
          <THead>
            <TH>Student</TH>
            <TH>Code</TH>
            <TH>{source === "PLATFORM" ? "Absent / Exempt" : `Marks (out of ${maxMarks})`}</TH>
            <TH>Saved</TH>
          </THead>
          <TBody>
            {data.rows.map((row, index) => {
              const cell = cells[row.studentId] ?? "";
              const read = readCell(cell, maxMarks, source);
              const error = "error" in read ? read.error : null;
              const isChanged = cellChanged(cell, row, maxMarks, source);
              const label = `${row.studentName ?? row.studentCode}, ${component?.name}`;
              return (
                <TR key={row.studentId} className={isChanged ? "bg-saffron-50/60" : undefined}>
                  <TD className="whitespace-nowrap">
                    <span className="font-semibold text-content">{row.studentName ?? "—"}</span>
                  </TD>
                  <TD className="whitespace-nowrap">{row.studentCode}</TD>
                  <TD>
                    <input
                      ref={(el) => {
                        inputs.current[index] = el;
                      }}
                      aria-label={label}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `mark-error-${row.studentId}` : undefined}
                      readOnly={!canEnter || saving}
                      inputMode={source === "PLATFORM" ? "text" : "decimal"}
                      autoComplete="off"
                      maxLength={10}
                      value={cell}
                      onChange={(e) => {
                        const value = e.target.value;
                        setCells((c) => ({ ...c, [row.studentId]: value }));
                        setNotice(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || (e.key === "ArrowDown" && !e.altKey)) {
                          e.preventDefault();
                          inputs.current[index + 1]?.focus();
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          inputs.current[index - 1]?.focus();
                        }
                      }}
                      className={
                        "h-10 w-28 rounded-xl border bg-surface px-3 text-base text-content outline-hidden focus:border-brand-500 focus:shadow-focus-field read-only:bg-surface-muted " +
                        (error ? "border-coral-500" : "border-line-field")
                      }
                    />
                    {error ? (
                      <span id={`mark-error-${row.studentId}`} className="mt-1 block text-xs font-semibold text-coral-700">
                        {error}
                      </span>
                    ) : null}
                  </TD>
                  <TD>
                    {row.status === "ABSENT" ? (
                      <Badge tone="warning">Absent</Badge>
                    ) : row.status === "EXEMPT" ? (
                      <Badge tone="neutral">Exempt</Badge>
                    ) : row.status === "ENTERED" ? (
                      <span className="text-content">{row.marks}</span>
                    ) : (
                      <span className="text-content-subtle">—</span>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      ) : null}

      {data && canEnter ? (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-line bg-surface/95 p-3 shadow-md backdrop-blur">
          <span className="mr-auto pl-2 text-sm text-content-muted" aria-live="polite">
            {dirty ? `${changed.length} ${changed.length === 1 ? "change" : "changes"} not saved` : "All marks saved"}
          </span>
          <Button
            variant="ghost"
            leadingIcon={<Undo2 className="h-4 w-4" aria-hidden="true" />}
            disabled={!dirty || saving}
            onClick={discard}
          >
            Discard Changes
          </Button>
          <Button
            variant="primary"
            leadingIcon={<Save className="h-4 w-4" aria-hidden="true" />}
            loading={saving && !askReason}
            loadingLabel="Saving"
            disabled={!dirty || saving}
            onClick={startSave}
          >
            Save Marks
          </Button>
        </div>
      ) : null}

      <Modal
        open={askReason}
        onClose={() => (saving ? undefined : setAskReason(false))}
        title="Why Are These Marks Changing?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={saving} onClick={() => setAskReason(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={saving}
              loadingLabel="Saving"
              disabled={reason.trim() === ""}
              onClick={() => plan && void save(plan.entries, reason.trim())}
            >
              Save Marks
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm text-content">
          <p>
            {plan?.overwrites === 1
              ? "One mark that was already saved is changing."
              : `${plan?.overwrites ?? 0} marks that were already saved are changing.`}{" "}
            The reason is kept with the change.
          </p>
          {plan && plan.movedOn > 0 ? (
            <p className="font-semibold">
              Someone else saved {plan.movedOn === 1 ? "a mark for one of these students" : `marks for ${plan.movedOn} of these students`}{" "}
              since you opened this sheet. Saving replaces theirs with yours.
            </p>
          ) : null}
          <TextField
            label="Reason"
            hint={`${reason.length}/200`}
            maxLength={200}
            value={reason}
            placeholder="For example: re-checked the answer sheet"
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}
