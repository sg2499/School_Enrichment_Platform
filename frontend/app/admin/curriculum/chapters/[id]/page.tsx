"use client";

/** One chapter in Curriculum Studio, for the Super Admin (#212): components/curriculum/ChapterWorkspace. */
import { Suspense } from "react";
import { useParams } from "next/navigation";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { ChapterWorkspace } from "@/components/curriculum/ChapterWorkspace";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";

function ChapterPage() {
  const { id } = useParams<{ id: string }>();
  const session = useProtectedPage("ADMIN");
  const { user, status } = session;
  if (status !== "ready" || !user) return <SessionGate session={session} />;
  if (user.role !== "SUPER_ADMIN") {
    return (
      <RoleShell role="ADMIN" user={user} ambience="working">
        <Card className="p-6">
          <EmptyState
            title="For the Krama Team"
            description="Chapters are reviewed and published by the Krama team. Your calendar is in Curriculum Studio."
          />
        </Card>
      </RoleShell>
    );
  }
  return (
    <RoleShell role="SUPER_ADMIN" user={user} ambience="working">
      <ChapterWorkspace chapterId={id} />
    </RoleShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <ChapterPage />
    </Suspense>
  );
}
