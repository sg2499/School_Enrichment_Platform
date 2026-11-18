"""Approves and publishes the loaded Maths courses in one go (#234, 18 Nov 2026).

For each chapter of ICSE Class 5, CBSE Class 7 and ICSE Class 7 (CBSE Class 5
is already live and is only reported):

  1. flags repeated questions (kept in the bank, left out of sets);
  2. runs the quality checks again on every question not yet approved;
  3. approves each question the quality gate allows (a FLAGGED question is
     never approved by this script; a repeat stays a draft);
  4. sends the chapter to review and publishes it when every skill has an
     approved question, publishes its skills, makes the practice sets
     (ICSE-style L..-D..A-E codes by day, CBSE per skill) and publishes each
     set whose questions are all approved.

This is exactly what "Approve and publish" does in Curriculum Studio, for all
chapters at once, plus the repeat flag. Approving here is the platform's own
check, not a reviewer's sign-off: Ashalatha's review of the ICSE and Class 7
content runs from 1 December 2026.

Nothing is written unless --apply is given, and --apply asks for YES. Without
it the script only reads and prints what it would do. Safe to run again.

Usage (from backend/, DATABASE_URL and ENVIRONMENT as for the other scripts):
    python scripts/publish_courses.py
    python scripts/publish_courses.py --apply
    python scripts/publish_courses.py --board CISCE --class-level 7 --apply
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import func

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# (board code, class code). CBSE Class 5 is live already; --include-cbse5 adds it.
COURSES = [("CISCE", "5"), ("CBSE", "7"), ("CISCE", "7")]
SCREEN_NAME = {"CISCE": "ICSE", "CBSE": "CBSE"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--board", default=None, help="Only this board, CBSE or CISCE (shown as ICSE).")
    parser.add_argument("--class-level", default=None, help="Only this class, 5 or 7.")
    parser.add_argument("--include-cbse5", action="store_true", help="Also run CBSE Class 5 (already live).")
    parser.add_argument("--min-set-size", type=int, default=10,
                        help="A practice set with fewer questions than this (after repeats are left out) is kept as a "
                             "draft, not published. Default 10; 0 publishes every set.")
    parser.add_argument("--apply", action="store_true", help="Write the changes.")
    parser.add_argument("--yes", action="store_true", help="Skip the YES prompt.")
    args = parser.parse_args()

    from app.api import routes_curriculum_admin as admin
    from app.database import SessionLocal, engine
    from app.models import (
        Board,
        BoardCourse,
        Chapter,
        ClassLevel,
        ConceptLesson,
        LearningActivity,
        LearningActivityQuestion,
        Question,
    )
    from app.services import repeat_service
    from app.services.audit_service import log_audit_event
    from app.services.question_quality_service import run_quality_checks
    from scripts.apply_answer_units import mask_database_url

    print(f"Target database: {mask_database_url(str(engine.url))}")
    if "sqlite" in str(engine.url):
        print("WARNING: DATABASE_URL is not set (or points at SQLite) -- this is not production.")
    wanted = list(COURSES) + ([("CBSE", "5")] if args.include_cbse5 else [])
    if args.board:
        wanted = [c for c in wanted if c[0] == args.board.upper()]
    if args.class_level:
        wanted = [c for c in wanted if c[1] == args.class_level]
    if not wanted:
        print("Nothing matches that board and class.")
        return 1

    db = SessionLocal()
    actor = SimpleNamespace(id=None)  # a script run: the audit rows carry no user
    try:
        plan = []
        for board_code, class_code in wanted:
            chapters = (
                db.query(Chapter).join(BoardCourse, Chapter.board_course_id == BoardCourse.id)
                .join(Board, BoardCourse.board_id == Board.id).join(ClassLevel, BoardCourse.class_level_id == ClassLevel.id)
                .filter(Board.code == board_code, ClassLevel.code == class_code, Chapter.status != "ARCHIVED")
                .order_by(Chapter.chapter_no).all()
            )
            plan.append((board_code, class_code, chapters))
        total = sum(len(c) for _b, _c, c in plan)
        if total == 0:
            print("No chapters found for those courses. Has the content been loaded?")
            return 1
        print(f"{'WILL WRITE' if args.apply else 'READ ONLY (add --apply to write)'}: {total} chapters\n")
        if args.apply and not args.yes:
            if input("Approve and publish these chapters now? Type YES: ").strip() != "YES":
                print("Cancelled; nothing written.")
                return 1

        grand = Counter()
        held_all = []
        for board_code, class_code, chapters in plan:
            print(f"=== {SCREEN_NAME.get(board_code, board_code)} Class {class_code} ({len(chapters)} chapters) ===")
            for chapter in chapters:
                lessons = db.query(ConceptLesson).filter(ConceptLesson.chapter_id == chapter.id).all()
                questions = (
                    db.query(Question).filter(Question.concept_lesson_id.in_([l.id for l in lessons]), Question.origin == "BANK")
                    .order_by(Question.code).all() if lessons else []
                )
                repeats = repeat_service.process_chapter(db, chapter, apply=args.apply)
                line = {"chapter": chapter, "questions": len(questions), "repeats": repeats.repeats}
                if args.apply:
                    db.flush()
                    pending = [q for q in questions if q.status not in ("APPROVED", "PUBLISHED")]
                    for lesson in lessons:
                        batch = [q for q in pending if q.concept_lesson_id == lesson.id]
                        if batch:
                            admin._persist_quality_results(db, batch)
                    approval = admin._bulk_approve_questions(
                        db, questions, True, user=actor, request=None,
                        scope={"chapterIds": [chapter.id], "via": "publish_courses.py"})
                    blocker = admin._chapter_publish_blocker(db, chapter)
                    if chapter.status == "DRAFT":
                        chapter.status = "REVIEW"
                    n_lessons = n_sets = 0
                    if not blocker:
                        chapter.status = "PUBLISHED"
                        n_lessons, n_sets = admin._release_chapter_content(db, chapter, actor)
                    elif chapter.status == "PUBLISHED":
                        n_lessons, n_sets = admin._release_chapter_content(db, chapter, actor)
                    small = 0
                    db.flush()  # the session has autoflush off: without this the sets published a moment ago are still DRAFT in the database
                    if args.min_set_size > 0:
                        counts = dict(
                            db.query(LearningActivityQuestion.learning_activity_id, func.count(LearningActivityQuestion.id))
                            .group_by(LearningActivityQuestion.learning_activity_id).all()
                        )
                        for activity in db.query(LearningActivity).filter(
                            LearningActivity.chapter_id == chapter.id, LearningActivity.status == "PUBLISHED"
                        ).all():
                            if counts.get(activity.id, 0) < args.min_set_size:
                                activity.status = "DRAFT"
                                small += 1
                    db.commit()
                    grand["small sets kept as drafts"] += small
                    line.update(approved=approval["approvedCount"], flagged=approval["skippedFlaggedCount"],
                                status=chapter.status, sets=n_sets - small, held=blocker["message"] if blocker else None)
                else:
                    found = repeat_service.find_repeats(questions)
                    todo = [q for q in questions if q.status not in ("APPROVED", "PUBLISHED") and q.id not in found]
                    results = run_quality_checks(todo)
                    would = sum(1 for q in todo if results[q.id].status != "FLAGGED")
                    flagged = len(todo) - would
                    line.update(approved=would, flagged=flagged, status=chapter.status, sets=None, held=None)
                for key in ("questions", "repeats", "approved", "flagged"):
                    grand[key] += line.get(key) or 0
                if line.get("held"):
                    held_all.append((chapter.code, line["held"]))
                sets = "" if line["sets"] is None else f"  sets published {line['sets']}"
                print(f"  {chapter.code:<34} {line['questions']:>5} q  repeats {line['repeats']:>4}  "
                      f"{'approved' if args.apply else 'would approve'} {line['approved']:>5}  flagged {line['flagged']:>4}  {line['status']}{sets}")
        if args.apply:
            log_audit_event(db, "curriculum.courses.published_by_script", details={"chapters": total, **grand})
            db.commit()
            published = db.query(LearningActivity).filter(LearningActivity.status == "PUBLISHED").count()
            print(f"\nPublished practice sets in the database now: {published}")
        else:
            db.rollback()
        print(f"\nTotals: {grand['questions']} questions, {grand['repeats']} repeats kept as drafts, "
              f"{grand['approved']} {'approved' if args.apply else 'to approve'}, {grand['flagged']} flagged for a person.")
        if grand["small sets kept as drafts"]:
            print(f"{grand['small sets kept as drafts']} practice sets with fewer than {args.min_set_size} questions were kept as drafts.")
        for code, why in held_all:
            print(f"HELD {code}: {why}")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
