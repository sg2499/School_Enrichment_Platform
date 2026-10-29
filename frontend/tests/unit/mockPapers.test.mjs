// Mock papers (#166 step 3): the builder's sums and words.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  activeHalf,
  answeredCount,
  countdownText,
  handedInText,
  placeAnswered,
  blankSection,
  defaultWindow,
  durationText,
  formatForServer,
  fromLocalInput,
  kindsFor,
  sectionText,
  STATUS_LABEL,
  toLocalInput,
  totalMarks,
  withMarks,
} from "../../.test-build/lib/mockPapers.mjs";

describe("sections", () => {
  test("4 marks is the case study, and multiple choice is for 1 or 2 marks", () => {
    assert.deepEqual(kindsFor(4), ["CASE_STUDY"]);
    assert.ok(kindsFor(2).includes("CHOICE"));
    assert.ok(!kindsFor(3).includes("CHOICE") && !kindsFor(5).includes("CASE_STUDY"));
    // #208: long answers in steps are 3 or 5 marks.
    assert.ok(!kindsFor(1).includes("WRITTEN") && !kindsFor(2).includes("WRITTEN") && kindsFor(3).includes("WRITTEN"));
  });

  test("changing the marks keeps the kind when it still fits", () => {
    const s = { name: "A", marks: 1, count: 5, choices: 0, kind: "CHOICE" };
    assert.equal(withMarks(s, 2).kind, "CHOICE");
    assert.equal(withMarks(s, 3).kind, "ANY");
    assert.equal(withMarks(s, 4).kind, "CASE_STUDY");
    assert.equal(withMarks(withMarks(s, 4), 5).kind, "ANY");
  });

  test("totals and words", () => {
    const sections = [
      { name: "Section A", marks: 1, count: 15, choices: 0, kind: "ANY" },
      { name: "Section B", marks: 3, count: 5, choices: 1, kind: "ANY" },
    ];
    assert.equal(totalMarks({ sections }), 30);
    assert.equal(sectionText(sections[1]), "5 questions × 3 marks, 1 with an either/or choice");
    assert.equal(sectionText({ marks: 1, count: 1, choices: 0 }), "1 question × 1 mark");
    assert.equal(blankSection(sections).name, "Section C");
    assert.equal(totalMarks({ sections: [{ marks: "", count: 3 }] }), 0);
  });

  test("durations", () => {
    assert.equal(durationText(120), "2 hours");
    assert.equal(durationText(90), "1 hour 30 minutes");
    assert.equal(durationText(40), "40 minutes");
    assert.equal(durationText(61), "1 hour 1 minute");
  });

  test("every status has words", () => {
    for (const s of ["DRAFT", "SCHEDULED", "OPEN", "CLOSED", "WITHDRAWN"]) assert.ok(STATUS_LABEL[s]);
  });
});

describe("dates", () => {
  test("a local time goes to the server with its offset, and back", () => {
    const local = "2026-11-02T09:00";
    const iso = fromLocalInput(local);
    assert.equal(toLocalInput(new Date(iso)), local);
    assert.equal(fromLocalInput(""), null);
    assert.equal(fromLocalInput("tomorrow"), null);
  });

  test("a paper opens tomorrow at 9 and closes a week later at 6", () => {
    const { opens, closes } = defaultWindow(new Date(2026, 9, 27, 15, 30));
    assert.equal(opens, "2026-10-28T09:00");
    assert.equal(closes, "2026-11-04T18:00");
  });
});

describe("what the server is sent", () => {
  test("typed numbers become numbers; blanks are left for the server to name", () => {
    const sent = formatForServer({
      name: "T",
      sections: [{ name: "A", marks: "2", count: "", choices: "0", kind: "ANY" }],
      timeMinutes: "45",
      readingMinutes: 0,
      difficulty: { easy: "30", medium: 50, hard: "20" },
      applicationMin: null,
      shuffle: false,
      navigation: "FREE",
    });
    assert.deepEqual(sent.sections[0], { name: "A", marks: 2, count: "", choices: 0, kind: "ANY" });
    assert.equal(sent.timeMinutes, 45);
    assert.deepEqual(sent.difficulty, { easy: 30, medium: 50, hard: 20 });
    assert.equal(sent.applicationMin, null);
  });
});

describe("sitting the paper", () => {
  test("the countdown", () => {
    assert.equal(countdownText(299_000), "04:59");
    assert.equal(countdownText(3_909_000), "1:05:09");
    assert.equal(countdownText(-5_000), "00:00");
    assert.equal(countdownText(500), "00:01");
  });

  const part = (id) => ({ id });
  const single = { number: 1, marks: 1, choiceGroup: null, chosenSlotId: null, halves: [{ slotId: "s1", stimulus: null, parts: [part("q1")] }] };
  const pair = {
    number: 2,
    marks: 3,
    choiceGroup: 1,
    chosenSlotId: null,
    halves: [
      { slotId: "s2", stimulus: null, parts: [part("q2")] },
      { slotId: "s3", stimulus: null, parts: [part("q3")] },
    ],
  };
  const caseStudy = { number: 3, marks: 4, choiceGroup: null, chosenSlotId: null, halves: [{ slotId: "s4", stimulus: "S", parts: [part("a"), part("b")] }] };

  test("an either/or pair is answered through the half chosen", () => {
    assert.equal(activeHalf(pair), null);
    assert.equal(placeAnswered(pair, { q2: "x" }), false);
    assert.equal(placeAnswered({ ...pair, chosenSlotId: "s3" }, { q3: "x" }), true);
    assert.equal(activeHalf(single).slotId, "s1");
  });

  test("every part must be filled; an answer in parts with an empty box is not", () => {
    assert.equal(placeAnswered(caseStudy, { a: "1" }), false);
    assert.equal(placeAnswered(caseStudy, { a: "1", b: "2" }), true);
    assert.equal(placeAnswered(single, { q1: ";" }), false);
    assert.equal(placeAnswered(single, { q1: "  " }), false);
    const sections = [{ places: [single, { ...pair, chosenSlotId: "s2" }, caseStudy] }];
    assert.deepEqual(answeredCount(sections, { q1: "4", q2: "x" }), { answered: 2, total: 3 });
  });

  test("how it was handed in", () => {
    assert.match(handedInText("TIME"), /time ran out/);
    assert.match(handedInText("CLOSED"), /paper closed/);
    assert.match(handedInText("STUDENT"), /You handed in/);
  });
});
