/**
 * lib/studentPractice.ts -- what a student's own practice adds up to: the
 * figures in the Student mastheads, the one next step the dashboard names,
 * and how a marked answer is read. The rules that matter: nothing is
 * counted twice or guessed, a score still being marked is said to be so
 * far, and a written answer with part marks is not called wrong.
 *
 * Run with `npm test` (scripts/run-unit-tests.mjs).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  PRACTICE_LIST_HREF,
  PRACTICE_LIST_NAME,
  STATUS_LABEL,
  answerMarks,
  answerPresentation,
  answerState,
  attemptsLeft,
  averageScore,
  latestScore,
  practiceAction,
  resultSentence,
  resultTally,
  scorePercent,
  setWord,
  stillBeingMarked,
  studentNextStep,
  summarisePractice,
} from "../../.test-build/lib/studentPractice.mjs";

let n = 0;
function set(status, extra = {}) {
  n += 1;
  return {
    assignmentTargetId: `t${n}`,
    assignmentId: `a${n}`,
    status,
    learningActivity: { title: extra.title ?? `Set ${n}`, estimatedMinutes: extra.minutes ?? null, activityType: "CORE_PRACTICE" },
    dueDate: null,
    reason: "TEACHER_SELECTED",
    maxAttempts: 3,
    bonusAttempts: 0,
    latestAttempt: extra.latestAttempt ?? null,
  };
}
function done(finalScore, maxScore, evaluatedAt, extra = {}) {
  return set("COMPLETED", {
    ...extra,
    latestAttempt: {
      id: `att-${evaluatedAt}`,
      attemptNumber: 1,
      status: "EVALUATED",
      evaluation: { attemptId: "x", autoScore: finalScore, maxScore, finalScore, reviewStatus: extra.reviewStatus ?? "AUTO_FINALISED", evaluatedAt },
    },
  });
}

describe("summarisePractice", () => {
  test("waiting is in progress first, then not started; done is newest first", () => {
    const list = [set("PENDING", { title: "P1" }), done(1, 3, "2026-09-01T10:00:00Z", { title: "Old" }), set("IN_PROGRESS", { title: "I1" }), done(3, 3, "2026-09-20T10:00:00Z", { title: "New" })];
    const s = summarisePractice(list);
    assert.deepEqual(s.waiting.map((a) => a.learningActivity.title), ["I1", "P1"]);
    assert.deepEqual(s.completed.map((a) => a.learningActivity.title), ["New", "Old"]);
    assert.equal(s.inProgress, 1);
    assert.equal(s.notStarted, 1);
    assert.equal(s.countable, 4);
  });

  test("a skipped set is neither waiting nor done, and is not counted", () => {
    const s = summarisePractice([set("SKIPPED"), set("PENDING")]);
    assert.equal(s.skipped.length, 1);
    assert.equal(s.waiting.length, 1);
    assert.equal(s.completed.length, 0);
    assert.equal(s.countable, 1);
  });

  test("the list it was given is not reordered", () => {
    const list = [done(1, 2, "2026-09-01T10:00:00Z"), set("PENDING")];
    const before = list.map((a) => a.assignmentTargetId);
    summarisePractice(list);
    assert.deepEqual(list.map((a) => a.assignmentTargetId), before);
  });

  test("nothing at all is all zeros", () => {
    const s = summarisePractice([]);
    assert.deepEqual([s.waiting.length, s.completed.length, s.skipped.length, s.inProgress, s.notStarted, s.countable], [0, 0, 0, 0, 0, 0]);
  });
});

describe("practiceAction", () => {
  test("a finished set opens its stored result, never a new attempt", () => {
    const item = done(2, 3, "2026-09-20T10:00:00Z");
    const action = practiceAction(item);
    assert.equal(action.label, "View Result");
    assert.equal(action.href, `${PRACTICE_LIST_HREF}/${item.assignmentTargetId}?attemptId=${item.latestAttempt.id}&view=result`);
  });

  test("an open set continues, a new one starts, both on the plain address", () => {
    const open = set("IN_PROGRESS");
    const fresh = set("PENDING");
    assert.deepEqual(practiceAction(open), { label: "Continue", href: `${PRACTICE_LIST_HREF}/${open.assignmentTargetId}` });
    assert.deepEqual(practiceAction(fresh), { label: "Start", href: `${PRACTICE_LIST_HREF}/${fresh.assignmentTargetId}` });
  });

  test("a set marked finished with no attempt on record does not point at a result that is not there", () => {
    const odd = set("COMPLETED");
    assert.equal(practiceAction(odd).label, "Start");
  });
});

describe("latestScore and averageScore", () => {
  test("the latest score is the most recently marked set's", () => {
    const s = summarisePractice([done(1, 4, "2026-09-01T10:00:00Z", { title: "Old" }), done(2, 3, "2026-09-20T10:00:00Z", { title: "New" })]);
    assert.deepEqual(latestScore(s), { finalScore: 2, maxScore: 3, title: "New", stillBeingMarked: false });
  });

  test("a set a teacher is still marking says so", () => {
    const s = summarisePractice([done(2, 5, "2026-09-20T10:00:00Z", { reviewStatus: "PENDING_REVIEW" })]);
    assert.equal(latestScore(s).stillBeingMarked, true);
  });

  test("with nothing marked there is no latest score and no average", () => {
    const s = summarisePractice([set("PENDING"), set("IN_PROGRESS")]);
    assert.equal(latestScore(s), null);
    assert.equal(averageScore(s), null);
  });

  test("the average is the mean of each set's own percentage, rounded", () => {
    // 1/4 = 25%, 3/3 = 100%, 2/3 = 66.7% -> 63.9 -> 64
    const s = summarisePractice([done(1, 4, "2026-09-01T10:00:00Z"), done(3, 3, "2026-09-02T10:00:00Z"), done(2, 3, "2026-09-03T10:00:00Z")]);
    assert.deepEqual(averageScore(s), { percent: 64, sets: 3 });
  });

  test("a set with no marks to earn is left out of the average, not counted as zero", () => {
    const s = summarisePractice([done(0, 0, "2026-09-01T10:00:00Z"), done(1, 2, "2026-09-02T10:00:00Z")]);
    assert.deepEqual(averageScore(s), { percent: 50, sets: 1 });
  });

  test("a set still waiting for a teacher's marks is not a marked set: it is left out of the average", () => {
    // 2/5 so far, with written answers unmarked, must not pull 4/4 down to 70%.
    const waiting = done(2, 5, "2026-09-03T10:00:00Z", { reviewStatus: "PENDING_REVIEW" });
    const s = summarisePractice([done(4, 4, "2026-09-01T10:00:00Z"), waiting]);
    assert.deepEqual(averageScore(s), { percent: 100, sets: 1 });
    assert.equal(stillBeingMarked(waiting), true);
    assert.equal(stillBeingMarked(set("PENDING")), false);
    // Only waiting sets: no average at all, not 40%.
    assert.equal(averageScore(summarisePractice([waiting])), null);
    // Marked by a teacher: back in.
    const marked = done(4, 5, "2026-09-04T10:00:00Z", { reviewStatus: "FINALISED" });
    assert.deepEqual(averageScore(summarisePractice([marked])), { percent: 80, sets: 1 });
  });
});

describe("studentNextStep", () => {
  test("still loading: nothing to say yet", () => {
    assert.equal(studentNextStep({ kind: "loading" }), null);
  });

  test("the list could not be read: says so, and never claims there is nothing to do", () => {
    const step = studentNextStep({ kind: "error" });
    assert.match(step.title, /couldn't check/);
    assert.doesNotMatch(`${step.title} ${step.body}`, /nothing to do|caught up|on its way/i);
    assert.deepEqual(step.action, { href: PRACTICE_LIST_HREF, label: `Open ${PRACTICE_LIST_NAME}` });
  });

  test("nothing assigned yet: says so, with no action and no promise that anything is coming", () => {
    const step = studentNextStep({ kind: "ready", summary: summarisePractice([]) });
    assert.equal(step.action, undefined);
    assert.equal(step.title, "No practice assigned yet");
    assert.doesNotMatch(`${step.title} ${step.body}`, /on its way|soon|today|tomorrow/i);
  });

  test("an open set comes first, by name, and goes straight to it", () => {
    const open = set("IN_PROGRESS", { title: "Place Value" });
    const step = studentNextStep({ kind: "ready", summary: summarisePractice([set("PENDING"), open, set("PENDING")]) });
    assert.equal(step.title, "Pick up where you left off");
    assert.match(step.body, /You started Place Value\./);
    assert.match(step.body, /2 more are waiting after that\.$/);
    assert.deepEqual(step.action, { href: `${PRACTICE_LIST_HREF}/${open.assignmentTargetId}`, label: "Continue Practice" });
  });

  test("one new set: singular, with its length when it has one", () => {
    const fresh = set("PENDING", { title: "Rounding", minutes: 10 });
    const step = studentNextStep({ kind: "ready", summary: summarisePractice([fresh]) });
    assert.equal(step.title, "One practice set is ready for you");
    assert.equal(step.body, "Next up: Rounding, about 10 minutes.");
    assert.equal(step.action.label, "Start Practice");
  });

  test("several new sets: counted, and the rest mentioned with the right verb", () => {
    const two = studentNextStep({ kind: "ready", summary: summarisePractice([set("PENDING", { title: "A" }), set("PENDING", { title: "B" })]) });
    assert.equal(two.title, "2 practice sets are ready for you");
    assert.equal(two.body, "Next up: A. 1 more is waiting after that.");
  });

  test("everything done: singular and plural both read as sentences", () => {
    const one = studentNextStep({ kind: "ready", summary: summarisePractice([done(1, 1, "2026-09-01T10:00:00Z")]) });
    assert.equal(one.title, "You're all caught up");
    assert.match(one.body, /^The practice set your teacher has assigned is done\./);
    const three = studentNextStep({ kind: "ready", summary: summarisePractice([done(1, 1, "a"), done(1, 1, "b"), done(1, 1, "c")]) });
    assert.match(three.body, /^All 3 practice sets your teacher has assigned are done\./);
    // The list is read when a page opens: nothing is promised "the moment" it is assigned.
    assert.doesNotMatch(three.body, /the moment/);
    assert.deepEqual(three.action, { href: PRACTICE_LIST_HREF, label: "See Your Results" });
  });

  test("no sentence carries a raw value", () => {
    const cases = [{ kind: "error" }, { kind: "ready", summary: summarisePractice([]) }, { kind: "ready", summary: summarisePractice([set("PENDING")]) }, { kind: "ready", summary: summarisePractice([done(1, 2, "x")]) }];
    for (const load of cases) {
      const step = studentNextStep(load);
      assert.doesNotMatch(`${step.title} ${step.body}`, /undefined|null|NaN|\[object/);
    }
  });
});

describe("answerState, answerMarks and resultTally", () => {
  test("automatic marking: right, wrong, or not marked yet", () => {
    assert.equal(answerState({ isCorrect: true, manualScore: null, maxScore: 1 }), "correct");
    assert.equal(answerState({ isCorrect: false, manualScore: null, maxScore: 1 }), "incorrect");
    assert.equal(answerState({ isCorrect: null, manualScore: null, maxScore: 3 }), "pending");
    assert.equal(answerState({ isCorrect: null, maxScore: 3 }), "pending");
  });

  test("a teacher's part marks are part marks, not 'incorrect'", () => {
    // The server stores is_correct as "full marks or not" for a marked answer.
    assert.equal(answerState({ isCorrect: false, manualScore: 2, maxScore: 3 }), "partial");
    assert.equal(answerState({ isCorrect: true, manualScore: 3, maxScore: 3 }), "correct");
    assert.equal(answerState({ isCorrect: false, manualScore: 0, maxScore: 3 }), "incorrect");
  });

  test("the marks an answer earned: the teacher's if there are any, else automatic, else none yet", () => {
    assert.equal(answerMarks({ autoScore: null, manualScore: 2 }), 2);
    assert.equal(answerMarks({ autoScore: 1, manualScore: null }), 1);
    assert.equal(answerMarks({ autoScore: 0 }), 0);
    assert.equal(answerMarks({ autoScore: null, manualScore: null }), null);
  });

  test("the tally adds up to the number of answers", () => {
    const answers = [
      { isCorrect: true, manualScore: null, maxScore: 1 },
      { isCorrect: false, manualScore: null, maxScore: 1 },
      { isCorrect: false, manualScore: 1, maxScore: 3 },
      { isCorrect: null, manualScore: null, maxScore: 3 },
      { isCorrect: true, manualScore: 3, maxScore: 3 },
    ];
    const tally = resultTally(answers);
    assert.deepEqual(tally, { correct: 2, partial: 1, incorrect: 1, pending: 1 });
    assert.equal(tally.correct + tally.partial + tally.incorrect + tally.pending, answers.length);
  });
});

describe("attemptsLeft, scorePercent, resultSentence, setWord", () => {
  test("attempts left counts a teacher's extra ones and never goes below zero", () => {
    assert.equal(attemptsLeft({ maxAttempts: 3, bonusAttempts: 0, attemptsUsed: 1 }), 2);
    assert.equal(attemptsLeft({ maxAttempts: 3, bonusAttempts: 1, attemptsUsed: 3 }), 1);
    assert.equal(attemptsLeft({ maxAttempts: 3, bonusAttempts: 0, attemptsUsed: 3 }), 0);
    assert.equal(attemptsLeft({ maxAttempts: 1, bonusAttempts: 0, attemptsUsed: 4 }), 0);
  });

  test("a percentage is whole, and there is none of nothing", () => {
    assert.equal(scorePercent(2, 3), 67);
    assert.equal(scorePercent(0, 5), 0);
    assert.equal(scorePercent(5, 5), 100);
    assert.equal(scorePercent(0, 0), null);
  });

  test("a score still being marked is called so far", () => {
    const line = resultSentence({ reviewStatus: "PENDING_REVIEW", finalScore: 2, maxScore: 5 });
    assert.match(line, /so far\.$/);
  });

  test("a score a teacher has marked says who marked it", () => {
    assert.match(resultSentence({ reviewStatus: "FINALISED", finalScore: 4, maxScore: 5 }), /^Your teacher has marked your written answers\./);
  });

  test("no result is called final, or said to be unable to go down: a teacher can change a mark", () => {
    for (const reviewStatus of ["PENDING_REVIEW", "FINALISED", "AUTO_FINALISED"]) {
      for (const finalScore of [0, 2, 5]) {
        assert.doesNotMatch(resultSentence({ reviewStatus, finalScore, maxScore: 5 }), /final|only go up/i);
      }
    }
  });

  test("full marks is full marks, whoever marked it", () => {
    assert.equal(resultSentence({ reviewStatus: "AUTO_FINALISED", finalScore: 5, maxScore: 5 }), "Full marks. Every answer right.");
    assert.equal(resultSentence({ reviewStatus: "FINALISED", finalScore: 5, maxScore: 5 }), "Full marks. Every answer right.");
  });

  test("an automatically marked set with misses points at the answers", () => {
    assert.match(resultSentence({ reviewStatus: "AUTO_FINALISED", finalScore: 2, maxScore: 3 }), /shows the correct answer/);
  });

  test("set or sets", () => {
    assert.equal(setWord(1), "set");
    assert.equal(setWord(0), "sets");
    assert.equal(setWord(2), "sets");
  });

  test("the list has one name", () => {
    assert.equal(PRACTICE_LIST_NAME, "Daily Practice");
    assert.equal(STATUS_LABEL.PENDING, "Not Started");
  });
});

describe("answerPresentation", () => {
  const greatest = {
    questionType: "Single Select",
    options: { A: "3,05,000", B: "3,50,000", C: "5,03,000", D: "" },
    responseText: "A",
    correctAnswer: "C",
  };

  test("a select answer is drawn on its options, with what was picked and what was right", () => {
    const shown = answerPresentation(greatest, true);
    assert.equal(shown.kind, "options");
    assert.equal(shown.answered, true);
    // An empty option is not an option.
    assert.deepEqual(
      shown.options.map((o) => [o.letter, o.text, o.chosen, o.correct]),
      [
        ["A", "3,05,000", true, false],
        ["B", "3,50,000", false, false],
        ["C", "5,03,000", false, true],
      ],
    );
  });

  test("the right answer is never marked while it may not be shown", () => {
    const shown = answerPresentation(greatest, false);
    assert.equal(shown.kind, "options");
    assert.ok(shown.options.every((o) => o.correct === false));
    assert.equal(shown.options[0].chosen, true);
  });

  test("multi select reads every letter, in any case and spacing", () => {
    const shown = answerPresentation(
      { questionType: "Multi Select", options: { A: "2", B: "3", C: "4", D: "9" }, responseText: " a , c", correctAnswer: "A,D" },
      true,
    );
    assert.equal(shown.kind, "options");
    assert.deepEqual(shown.options.filter((o) => o.chosen).map((o) => o.letter), ["A", "C"]);
    assert.deepEqual(shown.options.filter((o) => o.correct).map((o) => o.letter), ["A", "D"]);
  });

  test("an unanswered select question still shows its options and the right one", () => {
    const shown = answerPresentation({ ...greatest, responseText: null }, true);
    assert.equal(shown.kind, "options");
    assert.equal(shown.answered, false);
    assert.deepEqual(shown.options.filter((o) => o.correct).map((o) => o.letter), ["C"]);
  });

  test("an ordering answer becomes the things that were ordered", () => {
    const ordering = { questionType: "Ordering", options: { A: "45,210", B: "4,521", C: "4,52,100" }, responseText: "A;B;C", correctAnswer: "B;A;C" };
    assert.deepEqual(answerPresentation(ordering, true), {
      kind: "sequence",
      yours: ["45,210", "4,521", "4,52,100"],
      right: ["4,521", "45,210", "4,52,100"],
    });
    assert.deepEqual(answerPresentation(ordering, false), { kind: "sequence", yours: ["45,210", "4,521", "4,52,100"], right: null });
    assert.deepEqual(answerPresentation({ ...ordering, responseText: "" }, true), {
      kind: "sequence",
      yours: null,
      right: ["4,521", "45,210", "4,52,100"],
    });
  });

  test("anything that cannot be read with certainty is shown as stored", () => {
    // No options sent (an older server), or a type with none.
    assert.deepEqual(answerPresentation({ questionType: "Single Select", responseText: "A", correctAnswer: "B" }, true), { kind: "text" });
    assert.deepEqual(answerPresentation({ ...greatest, questionType: undefined }, true), { kind: "text" });
    assert.deepEqual(answerPresentation({ questionType: "Numeric Entry", options: {}, responseText: "99250", correctAnswer: "99250" }, true), { kind: "text" });
    assert.deepEqual(answerPresentation({ questionType: "Constructed Response", options: { A: "x" }, responseText: "Because…", correctAnswer: "" }, true), { kind: "text" });
    // A key or an answer naming something that is not one of the options.
    assert.deepEqual(answerPresentation({ ...greatest, correctAnswer: "E" }, true), { kind: "text" });
    assert.deepEqual(answerPresentation({ ...greatest, responseText: "5,03,000" }, true), { kind: "text" });
    // An ordering key written as the values themselves.
    assert.deepEqual(
      answerPresentation({ questionType: "Ordering", options: { A: "12", B: "15" }, responseText: "A;B", correctAnswer: "12;15" }, true),
      { kind: "text" },
    );
  });
});
