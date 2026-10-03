"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";
import type { CurrentUser } from "@/types/auth";

/**
 * For a page that stayed up after its session ended because it is holding
 * unsaved work (components/SignInAgainBanner.tsx). The person has been told
 * to sign in again in another tab and come back; this notices when they do.
 *
 * While `waiting` is true, each time this tab is looked at again it asks the
 * server who is signed in. If it is the same person, `onBack` runs -- the
 * page takes its banner down and carries on (re-sends what was waiting).
 * If nobody is, or it is someone else, nothing happens and the banner stays:
 * work typed by one person must not be saved under another.
 *
 * Without this the banner would go on saying "your session has ended" after
 * they had signed in, until they happened to type or press something.
 */
export function useSessionReturn(waiting: boolean, userId: string | null | undefined, onBack: () => void): void {
  useEffect(() => {
    if (!waiting || !userId) return;
    let cancelled = false;
    let asking = false;
    const check = () => {
      if (document.visibilityState !== "visible" || asking) return;
      asking = true;
      api
        // keepPageOnSessionEnd: still signed out is the expected answer here,
        // and must not be what finally sends this tab to the sign-in page.
        .get<CurrentUser>("/auth/me", { keepPageOnSessionEnd: true })
        .then(({ data }) => {
          if (!cancelled && data.id === userId) onBack();
        })
        .catch(() => {
          // Not signed in yet, or not reachable: keep waiting.
        })
        .finally(() => {
          asking = false;
        });
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [waiting, userId, onBack]);
}
