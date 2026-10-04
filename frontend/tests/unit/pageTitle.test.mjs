/**
 * lib/pageTitle.ts -- what the browser tab says.
 *
 * Run with `npm test` (scripts/run-unit-tests.mjs).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { PRODUCT_NAME, ROLE_LABEL, SCHOOL_NAME_IN_ROLE_MAX, pageTitle, roleLabel } from "../../.test-build/lib/pageTitle.mjs";

describe("pageTitle", () => {
  test("page, then role, then product", () => {
    assert.equal(pageTitle("Practice Tracker", "TEACHER"), "Practice Tracker · Teacher · Krama");
    assert.equal(pageTitle("Daily Practice", "STUDENT"), "Daily Practice · Student · Krama");
  });

  test("Admin and Super Admin share routes but never a title", () => {
    assert.notEqual(pageTitle("People", "ADMIN"), pageTitle("People", "SUPER_ADMIN"));
    assert.equal(pageTitle("People", "SUPER_ADMIN"), "People · Super Admin · Krama");
  });

  test("a detail view leads with the most specific part", () => {
    assert.equal(
      pageTitle(["Aarav Shah", "Practice Tracker"], "TEACHER"),
      "Aarav Shah · Practice Tracker · Teacher · Krama",
    );
  });

  test("parts that have not loaded yet are dropped, never printed", () => {
    assert.equal(pageTitle([undefined, "Practice Tracker"], "TEACHER"), "Practice Tracker · Teacher · Krama");
    assert.equal(pageTitle([null, "", "   "], "TEACHER"), "Teacher · Krama");
    assert.equal(pageTitle(null, "STUDENT"), "Student · Krama");
    assert.equal(pageTitle(undefined), "Krama");
  });

  test("no role when nobody is signed in", () => {
    assert.equal(pageTitle("Sign In"), "Sign In · Krama");
    assert.equal(pageTitle("Sign In", null), "Sign In · Krama");
  });

  test("stray whitespace and line breaks in a name are collapsed", () => {
    assert.equal(pageTitle("  Chapter 4:\n  Fractions  ", "ADMIN"), "Chapter 4: Fractions · School Admin · Krama");
  });

  test("every role has a label and the product name is stable", () => {
    assert.deepEqual(Object.keys(ROLE_LABEL).sort(), ["ADMIN", "STUDENT", "SUPER_ADMIN", "TEACHER"]);
    assert.equal(PRODUCT_NAME, "Krama");
  });
});

describe("roleLabel", () => {
  test("a school admin is named after their school", () => {
    assert.equal(roleLabel("ADMIN", "MathPath"), "MathPath Admin");
    assert.equal(roleLabel("ADMIN", "Greenfield School"), "Greenfield School Admin");
  });

  test("with no school to hand it is the plain label", () => {
    assert.equal(roleLabel("ADMIN"), "School Admin");
    assert.equal(roleLabel("ADMIN", null), "School Admin");
    assert.equal(roleLabel("ADMIN", ""), "School Admin");
    assert.equal(roleLabel("ADMIN", "   "), "School Admin");
  });

  test("a name too long to show on one line falls back, exactly at the limit", () => {
    const fits = "A".repeat(SCHOOL_NAME_IN_ROLE_MAX);
    assert.equal(roleLabel("ADMIN", fits), `${fits} Admin`);
    assert.equal(roleLabel("ADMIN", `${fits}A`), "School Admin");
    assert.equal(roleLabel("ADMIN", "Delhi Public School, R. K. Puram"), "School Admin");
  });

  test("a name that already ends in Admin is not given a second one", () => {
    assert.equal(roleLabel("ADMIN", "St. Mary Admin"), "School Admin");
    assert.equal(roleLabel("ADMIN", "Head Office admin"), "School Admin");
    // Only as a word of its own at the end.
    assert.equal(roleLabel("ADMIN", "Badmin Academy"), "Badmin Academy Admin");
    assert.equal(roleLabel("ADMIN", "Admin Block School"), "Admin Block School Admin");
  });

  test("stray whitespace in a school's name is collapsed before it is measured", () => {
    assert.equal(roleLabel("ADMIN", "  Riverside \n  Academy "), "Riverside Academy Admin");
  });

  test("only the school's admin: nobody else's role carries a school", () => {
    assert.equal(roleLabel("SUPER_ADMIN", "MathPath"), "Super Admin");
    assert.equal(roleLabel("TEACHER", "MathPath"), "Teacher");
    assert.equal(roleLabel("STUDENT", "MathPath"), "Student");
  });

  test("the tab says the same thing the rail does", () => {
    assert.equal(pageTitle("People", "ADMIN", "MathPath"), "People · MathPath Admin · Krama");
    assert.equal(pageTitle("People", "ADMIN"), "People · School Admin · Krama");
    assert.equal(pageTitle("People", "SUPER_ADMIN", "MathPath"), "People · Super Admin · Krama");
    assert.equal(pageTitle("Practice Tracker", "TEACHER", "MathPath"), "Practice Tracker · Teacher · Krama");
  });
});
