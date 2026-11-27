"""What A-011's rule has actually done, and what still needs a person (#251).

Two parts of Shailesh's 23 Nov decision say "report it to me" rather than
"fix it automatically", and this is that report. It is READ-ONLY: it writes
nothing, so it is safe to run against production at any time.

  * Part 3 -- attempts already submitted and marked keep their marks and are
    reported rather than silently re-marked. A question sent back after a
    child was marked against it means somebody has to decide, case by case,
    whether that mark stands.
  * Part 4 -- a question the quality checker FLAGGED is never taken out from
    under a child, because the checker has false positives. Those are listed
    here instead, so they can be looked at by a person.

Usage, from backend/ with DATABASE_URL set to production:

    python scripts/report_withdrawn_questions.py
"""
import sys

sys.path.insert(0, ".")

from sqlalchemy import case, func

from app.database import SessionLocal
from app.models import (
    Assignment,
    AssignmentTarget,
    Attempt,
    AttemptAnswer,
    LearningActivity,
    LearningActivityQuestion,
    Question,
    Student,
    User,
)
from app.services.learning_service import MIN_SET_SIZE, withdrawn_question_clause


def main() -> int:
    db = SessionLocal()
    try:
        # The shared rule, not the status alone: a question sent back and then
        # moved on to Draft carries the stamp and no longer the status, and
        # this report is the only list of what the filter hides (#261).
        withdrawn = db.query(Question).filter(withdrawn_question_clause()).all()
        print(f"Questions sent back for rework: {len(withdrawn)}")

        # --- part 1's fallback: sets held because they fell under the floor
        #
        # ONE grouped query, not one per set. This loop used to run a query
        # for every published set on production -- about 2,504 of them -- and
        # #261's change made it two each, which from a laptop against the
        # Singapore database reads as a hung script. Found by running it on
        # production 26 Nov 2026, not by the tests, because the only data it
        # had ever been run against held two sets.
        pulled_count = func.count(
            case((withdrawn_question_clause(), LearningActivityQuestion.id), else_=None)
        )
        total_count = func.count(LearningActivityQuestion.id)
        held = [
            (title, total, total - pulled)
            for title, total, pulled in (
                db.query(LearningActivity.title, total_count, pulled_count)
                .join(
                    LearningActivityQuestion,
                    LearningActivityQuestion.learning_activity_id == LearningActivity.id,
                )
                .join(Question, Question.id == LearningActivityQuestion.question_id)
                .filter(LearningActivity.status == "PUBLISHED")
                .group_by(LearningActivity.id, LearningActivity.title)
                .having(pulled_count > 0)
                .having(total_count - pulled_count < MIN_SET_SIZE)
                .all()
            )
        ]
        print(f"\nSets held because withdrawing left them under {MIN_SET_SIZE}: {len(held)}")
        for title, total, remaining in held[:20]:
            print(f"  {title}: {remaining} of {total} questions left")

        # --- part 3: children already marked against a question since sent back
        if withdrawn:
            affected = (
                db.query(Student, User, Question, Attempt)
                .join(AttemptAnswer, AttemptAnswer.question_id == Question.id)
                .join(Attempt, Attempt.id == AttemptAnswer.attempt_id)
                .join(AssignmentTarget, AssignmentTarget.id == Attempt.assignment_target_id)
                .join(Student, Student.id == AssignmentTarget.student_id)
                .join(User, User.id == Student.user_id)
                .filter(
                    Question.id.in_([q.id for q in withdrawn]),
                    Attempt.status.in_(("SUBMITTED", "EVALUATED")),
                    AttemptAnswer.auto_score.isnot(None),
                )
                .all()
            )
        else:
            affected = []
        print(f"\nMarks already given against a question since sent back: {len(affected)}")
        print("  (these are NOT changed -- each is a decision for a person)")
        for student, user, question, attempt in affected[:30]:
            print(f"  {user.full_name} ({student.student_code}) · {question.code} · attempt {attempt.attempt_number}")

        # --- part 4: flagged questions in live sets, surfaced not removed
        flagged = (
            db.query(Question, LearningActivity)
            .join(LearningActivityQuestion, LearningActivityQuestion.question_id == Question.id)
            .join(LearningActivity, LearningActivity.id == LearningActivityQuestion.learning_activity_id)
            .filter(Question.quality_status == "FLAGGED", LearningActivity.status == "PUBLISHED")
            .all()
        )
        print(f"\nFlagged questions in published sets: {len(flagged)}")
        print("  (left in place on purpose -- the checker has false positives)")
        for question, activity in flagged[:30]:
            print(f"  {question.code} in {activity.title}")

        # --- is any of this in front of children right now?
        #
        # Printed even when it is zero. This line used to sit inside the `if`,
        # so a clean run ended on the flagged count with nothing after it --
        # which reads as a script that died, not one that found nothing
        # (27 Nov 2026).
        if withdrawn:
            live = (
                db.query(Assignment)
                .join(LearningActivity, LearningActivity.id == Assignment.learning_activity_id)
                .join(LearningActivityQuestion, LearningActivityQuestion.learning_activity_id == LearningActivity.id)
                .filter(
                    LearningActivityQuestion.question_id.in_([q.id for q in withdrawn]),
                    Assignment.status != "CANCELLED",
                )
                .distinct()
                .count()
            )
        else:
            live = 0  # nothing is withdrawn, so nothing can be holding one
        print(f"\nLive assignments holding a withdrawn question: {live}")

        print("\nReport complete. Nothing was written -- this script only reads.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
