"use client";

/** Weekly Reports (#187) for a school admin: components/weeklyReports/WeeklyReports. */
import { Suspense } from "react";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { WeeklyReports } from "@/components/weeklyReports/WeeklyReports";

function WeeklyReportsPage() {
  const session = useProtectedPage("ADMIN");
  const { user, status } = session;
  if (status !== "ready" || !user) return <SessionGate session={session} />;
  return (
    <RoleShell role={user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN"} user={user} ambience="working">
      <WeeklyReports role={user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN"} />
    </RoleShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <WeeklyReportsPage />
    </Suspense>
  );
}
