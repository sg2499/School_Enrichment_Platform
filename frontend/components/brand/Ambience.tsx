import { AuroraBackdrop } from "@/components/brand/Graphics";
import { cn } from "@/lib/utils";

/**
 * The colour wash behind a signed-in workspace.
 *
 * It is AuroraBackdrop -- the same graphic the session-check LoadingScreen
 * shows at full strength immediately before any of these pages appears --
 * pinned to the viewport behind the content column. Nothing new is drawn.
 * The effect is that the loading screen's atmosphere stays when the page
 * arrives, instead of being cut to bare canvas the instant it does.
 *
 * How it got here, because the levels only make sense with the history.
 *
 * Phase A (2 Oct 2026) introduced it as TeacherAmbience, in
 * components/tracker/TrackerBits.tsx, at opacity 0.30 on the dashboard and
 * 0.25 everywhere else. Those were ceilings, not choices. Quiet text
 * (content-subtle) sat directly on the page canvas -- the shell's date line
 * and footer, the count under a list of cards -- and against the wash's
 * darkest pixel it measured 4.54:1 at 0.30, with 0.40 failing outright. So
 * the wash was barely there by necessity, and Shailesh, looking at it live,
 * said so: "I do not see much of a difference."
 *
 * The second pass (same day) left that ceiling exactly where it was and
 * changed what it applies to. The limit was never a property of the wash;
 * it was a property of what the wash sat behind. So the quiet text came off
 * the bare canvas:
 *  - the shell's own date line and footer sit on the breadcrumb's frosted
 *    chip whenever a page has an ambience (RoleShell, SURFACED) -- which is
 *    why this is switched on through RoleShell's `ambience` prop rather
 *    than dropped into a page, and why it lives here and not in TrackerBits;
 *  - the one pager that sat between cards has a strip of its own
 *    (teacher/tracker/students);
 *  - and every Teacher header is a masthead now (PageHeader
 *    surface="masthead"), an opaque panel with the back link inside it.
 *
 * To be exact about which of those the arithmetic needed: the first two.
 * They were the content-subtle text. A header's own supporting line is
 * content-muted, which would still clear AA on the canvas at full strength
 * (the figures below). The masthead exists for a different reason -- the
 * header was the one thing on the page without a surface, and read as
 * floating text -- but it does take the header, its back link and its
 * facts band out of this calculation altogether, and that is why the list
 * of what remains is as short as it is.
 *
 * What is left on the bare canvas was checked rather than assumed: every
 * text node on all six Teacher screens, in their loaded, empty and failed
 * states and on each of the tracker's tabs, at 1440 and 390px, walked up to
 * the shell looking for a surface. Four things survive: the "Your Toolkit"
 * and "Practice History" section headings (content), the toolkit's
 * one-line strapline (content-muted), and -- only when a detail view fails
 * to load and has no masthead -- its InlineLink back pill (brand-700 on its
 * own tint). Nothing in content-subtle, nothing in content-faint. The same
 * walk listed the translucent surfaces that sit straight on the wash: the
 * shell's frosted chips (70%), the profile chip (80%) and the phone top bar
 * (85%). Their text is in the figures below.
 *
 * The measurement. Same method as Phase A's: the page rendered in Chromium
 * with everything hidden except the canvas, RoleShell's canvas-glow and
 * this backdrop, then every pixel of the content column read back. The
 * figure quoted is the single darkest pixel, in the spirit of the inverse
 * ramp in tailwind.config.ts ("measured against the lightest point of that
 * chrome, not its average"). Three sweeps:
 *   still     twelve widths from 320 to 2560px, each at five heights from
 *             568 to 1440px (the bottom blob rides the viewport's foot, so
 *             height moves it into and out of the shell's glow), the rail
 *             expanded and collapsed;
 *   scrolled  six widths, two heights, six scroll offsets from 0 to 420px
 *             -- the wash is fixed and the shell's glow scrolls away under
 *             it, so the darkest pixel is a little darker just off the top;
 *   drifting  (the dashboard level only) all 24 combinations of the three
 *             blobs' keyframe stops at ten widths -- five heights on
 *             phones, two above -- plus, on phones, where the darkest pixel
 *             always is, twelve random phases per load.
 *
 *  - `dashboard` -- opacity 1.0, the LoadingScreen's own strength, blobs
 *    drifting. Darkest pixel rgb(202,195,216) (a 360x568 phone, mid-drift):
 *      on the bare canvas   content 9.9:1, content-muted 5.1:1
 *      on the frosted chip  content-subtle 5.5:1, content-muted 7.4:1,
 *                           content 14.6:1
 *      phone top bar (85%)  content 15.8:1, brand-700 9.5:1
 *      InlineLink pill      brand-700 5.4:1 (7.1:1 hovered)
 *
 *  - `working` -- opacity 0.80, and completely still. Darkest pixel
 *    rgb(208,201,220) (a 320px phone, scrolled 60px):
 *      on the bare canvas   content 10.6:1, content-muted 5.4:1
 *      on the frosted chip  content-subtle 5.6:1, content-muted 7.6:1,
 *                           content 14.8:1
 *      phone top bar (85%)  content 15.9:1, brand-700 9.6:1
 *      InlineLink pill      brand-700 5.7:1 (7.5:1 hovered)
 *
 * The chip figures take no credit for the chip's backdrop-blur: they are
 * surface at 70% laid over the single darkest pixel, which the blur can
 * only soften. The chips' decorative glyphs (content-faint) are 4.0:1 on
 * that basis, past the 3:1 WCAG 1.4.11 asks of a graphic.
 *
 * So contrast no longer sets either level -- even at full strength the
 * quietest text left on the canvas clears AA -- and the two numbers are now
 * judgements about the room, which is what they should have been:
 *
 *  - The dashboard is the landing view. It gets the graphic at the strength
 *    it was drawn at, and the slow drift.
 *  - Assign Practice and the four Practice Tracker screens are where a
 *    teacher reads a table for minutes at a time. A step down, and the
 *    drift switched off, for the reason RoleShell gives for its own static
 *    rail -- it "sits in peripheral vision for a whole school day, where
 *    ambient motion is a distraction" -- and a thing moving at the edge of
 *    a table you are reading is the one kind of decoration that actively
 *    costs attention. It also keeps these pages off the compositor's
 *    per-frame bill on a school's cheapest laptop.
 *
 * Worth knowing when judging it: every card, table, banner and masthead on
 * these pages is opaque, so the wash is never actually *behind* anything a
 * teacher is reading. It shows in the page margins, the gaps between cards
 * and around the context bar -- which is more of the screen than it sounds
 * on a wide monitor, where the content column is 84rem and the rest is
 * margin.
 *
 * The one rule this leaves behind. If content-subtle text is ever put
 * straight on the canvas of a page that has an ambience, it will measure
 * 3.8:1 at the dashboard level and 4.0:1 at the working one. Give it a
 * surface, or set it in content-muted (5.1:1 and 5.4:1).
 *
 * No grain at either level: grain is for dithering large dark gradients.
 *
 * `fixed`, not `absolute`. AuroraBackdrop places its blobs on the corners
 * of its own box and clips them there, which is right when the box's edges
 * are real edges (a full screen, a card). <main> is not that: on a wide
 * monitor it is a centred 84rem column, and an absolutely positioned
 * backdrop would be cut off along the column's sides, leaving a hard
 * vertical seam of tint against plain canvas. Pinned to the viewport, its
 * top, right and bottom edges are the screen's. Its left edge is the rail's
 * (RoleShell passes `lg:left-sidebar` or its collapsed twin through
 * `className`): Phase A ran it under the rail from the screen's left edge,
 * which put the lilac blob almost entirely behind 17.5rem of opaque indigo.
 * The cost is that the blobs no longer sit exactly where the LoadingScreen
 * had them; the rail arriving over that corner hides the difference.
 *
 * Admin and Student pages were left without `ambience` at first, until
 * their headers had somewhere to sit. Both have it now (Admin in slice 4,
 * Student on 4 Oct 2026), each after its own bare-canvas walk: any new
 * page that switches it on needs the same walk first.
 */
export type AmbienceLevel = keyof typeof AMBIENCE;

const AMBIENCE = {
  dashboard: "opacity-100",
  // [&_*]:animate-none freezes AuroraBackdrop's drift from the outside; the
  // graphic has no "still" option of its own.
  working: "opacity-80 [&_*]:animate-none",
} as const;

export function Ambience({ level, className }: { level: AmbienceLevel; className?: string }) {
  return <AuroraBackdrop className={cn("fixed", AMBIENCE[level], className)} />;
}
