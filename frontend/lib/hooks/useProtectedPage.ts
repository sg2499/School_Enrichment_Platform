"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, describeApiError } from "@/lib/api";
import { clearSession, PASSWORD_CHANGE_PATH, SECURITY_SETUP_PATH, setSession } from "@/lib/auth";
import { describeError, isOutage, type DescribedError } from "@/lib/errors";
import { rememberSignedOut } from "@/lib/sessionNotice";
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
// What the session check is for, in each role's own words. Completes "We
// couldn't ..." when the check cannot be made (see `problem` below).
const OPENING: Record<UserRole, string> = {
  STUDENT: "open your learning space",
  TEACHER: "open your teaching workspace",
  ADMIN: "open your control centre",
  SUPER_ADMIN: "open your control centre",
};

// Shown on the sign-in page when a signed-in person opens a page that
// belongs to a different role's workspace.
const WRONG_WORKSPACE: Record<UserRole, string> = {
  STUDENT: "That page is part of the student workspace. Sign in with a student account to open it.",
  TEACHER: "That page is part of the teacher workspace. Sign in with a teacher account to open it.",
  ADMIN: "That page is part of the admin workspace. Sign in with an admin account to open it.",
  SUPER_ADMIN: "That page is part of the admin workspace. Sign in with an admin account to open it.",
};

// A check that fails because the server could not be reached is tried again
// quietly before anyone is told. The usual cause is the server waking after
// a quiet spell or a deploy swapping it over, and both pass in seconds --
// the loading screen already says "Still connecting" by then.
const RETRY_DELAYS_MS = [1500, 4000];

export interface UseProtectedPageOptions {
  /** The security-setup page itself passes this so an admin who hasn't
   *  enrolled yet can actually reach the page that lets them enroll,
   *  instead of being bounced back to itself forever. */
  allowWithoutTwoFactor?: boolean;
  /** Same idea as allowWithoutTwoFactor, for the forced-password-change
   *  gate below. Passed by the pages that host the form itself: the admin
   *  security page, and the teacher and student set-password screens. */
  allowWithoutPasswordChange?: boolean;
}

export type ProtectedPageStatus =
  | "loading"
  | "ready"
  | "redirecting"
  /** The session could not be checked: the server did not answer. Nothing
   *  is known about the session itself, so nobody is signed out -- the page
   *  shows `problem` with a way to try again (components/SessionGate.tsx). */
  | "unreachable";

export interface ProtectedPage {
  user: CurrentUser | null;
  status: ProtectedPageStatus;
  /** Set only when status is "unreachable". */
  problem: DescribedError | null;
  /** Runs the check again from the start. */
  retry: () => void;
}

export function useProtectedPage(requiredRole: UserRole, options: UseProtectedPageOptions = {}): ProtectedPage {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [status, setStatus] = useState<ProtectedPageStatus>("loading");
  const [problem, setProblem] = useState<DescribedError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { allowWithoutTwoFactor = false, allowWithoutPasswordChange = false } = options;

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;

    function check(retriesUsed: number) {
      api
        .get<CurrentUser>("/auth/me", { pageSessionCheck: true })
        .then(({ data }) => {
          if (cancelled) return;
          const normalizedRole = data.role === "SUPER_ADMIN" ? "ADMIN" : data.role;
          if (normalizedRole !== requiredRole) {
            // Signed in, but as someone this page isn't for. Their session is
            // left alone (it is perfectly good in its own workspace); the
            // sign-in page says why it is showing.
            rememberSignedOut({ message: WRONG_WORKSPACE[requiredRole] });
            setStatus("redirecting");
            router.replace("/login");
            return;
          }
          // Checked before the 2FA gate below, same order as the backend
          // (dependencies.py's get_current_user): a brand-new admin should
          // replace their default password before being walked into 2FA
          // setup, not the other way around.
          if (!allowWithoutPasswordChange && data.mustChangePassword && PASSWORD_CHANGE_PATH[data.role]) {
            setSession(data);
            setStatus("redirecting");
            router.replace(PASSWORD_CHANGE_PATH[data.role]);
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
          setProblem(null);
          setStatus("ready");
        })
        .catch((error) => {
          if (cancelled) return;

          const described = describeApiError(error, OPENING[requiredRole]);

          // Only two kinds of answer say anything about this person: "you
          // are not signed in" and "you may not be here". Everything else --
          // no connection, a timeout, a gateway answering for a server that
          // is still waking up, a crash, a rate limit -- says nothing about
          // their session, so it must not cost them their session. Before
          // 3 Oct 2026 every failure here cleared it and sent them to the
          // sign-in page: a server that was merely starting up signed people
          // out, to a form that gave no hint anything had gone wrong.
          // (A refusal with no code is not ours: a proxy's own 403 or 404
          // for the whole API means the server is misrouted, not that this
          // person is unwelcome.)
          const refused =
            described.kind === "session" ||
            (described.code !== null &&
              (described.kind === "forbidden" || described.kind === "notFound" || described.kind === "rejected"));
          if (!refused) {
            // Worth a quiet second and third try when the server simply was
            // not there. Not after a timeout (they have already waited the
            // full limit) or a rate limit (asking again is the problem).
            const delay = isOutage(error) && described.kind !== "timeout" ? RETRY_DELAYS_MS[retriesUsed] : undefined;
            if (delay !== undefined) {
              retryTimer = window.setTimeout(() => check(retriesUsed + 1), delay);
              return;
            }
            // A 403 or 404 that carries none of our codes did not come from
            // the app: something in front of it answered for the whole API.
            // "You don't have permission" or "that's no longer there" would
            // be untrue here, so it is shown as what it is -- unavailable.
            const misrouted =
              described.kind === "forbidden" || described.kind === "notFound" || described.kind === "rejected";
            setProblem(
              misrouted
                ? describeError(
                    { isAxiosError: true, config: { method: "get" }, response: { status: 503, data: "" } },
                    { action: OPENING[requiredRole], role: requiredRole },
                  )
                : described,
            );
            setStatus("unreachable");
            return;
          }

          if (described.kind !== "session") {
            // Refused for a reason other than "not signed in" (an account
            // made inactive, say). lib/api.ts has already recorded the
            // reason for a plain session end; this does the same for the
            // rest, so the sign-in page can say why it is showing.
            clearSession();
            rememberSignedOut({ message: described.message });
          }
          setStatus("redirecting");
          router.replace("/login");
        });
    }

    check(0);

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [requiredRole, router, allowWithoutTwoFactor, allowWithoutPasswordChange, attempt]);

  const retry = useCallback(() => {
    setProblem(null);
    setStatus("loading");
    setAttempt((n) => n + 1);
  }, []);

  // While the "couldn't reach" screen is up, the browser saying it has a
  // connection again is as good as the person pressing Try Again.
  useEffect(() => {
    if (status !== "unreachable") return;
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [status, retry]);

  return { user, status, problem, retry };
}
