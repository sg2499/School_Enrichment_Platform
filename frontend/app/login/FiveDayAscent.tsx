"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Building2, Layers, Pause, Play, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import styles from "@/components/brand/night-ascent.module.css";

/**
 * The five-day chapter loop, as five steps the light climbs.
 *
 * Showing the loop on the sign-in screen is deliberate: it is the one thing
 * about this product a head of school needs to understand before they have
 * an account. It is the pattern the programme's owner confirmed as the base
 * design for every chapter, and the one the chapter content is organised by
 * (backend/app/services/learning_service.py, DEFAULT_PACING_DAY):
 *
 *   Day 1  learn the idea, with a starting check     -> Learn
 *   Day 2  guided practice                           -> Practise
 *   Day 3  apply it in a problem or a case           -> Apply
 *   Day 4  extra practice on what was weak           -> Fix
 *   Day 5  a short final check, and the challenge    -> Master
 *
 * One word a day, so each is a summary, not a specification. What the page
 * does NOT say is that work is released day by day: that schedule is not
 * enforced yet (practice arrives when a teacher assigns it), which is why
 * the caption speaks of what every chapter is built around and not of what
 * happens on which day.
 */
const DAYS = ["Learn", "Practise", "Apply", "Fix", "Master"] as const;

/**
 * Which step the light stands on at each beat. It climbs one step a beat,
 * rests on the last for three, and starts again: the rest is what makes the
 * top read as somewhere arrived at rather than as one more frame.
 */
const CLIMB = [0, 1, 2, 3, 4, 4, 4];
const BEAT_MS = 1500;

/** Tailwind's `lg`: the width from which the steps are shown at all
 *  (night-ascent.module.css). */
const LAPTOP_MIN_WIDTH = 1024;

/** Where the light stands when nothing is moving: without JavaScript, under
 *  reduced motion, and before the page has finished arriving. Three steps
 *  done, two to go -- partway round, which is what the loop is. */
const AT_REST = 2;

const ASSURANCES = [
  { icon: ShieldCheck, label: "Server-Verified Sessions" },
  { icon: Layers, label: "A Workspace per Role" },
  { icon: Building2, label: "Rolled Out School by School" },
];

export function FiveDayAscent({
  arrived,
  paused,
  onPausedChange,
  className,
}: {
  /** True once the page has arrived (fonts in, first frame painted), so the
   *  climb never starts behind the entrance. */
  arrived: boolean;
  /** Whether the person has stopped the page's motion. The page owns this:
   *  the same switch holds the night behind everything still. */
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
  className?: string;
}) {
  const [reached, setReached] = useState(AT_REST);
  // Whether anything here moves at all. It does not for someone who has
  // asked their device for less motion (they get the resting picture, which
  // says the same thing) or on a phone (where the steps are not shown) --
  // and then there is no switch either, for motion that is not there.
  const [moves, setMoves] = useState(false);
  // Where in the climb the light is, kept across a pause so that Play picks
  // up from the step it stopped on rather than from the bottom.
  const beat = useRef(-1);
  const captionId = useId();

  useEffect(() => {
    if (!arrived || typeof window.matchMedia !== "function") return;
    // The steps are only on screen on a laptop and larger; on a phone there
    // is nothing to move and no switch to stop it with, so no timer runs.
    // Watched rather than read once: a window can be widened, and the
    // setting can be changed, while the page is open.
    const query = window.matchMedia(`(min-width: ${LAPTOP_MIN_WIDTH}px) and (prefers-reduced-motion: no-preference)`);
    const apply = () => setMoves(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [arrived]);

  useEffect(() => {
    if (!moves || paused) return;

    let timer: number | null = null;
    const step = () => {
      beat.current = (beat.current + 1) % CLIMB.length;
      setReached(CLIMB[beat.current]);
    };
    const start = () => {
      if (timer === null) timer = window.setInterval(step, BEAT_MS);
    };
    const stop = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    };
    // Nothing climbs in a tab nobody is looking at.
    const onVisibility = () => (document.hidden ? stop() : start());

    // The first time, the light comes down to the first step and climbs
    // from there.
    if (beat.current < 0) step();
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [moves, paused]);

  return (
    <div className={cn(styles.stage, className)}>
      <div className={styles.caption}>
        <span id={captionId} className={styles.captionLabel}>
          The five-day chapter loop
        </span>
        {/* The light climbs for as long as the page is open, so it can be
            stopped: motion that does not end has to have an off switch for
            the people it gets in the way of. The same switch stills the
            night behind the page. */}
        {moves ? (
          <button
            type="button"
            className={styles.motion}
            onClick={() => onPausedChange(!paused)}
            title={paused ? "Play the animation" : "Pause the animation"}
          >
            {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
            <span className="sr-only">{paused ? "Play the animation" : "Pause the animation"}</span>
          </button>
        ) : null}
        <span aria-hidden className={styles.captionRule} />
        <span className={styles.captionLine}>The rhythm every chapter is built around.</span>
      </div>

      {/* A list of five days. Which one is lit changes every second and a
          half and means nothing to someone listening, so it is not
          announced: the list reads "Day 1, Learn" to "Day 5, Master". */}
      <ol className={styles.steps} aria-labelledby={captionId}>
        <li aria-hidden className={styles.light} style={{ "--i": reached } as React.CSSProperties} />
        {DAYS.map((day, index) => (
          <li
            key={day}
            className={cn(styles.step, index <= reached && styles.lit)}
            style={{ "--n": index } as React.CSSProperties}
          >
            <span aria-hidden className={styles.stepSide} />
            <span aria-hidden className={styles.stepTop} />
            <span className={styles.stepFace}>
              <span className={styles.stepDay}>Day {index + 1}</span>
              <span className={cn("font-display", styles.stepName)}>{day}</span>
              <span aria-hidden className={cn("font-display", styles.stepNumber)}>
                {index + 1}
              </span>
            </span>
          </li>
        ))}
      </ol>

    </div>
  );
}

/**
 * Three things that are true of every sign-in, as one bar under the steps.
 *
 * A sibling of the steps on the page, not part of them (4 Oct 2026): the
 * space between the two is one of the three gaps the panel shares its spare
 * height between (night-ascent.module.css, .hero), and only things that are
 * laid out side by side in the panel can share it. Inside the steps' own
 * box the gap was a fixed sliver, and the bar read as the staircase's base.
 */
export function Assurances({ className }: { className?: string }) {
  return (
    <ul className={cn(styles.assurances, className)}>
      {ASSURANCES.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.label}>
            <Icon aria-hidden />
            {item.label}
          </li>
        );
      })}
    </ul>
  );
}
