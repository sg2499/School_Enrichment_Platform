"use client";

/** Mock Papers (#166 step 3) for a school admin, one paper: components/mockPapers/PaperView. */
import { Suspense } from "react";
import { useParams } from "next/navigation";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { PaperView } from "@/components/mockPapers/PaperView";

function PapersPage() {
  const session = useProtectedPage("ADMIN");
  const { paperId } = useParams<{ paperId: string }>();
  const { user, status } = session;
  if (status !== "ready" || !user) return <SessionGate session={session} />;
  return (
    <RoleShell role={user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN"} user={user} ambience="working">
      <PaperView paperId={paperId} role="ADMIN" backHref="/admin/papers" />
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
