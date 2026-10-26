"use client";

/**
 * Weekly Reports (#187, 26 Oct 2026), for a section's teacher and the
 * school's admin: every child's week for their parents, drafted by the
 * platform from the practice. The teacher adds a note for the section (and
 * one for any child who needs it), issues the whole section in one step,
 * and downloads one PDF of every page or a single child's page.
 *
 * Shailesh's decisions: a teacher who teaches the section now, or the
 * admin, issues; no class ranking on the page; a note for the section plus
 * an optional note per child. Issued pages are kept as issued; to change
 * one, withdraw the week and issue it again.
 */
import { useEffect, useMemo, useState } from "react";
import { Eye, Save, Send, Undo2 } from "lucide-react";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { useUrlState } from "@/lib/hooks/useUrlState";
import {
  changedNotes,
  cleanNote,
  MAX_NOTE,
  noteProblem,
  numbersText,
  pdfName,
  sectionKey,
  sectionName,
  totalsText,
} from "@/lib/weeklyReports";
import { cn } from "@/lib/utils";
import { AlertBanner, LoadError } from "@/components/ui/AlertBanner";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextField } from "@/components/ui/Field";
import { MastheadSelect } from "@/components/ui/MastheadSelect";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  Table,
  TableSkeleton,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui/Table";
import {
  ReasonsBox,
  refusalReasons,
  useLeaveGuard,
} from "@/components/assessment/common";
import { dayText, PdfButton } from "@/components/reportCards/common";
import { WeeklyReportView } from "@/components/weeklyReports/WeeklyReportView";
import type {
  SectionWeek,
  WeeklyReportData,
  WeeklySections,
} from "@/types/weeklyReports";

type Notes = { section: string; child: Record<string, string> };

const NOTE_BOX =
  "w-full rounded-2xl border border-line-field bg-surface px-4 py-3 text-base text-content shadow-xs outline-hidden transition duration-200 placeholder:text-content-faint hover:border-ink-500 focus:border-brand-500 focus:shadow-focus-field aria-invalid:border-coral-500 disabled:bg-surface-muted";

function counter(text: string): string {
  return `${cleanNote(text).length}/${MAX_NOTE}`;
}

function PreviewModal({
  title,
  path,
  params,
  draft,
  unsaved = false,
  onClose,
}: {
  title: string;
  path: string;
  params: Record<string, string>;
  draft: boolean;
  unsaved?: boolean;
  onClose: () => void;
}) {
  const page = useApiQuery<{ report: WeeklyReportData }>(path, params, {
    action: "open this child's page",
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      eyebrow={draft ? "Preview" : "As Issued"}
      size="xl"
    >
      {page.problem ? (
        <LoadError problem={page.problem} onRetry={page.reload} />
      ) : page.data ? (
        <div className="space-y-4">
          {unsaved ? (
            <AlertBanner
              tone="info"
              message="Notes you haven't saved yet aren't on this preview."
            />
          ) : null}
          <WeeklyReportView report={page.data.report} draft={draft} />
        </div>
      ) : (
        <p className="text-sm text-content-muted">Opening the page…</p>
      )}
    </Modal>
  );
}

export function WeeklyReports({
  role,
}: {
  role: "TEACHER" | "ADMIN" | "SUPER_ADMIN";
}) {
  const url = useUrlState();
  const sections = useApiQuery<WeeklySections>(
    role === "SUPER_ADMIN" ? null : "/weekly-reports/sections",
    {},
    {
      action: "load your sections",
    },
  );
  const list = sections.problem ? null : (sections.data?.sections ?? null);
  const section =
    list?.find((s) => sectionKey(s) === url.get("section")) ??
    list?.[0] ??
    null;
  const allWeeks = sections.data?.weeks ?? [];
  // A former teacher may open only the weeks they taught the section.
  const weeks = section
    ? allWeeks.filter((w) => section.weeks.includes(w.start))
    : [];
  const fallbackWeek =
    weeks.find((w) => w.start === sections.data?.defaultWeek)?.start ??
    weeks[0]?.start ??
    "";
  const weekStart =
    weeks.find((w) => w.start === url.get("week"))?.start ?? fallbackWeek;
  const scope =
    section && weekStart
      ? `${section.classLevelId}|${section.section}|${weekStart}`
      : "";

  const week = useApiQuery<SectionWeek>(
    scope ? "/weekly-reports/week" : null,
    {
      classLevelId: section?.classLevelId,
      section: section?.section,
      weekStart,
    },
    { action: "load this week's reports" },
  );
  // useApiQuery keeps the last answer while the next loads: only show the one on screen.
  const data = !week.problem && week.data?.scope === scope ? week.data : null;
  const issued = data?.issue ?? null;
  const editable = Boolean(data && data.canChange && !issued);

  // The notes, per section and week: what is saved and what is typed. Kept
  // per week, so switching weeks (or Back and Forward) never loses typing;
  // replaced from the server only on the first load and when the week is
  // issued or withdrawn (#187 review).
  const [saved, setSaved] = useState<Record<string, Notes>>({});
  const [drafts, setDrafts] = useState<Record<string, Notes>>({});
  const [loadedFrom, setLoadedFrom] = useState<Record<string, string>>({});
  const loadKey = data ? `${data.scope}|${issued?.id ?? ""}` : "";
  useEffect(() => {
    if (!data || loadedFrom[data.scope] === loadKey) return;
    const fromServer: Notes = {
      section: data.sectionNote ?? "",
      child: Object.fromEntries(
        data.students.map((s) => [s.studentId, s.note ?? ""]),
      ),
    };
    setSaved((prev) => ({ ...prev, [data.scope]: fromServer }));
    setDrafts((prev) => ({ ...prev, [data.scope]: fromServer }));
    setLoadedFrom((prev) => ({ ...prev, [data.scope]: loadKey }));
  }, [data, loadKey, loadedFrom]);
  const ready = Boolean(data) && loadedFrom[scope] === loadKey;
  const draft = ready ? drafts[scope] : undefined;
  const savedNotes = ready ? saved[scope] : undefined;
  const sectionDraft = draft?.section ?? "";
  const childDrafts = useMemo(() => draft?.child ?? {}, [draft]);
  const childChanges =
    draft && savedNotes ? changedNotes(draft.child, savedNotes.child) : [];
  const sectionChanged = Boolean(
    draft && savedNotes && cleanNote(draft.section) !== savedNotes.section,
  );
  const dirty = editable && (sectionChanged || childChanges.length > 0);
  const anyDirty = Object.keys(drafts).some((key) => {
    const d = drafts[key];
    const s = saved[key];
    return Boolean(
      d &&
      s &&
      (cleanNote(d.section) !== s.section ||
        changedNotes(d.child, s.child).length > 0),
    );
  });
  const tooLong =
    editable &&
    (noteProblem(sectionDraft) !== null ||
      Object.values(childDrafts).some((text) => noteProblem(text) !== null));
  const leave = useLeaveGuard(anyDirty);

  function setSectionDraft(text: string) {
    setDrafts((prev) => ({
      ...prev,
      [scope]: {
        ...(prev[scope] ?? { section: "", child: {} }),
        section: text,
      },
    }));
  }
  function setChildDraft(studentId: string, text: string) {
    setDrafts((prev) => {
      const current = prev[scope] ?? { section: "", child: {} };
      return {
        ...prev,
        [scope]: { ...current, child: { ...current.child, [studentId]: text } },
      };
    });
  }

  const [reasons, setReasons] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<{
    studentId: string;
    name: string;
    reportId: string | null;
  } | null>(null);

  const body = section
    ? {
        classLevelId: section.classLevelId,
        section: section.section,
        weekStart,
      }
    : null;

  async function saveNotes(): Promise<boolean> {
    if (!body || !dirty || !draft) return true;
    const savingScope = scope;
    const cleaned: Notes = {
      section: cleanNote(draft.section),
      child: Object.fromEntries(
        Object.entries(draft.child).map(([id, text]) => [id, cleanNote(text)]),
      ),
    };
    setSaving(true);
    setReasons([]);
    try {
      await api.put("/weekly-reports/notes", {
        ...body,
        sectionNote: cleaned.section || null,
        updateSection: sectionChanged,
        notes: childChanges,
      });
      // What was sent is now what is saved; the reload confirms it.
      setSaved((prev) => ({ ...prev, [savingScope]: cleaned }));
      setDrafts((prev) => ({ ...prev, [savingScope]: cleaned }));
      week.reload();
      setSavedNote(true);
      return true;
    } catch (err) {
      setReasons(refusalReasons(err, "save these notes"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function issue() {
    if (!body) return;
    setIssuing(true);
    setReasons([]);
    try {
      if (!(await saveNotes())) {
        setConfirming(false);
        return;
      }
      await api.post("/weekly-reports/issues", body);
      setConfirming(false);
      week.reload();
    } catch (err) {
      setConfirming(false);
      setReasons(refusalReasons(err, "issue this week's reports"));
      week.reload();
    } finally {
      setIssuing(false);
    }
  }

  async function withdraw() {
    if (!issued) return;
    setBusy(true);
    setReasons([]);
    try {
      await api.post(`/weekly-reports/issues/${issued.id}/withdraw`, {
        reason: why.trim(),
      });
      setWithdrawing(false);
      setWhy("");
      week.reload();
    } catch (err) {
      setWithdrawing(false);
      setReasons(refusalReasons(err, "withdraw this week's reports"));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setSavedNote(false);
    setReasons([]);
  }, [scope]);

  const students = data?.students ?? [];
  const given = students.reduce((sum, s) => sum + s.totals.given, 0);
  const done = students.reduce((sum, s) => sum + s.totals.done, 0);
  const sectionLabel = section ? sectionName(section) : "";
  const weekLabel =
    data?.week.label ?? weeks.find((w) => w.start === weekStart)?.label ?? "";

  return (
    <div className="space-y-8">
      <PageHeader
        surface="masthead"
        eyebrow="Parents"
        title="Weekly Reports"
        description="Each child's week for their parents, drafted from their practice. Add a note, issue the section in one step, and print or send the pages."
        stats={[
          {
            label: "Students",
            value: week.problem
              ? "—"
              : data
                ? students.length
                : scope
                  ? null
                  : "—",
          },
          {
            label: "Sets Done",
            value: week.problem
              ? "—"
              : data
                ? given
                  ? `${done} of ${given}`
                  : "None Set"
                : scope
                  ? null
                  : "—",
          },
          {
            label: "This Week",
            value: week.problem
              ? "—"
              : data
                ? issued
                  ? "Issued"
                  : "Not Issued"
                : scope
                  ? null
                  : "—",
          },
        ]}
      >
        <div className="space-y-3">
          <MastheadSelect
            label="Section"
            helper={
              role === "TEACHER"
                ? "One you teach or taught."
                : "Any section in your school."
            }
            value={section ? sectionKey(section) : ""}
            disabled={!list || list.length === 0}
            error={sections.error}
            onChange={(e) =>
              url.set({ section: e.target.value, week: null }, { push: true })
            }
          >
            {!list ? <option value="">Loading sections…</option> : null}
            {list && list.length === 0 ? (
              <option value="">No sections yet</option>
            ) : null}
            {(list ?? []).map((s) => (
              <option key={sectionKey(s)} value={sectionKey(s)}>
                {sectionName(s)}
                {s.canChange ? "" : " (Earlier)"}
              </option>
            ))}
          </MastheadSelect>
          <MastheadSelect
            label="Week"
            helper="Monday to Sunday."
            value={weekStart}
            disabled={weeks.length === 0}
            onChange={(e) => url.set({ week: e.target.value }, { push: true })}
          >
            {weeks.length === 0 ? (
              <option value="">Loading weeks…</option>
            ) : null}
            {weeks.map((w) => (
              <option key={w.start} value={w.start}>
                {w.label}
                {w.isCurrent ? " (This Week)" : ""}
              </option>
            ))}
          </MastheadSelect>
        </div>
      </PageHeader>

      {role === "SUPER_ADMIN" ? (
        <Card className="p-6">
          <EmptyState
            title="One School at a Time"
            description="Weekly reports belong to one school. Sign in as that school's admin or teacher to see them."
          />
        </Card>
      ) : null}
      {sections.problem ? (
        <LoadError problem={sections.problem} onRetry={sections.reload} />
      ) : null}
      {list && list.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            title="No Section Yet"
            description={
              role === "TEACHER"
                ? "Weekly reports are made for the sections you teach. Your school admin assigns them."
                : "Weekly reports are made for each section once it has students."
            }
          />
        </Card>
      ) : null}

      {section && scope ? (
        week.problem ? (
          <LoadError problem={week.problem} onRetry={week.reload} />
        ) : !data ? (
          <TableSkeleton label="Loading this week's reports" rows={5} />
        ) : (
          <div className="space-y-6">
            <Card>
              <CardBody className="space-y-4 sm:p-6">
                <div className="flex flex-wrap items-center gap-3">
                  {issued ? (
                    <Badge tone="success" dot>
                      Issued
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Not Issued</Badge>
                  )}
                  <p className="text-sm text-content">
                    {issued
                      ? `Issued on ${dayText(issued.issuedAt)}${issued.issuedBy ? ` by ${issued.issuedBy}` : ""} to ${issued.reportCount} ${
                          issued.reportCount === 1 ? "student" : "students"
                        }.`
                      : `${students.length} ${students.length === 1 ? "student" : "students"} · week of ${weekLabel}${
                          data.week.isCurrent ? " (so far)" : ""
                        }`}
                  </p>
                  <span className="ml-auto flex flex-wrap gap-2">
                    {issued ? (
                      <>
                        <PdfButton
                          action="download the weekly report"
                          path={`/weekly-reports/issues/${issued.id}/pdf`}
                          name={pdfName(
                            sectionLabel,
                            "Weekly-Reports",
                            weekStart,
                          )}
                          label="Download All Pages"
                          variant="primary"
                        />
                        {data.canChange ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            leadingIcon={
                              <Undo2 className="h-4 w-4" aria-hidden="true" />
                            }
                            onClick={() => setWithdrawing(true)}
                          >
                            Withdraw
                          </Button>
                        ) : null}
                      </>
                    ) : data.canChange ? (
                      <Button
                        size="sm"
                        variant="primary"
                        leadingIcon={
                          <Send className="h-4 w-4" aria-hidden="true" />
                        }
                        disabled={
                          students.length === 0 || tooLong || week.loading
                        }
                        onClick={() => {
                          setReasons([]);
                          setConfirming(true);
                        }}
                      >
                        Issue This Week
                      </Button>
                    ) : null}
                  </span>
                </div>
                <ReasonsBox title="That didn't go through:" reasons={reasons} />
                {!data.canChange ? (
                  <p className="text-sm text-content-muted">
                    You no longer teach this section, so you can read its
                    reports but not change or issue them.
                  </p>
                ) : null}
                {!issued && data.canChange ? (
                  <p className="text-sm text-content-muted">
                    Every child&apos;s page is drafted for you from their
                    practice. Add a note if you like, then issue the whole
                    section at once. Each child then sees their page, and you
                    can download the PDF to print or send to parents.
                  </p>
                ) : null}
                {data.week.isCurrent && !issued ? (
                  <AlertBanner
                    tone="info"
                    message="This week isn't over yet: the pages show the practice so far. You can issue now (for example on Saturday) or wait."
                  />
                ) : null}
              </CardBody>
            </Card>

            {!data.live ? (
              <Card className="p-6">
                <EmptyState
                  title="Not Issued That Week"
                  description="No reports were issued for this week while you taught the section. Only issued pages can be opened once you no longer teach it."
                />
              </Card>
            ) : null}

            {data.live ? (
              <Card>
                <CardBody className="space-y-3 sm:p-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    {editable ? (
                      <label
                        htmlFor="section-note"
                        className="text-sm font-bold text-content"
                      >
                        Note for the Whole Section
                      </label>
                    ) : (
                      <h2 className="text-sm font-bold text-content">
                        Note for the Whole Section
                      </h2>
                    )}
                    {editable ? (
                      <span
                        id="section-note-count"
                        className="text-[0.8125rem] text-content-subtle"
                      >
                        {counter(sectionDraft)}
                      </span>
                    ) : null}
                  </div>
                  {editable ? (
                    <>
                      <textarea
                        id="section-note"
                        rows={2}
                        className={NOTE_BOX}
                        value={sectionDraft}
                        aria-invalid={
                          noteProblem(sectionDraft) ? true : undefined
                        }
                        aria-describedby={cn(
                          "section-note-count section-note-hint",
                          noteProblem(sectionDraft) && "section-note-error",
                        )}
                        placeholder="For example: unit test on Friday, please help your child revise rounding."
                        onChange={(e) => {
                          setSectionDraft(e.target.value);
                          setSavedNote(false);
                        }}
                      />
                      {noteProblem(sectionDraft) ? (
                        <p
                          id="section-note-error"
                          className="text-[0.8125rem] font-semibold text-coral-700"
                        >
                          {noteProblem(sectionDraft)}
                        </p>
                      ) : null}
                      <p
                        id="section-note-hint"
                        className="text-xs text-content-subtle"
                      >
                        Printed on every child&apos;s page. A child&apos;s own
                        note, below, is printed after it.
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-content">
                      {data.sectionNote || (
                        <span className="text-content-muted">No note.</span>
                      )}
                    </p>
                  )}
                </CardBody>
              </Card>
            ) : null}

            {!data.live ? null : students.length === 0 ? (
              <Card className="p-6">
                <EmptyState
                  title="No Students"
                  description="This section has no active students, so there is nothing to issue."
                />
              </Card>
            ) : (
              <Table
                caption={`${sectionLabel}, week of ${weekLabel}`}
                minWidth="56rem"
              >
                <THead>
                  <TH>Student</TH>
                  <TH>This Week</TH>
                  <TH>Answers</TH>
                  <TH>Note for This Child</TH>
                  <TH align="right">Page</TH>
                </THead>
                <TBody>
                  {students.map((s) => {
                    const text = childDrafts[s.studentId] ?? "";
                    const problem = editable ? noteProblem(text) : null;
                    const errorId = `note-error-${s.studentId}`;
                    return (
                      <TR key={s.studentId}>
                        <TD className="whitespace-nowrap">
                          <span className="font-semibold text-content">
                            {s.studentName}
                          </span>
                          <span className="block text-content-subtle">
                            {s.studentCode}
                          </span>
                        </TD>
                        <TD>
                          <span
                            className={cn(
                              s.totals.notDone
                                ? "text-coral-700"
                                : "text-content",
                            )}
                          >
                            {totalsText(s.totals)}
                          </span>
                        </TD>
                        <TD className="text-content-muted">
                          {numbersText(s.weekNumbers)}
                        </TD>
                        <TD className="min-w-[16rem]">
                          {editable ? (
                            <>
                              <input
                                type="text"
                                aria-label={`Note for ${s.studentName}`}
                                aria-invalid={problem ? true : undefined}
                                aria-describedby={problem ? errorId : undefined}
                                className={cn(NOTE_BOX, "h-10 py-1.5")}
                                value={text}
                                placeholder="Optional"
                                onChange={(e) => {
                                  setChildDraft(s.studentId, e.target.value);
                                  setSavedNote(false);
                                }}
                              />
                              {problem ? (
                                <span
                                  id={errorId}
                                  className="mt-1 block text-xs font-semibold text-coral-700"
                                >
                                  {problem}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-content">
                              {s.note || (
                                <span className="text-content-subtle">—</span>
                              )}
                            </span>
                          )}
                        </TD>
                        <TD align="right">
                          <span className="inline-flex flex-wrap justify-end gap-2">
                            <Button
                              size="sm"
                              variant="tinted"
                              leadingIcon={
                                <Eye className="h-4 w-4" aria-hidden="true" />
                              }
                              onClick={() =>
                                setViewing({
                                  studentId: s.studentId,
                                  name: s.studentName,
                                  reportId: s.reportId,
                                })
                              }
                            >
                              {s.reportId ? "View" : "Preview"}
                            </Button>
                            {s.reportId ? (
                              <PdfButton
                                action="download the weekly report"
                                path={`/weekly-reports/reports/${s.reportId}/pdf`}
                                name={pdfName(
                                  s.studentCode,
                                  "Weekly-Report",
                                  weekStart,
                                )}
                                label="PDF"
                                variant="tinted"
                              />
                            ) : null}
                          </span>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}

            {editable ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="secondary"
                  leadingIcon={<Save className="h-4 w-4" aria-hidden="true" />}
                  disabled={!dirty || tooLong}
                  loading={saving}
                  loadingLabel="Saving"
                  onClick={() => void saveNotes()}
                >
                  Save Notes
                </Button>
                <span className="text-sm text-content-muted" role="status">
                  {dirty
                    ? "Notes not saved yet."
                    : savedNote
                      ? "Notes saved."
                      : ""}
                </span>
              </div>
            ) : null}

            {data.withdrawn.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-bold text-content">
                  Withdrawn Earlier
                </p>
                <ul className="space-y-1 text-sm text-content-muted">
                  {data.withdrawn.map((i) => (
                    <li key={i.id}>
                      Issued {dayText(i.issuedAt)}, withdrawn{" "}
                      {dayText(i.withdrawnAt)}: {i.withdrawReason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )
      ) : null}

      <Modal
        open={confirming}
        onClose={() => (issuing ? undefined : setConfirming(false))}
        title="Issue This Week's Reports?"
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              disabled={issuing}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={issuing}
              loadingLabel="Issuing"
              onClick={() => void issue()}
            >
              Issue This Week
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-content">
          <p>
            {students.length} {students.length === 1 ? "page" : "pages"} for{" "}
            {sectionLabel}, week of {weekLabel}. Each page keeps today&apos;s
            figures, and each child sees their own.
          </p>
          {dirty ? <p>Your notes are saved first.</p> : null}
          <p>
            To change a page afterwards, withdraw the week and issue it again.
          </p>
        </div>
      </Modal>

      <Modal
        open={withdrawing}
        onClose={() => (busy ? undefined : setWithdrawing(false))}
        title="Withdraw This Week's Reports?"
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setWithdrawing(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy}
              loadingLabel="Withdrawing"
              disabled={why.trim() === ""}
              onClick={() => void withdraw()}
            >
              Withdraw
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm text-content">
          <p>
            Students stop seeing these pages. They stay on record as withdrawn,
            and you can change the notes and issue the week again.
          </p>
          <TextField
            label="Reason"
            hint={`${why.length}/${MAX_NOTE}`}
            maxLength={MAX_NOTE}
            value={why}
            placeholder="For example: note for one child corrected"
            onChange={(e) => setWhy(e.target.value)}
          />
        </div>
      </Modal>

      {viewing && section ? (
        viewing.reportId ? (
          <PreviewModal
            title={viewing.name}
            path={`/weekly-reports/reports/${viewing.reportId}`}
            params={{}}
            draft={false}
            onClose={() => setViewing(null)}
          />
        ) : (
          <PreviewModal
            title={viewing.name}
            path="/weekly-reports/preview"
            params={{
              classLevelId: section.classLevelId,
              section: section.section,
              weekStart,
              studentId: viewing.studentId,
            }}
            draft
            unsaved={dirty}
            onClose={() => setViewing(null)}
          />
        )
      ) : null}
      {leave.dialog}
    </div>
  );
}
