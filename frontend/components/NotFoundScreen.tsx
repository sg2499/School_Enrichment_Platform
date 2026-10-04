"use client";

import { ArrowRight, Compass, LogIn } from "lucide-react";
import { usePageTitle } from "@/lib/hooks/usePageTitle";
import { useAdminSchoolForPage, useRoleForPage } from "@/lib/hooks/useRoleForPage";
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
 * One screen serves all four roles: the wording and the way back are the
 * role's own, and outside any workspace it offers the sign-in page.
 *
 * Which workspace it is in is known on the server (4 Oct 2026). It used to
 * be worked out in the browser from the address, because one file
 * (app/not-found.tsx) answered for every address and is prerendered
 * without one. That was harmless while only the wording depended on it.
 * Now the page it stands on does too -- the sign-in page's night outside a
 * workspace, the workspace's pale page inside one (StatusScreen `surface`)
 * -- and a guess made after the page has arrived would have painted a
 * wrong address in a workspace dark and then turned it pale. So each
 * workspace has a not-found of its own that says which it is
 * (app/student/not-found.tsx and its two siblings, reached through a
 * catch-all page beside each: app/student/[[...missing]]/page.tsx), and
 * app/not-found.tsx is left with the addresses outside all three.
 *
 * The one thing still settled in the browser is whether an /admin address
 * belongs to a School Admin or a Super Admin: that is in the stored
 * session, not the address. Only the wording follows it; the page is pale
 * either way.
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
    home: { href: defaultRouteForRole("STUDENT"), label: "Back To My Dashboard" },
    second: { href: "/student/practice", label: "Open Daily Practice" },
  },
  TEACHER: {
    eyebrow: "Teaching Workspace",
    message: "There's nothing at this address in your teaching workspace. The link may be out of date, or mistyped. Your classes and their work are where you left them.",
    home: { href: defaultRouteForRole("TEACHER"), label: "Back To Dashboard" },
    second: { href: "/teacher/tracker", label: "Open Practice Tracker" },
  },
  ADMIN: {
    eyebrow: "School Control Centre",
    message: "There's nothing at this address in your school's control centre. The link may be out of date, or mistyped. Nothing in your school's setup has changed.",
    home: { href: defaultRouteForRole("ADMIN"), label: "Back To Dashboard" },
    second: { href: "/admin/people", label: "Open People" },
  },
  SUPER_ADMIN: {
    eyebrow: "Platform Control Centre",
    message: "There's nothing at this address in the platform control centre. The link may be out of date, or mistyped. No school's setup has changed.",
    home: { href: defaultRouteForRole("SUPER_ADMIN"), label: "Back To Dashboard" },
    second: { href: "/admin/people", label: "Open People" },
  },
};

const SIGNED_OUT: Copy = {
  eyebrow: PRODUCT_NAME,
  message: "There's nothing at this address. The link may be out of date, or mistyped. If your school gave you an account, sign in to reach your workspace.",
  home: { href: "/login", label: "Go To Sign In" },
};

export type NotFoundSegment = "student" | "teacher" | "admin";

const SEGMENT_ROLE: Record<NotFoundSegment, UserRole> = { student: "STUDENT", teacher: "TEACHER", admin: "ADMIN" };

export function NotFoundScreen({ segment }: { segment: NotFoundSegment | null }) {
  // What the address and the stored session say, once in the browser. It
  // only ever refines an /admin address into Super Admin.
  const detected = useRoleForPage();
  const role: UserRole | null = segment ? (segment === "admin" && detected === "SUPER_ADMIN" ? "SUPER_ADMIN" : SEGMENT_ROLE[segment]) : null;
  usePageTitle("Page Not Found", role, useAdminSchoolForPage());
  const copy = role ? COPY[role] : SIGNED_OUT;

  return (
    <StatusScreen
      icon={<Compass />}
      tone="brand"
      surface={segment ? "paper" : "night"}
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
