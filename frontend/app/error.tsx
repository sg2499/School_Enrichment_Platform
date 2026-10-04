"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { ArrowRight, LogIn, RotateCw, TriangleAlert } from "lucide-react";
import { usePageTitle } from "@/lib/hooks/usePageTitle";
import { useAdminSchoolForPage, useRoleForPage } from "@/lib/hooks/useRoleForPage";
import { defaultRouteForRole } from "@/lib/auth";
import { PRODUCT_NAME } from "@/lib/brand";
import type { UserRole } from "@/types/auth";
import { Button, ButtonLink } from "@/components/ui/Button";
import { StatusScreen } from "@/components/ui/StatusScreen";

/*
 * A page that crashed while drawing itself (3 Oct 2026, UI revamp Phase B,
 * slice 2).
 *
 * Next shows this in place of any page under it that throws while
 * rendering. There was none before, so the only net was global-error.tsx,
 * which rendered Next's own bare "An unexpected error occurred" for every
 * role alike.
 *
 * What it must never do is show the error. `error.message` is whatever the
 * JavaScript engine said -- "Cannot read properties of undefined (reading
 * 'map')" -- and is for the log, not the person. What it shows instead is
 * what they need: that this page stopped, that what they had already saved
 * is untouched (a crash in the browser cannot reach the server), a way to
 * try again, a way out, and who to tell -- by role.
 *
 * `error.digest` is Next's reference for an error thrown on the server; it
 * is shown when present so there is something to quote. Errors thrown in
 * the browser have none.
 */

const SAFE: Record<UserRole, string> = {
  STUDENT: "Answers you've already saved are safe.",
  TEACHER: "Marks and assignments you've already saved are safe.",
  ADMIN: "Changes you've already saved are safe.",
  SUPER_ADMIN: "Changes you've already saved are safe.",
};

const TELL: Record<UserRole, string> = {
  STUDENT: "If it happens again, tell your teacher which page you were on.",
  TEACHER: "If it happens again, tell your school admin which page you were on.",
  ADMIN: "If it happens again, tell your platform administrator which page you were on.",
  SUPER_ADMIN: "If it happens again, note the page and what you did just before it: that is what's needed to trace it.",
};

const EYEBROW: Record<UserRole, string> = {
  STUDENT: "Your Learning Space",
  TEACHER: "Teaching Workspace",
  ADMIN: "School Control Centre",
  SUPER_ADMIN: "Platform Control Centre",
};

export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const role = useRoleForPage();
  usePageTitle("Something Went Wrong", role, useAdminSchoolForPage());

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <StatusScreen
      icon={<TriangleAlert />}
      tone="problem"
      eyebrow={role ? EYEBROW[role] : PRODUCT_NAME}
      title="This page ran into a problem"
      message={
        role
          ? `Something on this page stopped working, so we couldn't show it. ${SAFE[role]}`
          : "Something on this page stopped working, so we couldn't show it."
      }
      reference={error.digest ?? null}
      announce
      actions={
        <>
          <Button onClick={reset} leadingIcon={<RotateCw className="h-4 w-4" />}>
            Try Again
          </Button>
          {role ? (
            <ButtonLink href={defaultRouteForRole(role)} variant="secondary" trailingIcon={<ArrowRight className="h-4 w-4" />}>
              Back to Dashboard
            </ButtonLink>
          ) : (
            <ButtonLink href="/login" variant="secondary" leadingIcon={<LogIn className="h-4 w-4" />}>
              Go to Sign In
            </ButtonLink>
          )}
        </>
      }
      footnote={role ? TELL[role] : "If it happens again, try signing in again from the start."}
    />
  );
}
