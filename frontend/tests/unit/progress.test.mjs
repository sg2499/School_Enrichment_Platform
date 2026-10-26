// My Progress (#184): how bands and scores are put into words, which
// chapters open by themselves, filtering, and where a self-practice set
// leads.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  answeredText,
  BAND_LABEL,
  BAND_TONE,
  bandMeaning,
  chapterCounts,
  chapterStarted,
  filterChapters,
  percentText,
  selfPracticeAction,
  selfPracticeHref,
  selfPracticeStatus,
  STANDING_LABEL,
  standingText,
  chaptersWithStanding,
} from "../../.test-build/lib/progress.mjs";

const skill = (id, band, extra = {}) => ({
  id,
  code: `C5-${id}`,
  title: `Skill ${id}`,
  percent: band === "NOT_STARTED" ? null : 60,
  answered: band === "NOT_STARTED" ? 0 : 4,
  band,
  lastPractisedAt: null,
  ...extra,
});

const CHAPTERS = [
  { id: "c1", code: "CH01", chapterNo: 1, title: "Numbers", skills: [skill("a", "STRONG"), skill("b", "NEEDS_WORK"), skill("c", "STRONG")] },
  { id: "c2", code: "CH02", chapterNo: 2, title: "Fractions", skills: [skill("d", "NOT_STARTED"), skill("e", "NOT_STARTED")] },
];

describe("words", () => {
  test("every band has a label and a tone", () => {
    for (const band of ["STRONG", "GETTING_THERE", "NEEDS_WORK", "JUST_STARTED", "NOT_STARTED"]) {
      assert.ok(BAND_LABEL[band] && BAND_TONE[band]);
    }
    assert.equal(BAND_LABEL.GETTING_THERE, "Getting There");
  });

  test("percent and answered", () => {
    assert.equal(percentText(null), "—");
    assert.equal(percentText(66.7), "66%");
    assert.equal(percentText(79.96), "79%");
    assert.equal(percentText(80), "80%");
    assert.equal(percentText(0), "0%");
    assert.equal(answeredText(0), "Not practised yet");
    assert.equal(answeredText(1), "1 question");
    assert.equal(answeredText(5), "5 questions");
    assert.match(bandMeaning("JUST_STARTED", 3), /3 or more/);
  });
});

describe("chapters", () => {
  test("counts in band order, and only a practised chapter opens", () => {
    assert.deepEqual(chapterCounts(CHAPTERS[0]), [
      { band: "STRONG", count: 2 },
      { band: "NEEDS_WORK", count: 1 },
    ]);
    assert.equal(chapterStarted(CHAPTERS[0]), true);
    assert.equal(chapterStarted(CHAPTERS[1]), false);
  });

  test("filtering by band and search drops empty chapters", () => {
    assert.deepEqual(
      filterChapters(CHAPTERS, "", "NEEDS_WORK").map((c) => [c.id, c.skills.map((s) => s.id)]),
      [["c1", ["b"]]],
    );
    assert.deepEqual(filterChapters(CHAPTERS, " c5-E ", "ALL").map((c) => c.skills.map((s) => s.id)), [["e"]]);
    assert.equal(filterChapters(CHAPTERS, "skill", "ALL").length, 2);
    assert.equal(filterChapters(CHAPTERS, "nothing", "ALL").length, 0);
  });
});

describe("self-practice", () => {
  const base = { assignmentTargetId: "t1", title: "Rounding — Remediation", activityType: "REMEDIATION", status: "PENDING", startedAt: null, attemptsMade: 0, maxAttempts: 3 };

  test("a set not started opens, one in progress continues, one handed in shows its result", () => {
    assert.deepEqual(selfPracticeHref({ ...base, latestAttempt: null }), { label: "Start", href: "/student/practice/t1" });
    const open = { id: "a1", attemptNumber: 1, status: "IN_PROGRESS", finalScore: null, maxScore: null, reviewStatus: null };
    assert.deepEqual(selfPracticeHref({ ...base, attemptsMade: 1, latestAttempt: open }), { label: "Continue", href: "/student/practice/t1" });
    const done = { id: "a2", attemptNumber: 2, status: "EVALUATED", finalScore: 7, maxScore: 8, reviewStatus: "AUTO_FINALISED" };
    assert.deepEqual(selfPracticeHref({ ...base, attemptsMade: 2, latestAttempt: done }), {
      label: "View Result",
      href: "/student/practice/t1?attemptId=a2&view=result",
    });
    assert.equal(selfPracticeStatus({ ...base, latestAttempt: done }), "7 / 8");
    assert.equal(selfPracticeStatus({ ...base, latestAttempt: { ...done, reviewStatus: "PENDING_REVIEW" } }), "Waiting for your teacher's marks");
    assert.equal(selfPracticeStatus({ ...base, latestAttempt: open }), "Attempt 1 in progress");
    assert.equal(selfPracticeStatus({ ...base, latestAttempt: null }), "Not started yet");
    assert.equal(selfPracticeAction(null, null), "Practise on My Own");
    assert.equal(selfPracticeAction("t1", "IN_PROGRESS"), "Continue");
    assert.equal(selfPracticeAction("t1", "COMPLETED"), "Try Again");
    assert.equal(selfPracticeAction("t1", "PENDING"), "Start");
  });
});

describe("class standing (#185)", () => {
  test("only the top bands have words, and the class is named", () => {
    assert.deepEqual(Object.keys(STANDING_LABEL), ["TOP_10", "TOP_25", "TOP_HALF"]);
    assert.equal(standingText("TOP_25", "Class 5"), "Top 25% of Class 5");
    assert.equal(standingText("TOP_HALF", null), "Top Half");
  });

  test("chapters with a standing, in order", () => {
    const chapters = [
      { ...CHAPTERS[0], standing: "TOP_10" },
      { ...CHAPTERS[1], standing: null },
      { ...CHAPTERS[1], id: "c3", standing: "TOP_HALF" },
    ];
    assert.deepEqual(chaptersWithStanding(chapters).map((c) => c.id), ["c1", "c3"]);
  });
});
