"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { clearSession, setSession } from "@/lib/auth";
import type { CurrentUser, UserRole } from "@/types/auth";

/** Every role-scoped dashboard page calls this once. It doesn't trust the
 * localStorage-stored profile for authorization -- that's display-only,
 * see lib/auth.ts's file comment -- it always re-validates against
 * GET /api/auth/me, which checks the real httpOnly session cookie
 * server-side. A stale/expired/wrong-role session redirects to /login
 * rather than rendering anything.
 *
 * Deliberately does NOT call setActiveRole(requiredRole) up front (18 Aug
 * 2026 fix -- this used to, and it was a real bug): `requiredRole` here is
 * "ADMIN" for BOTH admin variants (see the module-level comment on any
 * admin page calling this), never the actual signed-in role. Calling
 * setActiveRole with that generic value would overwrite the ACTIVE_ROLE_KEY
 * fallback lib/auth.ts falls back to outside a role-prefixed path -- which
 * is shared localStorage, not per-tab -- to "ADMIN" even for a SUPER_ADMIN
 * session, silently mislabeling it. setSession(data) below already does
 * the equivalent once the REAL role is known from the server response, so
 * nothing is lost by waiting.
 */
// ADMIN/SUPER_ADMIN accounts must have 2FA enabled before they can use
// anything else (2026-08-19 security hardening, Shailesh: "Yes, mandatory
// for both"). The backend enforces this on every other endpoint too (see
// dependencies.py's MANDATORY_2FA_ROLES check) -- this redirect is the UX
// layer on top of that, so a not-yet-enrolled admin lands on the setup
// screen instead of a wall of 403s.
const MANDATORY_2FA_ROLES: UserRole[] = ["ADMIN", "SUPER_ADMIN"];
const SECURITY_SETUP_PATH = "/admin/security";

export interface UseProtectedPageOptions {
  /** The security-setup page itself passes this so an admin who hasn't
   *  enrolled yet can actually reach the page that lets them enroll,
   *  instead of being bounced back to itself forever. */
  allowWithoutTwoFactor?: boolean;
}

export function useProtectedPage(requiredRole: UserRole, options: UseProtectedPageOptions = {}) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "redirecting">("loading");
  const { allowWithoutTwoFactor = false } = options;

  useEffect(() => {
    let cancelled = false;

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
        if (!allowWithoutTwoFactor && MANDATORY_2FA_ROLES.includes(data.role) && !data.twoFactorEnabled) {
          setSession(data);
          setStatus("redirecting");
          router.replace(`${SECURITY_SETUP_PATH}?setup=required`);
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
  }, [requiredRole, router, allowWithoutTwoFactor]);

  return { user, status };
}
