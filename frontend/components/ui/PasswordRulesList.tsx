import { Check } from "lucide-react";
import type { PasswordCheck } from "@/lib/passwordRules";
import { cn } from "@/lib/utils";

export interface PasswordRulesListProps {
  /** Wired to the password box with aria-describedby, so the rules are read
   *  out with the field they belong to. */
  id: string;
  /** From lib/passwordRules.ts passwordChecks(): each rule, met or not. */
  checks: PasswordCheck[];
  /** True once the person has tried to save. Until then an unmet rule is
   *  simply not ticked yet; after, it is what is holding things up. */
  attempted: boolean;
  className?: string;
}

/**
 * The rules a chosen password must meet, as a checklist that fills in while
 * the person types (3 Oct 2026).
 *
 * First built into the "choose your own password" step teachers and
 * students meet at first sign-in (components/ChoosePassword.tsx). It lives
 * here so the admin's Security Settings shows the same list from the same
 * source: that form used to say "8+ characters, a letter and a number" in a
 * hint and leave the rest for the server to refuse.
 *
 * Two columns from the width of a phone up: five rules stacked would push
 * the button below them off a short laptop screen. The one rule that is a
 * full sentence takes a row to itself.
 */
export function PasswordRulesList({ id, checks, attempted, className }: PasswordRulesListProps) {
  return (
    <ul id={id} aria-label="Password rules" className={cn("grid gap-x-4 gap-y-1.5 min-[420px]:grid-cols-2", className)}>
      {checks.map((check) => (
        <li
          key={check.id}
          className={cn(
            "flex items-start gap-2 text-[0.8125rem] font-medium leading-snug transition-colors duration-200",
            // jade-800 on white 7.6:1; coral-700 7.3:1; content-muted 8.6:1.
            check.met ? "text-jade-800" : attempted ? "text-coral-700" : "text-content-muted",
            check.id === "different" ? "min-[420px]:col-span-2" : null,
          )}
        >
          <span
            aria-hidden
            className={cn(
              "mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition duration-200 ease-spring",
              check.met
                ? "scale-100 border-jade-600 bg-jade-600 text-white"
                : attempted
                  ? "border-coral-500 bg-surface"
                  : "border-line-strong bg-surface",
            )}
          >
            {check.met ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
          </span>
          <span>
            {check.label}
            <span className="sr-only">{check.met ? " (done)" : " (not yet)"}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
