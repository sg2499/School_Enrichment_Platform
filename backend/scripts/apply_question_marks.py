"""Makes two Chapter 1 written questions worth 2 marks, as Ashalatha decided.

Why this exists (26 Oct 2026). Her answers to the Krama questions (Q3):
CBSE-C5-CH01-Q089 and CBSE-C5-CH01-Q141 are Constructed Response questions
worth 1 mark, but each one's marking guidance gives two separate marks. She
chose to make both worth 2 marks, with this guidance:

  * Q089 (rounding 8,649): "1 mark for 8,600 and 1 mark for identifying the
    tens digit 4 or final two digits 49 as the deciding part."
  * Q141 (the square display): "1 mark for recognising that a corner belongs
    to two sides and 1 mark for explaining the resulting double count."

What it changes: Marks (1 to 2) and Teacher Note (the marking guidance a
teacher reads when marking) on those two questions, and nothing else.
Answers already given keep the marks they were out of: each answer keeps
its own max score from the day it was saved.

Why it is safe to run:

  * It checks both questions first: each exists, is still a Constructed
    Response question and still has the wording she reviewed. If either
    fails, it stops and changes nothing.
  * Without --apply it only reports what would change.
  * With --apply it writes in ONE transaction, with one audit-log entry
    ("curriculum.question_marks.applied") recording each question's old and
    new values.
  * It waits while any attempt in progress has an answer saved to either
    question: that answer was saved out of 1 mark, and submitting it after
    the change would count the question out of 2 (review). It says how
    many, so it can be run again once they are handed in.
  * Running it again is harmless: a question already as she decided is left
    alone.

Usage (from backend/, DATABASE_URL set to the production database):
    python scripts/apply_question_marks.py
    python scripts/apply_question_marks.py --apply
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

AUDIT_EVENT = "curriculum.question_marks.applied"
DECIDED_ON = "2026-10-26"


@dataclass(frozen=True)
class Decision:
    code: str
    stem: str  # the wording she reviewed
    marks: int
    teacher_note: str


DECISIONS = [
    Decision(
        code="CBSE-C5-CH01-Q089",
        stem="A student rounds 8,649 to 8,700. State the correct answer and explain which digit decides the rounding.",
        marks=2,
        teacher_note=(
            "1 mark for 8,600 and 1 mark for identifying the tens digit 4 or final two digits 49 "
            "as the deciding part."
        ),
    ),
    Decision(
        code="CBSE-C5-CH01-Q141",
        stem=(
            "Four sides of a square display are counted separately. Explain why adding all four side counts "
            "can overstate the number of distinct objects when objects are placed at the corners."
        ),
        marks=2,
        teacher_note=(
            "1 mark for recognising that a corner belongs to two sides and 1 mark for explaining the "
            "resulting double count."
        ),
    ),
]


class StopBeforeWriting(Exception):
    """Something that must stop the run before it changes anything."""


def make_plan(db, decisions=DECISIONS, *, lock: bool = False):
    """[(question, decision)] still to change, and how many are already set.
    Raises StopBeforeWriting if a question is missing or no longer what she
    reviewed."""
    from app.models import Question

    query = db.query(Question).filter(Question.code.in_([d.code for d in decisions]))
    if lock:
        query = query.with_for_update()
    by_code: dict[str, list] = {}
    for question in query.all():
        by_code.setdefault(question.code, []).append(question)
    problems, to_change, already = [], [], 0
    for decision in decisions:
        found = by_code.get(decision.code, [])
        if len(found) != 1:
            problems.append(f"{decision.code}: {'not in the database' if not found else 'found more than once'}.")
            continue
        question = found[0]
        if question.question_type != "Constructed Response":
            problems.append(f"{decision.code}: it is now {question.question_type}, not Constructed Response.")
        elif (question.stem or "").strip() != decision.stem:
            problems.append(f"{decision.code}: its wording has changed since she reviewed it.")
        elif question.marks == decision.marks and (question.teacher_note or "").strip() == decision.teacher_note:
            already += 1
        else:
            to_change.append((question, decision))
    if to_change:
        from app.models import Attempt, AttemptAnswer

        open_answers = (
            db.query(AttemptAnswer.id)
            .join(Attempt, Attempt.id == AttemptAnswer.attempt_id)
            .filter(Attempt.status == "IN_PROGRESS", AttemptAnswer.question_id.in_([q.id for q, _d in to_change]))
            .count()
        )
        if open_answers:
            problems.append(
                f"{open_answers} attempt(s) still in progress have an answer saved to one of these questions. "
                "Run this again once they are handed in."
            )
    if problems:
        raise StopBeforeWriting("\n".join(problems))
    return to_change, already


def apply_plan(db, to_change, already: int) -> None:
    from app.services.audit_service import log_audit_event

    changes = []
    for question, decision in to_change:
        changes.append(
            {
                "code": decision.code,
                "old": {"marks": question.marks, "teacherNote": question.teacher_note},
                "new": {"marks": decision.marks, "teacherNote": decision.teacher_note},
            }
        )
        question.marks = decision.marks
        question.teacher_note = decision.teacher_note
    log_audit_event(
        db,
        AUDIT_EVENT,
        details={"decidedBy": "Ashalatha Gupta", "decidedOn": DECIDED_ON, "questionsAlreadySet": already, "changes": changes},
    )
    db.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="Write the changes. Without it, only report.")
    parser.add_argument("--yes", action="store_true", help="With --apply, skip the typed confirmation.")
    args = parser.parse_args()

    from app.database import SessionLocal, engine
    from scripts.apply_answer_units import mask_database_url

    db_url = str(engine.url)
    print(f"Target database: {mask_database_url(db_url)}")
    if "sqlite" in db_url:
        print("NOTE: DATABASE_URL is not set (or points at SQLite), so this is not production.")

    db = SessionLocal()
    try:
        to_change, already = make_plan(db)
        print(f"Already as she decided: {already}")
        print(f"To change: {len(to_change)}")
        for question, decision in to_change:
            print(f"  {decision.code}: {question.marks} -> {decision.marks} marks; marking guidance replaced")
        if not args.apply:
            print("\nReport only: nothing was written. Run again with --apply to record these.")
            return 0
        if not to_change:
            print("\nNothing to change.")
            return 0
        if not args.yes and input(f"\nType YES to change {len(to_change)} questions: ").strip() != "YES":
            print("Stopped: nothing was written.")
            return 1
        db.rollback()
        to_change, already = make_plan(db, lock=True)
        apply_plan(db, to_change, already)
        print(f"\nDone: {len(to_change)} questions now worth 2 marks, with her marking guidance.")
        return 0
    except StopBeforeWriting as stop:
        print(f"\nStopped before writing anything:\n{stop}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
