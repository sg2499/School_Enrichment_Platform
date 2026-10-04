"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, EyeOff, LifeBuoy, MonitorSmartphone } from "lucide-react";
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
import { GoArrow, NightBackdrop, NightCard, NightHeader, NightMakerRow } from "@/components/brand/NightStage";
import styles from "@/components/brand/night-ascent.module.css";
import { cn } from "@/lib/utils";

type Copy = {
  /** Why they are here and what comes next. Beside the card from `lg`;
   *  below it, where there is no "beside", it is the card's own first
   *  line, so the reason is never missing. */
  message: string;
  /** Under the card's heading from `lg`: what to type. */
  intro: string;
  /** The third of the three facts beside the card: who to ask if the new
   *  password is forgotten, which differs by role. */
  forgotten: string;
};

/*
 * The three facts beside the card are each what the server does, no more:
 *   - nobody can read a stored password (it is kept only as a hash:
 *     core/security.py), which is also why a forgotten one is replaced and
 *     never recovered;
 *   - saving keeps this browser's session and ends every other one
 *     (routes_auth.change_password with keepSignedIn) -- "this browser",
 *     not "this device": another browser on the same computer is signed
 *     out like any other;
 *   - a forgotten password is replaced with a new temporary one by the
 *     school admin (routes_roster reset-password). A student asks their
 *     teacher, who has no reset of their own.
 */

const COPY: Record<ChoosePasswordRole, Copy> = {
  STUDENT: {
    message: "The password your school gave you is temporary. Choose your own, and your learning space opens straight after.",
    intro: "Type the password you were given, then the one you want to use from now on.",
    forgotten: "Forget it later? Tell your teacher. Your school admin can give you a new temporary one.",
  },
  TEACHER: {
    message: "The password your school admin gave you is temporary. Choose your own, and your teaching workspace opens straight after.",
    intro: "Type the password you were given, then the one you want to use from now on.",
    forgotten: "Forget it later? Your school admin can give you a new temporary one.",
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
 *
 * It is the sign-in page's page (4 Oct 2026). This is the third step of
 * signing in, and on the sign-in card it is drawn on that page's night;
 * here it was on the workspace's pale page, taller than a laptop window,
 * with the eyebrow of a workspace the person cannot open yet. It now has
 * the sign-in page's two columns (components/brand/night-ascent.module.css):
 * what this step is for on the left, where the five steps are on sign-in,
 * and the same white card on the right, with the same way out under the
 * form ("Not <name>? Sign out"). Its own session check is on the night
 * too (SessionGate `surface`), so opening or refreshing this page shows
 * nothing pale first.
 *
 * One pale moment is left, and cannot be designed away: someone who opens a
 * workspace address while still on an issued password sees that
 * workspace's pale session check before being sent here, because until the
 * check answers nobody knows that this is where they belong.
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
    return <SessionGate session={session} surface="night" />;
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

  const name = firstName(user.fullName);

  return (
    // The sign-in page's own frame: two columns from `lg`, one below it.
    // No data-stage: that is what sets the sign-in page's sky drifting, and
    // this page has no switch to stop it, so it is a still picture.
    <main className={styles.page}>
      <NightBackdrop rings="side" />

      <section className={cn(styles.hero, styles.heroPlain)}>
        <NightHeader className="animate-fade-in" />

        <div className={cn("animate-fade-in", styles.message)}>
          <p className={styles.eyebrow}>One step left</p>
          <h1 className={cn("font-display", styles.headline)}>
            {name ? `${name}, choose` : "Choose"} a password <em>only you know.</em>
          </h1>
          {/* From `lg`, like the sign-in page's own sentence. On a phone the
              card says what to do, and its last line says who to ask. */}
          <div className={styles.promise}>
            <p>{copy.message}</p>
          </div>
          <ul className={styles.facts}>
            <li>
              <EyeOff aria-hidden />
              Nobody at your school can see the password you choose.
            </li>
            <li>
              <MonitorSmartphone aria-hidden />
              You stay signed in on this browser. Everywhere else, this account is signed out.
            </li>
            <li>
              <LifeBuoy aria-hidden />
              {copy.forgotten}
            </li>
          </ul>
        </div>
      </section>

      <section className={styles.side}>
        <div className={cn("animate-fade-up", styles.column)}>
          <NightCard>
            <div className="p-5 min-[380px]:p-6 sm:p-8 lg:px-[clamp(1.375rem,calc(var(--u)*3.4),2.5rem)] lg:pb-[clamp(1.125rem,calc(var(--u)*2.6),1.875rem)] lg:pt-[clamp(1.25rem,calc(var(--u)*3.2),2.5rem)]">
              <div className="mb-5 lg:mb-[clamp(0.75rem,calc(var(--u)*2.2),1.5rem)]">
                <h2 className="font-display text-display-md text-content text-balance lg:text-[clamp(1.625rem,calc(var(--u)*3.3),2.375rem)] lg:leading-[1.08]">
                  Choose Your Own Password
                </h2>
                {/* content-muted on white: 8.6:1. Below `lg` the left
                    column's sentence is not shown, so the card says why
                    they are here; from `lg` it says only what to type. */}
                <p className="mt-2 text-[0.9375rem] leading-[1.5] text-content-muted text-pretty lg:mt-[clamp(0.25rem,calc(var(--u)*0.7),0.5rem)] lg:text-[clamp(0.84375rem,calc(var(--u)*1.55),1.03125rem)] lg:leading-[1.4]">
                  <span className="lg:hidden">{copy.message}</span>
                  <span className="hidden lg:inline">{copy.intro}</span>
                </p>
              </div>

              <ChoosePassword
                role={role}
                username={user.loginId ?? user.email ?? null}
                onDone={handleDone}
                onSignedOut={handleSignedOut}
                finishing={finishing}
                className="lg:space-y-[clamp(0.625rem,2.2vh,1.5rem)]"
                submitClassName="rounded-2xl max-[379px]:px-4"
                submitIcon={<GoArrow />}
                // From `lg` the third fact beside the card says who to ask
                // if it is forgotten; this line would say it twice.
                keepClassName="lg:hidden"
              />

              {signOutError ? <AlertBanner tone="error" className="mt-4" message={signOutError} /> : null}

              {/* The one other way out, where the sign-in card has it. */}
              <button
                type="button"
                onClick={handleSignOut}
                disabled={leaving || finishing}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-2 text-[0.8125rem] font-semibold text-content-subtle transition hover:text-content-brand focus-visible:shadow-focus-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                {name ? `Not ${name}? Sign out` : "Sign Out"}
              </button>
            </div>
          </NightCard>
          <NightMakerRow />
        </div>
      </section>
    </main>
  );
}

function firstName(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? "";
}
