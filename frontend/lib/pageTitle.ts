/**
 * What the browser tab says (3 Oct 2026, UI revamp Phase B, slice 2).
 *
 * Before this, every page of every role had the same tab title: the
 * product's name and nothing else. All the pages are client components, so none could export
 * Next's `metadata`, and nothing else set one. With a teacher, a student
 * and two admins signed in side by side -- which is how this product is
 * tested, and how a school office uses it -- that is four identical tabs.
 *
 * A title is built from what tells tabs apart first:
 *
 *   Practice Tracker · Teacher · Krama
 *   Aarav Shah · Practice Tracker · Teacher · Krama
 *   People · Super Admin · Krama
 *   People · MathPath Admin · Krama
 *   Sign In · Krama
 *
 * Page first, because a narrow tab shows only the start. Role second,
 * because Admin and Super Admin share every route and "People" alone would
 * not say which of the two this tab is. Product last.
 *
 * Its only runtime import is the product's name (lib/brand.ts), so it can be
 * unit-tested directly (see scripts/run-unit-tests.mjs). The hook that applies it is
 * lib/hooks/usePageTitle.ts.
 */
import type { UserRole } from "@/types/auth";
import { PRODUCT_NAME } from "./brand";

export { PRODUCT_NAME };

/**
 * How each role is named when nothing more is known about the person. The
 * interface does not read this directly: it asks roleLabel(), below, which
 * is the one source for the rail, the mobile bar, the profile menu, the
 * footer and the tab -- so a role can never be "Admin" in one place and
 * "School Admin" in another.
 */
export const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "School Admin",
  SUPER_ADMIN: "Super Admin",
  TEACHER: "Teacher",
  STUDENT: "Student",
};

/**
 * The longest school name that is put in front of "Admin" (below). A name
 * this long makes a label of 28 characters, which is what the rail can show
 * whole on its two lines and the mobile bar on its one (down to a 320px
 * phone, where the bar tightens its letter spacing to fit); a longer one
 * would be cut off mid-word there, and a role cut off mid-word is worse
 * than a plain one.
 */
export const SCHOOL_NAME_IN_ROLE_MAX = 22;

/**
 * How the person signed in is named: ROLE_LABEL, except that a school's own
 * admin is named after the school (4 Oct 2026).
 *
 * "School Admin" is true of every school's admin and so says nothing to
 * any of them. "MathPath Admin" says whose admin this is -- to the person
 * themselves and, in a tab title, to anyone with two schools open side by
 * side. It applies to ADMIN only:
 *
 *   - A Super Admin belongs to no school.
 *   - A teacher or a student is not "the school's teacher" in the way an
 *     admin is the school's admin; their school is shown where it is useful
 *     (the footer, the masthead), not welded to their role.
 *
 * With no school name to hand -- the profile has not loaded, or the name is
 * longer than SCHOOL_NAME_IN_ROLE_MAX -- it is the plain label, so every
 * surface that asks gets the same answer for the same person.
 */
export function roleLabel(role: UserRole, schoolName?: string | null): string {
  if (role === "ADMIN") {
    const name = typeof schoolName === "string" ? schoolName.replace(/\s+/g, " ").trim() : "";
    // A name that already ends in "Admin" would read "... Admin Admin".
    if (name && name.length <= SCHOOL_NAME_IN_ROLE_MAX && !/\badmin$/i.test(name)) return `${name} Admin`;
  }
  return ROLE_LABEL[role];
}

const SEPARATOR = " · ";

/**
 * `page` may itself be several parts, most specific first: pass
 * ["Aarav Shah", "Practice Tracker"] for a detail view. Empty parts are
 * dropped, so a title is never "undefined · Teacher" while data is loading.
 *
 * `schoolName` is for a school admin's tab only: see roleLabel().
 */
export function pageTitle(
  page: string | Array<string | null | undefined> | null | undefined,
  role?: UserRole | null,
  schoolName?: string | null,
): string {
  const parts = (Array.isArray(page) ? page : [page])
    .map((part) => (typeof part === "string" ? part.replace(/\s+/g, " ").trim() : ""))
    .filter(Boolean);
  if (role && ROLE_LABEL[role]) parts.push(roleLabel(role, schoolName));
  parts.push(PRODUCT_NAME);
  return parts.join(SEPARATOR);
}
