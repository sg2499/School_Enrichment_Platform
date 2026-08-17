"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { clearSession, setActiveRole, setSession } from "@/lib/auth";
import type { CurrentUser, UserRole } from "@/types/auth";

/** Every role-scoped dashboard page calls this once. It doesn't trust the
 * localStorage-stored profile for authorization -- that's display-only,
 * see lib/auth.ts's file comment -- it always re-validates against
 * GET /api/auth/me, which checks the real httpOnly session cookie
 * server-side. A stale/expired/wrong-role session redirects to /login
 * rather than rendering anything.
 */
export function useProtectedPage(requiredRole: UserRole) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "redirecting">("loading");

  useEffect(() => {
    let cancelled = false;
    setActiveRole(requiredRole);

    api
      .get<CurrentUser>("/auth/me")
      .then(({ data }) => {
        if (cancelled) return;
        const normalizedRole = data.role === "SUPER_ADMIN" ? "ADMIN" : data.role;
        if (normalizedRole !== requiredRole) {
          setStatus("redirecting");
          router.replace("/login");
          return;
        }
        setSession(data);
        setUser(data);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        clearSession();
        setStatus("redirecting");
        router.replace("/login");
      });

    return () => {
      cancelled = true;
    };
  }, [requiredRole, router]);

  return { user, status };
}
