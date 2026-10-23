"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { SessionGate } from "@/components/SessionGate";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { SchemeWorkspace } from "@/components/assessment/SchemeWorkspace";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";

/** One Assessment Scheme or template, for a school admin or Super Admin (#165). */
function AdminSchemePage() {
  const session = useProtectedPage("ADMIN");
  const { schemeId } = useParams<{ schemeId: string }>();
  if (session.status !== "ready" || !session.user) return <SessionGate session={session} />;
  return (
    <SchemeWorkspace
      schemeId={schemeId}
      backHref="/admin/assessment"
      backLabel="Assessment Schemes"
      role={session.user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN"}
      user={session.user}
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <AdminSchemePage />
    </Suspense>
  );
}
