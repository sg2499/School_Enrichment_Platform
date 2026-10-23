"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { SessionGate } from "@/components/SessionGate";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { SchemeWorkspace } from "@/components/assessment/SchemeWorkspace";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";

/** A scheme's marks and results, for a teacher (#165). */
function TeacherSchemePage() {
  const session = useProtectedPage("TEACHER");
  const { schemeId } = useParams<{ schemeId: string }>();
  if (session.status !== "ready" || !session.user) return <SessionGate session={session} />;
  return (
    <SchemeWorkspace
      schemeId={schemeId}
      backHref="/teacher/marks"
      backLabel={"Marks & Results"}
      defaultView="marks"
      role="TEACHER"
      user={session.user}
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <TeacherSchemePage />
    </Suspense>
  );
}
