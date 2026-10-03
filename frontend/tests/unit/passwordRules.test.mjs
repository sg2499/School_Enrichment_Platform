/**
 * lib/passwordRules.ts -- the checklist a person sees while choosing their
 * own password. The server decides (backend/app/core/security.py); this is
 * the same rules run early. The tests that matter most are the last ones:
 * they read the server's file and fail if the two lists have drifted.
 *
 * Run with `npm test` (scripts/run-unit-tests.mjs).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  COMMON_FULL_PATTERNS,
  COMMON_PASSWORD_ROOTS,
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  passwordChecks,
  passwordIsAcceptable,
  passwordProblem,
} from "../../.test-build/lib/passwordRules.mjs";

const met = (password, options) => Object.fromEntries(passwordChecks(password, options).map((check) => [check.id, check.met]));

describe("passwordChecks", () => {
  test("a good password meets every rule", () => {
    assert.deepEqual(met("Mango-Tree-42"), { length: true, letter: true, number: true, guessable: true });
    assert.equal(passwordIsAcceptable("Mango-Tree-42"), true);
  });

  test("an empty box has met nothing -- including 'not easy to guess'", () => {
    assert.deepEqual(met(""), { length: false, letter: false, number: false, guessable: false });
    assert.equal(passwordIsAcceptable(""), false);
  });

  test("each rule on its own", () => {
    assert.equal(met("Ab1").length, false);
    assert.equal(met("Abcdefg1").length, true);
    assert.equal(met("12345679").letter, false);
    assert.equal(met("mangotree").number, false);
  });

  test("length counts characters, not bytes", () => {
    // Seven characters, one of them outside the basic plane.
    assert.equal(met("ab1cd2\u{1F600}").length, false);
    assert.equal(met("ab1cd2e\u{1F600}").length, true);
  });

  test("a space at either end is refused, not ignored: sign-in compares what is typed", () => {
    assert.equal("spaces" in met("Mango-Tree-42"), false);
    for (const padded of [" Mango-Tree-42", "Mango-Tree-42 ", "  Mango-Tree-42  ", "Mango-Tree-42\t"]) {
      assert.equal(met(padded).spaces, false, JSON.stringify(padded));
      assert.equal(passwordIsAcceptable(padded), false, JSON.stringify(padded));
    }
    assert.equal(passwordProblem(" Mango-Tree-42"), "That password won't work yet: it can't start or end with a space.");
    // Spaces inside are part of the password.
    assert.equal(passwordIsAcceptable("Mango Tree 42"), true);
  });

  test("longer than the hash reads is refused, counted in bytes", () => {
    assert.equal(passwordIsAcceptable(`Aa1${"x".repeat(69)}`), true); // exactly 72
    assert.equal(passwordIsAcceptable(`Aa1${"x".repeat(70)}`), false);
    assert.equal(passwordProblem(`Aa1${"x".repeat(70)}`), "That password won't work yet: it is too long (keep it to 72 characters or fewer).");
    // 27 characters, 77 bytes: too long, but not told to "keep it to 72".
    assert.equal(passwordIsAcceptable(`a1${"\u0915".repeat(25)}`), false);
    assert.equal(
      passwordProblem(`a1${"\u0915".repeat(25)}`),
      "That password won't work yet: it is too long for the letters it uses (shorten it a little).",
    );
  });

  test("the passwords people reach for first are refused in every disguise", () => {
    for (const weak of ["Password123", "P@ssw0rd!", "welcome1", "Welcome2026", "Student123", "School2026!", "Qwerty12", "1qaz2wsx", "Teacher1"]) {
      assert.equal(met(weak).guessable, false, weak);
      assert.equal(passwordIsAcceptable(weak), false, weak);
    }
  });

  test("a repeated character or a straight run is refused", () => {
    for (const pattern of ["aaaaaaaa", "11111111", "12345678", "abcdefgh", "87654321", "hgfedcba"]) {
      assert.equal(met(pattern).guessable, false, pattern);
    }
  });

  test("an ordinary password that merely contains a common word is fine", () => {
    for (const fine of ["MySchoolBus42", "welcome-to-class7", "teacher4maths!x"]) {
      assert.equal(met(fine).guessable, true, fine);
    }
  });

  test("with the issued password known, the new one must differ from it", () => {
    const issued = "kX7mP2qR9tWz";
    assert.equal("different" in met("Mango-Tree-42"), false);
    assert.equal(met("Mango-Tree-42", { current: issued }).different, true);
    assert.equal(met(issued, { current: issued }).different, false);
    assert.equal(met("", { current: issued }).different, false);
    assert.equal(passwordIsAcceptable(issued, { current: issued }), false);
  });

  test("the rules are shown in a fixed order, as instructions", () => {
    assert.deepEqual(
      passwordChecks("", { current: "x" }).map((check) => check.label),
      [
        `At least ${MIN_PASSWORD_LENGTH} characters`,
        "At least one letter",
        "At least one number",
        "Not easy to guess",
        "Different from the password you were given",
      ],
    );
  });
});

describe("passwordProblem", () => {
  test("nothing to say about a good password", () => {
    assert.equal(passwordProblem("Mango-Tree-42"), null);
    assert.equal(passwordProblem("Mango-Tree-42", { current: "kX7mP2qR9tWz" }), null);
  });

  test("one reason reads as one sentence", () => {
    assert.equal(passwordProblem("mangotreehouse"), "That password won't work yet: it needs at least one number.");
    assert.equal(passwordProblem("Password123"), "That password won't work yet: it can't be a common word or a simple pattern.");
  });

  test("several reasons are joined the way a person would say them", () => {
    assert.equal(
      passwordProblem("abc"),
      "That password won't work yet: it needs at least 8 characters, and it needs at least one number.",
    );
    assert.equal(
      passwordProblem("", { current: "issued" }),
      "That password won't work yet: it needs at least 8 characters, it needs at least one letter, it needs at least one number, and it has to be different from the password you were given.",
    );
  });

  test("a password that is too short is not also told it is guessable", () => {
    assert.doesNotMatch(passwordProblem("aaa1"), /common word/);
  });

  test("the issued password offered as its own replacement", () => {
    assert.equal(
      passwordProblem("kX7mP2qR9tWz", { current: "kX7mP2qR9tWz" }),
      "That password won't work yet: it has to be different from the password you were given.",
    );
  });
});

describe("in step with the server", () => {
  // npm test runs from frontend/; the server's rules are one folder over.
  const server = readFileSync("../backend/app/core/security.py", "utf8");

  function quoted(block) {
    return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  }

  test("the same common words", () => {
    const block = server.slice(server.indexOf("_COMMON_PASSWORD_ROOTS = frozenset("), server.indexOf("# A handful of specific full patterns"));
    assert.deepEqual([...COMMON_PASSWORD_ROOTS].sort(), quoted(block).sort());
  });

  test("the same keyboard walks", () => {
    const line = server.split("\n").find((text) => text.startsWith("_COMMON_FULL_PATTERNS = "));
    assert.deepEqual([...COMMON_FULL_PATTERNS].sort(), quoted(line).sort());
  });

  test("the same two length limits", () => {
    assert.match(server, new RegExp(`if len\\(password\\) < ${MIN_PASSWORD_LENGTH}:`));
    assert.match(server, new RegExp(`^MAX_PASSWORD_BYTES = ${MAX_PASSWORD_BYTES}$`, "m"));
    assert.match(server, /encoded = password\.encode\("utf-8"\)/);
    assert.match(server, /if len\(encoded\) > MAX_PASSWORD_BYTES:\n\s+if len\(password\) > MAX_PASSWORD_BYTES:/);
  });

  test("the same refusal of a space at either end", () => {
    assert.match(server, /if password != password\.strip\(\):\n\s+return "Password can't start or end with a space\."/);
  });

  test("the same letter-swaps", () => {
    const line = server.split("\n").find((text) => text.startsWith("_LEET_SUBSTITUTIONS = "));
    assert.equal(line, '_LEET_SUBSTITUTIONS = {"@": "a", "$": "s", "0": "o", "1": "i", "3": "e", "!": "i"}');
    // And they are applied here: each of these is "password" underneath.
    for (const disguised of ["p@ssword9", "pa$$word1", "passw0rd7", "p@$$w0rd22"]) {
      assert.equal(passwordIsAcceptable(disguised), false, disguised);
    }
  });
});
