"use client";

import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";

export default function StudentDashboardPage() {
  const { user, status } = useProtectedPage("STUDENT");

  if (status !== "ready") {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Loading...</div>;
  }

  return (
    <RoleShell role="STUDENT" user={user}>
      <h2 className="text-xl font-semibold text-slate-900">Welcome, {user?.fullName}</h2>
      <p className="mt-2 text-sm text-slate-500">
        Your lessons and practice will appear here once your school&apos;s curriculum is loaded.
      </p>
    </RoleShell>
  );
}
