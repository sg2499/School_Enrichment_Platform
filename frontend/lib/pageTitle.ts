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
 * How each role is named wherever the interface says who is signed in: the
 * rail, the mobile bar, the footer and the tab. One source, so a role can
 * never be "Admin" in one place and "School Admin" in another.
 */
export const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "School Admin",
  SUPER_ADMIN: "Super Admin",
  TEACHER: "Teacher",
  STUDENT: "Student",
};

const SEPARATOR = " · ";

/**
 * `page` may itself be several parts, most specific first: pass
 * ["Aarav Shah", "Practice Tracker"] for a detail view. Empty parts are
 * dropped, so a title is never "undefined · Teacher" while data is loading.
 */
export function pageTitle(page: string | Array<string | null | undefined> | null | undefined, role?: UserRole | null): string {
  const parts = (Array.isArray(page) ? page : [page])
    .map((part) => (typeof part === "string" ? part.replace(/\s+/g, " ").trim() : ""))
    .filter(Boolean);
  if (role && ROLE_LABEL[role]) parts.push(ROLE_LABEL[role]);
  parts.push(PRODUCT_NAME);
  return parts.join(SEPARATOR);
}
