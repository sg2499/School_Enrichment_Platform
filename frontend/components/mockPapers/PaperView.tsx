"use client";

/**
 * One mock paper (#166 step 3): the teacher's preview of a draft, with a
 * sample copy of every question, the checks against its format, and the
 * approval that makes every student's version at once. The sample copies
 * here are never given to a student; each student's version has its own
 * numbers.
 */
import { useState } from "react";
import { CheckCircle2, CircleAlert, Dices, RefreshCw, ShieldCheck, Trash2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { api, describeApiError } from "@/lib/api";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import {
  DIFFICULTY_LABEL,
  durationText,
  fromLocalInput,
  KIND_LABEL,
  sectionText,
  STATUS_LABEL,
  STATUS_TONE,
  toLocalInput,
} from "@/lib/mockPapers";
import { formatDateTime } from "@/lib/tracker";
import { cn } from "@/lib/utils";
import { AlertBanner, LoadError } from "@/components/ui/AlertBanner";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { TextField } from "@/components/ui/Field";
import { InlineLink } from "@/components/ui/InlineLink";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { MarkingPanel, ResultsPanel } from "@/components/mockPapers/PaperResults";
import { TableSkeleton } from "@/components/ui/Table";
import type { PaperDetail, PaperSlot, SampleQuestion } from "@/types/mockPapers";
import { QuestionFigure } from "@/components/ui/QuestionFigure";

function Question({ q, letter }: { q: SampleQuestion; letter: string | null }) {
  const labelled = letter && !/^\([a-z]\)\s/.test(q.text);
  return (
    <div className={cn("space-y-3", letter && "border-l-2 border-line pl-4")}>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 whitespace-pre-line text-[0.9375rem] leading-relaxed text-content">
          {labelled ? <span className="font-semibold">({letter}) </span> : null}
          {q.text}
        </p>
        <span className="mt-0.5 shrink-0 whitespace-nowrap rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-semibold text-content-muted">
          {q.marks} {q.marks === 1 ? "mark" : "marks"}
        </span>
      </div>
      <QuestionFigure svg={q.figureSvg} />
      {q.options ? (
        <ol className="grid gap-2 sm:grid-cols-2">
          {q.options.map((o) => (
            <li
              key={o.letter}
              className="flex items-start gap-3 rounded-xl border border-line bg-surface-muted/60 px-3.5 py-2.5 text-sm leading-relaxed text-content"
            >
              <span
                aria-hidden
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface text-xs font-bold text-content-subtle ring-1 ring-inset ring-line"
              >
                {o.letter}
              </span>
              <span className="min-w-0 flex-1 wrap-break-word pt-0.5 font-medium">
                <span className="sr-only">Option {o.letter}: </span>
                {o.text}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      <details className="group rounded-xl border border-line bg-surface-muted/40 text-xs text-content-muted">
        <summary className="cursor-pointer select-none px-3.5 py-2.5 font-semibold text-content">Answer and Marking</summary>
        <div className="space-y-2 border-t border-line px-3.5 py-3 leading-relaxed">
          <p>
            <span className="font-semibold text-content">Answer:</span> {q.answer}
            {q.answerUnit ? ` ${q.answerUnit}` : ""}
            {q.acceptedVariants ? ` (also accepted: ${q.acceptedVariants})` : ""}
          </p>
          {q.markingSteps ? (
            <p className="whitespace-pre-line">
              <span className="font-semibold text-content">Marking Steps:</span> {q.markingSteps}
            </p>
          ) : null}
          {q.explanation ? (
            <p className="whitespace-pre-line">
              <span className="font-semibold text-content">Explanation:</span> {q.explanation}
            </p>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function Slot({
  slot,
  number,
  editable,
  busy,
  onRegenerate,
}: {
  slot: PaperSlot;
  number: number;
  editable: boolean;
  busy: boolean;
  onRegenerate: (mode: "numbers" | "question") => void;
}) {
  const parts = slot.sample?.questions ?? [];
  return (
    <li
      className={cn(
        "rounded-2xl border p-4 sm:p-5",
        slot.problem ? "border-coral-200 bg-coral-50" : "border-line bg-surface",
        slot.alternative && "ml-4 sm:ml-8",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line pb-3">
        <p className="min-w-0 text-xs font-semibold uppercase tracking-wide text-content-subtle">
          {slot.alternative ? "Or" : `Question ${number}`}
          {slot.pattern ? (
            <span className="ml-2 font-normal normal-case tracking-normal">
              {[
                slot.pattern.chapterNo ? `Chapter ${slot.pattern.chapterNo}` : null,
                slot.pattern.skill,
                DIFFICULTY_LABEL[slot.pattern.difficulty],
                slot.pattern.application ? "Application" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          ) : null}
        </p>
        {editable ? (
          <span className="flex flex-wrap gap-2">
            {slot.pattern ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                leadingIcon={<Dices className="h-3.5 w-3.5" />}
                onClick={() => onRegenerate("numbers")}
              >
                New Numbers
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              leadingIcon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => onRegenerate("question")}
            >
              {slot.pattern ? "Another Question" : "Find a Question"}
            </Button>
          </span>
        ) : null}
      </div>
      {slot.problem ? (
        <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-coral-800">
          <CircleAlert className="h-4 w-4 shrink-0" aria-hidden />
          {slot.problem}
        </p>
      ) : null}
      {slot.sample ? (
        <div className="mt-4 space-y-5">
          {slot.sample.stimulus ? (
            <p className="whitespace-pre-line rounded-xl bg-surface-brand px-4 py-3 text-[0.9375rem] leading-relaxed text-content">{slot.sample.stimulus}</p>
          ) : null}
          {parts.map((q, i) => (
            <Question key={i} q={q} letter={parts.length > 1 ? String.fromCharCode(97 + i) : null} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function PaperView({ paperId, role, backHref }: { paperId: string; role: "TEACHER" | "ADMIN"; backHref: string }) {
  const router = useRouter();
  const paper = useApiQuery<PaperDetail>(`/mock-papers/${paperId}`, {}, { action: "open this paper" });
  const [data, setData] = useState<PaperDetail | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [typedTitle, setTypedTitle] = useState("");
  const [editing, setEditing] = useState(false);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", opens: "", closes: "" });
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const [view, setView] = useState<"paper" | "results" | "marking">("results");

  const shown = data && data.id === paperId ? data : paper.data;

  async function run(action: string, call: () => Promise<{ data: PaperDetail }>, after?: (d: PaperDetail) => void) {
    setProblem(null);
    setNotice(null);
    try {
      const { data: next } = await call();
      setData(next);
      after?.(next);
    } catch (err) {
      setProblem(describeApiError(err, action).message);
    }
  }

  if (paper.problem) return <LoadError problem={paper.problem} onRetry={paper.reload} />;
  if (!shown) return <TableSkeleton label="Opening the paper" rows={5} />;

  const draft = shown.status === "DRAFT";
  // Once approved and opened, a paper has results and marking to show.
  const sitting = shown.status === "OPEN" || shown.status === "CLOSED";
  const editable = draft && shown.canChange && role === "TEACHER";
  const fmt = shown.format;
  let number = 0;

  return (
    <div className="space-y-8">
      <PageHeader
        surface="masthead"
        eyebrow="Mock Paper"
        title={shown.title}
        back={
          <InlineLink href={backHref} direction="back" tone="inverse" size="sm">
            Mock Papers
          </InlineLink>
        }
        meta={
          <Badge tone={STATUS_TONE[shown.status]} onDark>
            {STATUS_LABEL[shown.status]}
          </Badge>
        }
        facts={[
          { label: "Section", value: `${shown.classLevel ?? ""} ${shown.section}`.trim() },
          { label: "Format", value: shown.formatName },
          { label: "Marks", value: shown.totalMarks },
          {
            label: "Time",
            value: `${durationText(shown.timeMinutes)}${shown.readingMinutes ? ` + ${shown.readingMinutes} min reading` : ""}`,
          },
          { label: "Opens", value: formatDateTime(shown.opensAt) },
          { label: "Closes", value: formatDateTime(shown.closesAt) },
          ...(draft ? [] : [{ label: "Students", value: shown.versions }]),
        ]}
        actions={
          editable ? (
            <span className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setForm({
                    title: shown.title,
                    opens: toLocalInput(new Date(shown.opensAt)),
                    closes: toLocalInput(new Date(shown.closesAt)),
                  });
                  setEditing(true);
                }}
              >
                Edit Title and Dates
              </Button>
              <Button
                type="button"
                variant="accent"
                leadingIcon={<ShieldCheck className="h-4 w-4" />}
                disabled={!shown.checks.canApprove}
                onClick={() => setApproving(true)}
              >
                Approve Paper
              </Button>
            </span>
          ) : shown.status === "SCHEDULED" && shown.canChange && role === "TEACHER" ? (
            <Button type="button" variant="secondary" leadingIcon={<Undo2 className="h-4 w-4" />} onClick={() => setWithdrawing(true)}>
              Withdraw
            </Button>
          ) : role === "ADMIN" && !draft ? (
            <Button type="button" variant="ghost" leadingIcon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleting(true)}>
              Delete Paper
            </Button>
          ) : null
        }
      />

      {problem ? <AlertBanner tone="error" message={problem} /> : null}
      {notice ? <AlertBanner tone="success" message={notice} /> : null}
      {shown.status === "WITHDRAWN" && shown.withdrawReason ? (
        <AlertBanner tone="info" message={`Withdrawn: ${shown.withdrawReason}`} />
      ) : null}
      {draft ? (
        <AlertBanner
          tone="info"
          message={
            editable
              ? "This is a sample copy. Every student gets their own version with different numbers, made when you approve. Use New Numbers or Another Question on any question you'd change."
              : "This is a draft. The section's teacher previews and approves it; students see nothing until then."
          }
        />
      ) : (
        <AlertBanner
          tone="info"
          message={`Below is a sample copy. Each of the ${shown.versions} students has their own version, with the same kinds of questions and different numbers.`}
        />
      )}

      {sitting ? (
        <SegmentedControl<"paper" | "results" | "marking">
          label="What to show"
          segments={[
            { key: "results", label: "Results" },
            { key: "marking", label: "Marking" },
            { key: "paper", label: "Sample Paper" },
          ]}
          value={view}
          onChange={setView}
        />
      ) : null}
      {sitting && view === "results" ? <ResultsPanel key={`r-${shown.versions}`} paperId={paperId} canAct /> : null}
      {sitting && view === "marking" ? <MarkingPanel paperId={paperId} canAct /> : null}

      {!sitting || view === "paper" ? (
        <>
          <Card>
            <CardBody className="space-y-3 sm:p-6">
              <h2 className="font-display text-display-sm text-content">Checks</h2>
              <ul className="space-y-2">
                {shown.checks.items.map((c) => (
                  <li key={c.key} className="flex items-start gap-3 text-sm">
                    {c.ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-jade-600" aria-label="Met" />
                    ) : (
                      <CircleAlert
                        className={cn("mt-0.5 h-4 w-4 shrink-0", c.blocking ? "text-coral-600" : "text-saffron-700")}
                        aria-label={c.blocking ? "Must fix" : "Worth a look"}
                      />
                    )}
                    <span>
                      <span className="font-semibold text-content">{c.label}:</span> <span className="text-content-muted">{c.detail}</span>
                      {!c.ok && c.blocking ? <span className="ml-1 font-semibold text-coral-800">Fix this before approving.</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
              {fmt.navigation === "FORWARD" || fmt.shuffle ? (
                <p className="text-xs text-content-subtle">
                  {[
                    fmt.navigation === "FORWARD" ? "Students move through the sections in order, one way" : null,
                    fmt.shuffle ? "each student's questions come in their own order" : null,
                  ]
                    .filter(Boolean)
                    .join("; ")}
                  .
                </p>
              ) : null}
            </CardBody>
          </Card>

          {shown.sections.map((section) => (
            <section key={section.index} aria-labelledby={`section-${section.index}`} className="space-y-3">
              <div>
                <h2 id={`section-${section.index}`} className="font-display text-display-sm text-content">
                  {section.name}
                </h2>
                <p className="text-sm text-content-muted">
                  {sectionText(section)} · {KIND_LABEL[section.kind]}
                </p>
              </div>
              <ol className="space-y-3">
                {section.slots.map((slot) => {
                  if (!slot.alternative) number += 1;
                  return (
                    <Slot
                      key={slot.slotId}
                      slot={slot}
                      number={number}
                      editable={editable}
                      busy={busySlot !== null}
                      onRegenerate={async (mode) => {
                        setBusySlot(slot.slotId);
                        await run(mode === "numbers" ? "make new numbers" : "find another question", () =>
                          api.post<PaperDetail>(`/mock-papers/${paperId}/slots/${slot.slotId}/regenerate`, { mode }),
                        );
                        setBusySlot(null);
                      }}
                    />
                  );
                })}
              </ol>
            </section>
          ))}
        </>
      ) : null}

      {editable ? (
        <div className="flex justify-end">
          <Button type="button" variant="ghost" leadingIcon={<Trash2 className="h-4 w-4" />} onClick={() => setDiscarding(true)}>
            Discard Draft
          </Button>
        </div>
      ) : null}

      <Modal
        open={approving}
        onClose={() => (busy ? undefined : setApproving(false))}
        title="Approve This Paper?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setApproving(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy}
              loadingLabel="Making each student's version"
              onClick={async () => {
                setBusy(true);
                await run(
                  "approve this paper",
                  () => api.post<PaperDetail>(`/mock-papers/${paperId}/approve`),
                  (d) => setNotice(`Approved. ${d.versions} students each have their own version, ready when the paper opens.`),
                );
                setBusy(false);
                setApproving(false);
              }}
            >
              Approve
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-content">
          <p>
            Every active student in the section gets their own version now, with fresh numbers they haven&apos;t had before. The paper
            can&apos;t be changed after this; it can be withdrawn until it opens on {formatDateTime(shown.opensAt)}. Approve before then:
            once the opening time has passed, choose new dates first.
          </p>
          <p className="text-content-muted">Mock papers are practice: they don&apos;t count towards report cards.</p>
        </div>
      </Modal>

      <Modal
        open={withdrawing}
        onClose={() => (busy ? undefined : setWithdrawing(false))}
        title="Withdraw This Paper?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setWithdrawing(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy}
              loadingLabel="Withdrawing"
              disabled={why.trim() === ""}
              onClick={async () => {
                setBusy(true);
                await run("withdraw this paper", () => api.post<PaperDetail>(`/mock-papers/${paperId}/withdraw`, { reason: why.trim() }));
                setBusy(false);
                setWithdrawing(false);
                setWhy("");
              }}
            >
              Withdraw
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm text-content">
          <p>Students won&apos;t see this paper. It stays on record as withdrawn.</p>
          <TextField
            label="Reason"
            hint={`${why.length}/300`}
            maxLength={300}
            value={why}
            placeholder="For example: wrong chapters chosen"
            onChange={(e) => setWhy(e.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={deleting}
        onClose={() => (busy ? undefined : setDeleting(false))}
        title="Delete This Paper?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy}
              loadingLabel="Deleting"
              disabled={why.trim() === "" || typedTitle.trim().toLowerCase() !== shown.title.trim().toLowerCase()}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.post(`/mock-papers/${paperId}/delete`, { reason: why.trim(), title: typedTitle.trim() });
                  router.push(backHref);
                } catch (err) {
                  setProblem(describeApiError(err, "delete this paper").message);
                  setBusy(false);
                  setDeleting(false);
                }
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm text-content">
          <p>
            This removes the paper for good, with every student&apos;s version, answers and marks. It cannot be undone, and a note of
            who deleted it and why stays in the activity log. Use it only when it can&apos;t be avoided.
          </p>
          <TextField
            label="Reason"
            hint={`${why.length}/300`}
            maxLength={300}
            value={why}
            placeholder="For example: test run on test accounts"
            onChange={(e) => setWhy(e.target.value)}
          />
          <TextField
            label="Type the paper's title to confirm"
            value={typedTitle}
            placeholder={shown.title}
            onChange={(e) => setTypedTitle(e.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={discarding}
        onClose={() => (busy ? undefined : setDiscarding(false))}
        title="Discard This Draft?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setDiscarding(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy}
              loadingLabel="Discarding"
              onClick={async () => {
                setBusy(true);
                try {
                  await api.delete(`/mock-papers/${paperId}`);
                  router.push(backHref);
                } catch (err) {
                  setProblem(describeApiError(err, "discard this draft").message);
                  setBusy(false);
                  setDiscarding(false);
                }
              }}
            >
              Discard
            </Button>
          </>
        }
      >
        <p className="text-sm text-content">The draft is deleted. No student had it.</p>
      </Modal>

      <Modal
        open={editing}
        onClose={() => (busy ? undefined : setEditing(false))}
        title="Title and Dates"
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy}
              loadingLabel="Saving"
              onClick={async () => {
                const opensAt = fromLocalInput(form.opens);
                const closesAt = fromLocalInput(form.closes);
                if (!opensAt || !closesAt) {
                  setFormProblem("Choose when the paper opens and closes.");
                  return;
                }
                setFormProblem(null);
                setBusy(true);
                await run("save the title and dates", () =>
                  api.patch<PaperDetail>(`/mock-papers/${paperId}`, { title: form.title, opensAt, closesAt }),
                );
                setBusy(false);
                setEditing(false);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formProblem ? <AlertBanner tone="error" message={formProblem} /> : null}
          <TextField label="Title" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <TextField label="Opens" type="datetime-local" value={form.opens} onChange={(e) => setForm({ ...form, opens: e.target.value })} />
          <TextField
            label="Closes"
            type="datetime-local"
            value={form.closes}
            onChange={(e) => setForm({ ...form, closes: e.target.value })}
          />
        </div>
      </Modal>
    </div>
  );
}
