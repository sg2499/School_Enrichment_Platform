import { Card, CardBody, type CardProps } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

/*
 * Two-column page layouts whose columns always finish on the same line.
 *
 * Why this exists (1 Oct 2026 polish pass). Admin, Teacher and Student
 * dashboards, Assign Practice and Curriculum Studio each set a wide card
 * beside a narrower column, and each one had been hand-rolled: one with
 * `items-start` (columns never matched height at all -- a 263px gap under
 * the teacher's shorter column), one with a stretched grid whose right-hand
 * column was a plain `space-y-4` block (the stretch happened, but nothing
 * used it -- up to 479px of bare canvas under a super admin's two cards).
 * Both left a ragged hole right above the next section. The column heights
 * are data-dependent (how many sections a teacher has, how many chapters
 * are mapped), so no fixed arrangement of cards can balance them; the
 * layout has to absorb the difference itself.
 *
 * The rule, in one place so the three dashboards can't drift apart again:
 *  1. SplitLayout is a grid that stretches every column to the row height
 *     (no `items-start`).
 *  2. SplitColumn stacks its cards as a flex column and lets exactly one of
 *     them -- the one named by `fill` -- grow into whatever height is left.
 *     Whichever column is shorter on a given day, its fill card's bottom
 *     edge lands on the taller column's bottom edge.
 *  3. A card that may grow is a StretchCard, whose body is a flex column.
 *     Inside it, the card's closing line (its call to action or dated
 *     footnote) is a PanelFooter, pinned to the bottom with `mt-auto`, so
 *     any extra height opens up *inside* the card, above a footer that sits
 *     level with its neighbour's -- a deliberate, aligned card edge rather
 *     than an orphaned gap on the canvas.
 *
 * A single-card column needs no SplitColumn: a grid item stretches on its
 * own. Use a StretchCard directly so its footer still pins.
 *
 * Not for layouts where a column is meant to be sticky (the attempt review
 * rail, teacher/tracker/attempts) -- a sticky rail must keep its own
 * height, which is what `items-start` is for there.
 */

export interface SplitLayoutProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Column template and breakpoint, e.g. "lg:grid-cols-[1.1fr_0.9fr]". */
  columns: string;
}

export function SplitLayout({ columns, className, children, ...props }: SplitLayoutProps) {
  return (
    <div className={cn("grid items-stretch gap-4", columns, className)} {...props}>
      {children}
    </div>
  );
}

const FILL = {
  first: "[&>*:first-child]:flex-1",
  last: "[&>*:last-child]:flex-1",
  none: "",
} as const;

export interface SplitColumnProps extends React.HTMLAttributes<HTMLElement> {
  /** Which card absorbs spare height when this column is the shorter one.
   *  Pick the card whose content reads best with room under it -- usually
   *  the one with a PanelFooter. */
  fill?: keyof typeof FILL;
  as?: "div" | "aside" | "section";
}

export function SplitColumn({ fill = "last", as: Tag = "div", className, children, ...props }: SplitColumnProps) {
  const Element = Tag as "div";
  return (
    <Element className={cn("flex min-w-0 flex-col gap-4", FILL[fill], className)} {...props}>
      {children}
    </Element>
  );
}

export interface StretchCardProps extends CardProps {
  /** Classes for the card body (padding overrides such as "sm:p-8"). */
  bodyClassName?: string;
}

/** A Card whose body is a flex column, so it can grow inside a SplitColumn
 *  and pin a PanelFooter to its bottom edge. Identical to Card + CardBody
 *  when it isn't being stretched. */
export function StretchCard({ className, bodyClassName, children, ...props }: StretchCardProps) {
  return (
    <Card className={cn("flex flex-col", className)} {...props}>
      <CardBody className={cn("flex flex-1 flex-col", bodyClassName)}>{children}</CardBody>
    </Card>
  );
}

/** The content of a StretchCard, laid out as a column that fills the card.
 *  `gap` replaces the `space-y-*` a panel would otherwise use (a sibling
 *  margin from space-y would cancel PanelFooter's `mt-auto`). */
export function PanelStack({
  className,
  gap = "gap-6",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { gap?: "gap-4" | "gap-5" | "gap-6" }) {
  return (
    <div className={cn("flex flex-1 flex-col", gap, className)} {...props}>
      {children}
    </div>
  );
}

/** A card's closing line -- its text action or dated footnote -- pinned to
 *  the bottom of the card behind a hairline rule, so footers in neighbouring
 *  columns sit on one line however tall each card's content runs. */
export function PanelFooter({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4", className)} {...props}>
      {children}
    </div>
  );
}
