"use client";

import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";

export default function TeacherDashboardPage() {
  const { user, status } = useProtectedPage("TEACHER");

  if (status !== "ready") {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Loading...</div>;
  }

  return (
    <RoleShell role="TEACHER" user={user}>
      <h2 className="text-xl font-semibold text-slate-900">Welcome, {user?.fullName}</h2>
      <p className="mt-2 text-sm text-slate-500">
        Your classes and assignment tools will appear here once curriculum content is loaded.
      </p>
    </RoleShell>
  );
}
