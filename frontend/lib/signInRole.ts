/**
 * Who is signing in, as far as the sign-in page can tell (3 Oct 2026, UI
 * revamp Phase B, slice 3).
 *
 * The sign-in page serves three kinds of people and, before this, spoke to
 * none of them: one label ("Email, Phone, or Code"), one help line that
 * named a "school coordinator" who does not exist in the product. The page
 * now asks which they are and speaks to that person.
 *
 * Two things can answer the question without a network request:
 *
 *   - What they type. The school issues codes with a fixed shape --
 *     STU-<school>-<number> for students, TCH-<school>-<number> for
 *     teachers (backend/app/api/routes_roster.py, _next_code) -- so the
 *     first four characters say which. An email address says nothing: every
 *     role can have one.
 *   - What was used here last. Only the role is remembered, never the
 *     identifier: a shared lab computer that remembers "a student signed in
 *     here" has learned nothing about anyone.
 *
 * It is a hint for wording and nothing else. The server decides who someone
 * is from their credentials; a teacher who signs in under "Student" lands in
 * the teacher workspace. Nothing is ever sent to the server to work this out
 * -- a lookup of "which role is this identifier" would tell anyone which
 * identifiers exist.
 *
 * No runtime imports, so it is unit-tested directly (scripts/run-unit-tests.mjs).
 */

/** The three ways in. Admin covers school admins and the platform's own
 *  super admins: they sign in the same way (email, then a two-factor code). */
export type SignInRole = "STUDENT" | "TEACHER" | "ADMIN";

export const SIGN_IN_ROLES: SignInRole[] = ["STUDENT", "TEACHER", "ADMIN"];

/** Shown when nothing has been typed and nothing is remembered: students are
 *  by far the most numerous people who ever see this page. */
export const DEFAULT_SIGN_IN_ROLE: SignInRole = "STUDENT";

/**
 * The role an identifier's own shape gives away, or null when it gives away
 * nothing. Deliberately strict: only the two issued code prefixes count. An
 * email address, a phone number or anything half-typed returns null, so the
 * page never flips under someone's fingers on a guess.
 */
export function signInRoleFromIdentifier(identifier: string | null | undefined): SignInRole | null {
  if (typeof identifier !== "string") return null;
  // An address that happens to begin "stu-" or "tch-" (stu-affairs@...) is
  // still an address, and an address is anyone's.
  if (identifier.includes("@")) return null;
  const start = identifier.trimStart().slice(0, 4).toUpperCase();
  if (start === "STU-") return "STUDENT";
  if (start === "TCH-") return "TEACHER";
  return null;
}

/**
 * Whether what is in the first box is a code issued to a different kind of
 * person than the way in that has just been chosen by hand -- a student
 * code sitting under "Teacher", say.
 *
 * That happens two ways: a browser fills in the last code it saved before
 * anyone has chosen anything, or someone starts typing under the wrong
 * choice. Either way the box now holds something that can never be right
 * for the label above it, so the sign-in page empties it (and the password
 * that came with it) when this is true. An email address is left alone: it
 * could belong to any of the three.
 */
export function identifierIsForAnotherWayIn(identifier: string | null | undefined, chosen: SignInRole): boolean {
  const own = signInRoleFromIdentifier(identifier);
  return own !== null && own !== chosen;
}

/** A signed-in account's real role, as one of the three ways in. */
export function signInRoleForAccount(role: string | null | undefined): SignInRole | null {
  if (role === "STUDENT" || role === "TEACHER") return role;
  if (role === "ADMIN" || role === "SUPER_ADMIN") return "ADMIN";
  return null;
}

const STORAGE_KEY = "school_enrichment_last_sign_in_role";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Storage can be switched off entirely (some locked-down school
    // browsers). Then nothing is remembered, which is the safe failure.
    return null;
  }
}

/** Remembers which way in was used on this browser. The role only. */
export function rememberSignInRole(role: string | null | undefined, store: StorageLike | null = storage()): void {
  const signInRole = signInRoleForAccount(role);
  if (!signInRole || !store) return;
  try {
    store.setItem(STORAGE_KEY, signInRole);
  } catch {
    // Full or blocked storage: not remembering is fine.
  }
}

/** The way in last used on this browser, or null. Anything that is not one
 *  of the three (an old or tampered value) counts as nothing. */
export function rememberedSignInRole(store: StorageLike | null = storage()): SignInRole | null {
  if (!store) return null;
  try {
    return signInRoleForAccount(store.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}
