import { ExternalLink } from "lucide-react";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { ButtonLink } from "@/components/ui/Button";

/**
 * Shown on a page that is holding work the person has not been able to save
 * when their session turns out to have ended (3 Oct 2026).
 *
 * Everywhere else a session ending sends the tab to the sign-in page and
 * brings the person back afterwards (lib/api.ts). On these pages that would
 * throw away the very thing they were trying to save -- a student's answers,
 * a teacher's marks -- because it exists only on the screen. So the page
 * stays, and this says how to get signed in again without leaving it: the
 * session is a cookie shared by every tab, so signing in in another tab
 * makes this one work again.
 *
 * `children` is the sentence for this page: what is at stake, and what to
 * press once they are back.
 */
export function SignInAgainBanner({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <AlertBanner
      tone="error"
      className={className}
      message={
        <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          <span className="min-w-0 flex-1 basis-[16rem]">{children}</span>
          <ButtonLink
            href="/login"
            target="_blank"
            rel="noopener"
            variant="secondary"
            size="sm"
            trailingIcon={<ExternalLink className="h-3.5 w-3.5" />}
          >
            Sign In in a New Tab
          </ButtonLink>
        </span>
      }
    />
  );
}
