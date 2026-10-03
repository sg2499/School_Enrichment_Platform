"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookMarked,
  Building2,
  GraduationCap,
  Info,
  KeyRound,
  Layers,
  Lock,
  type LucideIcon,
  PenLine,
  Presentation,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import { api, describeApiError, errorMessage } from "@/lib/api";
import { defaultRouteForRole, getRememberedSchoolName, setSession } from "@/lib/auth";
import { PRODUCT_CREDIT, PRODUCT_NAME } from "@/lib/brand";
import { wasRefused } from "@/lib/errors";
import { usePageTitle } from "@/lib/hooks/usePageTitle";
import { clearSignedOutNotice, readSignedOutNotice, returnPathFor } from "@/lib/sessionNotice";
import {
  DEFAULT_SIGN_IN_ROLE,
  SIGN_IN_ROLES,
  type SignInRole,
  rememberSignInRole,
  rememberedSignInRole,
  signInRoleFromIdentifier,
} from "@/lib/signInRole";
import type { LoginResponse, LoginResult, UserRole } from "@/types/auth";
import { isTwoFactorChallenge } from "@/types/auth";
import { cn, greetingForHour } from "@/lib/utils";
import { ChoosePassword, type ChoosePasswordRole } from "@/components/ChoosePassword";
import { Button } from "@/components/ui/Button";
import { CodeInput, type CodeInputHandle } from "@/components/ui/CodeInput";
import { TextField } from "@/components/ui/Field";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Lockup } from "@/components/brand/Logo";
import { AuroraBackdrop, AuroraBackdropInverse, OrbitRings } from "@/components/brand/Graphics";

/**
 * How the form speaks to each of the three kinds of people who use it
 * (3 Oct 2026, UI revamp Phase B, slice 3).
 *
 * Until this date the page had one voice for everyone: a field labelled
 * "Email, Phone, or Code", and "Your school coordinator can reset it for
 * you" -- a person who does not exist in the product. Every line here is
 * written for the person choosing that way in, and says only what is true
 * for them:
 *
 *   - What they sign in with. Students and teachers are issued a code, and
 *     can use an email instead if the school entered one; admins always
 *     use an email.
 *   - Which password. Their own. The one the school issued is good for one
 *     sign-in (they replace it straight after), so "the password your
 *     school gave you" would be wrong on every visit but the first; the
 *     first-timer's line is the "New here?" one.
 *   - Who gives them a new password. A student tells their teacher, and the
 *     school admin issues it (People > Reset Password). A teacher goes to
 *     the school admin. A school admin goes to the platform administrator.
 *   - How long a session lasts. A student's ends within 10 hours whatever
 *     happens (backend/app/services/session_service.py), so they are told
 *     so. A teacher's has no such ceiling and an admin's is 12 hours;
 *     neither line makes a claim about it.
 *   - Two-factor. Asked for at every admin sign-in once it is set up -- and
 *     a brand-new admin has not set it up yet, so the line does not say
 *     "always".
 *
 * Picking a way in changes wording only. Whoever the credentials belong to
 * is who gets signed in (lib/signInRole.ts).
 */
const WAYS_IN: Record<
  SignInRole,
  {
    tab: string;
    icon: LucideIcon;
    intro: string;
    label: string;
    placeholder: string;
    missingIdentifier: string;
    safe: string;
    forgotten: string;
    newHere: string;
  }
> = {
  STUDENT: {
    tab: "Student",
    icon: GraduationCap,
    intro: "Sign in with your student code and your password.",
    label: "Student Code or Email",
    placeholder: "STU-ABCD-0042",
    missingIdentifier: "Enter your student code. It starts with STU-.",
    safe: "On a shared computer? Sign out when you finish. A session left open ends on its own within 10 hours.",
    forgotten: "Forgotten your password? Tell your teacher. Your school admin will give you a new one.",
    // One line at the card's width, on purpose: with the school's name
    // under it, a second line pushed the column past a 640px-tall screen.
    newHere: "New here? Ask your class teacher for your student code and first password.",
  },
  TEACHER: {
    tab: "Teacher",
    icon: Presentation,
    intro: "Sign in with your teacher code or email, and your password.",
    label: "Teacher Code or Email",
    placeholder: "TCH-ABCD-0007 or you@school.edu",
    missingIdentifier: "Enter your teacher code or your email address.",
    safe: "Signing out ends your session on our servers, so a shared staff-room computer stays safe.",
    forgotten: "Forgotten your password? Your school admin can give you a temporary one.",
    newHere: "New here? Your school admin gives you your teacher code and first password.",
  },
  ADMIN: {
    tab: "Admin",
    icon: Building2,
    intro: "Sign in with your admin email and your password.",
    label: "Admin Email",
    placeholder: "you@school.edu",
    missingIdentifier: "Enter your admin email address.",
    safe: "Admin accounts are protected by two-factor. Once it is set up, every sign-in asks for a code from your authenticator app.",
    forgotten: "Forgotten your password? Your platform administrator can give you a temporary one.",
    newHere: `New here? Admin accounts are created when your school joins ${PRODUCT_NAME}.`,
  },
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
 * The five-day chapter loop, drawn the same way the student dashboard names
 * it. Showing it on the sign-in screen is deliberate: it is the one thing
 * about this product a head of school needs to understand before they have
 * an account, and it fills the brand panel with something true rather than
 * with decoration.
 */
const LOOP: { label: string; done: boolean }[] = [
  { label: "Learn", done: true },
  { label: "Practise", done: true },
  { label: "Check", done: true },
  { label: "Fix", done: false },
  { label: "Master", done: false },
];

/** The first step not yet done is the one "in progress" -- it gets the
 *  live pulse, so the loop reads as something moving rather than a static
 *  diagram with some dots coloured in. */
const CURRENT_STEP = LOOP.findIndex((step) => !step.done);

/** When each lit dot on the loop switches on, in ms after the stage is
 *  ready. The loop card itself arrives at stage-d3 (170ms) over 680ms, so
 *  the first dot lights as the card settles, and each segment then draws
 *  towards the next dot just after the dot it leaves from has lit. */
function loopLitAt(index: number) {
  return 520 + index * 180;
}

/**
 * Rendered as a full-width, three-up card grid (not squeezed into the
 * narrower headline column), so there's real room for a specific sentence
 * per card instead of a clipped fragment.
 */
/**
 * Bodies are capped at ~60 characters on purpose: each card is one of three
 * in a row, so the real column is much narrower than it looks in the source
 * -- anything longer wraps to four or five lines and blows out the panel's
 * height (this is what caused the page to need scrolling before).
 */
const PILLARS = [
  {
    icon: BookMarked,
    title: "Not a Worksheet Library",
    body: "Mapped to the real CBSE and ICSE syllabus, Class 5 to 10.",
  },
  {
    icon: Users,
    title: "Sections, Not Spreadsheets",
    body: "Assign a whole section in seconds. Gaps come back to you.",
  },
  {
    icon: PenLine,
    title: "Graded the Way Your School Grades",
    body: "Part marks and method marks — not just right or wrong.",
  },
];

const ASSURANCES = [
  { icon: ShieldCheck, label: "Server-Verified Sessions" },
  { icon: Layers, label: "A Workspace Per Role" },
  { icon: Building2, label: "Rolled Out School by School" },
];

/**
 * Writes the cursor position onto the container as CSS custom properties
 * (`--pointer-x`/`--pointer-y` normalised to -1..1, and `--pointer-px`/
 * `--pointer-py` as percentages) so decorative layers can follow it via CSS
 * alone. No React state, so moving the mouse never re-renders the form.
 *
 * Skipped entirely for coarse pointers and for anyone who has asked their OS
 * to reduce motion.
 */
function usePointerAmbience<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    function write(clientX: number, clientY: number) {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;
      el.style.setProperty("--pointer-x", (x * 2 - 1).toFixed(3));
      el.style.setProperty("--pointer-y", (y * 2 - 1).toFixed(3));
      el.style.setProperty("--pointer-px", `${(x * 100).toFixed(2)}%`);
      el.style.setProperty("--pointer-py", `${(y * 100).toFixed(2)}%`);
    }

    // Arrow consts (not hoisted declarations) so TypeScript keeps the
    // non-null narrowing of `node` inside the closures.
    const handleMove = (event: PointerEvent) => {
      node.dataset.pointer = "active";
      if (frame.current !== null) return;
      const { clientX, clientY } = event;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        write(clientX, clientY);
      });
    };

    const handleLeave = () => {
      node.dataset.pointer = "idle";
      node.style.setProperty("--pointer-x", "0");
      node.style.setProperty("--pointer-y", "0");
    };

    node.addEventListener("pointermove", handleMove);
    node.addEventListener("pointerleave", handleLeave);
    return () => {
      node.removeEventListener("pointermove", handleMove);
      node.removeEventListener("pointerleave", handleLeave);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
  }, []);

  return ref;
}

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
 * Resolved after mount only (same reasoning as `knownSchool` below): the
 * page is prerendered at build time and the server has no viewer timezone,
 * so the first paint says "Welcome Back". There is no visible swap: this
 * effect commits in the same pass as useStageReady's, while the heading's
 * .stage-in wrapper is still at opacity 0, and the stage cannot flip to
 * "ready" until at least one animation frame later.
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
  usePageTitle("Sign In");
  const stage = useStageReady();
  const greeting = useTimeOfDayGreeting();
  const brandRef = usePointerAmbience<HTMLElement>();
  const formRef = usePointerAmbience<HTMLElement>();
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
  const [submitting, setSubmitting] = useState(false);

  // Two-factor is a second step, not a second page: the challenge token
  // issued by /auth/login (see backend/app/services/auth_service.py's
  // login()) lives only in this state, never in the URL or storage -- it's
  // single-use and expires in 5 minutes, so there's nothing worth persisting.
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
  const way = WAYS_IN[signInRole];

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

  // Only known after mount (localStorage isn't available during SSR, and
  // reading it here rather than in useState's initializer keeps the first
  // server-rendered paint identical to the first client paint, so there's no
  // hydration flash from one wording to another). All of this commits while
  // the form is still at opacity 0 -- see useTimeOfDayGreeting.
  const [knownSchool, setKnownSchool] = useState<string | null>(null);
  // Why this page is showing, when the person did not come here by choice:
  // their session ended, they changed their password, they opened a page
  // that belongs to another role (lib/sessionNotice.ts). Read after mount
  // for the same reason as knownSchool.
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    setKnownSchool(getRememberedSchoolName());
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

  function handleIdentifierChange(value: string) {
    setIdentifier(value);
    const inferred = signInRoleFromIdentifier(value);
    if (inferred && inferred !== inferredRole.current) setSignInRole(inferred);
    inferredRole.current = inferred;
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
    if (!identifier.trim()) {
      setError(way.missingIdentifier);
      identifierRef.current?.focus();
      return;
    }
    if (!password) {
      setError("Enter your password.");
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
      setError(errorMessage(err, "sign you in"));
      shake(cardRef.current);
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

  return (
    <main
      data-stage={stage}
      // `lg:h-screen` (not just min-h-screen) is deliberate: below this, the
      // two columns are free to grow with their content and the page
      // scrolls normally, which is correct on a phone. At `lg` and up this
      // is a split login screen, and a split login screen that scrolls
      // reads as a mistake -- so above `lg` the row is pinned to exactly
      // one viewport and both panels are sized to actually fit inside it.
      className="relative min-h-screen bg-canvas lg:grid lg:h-screen lg:grid-cols-[1.06fr_1fr] lg:overflow-hidden xl:grid-cols-[1.12fr_1fr]"
    >
      {/* ---------------- Brand panel ---------------- */}
      {/* Every vertical measurement below this point uses clamp(min, Nvh, max)
          instead of a fixed size, on purpose: the earlier version picked one
          fixed size that happened to fit *my* estimate of a laptop viewport
          and silently clipped on anything shorter (a maximised 1366x768
          window with normal browser chrome lands well under 700px of usable
          height). clamp() scales every font, gap and padding down together
          as height shrinks and back up as it grows, so there is no single
          height this breaks at -- it degrades gracefully instead of hitting
          a wall. Verified against 640px, 700px, 800px and 1000px available
          heights by hand before shipping. */}
      <section
        ref={brandRef}
        data-pointer="idle"
        className="relative isolate hidden overflow-hidden bg-brand-gradient lg:flex lg:flex-col lg:px-12 lg:py-[clamp(0.75rem,3.5vh,3.5rem)] xl:px-16"
      >
        <AuroraBackdropInverse parallax vignette grain />
        <div aria-hidden className="pointer-spotlight pointer-events-none absolute inset-0 z-[1]" />

        {/* Orbit rings centred on the panel's top-right corner (30 Sep 2026).
            This replaces the small LearningOrbit that used to sit in the
            bottom-right corner, where at common laptop sizes it was cut in
            half by the seam with the form panel and sat on top of the
            assurance row -- it read as an overflow bug rather than art.
            Anchoring a much larger motif on a corner makes the crop the
            point. mask-fade-radial dissolves the outer rings before they
            reach the headline; the outer div owns position (translate), the
            inner one owns the pointer parallax, per the rule in globals.css
            that the two must never share an element. */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 z-[1] h-[60rem] w-[60rem] -translate-y-1/2 translate-x-1/2 mask-fade-radial"
        >
          <div className="parallax-layer parallax-1 h-full w-full">
            <OrbitRings className="absolute inset-0 animate-fade-in [animation-delay:400ms] [animation-duration:1.6s]" />
          </div>
        </div>

        {/* The seam with the form panel: a thread of light down the edge,
            brightest mid-height, so the two halves meet like a spine rather
            than a hard cut from indigo to paper. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-[2] w-px bg-gradient-to-b from-transparent via-white/25 to-transparent"
        />

        <div className="stage-in stage-d0 relative z-10 flex shrink-0 items-start justify-between gap-4">
          <Lockup tone="light" showTagline size="lg" />
          {/* Who makes it (3 Oct 2026). This chip used to read "Issued by
              <school>" -- true, but it is the form's business, and it now
              sits under the form. Up here, beside the product's name, is
              where the product says whose it is. Shown from `xl`: the name
              is one short word now, so the two fit on one row well before
              the 1360px the old two-word wordmark needed. */}
          <span className="glass-panel mt-1.5 hidden shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-[0.6875rem] font-bold uppercase tracking-eyebrow text-saffron-200 xl:inline-flex">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {PRODUCT_CREDIT}
          </span>
        </div>

        <div className="relative z-10 flex min-h-0 flex-1 flex-col justify-center gap-[clamp(0.625rem,4.5vh,3.5rem)] py-[clamp(0.5rem,3vh,2.5rem)]">
          <div>
            {/* No max-width here on purpose -- this column should use the
                same full width as the pillar grid below it, not a narrower
                cap. At the panel's real rendered width both lines run the
                full measure and only wrap where the words actually run out
                of room. */}
            {/* text-balance: when the line does have to wrap, it now breaks
                into two even lines instead of stranding "sticks." alone on
                the second (which it did at 1440x900). The warm phrase is
                nowrap so the break always falls before it -- it's the
                promise, and it reads best as one unit (a gradient clipped
                to text also restarts on every line fragment). */}
            <h1 className="stage-in stage-d1 font-display text-[clamp(1.375rem,4.5vh,3.25rem)] font-semibold leading-[1.1] tracking-[-0.022em] text-content-inverse text-balance">
              Every chapter, practised <span className="whitespace-nowrap text-gradient-warm">until it sticks.</span>
            </h1>

            <p className="stage-in stage-d2 mt-[clamp(0.25rem,1.4vh,1.25rem)] text-[clamp(0.8125rem,2.1vh,1.125rem)] leading-[1.5] text-content-inverse-muted">
              Your school&rsquo;s syllabus, the practice that follows it, and marks that mean what they mean on paper.
            </p>
          </div>

          {/* --- The five-day loop --- */}
          <div className="stage-in stage-d3 glass-panel mx-auto w-full max-w-[36rem] rounded-3xl px-[clamp(1rem,3vw,2rem)] py-[clamp(0.5rem,2.2vh,1.5rem)] text-center">
            <p className="text-[clamp(0.625rem,1.5vh,0.75rem)] font-bold uppercase tracking-eyebrow text-saffron-200">
              The five-day chapter loop
            </p>
            {/* The loop plays itself in once (30 Sep 2026): each finished
                step lights in turn and the track draws on to the next, ending
                on the in-progress step, which keeps a slow pulse. It is the
                product's core idea shown as a movement -- "you are partway
                round, and it keeps going" -- in the time it takes to read
                the headline. Driven entirely by the stage gate, so it waits
                for fonts like everything else, and collapses to its final
                state under reduced motion or without JS. */}
            <ol className="mx-auto mt-[clamp(0.375rem,1.6vh,1.25rem)] flex max-w-[27rem] items-start gap-2">
              {LOOP.map((step, index) => {
                const next = LOOP[index + 1];
                const isCurrent = index === CURRENT_STEP;
                return (
                  <li key={step.label} className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5">
                    {next ? (
                      <span
                        aria-hidden
                        className="absolute left-1/2 top-[6px] h-px w-[calc(100%+0.5rem)] bg-white/[0.18]"
                      >
                        {step.done ? (
                          <span
                            className={cn(
                              "stage-grow-x absolute inset-0",
                              // Into a finished step the track is solid;
                              // into the in-progress one it fades out
                              // partway -- underway, not arrived.
                              next.done
                                ? "bg-saffron-300/80"
                                : "bg-gradient-to-r from-saffron-300/80 via-saffron-300/30 to-transparent",
                            )}
                            style={{ "--stage-delay": `${loopLitAt(index) + 90}ms` } as React.CSSProperties}
                          />
                        ) : null}
                      </span>
                    ) : null}
                    <span className="relative z-10 flex h-3 w-3">
                      {isCurrent ? (
                        // opacity-0 base: pulse-ring's keyframes drive the
                        // opacity, and this keeps the ring invisible for the
                        // delay before it starts rather than showing a flat
                        // disc.
                        <span
                          aria-hidden
                          className="absolute inset-0 rounded-full bg-saffron-300 opacity-0 animate-pulse-ring [animation-delay:1.5s]"
                        />
                      ) : null}
                      <span
                        className={cn(
                          "relative h-3 w-3 rounded-full ring-4 transition-[background-color,box-shadow] duration-500 ease-out",
                          step.done
                            ? "bg-white/30 ring-white/[0.08] [[data-stage=ready]_&]:bg-saffron-300 [[data-stage=ready]_&]:ring-saffron-300/20"
                            : isCurrent
                              ? "bg-saffron-100/80 ring-saffron-300/25"
                              : "bg-white/30 ring-white/[0.08]",
                        )}
                        style={step.done ? { transitionDelay: `${loopLitAt(index)}ms` } : undefined}
                      />
                    </span>
                    {/* Pending labels at inverse-muted (was white/60): the
                        aurora behind this card is at its brightest here, and
                        only the 0.78 step holds AA across the whole panel. */}
                    <span
                      className={cn(
                        "text-[clamp(0.6875rem,1.5vh,0.875rem)] font-semibold leading-none",
                        step.done || isCurrent ? "text-content-inverse" : "text-content-inverse-muted",
                      )}
                    >
                      {step.label}
                      <span className="sr-only">{step.done ? " (done)" : isCurrent ? " (in progress)" : ""}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="mx-auto mt-[clamp(0.375rem,1.6vh,1.25rem)] max-w-[27rem] text-[clamp(0.6875rem,1.5vh,0.875rem)] leading-[1.4] text-content-inverse-muted">
              The same rhythm in every subject, Class 5 to 10.
            </p>
          </div>

          {/* --- Pillars: full-width cards, not a squeezed-in list --- */}
          <ul className="stage-in stage-d4 grid grid-cols-3 gap-[clamp(0.5rem,2vw,1.5rem)]">
            {PILLARS.map((pillar) => {
              const Icon = pillar.icon;
              return (
                <li
                  key={pillar.title}
                  className="group/pillar glass-panel min-w-0 rounded-2xl p-[clamp(0.625rem,2.4vh,1.75rem)] transition duration-300 hover:bg-white/[0.1]"
                >
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.1] text-saffron-200 ring-1 ring-inset ring-white/15 transition duration-300 group-hover/pillar:bg-saffron-400/20 group-hover/pillar:text-saffron-100 group-hover/pillar:ring-saffron-300/30">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <p className="mt-2 text-[clamp(0.75rem,1.9vh,1rem)] font-bold leading-snug text-content-inverse">
                    {pillar.title}
                  </p>
                  <p className="mt-1 text-[clamp(0.6875rem,1.6vh,0.9375rem)] leading-snug text-content-inverse-muted text-pretty">
                    {pillar.body}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="stage-in stage-d5 relative z-10 flex shrink-0 flex-wrap items-center justify-center gap-x-6 gap-y-1 border-t border-white/[0.12] pt-[clamp(0.5rem,1.8vh,1.5rem)]">
          {ASSURANCES.map((item) => {
            const Icon = item.icon;
            return (
              // inverse-muted, was white/70 -- see the AA note on the loop.
              <span key={item.label} className="inline-flex items-center gap-2 text-[clamp(0.6875rem,1.4vh,0.8125rem)] font-medium text-content-inverse-muted">
                <Icon className="h-4 w-4 shrink-0 text-jade-300" aria-hidden />
                {item.label}
              </span>
            );
          })}
        </div>
      </section>

      {/* ---------------- Form panel ---------------- */}
      <section
        ref={formRef}
        // Same clamp() approach as the brand panel: py-12/p-8 were fixed
        // sizes that never shrank at `lg`, which is what clipped the top of
        // the column on a short viewport.
        //
        // At `lg` the column is centred by `my-auto` on its wrapper rather
        // than by justify-center here, and this panel may scroll on its own
        // (3 Oct 2026). The sign-in and two-factor steps are sized to fit
        // one screen; the choose-a-password step, with an error showing on
        // the shortest laptops, can be a little taller than one. Centring
        // with justify-center would push that overflow off the top, where
        // no scrollbar can reach it; auto margins collapse to zero instead,
        // so the column starts at the top and the rest scrolls into view.
        className="relative flex min-h-screen flex-col justify-center overflow-hidden px-5 py-12 sm:px-8 lg:min-h-0 lg:justify-start lg:overflow-y-auto lg:overflow-x-hidden lg:px-12 lg:py-[clamp(0.75rem,4vh,4rem)] xl:px-16"
      >
        <AuroraBackdrop parallax className="lg:opacity-70" />

        {/* Compact brand header for phones/tablets */}
        <div className="stage-in stage-d0 relative z-10 mb-8 flex items-center justify-between gap-4 lg:hidden">
          <Lockup />
          <span className="hidden rounded-full border border-line bg-surface/80 px-3 py-1.5 text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-brand backdrop-blur sm:inline-flex">
            Class 5&ndash;10
          </span>
        </div>

        <div className="relative z-10 mx-auto w-full max-w-[27.5rem] lg:my-auto">
          {/* With a notice showing, the gap under this block gives back the
              height the notice's chip adds (its padding and border), so the
              column is exactly as tall as it is without one. Measured: at
              1280x640 the extra 20px pushed the last line off the screen. */}
          <div
            className={cn(
              "stage-in stage-d1 mb-5",
              notice && step === "credentials" ? "lg:mb-[clamp(0.5rem,2vh,2.25rem)]" : "lg:mb-[clamp(0.75rem,3vh,2.5rem)]",
            )}
          >
            {/* Where you are, on the one step that is numbered. The first
                screen has no chip: who is signing in is asked inside the
                card now, and that says more than "Secure School Sign-In"
                did. The choose-a-password step has none either -- its
                heading says what it is, and it is the tallest of the three,
                so it keeps the room. Kept in the flow rather than pinned to
                a corner, so it can never collide with the card on a short
                laptop screen. */}
            {step !== "twoFactor" ? null : (
              <div className="mb-3 hidden animate-fade-in lg:block lg:mb-[clamp(0.5rem,2vh,1.5rem)]">
                <span className="inline-flex items-center gap-2.5 rounded-full border border-line bg-surface/85 px-3.5 py-1.5 text-[0.8125rem] font-semibold text-content-muted shadow-xs backdrop-blur">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span aria-hidden className="absolute inline-flex h-full w-full rounded-full bg-jade-400 animate-pulse-ring" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-jade-500" />
                  </span>
                  Step 2 of 2 &middot; Two-Factor Check
                </span>
              </div>
            )}

            {/* text-display-md below `lg`: the heading previously had no
                size of its own on phones and fell back to the browser's
                default h2, which rendered smaller than the lockup above it. */}
            <h2 className="font-display text-display-md text-content text-balance lg:text-[clamp(1.375rem,4.3vh,2.5rem)] lg:leading-[1.1]">
              {step === "twoFactor" ? "Verify It’s You" : step === "choosePassword" ? "Choose Your Own Password" : greeting}
            </h2>
            {notice && step === "credentials" ? (
              // Takes the place of the standing instruction rather than
              // sitting above it: this column is sized to fit one screen at
              // `lg`, and the reason they are here is the more useful two
              // lines. brand-800 on surface-brand: 10.6:1.
              <p
                role="status"
                className="mt-3 flex max-w-[26rem] items-start gap-2.5 rounded-2xl border border-line-brand bg-surface-brand px-3.5 py-2.5 text-[0.9375rem] font-medium leading-[1.5] text-brand-800 text-pretty animate-fade-in lg:mt-[clamp(0.375rem,1.4vh,1.25rem)] lg:py-[clamp(0.25rem,0.9vh,0.625rem)] lg:text-[clamp(0.8125rem,2vh,1rem)] lg:leading-[1.45]"
              >
                <Info className="mt-[0.15em] h-[1.05em] w-[1.05em] shrink-0 text-brand-600" aria-hidden />
                <span>{notice}</span>
              </p>
            ) : (
              // Keyed by what it says, so a change of wording (another way
              // in chosen, another step reached) fades in rather than
              // swapping under the reader's eye.
              <p
                key={`${step}-${signInRole}-${useBackupCode}`}
                className="mt-3 max-w-[25rem] text-[1.0625rem] leading-[1.6] text-content-muted text-pretty animate-fade-in lg:mt-[clamp(0.375rem,1.4vh,1.25rem)] lg:text-[clamp(0.8125rem,2.2vh,1.1875rem)] lg:leading-[1.45]"
              >
                {step === "twoFactor"
                  ? useBackupCode
                    ? "Enter one of the backup codes you saved when you set up two-factor. Each one works once."
                    : "Enter the 6-digit code showing in your authenticator app."
                  : step === "choosePassword"
                    ? CHOOSE_INTRO[choosing?.role === "TEACHER" ? "TEACHER" : "STUDENT"]
                    : way.intro}
              </p>
            )}
          </div>

          {/* Wrapper owns the stage-in entrance; the card inside owns the
              error shake. Both animate `transform`, so they must not share
              an element -- the entrance's settled `transform: none` would
              otherwise be fighting the shake's keyframes. */}
          <div className="stage-in stage-d2">
            <div
              ref={cardRef}
              className="relative rounded-4xl border border-line bg-surface/95 p-6 shadow-panel backdrop-blur-xl sm:p-8 lg:p-[clamp(1rem,3.6vh,2.5rem)]"
            >
              {/* Warm light catching the card's top edge -- a hairline of
                  saffron that fades out before the corners, so the card reads
                  as a lit object on the page rather than a flat white box. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-saffron-300/80 to-transparent"
              />
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
                    trailingIcon={<ArrowRight className="h-4 w-4" />}
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
                  onSubmit={handleSubmit}
                  className={cn("space-y-5 lg:space-y-[clamp(0.625rem,2.2vh,1.625rem)]", stepSwapped && "animate-fade-up")}
                  noValidate
                >
                  {/* Asked first, because everything under it depends on
                      the answer: what the first field is called, what goes
                      in it, and who to turn to when it doesn't work. */}
                  <SegmentedControl
                    label="Who is signing in"
                    value={signInRole}
                    onChange={(role) => {
                      setSignInRole(role);
                      if (error) setError(null);
                    }}
                    segments={SIGN_IN_ROLES.map((role) => {
                      const Icon = WAYS_IN[role].icon;
                      return { key: role, label: WAYS_IN[role].tab, icon: <Icon className="h-4 w-4" /> };
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
                    onChange={(event) => setPassword(event.target.value)}
                    icon={<Lock className="h-[1.05rem] w-[1.05rem]" aria-hidden />}
                  />

                  {error ? (
                    <div
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
                    loading={submitting || redirecting}
                    loadingLabel={redirecting ? opening : "Signing you in"}
                    trailingIcon={<ArrowRight className="h-4 w-4" />}
                  >
                    Sign In
                  </Button>
                </form>
              )}

              {step === "credentials" ? (
                // Two lines, both about the person chosen above: what keeps
                // their session safe, and who gives them a new password.
                // Keyed so they change together with the choice.
                <div
                  key={signInRole}
                  className="mt-6 space-y-3 border-t border-line pt-5 animate-fade-in lg:mt-[clamp(0.75rem,2.4vh,2rem)] lg:space-y-[clamp(0.375rem,1.2vh,1rem)] lg:pt-[clamp(0.625rem,2vh,1.5rem)]"
                >
                  <p className="flex items-start gap-2.5 text-[0.875rem] leading-[1.55] text-content-muted lg:text-[clamp(0.75rem,1.7vh,0.9375rem)] lg:leading-[1.4]">
                    <ShieldCheck className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-jade-600" aria-hidden />
                    <span>{way.safe}</span>
                  </p>
                  <p className="flex items-start gap-2.5 text-[0.875rem] leading-[1.55] text-content-muted lg:text-[clamp(0.75rem,1.7vh,0.9375rem)] lg:leading-[1.4]">
                    <KeyRound className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-brand-600" aria-hidden />
                    <span>{way.forgotten}</span>
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          {step === "credentials" ? (
            <div className="stage-in stage-d3 mt-7 text-center lg:mt-[clamp(0.5rem,1.8vh,2.25rem)]">
              {/* The keyed element is inside the one that owns the page's
                  entrance, so a change of wording fades without replaying
                  the entrance. */}
              <div key={signInRole} className="space-y-2.5 animate-fade-in lg:space-y-[clamp(0.125rem,0.8vh,0.5rem)]">
              <p className="text-[0.875rem] leading-[1.55] text-content-muted text-pretty lg:text-[clamp(0.75rem,1.7vh,0.9375rem)]">
                {way.newHere}
              </p>
              {/* Which school this browser's last sign-in belonged to. It
                  used to head the brand panel as a chip; it is a fact about
                  the account, so it sits with the form. Nothing is claimed
                  on a browser that has never signed in. */}
              {knownSchool ? (
                <p className="inline-flex max-w-full items-center justify-center gap-2 text-[0.8125rem] font-semibold leading-[1.5] text-content-subtle lg:text-[clamp(0.6875rem,1.5vh,0.875rem)]">
                  <GraduationCap className="h-3.5 w-3.5 shrink-0 text-content-faint" aria-hidden />
                  <span className="truncate">Accounts here are issued by {knownSchool}</span>
                </p>
              ) : null}
              </div>
            </div>
          ) : null}

          {/* Below `lg` the brand panel is gone, so the product still has to
              say what it is somewhere. This is that, compressed. */}
          <ul className="stage-in stage-d4 mt-8 space-y-4 rounded-3xl border border-line bg-surface/70 p-5 backdrop-blur lg:hidden">
            {PILLARS.map((pillar) => {
              const Icon = pillar.icon;
              return (
                <li key={pillar.title} className="flex items-start gap-3.5">
                  <span className="mt-px inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-brand text-brand-600">
                    <Icon className="h-[1.05rem] w-[1.05rem]" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[0.875rem] font-bold leading-snug text-content">{pillar.title}</p>
                    <p className="mt-1 text-[0.8125rem] leading-[1.5] text-content-muted text-pretty">{pillar.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* The maker's credit for phones and tablets, where the brand
              panel that carries it on a laptop is not shown. */}
          <p className="stage-in stage-d4 mt-6 text-center text-[0.75rem] font-bold uppercase tracking-eyebrow text-content-faint lg:hidden">
            {PRODUCT_CREDIT}
          </p>
        </div>
      </section>
    </main>
  );
}
