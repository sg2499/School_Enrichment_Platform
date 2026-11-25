"""Report unapproved questions that are ALREADY inside published sets.

READ-ONLY. This script never writes. It opens a session, runs counts, and
prints them.

    python scripts/report_unapproved_in_published_sets.py

WHY THIS EXISTS

#261 (shipped 25 Nov 2026, `666e77f`) stops a set being published from now on
while any of its questions is unapproved. It does NOT clean up what the old
hole already let through.

Curriculum Studio on production, read 25 Nov 2026 19:30 IST, shows the scale
of the raw material: 28,431 of 33,259 questions approved, so **4,828 not
approved**, and PUBLISHED chapters carry them -- CISCE Class 5 Data Handling
390 of 500, CBSE Class 7 Connecting the Dots 343 of 500, CISCE Class 7 Data
Handling and Probability 353 of 500, and chapters reading "500 of 760" or
"500 of 848" where approval stopped at 500.

But an unapproved question sitting in a published CHAPTER is not by itself a
child-facing problem. What matters is whether it is linked into a published
SET (a `LearningActivity`), because a set is what a child is served. Two
fixes already stand in the way:

  * A-001 (`cd08b4a`) made `top_up_activity` filter on
    READY_QUESTION_STATUSES when the set is PUBLISHED, so a new top-up
    cannot pull an unapproved question in.
  * A-011 (`61f0c02`) made `servable_questions` hold back a question that a
    human sent for rework (SME_REVIEW) at serve time.

So the open question is what was linked BEFORE those landed, and whether any
of it reaches a child. Section 1 uses exactly the rule the #261 gate uses, so
its figure is the number of published sets that gate would now refuse.
"""

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
    LearningActivity,
    LearningActivityQuestion,
    Question,
)
from app.services import learning_service

READY = tuple(sorted(learning_service.READY_QUESTION_STATUSES))


def _rule(title: str) -> None:
    print()
    print(title)
    print("-" * len(title))


def main() -> int:
    db = SessionLocal()
    try:
        print(f"Approved-for-release statuses (the #261 gate's own rule): {', '.join(READY)}")

        # --- 1. The figure that matters -------------------------------------
        _rule("1. Published sets holding questions that are not approved")
        linked = (
            db.query(
                LearningActivity.id.label("activity_id"),
                Question.status.label("question_status"),
            )
            .join(
                LearningActivityQuestion,
                LearningActivityQuestion.learning_activity_id == LearningActivity.id,
            )
            .join(Question, Question.id == LearningActivityQuestion.question_id)
            .filter(LearningActivity.status == "PUBLISHED")
            .subquery()
        )
        total_sets = db.query(func.count(func.distinct(linked.c.activity_id))).scalar() or 0
        bad_sets = (
            db.query(func.count(func.distinct(linked.c.activity_id)))
            .filter(linked.c.question_status.notin_(READY))
            .scalar()
            or 0
        )
        bad_links = (
            db.query(func.count())
            .select_from(linked)
            .filter(linked.c.question_status.notin_(READY))
            .scalar()
            or 0
        )
        print(f"  published sets in all:                  {total_sets}")
        print(f"  of those, holding unapproved questions: {bad_sets}")
        print(f"  unapproved question links in them:      {bad_links}")
        if bad_sets == 0:
            print("  -> Nothing already published is affected. The gate closed the door")
            print("     before anything came through it.")

        # --- 2. Which statuses --------------------------------------------
        _rule("2. Which status those questions are actually in")
        print("   SME_REVIEW is already held back at serve time by A-011. A DRAFT is not.")
        rows = (
            db.query(
                Question.status,
                func.count(LearningActivityQuestion.id),
                func.count(func.distinct(LearningActivity.id)),
            )
            .join(
                LearningActivityQuestion,
                LearningActivityQuestion.question_id == Question.id,
            )
            .join(
                LearningActivity,
                LearningActivity.id == LearningActivityQuestion.learning_activity_id,
            )
            .filter(LearningActivity.status == "PUBLISHED")
            .filter(Question.status.notin_(READY))
            .group_by(Question.status)
            .order_by(func.count(LearningActivityQuestion.id).desc())
            .all()
        )
        if not rows:
            print("  (none)")
        for status, links, sets_ in rows:
            held = " -- held back at serve time by A-011" if status in learning_service.WITHDRAWN_QUESTION_STATUSES else ""
            print(f"  {status}: {links} links across {sets_} published sets{held}")

        # --- 3. Does it reach a child? ------------------------------------
        _rule("3. Is any of it reaching a child?")
        print("   A set only matters if it is assigned.")
        affected = (
            db.query(LearningActivity.id)
            .join(
                LearningActivityQuestion,
                LearningActivityQuestion.learning_activity_id == LearningActivity.id,
            )
            .join(Question, Question.id == LearningActivityQuestion.question_id)
            .filter(LearningActivity.status == "PUBLISHED")
            .filter(Question.status.notin_(READY))
            .distinct()
            .subquery()
        )
        reach = (
            db.query(
                func.count(func.distinct(Assignment.id)),
                func.count(func.distinct(AssignmentTarget.student_id)),
                func.count(func.distinct(Attempt.id)),
            )
            .select_from(affected)
            .join(Assignment, Assignment.learning_activity_id == affected.c.id)
            .outerjoin(AssignmentTarget, AssignmentTarget.assignment_id == Assignment.id)
            .outerjoin(Attempt, Attempt.assignment_target_id == AssignmentTarget.id)
            .one()
        )
        print(f"  assignments on affected sets: {reach[0]}")
        print(f"  students reached:             {reach[1]}")
        print(f"  attempts already made:        {reach[2]}")
        if reach[0] == 0:
            print("  -> Not assigned to anyone, so nothing is in front of a child.")

        # --- 4. Where to start --------------------------------------------
        _rule("4. The worst affected sets, so there is somewhere to start")
        unapproved_count = func.count(Question.id).filter(Question.status.notin_(READY))
        worst = (
            db.query(
                LearningActivity.id,
                LearningActivity.title,
                ConceptLesson.title,
                Chapter.title,
                unapproved_count.label("unapproved"),
                func.count(Question.id).label("in_set"),
            )
            .join(
                LearningActivityQuestion,
                LearningActivityQuestion.learning_activity_id == LearningActivity.id,
            )
            .join(Question, Question.id == LearningActivityQuestion.question_id)
            .outerjoin(ConceptLesson, ConceptLesson.id == LearningActivity.concept_lesson_id)
            .outerjoin(Chapter, Chapter.id == ConceptLesson.chapter_id)
            .filter(LearningActivity.status == "PUBLISHED")
            .group_by(LearningActivity.id, LearningActivity.title, ConceptLesson.title, Chapter.title)
            .having(unapproved_count > 0)
            .order_by(unapproved_count.desc())
            .limit(20)
            .all()
        )
        if not worst:
            print("  (none)")
        for activity_id, title, skill, chapter, unapproved, in_set in worst:
            print(f"  {unapproved:4d} of {in_set:3d} unapproved | {chapter or '?'} / {skill or '?'} | {title}")
            print(f"       {activity_id}")

        # --- 5. Reconcile the two totals ----------------------------------
        _rule("5. Reconciling two totals, so neither is quoted blindly")
        print("   strip_stray_names.py read 33,834 rows (every question).")
        print("   Curriculum Studio reported 33,259 'questions in all', 28,431 approved.")
        print("   That is a 575-row gap. These figures say where it is.")
        all_q = db.query(func.count(Question.id)).scalar() or 0
        ready_q = db.query(func.count(Question.id)).filter(Question.status.in_(READY)).scalar() or 0
        print(f"  questions table, all rows:   {all_q}")
        print(f"  approved or published:       {ready_q}")
        print(f"  not approved:                {all_q - ready_q}")
        print()
        print("  by chapter status x question status:")
        combos = (
            db.query(Chapter.status, Question.status, func.count(Question.id))
            .join(ConceptLesson, ConceptLesson.chapter_id == Chapter.id)
            .join(Question, Question.concept_lesson_id == ConceptLesson.id)
            .group_by(Chapter.status, Question.status)
            .order_by(func.count(Question.id).desc())
            .all()
        )
        for ch_status, q_status, count in combos:
            print(f"    chapter {ch_status or '?':10s} question {q_status or '?':12s} {count}")
        orphans = (
            db.query(func.count(Question.id))
            .outerjoin(ConceptLesson, ConceptLesson.id == Question.concept_lesson_id)
            .filter(ConceptLesson.id.is_(None))
            .scalar()
            or 0
        )
        print(f"  questions with no concept lesson at all: {orphans}")

        print()
        print("Read-only: nothing was written.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
