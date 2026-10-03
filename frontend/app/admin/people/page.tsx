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
 *
 * Phase 2a pass (30 Sep 2026): same structure, finished. Every toggle now
 * exposes its pressed state to assistive tech (they were plain buttons
 * whose only "selected" signal was colour); the roster loads as skeleton
 * rows rather than a line of text; the status filter carries live counts,
 * which is where the already-computed-but-never-shown active totals went;
 * a deactivate/reactivate click shows its own progress and can't be
 * double-fired; and a bulk import now refreshes the roster behind it (it
 * used to leave the tab counts and table stale until a manual refresh).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleX,
  Copy,
  Download,
  FileSpreadsheet,
  KeyRound,
  RefreshCw,
  Search,
  Upload,
  UserPlus,
  Users,
  UserX,
  X,
} from "lucide-react";
import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardIcon, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { SessionGate } from "@/components/SessionGate";
import { SelectField, TextField } from "@/components/ui/Field";
import { RosterIllustration } from "@/components/brand/Graphics";
import { api, errorMessage } from "@/lib/api";
import { cn, initialsFromName } from "@/lib/utils";
import type { SchoolOption } from "@/types/curriculum";

type PersonRole = "ADMIN" | "TEACHER" | "STUDENT";
type Mode = "roster" | "add";
type StatusFilter = "all" | "active" | "inactive";

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

/** What POST /roster/people/{id}/reset-password answers with. The password
 *  is in this response and nowhere else (routes_roster.py stores a hash). */
interface PasswordReset {
  id: string;
  fullName: string;
  role: PersonRole;
  signInWith: string | null;
  temporaryPassword: string;
}

/** Credentials on screen for their one and only showing: a new account's,
 *  or the temporary password from a reset. */
type Handover =
  | { kind: "created"; person: CreatedPerson }
  | { kind: "reset"; reset: PasswordReset };

function handoverName(handover: Handover): string {
  return handover.kind === "reset" ? handover.reset.fullName : handover.person.fullName;
}

/**
 * What the person does with a password someone else issued, in the order
 * it really happens for them (backend/app/dependencies.py checks the
 * password before two-factor; an enrolled admin gives their code at
 * sign-in, before either).
 */
function whatHappensNext(role: PersonRole, kind: Handover["kind"]): string {
  if (role !== "ADMIN") return "It is temporary: they choose their own password when they sign in.";
  return kind === "created"
    ? "It is temporary: at their first sign-in they choose their own password, then set up two-factor."
    : "It is temporary: after their two-factor code, they choose their own password.";
}

const ROLE_LABEL: Record<PersonRole, string> = { ADMIN: "Admins", TEACHER: "Teachers", STUDENT: "Students" };
const ROLE_LABEL_SINGULAR: Record<PersonRole, string> = { ADMIN: "Admin", TEACHER: "Teacher", STUDENT: "Student" };
const STATUS_FILTER_LABEL: Record<StatusFilter, string> = { all: "All", active: "Active", inactive: "Inactive" };
const PAGE_SIZE = 25;
// `password` is last and optional: a first password the school chooses for
// that row. Blank means the system generates one (routes_roster.py).
const BULK_TEMPLATE_HEADER = "fullName,email,className,section,designation,subjectSpecialization,qualification,password";

/** Shared look for the small segmented toggles on this page (role tabs sit
 *  one level up and have their own, heavier treatment). Pressed state is
 *  ink-900 with white text, 17:1; resting is content-muted on white, 8.7:1. */
function segmentClass(pressed: boolean) {
  return cn(
    "inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[0.8125rem] font-semibold transition duration-200 ease-spring",
    pressed ? "bg-ink-900 text-white shadow-xs" : "text-content-muted hover:bg-surface-muted hover:text-content",
  );
}

export default function PeoplePage() {
  const session = useProtectedPage("ADMIN");
  const { user, status } = session;

  if (status !== "ready" || !user) {
    return <SessionGate session={session} />;
  }

  const isPlatformAdmin = user.role === "SUPER_ADMIN";
  const roleForShell = isPlatformAdmin ? "SUPER_ADMIN" : "ADMIN";

  return (
    <RoleShell role={roleForShell} user={user}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="School"
          title="People"
          description={
            isPlatformAdmin
              ? "Create Admin, Teacher and Student accounts for any school, and keep track of who's active."
              : "Create Teacher and Student accounts, and keep track of who's active across your school."
          }
        />
        <PeoplePanel isPlatformAdmin={isPlatformAdmin} />
      </div>
    </RoleShell>
  );
}

function PeoplePanel({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [loadingSchools, setLoadingSchools] = useState(isPlatformAdmin);
  const [schoolsError, setSchoolsError] = useState<string | null>(null);
  const [selectedSchoolId, setSelectedSchoolId] = useState("");

  useEffect(() => {
    if (!isPlatformAdmin) return;
    setLoadingSchools(true);
    api
      .get<{ schools: SchoolOption[] }>("/curriculum-admin/schools")
      .then(({ data }) => setSchools(data.schools))
      // Surfaced now: a failed lookup used to be swallowed, leaving an empty
      // picker with no explanation of why there was nothing to choose.
      .catch((err) => setSchoolsError(errorMessage(err, "load the list of schools")))
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
            error={schoolsError}
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
        <Card className="animate-fade-up delay-70">
          <CardBody className="sm:p-8">
            <EmptyState
              illustration={<RosterIllustration />}
              status={{ label: "No School Selected", tone: "neutral" }}
              title="Pick a school to open its roster"
              description="Choose a school above to create its Admin accounts and see its Teachers and Students."
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
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // One hand-over on screen at a time: showing a second set of credentials
  // under the first is how the wrong password gets read out to someone.
  const [handover, setHandover] = useState<Handover | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  // Resetting a password is asked about before it is done: it signs the
  // person out everywhere and kills the password they have, on one click.
  const [resetTarget, setResetTarget] = useState<Person | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const loadPeople = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await api.get<{ people: Person[] }>("/roster/people", {
        params: { schoolId: isPlatformAdmin ? schoolId : undefined, includeInactive: true },
      });
      setPeople(data.people);
      setHasLoaded(true);
    } catch (err) {
      setLoadError(errorMessage(err, "load this list of people"));
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
    // One row at a time: the button shows its own progress, and a second
    // click while the first is in flight would otherwise toggle it straight
    // back again.
    if (togglingId) return;
    setTogglingId(person.id);
    try {
      await api.patch(`/roster/people/${person.id}/status`, { isActive: !person.isActive });
      await loadPeople();
    } catch (err) {
      setLoadError(errorMessage(err, `${person.isActive ? "deactivate" : "reactivate"} ${person.fullName}`));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleResetPassword() {
    if (!resetTarget || resetting) return;
    setResetting(true);
    setResetError(null);
    try {
      const { data } = await api.post<PasswordReset>(`/roster/people/${resetTarget.id}/reset-password`);
      setHandover({ kind: "reset", reset: data });
      setResetTarget(null);
    } catch (err) {
      setResetError(errorMessage(err, `reset ${resetTarget.fullName}'s password`));
    } finally {
      setResetting(false);
    }
  }

  function closeResetDialog() {
    if (resetting) return;
    setResetTarget(null);
    setResetError(null);
  }

  return (
    <div className="space-y-5">
      {handover ? (
        <HandoverCallout
          handover={handover}
          onDismiss={() => setHandover(null)}
          onViewRoster={
            handover.kind === "created"
              ? () => {
                  setActiveRole(handover.person.role);
                  setMode("roster");
                  setHandover(null);
                }
              : undefined
          }
        />
      ) : null}

      <Modal
        open={Boolean(resetTarget)}
        onClose={closeResetDialog}
        size="sm"
        eyebrow="Reset Password"
        title={resetTarget ? resetTarget.fullName : ""}
        footer={
          // Pushed to the trailing edge, the committed action last: where a
          // confirmation's buttons are looked for.
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <Button type="button" variant="ghost" onClick={closeResetDialog} disabled={resetting}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleResetPassword}
              loading={resetting}
              loadingLabel="Resetting"
              leadingIcon={<KeyRound className="h-4 w-4" />}
            >
              Reset Password
            </Button>
          </div>
        }
      >
        {resetTarget ? (
          <div className="space-y-4">
            <p className="text-[0.9375rem] leading-relaxed text-content text-pretty">
              This gives {resetTarget.fullName} a new temporary password, shown to you once at the top of this page.
            </p>
            <ul className="space-y-2 text-[0.875rem] leading-relaxed text-content-muted">
              <li className="flex items-start gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-jade-600" aria-hidden />
                Their current password stops working straight away.
              </li>
              <li className="flex items-start gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-jade-600" aria-hidden />
                They are signed out on every device.
              </li>
              <li className="flex items-start gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-jade-600" aria-hidden />
                {resetTarget.role === "ADMIN"
                  ? "They choose their own password the next time they sign in. Their two-factor setup is not changed."
                  : "They choose their own password the next time they sign in."}
              </li>
            </ul>
            {/* The page shows one set of credentials at a time, and they are
                shown once. Without this, resetting a second person silently
                took the first one's password off the screen -- leaving them
                signed out with a password nobody had written down.
                saffron-900 on saffron-50: 9.3:1. */}
            {handover ? (
              <p className="flex items-start gap-2.5 rounded-2xl border border-saffron-200 bg-saffron-50 p-3 text-[0.8125rem] font-medium leading-relaxed text-saffron-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  {handoverName(handover)}&rsquo;s password is still showing on this page, and this will replace it.
                  Copy it or note it down first.
                </span>
              </p>
            ) : null}
            {resetError ? (
              <p role="alert" className="flex items-start gap-2 text-[0.8125rem] font-medium text-coral-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {resetError}
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Card className="animate-fade-up delay-70">
        {/* Primary dimension: which role. Each role has its own columns, its
            own code scheme (STU-/TCH-), and its own create form, so it's the
            top-level switch rather than a filter chip buried in the table.
            A labelled group of pressed/unpressed buttons rather than an ARIA
            tablist: a tablist promises arrow-key navigation, and three
            buttons are simpler to get right as plain Tab stops. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-muted/60 px-5 py-3 sm:px-6">
          <div role="group" aria-label="Account type" className="flex flex-wrap items-center gap-2">
            {availableRoles.map((role) => {
              const pressed = activeRole === role;
              return (
                <button
                  key={role}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => setActiveRole(role)}
                  className={cn(
                    "flex h-11 items-center gap-2 rounded-2xl px-4 text-[0.875rem] font-semibold transition duration-200 ease-spring",
                    pressed
                      ? "bg-brand-gradient text-content-inverse shadow-brand"
                      : "border border-line-strong bg-surface text-content-muted hover:border-brand-300 hover:text-content",
                  )}
                >
                  {ROLE_LABEL[role]}
                  {/* Count pill: white on the pressed tab's white/20 wash over
                      brand-700 is 5.8:1; ink-700 on ink-100 is 8.6:1. */}
                  <span
                    className={cn(
                      "min-w-[1.5rem] rounded-full px-2 py-0.5 text-center text-[0.6875rem] font-bold tabular",
                      pressed ? "bg-white/20" : "bg-ink-100 text-ink-700",
                    )}
                  >
                    {hasLoaded ? roleCounts[role].total : "–"}
                  </span>
                </button>
              );
            })}
          </div>
          {schoolLabel ? (
            <span className="ml-auto hidden max-w-[16rem] truncate text-[0.8125rem] font-medium text-content-subtle sm:inline">
              {schoolLabel}
            </span>
          ) : null}
        </div>

        {/* Secondary dimension: Roster (view/manage) vs. Add People (create). */}
        <div className="flex items-center gap-2 border-b border-line px-5 py-3 sm:px-6">
          <div role="group" aria-label="View" className="flex items-center gap-1.5">
            <button type="button" aria-pressed={mode === "roster"} onClick={() => setMode("roster")} className={segmentClass(mode === "roster")}>
              <Users className="h-3.5 w-3.5" aria-hidden />
              Roster
            </button>
            <button type="button" aria-pressed={mode === "add"} onClick={() => setMode("add")} className={segmentClass(mode === "add")}>
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
              Add People
            </button>
          </div>
          <button
            type="button"
            onClick={loadPeople}
            disabled={loading}
            aria-label="Refresh roster"
            title="Refresh"
            className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-full text-content-subtle transition hover:bg-surface-muted hover:text-content disabled:cursor-progress"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden />
          </button>
        </div>

        {loadError ? (
          <p role="alert" className="flex items-start gap-2 px-5 pt-4 text-[0.8125rem] font-medium text-coral-700 sm:px-6">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {loadError}
          </p>
        ) : null}

        <div className="p-5 sm:p-6">
          {mode === "roster" ? (
            <RosterTable
              role={activeRole}
              people={people.filter((p) => p.role === activeRole)}
              loading={loading && !hasLoaded}
              togglingId={togglingId}
              onToggleStatus={handleStatusToggle}
              onResetPassword={(person) => {
                setResetError(null);
                setResetTarget(person);
              }}
              onAddFirst={() => setMode("add")}
            />
          ) : (
            <AddPeoplePanel
              role={activeRole}
              isPlatformAdmin={isPlatformAdmin}
              schoolId={schoolId}
              onCreated={(person) => {
                setHandover({ kind: "created", person });
                loadPeople();
              }}
              onImported={loadPeople}
            />
          )}
        </div>
      </Card>
    </div>
  );
}

/** Placeholder rows in the table's own shape, so the first load doesn't
 *  reflow the card from one line of text into a full table. */
function RosterSkeleton() {
  return (
    <div aria-busy="true" className="space-y-4">
      <span className="sr-only" role="status">
        Loading roster
      </span>
      <div className="flex gap-2">
        <span aria-hidden className="h-10 flex-1 animate-pulse rounded-xl bg-ink-100" />
        <span aria-hidden className="hidden h-10 w-48 animate-pulse rounded-full bg-ink-100 sm:block" />
      </div>
      <div aria-hidden className="overflow-hidden rounded-2xl border border-line">
        <div className="h-10 bg-surface-muted" />
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex items-center gap-3 border-t border-line px-4 py-3">
            <span className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-ink-100" />
            <span className="h-3 w-40 animate-pulse rounded-full bg-ink-100" />
            <span className="ml-auto h-3 w-24 animate-pulse rounded-full bg-ink-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

function RosterTable({
  role,
  people,
  loading,
  togglingId,
  onToggleStatus,
  onResetPassword,
  onAddFirst,
}: {
  role: PersonRole;
  people: Person[];
  loading: boolean;
  togglingId: string | null;
  onToggleStatus: (person: Person) => void;
  onResetPassword: (person: Person) => void;
  onAddFirst: () => void;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [role, search, statusFilter]);

  const statusCounts = useMemo(() => {
    const active = people.filter((p) => p.isActive).length;
    return { all: people.length, active, inactive: people.length - active };
  }, [people]);

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
    return <RosterSkeleton />;
  }

  if (people.length === 0) {
    return (
      <EmptyState
        illustration={<RosterIllustration />}
        status={{ label: "No Accounts Yet", tone: "neutral" }}
        title={`No ${ROLE_LABEL[role].toLowerCase()} yet`}
        description={
          role === "STUDENT"
            ? "Add students one at a time, or import a whole class from a spreadsheet. Each one gets a sign-in code."
            : role === "TEACHER"
              ? "Add teachers one at a time, or import your staff list from a spreadsheet."
              : "Admin accounts get full control of this school. Create the first one here."
        }
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
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && search) {
                e.preventDefault();
                setSearch("");
              }
            }}
            // Visible placeholder, but a placeholder is not a label -- it
            // disappears on the first keystroke and some screen readers skip
            // it entirely.
            aria-label={`Search ${ROLE_LABEL[role].toLowerCase()}`}
            placeholder={`Search ${ROLE_LABEL[role].toLowerCase()} by name, email or code`}
            className="h-10 w-full rounded-xl border border-line-strong bg-surface pl-10 pr-10 text-[0.875rem] text-content shadow-xs outline-none transition placeholder:text-content-faint hover:border-ink-300 focus:border-brand-400 focus:shadow-focus [&::-webkit-search-cancel-button]:hidden"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-content-subtle transition hover:bg-surface-muted hover:text-content"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
        <div role="group" aria-label="Filter by status" className="flex items-center gap-1.5">
          {(["all", "active", "inactive"] as const).map((f) => {
            const pressed = statusFilter === f;
            return (
              <button
                key={f}
                type="button"
                aria-pressed={pressed}
                onClick={() => setStatusFilter(f)}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[0.75rem] font-semibold transition",
                  pressed
                    ? "border border-brand-300 bg-surface-brand text-content-brand"
                    : "border border-line-strong bg-surface text-content-muted hover:border-brand-300",
                )}
              >
                {STATUS_FILTER_LABEL[f]}
                <span className={cn("tabular", pressed ? "text-brand-600" : "text-content-subtle")}>{statusCounts[f]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Announced politely as the search narrows, so a screen-reader user
          hears the effect of typing without having to go looking for it. */}
      <p aria-live="polite" className="sr-only">
        {filtered.length} {filtered.length === 1 ? "result" : "results"}
      </p>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center">
          <Search className="h-5 w-5 text-content-faint" aria-hidden />
          <p className="text-[0.875rem] font-semibold text-content">No {ROLE_LABEL[role].toLowerCase()} match that</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
            }}
          >
            Clear search and filters
          </Button>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[48rem] border-collapse text-left text-[0.8125rem]">
              <caption className="sr-only">
                {ROLE_LABEL[role]}, page {pageSafe} of {totalPages}
              </caption>
              {/* content-subtle on surface-muted: 6.0:1. */}
              <thead className="bg-surface-muted text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-subtle">
                <tr>
                  <th scope="col" className="px-4 py-3">Name</th>
                  <th scope="col" className="px-4 py-3">Login ID</th>
                  {role === "STUDENT" ? <th scope="col" className="px-4 py-3">Class</th> : null}
                  {role === "TEACHER" ? <th scope="col" className="px-4 py-3">Designation</th> : null}
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pageRows.map((person) => (
                  <tr key={person.id} className="bg-surface transition-colors hover:bg-surface-muted/60">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-3">
                        {/* Initials give a long list something to scan by
                            besides the text itself. brand-700 on brand-50 is
                            9.3:1; the inactive ink-600 on ink-100, 6.3:1. */}
                        <span
                          aria-hidden
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-bold ring-1 ring-inset",
                            person.isActive ? "bg-brand-50 text-brand-700 ring-brand-100" : "bg-ink-100 text-ink-600 ring-ink-200",
                          )}
                        >
                          {initialsFromName(person.fullName)}
                        </span>
                        <span className={cn("font-semibold", person.isActive ? "text-content" : "text-content-muted")}>
                          {person.fullName}
                        </span>
                      </span>
                    </td>
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
                      {/* Inactive is neutral, not coral: coral is this
                          system's error colour, and a deactivated account is
                          a deliberate state, not a fault. */}
                      <Badge tone={person.isActive ? "success" : "neutral"} dot size="sm">
                        {person.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center justify-end gap-2">
                        {/* The answer to "I've forgotten my password"
                            (3 Oct 2026): the sign-in page sends people to
                            their school admin, and this is what the admin
                            presses. Only for an account that can sign in --
                            an inactive one is reactivated first, and the
                            server says the same if asked. `tinted`, as the
                            row's standing action; Deactivate beside it stays
                            the quiet one. */}
                        {person.isActive ? (
                          <Button
                            type="button"
                            variant="tinted"
                            size="sm"
                            aria-label={`Reset ${person.fullName}'s password`}
                            leadingIcon={<KeyRound className="h-3.5 w-3.5" />}
                            disabled={Boolean(togglingId)}
                            onClick={() => onResetPassword(person)}
                          >
                            Reset Password
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant={person.isActive ? "ghost" : "secondary"}
                          size="sm"
                          aria-label={`${person.isActive ? "Deactivate" : "Reactivate"} ${person.fullName}`}
                          leadingIcon={person.isActive ? <UserX className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                          loading={togglingId === person.id}
                          loadingLabel={person.isActive ? "Deactivating" : "Reactivating"}
                          disabled={Boolean(togglingId) && togglingId !== person.id}
                          onClick={() => onToggleStatus(person)}
                        >
                          {person.isActive ? "Deactivate" : "Reactivate"}
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-[0.75rem] text-content-subtle tabular">
              {totalPages > 1 ? (
                <>
                  Showing {(pageSafe - 1) * PAGE_SIZE + 1}&ndash;{Math.min(pageSafe * PAGE_SIZE, filtered.length)} of{" "}
                  {filtered.length}
                </>
              ) : (
                <>
                  {filtered.length} {filtered.length === 1 ? "account" : "accounts"}
                </>
              )}
            </p>
            {totalPages > 1 ? (
              <nav aria-label="Roster pages" className="flex items-center gap-2">
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
                <span className="text-[0.75rem] font-semibold text-content-muted tabular">
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
              </nav>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The one moment a password is ever visible: a new account's, or the
 * temporary one from a reset. It is random, stored only as a hash
 * (routes_roster.py, A1 fix), and no endpoint can show it again -- so the
 * callout says so, and moves itself into view. It renders above the card
 * while the form or the row that produced it sits further down; on a phone
 * it would otherwise appear entirely off-screen.
 *
 * Says what happens next for each kind (3 Oct 2026): until then it told the
 * admin "they can change it from their profile menu", which was optional
 * advice. It is now a rule the server enforces -- the password is temporary,
 * and its owner chooses their own at first sign-in.
 */
function HandoverCallout({
  handover,
  onDismiss,
  onViewRoster,
}: {
  handover: Handover;
  onDismiss: () => void;
  onViewRoster?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isReset = handover.kind === "reset";
  const fullName = isReset ? handover.reset.fullName : handover.person.fullName;
  const role = isReset ? handover.reset.role : handover.person.role;
  const loginId = isReset ? handover.reset.signInWith || "" : handover.person.email || handover.person.code || "";
  const password = isReset ? handover.reset.temporaryPassword : handover.person.initialPassword;
  const personId = isReset ? handover.reset.id : handover.person.id;

  useEffect(() => {
    // "nearest" scrolls only as far as needed, and not at all if it's
    // already on screen.
    ref.current?.scrollIntoView({ block: "nearest" });
    setCopied(false);
  }, [personId, password]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(`Login: ${loginId}\nPassword: ${password}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked -- the credentials are already visible on screen.
    }
  }

  const next = whatHappensNext(role, handover.kind);
  const heading = isReset ? `Temporary password for ${fullName}` : `${ROLE_LABEL_SINGULAR[role]} account created for ${fullName}`;

  return (
    // Not role="status" on the whole callout: that would have a screen
    // reader read out the password, aloud, the moment it appeared -- and
    // again each time a second reset replaced it. The hidden line below
    // announces that credentials are showing, and for whom; the password
    // itself is read only when the person moves to it.
    <div
      ref={ref}
      className="scroll-mt-24 space-y-4 rounded-3xl border border-jade-200 bg-jade-50 p-5 shadow-card animate-scale-in sm:p-6"
    >
      <p role="status" className="sr-only">
        {heading}. Sign-in details are shown below, this once.
      </p>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-jade-500 text-white shadow-xs">
            {isReset ? <KeyRound className="h-4 w-4" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
          </span>
          <div>
            {/* jade-900 on jade-50: 11.1:1; jade-800, 8.9:1. */}
            <p className="text-[0.9375rem] font-bold text-jade-900">{heading}</p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-jade-800 text-pretty">
              {isReset ? "Their old password no longer works and they have been signed out everywhere. " : ""}
              Share these sign-in details securely. The password is shown only this once. {next}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-jade-700 transition hover:bg-jade-100 hover:text-jade-900"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {/* Was text-jade-950, a step the palette doesn't have -- Tailwind
          generated no class for it, so this text silently fell back to the
          inherited colour. jade-900 on the white/70 wash: 11.6:1. */}
      <dl className="grid gap-2 rounded-2xl bg-white/70 p-3.5 font-mono text-[0.8125rem] text-jade-900 ring-1 ring-inset ring-jade-100 sm:grid-cols-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <dt className="shrink-0 font-sans text-[0.6875rem] font-bold uppercase tracking-eyebrow text-jade-700">Login</dt>
          <dd className="min-w-0 select-all break-all font-semibold">{loginId}</dd>
        </div>
        <div className="flex min-w-0 items-baseline gap-2">
          <dt className="shrink-0 font-sans text-[0.6875rem] font-bold uppercase tracking-eyebrow text-jade-700">Password</dt>
          <dd className="min-w-0 select-all break-all font-semibold">{password}</dd>
        </div>
      </dl>
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
        {onViewRoster ? (
          <Button type="button" variant="ghost" size="sm" onClick={onViewRoster}>
            View in Roster
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function AddPeoplePanel({
  role,
  isPlatformAdmin,
  schoolId,
  onCreated,
  onImported,
}: {
  role: PersonRole;
  isPlatformAdmin: boolean;
  schoolId: string;
  onCreated: (person: CreatedPerson) => void;
  onImported: () => void;
}) {
  const [entryMode, setEntryMode] = useState<"single" | "bulk">("single");
  const bulkEligible = role !== "ADMIN"; // bulk ADMIN creation isn't a real onboarding pattern -- one at a time is fine, see routes_roster.py's BULK_ROLES.

  useEffect(() => {
    if (!bulkEligible) setEntryMode("single");
  }, [bulkEligible]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3 className="font-display text-lg font-semibold text-content">
            Add {role === "STUDENT" ? "a Student" : role === "TEACHER" ? "a Teacher" : "an Admin"}
          </h3>
          <p className="mt-1 text-[0.8125rem] text-content-muted">
            {role === "ADMIN"
              ? "They'll get full administrative access to this school, and set up two-factor on first sign-in."
              : "Each account gets a sign-in code, and can sign in as soon as you share its details."}
          </p>
        </div>

        {bulkEligible ? (
          <div role="group" aria-label="How to add" className="flex gap-1 rounded-full border border-line bg-surface-muted p-1">
            <button type="button" aria-pressed={entryMode === "single"} onClick={() => setEntryMode("single")} className={segmentClass(entryMode === "single")}>
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
              Single Entry
            </button>
            <button type="button" aria-pressed={entryMode === "bulk"} onClick={() => setEntryMode("bulk")} className={segmentClass(entryMode === "bulk")}>
              <Upload className="h-3.5 w-3.5" aria-hidden />
              Bulk Import
            </button>
          </div>
        ) : null}
      </div>

      {entryMode === "single" ? (
        <SinglePersonForm role={role} isPlatformAdmin={isPlatformAdmin} schoolId={schoolId} onCreated={onCreated} />
      ) : (
        <BulkImportForm
          role={role === "ADMIN" ? "TEACHER" : role}
          isPlatformAdmin={isPlatformAdmin}
          schoolId={schoolId}
          onImported={onImported}
        />
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
      setError(errorMessage(err, `add this ${ROLE_LABEL_SINGULAR[role].toLowerCase()}`));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-3xl border border-line bg-surface-muted/40 p-5 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Full Name"
          required
          autoComplete="off"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="e.g. Ananya Rao"
        />
        <TextField
          label={role === "ADMIN" ? "Email" : "Email (optional)"}
          type="email"
          autoComplete="off"
          required={role === "ADMIN"}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          hint={role !== "ADMIN" ? "Or sign in with the code" : undefined}
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
        <p role="alert" className="flex items-start gap-2 text-[0.8125rem] font-medium text-coral-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <Button type="submit" loading={saving} loadingLabel="Creating" leadingIcon={<UserPlus className="h-4 w-4" />}>
          Create {ROLE_LABEL_SINGULAR[role]} Account
        </Button>
        <span className="text-[0.75rem] text-content-subtle">Sign-in details appear at the top once it&rsquo;s created.</span>
      </div>
    </form>
  );
}

interface BulkRowResult {
  row: number;
  fullName: string;
  status: "created" | "skipped";
  code?: string;
  // Present on "created" rows only. email is null when the row had none --
  // the code is then the login, same fallback HandoverCallout uses.
  email?: string | null;
  initialPassword?: string;
  // "sheet" when the row's own `password` column supplied it.
  passwordSource?: "sheet" | "generated";
  error?: string;
}

interface BulkImportResult {
  created: number;
  attempted: number;
  results: BulkRowResult[];
  // Headings in the file that are not columns the import reads.
  unrecognisedColumns?: string[];
}

// Same grid on the header and on every row, so the Login/Password columns
// line up down a list that can run to hundreds of rows.
const BULK_RESULT_GRID = "sm:grid sm:grid-cols-[0.875rem_3rem_minmax(0,1fr)_14rem_7.5rem] sm:gap-x-2.5";

/** One CSV cell: quoted when it holds a delimiter/quote/newline, and a
 * leading = + - @ (or tab/CR) neutralised with a ' so a spreadsheet opens a
 * name like "=HYPERLINK(...)" as text, not as a formula. */
function csvCell(value: string, { exact = false }: { exact?: boolean } = {}): string {
  // `exact` is for the password column: a password must come out of the
  // file as the characters it is, so it is quoted but never altered. (The
  // guard exists for names typed by other people; a password that begins
  // with "@" was chosen by the admin opening the file.)
  const safe = !exact && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** How many of the passwords just shown came from the admin's own sheet,
 *  said only when some did, and without claiming "the rest" when there is
 *  no rest. */
function sheetNote(fromSheet: number, created: number): string {
  if (fromSheet === 0) return "";
  if (fromSheet === created) {
    return created === 1 ? " This one is the password from your sheet." : " All of these are the passwords from your sheet.";
  }
  return ` ${fromSheet} of these ${fromSheet === 1 ? "is" : "are"} from your sheet; the rest were generated.`;
}

function csvTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function BulkImportForm({
  role,
  isPlatformAdmin,
  schoolId,
  onImported,
}: {
  role: "TEACHER" | "STUDENT";
  isPlatformAdmin: boolean;
  schoolId: string;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The role is kept with the result: this form stays mounted when the
  // Teachers/Students tab changes, and the credentials file must be named
  // for the role that was actually imported.
  const [result, setResult] = useState<(BulkImportResult & { role: "TEACHER" | "STUDENT" }) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleDownloadTemplate() {
    const exampleRow =
      role === "STUDENT" ? "Ananya Rao,,5,A,,,," : "Ravi Kumar,ravi.kumar@example.com,,,TGT,Mathematics,B.Ed,";
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

  const createdRows = result ? result.results.filter((r) => r.status === "created") : [];
  const fromSheet = createdRows.filter((r) => r.passwordSource === "sheet").length;

  /** The only copy of these passwords outside this screen -- built in the
   * browser from the import response, never sent anywhere. The leading BOM
   * makes Excel read non-ASCII names as UTF-8. */
  function handleDownloadCredentials() {
    if (!result || createdRows.length === 0) return;
    const lines = [
      "fullName,login,initialPassword",
      ...createdRows.map((r) =>
        [csvCell(r.fullName), csvCell(r.email || r.code || ""), csvCell(r.initialPassword ?? "", { exact: true })].join(","),
      ),
    ];
    const blob = new Blob([`﻿${lines.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `credentials-${result.role.toLowerCase()}-${csvTimestamp(new Date())}.csv`;
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
      const { data } = await api.post<BulkImportResult>("/roster/people/bulk", formData);
      setResult({ ...data, role });
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      // The roster tab behind this form (and its counts) was left stale
      // after an import until someone pressed refresh.
      if (data.created > 0) onImported();
    } catch (err) {
      setError(errorMessage(err, "import this file"));
    } finally {
      setUploading(false);
    }
  }

  const skipped = result ? result.attempted - result.created : 0;

  return (
    <div className="space-y-5 rounded-3xl border border-line bg-surface-muted/40 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* No max-w-prose (1 Oct 2026): the form's max-w-3xl already bounds
            this, and the cap broke a note that fits on one line in two. */}
        <p className="text-[0.8125rem] leading-relaxed text-content-muted text-pretty">
          Upload a .csv or .xlsx file with a header row. Only <strong className="text-content">fullName</strong> is
          required; the template has every column in the right order.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" size="sm" leadingIcon={<Download className="h-3.5 w-3.5" />} onClick={handleDownloadTemplate}>
            Download Template
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leadingIcon={<KeyRound className="h-3.5 w-3.5" />}
            onClick={handleDownloadCredentials}
            disabled={createdRows.length === 0}
          >
            Download Credentials (.csv)
          </Button>
        </div>
      </div>

      {/* The optional first password (3 Oct 2026). Says what a blank cell
          does, what a filled one must satisfy, and the one thing a shared
          password costs -- so the choice is made knowingly. Full width and
          under the buttons: beside them it was squeezed into a column a
          few words wide. content-muted on surface: 8.6:1. */}
      <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
        <div className="min-w-0 space-y-1.5 text-[0.8125rem] leading-relaxed text-content-muted text-pretty">
          <p>
            The <strong className="text-content">password</strong> column is optional. Leave it blank and each person
            gets their own random password. Fill it in to choose their first password yourself: at least 8 characters,
            with a letter and a number, not a common word (Welcome123 and School2026 are refused), and not the
            person&rsquo;s own name or code. Either way it is temporary, and they choose their own when they first
            sign in.
          </p>
          <p>
            If you give many people the same password, anyone who knows it can open an account before its owner does.
            Have everyone sign in soon after you hand it out.
          </p>
        </div>
      </div>

      <form onSubmit={handleUpload} className="space-y-4">
        {/* The native input stays in the DOM, keyboard-reachable and
            labelled; the dashed well around it is the visible target. */}
        <label
          className={cn(
            "flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-7 text-center transition-colors",
            file ? "border-brand-300 bg-surface-brand" : "border-line-strong bg-surface hover:border-brand-300 hover:bg-surface-brand/60",
            "focus-within:border-brand-400 focus-within:shadow-focus",
          )}
        >
          <FileSpreadsheet className={cn("h-6 w-6", file ? "text-brand-600" : "text-content-faint")} aria-hidden />
          <span className="text-[0.875rem] font-semibold text-content">{file ? file.name : "Choose a .csv or .xlsx file"}</span>
          <span className="text-[0.75rem] text-content-subtle">
            {file ? `${Math.max(1, Math.round(file.size / 1024))} KB · click to choose a different file` : "Up to 2,000 rows per file"}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError(null);
            }}
            className="sr-only"
          />
        </label>
        {error ? (
          <p role="alert" className="flex items-start gap-2 text-[0.8125rem] font-medium text-coral-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}
        <Button type="submit" loading={uploading} loadingLabel="Importing" disabled={!file} leadingIcon={<Upload className="h-4 w-4" />}>
          Import {ROLE_LABEL[role]}
        </Button>
      </form>

      {result ? (
        // Not role="status": that would make a screen reader announce this
        // whole panel on every change, passwords included, the moment they
        // appear. The sr-only span just below announces only the summary
        // count -- same pattern as the roster's own "N results" live region.
        <div className="space-y-3 rounded-2xl border border-line bg-surface p-4 animate-fade-in">
          <p role="status" className="sr-only">
            {result.created} of {result.attempted} {result.attempted === 1 ? "row" : "rows"} imported.
            {createdRows.length > 0 ? " Passwords for created accounts are shown below." : ""}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <p aria-hidden className="mr-auto text-[0.875rem] font-semibold text-content">
              {result.created} of {result.attempted} {result.attempted === 1 ? "row" : "rows"} imported
            </p>
            <Badge tone="success" dot>
              {result.created} Created
            </Badge>
            {skipped > 0 ? (
              <Badge tone="warning" dot>
                {skipped} Skipped
              </Badge>
            ) : null}
          </div>
          {/* Same posture as HandoverCallout: these passwords are stored
              only as hashes (routes_roster.py) and no endpoint can reveal
              one again; this list lives only in this component's state. A
              lost one is replaced from the roster (Reset Password).
              jade-900 on jade-50: 11.1:1. */}
          {createdRows.length > 0 ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-jade-200 bg-jade-50 p-3">
              <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-jade-700" aria-hidden />
              <p className="text-[0.75rem] leading-relaxed text-jade-900">
                Each password is shown only this once &mdash; it can&rsquo;t be retrieved again after you leave this
                screen or import another file. Use <strong>Download Credentials (.csv)</strong> or copy them now. That
                file holds live passwords: share it securely and delete it once every account has been handed off.
                {sheetNote(fromSheet, createdRows.length)} Everyone chooses their own password the first time they
                sign in.
              </p>
            </div>
          ) : null}
          {/* Created vs skipped is carried by an icon and the words, not by
              colour alone (WCAG 1.4.1). jade-700 7.3:1, coral-700 7.3:1.
              From sm up each row is one line on a shared grid with a sticky
              column header, so Login/Password labels aren't repeated on
              every row (they stay in each row's <dt> for screen readers);
              below sm the pair wraps under the name with visible labels. */}
          <div className="max-h-64 overflow-y-auto rounded-xl border border-line text-[0.75rem]">
            {createdRows.length > 0 ? (
              <div
                aria-hidden
                className={cn(
                  "sticky top-0 z-[1] hidden border-b border-line bg-surface-muted px-3 py-1.5 text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-subtle",
                  BULK_RESULT_GRID,
                )}
              >
                <span />
                <span>Row</span>
                <span>Name</span>
                <span>Login</span>
                <span>Password</span>
              </div>
            ) : null}
            <ul className="divide-y divide-line">
              {result.results.map((r) => (
                <li key={r.row} className={cn("flex flex-wrap items-start gap-x-2.5 gap-y-1 px-3 py-2", BULK_RESULT_GRID)}>
                  {r.status === "created" ? (
                    <Check className="mt-px h-3.5 w-3.5 shrink-0 text-jade-600" aria-hidden />
                  ) : (
                    <CircleX className="mt-px h-3.5 w-3.5 shrink-0 text-coral-600" aria-hidden />
                  )}
                  <span className="w-12 shrink-0 font-semibold text-content-subtle tabular sm:w-auto">Row {r.row}</span>
                  <span className="min-w-0 flex-1 truncate text-content">{r.fullName || "(no name)"}</span>
                  {r.status === "created" ? (
                    <dl className="flex basis-full flex-wrap gap-x-4 gap-y-0.5 pl-[5.125rem] font-mono sm:col-span-2 sm:grid sm:grid-cols-[14rem_7.5rem] sm:gap-x-2.5 sm:pl-0">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <dt className="shrink-0 font-sans text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-subtle sm:sr-only">
                          Login
                        </dt>
                        <dd className="min-w-0 select-all break-all text-jade-700">{r.email || r.code}</dd>
                      </div>
                      <div className="flex min-w-0 items-baseline gap-2">
                        <dt className="shrink-0 font-sans text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-subtle sm:sr-only">
                          Password
                        </dt>
                        <dd className="min-w-0 select-all break-all font-semibold text-content">{r.initialPassword}</dd>
                      </div>
                    </dl>
                  ) : (
                    <span className="min-w-0 text-right text-coral-700 sm:col-span-2">{r.error}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          {/* A heading the import did not recognise is a column it did not
              read. Said plainly, because the costly case is a misspelt
              password column: every account would have a generated password
              while the school hands out the ones in its sheet. saffron-900
              on saffron-50: 9.3:1. */}
          {result.unrecognisedColumns && result.unrecognisedColumns.length > 0 ? (
            <p className="flex items-start gap-2.5 rounded-xl border border-saffron-200 bg-saffron-50 p-3 text-[0.75rem] leading-relaxed text-saffron-900">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                {result.unrecognisedColumns.length === 1 ? "This column was not used" : "These columns were not used"}:{" "}
                <strong className="break-words">{result.unrecognisedColumns.join(", ")}</strong>. The import reads
                fullName, email, className, section, designation, subjectSpecialization, qualification and password.
              </span>
            </p>
          ) : null}
          {skipped > 0 ? (
            <p className="flex items-start gap-2 text-[0.75rem] leading-relaxed text-content-subtle">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              Fix the skipped rows and import only those again &mdash; re-importing a row that was already created
              can create that account a second time.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
