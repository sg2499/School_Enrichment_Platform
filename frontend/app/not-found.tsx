"use client";

import { ArrowRight, Compass, LogIn } from "lucide-react";
import { usePageTitle } from "@/lib/hooks/usePageTitle";
import { useRoleForPage } from "@/lib/hooks/useRoleForPage";
import { defaultRouteForRole } from "@/lib/auth";
import { PRODUCT_NAME } from "@/lib/brand";
import type { UserRole } from "@/types/auth";
import { ButtonLink } from "@/components/ui/Button";
import { StatusScreen } from "@/components/ui/StatusScreen";

/*
 * An address that leads nowhere (3 Oct 2026, UI revamp Phase B, slice 2).
 *
 * There was no not-found page at all, so a mistyped or out-of-date link
 * showed Next's built-in one: black text on white, "404 | This page could
 * not be found." -- no brand, no way back, and a status code where a
 * sentence should be.
 *
 * One file serves all four roles. Next renders this for any unmatched
 * address, and the address says whose workspace it was meant for
 * (/teacher/..., /student/..., /admin/...), so the wording and the way back
 * are that role's own. Outside any workspace it offers the sign-in page.
 */

type Copy = {
  eyebrow: string;
  message: string;
  home: { href: string; label: string };
  second?: { href: string; label: string };
};

const COPY: Record<UserRole, Copy> = {
  STUDENT: {
    eyebrow: "Your Learning Space",
    message: "There's nothing at this address in your learning space. The link may be old, or mistyped. Your practice is where you left it.",
    home: { href: defaultRouteForRole("STUDENT"), label: "Back to My Dashboard" },
    second: { href: "/student/practice", label: "Open Daily Practice" },
  },
  TEACHER: {
    eyebrow: "Teaching Workspace",
    message: "There's nothing at this address in your teaching workspace. The link may be out of date, or mistyped. Your classes and their work are where you left them.",
    home: { href: defaultRouteForRole("TEACHER"), label: "Back to Dashboard" },
    second: { href: "/teacher/tracker", label: "Open Practice Tracker" },
  },
  ADMIN: {
    eyebrow: "School Control Centre",
    message: "There's nothing at this address in your school's control centre. The link may be out of date, or mistyped. Nothing in your school's setup has changed.",
    home: { href: defaultRouteForRole("ADMIN"), label: "Back to Dashboard" },
    second: { href: "/admin/people", label: "Open People" },
  },
  SUPER_ADMIN: {
    eyebrow: "Platform Control Centre",
    message: "There's nothing at this address in the platform control centre. The link may be out of date, or mistyped. No school's setup has changed.",
    home: { href: defaultRouteForRole("SUPER_ADMIN"), label: "Back to Dashboard" },
    second: { href: "/admin/people", label: "Open People" },
  },
};

const SIGNED_OUT: Copy = {
  eyebrow: PRODUCT_NAME,
  message: "There's nothing at this address. The link may be out of date, or mistyped. If your school gave you an account, sign in to reach your workspace.",
  home: { href: "/login", label: "Go to Sign In" },
};

export default function NotFound() {
  const role = useRoleForPage();
  usePageTitle("Page Not Found", role);
  const copy = role ? COPY[role] : SIGNED_OUT;

  return (
    <StatusScreen
      icon={<Compass />}
      tone="brand"
      eyebrow={copy.eyebrow}
      title="We can't find that page"
      message={copy.message}
      actions={
        <>
          <ButtonLink
            href={copy.home.href}
            leadingIcon={role ? undefined : <LogIn className="h-4 w-4" />}
            trailingIcon={role ? <ArrowRight className="h-4 w-4" /> : undefined}
          >
            {copy.home.label}
          </ButtonLink>
          {copy.second ? (
            <ButtonLink href={copy.second.href} variant="secondary">
              {copy.second.label}
            </ButtonLink>
          ) : null}
        </>
      }
    />
  );
}
