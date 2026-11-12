"use client";

/** Reports (#224) for the Super Admin: components/overview/UsageReport. */
import { Suspense } from "react";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { UsageReport } from "@/components/overview/UsageReport";

function UsageReportPage() {
  const session = useProtectedPage("ADMIN");
  const { user, status } = session;
  if (status !== "ready" || !user) return <SessionGate session={session} />;
  return (
    <RoleShell role={user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN"} user={user} ambience="working">
      {user.role === "SUPER_ADMIN" ? (
        <UsageReport />
      ) : (
        <Card className="p-6">
          <EmptyState
            title="For the Platform Team"
            description="This report compares schools with each other. Your school's own reports are under Report Cards, Weekly Reports and Class Analytics."
          />
        </Card>
      )}
    </RoleShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <UsageReportPage />
    </Suspense>
  );
}
