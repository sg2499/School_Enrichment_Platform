"use client";

/**
 * Report Cards (#188), the list: for one school year, every section (a
 * teacher's own sections) with where its Term 1 and Year-End cards stand.
 * The school Admin also sets the co-scholastic areas and grade scale here;
 * a Super Admin picks the school first.
 */
import { useEffect, useState } from "react";
import { Plus, Save, Trash } from "lucide-react";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { useUrlState } from "@/lib/hooks/useUrlState";
import { CARD_TERMS, CARD_TERM_LABEL } from "@/lib/reportCards";
import { RoleShell } from "@/components/RoleShell";
import { AlertBanner, LoadError } from "@/components/ui/AlertBanner";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectField, TextField } from "@/components/ui/Field";
import { InlineLink } from "@/components/ui/InlineLink";
import { MastheadSelect } from "@/components/ui/MastheadSelect";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { ReasonsBox, refusalReasons, useLeaveGuard } from "@/components/assessment/common";
import { IssueBadge, dayText } from "@/components/reportCards/common";
import type { AcademicYear } from "@/types/assessment";
import type { CurrentUser, UserRole } from "@/types/auth";
import type { SchoolOption } from "@/types/curriculum";
import type { ReportOverview, ReportSettings, ScaleGrade } from "@/types/reportCards";

export function ReportCardsHome({
  role,
  user,
  sectionHref,
}: {
  role: UserRole;
  user: CurrentUser | null;
  /** The section page ("/admin/report-cards/section"). */
  sectionHref: string;
}) {
  const url = useUrlState();
  const isPlatformAdmin = role === "SUPER_ADMIN";
  const isTeacher = role === "TEACHER";
  const schools = useApiQuery<{ schools: SchoolOption[] }>(
    isPlatformAdmin ? "/curriculum-admin/schools" : null,
    {},
    { action: "load the list of schools" },
  );
  const schoolId = isPlatformAdmin ? url.get("school") : null;
  const scoped = !isPlatformAdmin || Boolean(schoolId);
  const years = useApiQuery<{ years: AcademicYear[] }>(scoped ? "/assessment/years" : null, { schoolId }, {
    action: "load the school years",
  });
  const yearList = years.problem ? null : (years.data?.years ?? null);
  const year =
    yearList?.find((y) => y.id === url.get("year")) ?? yearList?.find((y) => y.isCurrent) ?? yearList?.[0] ?? null;
  const overview = useApiQuery<ReportOverview>(
    scoped && year ? "/report-cards/overview" : null,
    { yearId: year?.id, schoolId },
    { action: "load the sections" },
  );
  // Only an answer for the school and year now chosen: useApiQuery keeps
  // the last one while the next loads, and a settings form built from
  // another year's could save into this one (review).
  const answer = overview.problem ? null : overview.data;
  const data =
    answer && scoped && year && answer.year.id === year.id && (!isPlatformAdmin || answer.school.id === schoolId)
      ? answer
      : null;
  const [settingsDirty, setSettingsDirty] = useState(false);
  const leave = useLeaveGuard(settingsDirty);
  const noYear = Boolean(yearList && !year);
  const sections = data?.sections ?? null;
  const issuedCount = (term: "TERM_1" | "YEAR_END") => sections?.filter((s) => s.issues[term]).length;

  const sectionLink = (classLevelId: string, section: string) => {
    const params = new URLSearchParams();
    if (schoolId) params.set("school", schoolId);
    if (year) params.set("year", year.id);
    params.set("class", classLevelId);
    params.set("section", section);
    return `${sectionHref}?${params.toString()}`;
  };

  return (
    <RoleShell role={role} user={user} ambience="working">
      <div className="space-y-8">
        <PageHeader
          surface="masthead"
          eyebrow={isTeacher ? "Teaching Workspace" : "Operations"}
          title="Report Cards"
          description={
            isTeacher
              ? "Attendance, co-scholastic grades and remarks for your sections, and their report cards once the school issues them."
              : "Each section's Term 1 and Year-End cards: attendance, grades and remarks from teachers, results from the Assessment Schemes, issued by you."
          }
          stats={
            scoped
              ? [
                  { label: "School Year", value: years.problem ? "—" : yearList ? (year?.label ?? "None Yet") : null },
                  { label: "Sections", value: noYear ? 0 : overview.problem ? "—" : sections ? sections.length : null },
                  { label: "Term 1 Issued", value: noYear ? 0 : overview.problem ? "—" : sections ? (issuedCount("TERM_1") ?? 0) : null },
                  { label: "Year-End Issued", value: noYear ? 0 : overview.problem ? "—" : sections ? (issuedCount("YEAR_END") ?? 0) : null },
                ]
              : undefined
          }
        >
          {isPlatformAdmin ? (
            <MastheadSelect
              label="School"
              helper="The school whose report cards to show."
              value={schoolId ?? ""}
              disabled={!schools.data}
              error={schools.error}
              onChange={(e) => {
                const next = e.target.value;
                leave.confirm(() => url.set({ school: next, year: null }, { push: true }));
              }}
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

        {!scoped ? (
          <p className="text-sm text-content-muted">Choose a school to see its report cards.</p>
        ) : years.problem ? (
          <LoadError problem={years.problem} onRetry={years.reload} />
        ) : noYear ? (
          <Card className="p-6">
            <EmptyState
              title="No School Year Yet"
              description={
                isTeacher
                  ? "Your school admin adds the school year under Assessment Schemes."
                  : "Add the school year under Assessment Schemes first; report cards belong to a year."
              }
              actions={isTeacher ? undefined : <InlineLink href="/admin/assessment">Assessment Schemes</InlineLink>}
            />
          </Card>
        ) : (
          <Card className="space-y-5 p-6">
            {yearList && year && yearList.length > 1 ? (
              <SelectField
                label="School Year"
                containerClassName="w-60"
                value={year.id}
                onChange={(e) => {
                  const next = e.target.value;
                  leave.confirm(() => url.set({ year: next }, { push: true }));
                }}
              >
                {yearList.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.label}
                    {y.isCurrent ? " (Current)" : ""}
                  </option>
                ))}
              </SelectField>
            ) : null}
            {overview.problem ? <LoadError problem={overview.problem} onRetry={overview.reload} /> : null}
            {!sections && !overview.problem ? (
              <TableSkeleton label="Loading sections" />
            ) : sections && sections.length === 0 ? (
              <EmptyState
                title={isTeacher ? "No Sections Yet" : "No Students Yet"}
                description={
                  isTeacher
                    ? "Sections appear here once your school admin assigns you to teach them."
                    : "Sections appear here once students are on the roster with a class and section."
                }
              />
            ) : sections ? (
              <Table caption={`Sections for ${year?.label}`} minWidth="40rem" busy={overview.loading}>
                <THead>
                  <TH>Section</TH>
                  {CARD_TERMS.map((t) => (
                    <TH key={t}>{CARD_TERM_LABEL[t]}</TH>
                  ))}
                </THead>
                <TBody>
                  {sections.map((s) => (
                    <TR key={`${s.classLevel.id}-${s.section}`}>
                      <TD className="whitespace-nowrap">
                        <InlineLink href={sectionLink(s.classLevel.id, s.section)}>
                          {s.classLevel.displayName} {s.section}
                        </InlineLink>
                        {isTeacher && !s.canRecord ? <span className="block text-content-subtle">Read only</span> : null}
                      </TD>
                      {CARD_TERMS.map((t) => (
                        <TD key={t}>
                          <IssueBadge status={s.issues[t]?.status ?? null} />
                          {s.issues[t] ? (
                            <span className="ml-2 text-content-subtle">{dayText(s.issues[t]?.issuedAt)}</span>
                          ) : null}
                        </TD>
                      ))}
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : null}
          </Card>
        )}

        {data && !isTeacher ? (
          <SettingsCard
            key={`${data.school.id}-${data.year.id}`}
            schoolId={isPlatformAdmin ? data.school.id : null}
            yearId={data.year.id}
            settings={data.settings}
            onSaved={overview.reload}
            onDirtyChange={setSettingsDirty}
          />
        ) : null}
      </div>
      {leave.dialog}
    </RoleShell>
  );
}

function SettingsCard({
  schoolId,
  yearId,
  settings,
  onSaved,
  onDirtyChange,
}: {
  schoolId: string | null;
  yearId: string;
  settings: ReportSettings;
  onSaved: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [areas, setAreas] = useState<string[]>(settings.areas);
  const [scale, setScale] = useState<ScaleGrade[]>(settings.scale);
  const [saving, setSaving] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = JSON.stringify(areas) !== JSON.stringify(settings.areas) || JSON.stringify(scale) !== JSON.stringify(settings.scale);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  async function save() {
    setSaving(true);
    setReasons([]);
    setNotice(null);
    try {
      await api.put("/report-cards/settings", { schoolId, yearId, areas: areas.map((a) => a.trim()), scale });
      setNotice("Saved. Teachers now record grades for these areas.");
      onSaved();
    } catch (err) {
      setReasons(refusalReasons(err, "save the co-scholastic areas"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-5 p-6">
      <div>
        <CardTitle>Co-Scholastic Areas</CardTitle>
        <CardDescription>
          The areas teachers grade on every card, and the scale they use.
          {settings.saved ? "" : " These are CBSE's usual ones until you save your own."} Changing them later leaves
          cards already issued as they were.
        </CardDescription>
      </div>
      <ReasonsBox title="Not saved:" reasons={reasons} />
      {notice ? <AlertBanner tone="success" message={notice} /> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <fieldset disabled={saving} className="min-w-0 space-y-3">
          <legend className="text-sm font-bold text-content">Areas</legend>
          {areas.map((area, index) => (
            <div key={index} className="flex items-end gap-2">
              <TextField
                label={`Area ${index + 1}`}
                containerClassName="flex-1"
                maxLength={60}
                value={area}
                onChange={(e) => setAreas((a) => a.map((x, i) => (i === index ? e.target.value : x)))}
              />
              <Button variant="tinted" aria-label={`Remove area ${index + 1}`} onClick={() => setAreas((a) => a.filter((_, i) => i !== index))}>
                <Trash className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
            disabled={areas.length >= 10}
            onClick={() => setAreas((a) => [...a, ""])}
          >
            Add Area
          </Button>
        </fieldset>
        <fieldset disabled={saving} className="min-w-0 space-y-3">
          <legend className="text-sm font-bold text-content">Grade Scale (Best First)</legend>
          {scale.map((grade, index) => (
            <div key={index} className="flex items-end gap-2">
              <TextField
                label={`Grade ${index + 1}`}
                containerClassName="w-28"
                maxLength={5}
                value={grade.label}
                onChange={(e) => setScale((s) => s.map((x, i) => (i === index ? { ...x, label: e.target.value } : x)))}
              />
              <TextField
                label="Meaning"
                containerClassName="flex-1"
                maxLength={40}
                aria-label={`Meaning of grade ${index + 1}`}
                value={grade.meaning}
                onChange={(e) => setScale((s) => s.map((x, i) => (i === index ? { ...x, meaning: e.target.value } : x)))}
              />
              <Button variant="tinted" aria-label={`Remove grade ${index + 1}`} onClick={() => setScale((s) => s.filter((_, i) => i !== index))}>
                <Trash className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
            disabled={scale.length >= 6}
            onClick={() => setScale((s) => [...s, { label: "", meaning: "" }])}
          >
            Add Grade
          </Button>
        </fieldset>
      </div>
      <div className="flex justify-end">
        <Button
          variant="primary"
          leadingIcon={<Save className="h-4 w-4" aria-hidden="true" />}
          loading={saving}
          loadingLabel="Saving"
          disabled={!dirty && settings.saved}
          onClick={() => void save()}
        >
          Save Areas and Scale
        </Button>
      </div>
    </Card>
  );
}
