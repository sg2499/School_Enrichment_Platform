"use client";

import { useSyncExternalStore } from "react";
import { getStoredUserForRole, roleForCurrentPage } from "@/lib/auth";
import type { UserRole } from "@/types/auth";

function subscribe(): () => void {
  // The answer comes from the URL and a per-tab marker, neither of which
  // changes while a not-found or error screen is showing.
  return () => {};
}

/**
 * The role whose workspace this tab is in, for the screens that render
 * outside any page and so are never handed a signed-in user: not-found and
 * the error boundary. null outside a role's area.
 *
 * Those screens are prerendered without knowing the address, so the HTML
 * that arrives carries the neutral wording (the server snapshot is null)
 * and the role's own replaces it when the page hydrates.
 * useSyncExternalStore rather than an effect: React makes that correction
 * as part of hydrating, in one pass, where an effect would hydrate with the
 * neutral wording, paint it, and then render again.
 */
export function useRoleForPage(): UserRole | null {
  return useSyncExternalStore(subscribe, roleForCurrentPage, () => null);
}

function adminSchoolForCurrentPage(): string | null {
  // Two things this must never do, because of where it is used. It must not
  // throw: the error screen calls it, and a browser with storage blocked
  // throws on every read. And it must return the same value until
  // something changes: useSyncExternalStore re-renders for ever on a
  // snapshot that is a new object each time, which is what a stored
  // profile with something other than text in this field would give.
  try {
    const role = roleForCurrentPage();
    if (role !== "ADMIN") return null;
    const name = getStoredUserForRole(role)?.admin?.schoolName;
    return typeof name === "string" && name ? name : null;
  } catch {
    return null;
  }
}

/**
 * The school of the school admin whose workspace this tab is in, so those
 * same two screens can title the tab the way every other admin page does
 * ("Page Not Found · MathPath Admin · Krama": lib/pageTitle.ts). null for
 * every other role, and before hydration.
 */
export function useAdminSchoolForPage(): string | null {
  return useSyncExternalStore(subscribe, adminSchoolForCurrentPage, () => null);
}
