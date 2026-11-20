"use client";

/** Chapter Preview for a school admin and the Super Admin: components/overview/ChapterPreview. */
import { Suspense } from "react";
import { useParams } from "next/navigation";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { RoleShell } from "@/components/RoleShell";
import { SessionGate } from "@/components/SessionGate";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { ChapterPreview } from "@/components/overview/ChapterPreview";

function ChapterPreviewPage() {
  const session = useProtectedPage("ADMIN");
  const { chapterId } = useParams<{ chapterId: string }>();
  const { user, status } = session;
  if (status !== "ready" || !user) return <SessionGate session={session} />;
  return (
    <RoleShell role={user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN"} user={user} ambience="working">
      <ChapterPreview chapterId={chapterId} backHref="/admin/question-bank" />
    </RoleShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <ChapterPreviewPage />
    </Suspense>
  );
}
