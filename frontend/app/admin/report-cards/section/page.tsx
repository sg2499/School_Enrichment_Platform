"use client";

import { Suspense } from "react";
import { SessionGate } from "@/components/SessionGate";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { SectionWorkspace } from "@/components/reportCards/SectionWorkspace";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";

/** One section's report cards, for a school Admin or Super Admin (#188). */
function AdminSectionPage() {
  const session = useProtectedPage("ADMIN");
  if (session.status !== "ready" || !session.user) return <SessionGate session={session} />;
  return (
    <SectionWorkspace
      role={session.user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN"}
      user={session.user}
      backHref="/admin/report-cards"
      backLabel="Report Cards"
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <AdminSectionPage />
    </Suspense>
  );
}
