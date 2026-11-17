// A child's PDF on an answer (#237): the checks made before upload and the words used.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  PDF_MAX_BYTES,
  fileSummary,
  missingRequired,
  missingRequiredSentence,
  pdfFileProblem,
  ruleHeading,
  sizeText,
} from "../../.test-build/lib/attachments.mjs";

describe("pdfFileProblem", () => {
  test("a PDF up to 20 MB is fine, by type or by name", () => {
    assert.equal(pdfFileProblem({ name: "a.pdf", type: "application/pdf", size: 1000 }), null);
    assert.equal(pdfFileProblem({ name: "Scan.PDF", type: "", size: PDF_MAX_BYTES }), null);
  });
  test("anything else says why, in words", () => {
    assert.match(pdfFileProblem({ name: "a.jpg", type: "image/jpeg", size: 10 }), /scanner app/);
    assert.match(pdfFileProblem({ name: "a.pdf", type: "application/pdf", size: 0 }), /empty/);
    assert.match(pdfFileProblem({ name: "a.pdf", type: "application/pdf", size: PDF_MAX_BYTES + 1 }), /20 MB/);
  });
});

describe("the words", () => {
  test("sizes and summaries", () => {
    assert.equal(sizeText(100), "1 KB");
    assert.equal(sizeText(2048), "2 KB");
    assert.equal(sizeText(1.5 * 1024 * 1024), "1.5 MB");
    assert.equal(fileSummary({ pageCount: 1, sizeBytes: 3000 }), "1 page, 3 KB");
    assert.equal(fileSummary({ pageCount: 4, sizeBytes: 3 * 1024 * 1024 }), "4 pages, 3.0 MB");
  });
  test("the heading follows the rule", () => {
    assert.equal(ruleHeading("REQUIRED"), "Attach your work (PDF)");
    assert.equal(ruleHeading("OPTIONAL"), "Attach your working (PDF)");
  });
  test("a note, not a block, for required questions with no file", () => {
    const qs = [
      { uploadRule: "REQUIRED", attachment: null },
      { uploadRule: "REQUIRED", attachment: { id: "x" } },
      { uploadRule: "OPTIONAL" },
      { uploadRule: "NONE" },
    ];
    assert.equal(missingRequired(qs), 1);
    assert.equal(missingRequiredSentence(1), "1 question asks for a PDF and has none attached yet.");
    assert.equal(missingRequiredSentence(3), "3 questions ask for a PDF and have none attached yet.");
    assert.equal(missingRequiredSentence(0), null);
  });
});
