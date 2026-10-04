"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  GraduationCap,
  IdCard,
  Info,
  KeyRound,
  Lock,
  type LucideIcon,
  Presentation,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { api, describeApiError, errorMessage } from "@/lib/api";
import { defaultRouteForRole, forgetRememberedSchool, setSession } from "@/lib/auth";
import { wasRefused } from "@/lib/errors";
import { usePageTitle } from "@/lib/hooks/usePageTitle";
import { clearSignedOutNotice, readSignedOutNotice, returnPathFor } from "@/lib/sessionNotice";
import {
  DEFAULT_SIGN_IN_ROLE,
  SIGN_IN_ROLES,
  type SignInRole,
  rememberSignInRole,
  identifierIsForAnotherWayIn,
  rememberedSignInRole,
  signInRoleFromIdentifier,
} from "@/lib/signInRole";
import { SIGN_IN_COPY, type SignInCopy } from "@/lib/signInCopy";
import type { LoginResponse, LoginResult, UserRole } from "@/types/auth";
import { isTwoFactorChallenge } from "@/types/auth";
import { cn, greetingForHour } from "@/lib/utils";
import { ChoosePassword, type ChoosePasswordRole } from "@/components/ChoosePassword";
import { Button } from "@/components/ui/Button";
import { CodeInput, type CodeInputHandle } from "@/components/ui/CodeInput";
import { TextField } from "@/components/ui/Field";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { MakerCredit } from "@/components/brand/MakerCredit";
import { Assurances, FiveDayAscent } from "./FiveDayAscent";
import { GoArrow, NightHeader } from "@/components/brand/NightStage";
import styles from "@/components/brand/night-ascent.module.css";

/**
 * The mark beside each choice in "Who is signing in". What the page says to
 * each of the three is lib/signInCopy.ts.
 */
const WAY_ICON: Record<SignInRole, LucideIcon> = {
  STUDENT: GraduationCap,
  TEACHER: Presentation,
  ADMIN: Building2,
};

/** What the button says while the next page loads, once the server has
 *  said whose workspace it is. Same names the workspaces use for themselves
 *  (lib/hooks/useProtectedPage.ts). */
const OPENING: Record<UserRole, string> = {
  STUDENT: "Opening your learning space",
  TEACHER: "Opening your teaching workspace",
  ADMIN: "Opening your control centre",
  SUPER_ADMIN: "Opening your control centre",
};

/** Said above the choose-a-password step. "Temporary", not "first": the
 *  same step follows an admin's reset of a forgotten password. */
const CHOOSE_INTRO: Record<ChoosePasswordRole, string> = {
  STUDENT: "The password your school gave you is temporary. Now choose your own — one that only you know.",
  TEACHER: "The password your school admin gave you is temporary. Now choose your own — one that only you know.",
};

/** An authenticator app's code. */
const CODE_LENGTH = 6;

/** "Aarav" from "Aarav Shah", for the one place the page addresses someone
 *  by name. Falls back to something that still reads as a sentence. */
function firstName(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  return first || "you";
}

/**
 * Tighter spacing inside the card when the window is short. Written as
 * media queries on the classes themselves, so the rule sits beside the
 * spacing it overrides.
 */
const SHORT_BODY = "lg:[@media(max-height:680px)]:pb-3.5 lg:[@media(max-height:680px)]:pt-[1.125rem]";
const SHORT_FORM = "lg:[@media(max-height:680px)]:space-y-2.5";

/**
 * A few points of light in the night behind the page: where, and how far
 * into its five-second twinkle each one starts. Fixed, not random, so the
 * server and the browser draw the same sky.
 *
 * Shown on a laptop and larger only (night-ascent.module.css, .star).
 * There, every one of them is in a part of the page that never holds
 * words: the two outer margins, the strip above the header, and the gap
 * between the panel and the card. Their places are percentages of the window while the
 * text is laid out in units of its height, so a star anywhere else ends up
 * beside a word at some window size -- one sat directly in front of "The
 * five-day chapter loop" like a stray full stop, and another on the Zetta
 * Metrics logo.
 */
const STARS: ReadonlyArray<readonly [left: string, top: string, delay: string]> = [
  ["1.6%", "47%", "0s"],
  ["1.4%", "86%", "2.4s"],
  ["30%", "1.8%", "1.2s"],
  ["47%", "2.4%", "2.1s"],
  ["60%", "16%", "0.6s"],
  ["61%", "91%", "3.4s"],
  ["78%", "2%", "1.8s"],
  ["95.5%", "20%", "2.6s"],
  ["97%", "71%", "0.9s"],
];

/**
 * Flips to "ready" once the page has actually finished arriving -- webfonts
 * resolved and a frame painted -- rather than on a fixed timer, so the
 * entrance sequence never plays while headings are still swapping from the
 * fallback serif. Capped so a slow font request can't hold the page hostage.
 */
function useStageReady() {
  const [stage, setStage] = useState<"idle" | "ready">("idle");

  useEffect(() => {
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      setStage("ready");
    };

    const fallback = window.setTimeout(release, 900);
    const frame = window.requestAnimationFrame(() => {
      if (document.fonts?.status === "loaded") {
        release();
        return;
      }
      document.fonts?.ready.then(release).catch(release);
    });

    return () => {
      done = true;
      window.clearTimeout(fallback);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return stage;
}

/**
 * "Welcome Back" is what the very first visitor to a brand-new account
 * sees too, which never quite lands. A time-of-day greeting costs nothing
 * and reads as though someone actually built this for the person opening
 * it.
 *
 * Wording comes from greetingForHour() in lib/utils -- the same helper the
 * student dashboard greets with -- so a student who signs in at 4:59pm is
 * told "Good Afternoon" here and "Good afternoon" on the next screen, never
 * two different answers. Title Cased to match this page's headings. The
 * one addition is late at night, where "Good Evening" at 1am reads as
 * automated and a gentler question reads as noticed.
 *
 * Resolved after mount only: the page is prerendered at build time and the
 * server has no viewer timezone, so the first paint says "Welcome Back".
 * There is no visible swap: this effect commits in the same pass as
 * useStageReady's, while the card's .stage-in wrapper is still at opacity
 * 0, and the stage cannot flip to "ready" until at least one animation
 * frame later.
 */
function useTimeOfDayGreeting() {
  const [greeting, setGreeting] = useState("Welcome Back");
  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 5 || hour >= 22) {
      setGreeting("Working Late?");
      return;
    }
    setGreeting(greetingForHour(hour).replace(/\b\w/g, (letter) => letter.toUpperCase()));
  }, []);
  return greeting;
}

/**
 * A short, decaying horizontal shake -- the "that's not right" gesture
 * people already know from OS password prompts -- played on the sign-in
 * card when the server rejects a sign-in or a 2FA code. Paired with the
 * role="alert" message, never a replacement for it.
 *
 * Web Animations API rather than a CSS class, on purpose: a class only
 * replays if it is removed and re-added across a reflow, and re-keying the
 * card to force a remount would throw away focus and the typed identifier.
 * element.animate() can replay on every failed attempt with neither
 * problem. Skipped under reduced motion (checked here as well, since the
 * global CSS override doesn't reach WAAPI animations).
 */
function shake(element: HTMLElement | null) {
  if (!element || typeof element.animate !== "function") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  element.animate(
    [
      { transform: "translate3d(0,0,0)" },
      { transform: "translate3d(-7px,0,0)" },
      { transform: "translate3d(6px,0,0)" },
      { transform: "translate3d(-4px,0,0)" },
      { transform: "translate3d(2px,0,0)" },
      { transform: "translate3d(0,0,0)" },
    ],
    { duration: 440, easing: "cubic-bezier(0.36, 0.07, 0.19, 0.97)" },
  );
}

export default function LoginPage() {
  const router = useRouter();
  const stage = useStageReady();
  const greeting = useTimeOfDayGreeting();
  // Whether the person has stopped the page's motion (the switch is beside
  // the five steps). Not remembered: on a shared computer one person's
  // choice should not change the page for the next.
  const [motionPaused, setMotionPaused] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const identifierRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<CodeInputHandle>(null);
  const backupRef = useRef<HTMLInputElement>(null);

  // Which of the three ways in the page is speaking to. A hint for wording
  // only -- the server decides who someone is (lib/signInRole.ts).
  const [signInRole, setSignInRole] = useState<SignInRole>(DEFAULT_SIGN_IN_ROLE);
  // The role last read off the identifier itself. The page follows a typed
  // code once, at the moment it becomes recognisable; after that the choice
  // is the person's again, so picking a different one by hand is not undone
  // on the next keystroke.
  const inferredRole = useRef<SignInRole | null>(null);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Which box a sign-in error is about, so the box itself says it is wrong
  // (to the eye and to a screen reader) and points at the message. A
  // refused sign-in is about both: the server never says which was wrong.
  const [errorField, setErrorField] = useState<"identifier" | "password" | "both" | null>(null);
  // Counts refusals. The message box is keyed by it, so the same message a
  // second time is a new box: announced again, not passed over in silence.
  const [errorCount, setErrorCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Two-factor is a second step, not a second page: the challenge token
  // issued by /auth/login (see backend/app/services/auth_service.py's
  // login()) lives only in this state, never in the URL or storage -- it
  // expires in 5 minutes, so there's nothing worth persisting.
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  // The authenticator's six digits are the normal case and get the six
  // boxes. A backup code is a different shape (letters, a dash, longer), so
  // it gets an ordinary field, asked for only when someone says they need it.
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [backupCode, setBackupCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  // A ref as well as the state: the sixth digit submits by itself, and a
  // fast typist's Enter can arrive before the re-render that would disable
  // the button. One code is sent once.
  const verifyInFlight = useRef(false);
  const refocusCode = useRef(false);
  useEffect(() => {
    if (verifying || !refocusCode.current) return;
    refocusCode.current = false;
    (useBackupCode ? backupRef.current : codeRef.current)?.focus();
  }, [verifying, useBackupCode]);

  // The third step, for a teacher or student whose password is still the
  // one they were issued: signed in, but the server lets them do nothing
  // until they have chosen their own (components/ChoosePassword.tsx). Held
  // here rather than passed to completeSignIn() -- they are not in yet.
  const [choosing, setChoosing] = useState<LoginResponse["user"] | null>(null);
  const [leaving, setLeaving] = useState(false);

  // True from a successful sign-in until the next page takes over. Without
  // it the button snapped back to an idle "Sign In" for the second or so
  // router.push() takes to load the workspace -- which looks like the
  // sign-in failed, and invites a second click.
  const [redirecting, setRedirecting] = useState(false);
  // Whose workspace is opening, once the server has said who signed in, so
  // the wait reads "Opening your learning space" rather than "your workspace".
  const [openingRole, setOpeningRole] = useState<UserRole | null>(null);

  // Whether the form has swapped between steps at least once. The incoming
  // step only animates on a real swap; on first load the card's own
  // stage-in entrance already covers it.
  const [stepSwapped, setStepSwapped] = useState(false);

  const step: "credentials" | "twoFactor" | "choosePassword" = choosing ? "choosePassword" : challengeToken ? "twoFactor" : "credentials";
  const way = SIGN_IN_COPY[signInRole];
  // The tab says which of the three steps this is, so someone who comes
  // back to it from another tab (to read a code off their phone, say) is
  // told where they are before they look.
  usePageTitle(step === "twoFactor" ? "Two-Factor Check" : step === "choosePassword" ? "Choose Your Password" : "Sign In");

  // After a step swap, put the caret where the next keystroke belongs: the
  // code boxes when the 2FA challenge arrives, the (just-cleared) password
  // when going back. `autoFocus` alone never actually worked here --
  // measured against the unmodified page, focus was left on <body> after
  // the swap, so a keyboard user had to Tab to find the field their
  // authenticator code goes in. An effect runs after the new form has
  // committed, so the target always exists by then. (The choose-a-password
  // step focuses its own first field.)
  useEffect(() => {
    if (!stepSwapped) return;
    if (step === "twoFactor") (useBackupCode ? backupRef.current : codeRef.current)?.focus();
    else if (step === "credentials") (identifier ? passwordRef : identifierRef).current?.focus();
    // `identifier` is read, not watched: this runs on a step change, not on
    // every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, stepSwapped, useBackupCode]);

  // Why this page is showing, when the person did not come here by choice:
  // their session ended, they changed their password, they opened a page
  // that belongs to another role (lib/sessionNotice.ts). Read after mount:
  // storage isn't available while the page is prerendered, and reading it
  // here rather than in useState's initializer keeps the first server-
  // rendered paint identical to the first client paint. All of this commits
  // while the card is still at opacity 0 -- see useTimeOfDayGreeting.
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    forgetRememberedSchool();
    const remembered = rememberedSignInRole();
    if (remembered) setSignInRole(remembered);
    const pending = readSignedOutNotice();
    if (!pending) return;
    setNotice(pending.message);
    // A notice with no page to return to has done its whole job once it is
    // on screen, so it is not left in storage for whoever uses this tab
    // next ("Your password has been changed" is not theirs to read). One
    // that does carry a page stays until sign-in, which is what uses it.
    if (!pending.returnTo) clearSignedOutNotice();
  }, []);

  /** Shows a problem with the first step, and which box it belongs to. */
  function refuse(message: string, field: "identifier" | "password" | "both") {
    setError(message);
    setErrorField(field);
    setErrorCount((count) => count + 1);
  }

  function handleIdentifierChange(value: string) {
    setIdentifier(value);
    if (errorField === "identifier") setErrorField(null);
    const inferred = signInRoleFromIdentifier(value);
    if (inferred && inferred !== inferredRole.current) setSignInRole(inferred);
    inferredRole.current = inferred;
  }

  /** Someone has picked a way in by hand. */
  function chooseSignInRole(role: SignInRole) {
    setSignInRole(role);
    if (error) setError(null);
    setErrorField(null);
    // A student code under "Teacher" can never be right, and it is usually
    // not theirs: the browser filled in whoever signed in here last. The
    // box is emptied, and the password that came with it. An email stays --
    // it could be anyone's (lib/signInRole.ts).
    if (identifierIsForAnotherWayIn(identifier, role)) {
      setIdentifier("");
      setPassword("");
      inferredRole.current = null;
    }
  }

  function completeSignIn(user: LoginResponse["user"]) {
    // If a session ending is what brought them here, take the same person
    // back to the page they were on -- never anyone else, and never outside
    // their own role's area (returnPathFor has the rules).
    const returnTo = returnPathFor(readSignedOutNotice(), user);
    clearSignedOutNotice();
    setSession(user);
    rememberSignInRole(user.role);
    setOpeningRole(user.role);
    setRedirecting(true);
    // Nothing on this page needs it again, and the page stays mounted for
    // the second or so the workspace takes to load. (Left alone on the
    // choose-a-password step, whose form would otherwise redraw itself with
    // an extra box for that second.)
    if (!choosing) setPassword("");
    const normalizedRole = user.role === "SUPER_ADMIN" ? "ADMIN" : user.role;
    router.push(returnTo ?? defaultRouteForRole(normalizedRole));
  }

  /** The server has accepted the credentials. Most people are in; a teacher
   *  or student still on an issued password has one more thing to do. */
  function afterSignIn(user: LoginResponse["user"]) {
    if (user.mustChangePassword && (user.role === "TEACHER" || user.role === "STUDENT")) {
      setSignInRole(user.role);
      setError(null);
      setNotice(null);
      setStepSwapped(true);
      setChoosing(user);
      return;
    }
    completeSignIn(user);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || redirecting) return;
    setError(null);
    setErrorField(null);
    if (!identifier.trim()) {
      refuse(way.missingIdentifier, "identifier");
      identifierRef.current?.focus();
      return;
    }
    if (!password) {
      refuse("Enter your password.", "password");
      passwordRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post<LoginResult>("/auth/login", { identifier, password });
      if (isTwoFactorChallenge(data)) {
        // Only admins have a second factor, whatever was selected above.
        setSignInRole("ADMIN");
        setStepSwapped(true);
        setChallengeToken(data.challengeToken);
        // The password has done its job; the second step does not use it.
        setPassword("");
        return;
      }
      afterSignIn(data.user);
    } catch (err) {
      refuse(errorMessage(err, "sign you in"), "both");
      shake(cardRef.current);
      // Pressing the button itself (rather than Enter in a box) leaves
      // focus on a button that is switched off while the request runs, and
      // a switched-off button drops focus to the top of the page. Put it
      // where the next thing happens: the password, which is what gets
      // retyped. Left alone if the person has already moved somewhere.
      if (!document.activeElement || document.activeElement === document.body) passwordRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyTwoFactor(code: string) {
    if (!challengeToken || verifyInFlight.current || redirecting) return;
    verifyInFlight.current = true;
    setError(null);
    setVerifying(true);
    try {
      const { data } = await api.post<LoginResponse>("/auth/2fa/verify-login", { challengeToken, code });
      afterSignIn(data.user);
    } catch (err) {
      const described = describeApiError(err, "verify your code");
      if (described.kind === "session") {
        // The five minutes this step is good for have passed. Another code
        // cannot rescue it: back to the start, with the server's reason.
        backToCredentials();
        setError(described.message);
      } else {
        // The server's sentence for a wrong code names the authenticator
        // app, which is not what someone typing a backup code was using.
        setError(
          useBackupCode && described.code === "INVALID_CODE"
            ? "That backup code didn't match. Each one works only once. Check it and try again."
            : described.message,
        );
        // A refused code is cleared so the next attempt starts from empty
        // boxes, with the caret already in the first one. The caret is put
        // back by the effect below, once the field is enabled again: it is
        // disabled while a code is being checked, and a disabled field
        // cannot take focus.
        setTwoFactorCode("");
        refocusCode.current = true;
      }
      shake(cardRef.current);
    } finally {
      verifyInFlight.current = false;
      setVerifying(false);
    }
  }

  function handleVerifyTwoFactor(event: React.FormEvent) {
    event.preventDefault();
    if (useBackupCode) {
      const code = backupCode.trim();
      if (!code) {
        setError("Enter one of your backup codes.");
        backupRef.current?.focus();
        return;
      }
      void verifyTwoFactor(code);
      return;
    }
    if (twoFactorCode.length < CODE_LENGTH) {
      setError(`Enter all ${CODE_LENGTH} digits of the code in your authenticator app.`);
      codeRef.current?.focus();
      return;
    }
    void verifyTwoFactor(twoFactorCode);
  }

  function toggleBackupCode() {
    setStepSwapped(true);
    setUseBackupCode((value) => !value);
    setTwoFactorCode("");
    setBackupCode("");
    setError(null);
  }

  function backToCredentials() {
    setStepSwapped(true);
    setChallengeToken(null);
    setTwoFactorCode("");
    setBackupCode("");
    setUseBackupCode(false);
    setError(null);
    setPassword("");
  }

  /** Leaving the choose-a-password step without choosing. They are signed
   *  in at this point, so this signs them out again rather than leaving a
   *  session behind on what may be a shared computer -- and says so if the
   *  server did not do it, the same way the workspace's own Sign Out does. */
  async function leaveChoosing() {
    const role = choosing?.role;
    if (!role || leaving) return;
    setLeaving(true);
    let failure: string | null = null;
    try {
      await api.post("/auth/logout", null, { headers: { "X-Auth-Role": role } });
    } catch (err) {
      const problem = describeApiError(err, "sign you out");
      // A session the server says is already over is as signed out as it gets.
      if (problem.kind !== "session") {
        failure = `${problem.message} ${
          wasRefused(problem) ? "You're still signed in on this device." : "Until signing out works, treat this device as still signed in."
        }`;
      }
    }
    setLeaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    // The next person at this computer starts from an empty form: the code
    // in the first box was the one who just left.
    setIdentifier("");
    inferredRole.current = null;
    setStepSwapped(true);
    setChoosing(null);
    setPassword("");
    setError(null);
  }

  /** Their password is saved, but this browser was not kept signed in. */
  function chosenButSignedOut(message: string) {
    setStepSwapped(true);
    setChoosing(null);
    setPassword("");
    setError(null);
    setNotice(message);
  }

  /** The session behind the choose-a-password step ended before anything
   *  was saved (the step was left open too long). Back to the start, with
   *  the server's reason; their code stays so they only retype a password. */
  function choosingTimedOut(message: string) {
    setStepSwapped(true);
    setChoosing(null);
    setPassword("");
    setError(null);
    setNotice(message);
  }

  const opening = openingRole ? OPENING[openingRole] : "Opening your workspace";

  const heading = step === "twoFactor" ? "Verify It’s You" : step === "choosePassword" ? "Choose Your Own Password" : greeting;

  return (
    // One dark page, two columns at `lg`: the product on the left, the card
    // on the right (night-ascent.module.css). At `lg` and up the row is
    // pinned to exactly one viewport, because a sign-in screen that scrolls
    // reads as a mistake; below it the page is one column and scrolls like
    // any other on a phone.
    <main data-stage={stage} data-motion={motionPaused ? "paused" : undefined} className={styles.page}>
      <div aria-hidden className={styles.backdrop}>
        <div className={styles.glowIndigo} />
        <div className={styles.glowSaffron} />
        <div className={styles.glowViolet} />
        <div className={styles.lines} />
        <div className={styles.ring} />
        <div className={styles.ringDashed} />
        {STARS.map(([left, top, delay]) => (
          <span key={`${left}-${top}`} className={styles.star} style={{ left, top, animationDelay: delay }} />
        ))}
      </div>

      {/* ---------------- The product ---------------- */}
      <section className={styles.hero}>
        {/* The same header bar as the other screens on this night
            (components/brand/NightStage.tsx): the lockup scales with the
            window, and the maker's credit is on its right from `lg`. */}
        <NightHeader className="stage-in stage-d0" />

        <div className={cn("stage-in stage-d1", styles.message)}>
          {/* Who the page is talking to, and the one sentence that is theirs.
              Both follow the choice in the card, and fade rather than swap
              under the reader's eye. The sentence is one line wherever a
              line is wide enough for it (night-ascent.module.css, .promise).
              Below `lg` only the headline shows. */}
          <p key={`for-${signInRole}`} className={cn("animate-fade-in", styles.eyebrow)}>
            {way.audience}
          </p>
          <h1 className={cn("font-display", styles.headline)}>
            Every chapter, practised <em>until it sticks.</em>
          </h1>
          <PerWayIn current={signInRole} className={styles.promise}>
            {(copy) => <p>{copy.promise}</p>}
          </PerWayIn>
        </div>

        <FiveDayAscent arrived={stage === "ready"} paused={motionPaused} onPausedChange={setMotionPaused} className="stage-in stage-d3" />
        <Assurances className="stage-in stage-d4" />
      </section>

      {/* ---------------- The card ---------------- */}
      <section className={styles.side}>
        {/* The wrapper owns the stage-in entrance; the card inside owns the
            error shake. Both animate `transform`, so they must not share an
            element -- the entrance's settled `transform: none` would
            otherwise be fighting the shake's keyframes. */}
        <div className={cn("stage-in stage-d2", styles.column)}>
          <div ref={cardRef} className={cn("relative overflow-hidden rounded-4xl bg-surface text-content", styles.card)}>
            {/* Warm light catching the card's top edge -- a hairline of
                saffron that fades out before the corners, so the card reads
                as a lit object rather than a flat white box. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-12 top-0 z-10 h-0.5 bg-gradient-to-r from-transparent via-saffron-300 to-transparent"
            />

            {/* The `short` rules below are for laptops under about 680px of
                window height (a 1366x768 screen with a bookmarks bar, a
                1280x720 one without): the admin's card, which has the
                longest note, is the one that would otherwise not fit. */}
            <div className={cn("p-5 min-[380px]:p-6 sm:p-8 lg:px-[clamp(1.375rem,calc(var(--u)*3.4),2.5rem)] lg:pb-[clamp(1.125rem,calc(var(--u)*2.6),1.875rem)] lg:pt-[clamp(1.25rem,calc(var(--u)*3.2),2.5rem)]", SHORT_BODY)}>
              <div className="mb-5 lg:mb-[clamp(0.75rem,calc(var(--u)*2.2),1.5rem)]">
                {/* Where you are, on the one step that is numbered. The first
                    step has no chip: who is signing in is asked just below,
                    and that says more than a label would. The
                    choose-a-password step has none either -- its heading
                    says what it is, and it is the tallest of the three, so
                    it keeps the room. */}
                {step === "twoFactor" ? (
                  <p className="mb-3 animate-fade-in lg:mb-[clamp(0.5rem,calc(var(--u)*1.4),0.875rem)]">
                    <span className="inline-flex items-center gap-2.5 rounded-full border border-line bg-surface-muted px-3.5 py-1.5 text-[0.8125rem] font-semibold text-content-muted">
                      <span className="relative flex h-2 w-2 shrink-0">
                        {/* Two pulses as the step arrives, then still. */}
                        <span
                          aria-hidden
                          className="absolute inline-flex h-full w-full rounded-full bg-jade-400 animate-pulse-ring [animation-duration:2.4s] [animation-iteration-count:2]"
                        />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-jade-500" />
                      </span>
                      Step 2 of 2 &middot; Two-Factor Check
                    </span>
                  </p>
                ) : null}

                <h2 className="font-display text-display-md text-content text-balance lg:text-[clamp(1.625rem,calc(var(--u)*3.3),2.375rem)] lg:leading-[1.08]">
                  {heading}
                </h2>
                {notice && step === "credentials" ? (
                  // Takes the place of the standing instruction rather than
                  // sitting above it: the card is sized to fit one screen at
                  // `lg`, and the reason they are here is the more useful
                  // two lines. brand-800 on surface-brand: 10.6:1.
                  <p
                    role="status"
                    className="mt-3 flex items-start gap-2.5 rounded-2xl border border-line-brand bg-surface-brand px-3.5 py-2.5 text-[0.9375rem] font-medium leading-[1.5] text-brand-800 text-pretty animate-fade-in lg:mt-[clamp(0.375rem,calc(var(--u)*1),0.75rem)] lg:py-[clamp(0.3125rem,calc(var(--u)*0.8),0.625rem)] lg:text-[clamp(0.8125rem,calc(var(--u)*1.5),0.9375rem)] lg:leading-[1.45]"
                  >
                    <Info className="mt-[0.15em] h-[1.05em] w-[1.05em] shrink-0 text-brand-600" aria-hidden />
                    <span>{notice}</span>
                  </p>
                ) : (
                  // Keyed by what it says, so a change of wording (another
                  // way in chosen, another step reached) fades in rather
                  // than swapping under the reader's eye.
                  <p
                    key={`${step}-${signInRole}-${useBackupCode}`}
                    className={cn(
                      "mt-2 text-[0.9375rem] leading-[1.5] text-content-muted animate-fade-in lg:mt-[clamp(0.25rem,calc(var(--u)*0.7),0.5rem)] lg:text-[clamp(0.84375rem,calc(var(--u)*1.55),1.03125rem)] lg:leading-[1.4]",
                      // The sign-in instruction is one line on every choice
                      // at every laptop size (lib/signInCopy.ts keeps it
                      // short enough), so the form does not shift as the
                      // choice changes. It is not FORCED onto one line: on
                      // the narrowest phones, or with someone's own wider
                      // letter spacing, it wraps rather than being cut off.
                      "text-pretty",
                    )}
                  >
                    {step === "twoFactor"
                      ? useBackupCode
                        ? "Enter one of your saved backup codes. Each one works once."
                        : "Enter the 6-digit code showing in your authenticator app."
                      : step === "choosePassword"
                        ? CHOOSE_INTRO[choosing?.role === "TEACHER" ? "TEACHER" : "STUDENT"]
                        : way.intro}
                  </p>
                )}
              </div>

              {step === "choosePassword" && choosing ? (
                <div className={cn(stepSwapped && "animate-fade-up")}>
                  <ChoosePassword
                    role={choosing.role === "TEACHER" ? "TEACHER" : "STUDENT"}
                    currentPassword={password}
                    username={identifier}
                    onDone={completeSignIn}
                    onSignedOut={chosenButSignedOut}
                    onSessionEnded={choosingTimedOut}
                    finishing={redirecting}
                    className="lg:space-y-[clamp(0.625rem,2.2vh,1.5rem)]"
                    submitClassName="rounded-2xl max-[379px]:px-4"
                    submitIcon={<GoArrow />}
                  />
                  {/* Only a failed sign-out lands here: the form above shows
                      its own errors. */}
                  {error ? (
                    <div role="alert" className="mt-4 flex items-start gap-3 rounded-2xl border border-coral-200 bg-coral-50 p-4 animate-scale-in">
                      <AlertCircle className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-coral-600" aria-hidden />
                      <p className="text-[0.875rem] font-medium leading-[1.55] text-coral-800">{error}</p>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void leaveChoosing()}
                    disabled={redirecting || leaving}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-2 text-[0.8125rem] font-semibold text-content-subtle transition hover:text-content-brand disabled:pointer-events-none disabled:opacity-60"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                    Not {firstName(choosing.fullName)}? Sign out
                  </button>
                </div>
              ) : step === "twoFactor" ? (
                <form
                  // Keyed so switching between the code boxes and the
                  // backup-code field replays the entrance and resets focus.
                  key={useBackupCode ? "backup" : "code"}
                  // See the first step's form for why this is a POST.
                  method="post"
                  onSubmit={handleVerifyTwoFactor}
                  className={cn("space-y-5 lg:space-y-[clamp(0.625rem,2.6vh,1.75rem)]", stepSwapped && "animate-fade-up")}
                  noValidate
                >
                  {useBackupCode ? (
                    <TextField
                      ref={backupRef}
                      id="backupCode"
                      name="backupCode"
                      label="Backup Code"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="xxxxxxxx-xxxx"
                      required
                      value={backupCode}
                      onChange={(event) => {
                        setBackupCode(event.target.value);
                        if (error) setError(null);
                      }}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? "twoFactorError" : undefined}
                      icon={<KeyRound className="h-[1.05rem] w-[1.05rem]" aria-hidden />}
                      className="font-semibold tracking-[0.08em] placeholder:font-normal placeholder:tracking-normal"
                    />
                  ) : (
                    <CodeInput
                      ref={codeRef}
                      id="twoFactorCode"
                      name="twoFactorCode"
                      label="Authentication Code"
                      length={CODE_LENGTH}
                      value={twoFactorCode}
                      onChange={(value) => {
                        setTwoFactorCode(value);
                        if (error) setError(null);
                      }}
                      // The sixth digit is the whole of "I'm done".
                      onComplete={(code) => void verifyTwoFactor(code)}
                      disabled={verifying || redirecting}
                      invalid={Boolean(error)}
                      aria-describedby={error ? "twoFactorError" : undefined}
                    />
                  )}

                  {error ? (
                    <div
                      id="twoFactorError"
                      role="alert"
                      className="flex items-start gap-3 rounded-2xl border border-coral-200 bg-coral-50 p-4 animate-scale-in"
                    >
                      <AlertCircle className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-coral-600" aria-hidden />
                      <p className="text-[0.875rem] font-medium leading-[1.55] text-coral-800">{error}</p>
                    </div>
                  ) : null}

                  <Button
                    type="submit"
                    size="lg"
                    fullWidth
                    loading={verifying || redirecting}
                    loadingLabel={redirecting ? opening : "Checking your code"}
                    trailingIcon={<GoArrow />}
                    className="rounded-2xl"
                  >
                    Verify &amp; Sign In
                  </Button>

                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <button
                      type="button"
                      onClick={backToCredentials}
                      className="inline-flex items-center gap-2 rounded-2xl py-2 text-[0.8125rem] font-semibold text-content-subtle transition hover:text-content-brand"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                      Back to sign in
                    </button>
                    <button
                      type="button"
                      onClick={toggleBackupCode}
                      className="inline-flex items-center gap-2 rounded-2xl py-2 text-[0.8125rem] font-semibold text-content-brand transition hover:text-brand-900"
                    >
                      <KeyRound className="h-3.5 w-3.5" aria-hidden />
                      {useBackupCode ? "Use your authenticator app" : "Use a backup code instead"}
                    </button>
                  </div>
                </form>
              ) : (
                <form
                  // Script handles the submit. `method` is for the moment
                  // before the script has loaded (or a browser with none):
                  // a form with no method is a GET, and Enter would then put
                  // the password in the address bar and the server's logs.
                  method="post"
                  onSubmit={handleSubmit}
                  className={cn("space-y-5 lg:space-y-[clamp(0.625rem,2.2vh,1.375rem)]", SHORT_FORM, stepSwapped && "animate-fade-up")}
                  noValidate
                >
                  {/* Asked first, because everything under it depends on
                      the answer: what the first field is called, what goes
                      in it, and who to turn to when it doesn't work. */}
                  <SegmentedControl
                    label="Who is signing in"
                    value={signInRole}
                    onChange={chooseSignInRole}
                    // Not while a sign-in is on its way: changing the choice
                    // can empty the boxes, and the step that follows still
                    // needs what was in them.
                    disabled={submitting || redirecting}
                    segments={SIGN_IN_ROLES.map((role) => {
                      const Icon = WAY_ICON[role];
                      return { key: role, label: SIGN_IN_COPY[role].tab, icon: <Icon className="h-4 w-4" /> };
                    })}
                  />

                  <TextField
                    ref={identifierRef}
                    id="identifier"
                    name="identifier"
                    label={way.label}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder={way.placeholder}
                    required
                    value={identifier}
                    onChange={(event) => handleIdentifierChange(event.target.value)}
                    aria-invalid={error && (errorField === "identifier" || errorField === "both") ? true : undefined}
                    aria-describedby={error && (errorField === "identifier" || errorField === "both") ? "signInError" : undefined}
                    icon={<UserRound className="h-[1.05rem] w-[1.05rem]" aria-hidden />}
                  />

                  <TextField
                    ref={passwordRef}
                    id="password"
                    name="password"
                    label="Password"
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    required
                    revealable
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (errorField === "password") setErrorField(null);
                    }}
                    aria-invalid={error && (errorField === "password" || errorField === "both") ? true : undefined}
                    aria-describedby={error && (errorField === "password" || errorField === "both") ? "signInError" : undefined}
                    icon={<Lock className="h-[1.05rem] w-[1.05rem]" aria-hidden />}
                  />

                  {error ? (
                    <div
                      key={errorCount}
                      id="signInError"
                      role="alert"
                      className="flex items-start gap-3 rounded-2xl border border-coral-200 bg-coral-50 p-4 animate-scale-in lg:py-3"
                    >
                      <AlertCircle className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-coral-600" aria-hidden />
                      <p className="text-[0.875rem] font-medium leading-[1.55] text-coral-800">{error}</p>
                    </div>
                  ) : null}

                  <Button
                    type="submit"
                    size="lg"
                    fullWidth
                    loading={submitting || redirecting}
                    loadingLabel={redirecting ? opening : "Signing you in"}
                    trailingIcon={<GoArrow />}
                    className="rounded-2xl"
                  >
                    Sign In
                  </Button>
                </form>
              )}

              {step === "credentials" ? (
                // Two lines, both about the person chosen above: what keeps
                // their session safe, and who gives them a new password.
                <PerWayIn
                  current={signInRole}
                  className="mt-6 border-t border-line pt-5 lg:mt-[clamp(0.75rem,calc(var(--u)*2),1.375rem)] lg:pt-[clamp(0.75rem,calc(var(--u)*2),1.375rem)]"
                >
                  {(copy) => (
                    <div className="space-y-3 lg:space-y-[clamp(0.375rem,calc(var(--u)*1),0.6875rem)]">
                      {/* On a short window a refused sign-in takes this
                          line's room: the message needs the space, and the
                          line that stays -- who gives you a new password --
                          is the one that helps someone whose password was
                          just refused. */}
                      <p
                        className={cn(
                          "flex items-start gap-2.5 text-[0.875rem] leading-[1.5] text-content-muted text-pretty lg:text-[clamp(0.78125rem,calc(var(--u)*1.32),0.875rem)] lg:leading-[1.45]",
                          error && "lg:[@media(max-height:760px)]:hidden",
                        )}
                      >
                        <ShieldCheck className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-jade-600" aria-hidden />
                        <span>{copy.safe}</span>
                      </p>
                      <p className="flex items-start gap-2.5 text-[0.875rem] leading-[1.5] text-content-muted text-pretty lg:text-[clamp(0.78125rem,calc(var(--u)*1.32),0.875rem)] lg:leading-[1.45]">
                        <KeyRound className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-brand-600" aria-hidden />
                        <span>{copy.forgotten}</span>
                      </p>
                    </div>
                  )}
                </PerWayIn>
              ) : null}
            </div>

            {step === "credentials" ? (
              // The card's own foot: who issues this kind of account, and
              // what someone who has none does next. These two lines used to
              // sit loose under the card, with the name of whichever school
              // last signed in on this browser; see lib/signInCopy.ts for
              // why that name is gone.
              <PerWayIn
                current={signInRole}
                centred
                className="border-t border-line bg-surface-muted px-5 py-4 min-[380px]:px-6 sm:px-8 lg:px-[clamp(1.375rem,calc(var(--u)*3.4),2.5rem)] lg:py-[clamp(0.6875rem,calc(var(--u)*1.8),1.25rem)]"
              >
                {(copy) => (
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-[1.875rem] w-[1.875rem] shrink-0 items-center justify-center rounded-[0.5625rem] bg-surface-brand text-content-brand">
                      <IdCard className="h-4 w-4" aria-hidden />
                    </span>
                    <p className="text-[0.8125rem] leading-[1.5] text-content-muted text-pretty lg:text-[clamp(0.78125rem,calc(var(--u)*1.32),0.875rem)]">
                      <strong className="font-bold text-content">{copy.issuedBy}</strong> {copy.newHere}
                    </p>
                  </div>
                )}
              </PerWayIn>
            ) : null}
          </div>

          {/* The maker's credit for phones and tablets, where the header
              that carries it on a laptop is not shown. */}
          <p className={styles.makerBelowRow}>
            <MakerCredit />
          </p>
        </div>
      </section>
    </main>
  );
}

/**
 * A block whose wording depends on who is signing in (the card's notes and
 * foot, the sentence under the headline), laid out so that it is the same
 * height whichever of the three is chosen.
 *
 * All three versions are drawn in the same grid cell, one on top of the
 * other, and only the chosen one is shown. The cell is as tall as the
 * tallest of them, so choosing "Admin" (whose notes run a line longer) no
 * longer makes the card grow and everything in it shift under the reader's
 * eye. The two that are not shown are hidden from everything: sight,
 * screen readers, and find-in-page.
 */
function PerWayIn({
  current,
  centred = false,
  className,
  children,
}: {
  current: SignInRole;
  /** Sit a shorter version in the middle of the cell rather than at its
   *  top, for a block with a ground of its own (the card's foot). */
  centred?: boolean;
  className?: string;
  children: (copy: SignInCopy) => React.ReactNode;
}) {
  return (
    <div className={cn("grid", className)}>
      {SIGN_IN_ROLES.map((role) => (
        <div
          key={role}
          aria-hidden={role === current ? undefined : true}
          // Fades in when it becomes the chosen one, so the wording changes
          // gently rather than swapping.
          className={cn("col-start-1 row-start-1 min-w-0", centred && "self-center", role === current ? "animate-fade-in" : "invisible")}
        >
          {children(SIGN_IN_COPY[role])}
        </div>
      ))}
    </div>
  );
}
