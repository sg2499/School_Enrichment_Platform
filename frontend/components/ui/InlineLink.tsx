import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type InlineLinkDirection = "back" | "forward";
export type InlineLinkSize = "sm" | "md";

/**
 * The product's quiet navigation link: "back to where I came from" at the
 * top of a detail view, and "see the rest of this" at the foot of a card
 * (2 Oct 2026).
 *
 * It replaces two things that were the same idea written twice -- the
 * Practice Tracker's BackLink and the dashboards' TextLink -- and both were
 * coloured text plus an arrow with no container at all: no fill, no border,
 * no padding. On a white card that just about read as a link; alone at the
 * top of a page, on bare canvas above the title, it read as a stray label
 * (Shailesh, from a screenshot: "floating text"). So this one has real
 * resting chrome, and there is exactly one of it.
 *
 * Where it sits in the family. Lighter than every Button -- shorter (h-8/h-9
 * against a small button's h-9 and a default one's h-11), no shadow, and its
 * arrow is part of the component rather than an icon the caller chooses.
 * A navigation that should carry a button's weight is still a ButtonLink
 * (Button.tsx); this is for the quiet ones.
 *
 * Structured the way Button.tsx is -- BASE, then one record per axis -- so a
 * new size or direction is a new entry, never a one-off className at a call
 * site.
 */
const BASE =
  "group inline-flex max-w-full select-none items-center gap-1.5 rounded-full border font-semibold " +
  "transition duration-200 ease-spring focus-visible:outline-none focus-visible:shadow-focus";

// The chrome is a translucent ink tint rather than a named surface, on
// purpose. This link has to sit on three different grounds -- the paper
// canvas (a failed detail view's back link, with the workspace wash behind
// it), a white card (a panel footer) and a brand-tinted card -- and a fixed fill
// disappears on one of them: surface-brand IS the brand card's colour. An
// alpha tint always lands one step darker than whatever is underneath.
//
// brand-500 at 10% works out at #EFEEF8 on white, #EBE8EE on canvas and
// #E5E2F6 on surface-brand. The label, brand-700, measures 8.9:1, 8.5:1 and
// 8.1:1 on those; on hover (brand-500 at 16%, label brand-900) 11.5:1,
// 10.9:1 and 10.5:1.
//
// The price of a translucent fill is that the backdrop shows through it, so
// the canvas figure was re-measured on the darkest pixel the workspace wash
// ever puts behind a page (components/brand/Ambience.tsx, over RoleShell's
// canvas-glow). That wash is far stronger than Phase A's was, and the pill
// still holds: brand-700 is 5.7:1 at the working level and 5.4:1 at the
// dashboard's, 7.1:1 or better on hover. On a Teacher page it is only ever
// on the canvas in one case now -- a detail view that failed to load, where
// there is no masthead to put the way back in.
const CHROME =
  "border-brand-500/15 bg-brand-500/10 text-content-brand " +
  "hover:border-brand-500/30 hover:bg-brand-500/[0.16] hover:text-brand-900 active:bg-brand-500/20";

// On indigo chrome (PageHeader's masthead) the tint is turned round: a
// brand-950 well rather than a lighter wash, for the reason MASTHEAD_WELL
// gives -- a translucent *light* fill lifts the panel's lightest pixel
// further and costs the label contrast, a dark one always adds to it. The
// label is content-inverse; on the well over the masthead's lightest
// measured pixel that is the stat cells' own figure (PageHeader.tsx has
// it), and hover deepens the well rather than lightening it, so the hover
// state can only gain contrast. Focus is the masthead's saffron ring.
const CHROME_INVERSE =
  "border-white/15 bg-brand-950/40 text-content-inverse " +
  "hover:border-white/30 hover:bg-brand-950/60 active:bg-brand-950/70";

// The arrow's side gets the tighter padding (an icon carries its own
// optical margin), and the arrow nudges the way the link travels.
const DIRECTIONS: Record<InlineLinkDirection, { pad: Record<InlineLinkSize, string>; nudge: string }> = {
  back: {
    pad: { sm: "pl-2.5 pr-3", md: "pl-3 pr-4" },
    nudge: "group-hover:-translate-x-0.5",
  },
  forward: {
    pad: { sm: "pl-3 pr-2.5", md: "pl-4 pr-3" },
    nudge: "group-hover:translate-x-0.5",
  },
};

const SIZES: Record<InlineLinkSize, { box: string; icon: string }> = {
  sm: { box: "h-8 text-[0.8125rem]", icon: "h-3.5 w-3.5" },
  md: { box: "h-9 text-sm", icon: "h-4 w-4" },
};

export interface InlineLinkProps extends Omit<React.ComponentProps<typeof Link>, "className"> {
  /** `back` leads with a left arrow; `forward` trails a right one. */
  direction?: InlineLinkDirection;
  size?: InlineLinkSize;
  /** `inverse` for a link inside indigo chrome (a masthead's back link). */
  tone?: "default" | "inverse";
  className?: string;
  children: React.ReactNode;
}

export function InlineLink({ direction = "forward", size = "md", tone = "default", className, children, ...props }: InlineLinkProps) {
  const d = DIRECTIONS[direction];
  const s = SIZES[size];
  const Arrow = direction === "back" ? ArrowLeft : ArrowRight;
  const arrow = (
    <Arrow aria-hidden className={cn("shrink-0 transition-transform duration-200 ease-spring", s.icon, d.nudge)} />
  );
  return (
    <Link className={cn(BASE, tone === "inverse" ? CHROME_INVERSE : CHROME, s.box, d.pad[size], className)} {...props}>
      {direction === "back" ? arrow : null}
      {/* Truncates rather than wraps: a back link is often a record's own
          name ("Fish Tale extra practice -- word problems with large
          numbers and estimation"), and a pill that wraps to two lines stops
          being a pill. max-w-full on the link keeps it inside its column. */}
      <span className="truncate">{children}</span>
      {direction === "forward" ? arrow : null}
    </Link>
  );
}
