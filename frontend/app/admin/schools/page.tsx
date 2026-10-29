"use client";

/**
 * Schools (#211, 29 Oct 2026), for the Super Admin: every school on Krama
 * with its board, place, people and status, and Add School, which makes a
 * school and its first admin together. Each school opens to its own page
 * (./[id]) to change its details, add admins, set its logo, or suspend it.
 */
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { filterSchools, lastActiveLabel, schoolPlace, type SchoolFilter } from "@/lib/schools";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { ReasonsBox, refusalReasons } from "@/components/assessment/common";
import { AdminCredentialsNotice, SchoolFieldsForm, StatusBadge, type SchoolFields } from "@/components/schools/SchoolParts";
import { LoadError } from "@/components/ui/AlertBanner";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextField } from "@/components/ui/Field";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { BoardOption, SchoolCreated, SchoolsList } from "@/types/schools";

const BLANK: SchoolFields = { name: "", board: "", city: "", state: "" };

function AddSchool({
  open,
  boards,
  onClose,
  onCreated,
}: {
  open: boolean;
  boards: BoardOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<SchoolFields>(BLANK);
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [made, setMade] = useState<SchoolCreated | null>(null);

  function close() {
    if (busy) return;
    setFields(BLANK);
    setAdminName("");
    setAdminEmail("");
    setReasons([]);
    setMade(null);
    onClose();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setReasons([]);
    try {
      const { data } = await api.post<SchoolCreated>("/schools-admin", {
        ...fields,
        adminFullName: adminName,
        adminEmail,
      });
      setMade(data);
      onCreated();
    } catch (err) {
      setReasons(refusalReasons(err, "add the school"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={made ? `${made.school.name} Is on Krama` : "Add a School"}
      footer={
        made ? (
          <>
            <Button type="button" variant="ghost" onClick={close}>
              Done
            </Button>
            <Button type="button" onClick={() => router.push(`/admin/schools/${made.school.id}`)}>
              Open the School
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="ghost" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form="add-school" loading={busy} loadingLabel="Adding">
              Add School
            </Button>
          </>
        )
      }
    >
      {made ? (
        <AdminCredentialsNotice admin={made.admin} schoolName={made.school.name} />
      ) : (
        <form id="add-school" className="space-y-6" onSubmit={submit}>
          <section className="space-y-3">
            <h3 className="font-semibold text-content">The School</h3>
            <SchoolFieldsForm value={fields} onChange={setFields} boards={boards} disabled={busy} />
          </section>
          <section className="space-y-3">
            <h3 className="font-semibold text-content">Its First Admin</h3>
            <p className="text-sm text-content-muted">
              The person who will run the school on Krama: add its teachers and students, and print their sign-in slips. More admins can be
              added later.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Full Name" value={adminName} onChange={(e) => setAdminName(e.target.value)} disabled={busy} required />
              <TextField
                label="Email"
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                disabled={busy}
                required
                hint="Admins sign in with their email."
              />
            </div>
          </section>
          <ReasonsBox title="The school wasn't added:" reasons={reasons} />
        </form>
      )}
    </Modal>
  );
}

function SchoolsBody() {
  const list = useApiQuery<SchoolsList>("/schools-admin", {}, { action: "load the schools" });
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SchoolFilter>("all");
  const [adding, setAdding] = useState(false);
  const schools = useMemo(() => list.data?.schools ?? [], [list.data]);
  const shown = useMemo(() => filterSchools(schools, query, status), [schools, query, status]);
  const active = schools.filter((s) => s.isActive);
  const students = active.reduce((n, s) => n + s.counts.students, 0);
  const noAdmin = active.filter((s) => s.counts.admins === 0).length;
  const value = (n: number) => (list.problem ? "—" : list.data ? n : null);

  return (
    <div className="space-y-6">
      <PageHeader
        surface="masthead"
        eyebrow="Platform"
        title="Schools"
        description="Every school on Krama: add a school with its first admin, change its details, and suspend or restore it."
        stats={[
          { label: "Schools", value: value(schools.length), hint: list.data ? `${active.length} active` : undefined },
          {
            label: "Suspended",
            value: value(schools.length - active.length),
            hint: list.data ? (schools.length > active.length ? "Nobody there can sign in" : "None") : undefined,
          },
          { label: "Students", value: value(students), hint: list.data ? "At active schools" : undefined },
          {
            label: "No Active Admin",
            value: value(noAdmin),
            tone: noAdmin ? "attention" : undefined,
            hint: list.data ? (noAdmin ? "Nobody can run these: add an admin" : "Every school has one") : undefined,
          },
        ]}
      >
        <div className="flex">
          <Button type="button" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)} disabled={!list.data}>
            Add School
          </Button>
        </div>
      </PageHeader>

      {list.problem ? <LoadError problem={list.problem} onRetry={list.reload} /> : null}
      {!list.data && !list.problem ? <TableSkeleton label="Loading the schools" rows={4} /> : null}

      {list.data ? (
        <Card>
          <CardHeader>
            <CardTitle>All Schools</CardTitle>
            <CardDescription>Open a school to change its details, add admins, set its logo or suspend it.</CardDescription>
          </CardHeader>
          <CardBody className="space-y-4">
            {schools.length === 0 ? (
              <EmptyState
                illustration={<Building2 className="h-10 w-10 text-content-subtle" aria-hidden="true" />}
                title="No Schools Yet"
                description="Add the first school and its admin to get started."
              />
            ) : (
              <>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <SearchInput
                    value={query}
                    onSearch={setQuery}
                    label="Search schools"
                    placeholder="Name, board, city or state"
                    delayMs={150}
                    className="w-full sm:w-80"
                  />
                  <SegmentedControl
                    label="Which schools"
                    value={status}
                    onChange={setStatus}
                    segments={[
                      { key: "all", label: "All" },
                      { key: "active", label: "Active" },
                      { key: "suspended", label: "Suspended" },
                    ]}
                  />
                </div>
                {shown.length === 0 ? (
                  <p className="text-sm text-content-muted">No school matches that.</p>
                ) : (
                  <Table caption="Schools" minWidth="52rem">
                    <THead>
                      <TH>School</TH>
                      <TH>Board</TH>
                      <TH align="right">Admins</TH>
                      <TH align="right">Teachers</TH>
                      <TH align="right">Students</TH>
                      <TH align="right">Not Signed In</TH>
                      <TH>Last Active</TH>
                      <TH>Status</TH>
                    </THead>
                    <TBody>
                      {shown.map((s) => (
                        <TR key={s.id}>
                          <TD>
                            <Link href={`/admin/schools/${s.id}`} className="font-semibold text-content underline-offset-2 hover:underline">
                              {s.name}
                            </Link>
                            {schoolPlace(s) ? <span className="block text-xs text-content-subtle">{schoolPlace(s)}</span> : null}
                          </TD>
                          <TD>{s.board ?? <span className="text-coral-700">Not set</span>}</TD>
                          <TD align="right">
                            {s.counts.admins === 0 ? <span className="font-semibold text-coral-700">0</span> : s.counts.admins}
                          </TD>
                          <TD align="right">{s.counts.teachers}</TD>
                          <TD align="right">{s.counts.students}</TD>
                          <TD align="right">{s.counts.notSignedIn}</TD>
                          <TD>{lastActiveLabel(s.counts.lastActiveAt)}</TD>
                          <TD>
                            <StatusBadge active={s.isActive} />
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </>
            )}
          </CardBody>
        </Card>
      ) : null}

      <AddSchool open={adding} boards={list.data?.boards ?? []} onClose={() => setAdding(false)} onCreated={list.reload} />
    </div>
  );
}

function SchoolsPage() {
  const session = useProtectedPage("ADMIN");
  const { user, status } = session;
  if (status !== "ready" || !user) return <SessionGate session={session} />;
  if (user.role !== "SUPER_ADMIN") {
    return (
      <RoleShell role="ADMIN" user={user} ambience="working">
        <Card className="p-6">
          <EmptyState title="For the Krama Team" description="Schools are managed by the Krama team. Your own school is under School." />
        </Card>
      </RoleShell>
    );
  }
  return (
    <RoleShell role="SUPER_ADMIN" user={user} ambience="working">
      <SchoolsBody />
    </RoleShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <SchoolsPage />
    </Suspense>
  );
}
