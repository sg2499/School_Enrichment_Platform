/**
 * lib/signInCopy.ts -- what the sign-in page says to each of the three
 * kinds of people who use it. The rules that matter: all three get every
 * line, the instruction under the greeting fits on one line for all of
 * them, and nothing names a school or a person who does not exist.
 *
 * Run with `npm test` (scripts/run-unit-tests.mjs).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { INTRO_MAX_LENGTH, SIGN_IN_COPY } from "../../.test-build/lib/signInCopy.mjs";
import { SIGN_IN_ROLES } from "../../.test-build/lib/signInRole.mjs";

const FIELDS = ["tab", "audience", "promise", "intro", "label", "placeholder", "missingIdentifier", "safe", "forgotten", "issuedBy", "newHere"];

describe("SIGN_IN_COPY", () => {
  test("every way in has every line, and none is empty", () => {
    assert.deepEqual(Object.keys(SIGN_IN_COPY).sort(), [...SIGN_IN_ROLES].sort());
    for (const role of SIGN_IN_ROLES) {
      assert.deepEqual(Object.keys(SIGN_IN_COPY[role]).sort(), [...FIELDS].sort(), role);
      for (const field of FIELDS) {
        const line = SIGN_IN_COPY[role][field];
        assert.equal(typeof line, "string", `${role}.${field}`);
        assert.ok(line.trim().length > 0, `${role}.${field} is empty`);
        assert.equal(line, line.trim(), `${role}.${field} has stray space round it`);
      }
    }
  });

  test("the instruction under the greeting fits on one line for everyone", () => {
    for (const role of SIGN_IN_ROLES) {
      const { intro } = SIGN_IN_COPY[role];
      assert.ok(
        intro.length <= INTRO_MAX_LENGTH,
        `${role}: "${intro}" is ${intro.length} characters; the limit is ${INTRO_MAX_LENGTH}, or it wraps and the form jumps`,
      );
    }
  });

  test("the three instructions are worded the same way", () => {
    for (const role of SIGN_IN_ROLES) {
      assert.match(SIGN_IN_COPY[role].intro, /^Use your .+ password\.$/, role);
    }
  });

  test("each line speaks to the person it is for", () => {
    assert.match(SIGN_IN_COPY.STUDENT.audience, /students/i);
    assert.match(SIGN_IN_COPY.TEACHER.audience, /teachers/i);
    assert.match(SIGN_IN_COPY.ADMIN.audience, /admins/i);
    assert.match(SIGN_IN_COPY.STUDENT.label, /^Student/);
    assert.match(SIGN_IN_COPY.TEACHER.label, /^Teacher/);
    assert.match(SIGN_IN_COPY.ADMIN.label, /^Admin/);
  });

  test("who issues the account is said truthfully for each", () => {
    // A school issues its teachers' and students' accounts; it does not
    // issue its own admin's.
    assert.match(SIGN_IN_COPY.STUDENT.issuedBy, /^Your school issues/);
    assert.match(SIGN_IN_COPY.TEACHER.issuedBy, /^Your school issues/);
    assert.doesNotMatch(SIGN_IN_COPY.ADMIN.issuedBy, /Your school issues/);
    assert.match(SIGN_IN_COPY.ADMIN.issuedBy, /platform administrator/);
  });

  test("what the product is said to do is only what it does today", () => {
    // Written answers wait for a teacher, so not everything is marked on
    // submit: the student dashboard says "most", and so does this.
    assert.match(SIGN_IN_COPY.STUDENT.promise, /most of it marked/);
    // A school admin creates teachers' and students' accounts. Admin
    // accounts are the platform administrator's to create.
    assert.match(SIGN_IN_COPY.ADMIN.promise, /teachers’ and students’ accounts/);
    assert.doesNotMatch(SIGN_IN_COPY.ADMIN.promise, /every account/i);
    // No analytics of gaps is live yet.
    assert.doesNotMatch(SIGN_IN_COPY.TEACHER.promise, /gaps?/i);
    // Two-factor is required of admins, and asked for only once set up.
    assert.match(SIGN_IN_COPY.ADMIN.safe, /require two-factor/);
    assert.doesNotMatch(SIGN_IN_COPY.ADMIN.safe, /always/i);
  });

  test("the notes under the form stay short enough for two lines", () => {
    // The card is one height on every choice, set by the longest of the
    // three; a note that runs to a third line makes all three cards taller.
    for (const role of SIGN_IN_ROLES) {
      for (const field of ["safe", "forgotten"]) {
        const line = SIGN_IN_COPY[role][field];
        assert.ok(line.length <= 100, `${role}.${field} is ${line.length} characters; keep it to 100`);
      }
    }
  });

  test("no line names a particular school, or the coordinator who never existed", () => {
    for (const role of SIGN_IN_ROLES) {
      for (const field of FIELDS) {
        const line = SIGN_IN_COPY[role][field];
        assert.doesNotMatch(line, /coordinator/i, `${role}.${field}`);
        assert.doesNotMatch(line, /issued by/i, `${role}.${field}`);
        assert.doesNotMatch(line, /mathpath|greenfield|riverside/i, `${role}.${field}`);
      }
    }
  });

  test("sentences end as sentences", () => {
    for (const role of SIGN_IN_ROLES) {
      for (const field of ["promise", "intro", "missingIdentifier", "safe", "forgotten", "issuedBy", "newHere"]) {
        assert.match(SIGN_IN_COPY[role][field], /[.?]$/, `${role}.${field}`);
      }
    }
  });
});
