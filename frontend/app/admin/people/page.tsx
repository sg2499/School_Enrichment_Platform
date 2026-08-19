"use client";

/** Account creation and roster management -- the "People" nav item that was
 * a soon:true stub until 19 Aug 2026 (Shailesh: "the super admin would need
 * to create the admin accounts and then the admin would have to create the
 * teacher and student accounts respectively ... that is an integral part of
 * the platform from where the super admin, admin and teacher can keep track
 * of the respective data under them"). Backend: routes_roster.py.
 *
 * Second pass (19 Aug 2026, same day): the first version packed Roster and
 * Add People into two cramped side-by-side cards, which reads fine with two
 * test accounts and falls apart the moment a real school has hundreds of
 * students. Redesigned around the shape of the actual data: role (Admin /
 * Teacher / Student) is the primary dimension -- each has its own columns,
 * its own code scheme, its own create form -- so it's the top-level tab.
 * Roster vs. Add People is the secondary dimension underneath it. Both tabs
 * get the full page width; the roster is a real table with search, a
 * status filter, and client-side pagination so a few thousand rows in one
 * school renders as a scrollable page, not a DOM of thousands of <li>s.
 *
 * Shared between ADMIN and SUPER_ADMIN, same pattern as /admin/curriculum:
 * a school's own ADMIN acts on their school implicitly; SUPER_ADMIN picks
 * a school first (reusing the same /curriculum-admin/schools lookup
 * Curriculum Studio already built). ADMIN never sees the Admin tab at all
 * -- per Shailesh's own framing, admins manage teachers/students, only a
 * Super Admin manages admins.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  RefreshCw,
  Search,
  Upload,
  UserPlus,
  Users,
  UserX,
} from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardIcon, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { SelectField, TextField } from "@/components/ui/Field";
import { api, apiErrorMessage } from "@/lib/api";
import type { SchoolOption } from "@/types/curriculum";

type PersonRole = "ADMIN" | "TEACHER" | "STUDENT";
type Mode = "roster" | "add";

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

const ROLE_LABEL: Record<PersonRole, string> = { ADMIN: "Admins", TEACHER: "Teachers", STUDENT: "Students" };
const ROLE_LABEL_SINGULAR: Record<PersonRole, string> = { ADMIN: "Admin", TEACHER: "Teacher", STUDENT: "Student" };
const PAGE_SIZE = 25;
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
  const selectedSchool = schools.find((s) => s.id === selectedSchoolId) ?? null;

  if (!isPlatformAdmin) {
    return <RosterWorkspace isPlatformAdmin={false} schoolId="" />;
  }

  return (
    <div className="space-y-6">
      <Card className="animate-fade-up">
        <CardBody className="flex flex-wrap items-end gap-4">
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
            containerClassName="ml-auto w-full max-w-sm"
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
        <RosterWorkspace
          key={selectedSchoolId}
          isPlatformAdmin={isPlatformAdmin}
          schoolId={selectedSchoolId}
          schoolLabel={selectedSchool?.name}
        />
      )}
    </div>
  );
}

function RosterWorkspace({
  isPlatformAdmin,
  schoolId,
  schoolLabel,
}: {
  isPlatformAdmin: boolean;
  schoolId: string;
  schoolLabel?: string;
}) {
  const availableRoles = useMemo<PersonRole[]>(
    () => (isPlatformAdmin ? ["ADMIN", "TEACHER", "STUDENT"] : ["TEACHER", "STUDENT"]),
    [isPlatformAdmin],
  );
  const [activeRole, setActiveRole] = useState<PersonRole>(availableRoles[0]);
  const [mode, setMode] = useState<Mode>("roster");
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<CreatedPerson | null>(null);

  const loadPeople = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await api.get<{ people: Person[] }>("/roster/people", {
        params: { schoolId: isPlatformAdmin ? schoolId : undefined, includeInactive: true },
      });
      setPeople(data.people);
    } catch (err) {
      setLoadError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [isPlatformAdmin, schoolId]);

  useEffect(() => {
    loadPeople();
  }, [loadPeople]);

  const roleCounts = useMemo(() => {
    const counts: Record<PersonRole, { total: number; active: number }> = {
      ADMIN: { total: 0, active: 0 },
      TEACHER: { total: 0, active: 0 },
      STUDENT: { total: 0, active: 0 },
    };
    for (const person of people) {
      counts[person.role].total += 1;
      if (person.isActive) counts[person.role].active += 1;
    }
    return counts;
  }, [people]);

  async function handleStatusToggle(person: Person) {
    try {
      await api.patch(`/roster/people/${person.id}/status`, { isActive: !person.isActive });
      await loadPeople();
    } catch (err) {
      setLoadError(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-5">
      {lastCreated ? (
        <NewAccountCallout
          person={lastCreated}
          onDismiss={() => setLastCreated(null)}
          onViewRoster={() => {
            setActiveRole(lastCreated.role);
            setMode("roster");
            setLastCreated(null);
          }}
        />
      ) : null}

      <Card className="animate-fade-up overflow-hidden">
        {/* Primary dimension: which role. Each role has its own columns, its
            own code scheme (STU-/TCH-), and its own create form, so it's the
            top-level tab rather than a filter chip buried in the table. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-muted/60 px-5 py-3 sm:px-6">
          {availableRoles.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => setActiveRole(role)}
              className={`flex h-11 items-center gap-2 rounded-2xl px-4 text-[0.875rem] font-semibold transition ${
                activeRole === role
                  ? "bg-brand-gradient text-content-inverse shadow-brand"
                  : "border border-line-strong bg-surface text-content-muted hover:border-brand-300 hover:text-content"
              }`}
            >
              {ROLE_LABEL[role]}
              <span
                className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-bold ${
                  activeRole === role ? "bg-white/20" : "bg-ink-100 text-ink-600"
                }`}
              >
                {roleCounts[role].total}
              </span>
            </button>
          ))}
          {schoolLabel ? (
            <span className="ml-auto hidden text-[0.8125rem] font-medium text-content-subtle sm:inline">
              {schoolLabel}
            </span>
          ) : null}
        </div>

        {/* Secondary dimension: Roster (view/manage) vs. Add People (create). */}
        <div className="flex items-center gap-2 border-b border-line px-5 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => setMode("roster")}
            className={`h-9 rounded-full px-4 text-[0.8125rem] font-semibold transition ${
              mode === "roster" ? "bg-ink-900 text-white" : "text-content-muted hover:bg-surface-muted"
            }`}
          >
            Roster
          </button>
          <button
            type="button"
            onClick={() => setMode("add")}
            className={`flex h-9 items-center gap-1.5 rounded-full px-4 text-[0.8125rem] font-semibold transition ${
              mode === "add" ? "bg-ink-900 text-white" : "text-content-muted hover:bg-surface-muted"
            }`}
          >
            <UserPlus className="h-3.5 w-3.5" />
            Add People
          </button>
          <button
            type="button"
            onClick={loadPeople}
            aria-label="Refresh roster"
            title="Refresh"
            className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-full text-content-subtle transition hover:bg-surface-muted hover:text-content"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
          </button>
        </div>

        {loadError ? (
          <p className="flex items-start gap-2 px-5 pt-4 text-[0.8125rem] font-medium text-coral-700 sm:px-6">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {loadError}
          </p>
        ) : null}

        <div className="p-5 sm:p-6">
          {mode === "roster" ? (
            <RosterTable
              role={activeRole}
              people={people.filter((p) => p.role === activeRole)}
              loading={loading}
              onToggleStatus={handleStatusToggle}
              onAddFirst={() => setMode("add")}
            />
          ) : (
            <AddPeoplePanel
              role={activeRole}
              isPlatformAdmin={isPlatformAdmin}
              schoolId={schoolId}
              onCreated={(person) => {
                setLastCreated(person);
                loadPeople();
              }}
            />
          )}
        </div>
      </Card>
    </div>
  );
}

function RosterTable({
  role,
  people,
  loading,
  onToggleStatus,
  onAddFirst,
}: {
  role: PersonRole;
  people: Person[];
  loading: boolean;
  onToggleStatus: (person: Person) => void;
  onAddFirst: () => void;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [role, search, statusFilter]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return people.filter((p) => {
      if (statusFilter === "active" && !p.isActive) return false;
      if (statusFilter === "inactive" && p.isActive) return false;
      if (!term) return true;
      return (
        p.fullName.toLowerCase().includes(term) ||
        (p.email ?? "").toLowerCase().includes(term) ||
        (p.code ?? "").toLowerCase().includes(term)
      );
    });
  }, [people, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  if (loading) {
    return <p className="py-8 text-center text-[0.8125rem] text-content-subtle">Loading roster&hellip;</p>;
  }

  if (people.length === 0) {
    return (
      <EmptyState
        status={{ label: "Empty", tone: "neutral" }}
        title={`No ${ROLE_LABEL[role].toLowerCase()} yet`}
        description={`${ROLE_LABEL[role]} created for this school will show up here.`}
        actions={
          <Button type="button" size="sm" leadingIcon={<UserPlus className="h-4 w-4" />} onClick={onAddFirst}>
            Add {ROLE_LABEL_SINGULAR[role]}
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${ROLE_LABEL[role].toLowerCase()} by name, email, or code`}
            className="h-10 w-full rounded-xl border border-line-strong bg-surface pl-10 pr-3 text-[0.8125rem] text-content shadow-xs outline-none transition focus:border-brand-400"
          />
        </div>
        {(["all", "active", "inactive"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setStatusFilter(f)}
            className={`h-9 shrink-0 rounded-full px-3.5 text-[0.75rem] font-semibold capitalize transition ${
              statusFilter === f
                ? "border border-brand-300 bg-surface-brand text-content-brand"
                : "border border-line-strong bg-surface text-content-muted hover:border-brand-300"
            }`}
          >
            {f}
          </button>
        ))}
        <span className="ml-auto text-[0.75rem] font-medium text-content-subtle">
          {filtered.length} {filtered.length === 1 ? "result" : "results"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-[0.8125rem] text-content-subtle">No matches for that search/filter.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[36rem] border-collapse text-left text-[0.8125rem]">
              <thead className="bg-surface-muted text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-subtle">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Login ID</th>
                  {role === "STUDENT" ? <th className="px-4 py-3">Class</th> : null}
                  {role === "TEACHER" ? <th className="px-4 py-3">Designation</th> : null}
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pageRows.map((person) => (
                  <tr key={person.id} className="bg-surface transition hover:bg-surface-muted/60">
                    <td className="px-4 py-3 font-semibold text-content">{person.fullName}</td>
                    <td className="px-4 py-3 font-mono text-[0.75rem] text-content-muted">
                      {person.email || person.code || "—"}
                    </td>
                    {role === "STUDENT" ? (
                      <td className="px-4 py-3 text-content-muted">
                        {person.className ? `${person.className}${person.section ? ` ${person.section}` : ""}` : "—"}
                      </td>
                    ) : null}
                    {role === "TEACHER" ? (
                      <td className="px-4 py-3 text-content-muted">{person.designation || "—"}</td>
                    ) : null}
                    <td className="px-4 py-3">
                      <Badge tone={person.isActive ? "success" : "danger"} size="sm">
                        {person.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        variant={person.isActive ? "ghost" : "secondary"}
                        size="sm"
                        leadingIcon={person.isActive ? <UserX className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                        onClick={() => onToggleStatus(person)}
                      >
                        {person.isActive ? "Deactivate" : "Reactivate"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 ? (
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-[0.75rem] text-content-subtle">
                Showing {(pageSafe - 1) * PAGE_SIZE + 1}&ndash;{Math.min(pageSafe * PAGE_SIZE, filtered.length)} of{" "}
                {filtered.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pageSafe <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  leadingIcon={<ChevronLeft className="h-3.5 w-3.5" />}
                >
                  Previous
                </Button>
                <span className="text-[0.75rem] font-semibold text-content-muted">
                  Page {pageSafe} of {totalPages}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pageSafe >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  trailingIcon={<ChevronRight className="h-3.5 w-3.5" />}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function NewAccountCallout({
  person,
  onDismiss,
  onViewRoster,
}: {
  person: CreatedPerson;
  onDismiss: () => void;
  onViewRoster: () => void;
}) {
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
    <div className="space-y-3 rounded-2xl border border-jade-200 bg-jade-50 p-5 animate-scale-in">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.875rem] font-bold text-jade-900">
          {ROLE_LABEL_SINGULAR[person.role]} account created for {person.fullName}
        </p>
        <button type="button" onClick={onDismiss} className="text-[0.75rem] font-semibold text-jade-700 hover:text-jade-900">
          Dismiss
        </button>
      </div>
      <p className="text-[0.8125rem] leading-relaxed text-jade-800">
        Share these sign-in details securely. They can change the password anytime from their profile menu once
        signed in.
      </p>
      <div className="flex flex-wrap items-center gap-4 rounded-xl bg-white/70 p-3 font-mono text-[0.8125rem] text-jade-950">
        <span>
          Login: <strong>{loginId}</strong>
        </span>
        <span>
          Password: <strong>{person.initialPassword}</strong>
        </span>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          leadingIcon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          onClick={handleCopy}
        >
          {copied ? "Copied" : "Copy Credentials"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onViewRoster}>
          View in Roster
        </Button>
      </div>
    </div>
  );
}

function AddPeoplePanel({
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
  const [entryMode, setEntryMode] = useState<"single" | "bulk">("single");
  const bulkEligible = role !== "ADMIN"; // bulk ADMIN creation isn't a real onboarding pattern -- one at a time is fine, see routes_roster.py's BULK_ROLES.

  useEffect(() => {
    if (!bulkEligible) setEntryMode("single");
  }, [bulkEligible]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h3 className="font-display text-lg font-semibold text-content">
          Add {role === "STUDENT" ? "a Student" : role === "TEACHER" ? "a Teacher" : "an Admin"}
        </h3>
        <p className="mt-1 text-[0.8125rem] text-content-muted">
          {role === "ADMIN"
            ? "They'll get full administrative access to this school."
            : "They can sign in immediately with the credentials shown after creation."}
        </p>
      </div>

      {bulkEligible ? (
        <div className="flex gap-2">
          <Button
            type="button"
            variant={entryMode === "single" ? "primary" : "secondary"}
            size="sm"
            onClick={() => setEntryMode("single")}
          >
            Single Entry
          </Button>
          <Button
            type="button"
            variant={entryMode === "bulk" ? "primary" : "secondary"}
            size="sm"
            leadingIcon={<Upload className="h-3.5 w-3.5" />}
            onClick={() => setEntryMode("bulk")}
          >
            Bulk Import
          </Button>
        </div>
      ) : null}

      {entryMode === "single" ? (
        <SinglePersonForm role={role} isPlatformAdmin={isPlatformAdmin} schoolId={schoolId} onCreated={onCreated} />
      ) : (
        <BulkImportForm role={role === "ADMIN" ? "TEACHER" : role} isPlatformAdmin={isPlatformAdmin} schoolId={schoolId} />
      )}
    </div>
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
    <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-line bg-surface-muted/40 p-5 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
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
      </div>
      {role === "STUDENT" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Class" value={className} onChange={(e) => setClassName(e.target.value)} placeholder="5" />
          <TextField label="Section" value={section} onChange={(e) => setSection(e.target.value)} placeholder="A" />
        </div>
      ) : null}
      {role === "TEACHER" ? (
        <div className="grid gap-4 sm:grid-cols-2">
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

      <Button type="submit" loading={saving} loadingLabel="Creating" leadingIcon={<UserPlus className="h-4 w-4" />}>
        Create {ROLE_LABEL_SINGULAR[role]} Account
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
    <div className="space-y-4 rounded-2xl border border-line bg-surface-muted/40 p-5 sm:p-6">
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
        <Button type="submit" loading={uploading} loadingLabel="Importing" leadingIcon={<Upload className="h-4 w-4" />}>
          Import {ROLE_LABEL[role]}
        </Button>
      </form>

      {result ? (
        <div className="space-y-2 rounded-2xl border border-line bg-surface p-3.5">
          <p className="text-[0.8125rem] font-semibold text-content">
            {result.created} of {result.attempted} accounts created
          </p>
          <ul className="max-h-56 space-y-1 overflow-y-auto text-[0.75rem]">
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
