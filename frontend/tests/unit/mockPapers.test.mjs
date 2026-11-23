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
  clearSitSaves,
  finishSave,
  handInBlock,
  idsToResend,
  markTyped,
  newSitSaves,
  startSave,
} from "../../.test-build/lib/mockPapers.mjs";

describe("sections", () => {
  test("4 marks is the case study, and multiple choice is for 1 mark", () => {
    assert.deepEqual(kindsFor(4), ["CASE_STUDY"]);
    assert.ok(kindsFor(1).includes("CHOICE") && !kindsFor(2).includes("CHOICE"), "multiple choice is 1 mark (#214)");
    assert.ok(!kindsFor(3).includes("CHOICE") && !kindsFor(5).includes("CASE_STUDY"));
    // #208: long answers in steps are 3 or 5 marks.
    assert.ok(!kindsFor(1).includes("WRITTEN") && !kindsFor(2).includes("WRITTEN") && kindsFor(3).includes("WRITTEN"));
  });

  test("changing the marks keeps the kind when it still fits", () => {
    const s = { name: "A", marks: 1, count: 5, choices: 0, kind: "NUMBER" };
    assert.equal(withMarks(s, 2).kind, "NUMBER");
    assert.equal(withMarks({ ...s, kind: "CHOICE" }, 2).kind, "ANY", "multiple choice doesn't carry to 2 marks (#214)");
    assert.equal(withMarks({ ...s, kind: "CHOICE" }, 3).kind, "ANY");
    assert.equal(withMarks(s, 3).kind, "NUMBER");
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

  test("a PDF is an answer too, on a question a teacher marks (A-013)", () => {
    const pdf = { id: "f1" };
    const drawn = { number: 4, marks: 3, choiceGroup: null, chosenSlotId: null,
                    halves: [{ slotId: "s5", stimulus: null, parts: [{ id: "d1", teacherMarked: true }] }] };
    // Nothing typed, a PDF attached: answered.
    assert.equal(placeAnswered(drawn, {}, { d1: pdf }), true);
    // The file already on the part counts the same, so a freshly loaded
    // paper reads the same as one just uploaded to.
    const loaded = { ...drawn, halves: [{ slotId: "s5", stimulus: null, parts: [{ id: "d1", teacherMarked: true, attachment: pdf }] }] };
    assert.equal(placeAnswered(loaded, {}), true);
    // Removing the file counts it as gone, rather than reading back the one
    // the paper loaded with: the screen's record wins where it has one.
    assert.equal(placeAnswered(loaded, {}, { d1: null }), false);
    // Not where the platform marks it: a PDF there earns nothing on its own.
    const auto = { ...drawn, halves: [{ slotId: "s5", stimulus: null, parts: [{ id: "d1" }] }] };
    assert.equal(placeAnswered(auto, {}, { d1: pdf }), false);
    // And with no files given, every count reads exactly as before.
    assert.equal(placeAnswered(drawn, {}), false);
    const sections = [{ places: [single, drawn] }];
    assert.deepEqual(answeredCount(sections, { q1: "4" }), { answered: 1, total: 2 });
    assert.deepEqual(answeredCount(sections, { q1: "4" }, { d1: pdf }), { answered: 2, total: 2 });
  });

  test("how it was handed in", () => {
    assert.match(handedInText("TIME"), /time ran out/);
    assert.match(handedInText("CLOSED"), /paper closed/);
    assert.match(handedInText("STUDENT"), /You handed in/);
  });
});

/*
 * A-002: a mock paper must not be handed in while an answer has not saved.
 * The audit reproduced the opposite: the save swallowed its own error, so
 * the flush before handing in always looked successful and the answer was
 * marked blank, with no re-sit.
 *
 * These drive the real bookkeeping the screen uses, in sequence, so each
 * one fails if the guard is taken out.
 */
describe("saving a mock answer, and when the paper may be handed in", () => {
  const save = (s, id, outcome, problem) => finishSave(s, id, startSave(s, id), outcome, problem);
  const refusal = (id) => ({ questionId: id, message: "That answer is too long.", sessionEnded: false, retryable: false });
  const dropped = (id) => ({ questionId: id, message: "Something went wrong on our side.", sessionEnded: false, retryable: true });
  const names = { questionName: (id) => ({ q1: "Question 1", q2: "Question 2" })[id] ?? id };

  test("nothing unsaved: the paper goes", () => {
    const s = newSitSaves();
    save(s, "q1", "saved");
    assert.equal(handInBlock(s, { pastDeadline: false, ...names }), null);
  });

  test("a failed save blocks the hand-in and names the question and the reason", () => {
    const s = newSitSaves();
    save(s, "q1", "failed", refusal("q1"));
    const block = handInBlock(s, { pastDeadline: false, ...names });
    assert.ok(block, "a failed save must block the hand-in");
    assert.match(block.message, /Question 1/);
    assert.match(block.message, /too long/);
    assert.match(block.message, /Nothing has been handed in/);
  });

  test("a refused save is still sent again, so the child is never stuck", () => {
    // It is never put back into `pending`, so only `unsaved` keeps it alive.
    const s = newSitSaves();
    save(s, "q1", "failed", refusal("q1"));
    assert.deepEqual(idsToResend(s), ["q1"]);
    save(s, "q1", "saved"); // the next press gets through
    assert.deepEqual(idsToResend(s), []);
    assert.equal(handInBlock(s, { pastDeadline: false, ...names }), null);
  });

  test("an answer typed during the flush also blocks it", () => {
    const s = newSitSaves();
    save(s, "q1", "saved");
    markTyped(s, "q2");
    const block = handInBlock(s, { pastDeadline: false, ...names });
    assert.ok(block);
    assert.match(block.message, /Question 2/);
  });

  test("two unsaved answers are counted, not named one by one", () => {
    const s = newSitSaves();
    save(s, "q1", "failed", refusal("q1"));
    save(s, "q2", "failed", refusal("q2"));
    assert.match(handInBlock(s, { pastDeadline: false, ...names }).message, /2 of your answers/);
  });

  test("past the deadline nothing is blocked: the server has the paper", () => {
    const s = newSitSaves();
    save(s, "q1", "failed", refusal("q1"));
    assert.ok(handInBlock(s, { pastDeadline: false, ...names }));
    assert.equal(handInBlock(s, { pastDeadline: true, ...names }), null);
  });

  test("a slow older save cannot report over a newer one", () => {
    const s = newSitSaves();
    const first = startSave(s, "q1");
    const second = startSave(s, "q1"); // the child typed again
    finishSave(s, "q1", second, "failed", refusal("q1"));
    finishSave(s, "q1", first, "saved"); // the first PUT lands late
    assert.deepEqual(idsToResend(s), ["q1"], "the newer failure must stand");
  });

  test("a session that has ended is told apart from an ordinary failure", () => {
    const s = newSitSaves();
    save(s, "q1", "failed", { questionId: "q1", message: "Please sign in again.", sessionEnded: true, retryable: false });
    const block = handInBlock(s, { pastDeadline: false, ...names });
    assert.equal(block.sessionEnded, true);
    assert.match(block.message, /Sign in again/);
    assert.doesNotMatch(block.message, /Press Hand In again/);
  });

  test("what the child is told to do next fits the cause", () => {
    const refused = newSitSaves();
    save(refused, "q1", "failed", refusal("q1"));
    // Pressing again would be refused again: the answer has to change.
    assert.match(handInBlock(refused, { pastDeadline: false, ...names }).message, /Change that answer/);

    const flaky = newSitSaves();
    save(flaky, "q1", "failed", dropped("q1"));
    assert.match(handInBlock(flaky, { pastDeadline: false, ...names }).message, /Press Hand In again/);
  });

  test("the paper handed in by the server clears everything", () => {
    const s = newSitSaves();
    save(s, "q1", "failed", refusal("q1"));
    clearSitSaves(s);
    assert.deepEqual(idsToResend(s), []);
    assert.equal(handInBlock(s, { pastDeadline: false, ...names }), null);
  });
});
