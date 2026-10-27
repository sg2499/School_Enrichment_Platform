"use client";

/** Mock Papers (#166 step 4) for a student: components/mockPapers/SitPaper. */
import { Suspense } from "react";
import { useParams } from "next/navigation";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { SitPaper } from "@/components/mockPapers/SitPaper";

function PapersPage() {
  const session = useProtectedPage("STUDENT");
  const { paperId } = useParams<{ paperId: string }>();
  const { user, status } = session;
  if (status !== "ready" || !user) return <SessionGate session={session} />;
  return (
    <RoleShell role="STUDENT" user={user} ambience="working">
      <SitPaper paperId={paperId} />
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
