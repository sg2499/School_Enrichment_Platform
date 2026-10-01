"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type UrlUpdates = Record<string, string | number | null | undefined>;

/**
 * Page state that lives in the URL's query string -- the Practice Tracker's
 * sub-tab (`?tab=`), section, filters, search and page number.
 *
 * Why the URL rather than useState: a tab or filtered page is then a real
 * address. Refresh keeps you where you were, the browser's Back button
 * steps back through tabs, and a teacher can bookmark or share "Needs
 * Review for 5A". This is the same mechanism the MathPath reference uses
 * for its tracker sub-tabs (PROJECT_REFERENCE.md, 20 Aug 2026 research
 * note), applied to this product's own pages.
 *
 * `set` merges: keys not mentioned keep their value; null/undefined/""
 * removes a key, so defaults never clutter the URL. Changes of context
 * (tab, section) should pass `{ push: true }` -- a history entry Back can
 * return to; filter, search and page changes replace the current entry so
 * Back doesn't replay every keystroke of a search.
 *
 * Callers must sit under a <Suspense> boundary: Next renders statically
 * prerendered pages without search params, and useSearchParams() opts the
 * subtree into client rendering.
 */
export function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const get = useCallback((key: string): string | null => searchParams.get(key), [searchParams]);

  const set = useCallback(
    (updates: UrlUpdates, options: { push?: boolean } = {}) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === "") next.delete(key);
        else next.set(key, String(value));
      }
      const query = next.toString();
      const url = query ? `${pathname}?${query}` : pathname;
      if (options.push) router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return { get, set, searchParams };
}

/** A positive page number from the URL, defaulting to 1. */
export function pageFromParam(value: string | null): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
