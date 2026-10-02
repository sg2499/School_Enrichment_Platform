"use client";

import { useCountUp } from "@/lib/hooks/useCountUp";

/**
 * A headline number that counts up to its value (2 Oct 2026) -- the stat
 * tiles on the Practice Tracker and the figures on the teacher dashboard.
 *
 * For the handful of numbers a view leads with, never for a column of
 * figures in a table: thirty cells all ticking at once is noise, and a
 * teacher reading down a column needs it to hold still.
 *
 * While the number is moving, assistive technology is given the real value
 * and the moving one is hidden from it. Without that, a screen reader that
 * reaches the tile in its first second reads out whatever intermediate
 * figure happened to be on screen ("17" for a class of 32) -- a wrong
 * number, stated as fact. Once it has settled there is a single plain text
 * node again, so copying the tile's text gives "32", not "3232".
 *
 * Motion, easing and the prefers-reduced-motion behaviour all live in
 * useCountUp.
 */
export function CountUp({
  value,
  suffix,
  durationMs,
  className,
}: {
  value: number;
  /** Printed straight after the number, e.g. "%". */
  suffix?: string;
  durationMs?: number;
  className?: string;
}) {
  const shown = useCountUp(value, durationMs);

  if (shown === value) {
    return (
      <span className={className}>
        {value}
        {suffix}
      </span>
    );
  }
  return (
    <span className={className}>
      <span aria-hidden>
        {shown}
        {suffix}
      </span>
      <span className="sr-only">
        {value}
        {suffix}
      </span>
    </span>
  );
}
