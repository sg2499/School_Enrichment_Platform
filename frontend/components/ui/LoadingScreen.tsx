import { LogoMark } from "@/components/brand/Logo";
import { AuroraBackdrop } from "@/components/brand/Graphics";
import { NightBackdrop } from "@/components/brand/NightStage";
import nightStyles from "@/components/brand/night-ascent.module.css";
import type { StatusSurface } from "@/components/ui/StatusScreen";
import { cn } from "@/lib/utils";

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
 *
 * `surface` (4 Oct 2026): the page it stands on, which is the page that
 * comes next. Before a workspace page, the workspace's pale page with its
 * wash -- the default, and what every workspace page gets. Before the
 * choose-a-password page, which is on the sign-in page's night, the night:
 * a pale wait in front of a dark page was a flash of the wrong one.
 *
 * The two quiet lines are content-muted, not content-subtle: they sit
 * straight on the wash, and that is the one place subtle text is not
 * allowed (components/brand/Ambience.tsx: under 4.5:1 where the wash is
 * strongest; muted is 6.7:1 there). On the night they are the page's own
 * white at 84%, as its paragraph is.
 */
export function LoadingScreen({ label = "Checking your session", surface = "paper" }: { label?: string; surface?: StatusSurface }) {
  const night = surface === "night";
  return (
    <div
      className={cn(
        "relative flex min-h-screen items-center justify-center px-6",
        night ? nightStyles.solo : "overflow-hidden bg-canvas",
      )}
    >
      {night ? <NightBackdrop rings="centre" /> : <AuroraBackdrop />}
      <div className="relative flex flex-col items-center gap-5 text-center animate-fade-in">
        <span className="relative inline-flex">
          <span aria-hidden className={cn("absolute inset-0 rounded-[13px] animate-pulse-ring", night ? "bg-saffron-300/30" : "bg-brand-400/40")} />
          <LogoMark variant={night ? "inverse" : "brand"} className="h-14 w-14" />
        </span>
        <div className="space-y-1.5">
          <p className={cn("font-display text-lg font-semibold", night ? "text-content-inverse" : "text-content")}>{label}</p>
          <p className={cn("text-sm", night ? "text-white/[0.84]" : "text-content-muted")}>One moment&hellip;</p>
        </div>
        <span aria-hidden className={cn("relative h-1 w-40 overflow-hidden rounded-full", night ? "bg-white/15" : "bg-line")}>
          <span className={cn("absolute inset-y-0 -left-1/2 w-1/2 rounded-full animate-shimmer", night ? "bg-accent-gradient" : "bg-brand-gradient")} />
        </span>
        {/* Out of flow (absolute, under the bar) so the invisible line never
            nudges the logo off true centre while it waits its turn.
            aria-hidden: the polite live region below already speaks for this
            screen, and a second announcement mid-wait would just be noise.
            Every caller today uses the default session-check label, which is
            what this copy is written for. */}
        <p
          aria-hidden
          className={cn(
            "absolute left-1/2 top-full mt-5 w-[18rem] -translate-x-1/2 text-[0.8125rem] leading-relaxed text-balance animate-fade-in [animation-delay:4.5s]",
            night ? "text-white/[0.84]" : "text-content-muted",
          )}
        >
          Still connecting. School networks can be slow. There&rsquo;s no need to refresh.
        </p>
        <span className="sr-only" role="status" aria-live="polite">
          {label}
        </span>
      </div>
    </div>
  );
}
