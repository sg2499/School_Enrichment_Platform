// #264: two saves of one mock answer must reach the server in order.
//
// The screen was already safe -- an overtaken response says nothing (A-002)
// -- but the server was not: an older PUT landing last overwrote the newer
// answer in the database while the screen said "saved", so a child lost what
// they typed with nothing looking wrong.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  chainByKey,
  finishSave,
  idsToResend,
  labelAfterSave,
  markTyped,
  newSitSaves,
  startSave,
} from "../../.test-build/lib/mockPapers.mjs";

const defer = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe("chainByKey", () => {
  test("a second save for one question waits for the first", async () => {
    const queue = {};
    const first = defer();
    const order = [];

    const a = chainByKey(queue, "q1", async () => { await first.promise; order.push("first"); });
    const b = chainByKey(queue, "q1", async () => { order.push("second"); });

    // The second has not run while the first is still in flight.
    await Promise.resolve();
    assert.deepEqual(order, []);

    first.resolve();
    await Promise.all([a, b]);
    assert.deepEqual(order, ["first", "second"], "the older save must land first");
  });

  test("without the chain the older save lands last -- the defect", async () => {
    // The same two saves fired concurrently, which is what the page did.
    const first = defer();
    const order = [];
    const a = (async () => { await first.promise; order.push("first"); })();
    const b = (async () => { order.push("second"); })();
    await b;
    first.resolve();
    await a;
    assert.deepEqual(order, ["second", "first"], "concurrent saves can land out of order");
  });

  test("different questions do not wait for each other", async () => {
    const queue = {};
    const held = defer();
    const order = [];
    const slow = chainByKey(queue, "q1", async () => { await held.promise; order.push("q1"); });
    await chainByKey(queue, "q2", async () => { order.push("q2"); });
    assert.deepEqual(order, ["q2"], "a slow save on one question must not block another");
    held.resolve();
    await slow;
    assert.deepEqual(order, ["q2", "q1"]);
  });

  test("a failed save does not wedge the question", async () => {
    const queue = {};
    const order = [];
    const failing = chainByKey(queue, "q1", async () => { order.push("failed"); throw new Error("refused"); });
    await assert.rejects(failing, /refused/);
    await chainByKey(queue, "q1", async () => { order.push("after"); });
    assert.deepEqual(order, ["failed", "after"], "the next save still runs");
  });

  test("the queue does not grow without bound", async () => {
    const queue = {};
    await chainByKey(queue, "q1", async () => {});
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(Object.keys(queue), [], "a finished chain is cleaned up");
  });
});

// The second half of #264: after a save succeeds, the word on the question is
// not always "Saved". Chaining means a save can land while newer typing for
// the same question is still queued, and claiming saved then is the very lie
// the chaining exists to remove.
describe("labelAfterSave", () => {
  test('says "saving" while newer typing is still waiting', () => {
    const tracker = newSitSaves();

    // A save goes out, so nothing is waiting: "Saved" is true.
    const first = startSave(tracker, "q1");
    assert.equal(labelAfterSave(tracker, "q1"), "saved");

    // The child types again while that save is in flight. Now the server is
    // about to be behind them, so the word must not be "Saved".
    markTyped(tracker, "q1");
    assert.equal(
      labelAfterSave(tracker, "q1"),
      "saving",
      'the queued answer is not saved yet, so "Saved" would be a lie',
    );

    // That first save comes back. It succeeded, but it is not the newest
    // answer, so the word stays "Saving".
    finishSave(tracker, "q1", first, "saved");
    assert.equal(labelAfterSave(tracker, "q1"), "saving");

    // The queued save goes out: nothing is waiting any more.
    const second = startSave(tracker, "q1");
    assert.equal(labelAfterSave(tracker, "q1"), "saved", "the window cannot stick");
    finishSave(tracker, "q1", second, "saved");
    assert.equal(labelAfterSave(tracker, "q1"), "saved");
  });

  test("one question's typing does not change another's word", () => {
    const tracker = newSitSaves();
    startSave(tracker, "q1");
    markTyped(tracker, "q2");
    assert.equal(labelAfterSave(tracker, "q1"), "saved");
    assert.equal(labelAfterSave(tracker, "q2"), "saving");
  });

  test("a superseded failure does not survive the next success", () => {
    // Chaining makes this sequence reachable: save 1 FAILS while save 2 is
    // queued. Before chaining both were in flight and save 1 was silent.
    // Save 2 must clear the failure, or hand-in is blocked by a save that
    // was already replaced.
    const tracker = newSitSaves();
    const first = startSave(tracker, "q1");
    finishSave(tracker, "q1", first, "failed", { questionId: "q1", message: "no" });
    assert.equal(tracker.unsaved.has("q1"), true);
    assert.notEqual(tracker.problem, null);

    const second = startSave(tracker, "q1");
    finishSave(tracker, "q1", second, "saved");
    assert.equal(tracker.unsaved.has("q1"), false, "the newer save cleared it");
    assert.equal(tracker.problem, null, "and cleared the banner it raised");
    assert.deepEqual(idsToResend(tracker), [], "so hand-in is not blocked");
  });
});
