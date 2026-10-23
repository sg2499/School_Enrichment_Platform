"use client";

/**
 * Attendance, co-scholastic grades and remarks for one section and term
 * (#188): one row per student, everything changed saved together. Term 2's
 * remark is the one printed on the Year-End card.
 */
import { useEffect, useMemo, useState } from "react";
import { Save, Undo2 } from "lucide-react";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { MAX_REMARK, recordChanged, recordEntry, recordFormFrom, rowProblems, fillWorkingDays, type RecordForm } from "@/lib/reportCards";
import { AlertBanner, LoadError } from "@/components/ui/AlertBanner";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { ReasonsBox, refusalReasons } from "@/components/assessment/common";
import type { RecordTerm, TermRecords } from "@/types/reportCards";

const MAX_IN_ONE_SAVE = 200;

const BOX =
  "h-10 rounded-xl border bg-surface px-3 text-sm text-content outline-hidden focus:border-brand-500 focus:shadow-focus-field disabled:bg-surface-muted read-only:bg-surface-muted";

export function TermRecordsSheet({
  scope,
  term,
  onDirtyChange,
}: {
  scope: { schoolId: string | null; yearId: string; classLevelId: string; section: string };
  term: RecordTerm;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const query = useApiQuery<TermRecords>("/report-cards/records", { ...scope, term }, { action: "load these records" });
  const data = query.problem ? null : query.data;
  const [forms, setForms] = useState<Record<string, RecordForm>>({});
  const [saving, setSaving] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [fillDays, setFillDays] = useState("");
  const areas = useMemo(() => data?.settings.areas ?? [], [data]);
  const labels = useMemo(() => (data?.settings.scale ?? []).map((s) => s.label), [data]);

  useEffect(() => {
    if (!data) return;
    setForms(Object.fromEntries(data.rows.map((row) => [row.studentId, recordFormFrom(row, labels)])));
  }, [data, labels]);

  const canRecord = Boolean(data?.canRecord);
  const changed = useMemo(
    () => (data?.rows ?? []).filter((row) => forms[row.studentId] && recordChanged(row, forms[row.studentId], areas, labels)),
    [data, forms, areas, labels],
  );
  const dirty = changed.length > 0;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  function update(studentId: string, patch: Partial<RecordForm>) {
    setForms((f) => ({ ...f, [studentId]: { ...f[studentId], ...patch } }));
    setNotice(null);
  }

  async function save() {
    setReasons([]);
    setNotice(null);
    const wrong = changed.filter((row) => Object.keys(rowProblems(forms[row.studentId])).length > 0);
    if (wrong.length > 0) {
      setReasons([`${wrong.length} ${wrong.length === 1 ? "row needs" : "rows need"} correcting first.`]);
      return;
    }
    setSaving(true);
    let saved = 0;
    try {
      // The server takes 200 at a time; a bigger section goes in parts.
      for (let start = 0; start < changed.length; start += MAX_IN_ONE_SAVE) {
        const { data: result } = await api.put<{ saved: number }>("/report-cards/records", {
          ...scope,
          term,
          entries: changed
            .slice(start, start + MAX_IN_ONE_SAVE)
            .map((row) => recordEntry(row.studentId, forms[row.studentId], areas)),
        });
        saved += result.saved;
      }
      setNotice(`Saved ${saved} ${saved === 1 ? "student" : "students"}.`);
      query.reload();
    } catch (err) {
      const reasons = refusalReasons(err, "save these records");
      setReasons(saved > 0 ? [`${saved} were saved before this:`, ...reasons] : reasons);
      if (saved > 0) query.reload();
    } finally {
      setSaving(false);
    }
  }

  if (query.problem) return <LoadError problem={query.problem} onRetry={query.reload} />;
  if (!data) return <TableSkeleton label="Loading records" />;
  if (data.rows.length === 0) {
    return <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-content-muted">No students are in this section yet.</p>;
  }

  return (
    <div className="space-y-5">
      {!canRecord ? (
        <AlertBanner tone="info" message="You no longer teach this section, so you can see its records but not change them." />
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <TextField
            label="Working Days This Term"
            hint="For every student with none yet"
            containerClassName="w-64"
            inputMode="numeric"
            value={fillDays}
            disabled={saving}
            onChange={(e) => setFillDays(e.target.value)}
          />
          <Button
            variant="secondary"
            className="mb-0.5"
            disabled={saving || fillDays.trim() === ""}
            onClick={() => setForms((f) => fillWorkingDays(f, fillDays))}
          >
            Fill In
          </Button>
        </div>
      )}
      <ReasonsBox title="The records weren't saved:" reasons={reasons} />
      {notice ? <AlertBanner tone="success" message={notice} /> : null}

      <Table caption="Attendance, grades and remarks" minWidth={`${44 + areas.length * 9}rem`} busy={query.loading}>
        <THead>
          <TH>Student</TH>
          <TH>Working Days</TH>
          <TH>Days Present</TH>
          {areas.map((area) => (
            <TH key={area}>{area}</TH>
          ))}
          <TH>{term === "TERM_2" ? "Remark (Year-End Card)" : "Remark"}</TH>
        </THead>
        <TBody>
          {data.rows.map((row) => {
            const form = forms[row.studentId];
            if (!form) return null;
            const problems = rowProblems(form);
            const name = row.studentName ?? row.studentCode;
            const changedRow = recordChanged(row, form, areas, labels);
            return (
              <TR key={row.studentId} className={changedRow ? "bg-saffron-50/60" : undefined}>
                <TD className="whitespace-nowrap">
                  <span className="font-semibold text-content">{row.studentName ?? "—"}</span>
                  <span className="block text-content-subtle">{row.studentCode}</span>
                </TD>
                {(["workingDays", "daysPresent"] as const).map((key) => (
                  <TD key={key}>
                    <input
                      aria-label={`${key === "workingDays" ? "Working days" : "Days present"}, ${name}`}
                      aria-invalid={problems[key] ? true : undefined}
                      aria-describedby={problems[key] ? `${key}-${row.studentId}` : undefined}
                      className={`${BOX} w-20 ${problems[key] ? "border-coral-500" : "border-line-field"}`}
                      inputMode="numeric"
                      maxLength={3}
                      readOnly={!canRecord}
                      disabled={saving}
                      value={form[key]}
                      onChange={(e) => update(row.studentId, { [key]: e.target.value })}
                    />
                    {problems[key] ? (
                      <span id={`${key}-${row.studentId}`} className="mt-1 block text-xs font-semibold text-coral-700">
                        {problems[key]}
                      </span>
                    ) : null}
                  </TD>
                ))}
                {areas.map((area) => (
                  <TD key={area}>
                    <select
                      aria-label={`${area}, ${name}`}
                      className={`${BOX} w-20 border-line-field`}
                      disabled={saving || !canRecord}
                      value={form.grades[area] ?? ""}
                      onChange={(e) => update(row.studentId, { grades: { ...form.grades, [area]: e.target.value } })}
                    >
                      <option value="">—</option>
                      {data.settings.scale.map((s) => (
                        <option key={s.label} value={s.label}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </TD>
                ))}
                <TD>
                  <input
                    aria-label={`Remark, ${name}`}
                    aria-invalid={problems.remark ? true : undefined}
                    aria-describedby={problems.remark ? `remark-${row.studentId}` : undefined}
                    className={`${BOX} w-72 ${problems.remark ? "border-coral-500" : "border-line-field"}`}
                    maxLength={MAX_REMARK + 20}
                    readOnly={!canRecord}
                    disabled={saving}
                    value={form.remark}
                    onChange={(e) => update(row.studentId, { remark: e.target.value })}
                  />
                  {problems.remark ? (
                    <span id={`remark-${row.studentId}`} className="mt-1 block text-xs font-semibold text-coral-700">
                      {problems.remark}
                    </span>
                  ) : null}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <p className="text-xs text-content-muted">
        Grades: {data.settings.scale.map((s) => `${s.label} ${s.meaning}`.trim()).join("; ")}.
      </p>

      {canRecord ? (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-line bg-surface/95 p-3 shadow-md backdrop-blur">
          <span className="mr-auto pl-2 text-sm text-content-muted" aria-live="polite">
            {dirty ? `${changed.length} ${changed.length === 1 ? "student" : "students"} not saved` : "All saved"}
          </span>
          <Button
            variant="ghost"
            leadingIcon={<Undo2 className="h-4 w-4" aria-hidden="true" />}
            disabled={!dirty || saving}
            onClick={() => {
              setForms(Object.fromEntries(data.rows.map((row) => [row.studentId, recordFormFrom(row, labels)])));
              setReasons([]);
            }}
          >
            Discard Changes
          </Button>
          <Button
            variant="primary"
            leadingIcon={<Save className="h-4 w-4" aria-hidden="true" />}
            loading={saving}
            loadingLabel="Saving"
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            Save
          </Button>
        </div>
      ) : null}
    </div>
  );
}
