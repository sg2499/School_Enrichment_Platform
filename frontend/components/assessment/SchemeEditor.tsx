"use client";

/**
 * The draft editor for an Assessment Scheme or template (#165): its pass
 * rule, its components and weights, its grades, an example result, and
 * Save / Publish. Only drafts reach this; a published scheme is shown by
 * SchemeOverview and changed by making a new version.
 *
 * The server checks everything again on save and on publish
 * (assessment_service.clean_scheme_input and publish_problems) and its
 * reasons are listed as they come back. What is worked out here -- the
 * running weight total and the example -- only helps while typing.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, Save, Send, Trash } from "lucide-react";
import { api } from "@/lib/api";
import {
  ATTEMPT_RULE_LABEL,
  ATTEMPT_RULE_MEANING,
  KIND_LABEL,
  KINDS,
  SOURCE_LABEL,
  TERM_LABEL,
  TERMS,
  blankComponent,
  parseNumber,
  previewResult,
  schemeFormFrom,
  schemeRequest,
  weightTotal,
  type ComponentForm,
  type SchemeForm,
} from "@/lib/assessment";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { SelectField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { ReasonsBox, refusalReasons } from "@/components/assessment/common";
import type { AttemptRule, ComponentSource, LinkableActivity, SchemeDetail } from "@/types/assessment";

const ATTEMPT_RULES: AttemptRule[] = ["BEST", "FIRST", "LATEST"];
const SOURCES: ComponentSource[] = ["ENTERED", "PLATFORM"];

function sameForm(a: SchemeForm, b: SchemeForm) {
  return JSON.stringify(schemeRequest(a)) === JSON.stringify(schemeRequest(b));
}

export function SchemeEditor({
  scheme,
  onChanged,
  onDirtyChange,
}: {
  scheme: SchemeDetail;
  /** The scheme as the server now has it, after a save or publish. */
  onChanged: (scheme: SchemeDetail) => void;
  /** Whether there are unsaved changes, for the page's leave guard. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const saved = useMemo(() => schemeFormFrom(scheme), [scheme]);
  const [form, setForm] = useState<SchemeForm>(saved);
  const [saving, setSaving] = useState(false);
  const [reasons, setReasons] = useState<{ title: string; list: string[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [pickingFor, setPickingFor] = useState<number | null>(null);
  const [samples, setSamples] = useState<string[]>([]);

  // A fresh copy from the server (after a save) replaces the form.
  useEffect(() => setForm(saved), [saved]);

  const dirty = !sameForm(form, saved);

  // The page asks before leaving with unsaved changes (useLeaveGuard).
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const total = weightTotal(form.components.map((c) => c.weightPercent));
  const samplePercents = form.components.map((_, i) => parseNumber(samples[i] ?? "75") ?? 0);
  const example = previewResult(form, samplePercents);

  function update(patch: Partial<SchemeForm>) {
    setForm((f) => ({ ...f, ...patch }));
    setNotice(null);
  }
  function updateComponent(index: number, patch: Partial<ComponentForm>) {
    setForm((f) => ({ ...f, components: f.components.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));
    setNotice(null);
  }
  function moveComponent(index: number, by: -1 | 1) {
    setForm((f) => {
      const next = [...f.components];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return { ...f, components: next };
    });
    setSamples((s) => {
      const next = [...s];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });
  }
  function removeComponent(index: number) {
    setForm((f) => ({ ...f, components: f.components.filter((_, i) => i !== index) }));
    setSamples((s) => s.filter((_, i) => i !== index));
  }

  async function save(): Promise<SchemeDetail | null> {
    setSaving(true);
    setReasons(null);
    setNotice(null);
    try {
      const sent = form;
      const { data } = await api.put<SchemeDetail>(`/assessment/schemes/${scheme.id}`, schemeRequest(sent));
      onChanged(data);
      setNotice("Draft saved.");
      return data;
    } catch (err) {
      setReasons({ title: "The draft wasn't saved:", list: refusalReasons(err, "save this draft") });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setPublishing(true);
    setReasons(null);
    try {
      if (dirty && !(await save())) {
        setConfirmPublish(false);
        return;
      }
      const { data } = await api.post<SchemeDetail>(`/assessment/schemes/${scheme.id}/publish`);
      setConfirmPublish(false);
      onChanged(data);
    } catch (err) {
      setConfirmPublish(false);
      setReasons({ title: "It wasn't published:", list: refusalReasons(err, "publish this scheme") });
    } finally {
      setPublishing(false);
    }
  }

  const canLinkSets = !scheme.isTemplate;

  return (
    <div className="space-y-6">
      {reasons ? <ReasonsBox title={reasons.title} reasons={reasons.list} /> : null}
      {notice ? <AlertBanner tone="success" message={notice} /> : null}

      {/* Nothing can be typed while a save is on its way: the server's copy
          replaces the form when it arrives. */}
      <fieldset disabled={saving || publishing} className="min-w-0 space-y-6">
      <Card className="space-y-5 p-6">
        <div>
          <CardTitle>How the Result Is Worked Out</CardTitle>
          <CardDescription>The pass mark, how practice attempts are counted, and how results are rounded.</CardDescription>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="Scheme Name"
            value={form.name}
            maxLength={150}
            onChange={(e) => update({ name: e.target.value })}
          />
          <SelectField
            label="Practice Attempts"
            hint={ATTEMPT_RULE_MEANING[form.attemptRule]}
            value={form.attemptRule}
            onChange={(e) => update({ attemptRule: e.target.value as AttemptRule })}
          >
            {ATTEMPT_RULES.map((rule) => (
              <option key={rule} value={rule}>
                {ATTEMPT_RULE_LABEL[rule]}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Pass Mark (%)"
            inputMode="decimal"
            value={form.passPercent}
            onChange={(e) => update({ passPercent: e.target.value })}
          />
          <div className="space-y-2">
            <p className="text-[0.875rem] font-semibold text-content">Result Shown To</p>
            <SegmentedControl
              label="Decimal places in the result"
              segments={[
                { key: "0", label: "Whole Numbers" },
                { key: "1", label: "One Decimal Place" },
              ]}
              value={String(form.decimalPlaces) as "0" | "1"}
              onChange={(key) => update({ decimalPlaces: key === "1" ? 1 : 0 })}
            />
          </div>
          <TextField
            label="Word for a Pass"
            value={form.passLabel}
            maxLength={40}
            onChange={(e) => update({ passLabel: e.target.value })}
          />
          <TextField
            label="Word for Below the Pass Mark"
            value={form.failLabel}
            maxLength={40}
            onChange={(e) => update({ failLabel: e.target.value })}
          />
          <TextField
            label="Description"
            hint="Optional"
            containerClassName="md:col-span-2"
            value={form.description}
            maxLength={300}
            onChange={(e) => update({ description: e.target.value })}
          />
        </div>
      </Card>

      <Card className="space-y-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Components</CardTitle>
            <CardDescription>
              Each part of the result and its weight. Absent counts as 0; Exempt shares that component&apos;s weight
              among the others.
            </CardDescription>
          </div>
          <Badge tone={total.complete ? "success" : "warning"} size="md">
            {total.complete ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            Weights Total {total.total}%{total.complete ? "" : " of 100%"}
          </Badge>
        </div>

        {form.components.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-content-muted">
            No components yet. Add the tests, examinations and other work that make up the result.
          </p>
        ) : (
          <ol aria-label="Components" className="space-y-4">
            {form.components.map((component, index) => (
              <li
                key={component.componentKey ?? `new-${index}`}
                className="space-y-4 rounded-2xl border border-line bg-surface-muted p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-content">
                    {index + 1}. {component.name.trim() || "New Component"}
                  </p>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="tinted"
                      aria-label={`Move ${component.name || "component"} up`}
                      disabled={index === 0}
                      onClick={() => moveComponent(index, -1)}
                    >
                      <ArrowUp className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      size="sm"
                      variant="tinted"
                      aria-label={`Move ${component.name || "component"} down`}
                      disabled={index === form.components.length - 1}
                      onClick={() => moveComponent(index, 1)}
                    >
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      size="sm"
                      variant="tinted"
                      leadingIcon={<Trash className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => removeComponent(index)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <TextField
                    label="Name"
                    aria-label={`Name, component ${index + 1}${component.name.trim() ? `, ${component.name.trim()}` : ""}`}
                    value={component.name}
                    maxLength={120}
                    onChange={(e) => updateComponent(index, { name: e.target.value })}
                  />
                  <SelectField
                    label="Kind"
                    aria-label={`Kind, component ${index + 1}${component.name.trim() ? `, ${component.name.trim()}` : ""}`}
                    value={component.kind}
                    onChange={(e) => updateComponent(index, { kind: e.target.value as ComponentForm["kind"] })}
                  >
                    {KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {KIND_LABEL[kind]}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField
                    label="Term"
                    aria-label={`Term, component ${index + 1}${component.name.trim() ? `, ${component.name.trim()}` : ""}`}
                    value={component.term}
                    onChange={(e) => updateComponent(index, { term: e.target.value as ComponentForm["term"] })}
                  >
                    {TERMS.map((term) => (
                      <option key={term} value={term}>
                        {TERM_LABEL[term]}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField
                    label="Marks"
                    aria-label={`Marks, component ${index + 1}${component.name.trim() ? `, ${component.name.trim()}` : ""}`}
                    value={component.source}
                    onChange={(e) => updateComponent(index, { source: e.target.value as ComponentSource })}
                  >
                    {SOURCES.map((source) => (
                      <option key={source} value={source}>
                        {SOURCE_LABEL[source]}
                      </option>
                    ))}
                  </SelectField>
                  <TextField
                    label="Out Of"
                    aria-label={`Out Of, component ${index + 1}${component.name.trim() ? `, ${component.name.trim()}` : ""}`}
                    inputMode="decimal"
                    value={component.maxMarks}
                    onChange={(e) => updateComponent(index, { maxMarks: e.target.value })}
                  />
                  <TextField
                    label="Weight (%)"
                    aria-label={`Weight (%), component ${index + 1}${component.name.trim() ? `, ${component.name.trim()}` : ""}`}
                    inputMode="decimal"
                    value={component.weightPercent}
                    onChange={(e) => updateComponent(index, { weightPercent: e.target.value })}
                  />
                  <TextField
                    label="Own Pass Mark (%)"
                    aria-label={`Own Pass Mark (%), component ${index + 1}${component.name.trim() ? `, ${component.name.trim()}` : ""}`}
                    hint="Optional"
                    inputMode="decimal"
                    value={component.minPassPercent}
                    onChange={(e) => updateComponent(index, { minPassPercent: e.target.value })}
                  />
                </div>
                {component.source === "PLATFORM" ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface p-3 text-sm">
                    {canLinkSets ? (
                      <>
                        <span className="text-content-muted">
                          {component.activityIds.length === 0
                            ? "No practice sets linked yet."
                            : `${component.activityIds.length} practice ${component.activityIds.length === 1 ? "set" : "sets"} linked.`}{" "}
                          Each student&apos;s score is their total marks across these sets, as a percentage. A set given and never done counts 0 once it closes.
                        </span>
                        <Button size="sm" variant="secondary" onClick={() => setPickingFor(index)}>
                          Choose Practice Sets
                        </Button>
                      </>
                    ) : (
                      <span className="text-content-muted">
                        The school links the practice sets when it uses this template.
                      </span>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        <Button
          variant="secondary"
          leadingIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
          disabled={form.components.length >= 20}
          onClick={() => update({ components: [...form.components, blankComponent()] })}
        >
          Add Component
        </Button>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-5 p-6">
          <div>
            <CardTitle>Grades</CardTitle>
            <CardDescription>A grade starts at its percentage. The lowest grade must start at 0.</CardDescription>
          </div>
          <ul className="space-y-3">
            {form.gradeBands.map((band, index) => (
              <li key={index} className="flex items-end gap-3">
                <TextField
                  label="Grade"
                  aria-label={`Grade, grade ${index + 1}`}
                  containerClassName="flex-1"
                  value={band.label}
                  maxLength={20}
                  onChange={(e) =>
                    update({ gradeBands: form.gradeBands.map((b, i) => (i === index ? { ...b, label: e.target.value } : b)) })
                  }
                />
                <TextField
                  label="From (%)"
                  aria-label={`From (%), grade ${index + 1}`}
                  containerClassName="w-32"
                  inputMode="decimal"
                  value={band.minPercent}
                  onChange={(e) =>
                    update({
                      gradeBands: form.gradeBands.map((b, i) => (i === index ? { ...b, minPercent: e.target.value } : b)),
                    })
                  }
                />
                <Button
                  variant="tinted"
                  aria-label={`Remove grade ${band.label || index + 1}`}
                  onClick={() => update({ gradeBands: form.gradeBands.filter((_, i) => i !== index) })}
                >
                  <Trash className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          <Button
            variant="secondary"
            leadingIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
            disabled={form.gradeBands.length >= 15}
            onClick={() => update({ gradeBands: [...form.gradeBands, { label: "", minPercent: "" }] })}
          >
            Add Grade
          </Button>
        </Card>

        <Card className="space-y-5 p-6">
          <div>
            <CardTitle>Try It</CardTitle>
            <CardDescription>
              Type a percentage for each component to see the result one student would get. An example only: real
              results come from the marks.
            </CardDescription>
          </div>
          {form.components.length === 0 ? (
            <p className="text-sm text-content-muted">Add a component to try it.</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {form.components.map((component, index) => (
                  <TextField
                    key={component.componentKey ?? `try-${index}`}
                    label={`${component.name.trim() || `Component ${index + 1}`} (%)`}
                    inputMode="decimal"
                    value={samples[index] ?? "75"}
                    onChange={(e) =>
                      setSamples((s) => {
                        const next = [...s];
                        while (next.length < form.components.length) next.push("75");
                        next[index] = e.target.value;
                        return next;
                      })
                    }
                  />
                ))}
              </div>
              <div className="rounded-2xl bg-surface-brand p-4" aria-live="polite">
                {example ? (
                  <p className="text-sm text-content">
                    Result <strong className="text-lg">{example.shown}%</strong>
                    {example.grade ? (
                      <>
                        , grade <strong>{example.grade}</strong>
                      </>
                    ) : null}
                    , <strong>{example.passed ? form.passLabel || "Pass" : form.failLabel || "Below the Pass Mark"}</strong>
                  </p>
                ) : (
                  <p className="text-sm text-content-muted">Fill in the weights and the pass mark to see a result.</p>
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      </fieldset>

      {scheme.publishProblems.length > 0 && !dirty ? (
        <ReasonsBox title="Before it can be published:" reasons={scheme.publishProblems} />
      ) : null}

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-line bg-surface/95 p-3 shadow-md backdrop-blur">
        <span className="mr-auto pl-2 text-sm text-content-muted" aria-live="polite">
          {dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <Button
          variant="secondary"
          leadingIcon={<Save className="h-4 w-4" aria-hidden="true" />}
          loading={saving && !publishing}
          loadingLabel="Saving"
          disabled={!dirty || saving || publishing}
          onClick={() => void save()}
        >
          Save Draft
        </Button>
        <Button
          variant="primary"
          leadingIcon={<Send className="h-4 w-4" aria-hidden="true" />}
          disabled={saving || publishing}
          onClick={() => {
            setReasons(null);
            setConfirmPublish(true);
          }}
        >
          Publish
        </Button>
      </div>

      <Modal
        open={confirmPublish}
        onClose={() => (publishing ? undefined : setConfirmPublish(false))}
        title={scheme.isTemplate ? "Publish This Template?" : "Publish This Scheme?"}
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={publishing} onClick={() => setConfirmPublish(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={publishing} loadingLabel="Publishing" onClick={() => void publish()}>
              Publish
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-content">
          {scheme.isTemplate ? (
            <p>Every school will be able to start a scheme from it. It can&apos;t be changed once published.</p>
          ) : (
            <>
              <p>Teachers will enter marks against it, and results will be worked out from it.</p>
              <p>It can&apos;t be changed once published. To change it later, you make a new version.</p>
              {scheme.version > 1 ? (
                <p>
                  It replaces version {scheme.version - 1}. Marks already entered carry over to the components that are
                  still in this version, except where the maximum is now below the mark or the marks now come from
                  the platform.
                </p>
              ) : null}
            </>
          )}
          {dirty ? <p className="font-semibold">Your unsaved changes are saved first.</p> : null}
        </div>
      </Modal>

      {pickingFor !== null && form.components[pickingFor] ? (
        <ActivityPicker
          schemeId={scheme.id}
          componentName={form.components[pickingFor].name}
          chosen={form.components[pickingFor].activityIds}
          savedTitles={Object.fromEntries(
            scheme.components.flatMap((c) => c.activities.map((a) => [a.id, a.title ?? "Practice Set"])),
          )}
          onClose={() => setPickingFor(null)}
          onChoose={(ids) => {
            updateComponent(pickingFor, { activityIds: ids });
            setPickingFor(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ActivityPicker({
  schemeId,
  componentName,
  chosen,
  savedTitles,
  onClose,
  onChoose,
}: {
  schemeId: string;
  componentName: string;
  chosen: string[];
  /** Titles of the sets the saved scheme links, for one no longer listed. */
  savedTitles: Record<string, string>;
  onClose: () => void;
  onChoose: (ids: string[]) => void;
}) {
  const [activities, setActivities] = useState<LinkableActivity[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(chosen));

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ activities: LinkableActivity[] }>(`/assessment/schemes/${schemeId}/activities`)
      .then(({ data }) => !cancelled && setActivities(data.activities))
      .catch((err) => !cancelled && setProblem(refusalReasons(err, "load the practice sets")[0]));
    return () => {
      cancelled = true;
    };
  }, [schemeId]);

  const chapters = useMemo(() => {
    const groups = new Map<string, { title: string; chapterNo: number; items: LinkableActivity[] }>();
    for (const activity of activities ?? []) {
      const group = groups.get(activity.chapter.id) ?? {
        title: activity.chapter.title,
        chapterNo: activity.chapter.chapterNo,
        items: [],
      };
      group.items.push(activity);
      groups.set(activity.chapter.id, group);
    }
    return [...groups.values()];
  }, [activities]);
  // A linked set that has since been unpublished is not offered any more,
  // but it is still linked: shown so it can be unticked.
  const gone = activities ? chosen.filter((id) => !activities.some((a) => a.id === id)) : [];

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 100) next.add(id);
      return next;
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Choose Practice Sets"
      eyebrow={componentName.trim() || undefined}
      size="lg"
      footer={
        <>
          <span className="mr-auto text-sm text-content-muted">{picked.size} chosen</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={activities === null} onClick={() => onChoose([...picked])}>
            Use These Sets
          </Button>
        </>
      }
    >
      {problem ? (
        <p role="alert" className="text-sm text-coral-700">
          {problem}
        </p>
      ) : activities === null ? (
        <p className="text-sm text-content-muted">Loading practice sets…</p>
      ) : activities.length === 0 && gone.length === 0 ? (
        <p className="text-sm text-content-muted">
          This subject has no published practice sets yet. Publish some in the Curriculum Studio first, or have
          teachers enter this component&apos;s marks.
        </p>
      ) : (
        <div className="space-y-5">
          {gone.length > 0 ? (
            <fieldset className="space-y-2 rounded-xl bg-coral-50 p-3">
              <legend className="text-sm font-bold text-coral-800">No Longer Published</legend>
              <p className="text-sm text-coral-800">Untick these: a set that isn&apos;t published can&apos;t be linked.</p>
              {gone.map((id) => (
                <label key={id} className="flex cursor-pointer items-center gap-3 rounded-xl p-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-600"
                    checked={picked.has(id)}
                    onChange={() => toggle(id)}
                  />
                  <span className="text-sm text-content">{savedTitles[id] ?? "Practice Set"}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          {chapters.map((chapter) => (
            <fieldset key={`${chapter.chapterNo}-${chapter.title}`} className="space-y-2">
              <legend className="text-sm font-bold text-content">
                Chapter {chapter.chapterNo}: {chapter.title}
              </legend>
              {chapter.items.map((activity) => (
                <label key={activity.id} className="flex cursor-pointer items-center gap-3 rounded-xl p-2 hover:bg-surface-muted">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-600"
                    checked={picked.has(activity.id)}
                    onChange={() => toggle(activity.id)}
                  />
                  <span className="text-sm text-content">{activity.title}</span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      )}
    </Modal>
  );
}
