import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { COMPANY_NAME, COMPANY_URL } from "@/lib/brand";
import { cn } from "@/lib/utils";
import emblem from "@/public/brand/zetta-metrics-emblem.png";
import wordmark from "@/public/brand/zetta-metrics-wordmark.png";

/**
 * "A product of Zetta Metrics", with the company's real logo (4 Oct 2026).
 *
 * Until now the product credited its maker in words only. The logo is what
 * makes the credit read as the company's own rather than as a claim about
 * it, and it is a link: to the company's website, always in a new window,
 * because it sits only on the sign-in page and the screens that share its
 * night (components/brand/NightStage.tsx), and nobody should lose one of
 * those to a link.
 *
 * Sized entirely in em, so the caller sets one font-size (the size of the
 * small caps) and the logo, the rule and the gaps all follow. For dark
 * surfaces only: the two pictures are the logo cut from a dark ground, glow
 * and all (brand/README.md).
 *
 * The accessible name is read off the content: "A product of", then the
 * wordmark's alt text, then the note about the new window (in brackets, so
 * it reads as an aside whatever a screen reader puts between the parts).
 * The emblem repeats what the wordmark says, so it is decorative.
 */
export function MakerCredit({ className, arrowClassName }: { className?: string; arrowClassName?: string }) {
  return (
    <a
      href={COMPANY_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group/maker inline-flex shrink-0 items-center gap-[1.3em] whitespace-nowrap rounded-xl py-[0.5em] text-content-inverse outline-none",
        // The ring is the logo's own cyan (the one colour here that is not
        // Krama's), offset so it clears the glow around the emblem.
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[6px] focus-visible:outline-[#7BE9EE]",
        className,
      )}
    >
      <span className="text-[1em] font-bold uppercase leading-none tracking-[0.2em] text-content-inverse-muted transition-colors duration-300 group-hover/maker:text-content-inverse">
        A product of
      </span>
      <span aria-hidden className="h-[2.95em] w-px shrink-0 bg-white/[0.22]" />
      <span className="inline-flex shrink-0 items-center gap-[0.6em] transition duration-300 group-hover/maker:brightness-[1.18] group-hover/maker:drop-shadow-[0_0_14px_rgba(90,225,235,0.45)]">
        <Image src={emblem} alt="" sizes="6rem" className="h-[3.99em] w-[3.74em] shrink-0" />
        <Image src={wordmark} alt={COMPANY_NAME} sizes="14rem" className="h-[3.04em] w-[9.83em] shrink-0" />
      </span>
      <ArrowUpRight
        aria-hidden
        className={cn(
          "-ml-[0.4em] h-[1.3em] w-[1.3em] shrink-0 text-white/60 transition duration-300 group-hover/maker:-translate-y-0.5 group-hover/maker:translate-x-0.5 group-hover/maker:text-[#7BE9EE]",
          arrowClassName,
        )}
      />
      <span className="sr-only">(opens the {COMPANY_NAME} website in a new window)</span>
    </a>
  );
}
