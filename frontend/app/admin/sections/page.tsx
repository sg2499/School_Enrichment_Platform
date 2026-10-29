"use client";

/** Classes & Sections (#210) for a school's admin: components/school/ClassesAndSections. */
import { Suspense } from "react";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { ClassesAndSections } from "@/components/school/ClassesAndSections";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";

function SectionsPage() {
  const session = useProtectedPage("ADMIN");
  const { user, status } = session;
  if (status !== "ready" || !user) return <SessionGate session={session} />;
  const role = user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN";
  return (
    <RoleShell role={role} user={user} ambience="working">
      {role === "SUPER_ADMIN" ? (
        <EmptyState
          title="A School's Own Page"
          description="Classes & Sections is where a school's admin sets up its teachers and students. Sign in as that school's admin to use it."
        />
      ) : (
        <ClassesAndSections />
      )}
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
