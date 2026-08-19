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
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Lockup, LogoMark } from "@/components/brand/Logo";
import { AuroraBackdrop, AuroraBackdropInverse, LearningOrbit } from "@/components/brand/Graphics";

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

export default function LoginPage() {
  const router = useRouter();
  const stage = useStageReady();
  const brandRef = usePointerAmbience<HTMLElement>();
  const formRef = usePointerAmbience<HTMLElement>();

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
        setChallengeToken(data.challengeToken);
        return;
      }
      completeSignIn(data.user);
    } catch (err) {
      setError(apiErrorMessage(err));
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
    } finally {
      setVerifying(false);
    }
  }

  function backToCredentials() {
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
        <AuroraBackdropInverse parallax vignette />
        <div aria-hidden className="pointer-spotlight pointer-events-none absolute inset-0 z-[1]" />

        {/* Purely decorative, so it's the first thing to go rather than the
            first thing to overlap something real: hidden below 760px of
            actual viewport height instead of being shrunk to try to coexist
            with the pillar row underneath it. */}
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-[-8%] right-[-10%] z-[1] hidden h-64 w-64 opacity-40 [@media(min-height:760px)]:lg:block xl:h-72 xl:w-72"
        >
          <div className="parallax-tilt parallax-2 h-full w-full">
            <LearningOrbit />
          </div>
        </div>

        <div className="stage-in stage-d0 relative z-10 flex shrink-0 items-start justify-between gap-4">
          <Lockup tone="light" showTagline size="lg" />
          {/* Says the one thing that is not obvious from a sign-in form:
              there is no self-serve signup, the school issues the account.
              Once someone has actually signed in on this browser before,
              this greets them by their real school instead of speaking in
              generalities. */}
          <span className="glass-panel mt-1.5 hidden shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-[0.6875rem] font-bold uppercase tracking-eyebrow text-saffron-200 xl:inline-flex">
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
            <h1 className="stage-in stage-d1 font-display text-[clamp(1.375rem,4.5vh,3.25rem)] font-semibold leading-[1.1] tracking-[-0.022em] text-content-inverse">
              Every chapter, <span className="text-gradient-warm">practised until it sticks.</span>
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
            <ol className="mx-auto mt-[clamp(0.375rem,1.6vh,1.25rem)] flex max-w-[27rem] items-start gap-2">
              {LOOP.map((step, index) => (
                <li key={step.label} className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5">
                  {index < LOOP.length - 1 ? (
                    <span
                      aria-hidden
                      className="absolute left-1/2 top-[6px] h-px w-[calc(100%+0.5rem)] bg-white/[0.18]"
                    />
                  ) : null}
                  <span
                    className={cn(
                      "relative z-10 h-3 w-3 rounded-full ring-4",
                      step.done ? "bg-saffron-300 ring-saffron-300/20" : "bg-white/30 ring-white/[0.08]",
                    )}
                  />
                  <span
                    className={cn(
                      "text-[clamp(0.6875rem,1.5vh,0.875rem)] font-semibold leading-none",
                      step.done ? "text-content-inverse" : "text-white/60",
                    )}
                  >
                    {step.label}
                  </span>
                </li>
              ))}
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
              <span key={item.label} className="inline-flex items-center gap-2 text-[clamp(0.6875rem,1.4vh,0.8125rem)] font-medium text-white/70">
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
          <div className="stage-in stage-d1 mb-4 lg:mb-[clamp(0.75rem,3.5vh,3rem)]">
            <div className="mb-4 lg:hidden">
              <LogoMark className="h-12 w-12" />
            </div>

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
                Secure School Sign-In
              </span>
            </div>

            <h2 className="font-display text-content lg:text-[clamp(1.375rem,4.3vh,2.5rem)]">
              {challengeToken ? "Verify It's You" : "Welcome Back"}
            </h2>
            <p className="mt-3 max-w-[24rem] text-[1.0625rem] leading-[1.6] text-content-muted text-pretty lg:mt-[clamp(0.375rem,1.4vh,1.25rem)] lg:text-[clamp(0.8125rem,2.2vh,1.1875rem)] lg:leading-[1.45]">
              {challengeToken
                ? "Enter the 6-digit code from your authenticator app, or one of your backup codes."
                : "Sign in with the email, phone number or student code your school issued you."}
            </p>
          </div>

          <div className="stage-in stage-d2 rounded-4xl border border-line bg-surface/95 p-6 shadow-panel backdrop-blur-xl sm:p-8 lg:p-[clamp(1rem,4vh,2.75rem)]">
            {challengeToken ? (
              <form
                onSubmit={handleVerifyTwoFactor}
                className="space-y-5 lg:space-y-[clamp(0.625rem,2.6vh,1.75rem)]"
                noValidate
              >
                <TextField
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
                  loading={verifying}
                  loadingLabel="Verifying"
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
              <form onSubmit={handleSubmit} className="space-y-5 lg:space-y-[clamp(0.625rem,2.6vh,1.75rem)]" noValidate>
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
                  loading={submitting}
                  loadingLabel="Signing you in"
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
