"use client";

import { useEffect } from "react";
import { pageTitle } from "@/lib/pageTitle";
import type { UserRole } from "@/types/auth";

/**
 * Sets the browser tab's title for as long as the calling component is on
 * screen. See lib/pageTitle.ts for the format and why it exists.
 *
 * Every signed-in page gets this through RoleShell, which titles the tab
 * with the current navigation item unless the page passes its own `title`
 * (a detail view naming the student or the assignment it is showing). Pages
 * outside the shell -- sign-in, the not-found and error screens -- call it
 * directly.
 *
 * An effect rather than Next's `metadata`, because every page here is a
 * client component and most titles depend on who is signed in or on data
 * that has to load first. The role-level layouts (app/teacher/layout.tsx and
 * its siblings) still export `metadata`, so the tab has a sensible title
 * from the first byte, before this runs.
 */
export function usePageTitle(
  page: string | Array<string | null | undefined> | null | undefined,
  role?: UserRole | null,
  /** A school admin's school, so the tab names it: see roleLabel(). */
  schoolName?: string | null,
): void {
  const title = pageTitle(page, role, schoolName);
  useEffect(() => {
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();
    // Next also owns the <title> element: it writes the layout's metadata
    // into it, and can do so after this effect has run (metadata is
    // streamed in on some routes, and re-applied on navigation). Measured
    // on the not-found page, where the tab ended up back at the layout's
    // default a moment after this had set it. So for as long as this
    // component is on screen, any change to the title that isn't ours is
    // put back. It cannot loop: apply() writes only when the value differs.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
}
