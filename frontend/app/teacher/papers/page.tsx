"use client";

/** Mock Papers (#166 step 3) for a teacher: components/mockPapers/MockPapers. */
import { Suspense } from "react";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { MockPapers } from "@/components/mockPapers/MockPapers";

function PapersPage() {
  const session = useProtectedPage("TEACHER");
  const { user, status } = session;
  if (status !== "ready" || !user) return <SessionGate session={session} />;
  return (
    <RoleShell role={"TEACHER"} user={user} ambience="working">
      <MockPapers role="TEACHER" />
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
