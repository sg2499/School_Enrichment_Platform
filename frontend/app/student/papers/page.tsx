"use client";

/** Mock Papers (#166 step 4) for a student: components/mockPapers/StudentPapers. */
import { Suspense } from "react";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { StudentPapers } from "@/components/mockPapers/StudentPapers";

function PapersPage() {
  const session = useProtectedPage("STUDENT");
  const { user, status } = session;
  if (status !== "ready" || !user) return <SessionGate session={session} />;
  return (
    <RoleShell role="STUDENT" user={user} ambience="working">
      <StudentPapers />
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
