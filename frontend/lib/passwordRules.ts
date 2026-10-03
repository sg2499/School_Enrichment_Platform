/**
 * The rules a password someone chooses for themselves has to meet, checked
 * as they type (3 Oct 2026, UI revamp Phase B, slice 3).
 *
 * The server is the authority: backend/app/core/security.py,
 * strong_password_issue(), decides, and the choose-a-password screens show
 * its sentence if it says no. This is the same set of rules run in the
 * browser so that a Class 5 student sees each one turn green as they type,
 * instead of pressing the button to find out. KEEP THE TWO IN STEP: a rule
 * added there and not here means a checklist that is all green and a server
 * that still says no.
 *
 * No runtime imports, so it is unit-tested directly (scripts/run-unit-tests.mjs).
 * Those tests read the server's file and pin the parts that are data -- the
 * word list, the keyboard walks, the letter-swaps, the two length limits and
 * the sentence for each -- so a change there fails here. The logic around
 * them (what counts as a straight run, what is stripped before the word
 * check) is mirrored by hand and covered by examples.
 *
 * One server rule has no counterpart here: it refuses control characters (a
 * tab or a line break inside the password, a NUL byte). A password box
 * cannot be typed into with any of them, so there is nothing to show a rule
 * for; if one arrives by paste, the server's sentence is what is shown.
 */

export const MIN_PASSWORD_LENGTH = 8;

/** bcrypt reads only the first 72 bytes of a password; the server refuses
 *  anything longer rather than let two passwords with the same first 72
 *  open the same account. Bytes, not characters: "क" is three. */
export const MAX_PASSWORD_BYTES = 72;

// The plain words behind the passwords people reach for first. The server
// reduces what was typed to its root (lowercase, trailing digits and "!"
// dropped, "@" read as "a" and so on) and refuses any of these.
export const COMMON_PASSWORD_ROOTS: readonly string[] = [
  "password", "qwerty", "qwertyuiop", "letmein", "welcome", "admin", "administrator",
  "iloveyou", "trustno", "sunshine", "princess", "football", "baseball", "dragon",
  "monkey", "shadow", "master", "superman", "batman", "changeme", "root", "student",
  "teacher", "school", "mypassword", "qazwsx", "zxcvbnm", "abcdef", "abcdefg",
  "abcdefgh", "passw0rd", "p@ssword",
];

// Keyboard walks with digits in the middle, which the root check above
// cannot see. Refused as exact matches.
export const COMMON_FULL_PATTERNS: readonly string[] = ["1qaz2wsx", "1qaz2wsx3edc", "1q2w3e4r", "q1w2e3r4"];

const LEET: Record<string, string> = { "@": "a", $: "s", "0": "o", "1": "i", "3": "e", "!": "i" };

/** What the server calls _base_word(). */
function baseWord(password: string): string {
  const stripped = password.toLowerCase().replace(/[0-9!]+$/, "");
  return Array.from(stripped, (ch) => LEET[ch] ?? ch).join("");
}

/** What the server calls _is_trivially_patterned(): one character repeated,
 *  or a straight run up or down ("12345678", "hgfedcba"). */
function isPattern(password: string): boolean {
  const chars = Array.from(password);
  if (new Set(chars).size === 1) return true;
  const codes = Array.from(password.toLowerCase(), (ch) => ch.codePointAt(0) ?? 0);
  const ascending = codes.every((code, i) => i === 0 || code - codes[i - 1] === 1);
  const descending = codes.every((code, i) => i === 0 || codes[i - 1] - code === 1);
  return ascending || descending;
}

function isEasyToGuess(password: string): boolean {
  return (
    COMMON_FULL_PATTERNS.includes(password.toLowerCase()) ||
    COMMON_PASSWORD_ROOTS.includes(baseWord(password)) ||
    isPattern(password)
  );
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export type PasswordCheckId = "length" | "letter" | "number" | "different" | "guessable" | "spaces";

export interface PasswordCheck {
  id: PasswordCheckId;
  /** The rule, as an instruction: "At least 8 characters". */
  label: string;
  /** The same rule as the reason a password was turned away, written to
   *  follow "That password won't work yet: " -- "it needs at least 8
   *  characters". */
  problem: string;
  met: boolean;
}

export interface PasswordCheckOptions {
  /** The password being replaced, when the screen knows it (the sign-in
   *  page's own step does: it was typed a moment ago). Adds the rule that
   *  the new one must differ. */
  current?: string | null;
  /** How the password being replaced is named in that rule. "given" (the
   *  default) is the one a school issued: "the password you were given".
   *  "current" is one the person chose themselves and is now changing. */
  replacing?: "given" | "current";
}

/**
 * Every rule, each marked met or not, in the order they are shown.
 *
 * The password is judged exactly as typed. A space at either end is not
 * ignored: sign-in compares what is typed, so a password saved without its
 * edge spaces would then be refused at sign-in for the person who typed
 * them. It gets a rule of its own, shown only when it is broken -- nobody
 * needs "no space at the start or end" on screen until they have typed one.
 *
 * "Not easy to guess" only counts as met once there is something long
 * enough to judge: an empty box has not passed it.
 */
export function passwordChecks(password: string, options: PasswordCheckOptions = {}): PasswordCheck[] {
  const value = password;
  const characters = Array.from(value).length;
  const tooLong = byteLength(value) > MAX_PASSWORD_BYTES;
  const checks: PasswordCheck[] = [
    {
      id: "length",
      label: `At least ${MIN_PASSWORD_LENGTH} characters`,
      // "72 characters" only when that is what the limit comes to; with
      // letters that take more than one byte it is reached sooner.
      problem: !tooLong
        ? `it needs at least ${MIN_PASSWORD_LENGTH} characters`
        : characters > MAX_PASSWORD_BYTES
          ? "it is too long (keep it to 72 characters or fewer)"
          : "it is too long for the letters it uses (shorten it a little)",
      met: characters >= MIN_PASSWORD_LENGTH && !tooLong,
    },
    { id: "letter", label: "At least one letter", problem: "it needs at least one letter", met: /[A-Za-z]/.test(value) },
    { id: "number", label: "At least one number", problem: "it needs at least one number", met: /[0-9]/.test(value) },
    {
      id: "guessable",
      // Short on purpose: it shares a row with another rule on the
      // sign-in card. The `problem` sentence says what it means.
      label: "Not easy to guess",
      problem: "it can't be a common word or a simple pattern",
      met: characters >= MIN_PASSWORD_LENGTH && !isEasyToGuess(value),
    },
  ];
  if (value !== value.trim()) {
    checks.push({ id: "spaces", label: "No space at the start or end", problem: "it can't start or end with a space", met: false });
  }
  const current = typeof options.current === "string" ? options.current.trim() : "";
  if (current) {
    const replaced = options.replacing === "current" ? "your current password" : "the password you were given";
    checks.push({
      id: "different",
      label: `Different from ${replaced}`,
      problem: `it has to be different from ${replaced}`,
      met: value.length > 0 && value !== current,
    });
  }
  return checks;
}

/**
 * Why a password was turned away, as one sentence, or null when every rule
 * is met. A password that is simply too short is told only that: "it can't
 * be a common word" about three typed characters is noise.
 */
export function passwordProblem(password: string, options: PasswordCheckOptions = {}): string | null {
  let unmet = passwordChecks(password, options).filter((check) => !check.met);
  if (unmet.length === 0) return null;
  if (unmet.some((check) => check.id === "length")) unmet = unmet.filter((check) => check.id !== "guessable");
  const reasons = unmet.map((check) => check.problem);
  const joined = reasons.length === 1 ? reasons[0] : `${reasons.slice(0, -1).join(", ")}, and ${reasons[reasons.length - 1]}`;
  return `That password won't work yet: ${joined}.`;
}

/** True when every rule is met. */
export function passwordIsAcceptable(password: string, options: PasswordCheckOptions = {}): boolean {
  return passwordChecks(password, options).every((check) => check.met);
}
