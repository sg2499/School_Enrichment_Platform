/** One rounding rule for every percentage a person is shown (A-010, A-040).
 *
 *  A percentage rounds DOWN, so 6 of 9 is 66% and 17 of 21 is 80% -- never
 *  81%. The server now sends whole numbers already floored by this same rule
 *  (backend/app/core/percentages.py), so `floorPercent` is a guard for
 *  anything that still arrives with a fraction rather than the place the
 *  rounding happens.
 *
 *  `wholePercent` is for the figures the screen has to work out itself --
 *  the Super Admin "% of the question bank" and "% of the questions"
 *  (A-040), which used Math.round and so read 100% while questions were
 *  still unapproved.
 */

/** A part of a whole as a whole percent, rounded down. `null` when there is
 *  no whole to divide by, which every caller renders as a dash.
 *
 *  The multiplication comes first on purpose. `Math.floor((57 / 100) * 100)`
 *  is 56, because the division lands a hair below 0.57; `(100 * 57) / 100`
 *  is exactly 57. */
export function wholePercent(part: number | null | undefined, whole: number | null | undefined): number | null {
  if (!whole || part === null || part === undefined || Number.isNaN(part)) return null;
  return Math.floor((100 * part) / whole);
}

/** A percentage that already arrived as a number, floored. The epsilon
 *  covers a value the server computed in floating point before this rule
 *  existed, so 79.99999999 reads as 80% and not 79%. */
export function floorPercent(percent: number | null | undefined): number | null {
  if (percent === null || percent === undefined || Number.isNaN(percent)) return null;
  return Math.floor(percent + 1e-9);
}

/** "80%", or an em dash when there is no number. The one place a percentage
 *  becomes words. */
export function percentLabel(percent: number | null | undefined): string {
  const whole = floorPercent(percent);
  return whole === null ? "—" : `${whole}%`;
}
