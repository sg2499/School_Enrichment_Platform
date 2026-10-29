"use client";

/**
 * One school, for the Super Admin (#211, 29 Oct 2026): its details (name,
 * board, city, state) to change, its admins (add one, see who has signed
 * in), its logo, the way into its People and Classes & Sections, and
 * suspending or restoring it.
 */
import { Suspense, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ImageUp, PauseCircle, PlayCircle, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { useAuthedImage } from "@/lib/hooks/useAuthedImage";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { LOGO_TYPES, logoFileProblem } from "@/lib/schoolLogo";
import { lastActiveLabel, sameName, schoolPlace } from "@/lib/schools";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { ReasonsBox, refusalReasons } from "@/components/assessment/common";
import { AdminCredentialsNotice, SchoolFieldsForm, StatusBadge, type SchoolFields } from "@/components/schools/SchoolParts";
import { AlertBanner, LoadError } from "@/components/ui/AlertBanner";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextField } from "@/components/ui/Field";
import { InlineLink } from "@/components/ui/InlineLink";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, TableSkeleton, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { AdminCredentials, SchoolDetail } from "@/types/schools";

type Detail = ReturnType<typeof useApiQuery<SchoolDetail>>;

function fieldsOf(detail: SchoolDetail): SchoolFields {
  const s = detail.school;
  return { name: s.name, board: s.board ?? "", city: s.city ?? "", state: s.state ?? "" };
}

function DetailsCard({ detail, onSaved }: { detail: SchoolDetail; onSaved: (next: SchoolDetail) => void }) {
  const [fields, setFields] = useState<SchoolFields>(() => fieldsOf(detail));
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const original = fieldsOf(detail);
  const changed = (Object.keys(fields) as (keyof SchoolFields)[]).filter((k) => fields[k].trim() !== original[k]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || changed.length === 0) return;
    setBusy(true);
    setReasons([]);
    setSaved(false);
    try {
      const body = Object.fromEntries(changed.map((k) => [k, fields[k]]));
      const { data } = await api.patch<SchoolDetail>(`/schools-admin/${detail.school.id}`, body);
      setFields(fieldsOf(data));
      onSaved(data);
      setSaved(true);
    } catch (err) {
      setReasons(refusalReasons(err, "save the school's details"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>School Details</CardTitle>
        <CardDescription>The board decides which courses the school&apos;s teachers and the School Setup workbook can use.</CardDescription>
      </CardHeader>
      <CardBody>
        <form className="space-y-4" onSubmit={save}>
          {!detail.school.board ? (
            <AlertBanner
              tone="info"
              message="This school has no board yet, so its School Setup workbook can't be imported. Choose one below."
            />
          ) : null}
          <SchoolFieldsForm value={fields} onChange={setFields} boards={detail.boards} disabled={busy} />
          <ReasonsBox title="That wasn't saved:" reasons={reasons} />
          {saved && changed.length === 0 ? <AlertBanner tone="success" message="Saved." /> : null}
          <div className="flex gap-2">
            <Button type="submit" loading={busy} loadingLabel="Saving" disabled={changed.length === 0}>
              Save Details
            </Button>
            {changed.length ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setFields(original)}>
                Undo Changes
              </Button>
            ) : null}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function AdminsCard({ detail, onChanged }: { detail: SchoolDetail; onChanged: () => void }) {
  const school = detail.school;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [made, setMade] = useState<AdminCredentials | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setReasons([]);
    try {
      const { data } = await api.post<{ fullName: string; email: string; initialPassword: string }>("/roster/people", {
        role: "ADMIN",
        fullName: name,
        email,
        schoolId: school.id,
      });
      setMade({ fullName: data.fullName, email: data.email, initialPassword: data.initialPassword });
      setAdding(false);
      setName("");
      setEmail("");
      onChanged();
    } catch (err) {
      setReasons(refusalReasons(err, "add the admin"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>School Admins</CardTitle>
        <CardDescription>
          The people who run {school.name} on Krama. To give one a new password or deactivate them, use{" "}
          <InlineLink href={`/admin/people?school=${school.id}`}>People</InlineLink>.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-4">
        {detail.admins.length === 0 ? (
          <AlertBanner tone="info" message="This school has no admin, so nobody can run it. Add one." />
        ) : (
          <Table caption="School admins" minWidth="36rem">
            <THead>
              <TH>Name</TH>
              <TH>Email</TH>
              <TH>Signed In</TH>
              <TH>Last Active</TH>
            </THead>
            <TBody>
              {detail.admins.map((a) => (
                <TR key={a.id}>
                  <TD className="font-semibold text-content">
                    {a.fullName}{" "}
                    {!a.isActive ? (
                      <Badge tone="neutral" size="sm">
                        Inactive
                      </Badge>
                    ) : null}
                  </TD>
                  <TD className="break-all">{a.email}</TD>
                  <TD>{a.signedIn ? (a.twoFactor ? "Yes, with two-factor" : "Yes") : "Not yet"}</TD>
                  <TD>{lastActiveLabel(a.lastActiveAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {made ? <AdminCredentialsNotice admin={made} schoolName={school.name} onDone={() => setMade(null)} /> : null}
        {adding ? (
          <form className="space-y-3 rounded-2xl border border-line p-4" onSubmit={add}>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Full Name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} required />
              <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} required />
            </div>
            <ReasonsBox title="The admin wasn't added:" reasons={reasons} />
            <div className="flex gap-2">
              <Button type="submit" loading={busy} loadingLabel="Adding">
                Add Admin
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button
            type="button"
            variant="secondary"
            leadingIcon={<Plus className="h-4 w-4" />}
            onClick={() => {
              setMade(null);
              setReasons([]);
              setAdding(true);
            }}
          >
            Add an Admin
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

function LogoCard({ detail, onSaved }: { detail: SchoolDetail; onSaved: (next: SchoolDetail) => void }) {
  const school = detail.school;
  const src = useAuthedImage(school.logoUrl);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);

  async function upload(file: File) {
    const problem = logoFileProblem(file);
    if (problem) {
      setReasons([problem]);
      return;
    }
    setBusy(true);
    setReasons([]);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.put<SchoolDetail>(`/schools-admin/${school.id}/logo`, form);
      onSaved(data);
    } catch (err) {
      setReasons(refusalReasons(err, "save the logo"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    setReasons([]);
    try {
      const { data } = await api.delete<SchoolDetail>(`/schools-admin/${school.id}/logo`);
      onSaved(data);
    } catch (err) {
      setReasons(refusalReasons(err, "remove the logo"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo</CardTitle>
        <CardDescription>
          Shown to everyone at the school, and on its weekly reports and report cards. Its admin can change it too.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-4">
        {school.logoUrl && src ? (
          <span className="inline-flex rounded-xl bg-white p-3 shadow-xs ring-1 ring-inset ring-black/5">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: URL of an image only signed-in people may load. */}
            <img src={src} alt={`${school.name} logo`} className="h-14 w-auto max-w-[12rem] object-contain" />
          </span>
        ) : (
          <p className="text-sm text-content-muted">
            {school.logoUrl ? "Loading the logo…" : "No logo yet: reports show the school's initials."}
          </p>
        )}
        <ReasonsBox title="That didn't go through:" reasons={reasons} />
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            id="school-logo-file"
            type="file"
            accept={LOGO_TYPES.join(",")}
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose the logo image"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            leadingIcon={<ImageUp className="h-4 w-4" />}
            loading={busy}
            loadingLabel="Saving"
            onClick={() => input.current?.click()}
          >
            {school.logoUrl ? "Replace Logo" : "Upload Logo"}
          </Button>
          {school.logoUrl ? (
            <Button
              type="button"
              variant="ghost"
              leadingIcon={<Trash2 className="h-4 w-4" />}
              disabled={busy}
              onClick={() => void remove()}
            >
              Remove
            </Button>
          ) : null}
          <span className="text-xs text-content-subtle">PNG, JPG or WEBP, up to 3 MB.</span>
        </div>
      </CardBody>
    </Card>
  );
}

function StatusCard({ detail, onSaved }: { detail: SchoolDetail; onSaved: (next: SchoolDetail) => void }) {
  const school = detail.school;
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const matches = sameName(typed, school.name);

  async function setActive(active: boolean) {
    setBusy(true);
    setReasons([]);
    try {
      const { data } = await api.post<SchoolDetail>(`/schools-admin/${school.id}/status`, {
        active,
        confirmName: active ? undefined : typed,
      });
      onSaved(data);
      setAsking(false);
      setTyped("");
    } catch (err) {
      setReasons(refusalReasons(err, active ? "restore the school" : "suspend the school"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={school.isActive ? undefined : "border-coral-300"}>
      <CardHeader>
        <CardTitle>{school.isActive ? "Suspend the School" : "This School Is Suspended"}</CardTitle>
        <CardDescription>
          {school.isActive
            ? "Stops everyone at the school, admins, teachers and students, from signing in, at once. Nothing is deleted, and restoring lets them back in."
            : "Nobody at the school can sign in. Its teachers, students and their work are kept. Restore it to let them back in."}
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-3">
        {!asking ? <ReasonsBox title="That didn't go through:" reasons={reasons} /> : null}
        {school.isActive ? (
          <Button type="button" variant="danger" leadingIcon={<PauseCircle className="h-4 w-4" />} onClick={() => setAsking(true)}>
            Suspend School
          </Button>
        ) : (
          <Button
            type="button"
            leadingIcon={<PlayCircle className="h-4 w-4" />}
            loading={busy}
            loadingLabel="Restoring"
            onClick={() => void setActive(true)}
          >
            Restore School
          </Button>
        )}
      </CardBody>
      <Modal
        open={asking}
        onClose={() => (busy ? undefined : setAsking(false))}
        size="sm"
        title={`Suspend ${school.name}?`}
        footer={
          <>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={!matches}
              loading={busy}
              loadingLabel="Suspending"
              onClick={() => void setActive(false)}
            >
              Suspend School
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-content">
          <p>
            Everyone at {school.name} is signed out and can&apos;t sign in until you restore it. To confirm, type the school&apos;s name.
          </p>
          <TextField label="School Name" value={typed} onChange={(e) => setTyped(e.target.value)} disabled={busy} autoComplete="off" />
          <ReasonsBox title="That didn't go through:" reasons={reasons} />
        </div>
      </Modal>
    </Card>
  );
}

function SchoolBody({ id }: { id: string }) {
  const view: Detail = useApiQuery<SchoolDetail>(`/schools-admin/${id}`, {}, { action: "load this school" });
  const [detail, setDetail] = useState<SchoolDetail | null>(null);
  useEffect(() => {
    if (view.data) setDetail(view.data);
  }, [view.data]);

  if (view.problem && !detail) return <LoadError problem={view.problem} onRetry={view.reload} />;
  if (!detail) return <TableSkeleton label="Loading the school" rows={5} />;
  const s = detail.school;
  const c = s.counts;
  return (
    <div className="space-y-6">
      <InlineLink href="/admin/schools" direction="back" size="sm">
        All Schools
      </InlineLink>
      <PageHeader
        surface="masthead"
        eyebrow={[s.board ?? "No Board", schoolPlace(s)].filter(Boolean).join(" · ")}
        title={s.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge active={s.isActive} /> On Krama since{" "}
            {s.createdAt ? new Date(s.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "—"}
          </span>
        }
        stats={[
          { label: "Admins", value: c.admins, tone: c.admins === 0 ? "attention" : undefined },
          { label: "Teachers", value: c.teachers },
          { label: "Students", value: c.students, hint: `${c.sections} ${c.sections === 1 ? "section" : "sections"}` },
          {
            label: "Not Signed In",
            value: c.notSignedIn,
            tone: c.notSignedIn ? "attention" : undefined,
            hint: `Last active: ${lastActiveLabel(c.lastActiveAt)}`,
          },
        ]}
      />
      <div className="flex flex-wrap gap-3 text-sm">
        <InlineLink href={`/admin/people?school=${s.id}`}>People at {s.name}</InlineLink>
        <InlineLink href={`/admin/sections?school=${s.id}`}>Classes &amp; Sections</InlineLink>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <DetailsCard detail={detail} onSaved={setDetail} />
        <div className="space-y-6">
          <LogoCard detail={detail} onSaved={setDetail} />
          <StatusCard detail={detail} onSaved={setDetail} />
        </div>
      </div>
      <AdminsCard detail={detail} onChanged={view.reload} />
    </div>
  );
}

function SchoolPage() {
  const params = useParams<{ id: string }>();
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
      <SchoolBody id={params.id} />
    </RoleShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <SchoolPage />
    </Suspense>
  );
}
