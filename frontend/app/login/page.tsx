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
  KeyRound,
  Layers,
  Lock,
  PenLine,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api";
import { defaultRouteForRole, getRememberedSchoolName, setSession } from "@/lib/auth";
import type { LoginResponse, LoginResult } from "@/types/auth";
import { isTwoFactorChallenge } from "@/types/auth";
import { cn, greetingForHour } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Lockup } from "@/components/brand/Logo";
import { AuroraBackdrop, AuroraBackdropInverse, OrbitRings } from "@/components/brand/Graphics";

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
  const stage = useStageReady();
  const greeting = useTimeOfDayGreeting();
  const brandRef = usePointerAmbience<HTMLElement>();
  const formRef = usePointerAmbience<HTMLElement>();
  const cardRef = useRef<HTMLDivElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const twoFactorRef = useRef<HTMLInputElement>(null);

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
  const [verifying, setVerifying] = useState(false);

  // True from a successful sign-in until the next page takes over. Without
  // it the button snapped back to an idle "Sign In" for the second or so
  // router.push() takes to load the workspace -- which looks like the
  // sign-in failed, and invites a second click.
  const [redirecting, setRedirecting] = useState(false);

  // Whether the form has swapped between the credentials and two-factor
  // steps at least once. The incoming step only animates on a real swap;
  // on first load the card's own stage-in entrance already covers it.
  const [stepSwapped, setStepSwapped] = useState(false);

  // After a step swap, put the caret where the next keystroke belongs: the
  // code field when the 2FA challenge arrives, the (just-cleared) password
  // when going back. The code field's `autoFocus` alone never actually
  // worked -- measured against the unmodified page, focus was left on
  // <body> after the swap, so a keyboard user had to Tab to find the field
  // their authenticator code goes in. An effect runs after the new form
  // has committed, so the target always exists by then.
  useEffect(() => {
    if (!stepSwapped) return;
    (challengeToken ? twoFactorRef : passwordRef).current?.focus();
  }, [challengeToken, stepSwapped]);

  // Only known after mount (localStorage isn't available during SSR, and
  // reading it here rather than in useState's initializer keeps the first
  // server-rendered paint identical to the first client paint, so there's no
  // hydration flash from "Issued by your school" to the real name).
  const [knownSchool, setKnownSchool] = useState<string | null>(null);
  useEffect(() => {
    setKnownSchool(getRememberedSchoolName());
  }, []);

  function completeSignIn(user: LoginResponse["user"]) {
    setSession(user);
    setRedirecting(true);
    const normalizedRole = user.role === "SUPER_ADMIN" ? "ADMIN" : user.role;
    router.push(defaultRouteForRole(normalizedRole));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { data } = await api.post<LoginResult>("/auth/login", { identifier, password });
      if (isTwoFactorChallenge(data)) {
        setStepSwapped(true);
        setChallengeToken(data.challengeToken);
        return;
      }
      completeSignIn(data.user);
    } catch (err) {
      setError(apiErrorMessage(err));
      shake(cardRef.current);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyTwoFactor(event: React.FormEvent) {
    event.preventDefault();
    if (!challengeToken) return;
    setError(null);
    setVerifying(true);
    try {
      const { data } = await api.post<LoginResponse>("/auth/2fa/verify-login", {
        challengeToken,
        code: twoFactorCode,
      });
      completeSignIn(data.user);
    } catch (err) {
      setError(apiErrorMessage(err));
      shake(cardRef.current);
    } finally {
      setVerifying(false);
    }
  }

  function backToCredentials() {
    setStepSwapped(true);
    setChallengeToken(null);
    setTwoFactorCode("");
    setError(null);
    setPassword("");
  }

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
          {/* Says the one thing that is not obvious from a sign-in form:
              there is no self-serve signup, the school issues the account.
              Once someone has actually signed in on this browser before,
              this greets them by their real school instead of speaking in
              generalities. */}
          {/* Shown from 1360px rather than `xl` (1280): at exactly 1280 this
              chip and the large lockup don't both fit on one row, and the
              wordmark used to wrap to "School / Enrichment". 1360 still
              includes the 1366x768 laptops most schools actually own. */}
          <span className="glass-panel mt-1.5 hidden shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-[0.6875rem] font-bold uppercase tracking-eyebrow text-saffron-200 min-[1360px]:inline-flex">
            <GraduationCap className="h-3.5 w-3.5" aria-hidden />
            {knownSchool ? `Issued by ${knownSchool}` : "Issued by Your School"}
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
        // sizes that never shrank at `lg`, which is what clipped the
        // "Secure School Sign-In" chip at the top on a short viewport.
        className="relative flex min-h-screen flex-col justify-center overflow-hidden px-5 py-12 sm:px-8 lg:min-h-0 lg:justify-center lg:px-12 lg:py-[clamp(0.75rem,4vh,4rem)] xl:px-16"
      >
        <AuroraBackdrop parallax className="lg:opacity-70" />

        {/* Compact brand header for phones/tablets */}
        <div className="stage-in stage-d0 relative z-10 mb-8 flex items-center justify-between gap-4 lg:hidden">
          <Lockup />
          <span className="hidden rounded-full border border-line bg-surface/80 px-3 py-1.5 text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-brand backdrop-blur sm:inline-flex">
            Class 5&ndash;10
          </span>
        </div>

        <div className="relative z-10 mx-auto w-full max-w-[27.5rem]">
          {/* (A second, standalone 48px LogoMark used to sit here below
              `lg`, directly under the compact lockup above -- two copies of
              the mark stacked on a phone screen. The lockup alone is the
              brand moment now.) */}
          <div className="stage-in stage-d1 mb-5 lg:mb-[clamp(0.75rem,3.5vh,3rem)]">

            {/* Kept in the flow rather than pinned to a corner, so it can
                never collide with the card on a short laptop screen. The
                live dot is the one bit of motion on this side of the page. */}
            <div className="mb-3 hidden lg:block lg:mb-[clamp(0.5rem,2vh,1.5rem)]">
              <span className="inline-flex items-center gap-2.5 rounded-full border border-line bg-surface/85 px-3.5 py-1.5 text-[0.8125rem] font-semibold text-content-muted shadow-xs backdrop-blur">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span
                    aria-hidden
                    className="absolute inline-flex h-full w-full rounded-full bg-jade-400 animate-pulse-ring"
                  />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-jade-500" />
                </span>
                {/* Tracks the step, so the second screen says where you are
                    in the process rather than repeating itself. */}
                {challengeToken ? "Step 2 of 2 \u00b7 Two-Factor Check" : "Secure School Sign-In"}
              </span>
            </div>

            {/* text-display-md below `lg`: the heading previously had no
                size of its own on phones and fell back to the browser's
                default h2, which rendered smaller than the lockup above it. */}
            <h2 className="font-display text-display-md text-content text-balance lg:text-[clamp(1.375rem,4.3vh,2.5rem)] lg:leading-[1.1]">
              {challengeToken ? "Verify It's You" : greeting}
            </h2>
            <p className="mt-3 max-w-[24rem] text-[1.0625rem] leading-[1.6] text-content-muted text-pretty lg:mt-[clamp(0.375rem,1.4vh,1.25rem)] lg:text-[clamp(0.8125rem,2.2vh,1.1875rem)] lg:leading-[1.45]">
              {challengeToken
                ? "Enter the 6-digit code from your authenticator app, or one of your backup codes."
                : "Sign in with the email, phone number or student code your school issued you."}
            </p>
          </div>

          {/* Wrapper owns the stage-in entrance; the card inside owns the
              error shake. Both animate `transform`, so they must not share
              an element -- the entrance's settled `transform: none` would
              otherwise be fighting the shake's keyframes. */}
          <div className="stage-in stage-d2">
            <div
              ref={cardRef}
              className="relative rounded-4xl border border-line bg-surface/95 p-6 shadow-panel backdrop-blur-xl sm:p-8 lg:p-[clamp(1rem,4vh,2.75rem)]"
            >
              {/* Warm light catching the card's top edge -- a hairline of
                  saffron that fades out before the corners, so the card reads
                  as a lit object on the page rather than a flat white box. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-saffron-300/80 to-transparent"
              />
              {challengeToken ? (
                <form
                  onSubmit={handleVerifyTwoFactor}
                  className={cn("space-y-5 lg:space-y-[clamp(0.625rem,2.6vh,1.75rem)]", stepSwapped && "animate-fade-up")}
                  noValidate
                >
                  <TextField
                    ref={twoFactorRef}
                    id="twoFactorCode"
                    name="twoFactorCode"
                    label="Authentication Code"
                    autoComplete="one-time-code"
                    inputMode="text"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="123456 or a backup code"
                    required
                    autoFocus
                    value={twoFactorCode}
                    onChange={(event) => setTwoFactorCode(event.target.value)}
                    icon={<ShieldCheck className="h-[1.05rem] w-[1.05rem]" aria-hidden />}
                    // Codes are read off a phone and typed digit by digit, so
                    // they get tabular figures and air between characters --
                    // "482 913" is far easier to check at a glance than
                    // "482913". The placeholder keeps normal spacing.
                    className="font-semibold tabular-nums tracking-[0.18em] placeholder:font-normal placeholder:tracking-normal"
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
                    loading={verifying || redirecting}
                    loadingLabel={redirecting ? "Opening your workspace" : "Verifying"}
                    trailingIcon={<ArrowRight className="h-4 w-4" />}
                  >
                    Verify &amp; Sign In
                  </Button>

                  <button
                    type="button"
                    onClick={backToCredentials}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl py-2 text-[0.8125rem] font-semibold text-content-subtle transition hover:text-content-brand"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                    Back to sign in
                  </button>
                </form>
              ) : (
                <form
                  onSubmit={handleSubmit}
                  className={cn("space-y-5 lg:space-y-[clamp(0.625rem,2.6vh,1.75rem)]", stepSwapped && "animate-fade-up")}
                  noValidate
                >
                  <TextField
                    id="identifier"
                    name="identifier"
                    label="Email, Phone, or Code"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="you@school.edu or STU-1042"
                    required
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
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
                    loadingLabel={redirecting ? "Opening your workspace" : "Signing you in"}
                    trailingIcon={<ArrowRight className="h-4 w-4" />}
                  >
                    Sign In
                  </Button>
                </form>
              )}

              <div className="mt-6 space-y-3 border-t border-line pt-5 lg:mt-[clamp(0.75rem,2.8vh,2.25rem)] lg:space-y-[clamp(0.375rem,1.2vh,1rem)] lg:pt-[clamp(0.625rem,2.2vh,1.75rem)]">
                <p className="flex items-start gap-2.5 text-[0.875rem] leading-[1.55] text-content-muted lg:text-[clamp(0.75rem,1.7vh,0.9375rem)] lg:leading-[1.4]">
                  <ShieldCheck className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-jade-600" aria-hidden />
                  <span>Your session is verified on our servers, so a shared school device stays safe.</span>
                </p>
                <p className="flex items-start gap-2.5 text-[0.875rem] leading-[1.55] text-content-muted lg:text-[clamp(0.75rem,1.7vh,0.9375rem)] lg:leading-[1.4]">
                  <KeyRound className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-brand-600" aria-hidden />
                  <span>Forgotten your password? Your school coordinator can reset it for you.</span>
                </p>
              </div>
            </div>
          </div>

          <div className="stage-in stage-d3 mt-7 space-y-2.5 text-center lg:mt-[clamp(0.75rem,2.8vh,2.5rem)] lg:space-y-2">
            <p className="text-[0.875rem] leading-[1.55] text-content-muted lg:text-[clamp(0.75rem,1.7vh,0.9375rem)]">
              New here? Accounts are created by your school &mdash; ask your class teacher or coordinator.
            </p>
            <p className="text-[0.8125rem] leading-[1.5] text-content-subtle lg:text-[clamp(0.6875rem,1.5vh,0.875rem)]">
              Students &middot; Teachers &middot; School Admins &mdash; one sign-in, the right workspace.
            </p>
          </div>

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
        </div>
      </section>
    </main>
  );
}
