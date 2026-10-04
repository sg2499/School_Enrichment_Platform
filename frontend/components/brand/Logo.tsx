import { useId } from "react";
import { PRODUCT_NAME, PRODUCT_SCOPE } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * The Krama mark: the Forged Stair (4 Oct 2026).
 *
 * Krama is Sanskrit for order -- one step after another. The mark is a
 * staircase that turns back on itself and only ever goes up: an impossible
 * loop of steps, one of them gold. It replaced three stacked rules and a
 * dot, which read as a text-alignment icon and said nothing about the name.
 *
 * Two cuts of the same object exist, and this component draws the smaller:
 *
 *   - The full mark is twelve steps (flights of 4, 4, 2, 2) with an orbit
 *     and a glow. It is a picture, used where there is room for one: the
 *     touch icon and the social-share image (app/apple-icon.png,
 *     app/opengraph-image.png), rendered once from brand/ (see the README
 *     there) rather than drawn in the browser.
 *   - The small cut is eight steps (flights of 3, 3, 1, 1) with no orbit.
 *     At the sizes the interface uses -- 16px in the footer to 56px on the
 *     sign-in page -- twelve steps turn to noise and eight stay steps.
 *
 * How the loop closes. Each step is drawn one rise above the one before it,
 * all the way round, and the last meets the first. It can because of the
 * projection: a step towards the viewer moves down the screen by more than
 * one rise, a step away moves up by more, and with flights of 3, 3, 1, 1
 * the two cancel exactly when the rise is 0.29 of a tread. Nothing is
 * faked per step, which is why it reads as a real object.
 *
 * Pure inline SVG, so it needs no request and takes the surrounding size.
 * The steps are listed back to front (painter's order); the fourth is the
 * gold one.
 */
const STEPS: ReadonlyArray<readonly [x: number, y: number, gold?: true]> = [
  [24.5, 18.73],
  [32, 21.38],
  [39.5, 24.03],
  [17, 26.68, true],
  [47, 26.68],
  [39.5, 29.34],
  [32, 31.99],
  [24.5, 34.64],
];

// One step, drawn around the centre of its top face: half a tread wide
// (7.5), half a tread deep (5.3), and a wall 11.43 tall.
const STEP_TOP = "M0 -5.3L7.5 0L0 5.3L-7.5 0Z";
const STEP_LEFT = "M-7.5 0L0 5.3L0 16.73L-7.5 11.43Z";
const STEP_RIGHT = "M7.5 0L0 5.3L0 16.73L7.5 11.43Z";
// The two front edges of the top face, which catch the light.
const STEP_RIM = "M-7.5 0L0 5.3L7.5 0";

export function LogoMark({
  className,
  variant = "brand",
}: {
  className?: string;
  /** `brand` = the indigo tile, `inverse` = the same tile lifted a little
   *  for dark chrome, where the standard one would sink into the rail. */
  variant?: "brand" | "inverse";
}) {
  // Per-instance gradient ids (30 Sep 2026). These used to be fixed strings
  // shared by every mark on the page, which only rendered because the first
  // copy in the DOM happened to be visible: SVG paint servers resolve to
  // the *first* element with a matching id, and one inside a display:none
  // subtree (RoleShell's lg:hidden mobile bar) paints nothing -- so
  // reordering the chrome could silently blank
  // every other logo. useId is safe here even when this is rendered from a
  // Server Component (React exports it from its server build). Its
  // punctuation varies by React version (":r1:", "«r1»", "_r_1_"), so
  // anything that isn't a plain identifier character is stripped to keep
  // the reference valid inside url(#...).
  const id = `se-mark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const lifted = variant === "inverse";
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label={PRODUCT_NAME} className={cn("h-11 w-11", className)}>
      <defs>
        <radialGradient id={`${id}-tile`} cx="0.22" cy="0.08" r="1.3">
          <stop offset="0" stopColor={lifted ? "#5A4DB0" : "#3C3489"} />
          <stop offset="0.48" stopColor={lifted ? "#2E2870" : "#1E1A52"} />
          <stop offset="1" stopColor={lifted ? "#171338" : "#0E0B24"} />
        </radialGradient>
        {/* Each face takes its gradient across its own bounding box, so
            every step is lit the same way wherever it sits. */}
        <linearGradient id={`${id}-top`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#DAD6F6" />
        </linearGradient>
        <linearGradient id={`${id}-left`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#A99FE8" />
          <stop offset="1" stopColor="#5D50B6" />
        </linearGradient>
        <linearGradient id={`${id}-right`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5145AC" />
          <stop offset="1" stopColor="#221C5E" />
        </linearGradient>
        <linearGradient id={`${id}-gold-top`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFF6D8" />
          <stop offset="1" stopColor="#FBC559" />
        </linearGradient>
        <linearGradient id={`${id}-gold-left`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F9AB2B" />
          <stop offset="1" stopColor="#D06B06" />
        </linearGradient>
        <linearGradient id={`${id}-gold-right`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#C2600A" />
          <stop offset="1" stopColor="#6E3306" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="17.5" fill={`url(#${id}-tile)`} />
      <rect
        x="0.5"
        y="0.5"
        width="63"
        height="63"
        rx="17"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity={lifted ? 0.26 : 0.16}
      />
      {STEPS.map(([x, y, gold]) => {
        const face = gold ? `${id}-gold` : id;
        return (
          <g key={`${x}-${y}`} transform={`translate(${x} ${y})`} strokeLinejoin="round">
            <path d={STEP_RIGHT} fill={`url(#${face}-right)`} stroke={gold ? "#6E3306" : "#221C5E"} strokeWidth="0.12" />
            <path d={STEP_LEFT} fill={`url(#${face}-left)`} stroke={gold ? "#D06B06" : "#5D50B6"} strokeWidth="0.12" />
            <path d={STEP_TOP} fill={`url(#${face}-top)`} stroke={gold ? "#FFF6D8" : "#B9B1EC"} strokeWidth="0.16" />
            <path
              d={STEP_RIM}
              fill="none"
              stroke={gold ? "#FFFDF2" : "#FFFFFF"}
              strokeOpacity="0.9"
              strokeWidth="0.26"
              strokeLinecap="round"
            />
          </g>
        );
      })}
    </svg>
  );
}

export function Wordmark({
  className,
  tone = "dark",
  showTagline = false,
}: {
  className?: string;
  tone?: "dark" | "light";
  showTagline?: boolean;
}) {
  return (
    <span className={cn("flex min-w-0 flex-col leading-none", className)}>
      <span
        className={cn(
          // One short word carrying the whole brand, so it is set larger and
          // tighter than the two-word working title it replaced: at the old
          // size "Krama" read as a caption beside the 40px mark.
          "whitespace-nowrap font-display text-[1.3125rem] font-semibold leading-none tracking-[-0.022em]",
          tone === "dark" ? "text-content" : "text-content-inverse",
        )}
      >
        {/* The name alone. It carried a saffron full stop until 4 Oct
            2026, which read as the end of a sentence and put a second
            saffron dot beside the mark's own. */}
        {PRODUCT_NAME}
      </span>
      {showTagline ? (
        <span
          className={cn(
            "mt-1 text-[0.625rem] font-semibold uppercase tracking-eyebrow",
            tone === "dark" ? "text-content-faint" : "text-content-inverse-muted",
          )}
        >
          {PRODUCT_SCOPE}
        </span>
      ) : null}
    </span>
  );
}

export function Lockup({
  className,
  tone = "dark",
  showTagline = false,
  markClassName,
}: {
  className?: string;
  tone?: "dark" | "light";
  showTagline?: boolean;
  markClassName?: string;
}) {
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <LogoMark variant={tone === "dark" ? "brand" : "inverse"} className={cn("h-10 w-10", markClassName)} />
      <Wordmark tone={tone} showTagline={showTagline} />
    </span>
  );
}
