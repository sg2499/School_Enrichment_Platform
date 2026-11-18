"""Flags repeated questions in the content already loaded (#234, 18 Nov 2026).

A repeat is a question whose wording, options and answer match an earlier
question in the same chapter (the first by code is kept). It stays in the
bank but is left out of practice sets and bulk approval; see
app/services/repeat_service.py. Class 7 has about 1,700 (CBSE) and 1,900
(ICSE); ICSE Class 5 has its own.

Reads by default. Nothing is written without --apply, and --apply asks for
YES. Safe to run again: it only sets or clears repeat_of_id, never changes a
status and never deletes a question.

Usage (from backend/, DATABASE_URL and ENVIRONMENT as for the other scripts):
    python scripts/flag_repeats.py
    python scripts/flag_repeats.py --board CISCE --class-level 7
    python scripts/flag_repeats.py --apply
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--board", default=None, help="Board code, CBSE or CISCE (shown as ICSE). Default: all.")
    parser.add_argument("--class-level", default=None, help="Class code, 5 or 7. Default: all.")
    parser.add_argument("--apply", action="store_true", help="Write the flags.")
    parser.add_argument("--yes", action="store_true", help="Skip the YES prompt.")
    args = parser.parse_args()

    from app.database import SessionLocal, engine
    from app.models import Board, BoardCourse, Chapter, ClassLevel
    from app.services import repeat_service
    from scripts.apply_answer_units import mask_database_url

    print(f"Target database: {mask_database_url(str(engine.url))}")
    if "sqlite" in str(engine.url):
        print("WARNING: DATABASE_URL is not set (or points at SQLite) -- this is not production.")
    db = SessionLocal()
    try:
        query = (
            db.query(Chapter).join(BoardCourse, Chapter.board_course_id == BoardCourse.id)
            .join(Board, BoardCourse.board_id == Board.id).join(ClassLevel, BoardCourse.class_level_id == ClassLevel.id)
        )
        if args.board:
            query = query.filter(Board.code == args.board.upper())
        if args.class_level:
            query = query.filter(ClassLevel.code == args.class_level)
        chapters = query.order_by(Board.code, ClassLevel.code, Chapter.chapter_no).all()
        if not chapters:
            print("No chapters found.")
            return 1
        if args.apply and not args.yes:
            if input(f"Write repeat flags on {len(chapters)} chapters? Type YES: ").strip() != "YES":
                print("Cancelled; nothing written.")
                return 1
        total_q = total_r = new = cleared = 0
        for chapter in chapters:
            r = repeat_service.process_chapter(db, chapter, apply=args.apply)
            total_q += r.questions
            total_r += r.repeats
            new += r.newly_flagged
            cleared += r.cleared
            print(f"{r.chapter_code:<34} {r.questions:>5} questions  {r.repeats:>4} repeats  (+{r.newly_flagged} / -{r.cleared})")
        if args.apply:
            db.commit()
        else:
            db.rollback()
        print(f"\n{total_q} questions, {total_r} repeats ({100 * total_r / max(total_q, 1):.1f}%). "
              + (f"Written: {new} newly flagged, {cleared} cleared." if args.apply else "Nothing written (add --apply)."))
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
