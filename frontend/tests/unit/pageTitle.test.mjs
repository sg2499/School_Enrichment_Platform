/**
 * lib/pageTitle.ts -- what the browser tab says.
 *
 * Run with `npm test` (scripts/run-unit-tests.mjs).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { PRODUCT_NAME, ROLE_LABEL, pageTitle } from "../../.test-build/lib/pageTitle.mjs";

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
