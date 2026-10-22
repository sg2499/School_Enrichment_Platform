"use client";

/**
 * How a measured answer is marked, on a question's card in Curriculum
 * Studio (Phase 4, #164; PHASE4_UNITS_DESIGN.md). Shows the settings in a
 * line each, any advice for the reviewer, and an inline form to change
 * them. Inline, not a dialog: the card already sits in the chapter review
 * dialog, and a dialog over a dialog loses the question being edited.
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

  return (
    <section aria-labelledby={headingId} className="space-y-2 rounded-xl border border-line bg-surface-muted px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        {/* content-subtle on surface-muted: 6.0:1. */}
        <h4 id={headingId} className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-eyebrow text-content-subtle">
          <Ruler aria-hidden className="h-3.5 w-3.5" />
          Marking
        </h4>
        {editing ? null : (
          <Button size="sm" variant="ghost" onClick={open}>
            Edit Marking
          </Button>
        )}
      </div>

      {editing ? null : summary.length > 0 ? (
        <ul className="space-y-0.5 text-sm text-content-muted">
          {summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-content-muted">The number alone is marked.</p>
      )}

      {!editing && notes.length > 0 ? (
        // saffron-900 on surface-accent: 9.6:1. Advice, not a flag: it does
        // not stop approval.
        <ul className="space-y-1 rounded-lg bg-surface-accent px-2.5 py-2 ring-1 ring-inset ring-saffron-200">
          {notes.map((note) => (
            <li key={note} className="flex items-start gap-1.5 text-xs leading-normal text-saffron-900">
              <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {editing ? (
        <form
          className="space-y-3 pt-1"
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
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Answer Unit"
              value={form.answerUnit}
              onChange={(event) => set("answerUnit", event.target.value)}
              disabled={!units}
              hint={units ? undefined : "Loading…"}
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
            <SelectField
              label="Unit Rule"
              value={form.unitRule}
              onChange={(event) => set("unitRule", event.target.value as MarkingForm["unitRule"])}
              hint={UNIT_RULE_MEANING[form.unitRule || defaultRule || "NONE"]}
              error={fieldProblems.unitRule}
            >
              <option value="">{`From the Response Format${defaultRule ? ` (${UNIT_RULE_LABEL[defaultRule]})` : ""}`}</option>
              {RULES.map((rule) => (
                <option key={rule} value={rule}>
                  {UNIT_RULE_LABEL[rule]}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Allow Conversion"
              value={form.allowUnitConversion ? "yes" : "no"}
              onChange={(event) => set("allowUnitConversion", event.target.value === "yes")}
              hint="2 kg for 2000 g"
              error={fieldProblems.allowUnitConversion}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </SelectField>
            <TextField
              label="Unit Mark"
              inputMode="numeric"
              value={form.unitMark}
              onChange={(event) => set("unitMark", event.target.value)}
              placeholder="1"
              hint="Lost for a missing unit"
              error={fieldProblems.unitMark}
            />
            <TextField
              label="Tolerance"
              inputMode="decimal"
              value={form.numericTolerance}
              onChange={(event) => set("numericTolerance", event.target.value)}
              placeholder="0"
              hint="Allowed difference"
              error={fieldProblems.numericTolerance}
            />
            <TextField
              label="Decimal Places"
              inputMode="numeric"
              value={form.decimalPlaces}
              onChange={(event) => set("decimalPlaces", event.target.value)}
              placeholder="Exact"
              hint="Round half up first"
              error={fieldProblems.decimalPlaces}
            />
          </div>
          <p className="text-xs text-content-subtle">Applies to answers submitted from now on. Marks already given stay as they are.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={saving}>
              Save Marking
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
