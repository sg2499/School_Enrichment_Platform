"use client";

/** Mock Papers (#166 step 3) for a school admin: components/mockPapers/MockPapers.
 *  The Super Admin's "Papers & Mocks" (#224) is the pattern counts: components/overview/PatternOverview. */
import { Suspense } from "react";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { MockPapers } from "@/components/mockPapers/MockPapers";
import { PatternOverview } from "@/components/overview/PatternOverview";

function PapersPage() {
  const session = useProtectedPage("ADMIN");
  const { user, status } = session;
  if (status !== "ready" || !user) return <SessionGate session={session} />;
  return (
    <RoleShell role={user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN"} user={user} ambience="working">
      {user.role === "SUPER_ADMIN" ? <PatternOverview /> : <MockPapers role="ADMIN" />}
    </RoleShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <PapersPage />
    </Suspense>
  );
}
