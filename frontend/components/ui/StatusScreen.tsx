import { cn } from "@/lib/utils";
import { AuroraBackdrop } from "@/components/brand/Graphics";
import { Lockup } from "@/components/brand/Logo";
import { ErrorText } from "@/components/ui/ErrorText";

export type StatusTone = "brand" | "attention" | "problem";

// The icon tile. brand = "nothing is wrong, this just isn't here"; attention
// = "something outside the page" (a connection, a wait); problem = "this
// page broke". brand-600 on surface-brand 7.3:1, saffron-700 on saffron-50
// 5.4:1, coral-600 on coral-50 4.9:1 -- and each icon is paired with a
// title that says the same thing in words.
const TONES: Record<StatusTone, string> = {
  brand: "border-line-brand bg-surface-brand text-brand-600",
  attention: "border-saffron-200 bg-saffron-50 text-saffron-700",
  problem: "border-coral-200 bg-coral-50 text-coral-600",
};

export interface StatusScreenProps {
  /** A lucide icon element, sized by this component. */
  icon: React.ReactNode;
  tone?: StatusTone;
  /** A word or two above the title saying what kind of moment this is. */
  eyebrow: string;
  title: string;
  message: string;
  /** Something the person can quote to whoever helps them. */
  reference?: string | null;
  actions?: React.ReactNode;
  /** A quieter last line: what has NOT happened, or who to ask. */
  footnote?: React.ReactNode;
  /**
   * Set when this screen replaces something the person was already looking
   * at (the loading screen, a page that crashed) rather than being the page
   * they asked for. The title and message are then announced to a screen
   * reader as they appear; without it the change would be silent.
   */
  announce?: boolean;
}

/**
 * A whole screen that says one thing went wrong, and what to do (3 Oct
 * 2026, UI revamp Phase B, slice 2).
 *
 * Three situations used to have no screen of their own. A mistyped address
 * showed Next's unstyled "404 | This page could not be found". A page that
 * crashed showed Next's bare "An unexpected error occurred". And a session
 * check that could not reach the server sent the person to the sign-in page
 * with no explanation. All three now render this, so the worst moments in
 * the product look like the product: the same lockup, backdrop and card as
 * the sign-in page, a title in plain words, and a way forward.
 *
 * The copy sits on a surface card, not on the canvas: the backdrop behind
 * it is a colour wash, and text straight on a wash is exactly what the
 * Teacher masthead pass removed.
 */
export function StatusScreen({
  icon,
  tone = "brand",
  eyebrow,
  title,
  message,
  reference,
  actions,
  footnote,
  announce = false,
}: StatusScreenProps) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-canvas">
      <AuroraBackdrop />

      <header className="relative z-10 px-5 pt-6 sm:px-10 sm:pt-8">
        <Lockup />
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="relative w-full max-w-[33rem] rounded-4xl border border-line bg-surface/95 p-7 text-center shadow-panel backdrop-blur-xl animate-fade-up sm:p-10">
          {/* The same warm hairline the sign-in card has along its top edge. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-saffron-300/80 to-transparent"
          />

          <span
            aria-hidden
            className={cn(
              "mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border [&>svg]:h-7 [&>svg]:w-7",
              TONES[tone],
            )}
          >
            {icon}
          </span>

          <p className="mt-6 text-[0.6875rem] font-bold uppercase tracking-eyebrow text-content-brand">{eyebrow}</p>
          <div role={announce ? "alert" : undefined}>
            <h1 className="mt-2 font-display text-display-sm text-balance text-content sm:text-display-md">{title}</h1>
            <p className="mx-auto mt-3 max-w-[27rem] text-[0.9375rem] leading-[1.6] text-content-muted text-pretty sm:text-base">
              <ErrorText>{message}</ErrorText>
            </p>
          </div>

          {reference ? (
            <p className="mx-auto mt-5 inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-surface-muted px-3.5 py-1.5 text-[0.8125rem] text-content-muted">
              <span className="font-semibold">Reference</span>
              {/* select-all: one click or tap selects the whole reference,
                  so it can be copied without dragging across it. */}
              <span className="select-all font-mono font-semibold tracking-wide text-content">{reference}</span>
            </p>
          ) : null}

          {actions ? <div className="mt-7 flex flex-wrap items-center justify-center gap-3">{actions}</div> : null}

          {footnote ? (
            <p className="mx-auto mt-6 max-w-[26rem] border-t border-line pt-5 text-[0.8125rem] leading-[1.55] text-content-subtle text-pretty">
              {footnote}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
