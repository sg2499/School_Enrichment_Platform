import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// This project's own type sizes (tailwind.config.ts, fontSize). tailwind-merge
// only knows Tailwind's stock sizes, so it read `text-eyebrow` and
// `text-display-sm` as text COLOURS and dropped them whenever a real colour
// came later in the same call: cn("text-eyebrow ... text-content-brand") came
// out without its size, and the label rendered at the body's 16px instead of
// its 11px (3 Oct 2026: the Eyebrow component, and the one strong figure on
// the teacher's attempt page). Naming them here as font sizes fixes it for
// every call, including ones not written yet. Add a size to both places.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display-2xl", "display-xl", "display-lg", "display-md", "display-sm", "eyebrow"] }],
    },
  },
});

/** Compose conditional class names and let later Tailwind utilities win over
 *  earlier ones (so a component's `className` prop can always override its
 *  own defaults without specificity games). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "Good morning" / "Good afternoon" / "Good evening" from a local Date.
 *  Used for the student greeting; kept here so every surface that greets a
 *  user words it the same way. */
export function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** First letters of a person's name, for avatar fallbacks. */
export function initialsFromName(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * A class as it is said to people: "Class 5".
 *
 * A calendar entry's class is stored as the class level's code ("5"), and
 * screens put the word in front. An entry saved before 3 Oct 2026 through
 * the map form may hold the display name instead ("Class 5"); prefixing
 * that printed "Class Class 5". This says it once either way. null when
 * there is no class to name.
 */
export function classLabel(className: string | null | undefined): string | null {
  const name = (className ?? "").trim();
  if (!name) return null;
  return /^class\b/i.test(name) ? name : `Class ${name}`;
}
