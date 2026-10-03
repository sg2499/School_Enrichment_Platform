/**
 * Why someone was sent to the sign-in page, and where to take them back to
 * (3 Oct 2026, UI revamp Phase B, slice 2).
 *
 * Before this, a session that ended while a page was open produced a line
 * of red text in whatever card had made the request -- "Your session has
 * expired. Please sign in again." -- and nothing else. No way to sign in
 * from there, and after finding the sign-in page by hand the person landed
 * on their dashboard, not the screen they had been working on. A session
 * that had ended before the page loaded was a silent bounce to a sign-in
 * form that gave no reason.
 *
 * Now the reason travels with them. When the server says the session is
 * over (lib/api.ts, lib/hooks/useProtectedPage.ts), the server's own
 * sentence and the current page are put here; the sign-in page shows the
 * sentence and, once they are back in, returns them to that page.
 *
 * It lives in sessionStorage: per tab, gone when the tab closes, never sent
 * anywhere. Two rules keep "take them back" from doing harm on the shared
 * computers schools actually use:
 *
 *   * It only ever returns someone to a page inside their own role's area,
 *     and only to a path on this site (returnPathFor).
 *   * It only returns the person whose session it was. Student A's expired
 *     tab must not drop student B onto A's assignment. If the browser did
 *     not know who was signed in when the session ended (A had already
 *     signed out in another tab, which removes the stored profile), nobody
 *     is returned: the price is someone who opened a bookmark while signed
 *     out landing on their dashboard instead, which is where they would
 *     have landed anyway before this existed.
 *
 * And it expires: a notice from this morning says nothing true about why
 * the form is showing now.
 *
 * No runtime imports, so the rules above are unit-tested directly (see
 * scripts/run-unit-tests.mjs).
 */
import type { UserRole } from "@/types/auth";

const STORAGE_KEY = "school_enrichment_signed_out";
/** Long enough to find a password; short enough to mean "just now". */
export const NOTICE_LIFETIME_MS = 30 * 60 * 1000;

export interface SignedOutNotice {
  /** The server's sentence about why, shown on the sign-in page. */
  message: string;
  /** Path (with query) of the page they were on, or null. */
  returnTo: string | null;
  /** Who was signed in at the time, when the browser knew. */
  userId: string | null;
  /** When it was recorded, ms since epoch. */
  at: number;
}

const AREA: Record<UserRole, string> = {
  ADMIN: "/admin/",
  SUPER_ADMIN: "/admin/",
  TEACHER: "/teacher/",
  STUDENT: "/student/",
};

/**
 * `path` if it is a page inside `role`'s own area of this site, otherwise
 * null. Anything that is not a plain same-site path -- another origin, a
 * protocol-relative "//host", a backslash trick, a different role's area --
 * is refused rather than repaired.
 */
export function safeReturnPath(path: unknown, role: UserRole): string | null {
  if (typeof path !== "string" || path.length === 0 || path.length > 512) return null;
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f]/.test(path)) return null;
  let parsed: URL;
  try {
    // A base that cannot be a real destination: if `path` manages to change
    // the origin, it was not a path.
    parsed = new URL(path, "https://return.invalid");
  } catch {
    return null;
  }
  if (parsed.origin !== "https://return.invalid") return null;
  const area = AREA[role];
  if (!area || !parsed.pathname.startsWith(area)) return null;
  return parsed.pathname + parsed.search;
}

/**
 * Where to send `user` after they sign in, given the notice that brought
 * them to the sign-in page -- or null for "their usual landing page".
 */
export function returnPathFor(
  notice: SignedOutNotice | null,
  user: { id: string; role: UserRole },
  now: number = Date.now(),
): string | null {
  if (!notice || !notice.returnTo) return null;
  if (now - notice.at > NOTICE_LIFETIME_MS || now < notice.at) return null;
  if (!notice.userId || notice.userId !== user.id) return null;
  return safeReturnPath(notice.returnTo, user.role);
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    // Reading the property itself throws when storage is blocked.
    return null;
  }
}

/** Records why this tab is about to show the sign-in page. Never throws. */
export function rememberSignedOut(notice: { message: string; returnTo?: string | null; userId?: string | null }): void {
  const store = storage();
  if (!store) return;
  const record: SignedOutNotice = {
    message: notice.message,
    returnTo: notice.returnTo ?? null,
    userId: notice.userId ?? null,
    at: Date.now(),
  };
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Full or blocked: they still reach the sign-in page, just without the reason.
  }
}

/** The current notice, or null if there is none or it has gone stale. */
export function readSignedOutNotice(now: number = Date.now()): SignedOutNotice | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SignedOutNotice> | null;
    if (!parsed || typeof parsed.message !== "string" || !parsed.message.trim() || typeof parsed.at !== "number") {
      return null;
    }
    if (now - parsed.at > NOTICE_LIFETIME_MS || now < parsed.at) return null;
    return {
      message: parsed.message.trim().slice(0, 300),
      returnTo: typeof parsed.returnTo === "string" ? parsed.returnTo : null,
      userId: typeof parsed.userId === "string" ? parsed.userId : null,
      at: parsed.at,
    };
  } catch {
    return null;
  }
}

/** Called once someone is signed in again, and when they sign out on purpose. */
export function clearSignedOutNotice(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: a stale notice is ignored by its age anyway.
  }
}
