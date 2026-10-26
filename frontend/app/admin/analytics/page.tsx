"use client";

/** Class Analytics (#186) for a admin: components/analytics/ClassAnalytics. */
import { Suspense } from "react";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { ClassAnalytics } from "@/components/analytics/ClassAnalytics";

function AnalyticsPage() {
  const session = useProtectedPage("ADMIN");
  const { user, status } = session;
  if (status !== "ready" || !user) return <SessionGate session={session} />;
  return (
    <RoleShell role={user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN"} user={user} ambience="working">
      <ClassAnalytics role={user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN"} />
    </RoleShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <AnalyticsPage />
    </Suspense>
  );
}
