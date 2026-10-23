"use client";

/**
 * Assessment Schemes (#165): how each subject's result is worked out for a
 * school year. A school admin keeps the school's years and schemes here;
 * a Super Admin picks a school first, and also keeps the templates
 * schools start from (drafts until Ashalatha has checked them).
 */
import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, LayoutTemplate, Plus, Sparkles } from "lucide-react";
import { api, describeApiError } from "@/lib/api";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { useUrlState } from "@/lib/hooks/useUrlState";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { AlertBanner, LoadError } from "@/components/ui/AlertBanner";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectField, TextField } from "@/components/ui/Field";
import { InlineLink } from "@/components/ui/InlineLink";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { MastheadSelect } from "@/components/ui/MastheadSelect";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { ReasonsBox, SchemeStatusBadge, refusalReasons } from "@/components/assessment/common";
import type { AcademicYear, SchemeDetail, SchemeSummary } from "@/types/assessment";
import type { SchoolOption } from "@/types/curriculum";

interface BoardCourse {
  id: string;
  displayName: string;
  classLevelDisplayName: string;
}

function formatDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function AssessmentSchemesPage() {
  const session = useProtectedPage("ADMIN");
  const { user, status } = session;
  const ready = status === "ready" && Boolean(user);
  const isPlatformAdmin = user?.role === "SUPER_ADMIN";
  const router = useRouter();
  const url = useUrlState();

  const schools = useApiQuery<{ schools: SchoolOption[] }>(
    ready && isPlatformAdmin ? "/curriculum-admin/schools" : null,
    {},
    { action: "load the list of schools" },
  );
  const schoolId = isPlatformAdmin ? url.get("school") : null;
  const scoped = ready && (!isPlatformAdmin || Boolean(schoolId));

  const years = useApiQuery<{ years: AcademicYear[] }>(
    scoped ? "/assessment/years" : null,
    { schoolId },
    { action: "load the school years" },
  );
  const yearList = years.problem ? null : (years.data?.years ?? null);
  const year =
    yearList?.find((y) => y.id === url.get("year")) ?? yearList?.find((y) => y.isCurrent) ?? yearList?.[0] ?? null;

  const schemes = useApiQuery<{ schemes: SchemeSummary[] }>(
    scoped && year ? "/assessment/schemes" : null,
    { schoolId, yearId: year?.id },
    { action: "load the schemes" },
  );
  const templates = useApiQuery<{ templates: SchemeSummary[] }>(
    ready ? "/assessment/templates" : null,
    {},
    { action: "load the templates" },
  );

  const [addingYear, setAddingYear] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status !== "ready" || !user) return <SessionGate session={session} />;

  const schemeList = schemes.problem ? null : (schemes.data?.schemes ?? null);
  const templateList = templates.problem ? null : (templates.data?.templates ?? null);
  const publishedTemplates = (templateList ?? []).filter((t) => t.status === "PUBLISHED");
  // With no school year yet there are no schemes to load: 0, not a
  // placeholder that never resolves.
  const noYear = Boolean(yearList && !year);
  const figure = (value: number | undefined, query: { problem: unknown; data: unknown }) =>
    noYear ? 0 : query.problem ? "—" : query.data ? (value ?? 0) : null;

  async function makeCurrent(target: AcademicYear) {
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`/assessment/years/${target.id}/current`);
      setNotice(`${target.label} is now the current year.`);
      years.reload();
    } catch (err) {
      setProblem(describeApiError(err, "change the current year").message);
    } finally {
      setBusy(false);
    }
  }

  async function createStandardTemplates() {
    setBusy(true);
    setProblem(null);
    try {
      const { data } = await api.post<{ created: SchemeSummary[] }>("/assessment/templates/standard");
      setNotice(
        data.created.length === 0
          ? "The standard templates already exist."
          : `Made ${data.created.length} standard ${data.created.length === 1 ? "template" : "templates"} as drafts. Publish each once Ashalatha has checked it.`,
      );
      templates.reload();
    } catch (err) {
      setProblem(describeApiError(err, "make the standard templates").message);
    } finally {
      setBusy(false);
    }
  }

  async function newTemplate() {
    setBusy(true);
    setProblem(null);
    try {
      const { data } = await api.post<SchemeDetail>("/assessment/templates", { name: "New Template" });
      router.push(`/admin/assessment/${data.id}`);
    } catch (err) {
      setProblem(refusalReasons(err, "make a template")[0]);
      setBusy(false);
    }
  }

  const schoolName = schools.data?.schools.find((s) => s.id === schoolId)?.name;

  return (
    <RoleShell role={isPlatformAdmin ? "SUPER_ADMIN" : "ADMIN"} user={user} ambience="working">
      <div className="space-y-8">
        <PageHeader
          surface="masthead"
          eyebrow={isPlatformAdmin ? "Platform" : "Content"}
          title="Assessment Schemes"
          description="How each subject's result is worked out for a school year: the tests and other work that count, their weights, the pass mark and the grades."
          stats={
            scoped
              ? [
                  { label: "School Year", value: years.problem ? "—" : yearList ? (year?.label ?? "None Yet") : null },
                  { label: "Schemes", value: figure(schemeList?.length, schemes) },
                  {
                    label: "Published",
                    value: figure(schemeList?.filter((s) => s.status === "PUBLISHED").length, schemes),
                  },
                  {
                    label: "Drafts",
                    value: figure(schemeList?.filter((s) => s.status === "DRAFT").length, schemes),
                    tone: schemeList?.some((s) => s.status === "DRAFT") ? "attention" : "default",
                  },
                ]
              : undefined
          }
          actions={
            scoped ? (
              <>
                <Button
                  variant="accent"
                  leadingIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                  disabled={!year}
                  onClick={() => setCreating(true)}
                >
                  New Scheme
                </Button>
                <Button
                  variant="secondary"
                  leadingIcon={<CalendarPlus className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => setAddingYear(true)}
                >
                  Add Year
                </Button>
              </>
            ) : undefined
          }
        >
          {isPlatformAdmin ? (
            <MastheadSelect
              label="School"
              helper="The school whose years and schemes to show."
              value={schoolId ?? ""}
              disabled={!schools.data}
              error={schools.error}
              onChange={(e) => url.set({ school: e.target.value, year: null }, { push: true })}
            >
              <option value="">{schools.data ? "Choose a school" : "Loading schools…"}</option>
              {(schools.data?.schools ?? []).map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                  {school.city ? `, ${school.city}` : ""}
                </option>
              ))}
            </MastheadSelect>
          ) : null}
        </PageHeader>

        {notice ? <AlertBanner tone="success" message={notice} /> : null}
        {problem ? <AlertBanner tone="error" message={problem} /> : null}

        {scoped ? (
          <Card className="space-y-5 p-6">
            {years.problem ? <LoadError problem={years.problem} onRetry={years.reload} /> : null}
            {yearList && yearList.length === 0 ? (
              <EmptyState
                title="Add the School Year First"
                description={`Schemes belong to a school year. Add ${schoolName ? `${schoolName}'s` : "the"} current year, with its first and last day.`}
                actions={
                  <Button
                    variant="primary"
                    leadingIcon={<CalendarPlus className="h-4 w-4" aria-hidden="true" />}
                    onClick={() => setAddingYear(true)}
                  >
                    Add Year
                  </Button>
                }
              />
            ) : yearList && year ? (
              <>
                <div className="flex flex-wrap items-end gap-4">
                  <SelectField
                    label="School Year"
                    containerClassName="w-60"
                    value={year.id}
                    onChange={(e) => url.set({ year: e.target.value }, { push: true })}
                  >
                    {yearList.map((y) => (
                      <option key={y.id} value={y.id}>
                        {y.label}
                        {y.isCurrent ? " (Current)" : ""}
                      </option>
                    ))}
                  </SelectField>
                  <p className="pb-3 text-sm text-content-muted">
                    {formatDay(year.startDate)} to {formatDay(year.endDate)}
                  </p>
                  {!year.isCurrent ? (
                    <Button variant="secondary" className="mb-0.5" disabled={busy} onClick={() => void makeCurrent(year)}>
                      Make Current Year
                    </Button>
                  ) : null}
                </div>

                {schemes.problem ? <LoadError problem={schemes.problem} onRetry={schemes.reload} /> : null}
                {!schemeList && !schemes.problem ? (
                  <TableSkeleton label="Loading schemes" />
                ) : schemeList && schemeList.length === 0 ? (
                  <EmptyState
                    title="No Schemes for This Year Yet"
                    description="Start one for each class and subject, from a template or from scratch. Teachers enter marks once it is published."
                    actions={
                      <Button
                        variant="primary"
                        leadingIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                        onClick={() => setCreating(true)}
                      >
                        New Scheme
                      </Button>
                    }
                  />
                ) : schemeList ? (
                  <Table caption={`Schemes for ${year.label}`} minWidth="44rem" busy={schemes.loading}>
                    <THead>
                      <TH>Scheme</TH>
                      <TH>Class</TH>
                      <TH>Subject</TH>
                      <TH>Version</TH>
                      <TH>Status</TH>
                    </THead>
                    <TBody>
                      {schemeList.map((s) => (
                        <TR key={s.id}>
                          <TD>
                            <InlineLink href={`/admin/assessment/${s.id}`}>{s.name}</InlineLink>
                          </TD>
                          <TD>{s.classLevel?.displayName ?? "—"}</TD>
                          <TD>{s.boardCourse?.displayName ?? "—"}</TD>
                          <TD>{s.version}</TD>
                          <TD>
                            <SchemeStatusBadge status={s.status} />
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                ) : null}
              </>
            ) : !years.problem ? (
              <TableSkeleton label="Loading school years" />
            ) : null}
          </Card>
        ) : isPlatformAdmin ? (
          <p className="text-sm text-content-muted">Choose a school to see its years and schemes.</p>
        ) : null}

        <Card className="space-y-5 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Templates</CardTitle>
              <CardDescription>
                {isPlatformAdmin
                  ? "Starting points every school can copy. A template stays a draft until Ashalatha has checked it."
                  : "Starting points for a new scheme. You can change everything after copying one."}
              </CardDescription>
            </div>
            {isPlatformAdmin ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
                  disabled={busy}
                  onClick={() => void createStandardTemplates()}
                >
                  Create Standard Templates
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={<LayoutTemplate className="h-4 w-4" aria-hidden="true" />}
                  disabled={busy}
                  onClick={() => void newTemplate()}
                >
                  New Template
                </Button>
              </div>
            ) : null}
          </div>
          {templates.problem ? <LoadError problem={templates.problem} onRetry={templates.reload} /> : null}
          {!templateList && !templates.problem ? (
            <TableSkeleton rows={3} label="Loading templates" />
          ) : templateList && templateList.length === 0 ? (
            <p className="text-sm text-content-muted">
              {isPlatformAdmin
                ? "No templates yet. Create the standard CBSE-style and ICSE-style ones to start."
                : "No templates are available yet. You can still start a scheme from scratch."}
            </p>
          ) : templateList ? (
            <ul className="divide-y divide-line">
              {templateList.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
                  <InlineLink href={`/admin/assessment/${t.id}`}>{t.name}</InlineLink>
                  {t.description ? <span className="text-sm text-content-muted">{t.description}</span> : null}
                  <span className="ml-auto">
                    <SchemeStatusBadge status={t.status} />
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </div>

      {addingYear ? (
        <AddYearModal
          schoolId={schoolId}
          onClose={() => setAddingYear(false)}
          onAdded={(added) => {
            setAddingYear(false);
            setNotice(`Added ${added.label}.`);
            years.reload();
            url.set({ year: added.id }, { push: true });
          }}
        />
      ) : null}
      {creating && year ? (
        <NewSchemeModal
          schoolId={schoolId}
          year={year}
          templates={publishedTemplates}
          onClose={() => setCreating(false)}
          onCreated={(scheme) => router.push(`/admin/assessment/${scheme.id}`)}
        />
      ) : null}
    </RoleShell>
  );
}

function suggestedYear(): { label: string; start: string; end: string } {
  const now = new Date();
  // An Indian school year starts in April.
  const first = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    label: `${first}-${String((first + 1) % 100).padStart(2, "0")}`,
    start: `${first}-04-01`,
    end: `${first + 1}-03-31`,
  };
}

function AddYearModal({
  schoolId,
  onClose,
  onAdded,
}: {
  schoolId: string | null;
  onClose: () => void;
  onAdded: (year: AcademicYear) => void;
}) {
  const [suggestion] = useState(suggestedYear);
  const [label, setLabel] = useState(suggestion.label);
  const [start, setStart] = useState(suggestion.start);
  const [end, setEnd] = useState(suggestion.end);
  const [saving, setSaving] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);

  async function add() {
    setSaving(true);
    setReasons([]);
    try {
      const { data } = await api.post<AcademicYear>("/assessment/years", {
        schoolId,
        label: label.trim(),
        startDate: start,
        endDate: end,
      });
      onAdded(data);
    } catch (err) {
      setReasons(refusalReasons(err, "add this year"));
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => (saving ? undefined : onClose())}
      title="Add a School Year"
      size="sm"
      footer={
        <>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} loadingLabel="Adding" disabled={!start || !end} onClick={() => void add()}>
            Add Year
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ReasonsBox title="The year wasn't added:" reasons={reasons} />
        <TextField label="Year" hint="As 2026-27" maxLength={7} value={label} onChange={(e) => setLabel(e.target.value)} />
        <TextField label="First Day" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        <TextField label="Last Day" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        <p className="text-sm text-content-muted">
          Practice done between these days counts towards the year&apos;s results. The first year you add becomes the
          current one.
        </p>
      </div>
    </Modal>
  );
}

function NewSchemeModal({
  schoolId,
  year,
  templates,
  onClose,
  onCreated,
}: {
  schoolId: string | null;
  year: AcademicYear;
  templates: SchemeSummary[];
  onClose: () => void;
  onCreated: (scheme: SchemeDetail) => void;
}) {
  const [courses, setCourses] = useState<BoardCourse[] | null>(null);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [courseId, setCourseId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [saving, setSaving] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ boardCourses: BoardCourse[] }>("/curriculum-admin/board-courses")
      .then(({ data }) => !cancelled && setCourses(data.boardCourses))
      .catch((err) => !cancelled && setLoadProblem(describeApiError(err, "load the subjects").message));
    return () => {
      cancelled = true;
    };
  }, []);

  async function create() {
    setSaving(true);
    setReasons([]);
    try {
      const { data } = await api.post<SchemeDetail>("/assessment/schemes", {
        schoolId,
        academicYearId: year.id,
        boardCourseId: courseId,
        templateId: templateId || null,
      });
      onCreated(data);
    } catch (err) {
      setReasons(refusalReasons(err, "start this scheme"));
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => (saving ? undefined : onClose())}
      title="New Scheme"
      eyebrow={year.label}
      size="sm"
      footer={
        <>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} loadingLabel="Starting" disabled={!courseId} onClick={() => void create()}>
            Start Draft
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ReasonsBox title="The scheme wasn't started:" reasons={reasons} />
        {loadProblem ? (
          <p role="alert" className="text-sm text-coral-700">
            {loadProblem}
          </p>
        ) : null}
        <SelectField
          label="Class and Subject"
          value={courseId}
          disabled={!courses}
          onChange={(e) => setCourseId(e.target.value)}
        >
          <option value="">{courses ? "Choose a subject" : "Loading subjects…"}</option>
          {(courses ?? []).map((course) => (
            <option key={course.id} value={course.id}>
              {course.displayName}
            </option>
          ))}
        </SelectField>
        <SelectField label="Start From" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">A Blank Scheme</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectField>
        <p className="text-sm text-content-muted">
          It starts as a draft. Teachers see it once you publish it.
        </p>
      </div>
    </Modal>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <AssessmentSchemesPage />
    </Suspense>
  );
}
