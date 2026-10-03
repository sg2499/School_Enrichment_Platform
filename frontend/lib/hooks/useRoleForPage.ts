"use client";

import { useSyncExternalStore } from "react";
import { roleForCurrentPage } from "@/lib/auth";
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
