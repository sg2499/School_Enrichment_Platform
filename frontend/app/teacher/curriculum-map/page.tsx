"use client";

/** Curriculum Map (#224) for a teacher: components/overview/CurriculumMap. */
import { Suspense } from "react";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { CurriculumMap } from "@/components/overview/CurriculumMap";

function Screen() {
  const session = useProtectedPage("TEACHER");
  const { user, status } = session;
  if (status !== "ready" || !user) return <SessionGate session={session} />;
  return (
    <RoleShell role="TEACHER" user={user} ambience="working">
      <CurriculumMap />
    </RoleShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Screen />
    </Suspense>
  );
}
