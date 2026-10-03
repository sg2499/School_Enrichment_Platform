import { useId } from "react";
import { PRODUCT_NAME, PRODUCT_SCOPE } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * The Krama mark: three ascending rules (a page of work turning into
 * steps of progress) with a saffron spark at the summit. Pure inline SVG --
 * no asset hosting, scales cleanly from a 16px favicon to a hero lockup.
 */
export function LogoMark({
  className,
  variant = "brand",
}: {
  className?: string;
  /** `brand` = indigo tile, `inverse` = glass tile for dark chrome. */
  variant?: "brand" | "inverse";
}) {
  // Per-instance gradient ids (30 Sep 2026). These used to be two fixed
  // strings shared by every mark on the page, which only rendered because
  // the first copy in the DOM happened to be visible: SVG paint servers
  // resolve to the *first* element with a matching id, and one inside a
  // display:none subtree (RoleShell's lg:hidden mobile bar, the login
  // page's mobile header) paints nothing -- so reordering the chrome could
  // silently blank every other logo. useId is safe here even when this is
  // rendered from a Server Component (React exports it from its server
  // build). Its punctuation varies by React version (":r1:", "«r1»",
  // "_r_1_"), so anything that isn't a plain identifier character is
  // stripped to keep the reference valid inside url(#...).
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gradientId = `se-mark-${variant}-${instanceId}`;
  return (
    <svg viewBox="0 0 44 44" role="img" aria-label={PRODUCT_NAME} className={cn("h-11 w-11", className)}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          {variant === "brand" ? (
            <>
              <stop offset="0%" stopColor="#6355BC" />
              <stop offset="55%" stopColor="#3C3489" />
              <stop offset="100%" stopColor="#26215C" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="rgba(255,255,255,0.28)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.10)" />
            </>
          )}
        </linearGradient>
        <linearGradient id={`${gradientId}-spark`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FDDC92" />
          <stop offset="100%" stopColor="#F08D0C" />
        </linearGradient>
      </defs>
      <rect width="44" height="44" rx="13" fill={`url(#${gradientId})`} />
      <rect width="44" height="44" rx="13" fill="none" stroke="rgba(255,255,255,0.22)" />
      <g fill="#FFFFFF">
        <rect x="10" y="27.5" width="8" height="4" rx="2" opacity="0.72" />
        <rect x="10" y="20" width="14.5" height="4" rx="2" opacity="0.88" />
        <rect x="10" y="12.5" width="21" height="4" rx="2" />
      </g>
      <circle cx="32.5" cy="29.5" r="4.5" fill={`url(#${gradientId}-spark)`} />
      <circle cx="32.5" cy="29.5" r="7.5" fill="none" stroke="#F9AB2B" strokeOpacity="0.35" />
    </svg>
  );
}

export function Wordmark({
  className,
  tone = "dark",
  showTagline = false,
  size = "md",
}: {
  className?: string;
  tone?: "dark" | "light";
  showTagline?: boolean;
  /** `lg` is for page-level headers (the login screen) where the wordmark
   *  carries the whole top of the page on its own -- `md` is the compact
   *  size used inside chrome like the dashboard sidebar and mobile bar. */
  size?: "md" | "lg";
}) {
  return (
    <span className={cn("flex min-w-0 flex-col leading-none", className)}>
      <span
        className={cn(
          // One short word carrying the whole brand, so it is set larger and
          // tighter than the two-word working title it replaced: at the old
          // size "Krama" read as a caption beside the 40px mark.
          "whitespace-nowrap font-display font-semibold leading-none tracking-[-0.022em]",
          size === "lg" ? "text-[1.875rem] sm:text-[2.125rem]" : "text-[1.3125rem]",
          tone === "dark" ? "text-content" : "text-content-inverse",
        )}
      >
        {PRODUCT_NAME}
        {/* The saffron spark from the mark, set as the full stop of the
            name: the same "this is where it lands" punctuation the mark
            carries at its summit. Decorative -- the name is read without it. */}
        <span aria-hidden className={tone === "dark" ? "text-saffron-500" : "text-saffron-300"}>
          .
        </span>
      </span>
      {showTagline ? (
        <span
          className={cn(
            "font-semibold uppercase tracking-eyebrow",
            size === "lg" ? "mt-1.5 text-[0.6875rem]" : "mt-1 text-[0.625rem]",
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
  size = "md",
}: {
  className?: string;
  tone?: "dark" | "light";
  showTagline?: boolean;
  markClassName?: string;
  size?: "md" | "lg";
}) {
  return (
    <span className={cn("flex items-center", size === "lg" ? "gap-3.5" : "gap-3", className)}>
      <LogoMark
        variant={tone === "dark" ? "brand" : "inverse"}
        className={cn(size === "lg" ? "h-12 w-12 sm:h-14 sm:w-14" : "h-10 w-10", markClassName)}
      />
      <Wordmark tone={tone} showTagline={showTagline} size={size} />
    </span>
  );
}
