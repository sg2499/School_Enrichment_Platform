"use client";

import { Suspense } from "react";
import { SessionGate } from "@/components/SessionGate";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { ReportCardsHome } from "@/components/reportCards/ReportCardsHome";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";

/** Report Cards for a school Admin or Super Admin (#188). */
function AdminReportCardsPage() {
  const session = useProtectedPage("ADMIN");
  if (session.status !== "ready" || !session.user) return <SessionGate session={session} />;
  return (
    <ReportCardsHome
      role={session.user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN"}
      user={session.user}
      sectionHref="/admin/report-cards/section"
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <AdminReportCardsPage />
    </Suspense>
  );
}
