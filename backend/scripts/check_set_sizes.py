"""Lists live practice sets that are too small (#239 follow-up, 18 Nov 2026).

Read-only by default. For ICSE Class 5, CBSE Class 7 and ICSE Class 7 it counts,
for every PUBLISHED practice set, the questions really attached to it, and how
many of those are repeats or not approved. It also shows the question count the
set was made with (estimated minutes / 2) so the two can be compared.

    python scripts/check_set_sizes.py                  # report only
    python scripts/check_set_sizes.py --demote         # then asks YES, sets small ones back to DRAFT
    python scripts/check_set_sizes.py --min-set-size 10

Run from backend/ with ENVIRONMENT=development and DATABASE_URL set, as for
publish_courses.py. Nothing but the status of a too-small set is ever written.
"""
import argparse
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

COURSES = [("CISCE", "5"), ("CBSE", "7"), ("CISCE", "7")]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--min-set-size", type=int, default=10)
    parser.add_argument("--demote", action="store_true")
    args = parser.parse_args()

    from sqlalchemy import func

    from app.database import SessionLocal, engine
    from app.models import (Board, BoardCourse, Chapter, ClassLevel, LearningActivity,
                            LearningActivityQuestion, Question)
    from scripts.apply_answer_units import mask_database_url

    print(f"Target database: {mask_database_url(str(engine.url))}")
    if "sqlite" in str(engine.url):
        print("WARNING: DATABASE_URL is not set (or points at SQLite) -- this is not production.")
    db = SessionLocal()
    try:
        small_ids = []
        for board_code, class_code in COURSES:
            rows = (
                db.query(LearningActivity, Chapter.code)
                .join(Chapter, LearningActivity.chapter_id == Chapter.id)
                .join(BoardCourse, Chapter.board_course_id == BoardCourse.id)
                .join(Board, BoardCourse.board_id == Board.id)
                .join(ClassLevel, BoardCourse.class_level_id == ClassLevel.id)
                .filter(Board.code == board_code, ClassLevel.code == class_code,
                        LearningActivity.status == "PUBLISHED")
                .all()
            )
            ids = [a.id for a, _c in rows]
            stats = defaultdict(lambda: [0, 0, 0])  # rows, repeats, not approved
            for aid, repeat_of, status in (
                db.query(LearningActivityQuestion.learning_activity_id, Question.repeat_of_id, Question.status)
                .join(Question, LearningActivityQuestion.question_id == Question.id)
                .filter(LearningActivityQuestion.learning_activity_id.in_(ids)).all()
            ):
                s = stats[aid]
                s[0] += 1
                s[1] += 1 if repeat_of else 0
                s[2] += 0 if status in ("APPROVED", "PUBLISHED") else 1
            small = [(a, c) for a, c in rows if stats[a.id][0] < args.min_set_size]
            print(f"\n=== {board_code} Class {class_code}: {len(rows)} published sets, "
                  f"{len(small)} with fewer than {args.min_set_size} questions ===")
            print(f"  sets holding a repeat: {sum(1 for a,_c in rows if stats[a.id][1])}, "
                  f"holding a not-approved question: {sum(1 for a,_c in rows if stats[a.id][2])}")
            by_chapter = defaultdict(list)
            for a, c in small:
                by_chapter[c].append(a)
                small_ids.append(a.id)
            for code in sorted(by_chapter):
                parts = [f"{a.source_assignment_code or a.title[-12:]}:{stats[a.id][0]}"
                         f"(made {max(a.estimated_minutes // 2, 0)})" for a in by_chapter[code]][:8]
                print(f"  {code}: {len(by_chapter[code])} small  " + "  ".join(parts))
        print(f"\nTotal small published sets: {len(small_ids)}")
        if args.demote and small_ids:
            if input(f"Set these {len(small_ids)} sets back to DRAFT? Type YES: ").strip() != "YES":
                print("Cancelled; nothing written.")
                return 0
            db.query(LearningActivity).filter(LearningActivity.id.in_(small_ids)).update(
                {LearningActivity.status: "DRAFT"}, synchronize_session=False)
            db.commit()
            print(f"Done: {len(small_ids)} sets are drafts again.")
        else:
            db.rollback()
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
