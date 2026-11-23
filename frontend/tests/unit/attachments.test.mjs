// A child's PDF on an answer (#237): the checks made before upload and the words used.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  PDF_MAX_BYTES,
  fileSummary,
  answerGiven,
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

describe("answerGiven (A-041)", () => {
  test("anything typed is an answer, file or no file", () => {
    assert.equal(answerGiven({ value: "7" }), true);
    assert.equal(answerGiven({ value: "0" }), true);
    assert.equal(answerGiven({ value: "My working." }), true);
  });

  test("nothing typed and nothing attached is not", () => {
    assert.equal(answerGiven({}), false);
    assert.equal(answerGiven({ value: "" }), false);
    assert.equal(answerGiven({ value: "   " }), false);
    // The ";" that joins an answer's boxes is not an answer on its own.
    assert.equal(answerGiven({ value: ";" }), false);
    assert.equal(answerGiven({ value: " ; ; " }), false);
  });

  test("one box of several filled is an answer", () => {
    assert.equal(answerGiven({ value: "9;" }), true);
    assert.equal(answerGiven({ value: ";2" }), true);
  });

  test("a PDF is an answer where a teacher marks it, and only there", () => {
    const pdf = { id: "f1" };
    assert.equal(answerGiven({ attachment: pdf, teacherMarked: true }), true);
    // A reviewer may put the box on an auto-marked question; there a PDF
    // with nothing typed really does score nothing, so saying "answered"
    // would be the comforting answer rather than the true one.
    assert.equal(answerGiven({ attachment: pdf, teacherMarked: false }), false);
    assert.equal(answerGiven({ attachment: pdf }), false);
    assert.equal(answerGiven({ attachment: null, teacherMarked: true }), false);
  });
});
