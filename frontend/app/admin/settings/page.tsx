"use client";

/**
 * School Settings (#202, 26 Oct 2026), for a school's admin: the school's
 * logo. Once added it shows in the side rail for everyone at the school,
 * and on the weekly reports and report cards, on screen and in the PDFs.
 */
import { Suspense, useEffect, useRef, useState } from "react";
import { ImageUp, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { updateStoredUser } from "@/lib/auth";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { useAuthedImage } from "@/lib/hooks/useAuthedImage";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { announceSchoolLogo, LOGO_TYPES, logoFileProblem } from "@/lib/schoolLogo";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { ReasonsBox, refusalReasons } from "@/components/assessment/common";
import { AlertBanner, LoadError } from "@/components/ui/AlertBanner";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Table";
import type { CurrentUser } from "@/types/auth";

interface SchoolSettings {
  school: { id: string; name: string; city: string | null; logoUrl: string | null };
  user: CurrentUser;
}

function Preview({ src, name, dark }: { src: string; name: string; dark?: boolean }) {
  return (
    <div className={dark ? "rounded-2xl bg-brand-gradient p-5" : "rounded-2xl bg-surface-muted p-5"}>
      <p className={dark ? "text-xs font-semibold uppercase tracking-wide text-content-inverse-muted" : "text-xs font-semibold uppercase tracking-wide text-content-subtle"}>
        {dark ? "In the App" : "On Reports"}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <span className="inline-flex items-center justify-center rounded-xl bg-white p-2 shadow-xs ring-1 ring-inset ring-black/5">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: URL of an image only signed-in people may load. */}
          <img src={src} alt="" data-school-logo="" className="h-12 w-auto max-w-[10rem] object-contain" />
        </span>
        <span className={dark ? "font-semibold text-white" : "font-display text-lg font-semibold text-content"}>{name}</span>
      </div>
    </div>
  );
}

function SettingsBody() {
  const settings = useApiQuery<SchoolSettings>("/school-settings", {}, { action: "load your school's settings" });
  const school = settings.data?.school ?? null;
  const src = useAuthedImage(school?.logoUrl);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  function applied(data: SchoolSettings, message: string) {
    updateStoredUser(data.user);
    announceSchoolLogo(data.school.logoUrl);
    settings.reload();
    setDone(message);
  }

  async function upload(file: File) {
    const problem = logoFileProblem(file);
    setDone(null);
    if (problem) {
      setReasons([problem]);
      return;
    }
    setBusy(true);
    setReasons([]);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.put<SchoolSettings>("/school-settings/logo", form);
      applied(data, "Logo saved. It now shows across the app and on your school's reports.");
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
    setDone(null);
    try {
      const { data } = await api.delete<SchoolSettings>("/school-settings/logo");
      setRemoving(false);
      applied(data, "Logo removed. Reports show the school's initials instead.");
    } catch (err) {
      setRemoving(false);
      setReasons(refusalReasons(err, "remove the logo"));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDone(null), 6000);
    return () => window.clearTimeout(timer);
  }, [done]);

  return (
    <div className="space-y-8">
      <PageHeader
        surface="masthead"
        eyebrow="School"
        title="School Settings"
        description="How your school appears across the app and on the reports it issues."
        stats={[
          { label: "School", value: settings.problem ? "—" : school ? school.name : null },
          { label: "Logo", value: settings.problem ? "—" : school ? (school.logoUrl ? "Added" : "Not Added") : null },
        ]}
      />
      {settings.problem ? <LoadError problem={settings.problem} onRetry={settings.reload} /> : null}
      {!school && !settings.problem ? <TableSkeleton label="Loading your school's settings" rows={3} /> : null}
      {school ? (
        <Card>
          <CardBody className="space-y-5 sm:p-7">
            <div>
              <h2 className="font-display text-display-sm text-content">School Logo</h2>
              <p className="mt-1 max-w-prose text-sm text-content-muted">
                Shown in the side rail for everyone at {school.name}, and on the weekly reports and report cards, on screen and
                in the PDFs. A PNG with a transparent background looks best; square or wide, at least 200 pixels across.
              </p>
            </div>

            {school.logoUrl && src ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Preview src={src} name={school.name} />
                <Preview src={src} name={school.name} dark />
              </div>
            ) : school.logoUrl ? (
              <TableSkeleton label="Loading the logo" rows={1} />
            ) : (
              <div className="rounded-2xl bg-surface-muted p-6">
                <EmptyState
                  title="No Logo Yet"
                  description="Until you add one, the reports show your school's initials in a seal."
                />
              </div>
            )}

            <ReasonsBox title="That didn't go through:" reasons={reasons} />
            {done ? <AlertBanner tone="success" message={done} /> : null}

            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={input}
                type="file"
                accept={LOGO_TYPES.join(",")}
                className="sr-only"
                tabIndex={-1}
                id="logo-file"
                aria-label="Choose the logo image"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
              <Button
                variant="primary"
                leadingIcon={<ImageUp className="h-4 w-4" aria-hidden="true" />}
                loading={busy}
                loadingLabel="Saving"
                onClick={() => input.current?.click()}
              >
                {school.logoUrl ? "Replace Logo" : "Upload Logo"}
              </Button>
              {school.logoUrl ? (
                <Button
                  variant="ghost"
                  leadingIcon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                  disabled={busy}
                  onClick={() => setRemoving(true)}
                >
                  Remove
                </Button>
              ) : null}
              <span className="text-xs text-content-subtle">PNG, JPG or WEBP, up to 3 MB.</span>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Modal
        open={removing}
        onClose={() => (busy ? undefined : setRemoving(false))}
        title="Remove the School Logo?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setRemoving(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} loadingLabel="Removing" onClick={() => void remove()}>
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-content">
          It disappears from the app and from reports downloaded from now on. You can upload it again at any time.
        </p>
      </Modal>
    </div>
  );
}

function SettingsPage() {
  const session = useProtectedPage("ADMIN");
  const { user, status } = session;
  if (status !== "ready" || !user) return <SessionGate session={session} />;
  const role = user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN";
  return (
    <RoleShell role={role} user={user} ambience="working">
      {role === "SUPER_ADMIN" ? (
        <Card className="p-6">
          <EmptyState title="One School at a Time" description="Each school's admin adds the school's logo from their own Settings." />
        </Card>
      ) : (
        <SettingsBody />
      )}
    </RoleShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <SettingsPage />
    </Suspense>
  );
}
