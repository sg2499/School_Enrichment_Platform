import { LogoMark } from "@/components/brand/Logo";
import { AuroraBackdrop } from "@/components/brand/Graphics";

/**
 * Shown while useProtectedPage re-validates the session against
 * /api/auth/me. It's a real branded moment rather than the word "Loading",
 * because for a slow school network this is the screen a user stares at.
 *
 * If the check is still running after a few seconds, a second line eases in
 * to say so (30 Sep 2026). A spinner that never changes starts to read as
 * "frozen" at around the 4-5s mark, and on a shared school connection that
 * is exactly when a student reaches for the refresh button and starts the
 * whole check over. Pure CSS (a delayed fade), so it costs nothing on the
 * fast path, where the screen is gone long before it would appear.
 */
export function LoadingScreen({ label = "Checking your session" }: { label?: string }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-6">
      <AuroraBackdrop />
      <div className="relative flex flex-col items-center gap-5 text-center animate-fade-in">
        <span className="relative inline-flex">
          <span aria-hidden className="absolute inset-0 rounded-[13px] bg-brand-400/40 animate-pulse-ring" />
          <LogoMark className="h-14 w-14" />
        </span>
        <div className="space-y-1.5">
          <p className="font-display text-lg font-semibold text-content">{label}</p>
          <p className="text-sm text-content-subtle">One moment&hellip;</p>
        </div>
        <span aria-hidden className="relative h-1 w-40 overflow-hidden rounded-full bg-line">
          <span className="absolute inset-y-0 -left-1/2 w-1/2 rounded-full bg-brand-gradient animate-shimmer" />
        </span>
        {/* Out of flow (absolute, under the bar) so the invisible line never
            nudges the logo off true centre while it waits its turn.
            aria-hidden: the polite live region below already speaks for this
            screen, and a second announcement mid-wait would just be noise.
            Every caller today uses the default session-check label, which is
            what this copy is written for. */}
        <p
          aria-hidden
          className="absolute left-1/2 top-full mt-5 w-[18rem] -translate-x-1/2 text-[0.8125rem] leading-relaxed text-content-subtle text-balance animate-fade-in [animation-delay:4.5s]"
        >
          Still connecting. School networks can be slow &mdash; there&rsquo;s no need to refresh.
        </p>
        <span className="sr-only" role="status" aria-live="polite">
          {label}
        </span>
      </div>
    </div>
  );
}
