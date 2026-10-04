import { ArrowRight } from "lucide-react";
import { LogoMark } from "@/components/brand/Logo";
import { MakerCredit } from "@/components/brand/MakerCredit";
import { PRODUCT_NAME, PRODUCT_SCOPE } from "@/lib/brand";
import { cn } from "@/lib/utils";
import styles from "./night-ascent.module.css";

/**
 * The night the sign-in page is set in, for the other screens that belong
 * to it (4 Oct 2026).
 *
 * Sign-in became one dark page with one white card ("Night Ascent"), and
 * for a while it was the only screen that looked like that. Two others are
 * part of the same moment and were still on the earlier pale page: choosing
 * your own password, which is the third step of signing in for anyone who
 * left it half-way; and an address that leads nowhere for someone who is
 * not signed in, which they reach from, and leave to, the sign-in page.
 *
 * What is NOT here, on purpose: the screens that stand in for a page of a
 * workspace -- its session check, "can't reach the server", a page of it
 * that crashed, a wrong address inside it. Those stay on paper
 * (components/ui/StatusScreen.tsx, LoadingScreen.tsx). The session check is
 * on screen at every refresh, and a dark one would flash dark, then light,
 * each time. The same three moments on the choose-a-password page, and a
 * crash outside any workspace, ARE on the night, for the same reason turned
 * round: the page they stand in for is dark.
 *
 * Nothing here moves. The sign-in page's sky drifts and its light climbs,
 * and it has a switch to stop both; these screens have no such switch, so
 * they are still pictures.
 */

/** The sky: three glows and a faint grid, and the two rings where this
 *  screen's card is (`side` on the two-column page, `centre` behind a lone
 *  card). Decorative. */
export function NightBackdrop({ rings }: { rings: "side" | "centre" }) {
  return (
    <div aria-hidden className={styles.backdrop}>
      <div className={styles.glowIndigo} />
      <div className={styles.glowSaffron} />
      <div className={styles.glowViolet} />
      <div className={styles.lines} />
      <div className={rings === "side" ? styles.ring : styles.soloRing} />
      <div className={rings === "side" ? styles.ringDashed : styles.soloRingDashed} />
    </div>
  );
}

/** The header bar: the product on the left, who makes it on the right, a
 *  hairline under both. The same bar as the sign-in page's. On a phone the
 *  credit is not here (it goes under the card: NightMakerRow). */
export function NightHeader({ className }: { className?: string }) {
  return (
    <header className={cn(styles.top, className)}>
      <span className={styles.lockup}>
        {/* The mark calls itself by the product's name, and the name is
            right beside it: hidden here so it is said once. */}
        <span aria-hidden className="flex flex-none">
          <LogoMark variant="inverse" className={styles.lockupMark} />
        </span>
        <span>
          <span className={cn("font-display", styles.lockupName)}>{PRODUCT_NAME}</span>
          <span className={styles.lockupScope}>{PRODUCT_SCOPE}</span>
        </span>
      </span>
      <MakerCredit className={styles.makerTop} arrowClassName={styles.makerArrow} />
    </header>
  );
}

/** The maker's credit for phones and tablets, under the card. */
export function NightMakerRow() {
  return (
    <p className={styles.makerBelowRow}>
      <MakerCredit />
    </p>
  );
}

/** The white card: a lit object on a dark page, with the saffron hairline
 *  along its top edge that the sign-in card has. */
export function NightCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("relative overflow-hidden rounded-4xl bg-surface text-content", styles.card, className)}>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-12 top-0 z-10 h-0.5 bg-gradient-to-r from-transparent via-saffron-300 to-transparent"
      />
      {children}
    </div>
  );
}

/** The arrow on the card's one button: a saffron disc, as on every step of
 *  the sign-in card. Left out on the narrowest phones, where the longest
 *  label ("Save Password & Continue") needs the room more than the button
 *  needs it. */
export function GoArrow() {
  return (
    <span className="inline-flex h-[1.625rem] w-[1.625rem] items-center justify-center rounded-full bg-saffron-400 text-brand-950 max-[339px]:hidden">
      <ArrowRight className="h-[0.9375rem] w-[0.9375rem]" strokeWidth={2.6} />
    </span>
  );
}

/** A whole page that is the header and one card. `children` is what goes
 *  in the page's main area: usually one NightCard. */
export function NightSolo({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.solo}>
      <NightBackdrop rings="centre" />
      <div className={styles.soloTop}>
        <NightHeader />
      </div>
      <main className={styles.soloMain}>
        <div className={cn("animate-fade-up", styles.soloColumn)}>
          {children}
          <NightMakerRow />
        </div>
      </main>
    </div>
  );
}
