"""Set every existing set's evaluation_mode from the questions in it (#268).

Until 25 Nov 2026 `generate_activities_for_chapter` hardcoded "AUTO" for
every set it made, so "Measurement — Mastery E" -- twenty Constructed
Response questions, every one marked by a teacher -- reported itself as
automatically marked. The generator is fixed, but a fix to the generator
does nothing for the 750 sets already in the database, which is what this
is for.

Nothing reads the field today, so this changes no behaviour. It is run so
that the first thing that does read it reads the truth.

Usage, from backend/ with the production DATABASE_URL set:

    python scripts/backfill_evaluation_mode.py --report     # change nothing
    python scripts/backfill_evaluation_mode.py --apply

--report is the default and prints what --apply would do, so it is always
safe to run first.
"""
import argparse
import sys
from collections import Counter

sys.path.insert(0, ".")

from app.database import SessionLocal
from app.models import LearningActivity, LearningActivityQuestion, Question
from app.services.learning_service import evaluation_mode_for


def plan(db, *, apply: bool = False) -> tuple[Counter, list[str], int]:
    """What would change, and (with apply) change it.

    Separate from main() so the suite can drive it against a real world
    rather than only parsing the file -- this writes to production, so
    "it parses" is not enough of a check.
    """
    activities = db.query(LearningActivity).all()
    questions_by_activity: dict[str, list[Question]] = {}
    rows = (
        db.query(LearningActivityQuestion.learning_activity_id, Question)
        .join(Question, Question.id == LearningActivityQuestion.question_id)
        .all()
    )
    for activity_id, question in rows:
        questions_by_activity.setdefault(activity_id, []).append(question)

    changes: Counter = Counter()
    examples: list[str] = []
    for activity in activities:
        questions = questions_by_activity.get(activity.id) or []
        if not questions:
            continue  # an empty set says nothing about how it is marked
        correct = evaluation_mode_for(questions)
        if correct == activity.evaluation_mode:
            continue
        changes[f"{activity.evaluation_mode} -> {correct}"] += 1
        if len(examples) < 10:
            examples.append(
                f"  {activity.title}: {activity.evaluation_mode} -> {correct} ({len(questions)} questions)"
            )
        if apply:
            activity.evaluation_mode = correct
    if apply:
        db.commit()
    return changes, examples, len(activities)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the changes (default: report only)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        changes, examples, looked_at = plan(db, apply=args.apply)
        print(f"Sets looked at: {looked_at}")
        if not changes:
            print("Nothing to change: every set already reports how it is marked.")
            return 0
        for change, count in sorted(changes.items()):
            print(f"  {change}: {count}")
        print("\nFirst few:")
        print("\n".join(examples))
        if args.apply:
            print(f"\nApplied to {sum(changes.values())} sets.")
        else:
            print(f"\nReport only -- nothing was written. Re-run with --apply to change {sum(changes.values())} sets.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
