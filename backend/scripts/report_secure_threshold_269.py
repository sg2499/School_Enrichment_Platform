"""#269 for Ashalatha: is 70% a floor a child must REACH, or a rounded figure?

READ-ONLY. This script never writes.

    python scripts/report_secure_threshold_269.py

Replaces `A269_threshold_impact.sql`. That packet needed psql, which needs
the external database URL and an IP allowlist entry -- a route the tools
available here cannot take, so it was never runnable in practice.

THE QUESTION

`foundation_repair_service.compute_concept_mastery` works a child's mastery
out per skill as sum(final_score)/sum(max_score) over their CORE_PRACTICE
evaluations, ROUNDS IT TO ONE DECIMAL, and then:

    if current_score is None or current_score >= 70:   -> no rescue practice

So a child truly at 69.96% rounds to 70.0 and is treated as secure: no rescue
work is recommended. If 70% means "at least 70", that child should have had
rescue practice and did not.

The number also lives in a SECOND place: `prerequisite_links.minimum_mastery`
overrides the 70 per link (`threshold = link.minimum_mastery or 70`).
Whatever she decides has to hold for those too.

MOST OF THE ANSWER IS ARITHMETIC, NOT DATA

Every score column is an `Integer`. So the rounding can only hide a sub-70
child if some WHOLE number of marks lands in [0.6995 x total, 0.70 x total).
At the totals a child could plausibly reach in one skill -- 20, 30, 40, 60,
80, 100, 120, 200, 300, 600 -- no such integer exists. The smallest total
that admits one at all is **203** (142 of 203 = 69.9507%, shown as 70.0%).

A correction to an earlier, wrong version of this note: it said "at EVERY
round total it cannot, because 0.70 x total is itself whole and leaves no
room beneath it". That is false from **2,000** marks up, where 0.6995 x total
is ALSO whole and the interval is a full mark wide (1,399 of 2,000 = 69.95%,
shown as 70.0%). It happens to hold for every total tested here, which is why
the overreach went unnoticed. Children have reached 9, 18 and 27 marks.

So this reports the totals children have ACTUALLY reached per skill, and
whether any of them could hide anyone. If none can, she can answer on
principle and nothing that has already happened changes.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import func

from app.database import SessionLocal
from app.models import (
    Assignment,
    AssignmentTarget,
    Attempt,
    Chapter,
    ConceptLesson,
    Evaluation,
    LearningActivity,
    Student,
)
from app.services.foundation_repair_service import DEFAULT_SECURE_THRESHOLD_PERCENT

# Read from the service, not retyped: if the threshold ever changes, this
# report follows it instead of quietly reporting against a stale 70.
THRESHOLD = DEFAULT_SECURE_THRESHOLD_PERCENT


def _rule(title: str) -> None:
    print()
    print(title)
    print("-" * len(title))


def _could_hide(total: int) -> bool:
    """Is there a whole number of marks strictly inside [0.6995p, 0.70p)?"""
    if total <= 0:
        return False
    return math.ceil(0.6995 * total) < 0.70 * total


def report(db) -> int:
    print(f"The threshold in code: DEFAULT_SECURE_THRESHOLD_PERCENT = {THRESHOLD}")
    print("Mastery is rounded to one decimal before the comparison.")

    # The service's own joins and filters, including no attempt-status filter:
    # its docstring says "EVALUATED attempts" but the query does not filter on
    # it, and what children get is the query. concept_lesson_id is nullable
    # and the service only ever matches a specific id, so NULL never matches.
    per_skill = (
        db.query(
            AssignmentTarget.student_id.label("student_id"),
            LearningActivity.concept_lesson_id.label("lesson_id"),
            func.sum(Evaluation.final_score).label("earned"),
            func.sum(Evaluation.max_score).label("possible"),
        )
        .join(Attempt, Attempt.id == Evaluation.attempt_id)
        .join(AssignmentTarget, AssignmentTarget.id == Attempt.assignment_target_id)
        .join(Assignment, Assignment.id == AssignmentTarget.assignment_id)
        .join(LearningActivity, LearningActivity.id == Assignment.learning_activity_id)
        .filter(LearningActivity.activity_type == "CORE_PRACTICE")
        .filter(Evaluation.max_score > 0)
        .filter(LearningActivity.concept_lesson_id.isnot(None))
        .group_by(AssignmentTarget.student_id, LearningActivity.concept_lesson_id)
        .all()
    )

    _rule("1. How many children does the answer actually move?")
    if not per_skill:
        print("  No CORE_PRACTICE evaluations on record at all.")
        print("  -> Nothing that has already happened depends on the answer, so")
        print("     Ashalatha can decide this on principle alone.")
    else:
        moved = []
        secure_today = 0
        rescued_today = 0
        for row in per_skill:
            possible = int(row.possible or 0)
            if possible <= 0:
                continue
            exact = 100.0 * float(row.earned or 0) / possible
            shown = round(exact, 1)
            if shown >= THRESHOLD:
                secure_today += 1
            else:
                rescued_today += 1
            if exact < THRESHOLD <= shown:
                moved.append((row, exact, shown, possible))
        print(f"  skill results:              {len(per_skill)}")
        print(f"  at or above the threshold:  {secure_today}")
        # Deliberately not "given rescue work": this only measures who is
        # below 70. Whether rescue practice was actually recommended depends
        # on `_find_rescue_activity` finding a set, which is a separate thing.
        print(f"  below the threshold:        {rescued_today}")
        print(f"  CHILDREN THE ANSWER MOVES:  {len(moved)}")
        if not moved:
            print("  -> Nobody. Every child is on the same side of the line either way,")
            print("     so the answer changes nothing that has already happened.")
        for row, exact, shown, possible in moved[:25]:
            student = db.get(Student, row.student_id)
            lesson = db.get(ConceptLesson, row.lesson_id)
            code = getattr(student, "student_code", row.student_id)
            print(
                f"    {code} | {getattr(lesson, 'title', '?')} | "
                f"{row.earned} of {possible} | {exact:.4f}% shown as {shown}%"
            )

    _rule("2. Can the rounding hide anyone, at the totals children have reached?")
    print("   A child is hidden only if a WHOLE number of marks lands in")
    print("   [0.6995 x total, 0.70 x total). That is impossible at every total")
    print("   below about 200, and the smallest that admits a case is 203.")
    print("   NOT a general rule about round totals: from 2,000 marks up they")
    print("   can hide a child too (1,399 of 2,000 = 69.95%, shown as 70.0%).")
    totals: dict[int, int] = {}
    for row in per_skill:
        possible = int(row.possible or 0)
        if possible > 0:
            totals[possible] = totals.get(possible, 0) + 1
    if not totals:
        print("   (no totals on record yet)")
    for total in sorted(totals):
        flag = "COULD HIDE SOMEONE" if _could_hide(total) else "cannot hide anyone"
        print(f"   {total:5d} marks | {totals[total]:4d} children | {flag}")

    print()
    print("   For reference -- note 2000, which disproves the tidy version of")
    print("   this rule:")
    for total in (20, 30, 40, 60, 80, 100, 120, 200, 203, 300, 600, 1000, 2000):
        mark = math.ceil(0.6995 * total)
        if _could_hide(total):
            print(f"     {total:4d} -> {mark} marks = {100.0*mark/total:.4f}%, shown as "
                  f"{round(100.0*mark/total,1)}%  COULD HIDE")
        else:
            print(f"     {total:4d} -> no whole number of marks fits")

    _rule("3. The other place the number lives: per-link overrides")
    print("   `threshold = link.minimum_mastery or 70`, so whatever she decides")
    print("   must hold for these too.")
    try:
        from app.models import PrerequisiteLink

        rows = (
            db.query(PrerequisiteLink.minimum_mastery, func.count(PrerequisiteLink.id))
            .group_by(PrerequisiteLink.minimum_mastery)
            .order_by(func.count(PrerequisiteLink.id).desc())
            .all()
        )
        if not rows:
            print("   no prerequisite links at all")
        for value, count in rows:
            label = "not set -- uses 70" if value is None else str(value)
            print(f"   minimum_mastery {label}: {count} links")

        # Which courses the links actually exist for. The whole Foundation
        # Repair feature is per-lesson -- compute_concept_mastery,
        # _find_rescue_activity and the links themselves all match a specific
        # concept_lesson_id -- while the ICSE Class 5 and Class 7 content is
        # built as chapter-scoped day sets (L01-D1A..D5E) whose
        # concept_lesson_id is deliberately NULL (learning_service
        # _DAY_SETS, chapter_scoped=True, #234). So this says whether the
        # feature was never configured for those courses, or configured and
        # inert.
        print()
        print("   Which courses have links at all (the feature is per-lesson,")
        print("   and the day-set courses have no per-lesson sets):")
        by_course = (
            db.query(
                Chapter.board_course_id,
                func.count(func.distinct(PrerequisiteLink.id)),
            )
            .join(ConceptLesson, ConceptLesson.id == PrerequisiteLink.concept_lesson_id)
            .join(Chapter, Chapter.id == ConceptLesson.chapter_id)
            .group_by(Chapter.board_course_id)
            .all()
        )
        if not by_course:
            print("   (none)")
        for course_id, count in by_course:
            print(f"     board_course {course_id}: {count} links")
    except Exception as exc:  # noqa: BLE001
        print(f"   could not read prerequisite_links: {exc}")

    _rule("4. Sets with no lesson id, which the threshold never reaches")
    print("   compute_concept_mastery matches a SPECIFIC lesson id and the column")
    print("   is nullable, so a NULL set decides nothing. If any carry children's")
    print("   CORE_PRACTICE work, that is its own finding, separate from #269.")
    orphan_sets = (
        db.query(
            LearningActivity.activity_type,
            LearningActivity.status,
            func.count(func.distinct(LearningActivity.id)),
        )
        .filter(LearningActivity.concept_lesson_id.is_(None))
        .group_by(LearningActivity.activity_type, LearningActivity.status)
        .all()
    )
    if not orphan_sets:
        print("   none -- every set has a lesson id.")
    for activity_type, status, count in orphan_sets:
        evals = (
            db.query(func.count(Evaluation.id))
            .join(Attempt, Attempt.id == Evaluation.attempt_id)
            .join(AssignmentTarget, AssignmentTarget.id == Attempt.assignment_target_id)
            .join(Assignment, Assignment.id == AssignmentTarget.assignment_id)
            .join(LearningActivity, LearningActivity.id == Assignment.learning_activity_id)
            .filter(LearningActivity.concept_lesson_id.is_(None))
            .filter(LearningActivity.activity_type == activity_type)
            .filter(LearningActivity.status == status)
            .scalar()
            or 0
        )
        # Only CORE_PRACTICE is read by compute_concept_mastery. An evaluation
        # on a FLUENCY or APPLICATION set is not "lost to mastery", because
        # mastery never reads those on ANY board. Flagging them was alarmist.
        mark = ""
        if evals and activity_type == "CORE_PRACTICE":
            mark = "  <-- CORE_PRACTICE work that mastery cannot see"
        elif evals:
            mark = "  (mastery never reads this type, on any board)"
        print(f"   {activity_type} / {status}: {count} sets, {evals} evaluations{mark}")

    print()
    print("Read-only: nothing was written.")
    return 0


def main() -> int:
    db = SessionLocal()
    try:
        return report(db)
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
