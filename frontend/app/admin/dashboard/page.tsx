"use client";

import { RoleShell } from "@/components/RoleShell";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";

export default function AdminDashboardPage() {
  const { user, status } = useProtectedPage("ADMIN");

  if (status !== "ready") {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Loading...</div>;
  }

  return (
    <RoleShell role="ADMIN" user={user}>
      <h2 className="text-xl font-semibold text-slate-900">Welcome, {user?.fullName}</h2>
      <p className="mt-2 text-sm text-slate-500">
        School setup, curriculum management, and reporting tools will appear here as they&apos;re built out.
      </p>
    </RoleShell>
  );
}
