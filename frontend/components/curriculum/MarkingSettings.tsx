"use client";

/**
 * How a measured answer is marked, on a question's card in Curriculum
 * Studio (Phase 4, #164; PHASE4_UNITS_DESIGN.md). Shows the settings in a
 * line each, any advice for the reviewer, and an inline form to change
 * them. Inline, not a dialog: a dialog over the page loses the question
 * being edited.
 *
 * Laid out for reading (20 Nov 2026): the form is in three labelled groups
 * (Units, Number, Written Work), two fields to a row, and every explanation
 * sits under its own field. The shared fields put a hint beside the label,
 * which is right for two words and unreadable for a sentence, so the hints
 * here are passed to `Hint` instead of to the field.
 *
 * The server checks every value (learning_service.clean_marking_fields,
 * the same check the workbook import uses) and names each problem against
 * its field; the form shows it there.
 */
import { useEffect, useId, useState } from "react";
import { Info, Ruler } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { api, describeApiError } from "@/lib/api";
import {
  UNIT_RULE_LABEL,
  UNIT_RULE_MEANING,
  markingFormFrom,
  markingRequest,
  markingSummary,
  unitGroups,
  type MarkingForm,
} from "@/lib/marking";
import type { MarkingUnit, QuestionDetail, UnitRule } from "@/types/curriculum";

// The unit list is the same for every question: fetched once per page load.
let unitsRequest: Promise<MarkingUnit[]> | null = null;
function loadUnits(): Promise<MarkingUnit[]> {
  if (!unitsRequest) {
    unitsRequest = api
      .get<{ units: MarkingUnit[] }>("/curriculum-admin/marking-units")
      .then((response) => response.data.units)
      .catch((error) => {
        unitsRequest = null; // let the next opening try again
        throw error;
      });
  }
  return unitsRequest;
}

const RULES: UnitRule[] = ["NONE", "STATED", "REQUIRED"];

/** One field and the sentence that explains it, kept together under it. */
function FieldCell({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      {children}
      {hint ? <p className="text-[0.8125rem] leading-snug text-content-subtle">{hint}</p> : null}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="w-full border-b border-line pb-1.5 text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-subtle">
        {title}
      </legend>
      <div className="grid gap-x-5 gap-y-4 pt-1 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function MarkingSettings({
  question,
  onSaved,
}: {
  question: QuestionDetail;
  onSaved: (updated: QuestionDetail) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<MarkingForm>(() => markingFormFrom(question));
  const [units, setUnits] = useState<MarkingUnit[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldProblems, setFieldProblems] = useState<Record<string, string>>({});
  const headingId = useId();

  useEffect(() => {
    if (!editing || units) return;
    let cancelled = false;
    loadUnits()
      .then((list) => {
        if (!cancelled) setUnits(list);
      })
      .catch((error) => {
        if (!cancelled) setProblem(describeApiError(error, "load the list of units").message);
      });
    return () => {
      cancelled = true;
    };
  }, [editing, units]);

  const summary = markingSummary(question);
  const notes = question.markingNotes ?? [];
  const defaultRule = question.effectiveUnitRule && !question.unitRule ? question.effectiveUnitRule : null;

  function open() {
    setForm(markingFormFrom(question));
    setProblem(null);
    setFieldProblems({});
    setEditing(true);
  }

  function set<K extends keyof MarkingForm>(key: K, value: MarkingForm[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
    setFieldProblems((previous) => {
      if (!(key in previous)) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setProblem(null);
    setFieldProblems({});
    try {
      const response = await api.patch<QuestionDetail>(`/curriculum-admin/questions/${question.id}/marking`, markingRequest(form));
      onSaved(response.data);
      setEditing(false);
    } catch (error) {
      const described = describeApiError(error, "save the marking settings");
      const byField: Record<string, string> = {};
      for (const issue of described.fields) byField[issue.field] = issue.issue;
      setFieldProblems(byField);
      // Said once at the top as well, for a problem with no field of its own.
      setProblem(Object.keys(byField).length > 0 ? "Please check the settings marked below." : described.message);
    } finally {
      setSaving(false);
    }
  }

  const uploadHint =
    form.uploadRule === ""
      ? `The platform decides by reading the question: ${question.uploadRuleReason ?? "no PDF box."}`
      : form.uploadRule === "REQUIRED"
        ? "The child is asked to attach a PDF; a note shows if none is attached."
        : form.uploadRule === "OPTIONAL"
          ? "The child may attach a PDF of their working."
          : "No PDF box on this question.";

  return (
    <section aria-labelledby={headingId} className="rounded-2xl border border-line bg-surface-muted">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        {/* content-subtle on surface-muted: 6.0:1. */}
        <h4 id={headingId} className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-eyebrow text-content-subtle">
          <Ruler aria-hidden className="h-4 w-4" />
          Marking
        </h4>
        {editing ? null : (
          <Button size="sm" variant="secondary" onClick={open}>
            Edit Marking
          </Button>
        )}
      </div>

      {editing ? null : (
        <div className="space-y-2.5 border-t border-line px-4 py-3">
          {summary.length > 0 ? (
            <ul className="space-y-1 text-sm text-content">
              {summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-content-muted">The number alone is marked.</p>
          )}
          {notes.length > 0 ? (
            // saffron-900 on surface-accent: 9.6:1. Advice, not a flag: it
            // does not stop approval.
            <ul className="space-y-1 rounded-xl bg-surface-accent px-3 py-2 ring-1 ring-inset ring-saffron-200">
              {notes.map((note) => (
                <li key={note} className="flex items-start gap-1.5 text-xs leading-normal text-saffron-900">
                  <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      {editing ? (
        <form
          className="space-y-6 border-t border-line bg-surface px-4 py-5 sm:px-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {problem ? (
            <p role="alert" className="text-sm font-semibold text-coral-700">
              {problem}
            </p>
          ) : null}

          <Group title="Units">
            <FieldCell>
              <SelectField
                label="Answer Unit"
                value={form.answerUnit}
                onChange={(event) => set("answerUnit", event.target.value)}
                disabled={!units}
                error={fieldProblems.answerUnit}
              >
                <option value="">
                  {question.answerUnitSource === "QUESTION" && question.effectiveAnswerUnitLabel
                    ? `Not Recorded (Read from the Question: ${question.effectiveAnswerUnitLabel})`
                    : "Not Recorded"}
                </option>
                {form.answerUnit && units && !units.some((unit) => unit.code === form.answerUnit) ? (
                  <option value={form.answerUnit}>{form.answerUnit}</option>
                ) : null}
                {(units ? unitGroups(units) : []).map((group) => (
                  <optgroup key={group.kind} label={group.label}>
                    {group.units.map((unit) => (
                      <option key={unit.code} value={unit.code}>
                        {unit.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </SelectField>
              {units ? <p className="text-[0.8125rem] leading-snug text-content-subtle">The unit a correct answer carries.</p> : <p className="text-[0.8125rem] text-content-subtle">Loading the units…</p>}
            </FieldCell>
            <FieldCell hint={UNIT_RULE_MEANING[form.unitRule || defaultRule || "NONE"]}>
              <SelectField
                label="Unit Rule"
                value={form.unitRule}
                onChange={(event) => set("unitRule", event.target.value as MarkingForm["unitRule"])}
                error={fieldProblems.unitRule}
              >
                <option value="">{`From the Response Format${defaultRule ? ` (${UNIT_RULE_LABEL[defaultRule]})` : ""}`}</option>
                {RULES.map((rule) => (
                  <option key={rule} value={rule}>
                    {UNIT_RULE_LABEL[rule]}
                  </option>
                ))}
              </SelectField>
            </FieldCell>
            <FieldCell hint="Marks lost when the unit is missing.">
              <TextField
                label="Unit Mark"
                inputMode="numeric"
                value={form.unitMark}
                onChange={(event) => set("unitMark", event.target.value)}
                placeholder="1"
                error={fieldProblems.unitMark}
              />
            </FieldCell>
            <FieldCell hint="Accept 2 kg when the key says 2000 g.">
              <SelectField
                label="Allow Conversion"
                value={form.allowUnitConversion ? "yes" : "no"}
                onChange={(event) => set("allowUnitConversion", event.target.value === "yes")}
                error={fieldProblems.allowUnitConversion}
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </SelectField>
            </FieldCell>
          </Group>

          <Group title="Number">
            <FieldCell hint="The difference from the key that still counts as correct.">
              <TextField
                label="Tolerance"
                inputMode="decimal"
                value={form.numericTolerance}
                onChange={(event) => set("numericTolerance", event.target.value)}
                placeholder="0"
                error={fieldProblems.numericTolerance}
              />
            </FieldCell>
            <FieldCell hint="The answer is rounded half up to this many places before it is compared.">
              <TextField
                label="Decimal Places"
                inputMode="numeric"
                value={form.decimalPlaces}
                onChange={(event) => set("decimalPlaces", event.target.value)}
                placeholder="Exact"
                error={fieldProblems.decimalPlaces}
              />
            </FieldCell>
          </Group>

          <Group title="Written Work">
            <FieldCell hint={uploadHint}>
              <SelectField
                label="PDF Upload"
                value={form.uploadRule}
                onChange={(event) => set("uploadRule", event.target.value as MarkingForm["uploadRule"])}
                error={fieldProblems.uploadRule}
              >
                <option value="">Platform Decides</option>
                <option value="REQUIRED">Required</option>
                <option value="OPTIONAL">Optional</option>
                <option value="NONE">None</option>
              </SelectField>
            </FieldCell>
          </Group>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-xs text-content-subtle">Applies to answers submitted from now on. Marks already given stay as they are.</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" loading={saving}>
                Save Marking
              </Button>
            </div>
          </div>
        </form>
      ) : null}
    </section>
  );
}
