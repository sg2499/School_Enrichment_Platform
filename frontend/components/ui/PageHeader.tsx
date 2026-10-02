import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/Badge";

/** One labelled piece of metadata about the record a page is showing:
 *  "Due · 5 Oct", "Questions · 8". See `facts` below. */
export interface PageHeaderFact {
  /** The short noun the value answers to. Title Case, like every label. */
  label: string;
  value: React.ReactNode;
  /** A 14px lucide glyph. Decorative -- the label carries the meaning. */
  icon?: React.ReactNode;
}

export interface PageHeaderProps {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Structured metadata for a detail view, instead of a joined sentence. */
  facts?: PageHeaderFact[];
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}

/** Consistent top-of-page block: eyebrow, display title, one line of context,
 *  and a right-aligned action slot.
 *
 *  Enters with the same fade-up the page cards already use (30 Sep 2026).
 *  Every page staggers its cards at 0/70/140ms but the title used to just
 *  *be there*, so the choreography started halfway down the screen; now
 *  the title leads and the cards follow it. Reduced-motion users get it
 *  instantly via the global override in globals.css. */
export function PageHeader({ eyebrow, title, description, facts, actions, meta, className }: PageHeaderProps) {
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

            `description` is untouched. A page with one line of context
            (every Admin and Student page, and the Teacher list pages) still
            renders exactly the sentence it did -- a single sentence under a
            title is already resolved, and a box around it would be
            decoration. Only a caller that passes `facts` opts in.

            Contrast inside the band, on its lightest and darkest possible
            fill (surface at 70% over plain canvas, and over the darkest
            pixel the teacher ambience puts behind a page): label
            content-subtle 6.3:1 and 5.8:1, value content 16.6:1 and
            15.4:1. The glyphs are content-faint, 4.5:1 and 4.2:1 -- they
            are decorative (the label says what each fact is), and that is
            still past the 3:1 WCAG 1.4.11 asks of a graphic. */}
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
