"use client";

/**
 * Classes & Sections (#210) for a school's admin: components/school/ClassesAndSections.
 * The Super Admin (#211) chooses the school first, here or from a school's own
 * page (/admin/sections?school=<id>), and then has the same page for it.
 */
import { Suspense, useEffect, useState } from "react";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { useApiQuery } from "@/lib/hooks/useApiQuery";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { ClassesAndSections } from "@/components/school/ClassesAndSections";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { MastheadSelect } from "@/components/ui/MastheadSelect";
import { PageHeader } from "@/components/ui/PageHeader";
import type { SchoolOption } from "@/types/curriculum";

function PlatformSections() {
  const list = useApiQuery<{ schools: SchoolOption[] }>(
    "/curriculum-admin/schools",
    { includeSuspended: "true" },
    { action: "load the list of schools" },
  );
  const schools = list.data?.schools ?? null;
  const [schoolId, setSchoolId] = useState("");
  useEffect(() => {
    if (!schools || schoolId) return;
    const wanted = new URLSearchParams(window.location.search).get("school");
    if (wanted && schools.some((s) => s.id === wanted)) setSchoolId(wanted);
  }, [schools, schoolId]);

  const picker = (
    <MastheadSelect
      label="School"
      helper={schoolId ? "Everything on this page is this school's. Choose another to switch." : "Choose a school to open its classes."}
      value={schoolId}
      onChange={(event) => setSchoolId(event.target.value)}
      disabled={!schools}
      error={list.problem ? list.problem.message : null}
    >
      <option value="" disabled>
        {!schools ? "Loading schools…" : schools.length === 0 ? "No schools yet" : "Choose a school"}
      </option>
      {(schools ?? []).map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
          {s.board ? ` · ${s.board}` : ""}
          {s.city ? ` · ${s.city}` : ""}
          {s.isActive === false ? " (Suspended)" : ""}
        </option>
      ))}
    </MastheadSelect>
  );

  if (schoolId) return <ClassesAndSections key={schoolId} schoolId={schoolId} picker={picker} />;
  return (
    <div className="space-y-6">
      <PageHeader
        surface="masthead"
        eyebrow="Platform"
        title="Classes & Sections"
        description="Set up a school's teachers and students from one workbook, print their sign-in slips, and see who is in each section."
      >
        {picker}
      </PageHeader>
      <Card className="p-6">
        <EmptyState title="Choose a School" description="Choose a school above to open its classes and sections." />
      </Card>
    </div>
  );
}

function SectionsPage() {
  const session = useProtectedPage("ADMIN");
  const { user, status } = session;
  if (status !== "ready" || !user) return <SessionGate session={session} />;
  const role = user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN";
  return (
    <RoleShell role={role} user={user} ambience="working">
      {role === "SUPER_ADMIN" ? <PlatformSections /> : <ClassesAndSections />}
    </RoleShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <SectionsPage />
    </Suspense>
  );
}
