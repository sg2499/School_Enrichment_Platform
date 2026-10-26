// The school's logo (#202): which files can be chosen.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LOGO_MAX_BYTES, logoFileProblem } from "../../.test-build/lib/schoolLogo.mjs";

describe("logoFileProblem", () => {
  test("PNG, JPG and WEBP up to 3 MB", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"]) assert.equal(logoFileProblem({ type, size: 1000 }), null);
    assert.equal(logoFileProblem({ type: "image/png", size: LOGO_MAX_BYTES }), null);
  });
  test("anything else says why, in words", () => {
    assert.equal(logoFileProblem({ type: "image/svg+xml", size: 10 }), "Please choose a PNG, JPG or WEBP image.");
    assert.equal(logoFileProblem({ type: "application/pdf", size: 10 }), "Please choose a PNG, JPG or WEBP image.");
    assert.equal(logoFileProblem({ type: "image/png", size: 0 }), "That file is empty. Please choose the logo image again.");
    assert.equal(logoFileProblem({ type: "image/png", size: LOGO_MAX_BYTES + 1 }), "That image is too large. Please choose one under 3 MB.");
  });
});
