import axios from "axios";
import {
  clearSession,
  getActiveRoleHeaderValue,
  getCsrfToken,
  getStoredUserForRole,
  PASSWORD_CHANGE_PATH,
  roleForCurrentPage,
} from "./auth";
import { describeError, type DescribedError } from "./errors";
import { readSignedOutNotice, rememberSignedOut } from "./sessionNotice";

declare module "axios" {
  interface AxiosRequestConfig {
    /**
     * Set by a page that is holding work the person has not been able to
     * save (a student's answers, a teacher's marks). If the session turns
     * out to have ended, such a request is NOT answered by sending the tab
     * to the sign-in page -- that would discard the very thing it was
     * trying to save. The page gets the error back instead and tells the
     * person how to sign in again without losing what is on screen.
     */
    keepPageOnSessionEnd?: boolean;
    /**
     * Set by useProtectedPage on the session check every page makes when it
     * opens. If that check finds the session over, the hook redirects (a
     * client-side navigation, quicker than a reload), so the interceptor
     * records the reason and leaves the navigating to it.
     */
    pageSessionCheck?: boolean;
    /** Internal: marks the one automatic re-send after a CSRF refusal. */
    csrfRetried?: boolean;
  }
}

// Retained from MathPath's lib/api.ts (Phase 0 audit, "Retain as-is"
// bucket). Relative, same-origin base URL -- the actual backend is reached
// via the Next.js rewrite in next.config.mjs, which proxies /api/* to the
// real Render URL server-side. The browser itself never makes a
// cross-origin request, which is what lets the session cookie be
// first-party (SameSite=Lax) instead of needing the cross-site None that
// Safari/iOS block by default.
const DEFAULT_API_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS || "90000");

export const api = axios.create({
  baseURL: "/api",
  timeout: DEFAULT_API_TIMEOUT_MS,
  // Session lives in an httpOnly cookie (see backend/app/core/cookies.py)
  // instead of a token read out of localStorage -- withCredentials is what
  // makes the browser actually attach it on every request.
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const requestConfig = config as typeof config & { skipAuth?: boolean };
  if (requestConfig.skipAuth) {
    return config;
  }

  if (!config.headers) {
    config.headers = {} as typeof config.headers;
  }

  // Non-secret hint telling the backend which role's session cookie applies
  // to this request (a person can be logged into admin/teacher/student at
  // once in different tabs). Only set if a call site hasn't already
  // provided an explicit override.
  if (!config.headers["X-Auth-Role"] && !config.headers["x-auth-role"]) {
    const roleHint = getActiveRoleHeaderValue();
    if (roleHint) config.headers["X-Auth-Role"] = roleHint;
  }

  // CSRF double-submit token, required on every mutating request once a
  // cookie session exists. Harmless no-op before login (no cookie yet).
  const method = (config.method || "get").toLowerCase();
  if (["post", "put", "patch", "delete"].includes(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) config.headers["X-CSRF-Token"] = csrfToken;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Requests made with responseType: "blob" get their ERROR responses
    // parsed as a Blob too -- axios honors the request's responseType even
    // on failure, so a JSON error body the backend sent arrives as an
    // opaque Blob instead of parsed JSON. Re-hydrate it into real JSON
    // here, once, for every caller.
    if (typeof Blob !== "undefined" && error?.response?.data instanceof Blob) {
      try {
        const text = await error.response.data.text();
        error.response.data = JSON.parse(text);
      } catch {
        // Not JSON -- leave as-is.
      }
    }

    const status = error?.response?.status;
    const code = error?.response?.data?.detail?.code;
    if (typeof window !== "undefined") {
      if (describeError(error).kind === "session") {
        handleSessionEnded(error);
      } else if (status === 403 && code === "CSRF_VALIDATION_FAILED" && error?.config && !error.config.csrfRetried) {
        // The browser's CSRF cookie is missing. The session is fine -- this
        // is not a sign-out. The usual cause: the CSRF cookie is one cookie
        // shared by every role signed in on this browser, and signing out
        // of any of them removes it, so the other tabs' next change is
        // refused. The server re-issues the cookie on any signed-in request
        // (backend/app/core/cookies.py, touch_csrf_cookie), so: make one,
        // then send the original request again, once, with the new token
        // (the request interceptor reads the cookie afresh). When that
        // works the person never sees an error at all; when it doesn't,
        // they get the server's message from the second refusal.
        try {
          // Carries the original request's keepPageOnSessionEnd: if what
          // this finds is that the session is over, a page holding unsaved
          // work must hear that the same way it would have from its own
          // request, not be navigated away by the recovery.
          await api.get("/auth/me", { keepPageOnSessionEnd: error.config.keepPageOnSessionEnd });
          return await api.request({ ...error.config, csrfRetried: true });
        } catch (retryError) {
          return Promise.reject(retryError);
        }
      }
    }
    // Defense in depth for mandatory 2FA (backend/app/dependencies.py):
    // useProtectedPage already redirects an unenrolled admin to the setup
    // screen on page load, but a request made *during* that same session
    // (e.g. a background call still in flight, or an already-open tab) can
    // still hit this 403 first. Route it to the same place rather than
    // surfacing a raw "Two-factor authentication must be set up" error on
    // an unrelated screen.
    if (
      status === 403 &&
      code === "TWO_FACTOR_SETUP_REQUIRED" &&
      typeof window !== "undefined" &&
      !window.location.pathname.startsWith("/admin/security")
    ) {
      window.location.href = "/admin/security?setup=required";
    }
    // The same defense in depth for the forced password change, which
    // covers every role since 3 Oct 2026: a tab that was open when the rule
    // began to apply to its owner, or a request still in flight, gets this
    // 403 before useProtectedPage has had a page load to act on. Each role
    // has a place to go (PASSWORD_CHANGE_PATH). Not from the sign-in page,
    // which handles this as its own step and belongs to no role; and not
    // from a page holding unsaved work, which shows the server's sentence
    // ("Choose a new password to continue.") and keeps what was typed.
    if (status === 403 && code === "PASSWORD_CHANGE_REQUIRED" && typeof window !== "undefined") {
      const role = roleForCurrentPage();
      const target = role ? PASSWORD_CHANGE_PATH[role] : null;
      if (
        target &&
        !error?.config?.keepPageOnSessionEnd &&
        !window.location.pathname.startsWith(target.split("?")[0]) &&
        !sentThereMomentsAgo(target)
      ) {
        window.location.href = target;
      }
    }
    return Promise.reject(error);
  }
);

/**
 * True if this tab was sent to `target` within the last few seconds; records
 * the visit otherwise.
 *
 * A guard against going round in circles. The password-change screen sends
 * someone who has nothing to change back to their workspace; a request there
 * that is refused for want of a password change sends them to the screen.
 * The server would have to disagree with itself for both to happen, and it
 * does not -- but if it ever did, the tab would bounce between the two pages
 * for ever with nothing on screen long enough to read. With this, the second
 * refusal stays on the page and is shown as what it is.
 */
function sentThereMomentsAgo(target: string): boolean {
  const key = "school_enrichment_sent_to";
  const now = Date.now();
  try {
    const last = JSON.parse(sessionStorage.getItem(key) || "null") as { target?: string; at?: number } | null;
    if (last && last.target === target && typeof last.at === "number" && now - last.at < 15000) return true;
    sessionStorage.setItem(key, JSON.stringify({ target, at: now }));
  } catch {
    // No storage: no guard, which is how it behaved before the guard.
  }
  return false;
}

// Set just before a hard navigation to the sign-in page, so that the several
// requests a page usually has in flight when its session ends produce one
// navigation and one notice, not one each. A hard navigation reloads this
// module, which resets it -- but a navigation can also not happen (the
// page's own "leave this page?" prompt was declined) or be undone (Back,
// restoring this page from the browser's cache with the flag still set).
// Either would leave every later session end unanswered, so the flag also
// clears itself after a few seconds and whenever the page is shown again.
let leavingForSignIn = false;
if (typeof window !== "undefined") {
  window.addEventListener("pageshow", () => {
    leavingForSignIn = false;
  });
}

function requestPath(error: any): string {
  return typeof error?.config?.url === "string" ? error.config.url : "";
}

/**
 * The server has said the session behind this tab is over (expired, ended
 * by a password change, signed out everywhere, account deactivated -- its
 * sentence says which).
 *
 * Before 3 Oct 2026 this only cleared the stored profile. The person was
 * left on the page with a line of red text in whichever card had made the
 * request and no way to act on it; they had to find the sign-in page by
 * hand, and then landed on their dashboard rather than where they had been.
 * Now the server's reason and the current page are remembered
 * (lib/sessionNotice.ts) and the tab goes to sign-in, which shows the
 * reason and brings them back afterwards.
 *
 * Applies only inside a role's workspace. On the sign-in page a 401 is the
 * answer to the form, and the form shows it.
 */
function handleSessionEnded(error: unknown): void {
  const role = roleForCurrentPage();
  const path = requestPath(error);
  // Outside a role's workspace there is no session of this tab's to end: on
  // the sign-in page a 401 is the answer to the form (a two-factor step
  // left too long, for one), and the form shows it. Nothing is cleared --
  // in particular not the notice that says where to take them back to.
  if (!role) return;
  // Signing out of a session that had already ended is still just signing
  // out: RoleShell clears up and navigates, with nothing to explain.
  if (path.endsWith("/auth/logout")) return;
  // The page is holding unsaved work and will handle this itself.
  if ((error as { config?: { keepPageOnSessionEnd?: boolean } })?.config?.keepPageOnSessionEnd) return;

  if (leavingForSignIn) return;
  const here = window.location.pathname + window.location.search;
  // Who was signed in, so the sign-in page can take that same person back
  // to this page and nobody else. Read before clearSession() removes it.
  // If it is already gone, an earlier notice for this same page may still
  // know (a second request failing a moment after the first): keep that
  // rather than replacing a notice that knows with one that doesn't.
  const earlier = readSignedOutNotice();
  const userId = getStoredUserForRole(role)?.id ?? (earlier?.returnTo === here ? earlier.userId : null);
  clearSession();
  // After clearSession(), which drops any earlier notice.
  rememberSignedOut({ message: describeError(error).message, returnTo: here, userId });
  // The check every page makes on load (useProtectedPage) does its own
  // client-side redirect, which is quicker than a full reload and already
  // shows the loading screen. Everything else -- a request made from a page
  // that was open and working -- has nothing watching for this.
  if ((error as { config?: { pageSessionCheck?: boolean } })?.config?.pageSessionCheck) return;
  leavingForSignIn = true;
  window.setTimeout(() => {
    leavingForSignIn = false;
  }, 5000);
  window.location.assign("/login");
}

/**
 * What to show for a failed request, with the reader's role filled in from
 * the page they are on. `action` completes "We couldn't ...": pass what was
 * being attempted in the words the screen uses ("load your sections", "save
 * this mark"). See lib/errors.ts for what this does and never does.
 */
export function describeApiError(error: unknown, action?: string): DescribedError {
  return describeError(error, { action, role: roleForCurrentPage() });
}

/** describeApiError(...).message, for the many places that hold one string. */
export function errorMessage(error: unknown, action?: string): string {
  return describeApiError(error, action).message;
}
