"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
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
import type { LoginResult } from "@/types/auth";
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

  // Only known after mount (localStorage isn't available during SSR, and
  // reading it here rather than in useState's initializer keeps the first
  // server-rendered paint identical to the first client paint, so there's no
  // hydration flash from "Issued by your school" to the real name).
  const [knownSchool, setKnownSchool] = useState<string | null>(null);
  useEffect(() => {
    setKnownSchool(getRememberedSchoolName());
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { data } = await api.post<LoginResult>("/auth/login", { identifier, password });
      if (isTwoFactorChallenge(data)) {
        // Phase 1 scope: 2FA verification screen is not built yet (no
        // admin account will have 2FA enabled during bootstrap testing).
        setError("Two-factor authentication is required for this account. This flow isn't built in the UI yet.");
        return;
      }
      setSession(data.user);
      const normalizedRole = data.user.role === "SUPER_ADMIN" ? "ADMIN" : data.user.role;
      router.push(defaultRouteForRole(normalizedRole));
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
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
      <section
        ref={brandRef}
        data-pointer="idle"
        className="relative isolate hidden overflow-hidden bg-brand-gradient lg:flex lg:flex-col lg:px-12 lg:py-6 xl:px-16 xl:py-8"
      >
        <AuroraBackdropInverse parallax vignette />
        <div aria-hidden className="pointer-spotlight pointer-events-none absolute inset-0 z-[1]" />

        {/* Scenery, not a centrepiece: a smaller accent tucked into the
            bottom-right corner, well clear of the text column, so it never
            competes with (or gets crowded by) the copy above it. */}
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-[-12%] right-[-14%] z-[1] hidden h-[22rem] w-[22rem] lg:block xl:h-[26rem] xl:w-[26rem]"
        >
          <div className="stage-zoom stage-d2 h-full w-full">
            <div className="parallax-tilt parallax-3 h-full w-full opacity-40">
              <LearningOrbit />
            </div>
          </div>
        </div>

        <div className="stage-in stage-d0 relative z-10 flex items-start justify-between gap-4">
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

        <div className="relative z-10 mt-6 flex flex-1 flex-col justify-center gap-5 xl:mt-7 xl:gap-6">
          <div>
            {/* No max-width here on purpose -- this column should use the
                same full width as the pillar grid below it, not a narrower
                cap. At the panel's real rendered width both lines run the
                full measure and only wrap where the words actually run out
                of room. */}
            <h1 className="stage-in stage-d1 font-display text-[2.25rem] font-semibold leading-[1.1] tracking-[-0.024em] text-content-inverse xl:text-[2.875rem]">
              Every chapter, <span className="text-gradient-warm">practised until it sticks.</span>
            </h1>

            <p className="stage-in stage-d2 mt-4 text-[1rem] leading-[1.55] text-content-inverse-muted xl:text-[1.0625rem]">
              Your school&rsquo;s syllabus, the practice that follows it, and marks that mean what they mean on paper.
            </p>
          </div>

          {/* --- The five-day loop --- */}
          <div className="stage-in stage-d3 glass-panel mx-auto w-full max-w-[34rem] rounded-3xl px-7 py-4 text-center">
            <p className="text-[0.6875rem] font-bold uppercase tracking-eyebrow text-saffron-200">
              The five-day chapter loop
            </p>
            <ol className="mx-auto mt-3 flex max-w-[26rem] items-start gap-2">
              {LOOP.map((step, index) => (
                <li key={step.label} className="relative flex min-w-0 flex-1 flex-col items-center gap-2">
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
                      "text-[0.8125rem] font-semibold leading-none",
                      step.done ? "text-content-inverse" : "text-white/60",
                    )}
                  >
                    {step.label}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mx-auto mt-3 max-w-[26rem] text-[0.8125rem] leading-[1.5] text-content-inverse-muted">
              The same rhythm in every subject, Class 5 to 10.
            </p>
          </div>

          {/* --- Pillars: full-width cards, not a squeezed-in list --- */}
          <ul className="stage-in stage-d4 grid gap-4 sm:grid-cols-3">
            {PILLARS.map((pillar) => {
              const Icon = pillar.icon;
              return (
                <li
                  key={pillar.title}
                  className="group/pillar glass-panel rounded-3xl p-4 transition duration-300 hover:bg-white/[0.1]"
                >
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.1] text-saffron-200 ring-1 ring-inset ring-white/15 transition duration-300 group-hover/pillar:bg-saffron-400/20 group-hover/pillar:text-saffron-100 group-hover/pillar:ring-saffron-300/30">
                    <Icon className="h-[1.05rem] w-[1.05rem]" aria-hidden />
                  </span>
                  <p className="mt-3 text-sm font-bold leading-snug text-content-inverse">{pillar.title}</p>
                  <p className="mt-1 text-[0.8125rem] leading-snug text-content-inverse-muted text-pretty">
                    {pillar.body}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="stage-in stage-d5 relative z-10 mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-white/[0.12] pt-4">
          {ASSURANCES.map((item) => {
            const Icon = item.icon;
            return (
              <span key={item.label} className="inline-flex items-center gap-2 text-[0.8125rem] font-medium text-white/70">
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
        className="relative flex min-h-screen flex-col justify-center overflow-hidden px-5 py-12 sm:px-8 lg:min-h-0 lg:px-12 xl:px-16"
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
          <div className="stage-in stage-d1 mb-7">
            <div className="mb-4 lg:hidden">
              <LogoMark className="h-12 w-12" />
            </div>

            {/* Kept in the flow rather than pinned to a corner, so it can
                never collide with the card on a short laptop screen. The
                live dot is the one bit of motion on this side of the page. */}
            <div className="mb-4 hidden lg:block">
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

            <h2 className="font-display text-display-md text-content">Welcome Back</h2>
            <p className="mt-3 max-w-[24rem] text-[1.0625rem] leading-[1.6] text-content-muted text-pretty">
              Sign in with the email, phone number or student code your school issued you.
            </p>
          </div>

          <div className="stage-in stage-d2 rounded-4xl border border-line bg-surface/95 p-6 shadow-panel backdrop-blur-xl sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
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

            <div className="mt-6 space-y-3 border-t border-line pt-5">
              <p className="flex items-start gap-2.5 text-[0.875rem] leading-[1.55] text-content-muted">
                <ShieldCheck className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-jade-600" aria-hidden />
                <span>Your session is verified on our servers, so a shared school device stays safe.</span>
              </p>
              <p className="flex items-start gap-2.5 text-[0.875rem] leading-[1.55] text-content-muted">
                <KeyRound className="mt-0.5 h-[1.05rem] w-[1.05rem] shrink-0 text-brand-600" aria-hidden />
                <span>Forgotten your password? Your school coordinator can reset it for you.</span>
              </p>
            </div>
          </div>

          <div className="stage-in stage-d3 mt-7 space-y-2.5 text-center">
            <p className="text-[0.875rem] leading-[1.55] text-content-muted">
              New here? Accounts are created by your school &mdash; ask your class teacher or coordinator.
            </p>
            <p className="text-[0.8125rem] leading-[1.5] text-content-subtle">
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
