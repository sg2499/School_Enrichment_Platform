"use client";

import { useEffect, useState } from "react";

/**
 * "You have just finished marking this assignment" (2 Oct 2026) -- the one
 * real event the saffron achievement spark is wired to (see
 * components/brand/AchievementSpark.tsx).
 *
 * What counts. An assignment's To Mark count reaching zero BECAUSE OF
 * something this teacher did in this browser tab. Not a page that simply
 * loads with nothing to mark: most assignments have no written answers, and
 * a celebration that fires for doing nothing is worth nothing the one time
 * it is earned.
 *
 * Why this needs a small store rather than a useState. The count lives on
 * one route and the action that changes it lives on another: To Mark is
 * shown on /teacher/tracker/assignments/[id], but marks are saved on
 * /teacher/tracker/attempts/[id]. The assignment page is unmounted while
 * the teacher marks, so it cannot watch its own number fall -- it has to be
 * told, when it mounts again, what happened while it was away. That is the
 * whole job of this file.
 *
 * How it works, with no API call of its own:
 *  1. The attempt page calls recordAttemptFinalised(assignmentId) at the
 *     moment a save turns an attempt from PENDING_REVIEW into FINALISED --
 *     i.e. the teacher has just given the last outstanding mark on it. That
 *     attempt was, by definition, counted in the assignment's To Mark until
 *     that save, so the count was above zero and this teacher lowered it.
 *  2. The assignment page calls useMarkingMilestone(assignmentId, toMark)
 *     with the count it already fetches for its header. The first time it
 *     sees a loaded count, it takes the note for that assignment:
 *       - count is 0 and there was a note  -> the milestone: returns true.
 *       - count is above 0                 -> the note is dropped. The
 *         teacher's save did not finish the assignment, and a later zero
 *         might not be their doing; the next finalising save writes a fresh
 *         note.
 *     Either way the note is consumed, so a refresh never replays it.
 *
 * sessionStorage rather than localStorage or a module variable: it is
 * scoped to this tab and gone when the tab closes, which is what "this
 * session" means -- nothing lingers on a shared staff-room computer for the
 * next person -- and unlike a module variable it survives a refresh between
 * the save and the look. What is stored is a list of assignment ids, no
 * names and no marks.
 *
 * Known limit, accepted: sessionStorage is per tab, so marks saved in a
 * second tab (a middle-clicked "Mark Answers") are not seen by the first.
 * The teacher gets no spark in that case; nothing else changes.
 */
const STORAGE_KEY = "se_marking_finalised";

function readNotes(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    // Storage blocked (private browsing) or the value was tampered with.
    // The milestone is a flourish, never a function: carry on without it.
    return [];
  }
}

function writeNotes(ids: string[]): void {
  try {
    if (ids.length === 0) window.sessionStorage.removeItem(STORAGE_KEY);
    else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Same reasoning as readNotes.
  }
}

/** Call when this teacher's save has just finalised a pending attempt. */
export function recordAttemptFinalised(assignmentId: string): void {
  if (typeof window === "undefined" || !assignmentId) return;
  const ids = readNotes();
  if (!ids.includes(assignmentId)) writeNotes([...ids, assignmentId]);
}

/** Reads and removes the note for one assignment. */
function takeNote(assignmentId: string): boolean {
  const ids = readNotes();
  if (!ids.includes(assignmentId)) return false;
  writeNotes(ids.filter((id) => id !== assignmentId));
  return true;
}

/**
 * True once -- for the rest of this visit to the page -- when `toMark` is
 * found at zero and this teacher finalised an attempt on the assignment
 * earlier in the session. Pass `toMark` as null/undefined until the count
 * has loaded; nothing is decided, and no note consumed, before then.
 */
export function useMarkingMilestone(assignmentId: string, toMark: number | null | undefined): boolean {
  // Keyed by assignment, so moving straight from one assignment's page to
  // another's can never carry the first one's milestone across.
  const [achievedFor, setAchievedFor] = useState<string | null>(null);

  useEffect(() => {
    if (toMark === null || toMark === undefined) return;
    const finalisedHere = takeNote(assignmentId);
    if (finalisedHere && toMark === 0) setAchievedFor(assignmentId);
  }, [assignmentId, toMark]);

  return achievedFor === assignmentId;
}
