/**
 * lib/signInRole.ts -- which of the three ways in is chosen on the sign-in
 * page. Each takes only its own kind of account (the server refuses right
 * details on the wrong one), so where the card stands matters: these tests
 * hold the rules that move it. It only ever answers from what is certain
 * (an issued code's own prefix, the page a session ended on, or what was
 * used here last), it undoes a move that turns out to be wrong, and it
 * remembers a role, never a person.
 *
 * Run with `npm test` (scripts/run-unit-tests.mjs).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_SIGN_IN_ROLE,
  SIGN_IN_ROLES,
  followIdentifier,
  identifierIsForAnotherWayIn,
  rememberSignInRole,
  rememberedSignInRole,
  signInRoleForAccount,
  signInRoleFromIdentifier,
  wayInForPath,
  wayInFromServer,
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

describe("identifierIsForAnotherWayIn", () => {
  test("a student code under Teacher or Admin is someone else's", () => {
    assert.equal(identifierIsForAnotherWayIn("STU-MATH-0003", "TEACHER"), true);
    assert.equal(identifierIsForAnotherWayIn("stu-math-0003", "ADMIN"), true);
  });

  test("a teacher code under Student or Admin is someone else's", () => {
    assert.equal(identifierIsForAnotherWayIn("TCH-MATH-0001", "STUDENT"), true);
    assert.equal(identifierIsForAnotherWayIn("TCH-MATH-0001", "ADMIN"), true);
  });

  test("a code under its own choice stays", () => {
    assert.equal(identifierIsForAnotherWayIn("STU-MATH-0003", "STUDENT"), false);
    assert.equal(identifierIsForAnotherWayIn("TCH-MATH-0001", "TEACHER"), false);
  });

  test("an address that happens to start like a code is still an address", () => {
    for (const email of ["stu-affairs@school.in", "STU-OFFICE@school.in", "tch-rao@school.edu", "  tch-1@x.in"]) {
      assert.equal(signInRoleFromIdentifier(email), null, email);
      for (const role of SIGN_IN_ROLES) {
        assert.equal(identifierIsForAnotherWayIn(email, role), false, `${email} under ${role}`);
      }
    }
  });

  test("an email could be anyone's, so it is never cleared", () => {
    for (const role of SIGN_IN_ROLES) {
      assert.equal(identifierIsForAnotherWayIn("someone@school.edu", role), false);
    }
  });

  test("nothing typed, or something half-typed, is left alone", () => {
    for (const role of SIGN_IN_ROLES) {
      assert.equal(identifierIsForAnotherWayIn("", role), false);
      assert.equal(identifierIsForAnotherWayIn(null, role), false);
      assert.equal(identifierIsForAnotherWayIn(undefined, role), false);
      assert.equal(identifierIsForAnotherWayIn("ST", role), false);
    }
  });
});

/** Types `text` one key at a time, as a person does, and returns every way in the card showed. */
function typed(start, text) {
  let state = { shown: start, returnTo: null, inferred: null };
  const shown = [];
  for (let i = 1; i <= text.length; i++) {
    state = followIdentifier(state, text.slice(0, i));
    shown.push(state.shown);
  }
  return { state, shown };
}

describe("followIdentifier: the card follows what is typed", () => {
  test("a student code typed under Teacher moves the card to Student, at the fourth key", () => {
    const { state, shown } = typed("TEACHER", "STU-GREE-0101");
    assert.deepEqual(shown.slice(0, 3), ["TEACHER", "TEACHER", "TEACHER"]);
    assert.ok(shown.slice(3).every((way) => way === "STUDENT"));
    assert.deepEqual(state, { shown: "STUDENT", returnTo: "TEACHER", inferred: "STUDENT" });
  });

  test("a teacher code typed under Student or Admin moves the card to Teacher", () => {
    assert.equal(typed("STUDENT", "tch-gree-0003").state.shown, "TEACHER");
    assert.equal(typed("ADMIN", "TCH-GREE-0003").state.shown, "TEACHER");
  });

  test("a code under its own way in moves nothing, and leaves nowhere to go back to", () => {
    const { state, shown } = typed("STUDENT", "STU-GREE-0101");
    assert.ok(shown.every((way) => way === "STUDENT"));
    assert.equal(state.returnTo, null);
  });

  test("an address that begins 'stu-' is back under Admin as soon as the @ is typed", () => {
    // The defect: typed key by key, 'stu-' reads as a student code for a
    // moment. The card moved to Student and stayed there.
    const address = "stu-affairs@school.in";
    const { state, shown } = typed("ADMIN", address);
    const at = address.indexOf("@");
    assert.equal(shown[3], "STUDENT", "it does move at 'stu-': nothing says it is an address yet");
    assert.ok(shown.slice(3, at).every((way) => way === "STUDENT"));
    assert.ok(shown.slice(at).every((way) => way === "ADMIN"), "and returns at the @, for good");
    assert.deepEqual(state, { shown: "ADMIN", returnTo: null, inferred: null });
  });

  test("the same for 'tch-', from any way in", () => {
    for (const start of SIGN_IN_ROLES) {
      assert.equal(typed(start, "tch-ravi@school.in").state.shown, start, start);
      assert.equal(typed(start, "stu-desk@school.in").state.shown, start, start);
    }
  });

  test("pasted in one go, an address moves nothing at all", () => {
    for (const start of SIGN_IN_ROLES) {
      const state = followIdentifier({ shown: start, returnTo: null, inferred: null }, "stu-affairs@school.in");
      assert.deepEqual(state, { shown: start, returnTo: null, inferred: null });
    }
  });

  test("an ordinary address, a phone number, or nothing moves nothing", () => {
    for (const text of ["anita@greenfield.test", "9876543210", "", "st", "teacher"]) {
      for (const start of SIGN_IN_ROLES) assert.equal(typed(start, text).state.shown, start, `${start}: ${text}`);
    }
  });

  test("the card follows a code once: a choice made by hand afterwards is not undone on the next key", () => {
    let { state } = typed("TEACHER", "STU-");
    assert.equal(state.shown, "STUDENT");
    // The person picks Teacher by hand. (The page also empties the box; this
    // is the rule holding even if it did not.)
    state = { shown: "TEACHER", returnTo: null, inferred: state.inferred };
    state = followIdentifier(state, "STU-G");
    assert.equal(state.shown, "TEACHER");
  });

  test("going back does not happen without an @: deleting a code leaves the card where it is", () => {
    let { state } = typed("ADMIN", "STU-GREE");
    for (const text of ["STU-GRE", "STU-", "STU", "S", ""]) state = followIdentifier(state, text);
    assert.equal(state.shown, "STUDENT");
  });

  test("a second code after the first is followed too, and the way back is still the first choice", () => {
    let { state } = typed("ADMIN", "STU-");
    state = followIdentifier(state, "");
    for (const text of ["T", "TC", "TCH", "TCH-"]) state = followIdentifier(state, text);
    assert.deepEqual(state, { shown: "TEACHER", returnTo: "ADMIN", inferred: "TEACHER" });
    state = followIdentifier(state, "tch-desk@school.in");
    assert.equal(state.shown, "ADMIN");
  });

  test("a code, cleared, then an ordinary address: the address does not move the card again", () => {
    // Found in review. A student at a computer a teacher used last types
    // their code (the card moves to Student), clears it, and types their
    // email instead. The "@" used to send the card back to Teacher, and
    // their correct details were then refused.
    let { state } = typed("TEACHER", "STU-GREE");
    assert.equal(state.shown, "STUDENT");
    state = followIdentifier(state, "");
    const address = "aarav@school.in";
    for (let i = 1; i <= address.length; i++) {
      state = followIdentifier(state, address.slice(0, i));
      assert.equal(state.shown, "STUDENT", address.slice(0, i));
    }
    assert.equal(state.returnTo, null);
  });

  test("an ordinary address pasted over a typed code does not move the card either", () => {
    let { state } = typed("TEACHER", "STU-GREE-0101");
    state = followIdentifier(state, "aarav@school.in");
    assert.deepEqual(state, { shown: "STUDENT", returnTo: null, inferred: null });
  });

  test("a prefix half deleted and typed again still finds its way back at the @", () => {
    let { state } = typed("ADMIN", "stu-");
    for (const text of ["stu", "st", "stu", "stu-", "stu-a", "stu-affairs", "stu-affairs@"]) state = followIdentifier(state, text);
    assert.deepEqual(state, { shown: "ADMIN", returnTo: null, inferred: null });
  });

  test("it returns the same object when nothing changed, so the page does not redraw", () => {
    const state = { shown: "TEACHER", returnTo: null, inferred: null };
    assert.equal(followIdentifier(state, "anita@"), state);
  });
});

describe("wayInFromServer", () => {
  test("the three ways in, exactly as the server names them", () => {
    for (const role of SIGN_IN_ROLES) assert.equal(wayInFromServer(role), role);
  });

  test("anything else is nothing: it came from outside this program", () => {
    for (const value of ["SUPER_ADMIN", "student", "", " TEACHER", null, undefined, 1, {}, ["ADMIN"]]) {
      assert.equal(wayInFromServer(value), null, JSON.stringify(value));
    }
  });
});

describe("wayInForPath: the page a session ended on says which way in", () => {
  test("each workspace's addresses", () => {
    assert.equal(wayInForPath("/student/practice"), "STUDENT");
    assert.equal(wayInForPath("/teacher/tracker?tab=review"), "TEACHER");
    assert.equal(wayInForPath("/admin/people"), "ADMIN");
  });

  test("anything else says nothing, and the last way in used here is the fallback", () => {
    for (const path of ["/login", "/", "", "/students/x", "/teacher", "teacher/dashboard", "//evil.example/teacher/", null, undefined, 7]) {
      assert.equal(wayInForPath(path), null, String(path));
    }
  });
});
