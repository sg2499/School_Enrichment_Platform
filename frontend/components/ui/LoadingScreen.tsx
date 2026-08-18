import { LogoMark } from "@/components/brand/Logo";
import { AuroraBackdrop } from "@/components/brand/Graphics";

/**
 * Shown while useProtectedPage re-validates the session against
 * /api/auth/me. It's a real branded moment rather than the word "Loading",
 * because for a slow school network this is the screen a user stares at.
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
        <span className="sr-only" role="status" aria-live="polite">
          {label}
        </span>
      </div>
    </div>
  );
}
