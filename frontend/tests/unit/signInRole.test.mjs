/**
 * lib/signInRole.ts -- which of the three ways in the sign-in page is
 * speaking to. The rule that matters: it only ever answers from what is
 * certain (an issued code's own prefix, or what was used here last), and it
 * remembers a role, never a person.
 *
 * Run with `npm test` (scripts/run-unit-tests.mjs).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_SIGN_IN_ROLE,
  SIGN_IN_ROLES,
  rememberSignInRole,
  rememberedSignInRole,
  signInRoleForAccount,
  signInRoleFromIdentifier,
} from "../../.test-build/lib/signInRole.mjs";

function fakeStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => void items.set(key, String(value)),
    _items: items,
  };
}

describe("signInRoleFromIdentifier", () => {
  test("an issued student code says student", () => {
    assert.equal(signInRoleFromIdentifier("STU-MATH-0002"), "STUDENT");
    assert.equal(signInRoleFromIdentifier("stu-math-0002"), "STUDENT");
    assert.equal(signInRoleFromIdentifier("  Stu-DPS-0417"), "STUDENT");
  });

  test("an issued teacher code says teacher", () => {
    assert.equal(signInRoleFromIdentifier("TCH-MATH-0001"), "TEACHER");
    assert.equal(signInRoleFromIdentifier("tch-"), "TEACHER");
  });

  test("the prefix has to be complete: nothing flips on a half-typed code", () => {
    for (const partial of ["", "S", "ST", "STU", "T", "TC", "TCH", "STUDENT", "TCHR-1", "STU1-2"]) {
      assert.equal(signInRoleFromIdentifier(partial), null, partial);
    }
  });

  test("an email address or a phone number gives nothing away -- every role can have one", () => {
    for (const value of ["priya@school.edu", "admin@zetta.example", "9876543210", "+91 98765 43210", "stu@school.edu", "tch.rao@school.edu"]) {
      assert.equal(signInRoleFromIdentifier(value), null, value);
    }
  });

  test("anything that is not text is nothing", () => {
    for (const value of [null, undefined, 42, {}, []]) assert.equal(signInRoleFromIdentifier(value), null);
  });
});

describe("signInRoleForAccount", () => {
  test("admin and super admin share one way in", () => {
    assert.equal(signInRoleForAccount("ADMIN"), "ADMIN");
    assert.equal(signInRoleForAccount("SUPER_ADMIN"), "ADMIN");
    assert.equal(signInRoleForAccount("TEACHER"), "TEACHER");
    assert.equal(signInRoleForAccount("STUDENT"), "STUDENT");
  });

  test("an unknown role is no role", () => {
    for (const value of ["", "PARENT", "student", null, undefined]) assert.equal(signInRoleForAccount(value), null);
  });
});

describe("remembering the way in", () => {
  test("round trip, by role", () => {
    const store = fakeStorage();
    assert.equal(rememberedSignInRole(store), null);
    rememberSignInRole("TEACHER", store);
    assert.equal(rememberedSignInRole(store), "TEACHER");
    rememberSignInRole("SUPER_ADMIN", store);
    assert.equal(rememberedSignInRole(store), "ADMIN");
  });

  test("only the role is ever written -- one key, one of three words", () => {
    const store = fakeStorage();
    rememberSignInRole("STUDENT", store);
    assert.deepEqual([...store._items.entries()], [["school_enrichment_last_sign_in_role", "STUDENT"]]);
  });

  test("an unknown role is not remembered, and does not erase what was", () => {
    const store = fakeStorage();
    rememberSignInRole("TEACHER", store);
    rememberSignInRole("PARENT", store);
    rememberSignInRole(null, store);
    assert.equal(rememberedSignInRole(store), "TEACHER");
  });

  test("a tampered or stale value reads as nothing", () => {
    assert.equal(rememberedSignInRole(fakeStorage({ school_enrichment_last_sign_in_role: "ROOT" })), null);
    assert.equal(rememberedSignInRole(fakeStorage({ school_enrichment_last_sign_in_role: "" })), null);
  });

  test("storage that is missing or throws is the same as nothing remembered", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    assert.doesNotThrow(() => rememberSignInRole("TEACHER", broken));
    assert.equal(rememberedSignInRole(broken), null);
    assert.doesNotThrow(() => rememberSignInRole("TEACHER", null));
    assert.equal(rememberedSignInRole(null), null);
  });
});

describe("the three ways in", () => {
  test("student first: the default, and the first tab", () => {
    assert.deepEqual(SIGN_IN_ROLES, ["STUDENT", "TEACHER", "ADMIN"]);
    assert.equal(DEFAULT_SIGN_IN_ROLE, "STUDENT");
  });
});
