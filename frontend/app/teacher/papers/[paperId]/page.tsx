"use client";

/** Mock Papers (#166 step 3) for a teacher, one paper: components/mockPapers/PaperView. */
import { Suspense } from "react";
import { useParams } from "next/navigation";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { PaperView } from "@/components/mockPapers/PaperView";

function PapersPage() {
  const session = useProtectedPage("TEACHER");
  const { paperId } = useParams<{ paperId: string }>();
  const { user, status } = session;
  if (status !== "ready" || !user) return <SessionGate session={session} />;
  return (
    <RoleShell role={"TEACHER"} user={user} ambience="working">
      <PaperView paperId={paperId} role="TEACHER" backHref="/teacher/papers" />
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
