"use client";

import { Suspense } from "react";
import { SessionGate } from "@/components/SessionGate";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { SectionWorkspace } from "@/components/reportCards/SectionWorkspace";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";

/** One section's report cards, for a teacher of the section (#188). */
function TeacherSectionPage() {
  const session = useProtectedPage("TEACHER");
  if (session.status !== "ready" || !session.user) return <SessionGate session={session} />;
  return (
    <SectionWorkspace
      role="TEACHER"
      user={session.user}
      backHref="/teacher/report-cards"
      backLabel="Report Cards"
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <TeacherSectionPage />
    </Suspense>
  );
}
