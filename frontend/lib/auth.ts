import type { CurrentUser, UserRole } from "@/types/auth";
import { clearSignedOutNotice } from "./sessionNotice";

// Retained from MathPath's lib/auth.ts (Phase 0 audit, "Retain as-is"
// bucket), storage keys renamed from mathpath_* to school_enrichment_* and
// the CSRF cookie name matched to backend/app/core/cookies.py's se_csrf.
//
// The actual session lives entirely in an httpOnly cookie that page JS
// cannot read at all -- that's the whole point, it closes off the
// XSS-reads-localStorage token-theft path. Everything stored here is
// non-secret: the user's own profile (for display) and a "which role is
// this tab acting as" hint used purely for client-side routing UX and to
// tell the shared axios client which cookie the backend should check for a
// given request. None of it grants access on its own -- forging any of
// these values client-side gets you a UI shell at best; every real API
// call is still authorized server-side against the httpOnly cookie.
const LEGACY_USER_KEY = "school_enrichment_user";
const ACTIVE_ROLE_KEY = "school_enrichment_active_role";
const CSRF_COOKIE_NAME = "se_csrf";
const KNOWN_SCHOOL_KEY = "school_enrichment_known_school";

// ADMIN and SUPER_ADMIN both live under /admin/*, so the URL alone can't
// tell them apart the way it does for /teacher and /student. sessionStorage
// (unlike localStorage) is scoped per-tab, not per-browser, so it's the
// right place to remember "which of the two this specific tab signed in
// as" -- set once at login (setSession below), read on every later request
// in that same tab so the X-Auth-Role hint (and thus which cookie the
// backend checks) stays correct even when another tab logs into the other
// admin variant in the meantime. Falls back to "ADMIN" for a brand-new tab
// that hasn't logged in yet in this tab -- harmless, since the backend
// still falls back to scanning every cookie it has if the hint misses.
const ADMIN_ROLE_VARIANT_KEY = "school_enrichment_admin_role_variant";

function setAdminRoleVariant(role: "ADMIN" | "SUPER_ADMIN"): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(ADMIN_ROLE_VARIANT_KEY, role);
  } catch {
    // Storage full or blocked (private browsing) -- worst case the hint
    // falls back to "ADMIN" next read, which the backend's cookie-scan
    // fallback still recovers from.
  }
}

function getAdminRoleVariant(): "ADMIN" | "SUPER_ADMIN" {
  if (typeof window === "undefined") return "ADMIN";
  try {
    return sessionStorage.getItem(ADMIN_ROLE_VARIANT_KEY) === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN";
  } catch {
    return "ADMIN";
  }
}

function roleFromPath(): UserRole | null {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname;
  if (path.startsWith("/admin")) return getAdminRoleVariant();
  if (path.startsWith("/teacher")) return "TEACHER";
  if (path.startsWith("/student")) return "STUDENT";
  return null;
}

/** The role whose workspace this tab is showing, from the URL alone -- null
 * on the sign-in page and anywhere else outside a role's area. Used for
 * wording (who an error message tells someone to ask, what a not-found page
 * offers to take them back to), where "the last role that signed in on this
 * browser" would be the wrong answer: on /login nobody is signed in yet.
 * Never used for authorization.
 */
export function roleForCurrentPage(): UserRole | null {
  return roleFromPath();
}

function normalizeRole(role?: string | null): UserRole | null {
  if (role === "ADMIN" || role === "SUPER_ADMIN" || role === "TEACHER" || role === "STUDENT") return role;
  return null;
}

function activeRole(): UserRole | null {
  if (typeof window === "undefined") return null;
  const pathRole = roleFromPath();
  if (pathRole) return pathRole;
  return normalizeRole(localStorage.getItem(ACTIVE_ROLE_KEY));
}

export function setActiveRole(role: UserRole): void {
  if (typeof window === "undefined") return;
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) return;
  if (localStorage.getItem(ACTIVE_ROLE_KEY) === normalizedRole) return;
  localStorage.setItem(ACTIVE_ROLE_KEY, normalizedRole);
  window.dispatchEvent(new Event("school-enrichment-auth-changed"));
}

/** Non-secret role hint attached as the X-Auth-Role header by lib/api.ts's
 * axios interceptor -- lets the backend pick the right session cookie when
 * more than one role is logged in in different tabs. This selects a
 * cookie, it never substitutes for one.
 */
export function getActiveRoleHeaderValue(): string | null {
  return activeRole();
}

/** Reads the non-httpOnly CSRF cookie's value so it can be echoed back as
 * the X-CSRF-Token header (double-submit pattern).
 */
export function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function userKey(role: UserRole) {
  return `school_enrichment_${role.toLowerCase()}_user`;
}

function stripLargeInlinePhotos(user: CurrentUser): CurrentUser {
  const isDataUrl = (value?: string | null) => Boolean(value && value.startsWith("data:"));
  return {
    ...user,
    profilePhotoUrl: isDataUrl(user.profilePhotoUrl) ? null : user.profilePhotoUrl,
    student: user.student
      ? {
          ...user.student,
          photoUrl: isDataUrl(user.student.photoUrl) ? null : user.student.photoUrl,
          signatureUrl: isDataUrl(user.student.signatureUrl) ? null : user.student.signatureUrl,
        }
      : user.student,
    teacher: user.teacher
      ? {
          ...user.teacher,
          photoUrl: isDataUrl(user.teacher.photoUrl) ? null : user.teacher.photoUrl,
          signatureUrl: isDataUrl(user.teacher.signatureUrl) ? null : user.teacher.signatureUrl,
        }
      : user.teacher,
  };
}

function safeSetJson(storageKey: string, value: CurrentUser): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(stripLargeInlinePhotos(value)));
  } catch {
    localStorage.removeItem(storageKey);
    localStorage.setItem(storageKey, JSON.stringify(stripLargeInlinePhotos({ ...value, profilePhotoUrl: null })));
  }
}

export function getStoredUserForRole(role: UserRole): CurrentUser | null {
  if (typeof window === "undefined") return null;
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) return null;
  const raw = localStorage.getItem(userKey(normalizedRole));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CurrentUser;
  } catch {
    return null;
  }
}

function schoolNameFromUser(user: CurrentUser): string | null {
  return user.student?.schoolName || user.teacher?.schoolName || user.admin?.schoolName || null;
}

/** Remembers which school this browser last signed in as -- purely a
 * display convenience (the sign-in page's "Accounts here are issued by <school>" line) for a
 * returning visitor on their own device. Never used for authorization: the
 * login page still asks for real credentials regardless of what this says,
 * and a person on a shared/public device simply sees the generic pill until
 * they've actually signed in here once. Non-secret, just a name string.
 */
export function rememberSchoolName(name: string | null | undefined): void {
  if (typeof window === "undefined" || !name) return;
  try {
    localStorage.setItem(KNOWN_SCHOOL_KEY, name);
  } catch {
    // Storage full or blocked (private browsing) -- the pill just falls
    // back to generic wording next visit, nothing else depends on this.
  }
}

export function getRememberedSchoolName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(KNOWN_SCHOOL_KEY);
  } catch {
    return null;
  }
}

/** Persists the logged-in user's own profile (display only, non-secret) and
 * marks this role as active. Called once per successful login/2FA-verify;
 * the real session was already established server-side via the httpOnly
 * cookie the login response set before this runs.
 */
export function setSession(user: CurrentUser): void {
  const role = normalizeRole(user.role) || "STUDENT";
  if (role === "ADMIN" || role === "SUPER_ADMIN") setAdminRoleVariant(role);
  safeSetJson(userKey(role), user);
  localStorage.setItem(ACTIVE_ROLE_KEY, role);
  safeSetJson(LEGACY_USER_KEY, user);
  rememberSchoolName(schoolNameFromUser(user));
  window.dispatchEvent(new Event("school-enrichment-auth-changed"));
}

/** Forgets the signed-in profile for this tab's role.
 *
 * Also drops any "why you were signed out" notice (lib/sessionNotice.ts):
 * every deliberate way out -- Sign out, Sign out everywhere, a password
 * change -- comes through here, and none of them should leave an old
 * explanation waiting on the sign-in page. Code that does want the sign-in
 * page to explain itself records its notice AFTER calling this.
 */
export function clearSession(): void {
  if (typeof window === "undefined") return;
  clearSignedOutNotice();
  const role = activeRole();
  if (role) {
    localStorage.removeItem(userKey(role));
  }
  localStorage.removeItem(LEGACY_USER_KEY);
  try {
    sessionStorage.removeItem(ADMIN_ROLE_VARIANT_KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event("school-enrichment-auth-changed"));
}

export function updateStoredUser(user: CurrentUser): void {
  if (typeof window === "undefined") return;
  const role = normalizeRole(user.role) || activeRole() || "STUDENT";
  if (role === "ADMIN" || role === "SUPER_ADMIN") setAdminRoleVariant(role);
  safeSetJson(userKey(role), user);
  localStorage.setItem(ACTIVE_ROLE_KEY, role);
  safeSetJson(LEGACY_USER_KEY, user);
}

export function getStoredUser(): CurrentUser | null {
  if (typeof window === "undefined") return null;
  const role = activeRole();
  const raw = role ? localStorage.getItem(userKey(role)) : localStorage.getItem(LEGACY_USER_KEY);
  const fallback = localStorage.getItem(LEGACY_USER_KEY);
  const value = raw || fallback;
  if (!value) return null;
  try {
    const parsedUser = JSON.parse(value) as CurrentUser;
    const sanitizedUser = stripLargeInlinePhotos(parsedUser);
    if (JSON.stringify(parsedUser) !== JSON.stringify(sanitizedUser)) {
      const normalizedRole = normalizeRole(sanitizedUser.role) || role || "STUDENT";
      safeSetJson(userKey(normalizedRole), sanitizedUser);
      safeSetJson(LEGACY_USER_KEY, sanitizedUser);
    }
    return sanitizedUser;
  } catch {
    return null;
  }
}

export function defaultRouteForRole(role: UserRole): string {
  if (role === "STUDENT") return "/student/dashboard";
  if (role === "TEACHER") return "/teacher/dashboard";
  return "/admin/dashboard";
}

/** Where an admin sets up two-factor and replaces an issued password. */
export const SECURITY_SETUP_PATH = "/admin/security";

// A1 fix (30 Sep 2026 security/DPDP review): where someone still on a
// password another person issued is sent to replace it, by role. Mirrors
// the backend's MUST_CHANGE_PASSWORD_ROLES (dependencies.py) -- every role,
// since 3 Oct 2026. Admins do it on the security page, which then walks
// them into two-factor setup; teachers and students have a screen of their
// own (components/SetPasswordScreen.tsx). The server enforces the rule
// whatever this does: this is what makes it a screen instead of a wall of
// refused requests.
export const PASSWORD_CHANGE_PATH: Record<UserRole, string> = {
  ADMIN: `${SECURITY_SETUP_PATH}?passwordChange=required`,
  SUPER_ADMIN: `${SECURITY_SETUP_PATH}?passwordChange=required`,
  TEACHER: "/teacher/set-password",
  STUDENT: "/student/set-password",
};
