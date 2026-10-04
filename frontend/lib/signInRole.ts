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
 * Until 4 Oct 2026 this was a hint for wording and nothing else: whoever
 * the credentials belonged to was signed in, so an admin's details under
 * "Teacher" went into the admin workspace. Each way in now takes only its
 * own kind of account. The choice is sent with the sign-in, and the server
 * refuses right details on the wrong one, naming the right one
 * (backend/app/services/auth_service.py, login). It says so only after the
 * password has been checked: nothing is ever looked up from the identifier
 * alone -- "which role is this identifier" would tell anyone which
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

/**
 * What the card shows, as the first box changes.
 *
 * `shown` is the way in on screen. `returnTo` is the one the person was on
 * before the page moved them, or null when it has not moved them. `inferred`
 * is what the box's contents last gave away.
 */
export interface WayInState {
  shown: SignInRole;
  returnTo: SignInRole | null;
  inferred: SignInRole | null;
}

/**
 * Follows what is typed in the first box.
 *
 * The moment the text becomes recognisable as an issued code, the card
 * moves to that code's way in -- once, so choosing another by hand
 * afterwards is not undone on the next keystroke.
 *
 * And it moves back. "stu-affairs@school.in" is an address, but for four
 * keystrokes it reads as a student code, so someone typing it under "Admin"
 * was moved to "Student" and left there (found 4 Oct 2026; a test that
 * pasted the whole address at once had hidden it). That used to cost only
 * the wrong wording. Now that each way in takes only its own accounts it
 * would refuse them, so the moment an "@" shows that same text to be an
 * address, the card returns to where the person was.
 *
 * Only that text, though. The way back is forgotten as soon as what is in
 * the box no longer begins like a code: someone who typed a student code,
 * cleared it and typed an ordinary address was moved by the code and is
 * not moved again by the address.
 */
export function followIdentifier(state: WayInState, value: string): WayInState {
  const inferred = signInRoleFromIdentifier(value);
  if (inferred && inferred !== state.inferred) {
    if (inferred === state.shown) return { ...state, inferred };
    return { shown: inferred, returnTo: state.returnTo ?? state.shown, inferred };
  }
  if (!inferred && state.returnTo) {
    if (BEGINS_LIKE_A_CODE.test(value)) {
      // Begins "stu-" or "tch-" and is not a code: only an "@" does that.
      return { shown: state.returnTo, returnTo: null, inferred };
    }
    if (!COULD_BECOME_A_CODE.test(value)) return { ...state, returnTo: null, inferred };
  }
  return state.inferred === inferred ? state : { ...state, inferred };
}

/** "stu-" or "tch-" at the start, whatever follows. */
const BEGINS_LIKE_A_CODE = /^\s*(stu|tch)-/i;
/** Nothing yet, or the first letters of one of those prefixes: a code half
 *  deleted, about to be typed again. */
const COULD_BECOME_A_CODE = /^\s*(s|st|stu|t|tc|tch)?$/i;

/**
 * The way in an address inside the product belongs to ("/teacher/tracker"
 * is Teacher's), or null for anything else. Used when a session ends: the
 * page the person was on says which way in they need, which the last one
 * used on this browser may not (a student signed in at the next tab).
 */
export function wayInForPath(path: string | null | undefined): SignInRole | null {
  if (typeof path !== "string") return null;
  if (path.startsWith("/student/")) return "STUDENT";
  if (path.startsWith("/teacher/")) return "TEACHER";
  if (path.startsWith("/admin/")) return "ADMIN";
  return null;
}

/**
 * The way in the server names when it refuses right details on the wrong
 * one, or null for anything that is not one of the three. The value arrives
 * from outside this program, so it is checked rather than trusted.
 */
export function wayInFromServer(value: unknown): SignInRole | null {
  return value === "STUDENT" || value === "TEACHER" || value === "ADMIN" ? value : null;
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
