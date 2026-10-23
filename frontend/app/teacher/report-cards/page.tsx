"use client";

import { Suspense } from "react";
import { SessionGate } from "@/components/SessionGate";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { ReportCardsHome } from "@/components/reportCards/ReportCardsHome";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";

/** Report Cards for a teacher: their own sections (#188). */
function TeacherReportCardsPage() {
  const session = useProtectedPage("TEACHER");
  if (session.status !== "ready" || !session.user) return <SessionGate session={session} />;
  return (
    <ReportCardsHome
      role="TEACHER"
      user={session.user}
      sectionHref="/teacher/report-cards/section"
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <TeacherReportCardsPage />
    </Suspense>
  );
}
