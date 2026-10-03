"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LogOut } from "lucide-react";
import { api, describeApiError } from "@/lib/api";
import { clearSession, defaultRouteForRole, setSession } from "@/lib/auth";
import { wasRefused } from "@/lib/errors";
import { usePageTitle } from "@/lib/hooks/usePageTitle";
import { useProtectedPage } from "@/lib/hooks/useProtectedPage";
import { rememberSignedOut } from "@/lib/sessionNotice";
import type { CurrentUser } from "@/types/auth";
import { ChoosePassword, type ChoosePasswordRole } from "@/components/ChoosePassword";
import { SessionGate } from "@/components/SessionGate";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { AuroraBackdrop } from "@/components/brand/Graphics";
import { Lockup } from "@/components/brand/Logo";

const COPY: Record<ChoosePasswordRole, { eyebrow: string; message: string }> = {
  STUDENT: {
    eyebrow: "Your learning space",
    message:
      "The password your school gave you is temporary. Choose your own — one that only you know — and your practice opens straight after.",
  },
  TEACHER: {
    eyebrow: "Teaching workspace",
    message:
      "The password your school admin gave you is temporary. Choose your own — one that only you know — and your classes open straight after.",
  },
};

/**
 * The whole-screen version of "choose your own password" (3 Oct 2026, UI
 * revamp Phase B, slice 3), at /teacher/set-password and
 * /student/set-password.
 *
 * Most people never see it: the sign-in page does this as its own last
 * step, with the password they just typed still in hand. This is for
 * everyone who arrives signed in but not finished -- they closed the tab on
 * that step and came back, or were already signed in on the day the rule
 * began to apply to them. Any page of their workspace sends them here
 * (lib/hooks/useProtectedPage.ts), and so does any request the server
 * refuses for this reason (lib/api.ts).
 *
 * No navigation, no rail, no profile menu: every one of those leads to
 * something the server will refuse until this is done, so offering them
 * would be offering dead ends. The only other way out is to sign out.
 */
export function SetPasswordScreen({ role }: { role: ChoosePasswordRole }) {
  const router = useRouter();
  const session = useProtectedPage(role, { allowWithoutPasswordChange: true });
  usePageTitle("Choose Your Password", role);
  const copy = COPY[role];
  const { user, status } = session;
  // Set once the password is saved and the workspace is on its way, so the
  // "nothing to do here" redirect below doesn't race the one we started.
  const [finishing, setFinishing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  // Someone who has already chosen their password has no business here (a
  // bookmark, the Back button after finishing): on to their workspace.
  const settled = status === "ready" && Boolean(user) && !user?.mustChangePassword;
  useEffect(() => {
    if (settled && !finishing) router.replace(defaultRouteForRole(role));
  }, [settled, finishing, role, router]);

  if (status !== "ready" || !user || (settled && !finishing)) {
    return <SessionGate session={session} />;
  }

  function handleDone(updated: CurrentUser) {
    setFinishing(true);
    setSession(updated);
    router.replace(defaultRouteForRole(role));
  }

  function handleSignedOut(message: string) {
    clearSession();
    rememberSignedOut({ message });
    router.replace("/login");
  }

  // The same honesty as the workspace's own Sign Out (RoleShell): if the
  // server did not sign them out, they are not told they were. This screen
  // is most often on a shared school computer, where "I signed out" being
  // untrue matters.
  async function handleSignOut() {
    if (leaving) return;
    setLeaving(true);
    setSignOutError(null);
    try {
      await api.post("/auth/logout");
    } catch (error) {
      const problem = describeApiError(error, "sign you out");
      if (problem.kind !== "session") {
        setSignOutError(
          `${problem.message} ${
            wasRefused(problem)
              ? "You're still signed in on this device."
              : "Until signing out works, treat this device as still signed in."
          }`,
        );
        setLeaving(false);
        return;
      }
      // A session the server says is already over is as signed out as it gets.
    }
    clearSession();
    router.replace("/login");
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-canvas">
      <AuroraBackdrop />

      <header className="relative z-10 flex items-center justify-between gap-4 px-5 pt-6 sm:px-10 sm:pt-8">
        <Lockup />
        <button
          type="button"
          onClick={handleSignOut}
          disabled={leaving || finishing}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-line-strong bg-surface/85 px-4 text-[0.8125rem] font-semibold text-content-muted shadow-xs backdrop-blur transition hover:border-brand-300 hover:text-content-brand focus-visible:shadow-focus focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Sign Out
        </button>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="relative w-full max-w-[30rem] rounded-4xl border border-line bg-surface/95 p-6 shadow-panel backdrop-blur-xl animate-fade-up sm:p-9">
          {/* The same warm hairline the sign-in card has along its top edge. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-saffron-300/80 to-transparent"
          />
          <div className="mb-6 text-center">
            <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-line-brand bg-surface-brand text-brand-600">
              <KeyRound className="h-5 w-5" aria-hidden />
            </span>
            <p className="mt-4 text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-brand">{copy.eyebrow}</p>
            <h1 className="mt-1.5 font-display text-display-md text-balance text-content">
              {firstName(user.fullName)}, choose your own password
            </h1>
            <p className="mx-auto mt-3 max-w-[25rem] text-[0.9375rem] leading-[1.6] text-content-muted text-pretty">{copy.message}</p>
          </div>

          {signOutError ? (
            <AlertBanner tone="error" className="mb-5" message={signOutError} />
          ) : null}

          <ChoosePassword
            role={role}
            username={user.loginId ?? user.email ?? null}
            onDone={handleDone}
            onSignedOut={handleSignedOut}
            finishing={finishing}
          />
        </div>
      </main>
    </div>
  );
}

function firstName(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  return first || "Welcome";
}
