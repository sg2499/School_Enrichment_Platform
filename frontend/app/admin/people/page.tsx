"use client";

/** Account creation and roster management -- the "People" nav item that was
 * a soon:true stub until 19 Aug 2026 (Shailesh: "the super admin would need
 * to create the admin accounts and then the admin would have to create the
 * teacher and student accounts respectively ... that is an integral part of
 * the platform from where the super admin, admin and teacher can keep track
 * of the respective data under them"). Backend: routes_roster.py.
 *
 * Shared between ADMIN and SUPER_ADMIN, same pattern as /admin/curriculum:
 * a school's own ADMIN acts on their school implicitly; SUPER_ADMIN picks
 * a school first (reusing the same /curriculum-admin/schools lookup
 * Curriculum Studio already uses for this).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Copy, Download, Search, Upload, UserPlus, Users, UserX } from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardIcon, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { SelectField, TextField } from "@/components/ui/Field";
import { api, apiErrorMessage } from "@/lib/api";
import type { SchoolOption } from "@/types/curriculum";

type PersonRole = "ADMIN" | "TEACHER" | "STUDENT";

interface Person {
  id: string;
  role: PersonRole;
  fullName: string;
  email: string | null;
  code: string | null;
  schoolId: string;
  schoolName: string | null;
  className?: string | null;
  section?: string | null;
  designation?: string | null;
  isActive: boolean;
}

interface CreatedPerson extends Person {
  initialPassword: string;
}

const ROLE_TONE: Record<PersonRole, BadgeTone> = { ADMIN: "brand", TEACHER: "accent", STUDENT: "success" };
const ROLE_LABEL: Record<PersonRole, string> = { ADMIN: "Admin", TEACHER: "Teacher", STUDENT: "Student" };

const BULK_TEMPLATE_HEADER = "fullName,email,className,section,designation,subjectSpecialization,qualification";

export default function PeoplePage() {
  const { user, status } = useProtectedPage("ADMIN");

  if (status !== "ready" || !user) {
    return <LoadingScreen />;
  }

  const isPlatformAdmin = user.role === "SUPER_ADMIN";
  const roleForShell = isPlatformAdmin ? "SUPER_ADMIN" : "ADMIN";

  return (
    <RoleShell role={roleForShell} user={user}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="School"
          title="People"
          description="Create Admin, Teacher, and Student accounts, and keep track of who's active across the school."
        />
        <PeoplePanel isPlatformAdmin={isPlatformAdmin} />
      </div>
    </RoleShell>
  );
}

function PeoplePanel({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [loadingSchools, setLoadingSchools] = useState(isPlatformAdmin);
  const [selectedSchoolId, setSelectedSchoolId] = useState("");

  useEffect(() => {
    if (!isPlatformAdmin) return;
    setLoadingSchools(true);
    api
      .get<{ schools: SchoolOption[] }>("/curriculum-admin/schools")
      .then(({ data }) => setSchools(data.schools))
      .catch(() => undefined)
      .finally(() => setLoadingSchools(false));
  }, [isPlatformAdmin]);

  const schoolContextReady = !isPlatformAdmin || Boolean(selectedSchoolId);

  return (
    <div className="space-y-6">
      {isPlatformAdmin ? (
        <Card className="animate-fade-up">
          <CardBody className="space-y-4">
            <div className="flex items-center gap-3">
              <CardIcon tone="brand">
                <Users className="h-5 w-5" aria-hidden />
              </CardIcon>
              <div>
                <CardTitle>Choose a School</CardTitle>
                <CardDescription className="mt-0.5">Manage that school&rsquo;s roster below.</CardDescription>
              </div>
            </div>
            <SelectField
              label="School"
              value={selectedSchoolId}
              onChange={(e) => setSelectedSchoolId(e.target.value)}
              disabled={loadingSchools}
              containerClassName="max-w-md"
            >
              <option value="" disabled>
                {loadingSchools ? "Loading schools…" : "Choose a school"}
              </option>
              {schools.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                  {school.board ? ` · ${school.board}` : ""}
                  {school.city ? ` · ${school.city}` : ""}
                </option>
              ))}
            </SelectField>
          </CardBody>
        </Card>
      ) : null}

      {!schoolContextReady ? (
        <Card>
          <CardBody>
            <EmptyState
              status={{ label: "No School Selected", tone: "neutral" }}
              title="Pick a school above"
              description="Choose which school's roster you want to build out -- create its Admin accounts, and see its Teachers and Students."
            />
          </CardBody>
        </Card>
      ) : (
        <RosterWorkspace isPlatformAdmin={isPlatformAdmin} schoolId={selectedSchoolId} />
      )}
    </div>
  );
}

function RosterWorkspace({ isPlatformAdmin, schoolId }: { isPlatformAdmin: boolean; schoolId: string }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<PersonRole | "ALL">("ALL");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [lastCreated, setLastCreated] = useState<CreatedPerson | null>(null);

  const loadPeople = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await api.get<{ people: Person[] }>("/roster/people", {
        params: {
          schoolId: isPlatformAdmin ? schoolId : undefined,
          role: roleFilter === "ALL" ? undefined : roleFilter,
          search: search.trim() || undefined,
          includeInactive,
        },
      });
      setPeople(data.people);
    } catch (err) {
      setLoadError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [isPlatformAdmin, schoolId, roleFilter, search, includeInactive]);

  useEffect(() => {
    loadPeople();
  }, [loadPeople]);

  async function handleStatusToggle(person: Person) {
    try {
      await api.patch(`/roster/people/${person.id}/status`, { isActive: !person.isActive });
      await loadPeople();
    } catch (err) {
      setLoadError(apiErrorMessage(err));
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.15fr]">
      <CreatePersonCard
        isPlatformAdmin={isPlatformAdmin}
        schoolId={schoolId}
        onCreated={(person) => {
          setLastCreated(person);
          loadPeople();
        }}
      />

      <Card className="animate-fade-up delay-70">
        <CardBody className="space-y-5">
          <div className="flex items-center gap-3">
            <CardIcon tone="jade">
              <Users className="h-5 w-5" aria-hidden />
            </CardIcon>
            <div>
              <CardTitle>Roster</CardTitle>
              <CardDescription className="mt-0.5">Everyone with an account at this school.</CardDescription>
            </div>
          </div>

          {lastCreated ? <NewAccountCallout person={lastCreated} onDismiss={() => setLastCreated(null)} /> : null}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email, or code"
                className="h-10 w-full rounded-xl border border-line-strong bg-surface pl-10 pr-3 text-[0.8125rem] text-content shadow-xs outline-none transition focus:border-brand-400"
              />
            </div>
            {(["ALL", "ADMIN", "TEACHER", "STUDENT"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRoleFilter(r)}
                className={`h-9 shrink-0 rounded-full px-3.5 text-[0.75rem] font-semibold transition ${
                  roleFilter === r
                    ? "bg-brand-gradient text-content-inverse shadow-brand"
                    : "border border-line-strong bg-surface text-content-muted hover:border-brand-300"
                }`}
              >
                {r === "ALL" ? "All" : ROLE_LABEL[r]}
              </button>
            ))}
            <label className="flex shrink-0 items-center gap-2 text-[0.75rem] font-medium text-content-muted">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
                className="h-4 w-4 rounded border-line-strong"
              />
              Show inactive
            </label>
          </div>

          {loadError ? (
            <p className="flex items-start gap-2 text-[0.8125rem] font-medium text-coral-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {loadError}
            </p>
          ) : null}

          {loading ? (
            <p className="text-[0.8125rem] text-content-subtle">Loading roster&hellip;</p>
          ) : people.length === 0 ? (
            <EmptyState
              status={{ label: "Empty", tone: "neutral" }}
              title="No one here yet"
              description="Accounts created for this school will show up here."
            />
          ) : (
            <ul className="space-y-2">
              {people.map((person) => (
                <li
                  key={person.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface-muted p-3.5"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[0.875rem] font-semibold text-content">{person.fullName}</p>
                      <Badge tone={ROLE_TONE[person.role]} size="sm">
                        {ROLE_LABEL[person.role]}
                      </Badge>
                      {!person.isActive ? (
                        <Badge tone="danger" size="sm">
                          Inactive
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-[0.75rem] text-content-subtle">
                      {person.email || person.code || "—"}
                      {person.className ? ` · Class ${person.className}${person.section ? ` ${person.section}` : ""}` : ""}
                      {person.designation ? ` · ${person.designation}` : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={person.isActive ? "ghost" : "secondary"}
                    size="sm"
                    leadingIcon={person.isActive ? <UserX className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                    onClick={() => handleStatusToggle(person)}
                  >
                    {person.isActive ? "Deactivate" : "Reactivate"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function NewAccountCallout({ person, onDismiss }: { person: CreatedPerson; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const loginId = person.email || person.code || "";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(`Login: ${loginId}\nPassword: ${person.initialPassword}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked -- the credentials are already visible on screen.
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-jade-200 bg-jade-50 p-4 animate-scale-in">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.8125rem] font-bold text-jade-900">
          {ROLE_LABEL[person.role]} account created for {person.fullName}
        </p>
        <button type="button" onClick={onDismiss} className="text-[0.75rem] font-semibold text-jade-700 hover:text-jade-900">
          Dismiss
        </button>
      </div>
      <p className="text-[0.75rem] leading-relaxed text-jade-800">
        Share these sign-in details securely. They can change the password anytime from their profile menu once
        signed in.
      </p>
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white/70 p-3 font-mono text-[0.8125rem] text-jade-950">
        <span>
          Login: <strong>{loginId}</strong>
        </span>
        <span>
          Password: <strong>{person.initialPassword}</strong>
        </span>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        leadingIcon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        onClick={handleCopy}
      >
        {copied ? "Copied" : "Copy Credentials"}
      </Button>
    </div>
  );
}

function CreatePersonCard({
  isPlatformAdmin,
  schoolId,
  onCreated,
}: {
  isPlatformAdmin: boolean;
  schoolId: string;
  onCreated: (person: CreatedPerson) => void;
}) {
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const availableRoles = useMemo<PersonRole[]>(
    () => (isPlatformAdmin ? ["ADMIN", "TEACHER", "STUDENT"] : ["TEACHER", "STUDENT"]),
    [isPlatformAdmin],
  );
  const [role, setRole] = useState<PersonRole>(availableRoles[0]);

  useEffect(() => {
    if (!availableRoles.includes(role)) setRole(availableRoles[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableRoles]);

  return (
    <Card className="animate-fade-up">
      <CardBody className="space-y-5">
        <div className="flex items-center gap-3">
          <CardIcon tone="accent">
            <UserPlus className="h-5 w-5" aria-hidden />
          </CardIcon>
          <div>
            <CardTitle>Add People</CardTitle>
            <CardDescription className="mt-0.5">One at a time, or many at once.</CardDescription>
          </div>
        </div>

        <div className="flex gap-2">
          <Button type="button" variant={mode === "single" ? "primary" : "secondary"} size="sm" onClick={() => setMode("single")}>
            Single Entry
          </Button>
          <Button
            type="button"
            variant={mode === "bulk" ? "primary" : "secondary"}
            size="sm"
            leadingIcon={<Upload className="h-3.5 w-3.5" />}
            onClick={() => setMode("bulk")}
          >
            Bulk Import
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {availableRoles.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={`h-9 rounded-full px-4 text-[0.8125rem] font-semibold transition ${
                role === r
                  ? "bg-brand-gradient text-content-inverse shadow-brand"
                  : "border border-line-strong bg-surface text-content-muted hover:border-brand-300"
              }`}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>

        {mode === "single" ? (
          <SinglePersonForm role={role} isPlatformAdmin={isPlatformAdmin} schoolId={schoolId} onCreated={onCreated} />
        ) : (
          <BulkImportForm role={role === "ADMIN" ? "TEACHER" : role} isPlatformAdmin={isPlatformAdmin} schoolId={schoolId} />
        )}
      </CardBody>
    </Card>
  );
}

function SinglePersonForm({
  role,
  isPlatformAdmin,
  schoolId,
  onCreated,
}: {
  role: PersonRole;
  isPlatformAdmin: boolean;
  schoolId: string;
  onCreated: (person: CreatedPerson) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [className, setClassName] = useState("");
  const [section, setSection] = useState("");
  const [designation, setDesignation] = useState("");
  const [subjectSpecialization, setSubjectSpecialization] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { data } = await api.post<CreatedPerson>("/roster/people", {
        role,
        fullName,
        email: email || undefined,
        schoolId: isPlatformAdmin ? schoolId : undefined,
        className: role === "STUDENT" ? className || undefined : undefined,
        section: role === "STUDENT" ? section || undefined : undefined,
        designation: role === "TEACHER" ? designation || undefined : undefined,
        subjectSpecialization: role === "TEACHER" ? subjectSpecialization || undefined : undefined,
      });
      onCreated(data);
      setFullName("");
      setEmail("");
      setClassName("");
      setSection("");
      setDesignation("");
      setSubjectSpecialization("");
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <TextField
        label="Full Name"
        required
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        placeholder="e.g. Ananya Rao"
      />
      <TextField
        label={role === "ADMIN" ? "Email" : "Email (optional)"}
        type="email"
        required={role === "ADMIN"}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        hint={role !== "ADMIN" ? "Sign in with the code instead if left blank" : undefined}
        placeholder="name@school.example.com"
      />
      {role === "STUDENT" ? (
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Class" value={className} onChange={(e) => setClassName(e.target.value)} placeholder="5" />
          <TextField label="Section" value={section} onChange={(e) => setSection(e.target.value)} placeholder="A" />
        </div>
      ) : null}
      {role === "TEACHER" ? (
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Designation" value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="TGT" />
          <TextField
            label="Subject"
            value={subjectSpecialization}
            onChange={(e) => setSubjectSpecialization(e.target.value)}
            placeholder="Mathematics"
          />
        </div>
      ) : null}

      {error ? (
        <p className="flex items-start gap-2 text-[0.8125rem] font-medium text-coral-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <Button type="submit" fullWidth loading={saving} loadingLabel="Creating" leadingIcon={<UserPlus className="h-4 w-4" />}>
        Create {ROLE_LABEL[role]} Account
      </Button>
    </form>
  );
}

interface BulkRowResult {
  row: number;
  fullName: string;
  status: "created" | "skipped";
  code?: string;
  error?: string;
}

function BulkImportForm({
  role,
  isPlatformAdmin,
  schoolId,
}: {
  role: "TEACHER" | "STUDENT";
  isPlatformAdmin: boolean;
  schoolId: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; attempted: number; results: BulkRowResult[] } | null>(null);

  function handleDownloadTemplate() {
    const exampleRow =
      role === "STUDENT" ? "Ananya Rao,,5,A,,," : "Ravi Kumar,ravi.kumar@example.com,,,TGT,Mathematics,B.Ed";
    const csv = `${BULK_TEMPLATE_HEADER}\n${exampleRow}\n`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${role.toLowerCase()}-roster-template.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function handleUpload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Choose a .csv or .xlsx file first.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("role", role);
      if (isPlatformAdmin) formData.append("schoolId", schoolId);
      const { data } = await api.post<{ created: number; attempted: number; results: BulkRowResult[] }>(
        "/roster/people/bulk",
        formData,
      );
      setResult(data);
      setFile(null);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-[0.8125rem] leading-relaxed text-content-muted">
        Upload a .csv or .xlsx file with a header row: <code className="text-[0.75rem]">{BULK_TEMPLATE_HEADER}</code>.
        Only <strong>fullName</strong> is required.
      </p>
      <Button type="button" variant="ghost" size="sm" leadingIcon={<Download className="h-3.5 w-3.5" />} onClick={handleDownloadTemplate}>
        Download Template
      </Button>

      <form onSubmit={handleUpload} className="space-y-4">
        <input
          type="file"
          accept=".csv,.xlsx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-[0.8125rem] text-content-muted file:mr-3 file:h-9 file:rounded-full file:border-0 file:bg-brand-gradient file:px-4 file:text-[0.8125rem] file:font-semibold file:text-content-inverse"
        />
        {error ? (
          <p className="flex items-start gap-2 text-[0.8125rem] font-medium text-coral-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}
        <Button type="submit" fullWidth loading={uploading} loadingLabel="Importing" leadingIcon={<Upload className="h-4 w-4" />}>
          Import {ROLE_LABEL[role]}s
        </Button>
      </form>

      {result ? (
        <div className="space-y-2 rounded-2xl border border-line bg-surface-muted p-3.5">
          <p className="text-[0.8125rem] font-semibold text-content">
            {result.created} of {result.attempted} accounts created
          </p>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-[0.75rem]">
            {result.results.map((r) => (
              <li key={r.row} className={r.status === "created" ? "text-jade-700" : "text-coral-700"}>
                Row {r.row} &middot; {r.fullName || "(no name)"} &middot; {r.status === "created" ? `Created (${r.code})` : r.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
