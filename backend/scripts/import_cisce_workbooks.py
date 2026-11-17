"""Loads the converted CISCE ("ICSE" on screen) lesson files into the database
as invisible DRAFT content (task #234). Run scripts/convert_cisce_workbooks.py
first and give this script the folder it wrote.

Everything lands as DRAFT: the board "CISCE" (shown as "ICSE"), the Class
course, the curriculum version, every lesson and every question. Nothing is
visible to a teacher or a child until the content is reviewed and published
in Curriculum Studio. A school becomes an ICSE school by choosing the board
on the school's page in Platform > Schools; no content step is needed.

Like every content loader it writes to whatever DATABASE_URL points at, so
for production run it yourself with the External Database URL:

    set DATABASE_URL=<the real Postgres connection string>      (Windows)
    python scripts/import_cisce_workbooks.py --dir <converted folder> --class-level 5 --dry-run
    python scripts/import_cisce_workbooks.py --dir <converted folder> --class-level 5

--dry-run does everything, then rolls back and writes nothing. Safe to re-run:
the importer updates rows by their codes and never duplicates them.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def mask_database_url(url: str) -> str:
    if "@" not in url:
        return url
    scheme_and_creds, host_and_rest = url.rsplit("@", 1)
    scheme = scheme_and_creds.split("://", 1)[0] if "://" in scheme_and_creds else ""
    return f"{scheme}://***:***@{host_and_rest}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dir", required=True, help="The folder convert_cisce_workbooks.py wrote.")
    parser.add_argument("--class-level", required=True)
    parser.add_argument("--yes", action="store_true", help="Skip the YES prompt.")
    parser.add_argument("--dry-run", action="store_true", help="Do everything, then roll back.")
    args = parser.parse_args()

    folder = Path(args.dir)
    files = sorted(folder.glob(f"CISCE_Class_{args.class_level}_Lesson_*.xlsx"))
    if not files:
        print(f"No converted CISCE Class {args.class_level} files in {folder}")
        return 1

    from app.database import SessionLocal, engine
    from app.models import Board, Question
    from app.services.cisce_converter import BOARD_CODE, BOARD_DISPLAY_NAME
    from app.services.curriculum_import_service import import_chapter_workbook

    db_url = str(engine.url)
    print(f"Target database: {mask_database_url(db_url)}")
    if "sqlite" in db_url:
        print("WARNING: DATABASE_URL is not set (or points at SQLite): this will NOT write to production.")
    print(f"Files: {len(files)} lessons (all land as DRAFT, invisible)")
    if args.dry_run:
        print("DRY RUN: everything is rolled back at the end.")
    elif not args.yes and input("Type YES to proceed: ").strip() != "YES":
        print("Aborted.")
        return 1

    db = SessionLocal()
    failed = []
    try:
        old = db.query(Board).filter(Board.code == "ICSE").first()
        if old is not None:
            print("NOTE: a board with code ICSE already exists; this load uses the board CISCE (screen name ICSE).")
        before = db.query(Question).count()
        for path in files:
            try:
                result = import_chapter_workbook(
                    db, str(path), board_code=BOARD_CODE, board_display_name=BOARD_DISPLAY_NAME,
                    class_level_code=args.class_level, curriculum_version_status="DRAFT", commit=False,
                )
                print(f"  OK {path.name}: {result.chapter_code} {result.chapter_title!r}: "
                      f"{result.concept_lessons_created} skills created / {result.concept_lessons_updated} updated, "
                      f"{result.questions_created} questions created / {result.questions_updated} updated"
                      + (f", {len(result.warnings)} warnings" if result.warnings else ""))
                for warning in result.warnings:
                    print(f"      - {warning}")
            except Exception as exc:  # noqa: BLE001 -- report, then stop: all or nothing
                db.rollback()
                failed.append((path.name, str(exc)))
                print(f"  FAILED {path.name}: {exc}")
                break
        if failed:
            print("Nothing was kept: a file failed, so the whole load was rolled back.")
            db.rollback()
            return 1
        if args.dry_run:
            added = db.query(Question).count() - before
            db.rollback()
            print(f"\nDry run: {added} questions would be added. Nothing written.")
            return 0
        db.commit()
        print(f"\nDone: {db.query(Question).count() - before} new questions, all DRAFT.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
