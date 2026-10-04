import { cn } from "@/lib/utils";

/**
 * The saffron spark, lit for a real achievement (2 Oct 2026).
 *
 * Graphics.tsx describes the product's shared vocabulary as ending with "a
 * saffron spark for the moment something is achieved" -- but until now the
 * spark only ever appeared as a fixed detail inside illustrations
 * (LearningOrbit's floating star, PathIllustration's first milestone). It
 * marked no moment, because nothing triggered it. This is the same mark,
 * shown when something has actually just been finished. Its first and so
 * far only trigger is a teacher marking the last written answer on an
 * assignment: see lib/hooks/useMarkingMilestone.ts for exactly what fires
 * it, and the To Mark cell of the masthead in
 * app/teacher/tracker/assignments/[assignmentId]/page.tsx for where it
 * lands.
 *
 * Nothing here is new artwork:
 *  - the star is LearningOrbit's spark path, verbatim (the viewBox below is
 *    simply cropped to that path's own bounds);
 *  - the fill is the two-stop saffron gradient every spark and lit dot in
 *    Graphics.tsx uses (#FDDC92 -> #F08D0C: orbit-spark, path-spark),
 *    declared once more under its own id because SVG
 *    gradient ids are per document and each graphic there owns its own;
 *  - the halo is rgba(249,171,43,0.16), saffron-400 at 16%, the halo the
 *    lit milestone dots have always had;
 *  - the motion is two keyframes already in tailwind.config.ts.
 *
 * What plays, once, in about a second: a halo and a ring expand out of the
 * star and fade (pulse-ring, run a single time instead of looping), eight
 * milestone dots ride outward with them, and the star itself settles in
 * (scale-in) and stays. Deliberately no confetti, no bounce and no sound --
 * a teacher marking six assignments in a sitting will see this six times,
 * and it has to still feel like a nod on the sixth.
 *
 * Reduced motion needs no code here, which is the point of building it from
 * the existing keyframes. Every transient layer rests at opacity-0 and is
 * only ever made visible *by* its animation; the global override in
 * globals.css cuts that animation to 0.001ms, so those layers never appear.
 * What remains is the still star -- the fact of the achievement, without
 * the movement. (Its short delay is kept, as that override intends: the
 * star arrives after its tile has, rather than with it.)
 *
 * Purely decorative (aria-hidden). The caller owns the words -- a visible
 * label and a role="status" line -- so the moment is never colour-only or
 * sighted-only.
 */

// The tile this sits in arrives on a 600ms fade-up; starting at 420ms puts
// the burst on the tail of that, when the tile is all but fully opaque and
// has stopped moving, instead of firing inside a card still fading in.
const STAR_DELAY = "[animation-delay:420ms]";
const BURST_DELAY = "[animation-delay:480ms]";
const RING_DELAY = "[animation-delay:600ms]";

// pulse-ring normally loops every 2.6s as a "live" indicator. Run once and
// compressed to 1.1s it is a single outward burst: the keyframes take it
// from 0.9x to 1.5x and to fully transparent by 70%, i.e. ~770ms of visible
// motion. opacity-0 is the resting state before the delay and after the
// end (the animation has no fill mode), so nothing lingers.
const BURST = "opacity-0 animate-pulse-ring [animation-duration:1100ms] [animation-iteration-count:1]";

// Milestone dots on a 64-unit square, centred on (32,32). Four larger ones
// on the diagonals, between the star's points, and four smaller ones
// further out on its axes. Written out as literals rather than computed
// with Math.cos, so server and client can never disagree in the last
// decimal place.
const DOTS: { cx: number; cy: number; r: number }[] = [
  { cx: 45.4, cy: 18.6, r: 2 },
  { cx: 45.4, cy: 45.4, r: 2 },
  { cx: 18.6, cy: 45.4, r: 2 },
  { cx: 18.6, cy: 18.6, r: 2 },
  { cx: 32, cy: 8, r: 1.3 },
  { cx: 56, cy: 32, r: 1.3 },
  { cx: 32, cy: 56, r: 1.3 },
  { cx: 8, cy: 32, r: 1.3 },
];

export function AchievementSpark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("pointer-events-none relative inline-flex h-7 w-7 shrink-0", className)}>
      <span className={cn("absolute -inset-1 rounded-full bg-saffron-400/[0.16]", BURST, BURST_DELAY)} />
      <span className={cn("absolute -inset-1 rounded-full border border-saffron-300", BURST, RING_DELAY)} />
      <svg viewBox="0 0 64 64" role="presentation" className={cn("absolute -inset-2.5", BURST, BURST_DELAY)}>
        {DOTS.map((dot) => (
          <circle key={`${dot.cx}-${dot.cy}`} cx={dot.cx} cy={dot.cy} r={dot.r} fill="url(#achievement-spark)" />
        ))}
      </svg>
      <svg viewBox="90 62 44 44" role="presentation" className={cn("relative h-full w-full animate-scale-in", STAR_DELAY)}>
        <defs>
          <linearGradient id="achievement-spark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FDDC92" />
            <stop offset="100%" stopColor="#F08D0C" />
          </linearGradient>
        </defs>
        <path d="M112 62l6 16 16 6-16 6-6 16-6-16-16-6 16-6z" fill="url(#achievement-spark)" />
      </svg>
    </span>
  );
}
