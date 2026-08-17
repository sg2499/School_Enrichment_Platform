"use client";

import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { clearSession } from "@/lib/auth";
import type { CurrentUser, UserRole } from "@/types/auth";

const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "Admin",
  SUPER_ADMIN: "Admin",
  TEACHER: "Teacher",
  STUDENT: "Student",
};

// Structural reuse of MathPath's role-shell pattern (Phase 0 audit,
// "Refactor" bucket: three-role shell, navigation/tabs convention retained,
// content/route labels replaced). Deliberately placeholder navigation only
// -- Phase 1's exit gate is "login, roles, and deployment work end to
// end," not real curriculum screens. Real per-role navigation gets built
// out starting Phase 2 (Curriculum Studio) once there's real content to
// navigate to.
export function RoleShell({
  role,
  user,
  children,
}: {
  role: UserRole;
  user: CurrentUser | null;
  children: React.ReactNode;
}) {
  const router = useRouter();

  async function handleLogout() {
    try {
      await api.post("/auth/logout");
    } finally {
      clearSession();
      router.push("/login");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-brand-600">{ROLE_LABEL[role]}</p>
          <h1 className="text-lg font-semibold text-slate-900">School Enrichment</h1>
        </div>
        <div className="flex items-center gap-4">
          {user ? <span className="text-sm text-slate-600">{user.fullName}</span> : null}
          <button
            onClick={handleLogout}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
