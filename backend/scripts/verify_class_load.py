"""Read-only check that a converted Class folder landed in the database as
intended (task #236). Compares every question in the converted files with the
database row for the same board and class: status, type, marks, unit, unit
rule, wording and correct answer. Writes nothing.

    python scripts/verify_class_load.py --board CBSE  --dir <converted folder> --class-level 7
    python scripts/verify_class_load.py --board CISCE --dir <converted folder> --class-level 7
"""
import argparse
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--board", choices=["CISCE", "CBSE"], required=True)
    ap.add_argument("--dir", required=True)
    ap.add_argument("--class-level", required=True)
    args = ap.parse_args()

    import openpyxl
    from sqlalchemy import func

    from app.database import SessionLocal
    from app.models import Board, BoardCourse, Chapter, ClassLevel, ConceptLesson, Question

    files = sorted(Path(args.dir).glob(f"{args.board}_Class_{args.class_level}_Lesson_*.xlsx"))
    if not files:
        print("No converted files found")
        return 1
    expected = {}
    for f in files:
        rows = list(openpyxl.load_workbook(f, read_only=True, data_only=True)["Question Bank"].iter_rows(values_only=True))
        header = rows[0]
        for r in rows[1:]:
            d = dict(zip(header, r))
            if d.get("Question ID"):
                expected[str(d["Question ID"])] = d

    db = SessionLocal()
    try:
        board = db.query(Board).filter(Board.code == args.board).one()
        query = (
            db.query(Question, Chapter)
            .join(ConceptLesson, Question.concept_lesson_id == ConceptLesson.id)
            .join(Chapter, ConceptLesson.chapter_id == Chapter.id)
            .join(BoardCourse, Chapter.board_course_id == BoardCourse.id)
            .join(ClassLevel, BoardCourse.class_level_id == ClassLevel.id)
            .filter(BoardCourse.board_id == board.id, ClassLevel.code == args.class_level, Question.code.in_(list(expected)))
        )
        found = {}
        chapters = Counter()
        statuses = Counter()
        for q, ch in query.all():
            found[q.code] = q
            chapters[(ch.chapter_no, ch.title, ch.status)] += 1
            statuses[q.status] += 1
        missing = [c for c in expected if c not in found]
        mism = Counter()
        examples = {}

        def norm(v):
            return "" if v is None else str(v).strip()

        for code, q in found.items():
            d = expected[code]
            checks = {
                "type": (norm(d["Question Type"]), norm(q.question_type)),
                "marks": (int(d["Marks"] or 1), int(q.marks)),
                "wording": (norm(d["Question Stem"]), norm(q.stem)),
                "answer": (norm(d["Correct Answer"]), norm(q.correct_answer)),
                "unit": (norm(d.get("Answer Unit")), norm(q.answer_unit)),
                "unit rule": (norm(d.get("Unit Rule")).upper(), norm(q.unit_rule).upper()),
            }
            for name, (a, b) in checks.items():
                if a != b:
                    mism[name] += 1
                    examples.setdefault(name, (code, a[:60], b[:60]))
        print(f"Board {args.board}, class {args.class_level}")
        print(f"Questions in files: {len(expected)}  found in database: {len(found)}  missing: {len(missing)}")
        print(f"Mismatches: {dict(mism) or 'none'}")
        for k, v in examples.items():
            print(f"  e.g. {k}: {v}")
        print(f"Status of found questions: {dict(statuses)}")
        print(f"Chapters: {len(chapters)}")
        for (no, title, status), n in sorted(chapters.items(), key=lambda x: (x[0][0] is None, x[0][0])):
            print(f"  {no} {title} [{status}]: {n}")
        print(f"Total questions in database: {db.query(func.count(Question.id)).scalar()}")
        return 0 if not missing and not mism else 2
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
