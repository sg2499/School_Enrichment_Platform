"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * How long a number takes to settle. A little longer than the 600ms
 * fade-up its tile arrives on (tailwind.config.ts), so the figure is still
 * landing for a beat after the tile has: that overlap is what makes it read
 * as counted rather than as text that faded in. On the expo curve below it
 * is within 1% of the final value by 530ms, so nobody waits for it.
 */
export const COUNT_UP_MS = 800;

/** The same deceleration as --ease-out-expo / `ease-out-expo` in the design
 *  tokens, so a number settles the way every card and dialog here does. */
function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/**
 * Whether the viewer has asked their OS to reduce motion.
 *
 * globals.css already switches every CSS animation and transition off for
 * these users, and that override is still the single place motion is
 * disabled -- but it can only reach CSS. A number ticking up is React
 * re-rendering a text node on requestAnimationFrame, which CSS cannot
 * shorten, so the same media query has to be asked here too. It is the same
 * approach the sign-in page takes for its two script-driven effects
 * (the climbing light in app/login/FiveDayAscent.tsx and shake in
 * app/login/page.tsx): one preference, read
 * in the two places it has to be, not a second setting.
 *
 * Read when an animation is about to start rather than once at load, so
 * someone who flips the setting mid-session gets it on the very next number.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// useLayoutEffect so the first frame the browser paints already shows the
// starting value; with useEffect a tile would paint its final number for one
// frame and then drop to zero and count. React warns about useLayoutEffect
// during server rendering, where it cannot run, hence the swap.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Animates a whole number towards `target` and returns the value to show
 * right now (2 Oct 2026).
 *
 * - On mount it counts up from 0.
 * - When `target` later changes (a refetch after granting an attempt, a
 *   teacher picking a mark) it moves from the number currently on screen,
 *   not from 0 again -- 12 becoming 11 should tick down by one, not replay
 *   the whole entrance on every reload.
 * - Under prefers-reduced-motion it returns `target` immediately and never
 *   schedules a frame: no animation at all, not a shortened one.
 *
 * The returned value is only ever a display value. Anything a screen reader
 * or a test should read must use `target` -- see <CountUp>, which does that
 * for you and is what most callers want.
 *
 * Server rendering and the first client render both return `target`, so
 * there is nothing to mismatch on hydration and a page without JavaScript
 * shows the real number.
 */
export function useCountUp(target: number, durationMs: number = COUNT_UP_MS): number {
  const [shown, setShown] = useState(target);
  // What is on screen at this instant. Starts at 0 so the first run counts
  // up from nothing; afterwards it tracks every frame, so an interrupted
  // run resumes from wherever it had got to.
  const current = useRef(0);

  useIsomorphicLayoutEffect(() => {
    const from = current.current;
    if (from === target || durationMs <= 0 || !Number.isFinite(target) || prefersReducedMotion()) {
      current.current = target;
      setShown(target);
      return;
    }

    // Before the browser paints (layout effect), so the run starts from
    // `from` rather than flashing `target` first.
    setShown(from);

    let frame = 0;
    let startedAt: number | null = null;
    const step = (now: number) => {
      // Timed from the first frame that actually runs, not from when the
      // effect was set up: requestAnimationFrame is paused in a background
      // tab, and this way a tab opened in the background still counts when
      // it is brought forward instead of having silently finished.
      if (startedAt === null) startedAt = now;
      const t = Math.min(1, (now - startedAt) / durationMs);
      const next = t >= 1 ? target : Math.round(from + (target - from) * easeOutExpo(t));
      current.current = next;
      setShown(next);
      if (t < 1) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return shown;
}
