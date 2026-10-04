import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/Badge";
import { CountUp } from "@/components/ui/CountUp";
import { AuroraBackdropInverse } from "@/components/brand/Graphics";

/** One labelled piece of metadata about the record a page is showing:
 *  "Due · 5 Oct", "Questions · 8". See `facts` below. */
export interface PageHeaderFact {
  /** The short noun the value answers to. Title Case, like every label. */
  label: string;
  value: React.ReactNode;
  /** A 14px lucide glyph. Decorative -- the label carries the meaning. */
  icon?: React.ReactNode;
}

/** One headline figure in a masthead's stat strip. See `stats` below. */
export interface PageHeaderStat {
  label: string;
  /** A plain number counts up when the masthead appears and moves from its
   *  old value when it changes (useCountUp; it stands still under
   *  prefers-reduced-motion). `null` means "not loaded yet" and draws a
   *  placeholder bar. Anything else -- a "—" for a source that failed, a
   *  composed "4 of 6" -- is rendered exactly as given. */
  value: React.ReactNode;
  hint?: React.ReactNode;
  /** `attention`: something is waiting on the teacher. `good`: something is
   *  finished. The label and hint say the same in words, so the tint is
   *  never the only carrier (WCAG 1.4.1). */
  tone?: keyof typeof MASTHEAD_WELL;
  /** A small mark in the cell's top-right corner, for the rare figure that
   *  has something to celebrate (the AchievementSpark on To Mark). */
  adornment?: React.ReactNode;
}

interface PageHeaderCommon {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}

/** The header every Admin and Student page uses, and a Teacher detail view:
 *  text set directly on the page canvas. Unchanged by the masthead. */
export interface PlainPageHeaderProps extends PageHeaderCommon {
  surface?: "plain";
  /** Structured metadata for a detail view, instead of a joined sentence. */
  facts?: PageHeaderFact[];
}

/** The lit indigo panel a Teacher landing or overview screen opens with.
 *  The long note above MastheadHeader has the reasoning. */
export interface MastheadPageHeaderProps extends PageHeaderCommon {
  surface: "masthead";
  /** The page's headline figures, drawn as a strip of cells along the
   *  masthead's foot. */
  stats?: PageHeaderStat[];
  /** `lg` is the dashboard's: the title one size up from `xl`, because a
   *  welcome is a greeting and every other title is a label. */
  size?: "md" | "lg";
  /** Lets the aurora drift. Off by default: only the dashboard, the one
   *  screen a teacher arrives at rather than works on, turns it on -- see
   *  MASTHEAD_AURORA. */
  drift?: boolean;
  /** Anything the page wants inside the panel beneath the stats: the
   *  dashboard's next step, Assign Practice's three choices. Build it from
   *  MASTHEAD_WELL so its text sits on a measured surface. */
  children?: React.ReactNode;
  /** A detail view's structured metadata, drawn as one well under the
   *  title -- the masthead's version of the plain header's `facts` band.
   *  `meta` badges sit in the well's first cell when facts are given
   *  (state first, then the details), so pass them with `onDark`. */
  facts?: PageHeaderFact[];
  /** The "back to where I came from" link of a detail view, drawn above the
   *  eyebrow inside the panel: pass an <InlineLink tone="inverse">. It used
   *  to sit on the canvas above the header, which was right while the
   *  header was text on the canvas too; above a panel it would be the one
   *  loose thing left on the page. */
  back?: React.ReactNode;
}

export type PageHeaderProps = PlainPageHeaderProps | MastheadPageHeaderProps;

/** Consistent top-of-page block: eyebrow, display title, one line of context,
 *  and a right-aligned action slot.
 *
 *  Enters with the same fade-up the page cards already use (30 Sep 2026).
 *  Every page staggers its cards at 0/70/140ms but the title used to just
 *  *be there*, so the choreography started halfway down the screen; now
 *  the title leads and the cards follow it. Reduced-motion users get it
 *  instantly via the global override in globals.css. */
export function PageHeader(props: PageHeaderProps) {
  if (props.surface === "masthead") return <MastheadHeader {...props} />;

  const { eyebrow, title, description, facts, actions, meta, className } = props;
  const factList = facts ?? [];
  return (
    <header className={cn("flex flex-col gap-5 animate-fade-up lg:flex-row lg:items-end lg:justify-between", className)}>
      <div className="min-w-0 space-y-2">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className="font-display text-display-md text-balance text-content sm:text-display-lg">{title}</h1>
        {/* No max-w cap here (19 Aug 2026, Shailesh: this was wrapping onto a
            second line with plenty of room left on the first) --
            max-w-prose is a 65-character reading-width limit meant for a
            paragraph of body text, not a single header sentence sitting in
            a wide flex row that's already bounded by the page's own
            max-w-shell container and the actions slot beside it. Letting it
            fill the space it actually has means it only wraps when the
            container genuinely runs out of room. */}
        {description ? (
          <p className="text-[0.9375rem] leading-relaxed text-content-muted text-pretty">{description}</p>
        ) : null}
        {/* `facts` (2 Oct 2026). A detail view's header used to carry its
            metadata as one sentence joined with middle dots, in the
            description slot: "Set by you on 20 Aug · Due 25 Aug · 8
            questions · Up to 3 attempts each". Four unrelated facts in one
            run of same-weight grey text, under a title and above a row of
            badges, read as loose text rather than as a header (Shailesh,
            from a screenshot of the assignment view). The sentence was the
            problem, not its styling: there was nothing for the eye to
            separate one fact from the next with.

            So structured metadata is now passed as data and drawn as what
            it is -- a description list. Each fact is a quiet label and a
            strong value, led by a glyph, and the set sits in one hairline
            band so it reads as a single object belonging to the title. The
            band is the same frosted chip RoleShell's breadcrumb uses
            (border-line, surface at 70%, shadow-xs), so nothing new enters
            the chrome vocabulary. `meta` badges, when there are any, sit in
            the band's first cell: state first, then the details.

            `description` is untouched on this path. A page with one line of
            context (every Admin and Student page) still renders exactly
            the sentence it did. The first version of this note went further
            and argued that "a single sentence under a title is already
            resolved, and a box around it would be decoration" -- which is
            true of a box, and was the wrong conclusion to draw from it. The
            three most-visited Teacher screens kept a bare sentence on the
            canvas and still read as floating text. The answer there turned
            out not to be a box round the sentence but a surface under the
            whole header, carrying the page's own figures: see
            MastheadHeader below.

            No page passes `facts` to the plain header today: the three
            Teacher detail views it was built for moved to the masthead
            (which draws the same list as a well), and no Admin or Student
            page has used it yet. It stays because it is the right shape
            for their detail views when they come, and those have no
            ambience behind them.

            Contrast inside the band on plain canvas (surface at 70% over
            it): label content-subtle 6.3:1, value content 16.6:1. The
            glyphs are content-faint, 4.5:1 -- they are decorative (the
            label says what each fact is), and that is past the 3:1 WCAG
            1.4.11 asks of a graphic. */}
        {factList.length > 0 ? (
          <div className="pt-1.5">
            <div className="inline-flex max-w-full flex-wrap items-center gap-x-5 gap-y-2.5 rounded-2xl border border-line bg-surface/70 px-4 py-2.5 shadow-xs backdrop-blur">
              {meta ? <div className="flex flex-wrap items-center gap-2">{meta}</div> : null}
              <dl className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
                {factList.map((fact) => (
                  <div key={fact.label} className="flex min-w-0 items-center gap-2 text-[0.8125rem] leading-5">
                    {fact.icon ? (
                      <span aria-hidden className="inline-flex shrink-0 text-content-faint">
                        {fact.icon}
                      </span>
                    ) : null}
                    <dt className="shrink-0 text-content-subtle">{fact.label}</dt>
                    <dd className="min-w-0 font-semibold text-content">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        ) : meta ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">{meta}</div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}

// --- masthead ------------------------------------------------------------------

/*
 * The masthead (2 Oct 2026) -- the header as a lit surface.
 *
 * Why it exists. Phase A gave detail views the `facts` band and left every
 * one-sentence header exactly as it was: eyebrow, title and a line of muted
 * grey, set straight on the page canvas. Shailesh, looking at it live: "I do
 * not see much of a difference. The hero sections are still floating text
 * and only the buttons were elevated." He was right, and the reason is
 * structural rather than cosmetic. Every other object on a Teacher screen
 * is a card with an edge, a fill and a shadow. The header was the only
 * thing on the page with none of those -- so however its type was set, it
 * read as the gap above the content rather than as the top of it.
 *
 * What it is. The whole header -- eyebrow, title, context, badges, actions
 * and the page's headline numbers -- on one inverse panel: brand-gradient
 * with the aurora in it. That is not a new surface. It is the construction
 * the student dashboard's hero and the sign-in page's brand panel already
 * share (an indigo gradient carrying AuroraBackdropInverse), so the three
 * places a person lands -- sign-in, a student's home, a teacher's workspace
 * -- now open on the same material, and it is the rail's material too, so
 * the two indigo surfaces on screen frame the paper between them.
 *
 * Why not a box round the sentence. That was the idea the first note in
 * this file warned against, and the warning holds: a bordered chip holding
 * one sentence is decoration. A masthead earns its edges by carrying things
 * -- the page's own figures move into it (`stats`), so the first thing a
 * teacher reads under "Practice Tracker" is "6 waiting for marks", not a
 * description of what a tracker is. Where a row of figures already existed
 * on the page it has moved up into the masthead rather than being repeated;
 * the Practice Tracker is now two objects (masthead, workspace) where it
 * was three bands (loose header, tile row, card).
 *
 * Scope. All six Teacher screens. The dashboard, Assign Practice and the
 * Practice Tracker list took it first; the three tracker detail views (an
 * assignment, a student, an attempt) followed the same day, because a list
 * that opens on a lit panel and a row that opens on bare text is the same
 * complaint one click later. On a detail view the masthead also carries
 * the way back (`back`) and the record's metadata (`facts`, the plain
 * header's hairline band redrawn as a well). Admin and Student pages do not
 * pass `surface` and are untouched.
 *
 * Contrast. Measured, not estimated, and at the worst pixel rather than a
 * typical one -- the same standard as the inverse ramp in
 * tailwind.config.ts ("measured against the lightest point of that chrome,
 * not its average"). The production build was rendered in Chromium with the
 * masthead's contents hidden, and every pixel of the bare panel read back
 * (less a 3px rim and the rounded corners, whose antialiasing against the
 * paper is not somewhere text can sit) -- all six screens, in their loaded,
 * empty and failed states where they have them, at twelve widths from 320
 * to 2560px, with the rail expanded and collapsed. The dashboard's panel
 * drifts, so it was read at every combination of its four animations'
 * keyframe stops (48 poses) plus six to eight random phases per load, not
 * at one frame. About 2,000 screenshots.
 *
 * The lightest pixel anywhere is rgb(91,79,141), on a 320px phone, where
 * the aurora's indigo and saffron blobs overlap (the dashboard's lightest,
 * mid-drift, is rgb(87,78,151), within a hair of it). Against that pixel:
 *
 *   on the open panel   title, content-inverse           7.1:1
 *                       sentence, content-inverse-muted  5.1:1
 *                       eyebrow, saffron-200             5.4:1
 *                       inverse Badge (white at 12%)     5.3:1
 *
 * Two things sit on the open panel at display size, where WCAG asks 3:1:
 * the dashboard's name in text-gradient-warm, whose darkest stop
 * (saffron-400) is 3.7:1, and an attempt's "· Attempt 1" in
 * content-inverse-muted, the 5.1:1 above. Everything smaller than a title
 * that is not listed here is inside a well -- MASTHEAD_WELL, below.
 */

/*
 * The aurora's strength inside a masthead: 70%.
 *
 * AuroraBackdropInverse at full strength was tuned for a full-height
 * panel, where its blobs sit well apart. A masthead is a
 * fraction of that height, so the same fixed-size blobs stack inside it,
 * and where they do the panel gets light enough to cost small text its
 * contrast. (Phase A's NextStepCard met the same thing and also settled on
 * 70%; that card is now part of the dashboard's masthead.)
 *
 * The sentence under the title is the text that decides it, being the
 * smallest thing set straight on the panel (content-inverse-muted):
 *
 *   aurora at 100%   lightest pixel rgb(109,94,151)   4.2:1   under AA
 *   aurora at 80%    lightest pixel rgb(94,84,151)    4.75:1
 *   aurora at 70%    lightest pixel rgb(91,79,141)    5.1:1
 *
 * The first two rows are the dashboard at phone widths only, mid-drift; the
 * third is the full sweep described above. 80% passes on what was measured
 * of it, by a quarter of a point and on a partial run -- not a margin to
 * build six screens on. 70% is also the figure the student hero and Phase
 * A's card were already drawn at, so the three inverse surfaces match.
 *
 * Drift is opt-in (`drift`) and only the dashboard opts in. Everywhere else
 * the aurora is held still from the outside, the way the workspace ambience
 * holds its own, and for the reason RoleShell gives for its static rail: it
 * "sits in peripheral vision for a whole school day, where ambient motion
 * is a distraction". Assign Practice and the tracker are screens a teacher
 * reads a form or a table on; the dashboard is the one they arrive at.
 * Under prefers-reduced-motion the global override in globals.css stops
 * the dashboard's drift as it stops every other animation; nothing here
 * re-implements it.
 */
const MASTHEAD_AURORA = "opacity-70";

/*
 * Cells inside a masthead are wells, not glass.
 *
 * The obvious build is the frosted `.glass-panel` the sign-in page uses for
 * its pillars: white at 6 to 14% over the aurora. Measured, that is the
 * wrong way round for small text here. Glass *adds* white to whatever is
 * behind it, so over the masthead's lightest pixel it lifts the background
 * further. A well does the opposite: brand-950 at 40% darkens the lightest
 * pixel, so text inside a cell always has *more* contrast than the same
 * text on the open panel beside it. It is the same family of translucent
 * chrome as InlineLink's pill, pointed the other way.
 *
 * `attention` and `good` are wells too, tinted with the 900 step of their
 * scale (saffron-900, jade-900) at 45%, for the same reason: a lighter tint
 * (saffron-500 at 16%, say) has the glass problem again.
 *
 * Measured over the masthead's lightest pixel (the sweep in the note above
 * MastheadHeader), which is the worst case for a translucent fill:
 *
 *   glass, white at 14%          content-inverse-muted  3.8:1   fails
 *   saffron-500 at 16%           saffron-200            4.6:1   thin
 *
 *   default well                 figure, content-inverse        10.6:1
 *   (brand-950 at 40%)           label / hint, inverse-muted     7.2:1
 *                                saffron-200                     8.0:1
 *   attention well               figure, content-inverse         8.5:1
 *   (saffron-900 at 45%)         label, saffron-200              6.4:1
 *                                hint, inverse-muted             6.0:1
 *   good well                    figure, content-inverse         9.3:1
 *   (jade-900 at 45%)            label, jade-200                 6.6:1
 *                                hint, inverse-muted             6.4:1
 *
 * And the things a detail view puts inside the default well:
 *
 *   a fact's label, inverse-muted 7.2:1; its value, content-inverse 10.6:1;
 *   its glyph, saffron-200 at 80%, 5.7:1 (decorative -- the label says what
 *   the fact is -- and well past the 3:1 WCAG 1.4.11 asks of a graphic);
 *   an Average figure (PercentText onDark): jade-200 7.6:1, saffron-200
 *   8.0:1, coral-200 7.1:1;
 *   a status chip (Badge onDark, a 900-step tint at 55%): jade-200 8.3:1,
 *   saffron-200 7.9:1, coral-200 7.6:1, and the plain inverse chip 7.5:1.
 *   Those chips also hold outside a well, on the open panel: 7.0, 6.7, 6.4
 *   and 5.3:1.
 *
 * The back link (InlineLink tone="inverse") is a well of its own on the
 * open panel: its label is the 10.6:1 above at rest and 12.9:1 on hover,
 * since hover deepens the well instead of lightening it.
 *
 * The placeholder bars (white at 15%) are 1.4:1 against the panel and are
 * not asked to be more: they are decorative, each is paired with an sr-only
 * "Loading", and nothing has to be read off them.
 *
 * Exported because a page's own masthead content (`children`) should be
 * built from the same cells -- the dashboard's next step and Assign
 * Practice's three choices are -- so that everything inside a masthead sits
 * on a surface whose figures are the ones above.
 */
export const MASTHEAD_WELL = {
  default: { cell: "bg-brand-950/40 ring-white/10", label: "text-content-inverse-muted" },
  attention: { cell: "bg-saffron-900/45 ring-saffron-300/45", label: "text-saffron-200" },
  good: { cell: "bg-jade-900/45 ring-jade-300/45", label: "text-jade-200" },
} as const;

// The strip's column count follows how many figures a page has, so a row is
// never left with one orphan cell: three sit on one line from `sm` (and
// under it the third takes a full row of its own, see the <dl>), four go
// 2 x 2 and then one line from `lg`, and six (an assignment's progress) go
// 2 x 3, then 3 x 2 from `sm`, then one line from `xl` -- the same steps the
// tile row they replace took.
function statColumns(count: number): string {
  if (count <= 3) return "sm:grid-cols-3";
  if (count === 4) return "lg:grid-cols-4";
  return "sm:grid-cols-3 xl:grid-cols-6";
}

const MASTHEAD_SHELL =
  // rounded-4xl from `sm`: one step rounder than the cards beneath it
  // (rounded-3xl), the same step the sign-in card takes over its fields, so
  // the masthead reads as the page's outermost object. shadow-panel is the
  // deepest cast in the scale for the same reason.
  "relative isolate overflow-hidden rounded-3xl border border-white/10 bg-brand-gradient text-content-inverse shadow-panel sm:rounded-4xl " +
  // Focus. Every Button and InlineLink draws its focus ring as a shadow
  // made for paper (shadow-focus-ring: a white gap and an indigo ring), and
  // on this panel the indigo sinks into the indigo beside it. So the
  // masthead swaps the ring for shadow-focus-inverse
  // (tailwind.config.ts: a brand-950 gap and a solid saffron-200 ring,
  // 5.4:1 on the lightest pixel, against the 3:1 WCAG 1.4.11 asks of a
  // focus indicator) on any link or button inside it. A
  // descendant selector, deliberately: it out-ranks the variant's own
  // `focus-visible:shadow-*` by specificity, so no call site has to
  // remember to ask for it and no future action can forget.
  "[&_a:focus-visible]:shadow-focus-inverse [&_button:focus-visible]:shadow-focus-inverse";

/** The masthead's decorative layers. Nothing here is new artwork. */
function MastheadBackdrop({ drift }: { drift: boolean }) {
  return (
    <>
      {/* `grain`: this is a large dark gradient, which is what the film
          grain is for (Graphics.tsx), and it is the same grain the rail
          beside it carries -- the two indigo surfaces on screen read as one
          material. [&_*]:animate-none is how the workspace ambience freezes
          the same family of graphic from the outside. */}
      <AuroraBackdropInverse grain className={cn(MASTHEAD_AURORA, !drift && "[&_*]:animate-none")} />
      {/* Warm light on the top edge -- the saffron rule every page eyebrow
          carries, at the scale of the panel, so it reads as a lit object
          rather than a flat fill. Decorative. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-12 top-0 z-[1] h-px bg-gradient-to-r from-transparent via-saffron-300/70 to-transparent"
      />
    </>
  );
}

function MastheadHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  stats,
  size = "md",
  drift = false,
  facts,
  back,
  children,
  className,
}: MastheadPageHeaderProps) {
  const statList = stats ?? [];
  const factList = facts ?? [];
  return (
    <header className={cn(MASTHEAD_SHELL, "animate-fade-up", className)}>
      <MastheadBackdrop drift={drift} />
      <div className="relative z-10 flex flex-col gap-6 p-5 sm:p-7 lg:p-8">
        {/* A grid rather than the plain header's flex row, for one reason:
            beside the whole text column, an action costs the sentence its
            width, and on a 1366px laptop that wrapped both working pages'
            descriptions onto a second line -- 24px of panel pushing the
            table down for nothing. So from `lg` the action shares a row
            with the eyebrow and title only, and the sentence runs the full
            width beneath them. Under `lg` the three stack in source order
            (title, sentence, action), which is the order the plain header
            stacks in. */}
        <div className={cn("grid gap-x-6 gap-y-3", actions ? "lg:grid-cols-[minmax(0,1fr)_auto]" : null)}>
          <div className="min-w-0 space-y-3">
            {/* A detail view's way back, as the panel's first line. pb-1.5
                gives it the breathing room the 2rem page gap used to. */}
            {back ? <div className="flex pb-1.5">{back}</div> : null}
            {/* Not <Eyebrow>: that component's text-content-brand is indigo
                on indigo here, and passing a colour through its `cn` is not
                safe -- tailwind-merge reads this project's `text-eyebrow`
                size token as a colour and drops it in favour of the later
                one (checked: the merged string loses `text-eyebrow`). A
                plain class string keeps the 11px wide-tracked label the
                token defines, with the same saffron rule in front. */}
            {eyebrow ? (
              <p className="flex items-center gap-2.5 text-eyebrow font-bold uppercase text-saffron-200">
                <span aria-hidden className="h-[2px] w-5 shrink-0 rounded-full bg-accent-gradient" />
                <span className="min-w-0">{eyebrow}</span>
              </p>
            ) : null}
            <h1
              className={
                size === "lg"
                  ? "font-display text-display-md text-balance text-content-inverse sm:text-display-lg xl:text-display-xl"
                  : "font-display text-display-md text-balance text-content-inverse sm:text-display-lg"
              }
            >
              {title}
            </h1>
          </div>
          {description || meta || factList.length > 0 ? (
            <div className="min-w-0 space-y-3 lg:col-span-full lg:row-start-2">
              {/* The sentence stays. It is no longer the only thing under
                  the title, which is what made it read as floating text; it
                  is the caption to the figures below it. */}
              {description ? (
                <p className="text-[0.9375rem] leading-relaxed text-content-inverse-muted text-pretty">{description}</p>
              ) : null}
              {/* `facts`: the plain header's hairline band, as a well. One
                  object holding the record's state (`meta`, first) and then
                  its details, each a quiet label and a strong value -- the
                  same description list, on the same dark cell the figures
                  below it use, so a label here has the contrast a stat's
                  label has (MASTHEAD_WELL has the numbers). Glyphs are
                  decorative; the label says what each fact is. */}
              {factList.length > 0 ? (
                <div
                  className={cn(
                    "inline-flex max-w-full flex-wrap items-center gap-x-5 gap-y-2.5 rounded-2xl px-4 py-2.5 ring-1 ring-inset",
                    MASTHEAD_WELL.default.cell,
                  )}
                >
                  {meta ? <div className="flex flex-wrap items-center gap-2">{meta}</div> : null}
                  <dl className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
                    {factList.map((fact) => (
                      <div key={fact.label} className="flex min-w-0 items-center gap-2 text-[0.8125rem] leading-5">
                        {fact.icon ? (
                          <span aria-hidden className="inline-flex shrink-0 text-saffron-200/80">
                            {fact.icon}
                          </span>
                        ) : null}
                        <dt className="shrink-0 text-content-inverse-muted">{fact.label}</dt>
                        <dd className="min-w-0 font-semibold text-content-inverse">{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : meta ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">{meta}</div>
              ) : null}
            </div>
          ) : null}
          {actions ? (
            <div className="flex flex-wrap items-center gap-3 pt-2 lg:col-start-2 lg:row-start-1 lg:self-end lg:pt-0">{actions}</div>
          ) : null}
        </div>

        {statList.length > 0 ? (
          <dl
            className={cn(
              "grid grid-cols-2 gap-2.5 sm:gap-3",
              // On a phone the strip is two columns whatever the count, so
              // an odd number of figures left the last one alone at half
              // width with a hole beside it. It takes the full row instead,
              // and goes back to one column where the count sets the grid.
              "[&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1",
              statColumns(statList.length),
            )}
          >
            {statList.map((stat) => (
              <MastheadStat key={stat.label} stat={stat} />
            ))}
          </dl>
        ) : null}

        {children}
      </div>
    </header>
  );
}

function MastheadStat({ stat }: { stat: PageHeaderStat }) {
  const tone = MASTHEAD_WELL[stat.tone ?? "default"];
  return (
    <div className={cn("relative min-w-0 rounded-2xl px-4 py-3.5 ring-1 ring-inset transition-colors duration-300", tone.cell)}>
      <dt className={cn("text-[0.6875rem] font-bold uppercase tracking-eyebrow", tone.label, stat.adornment ? "pr-9" : null)}>
        {stat.label}
      </dt>
      <dd className="mt-1.5">
        <span className="block font-display text-[1.75rem] font-semibold leading-none tabular text-content-inverse">
          {stat.value === null || stat.value === undefined ? (
            // The figure's own shape while its source loads -- a bar, not a
            // dash: "—" is what a source that *failed* prints, and the two
            // must not look alike. animate-pulse is switched off under
            // prefers-reduced-motion by the global override.
            <>
              <span aria-hidden className="block h-7 w-12 animate-pulse rounded-lg bg-white/15" />
              <span className="sr-only">Loading</span>
            </>
          ) : typeof stat.value === "number" ? (
            <CountUp value={stat.value} />
          ) : (
            stat.value
          )}
        </span>
        {/* Wraps rather than truncates: the cells sit in an equal-height
            grid, so a two-line hint costs nothing, while truncate cut the
            one cell whose hint mattered ("Open Needs Review to mark
            them"). */}
        {stat.hint ? (
          <span className="mt-1.5 block text-xs leading-snug text-content-inverse-muted text-pretty">{stat.hint}</span>
        ) : null}
      </dd>
      {stat.adornment ? <span className="absolute right-3 top-3 inline-flex">{stat.adornment}</span> : null}
    </div>
  );
}

/** A placeholder bar for a masthead whose record is still loading: the
 *  title's (or eyebrow's) own shape, in the same white-at-15% the stat
 *  cells use for a figure that has not arrived. Decorative -- the caller
 *  adds the sr-only "Loading" line. animate-pulse is stopped under
 *  prefers-reduced-motion by the global override. */
export function MastheadSkeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block animate-pulse rounded-full bg-white/15", className)} />;
}
