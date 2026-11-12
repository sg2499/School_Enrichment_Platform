"use client";

/** My Classes (#224) for a teacher: components/overview/MyClasses. */
import { Suspense } from "react";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { MyClasses } from "@/components/overview/MyClasses";

function Screen() {
  const session = useProtectedPage("TEACHER");
  const { user, status } = session;
  if (status !== "ready" || !user) return <SessionGate session={session} />;
  return (
    <RoleShell role="TEACHER" user={user} ambience="working">
      <MyClasses />
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
