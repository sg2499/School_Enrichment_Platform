import { ArrowRight, Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { ButtonLink } from "@/components/ui/Button";
import { CardIcon } from "@/components/ui/Card";
import { MASTHEAD_WELL, MastheadSkeleton } from "@/components/ui/PageHeader";

/** The one thing worth doing next, as a dashboard's masthead states it. */
export type NextStep = { title: string; body: string; action?: { href: string; label: string } };

/**
 * A dashboard masthead's closing strip: the single most useful next step.
 *
 * Built for the Teacher dashboard on 2 Oct 2026 (the masthead pass) and
 * moved here on 3 Oct, unchanged, when the Admin and Super Admin dashboards
 * took the same masthead: three dashboards asking "what should I do now?"
 * in three different shapes would be three products.
 *
 * Why it is inside the masthead rather than a card of its own. In Phase A
 * this was the page's hero in its own right: an inverse card carrying its
 * own aurora, under a header that was text on the canvas. Once the header
 * is itself the lit panel, a second one directly beneath it would be two
 * heroes competing, so the next step moved inside -- the one place on the
 * dashboard that asks something of the person is the last thing in the
 * first thing they see.
 *
 * It sits in a well (MASTHEAD_WELL: brand-950 at 40%), the same cell the
 * masthead's figures use, and for the same measured reason: a well darkens
 * the aurora behind it, so text inside always has more contrast than text
 * on the open panel. PageHeader.tsx has the numbers; this strip's title is
 * content-inverse, its body content-inverse-muted and its label saffron-200,
 * all three among the pairs measured there.
 *
 * `step` is null while the page is still working it out; the strip then
 * shows the shape of what is coming and says so to a screen reader in
 * `checkingLabel`.
 */
export function MastheadNextStep({
  step,
  checkingLabel = "Checking your setup",
}: {
  step: NextStep | null;
  checkingLabel?: string;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-2xl ring-1 ring-inset", MASTHEAD_WELL.default.cell)}>
      {/* A saffron edge marks this as the one thing here that asks
          something of the person -- the same accent rule the page eyebrows
          use. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-accent-gradient" />
      <div className="flex flex-col gap-4 py-4 pl-6 pr-4 sm:flex-row sm:items-center sm:gap-5 sm:py-5 sm:pl-7 sm:pr-5">
        <CardIcon tone="inverse" className="text-saffron-200">
          <Compass className="h-5 w-5" aria-hidden />
        </CardIcon>
        {step ? (
          <div className="min-w-0 flex-1 space-y-1" aria-live="polite">
            <p className="text-eyebrow font-bold uppercase text-saffron-200">Your next step</p>
            <p className="font-display text-xl font-semibold tracking-tight text-content-inverse">{step.title}</p>
            {/* No max-w-prose (1 Oct 2026): flex-1 beside the icon and the
                action already bounds it, and the 68ch cap wrapped most of
                these one-sentence steps onto a second line they don't
                need. */}
            <p className="text-[0.875rem] leading-relaxed text-content-inverse-muted text-pretty">{step.body}</p>
          </div>
        ) : (
          <div className="min-w-0 flex-1 space-y-2" aria-busy="true">
            <span className="sr-only" role="status">
              {checkingLabel}
            </span>
            <MastheadSkeleton className="h-3 w-24" />
            <MastheadSkeleton className="h-5 w-72 max-w-full" />
            <MastheadSkeleton className="h-3 w-96 max-w-full" />
          </div>
        )}
        {/* A real button, not a text link. `accent` is reserved for "the
            single most inviting action on a view" (Button.tsx), and on a
            dashboard that is, by construction, this. Its label, brand-950
            on the saffron gradient, runs from 11.2:1 at the lightest stop
            to 4.9:1 at the darkest -- the same pairing as the student
            hero's action. Its focus ring is the masthead's
            (shadow-focus-inverse; PageHeader applies it to everything
            inside the panel). */}
        {step?.action ? (
          <div className="shrink-0 sm:pl-2">
            <ButtonLink href={step.action.href} variant="accent" trailingIcon={<ArrowRight className="h-4 w-4" />}>
              {step.action.label}
            </ButtonLink>
          </div>
        ) : null}
      </div>
    </div>
  );
}
