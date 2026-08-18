"""One-time content load: imports all 15 real Class 5 CBSE Maths chapter
workbooks (Content/CBSE_Class_5_Chapter_*.xlsx) using the same
`import_chapter_workbook()` service that already has committed test
coverage (tests/test_curriculum_import.py) and was verified end to end
against real Chapter 10 content during the Phase 2 exit-gate check
(PROJECT_REFERENCE.md, 18 Aug 2026).

Why this is a standalone script and not something Claude ran directly:
this writes to whatever database DATABASE_URL points at -- for a real
content load that means production. No tool available to Claude in this
session has write access to the production database (the Render MCP's
query tool is read-only by design), and even if it did, a one-shot bulk
write to the live database is exactly the kind of action that should be a
deliberate, visible step you run yourself, not something that happens
silently in an agent session. Run this locally with DATABASE_URL pointed
at the real Postgres instance (its "External Database URL" from the
Render dashboard -- the internal one only resolves from inside Render's
own network).

Safe to re-run: import_chapter_workbook() is idempotent per chapter (see
its own docstring) -- re-running updates existing rows by their natural
codes instead of duplicating them. Every chapter lands in DRAFT
regardless of what the source workbook's own Status column says at the
question level -- nothing here publishes anything or becomes visible to
a real teacher or student. Reviewing and publishing each chapter is a
separate, deliberate step you take afterward in the admin Curriculum
Studio (/admin/curriculum).

Usage (from backend/, with the venv used to run the backend/tests active):
    set DATABASE_URL=<the real Postgres connection string>      (Windows)
    export DATABASE_URL=<the real Postgres connection string>   (macOS/Linux)
    python scripts/import_class5_maths.py --content-dir "C:\\path\\to\\Content"

If --content-dir is omitted, it defaults to "../Content" relative to this
file, which matches the repo's usual sibling-folder layout
(.../School Enrichment/School_Enrichment_Platform/backend/ and
.../School Enrichment/Content/).
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Canonical chapter number -> filename, verified 18 Aug 2026 against every
# file actually present in Content/: each opens cleanly, has both the
# "Question Bank" and "Skill Map" sheets, has exactly 500 question rows,
# and the Question Bank's own "Chapter No." column matches the number
# below (the Content folder has a few legacy/duplicate .numbers and
# .nmbtemplate files alongside these -- this list deliberately picks the
# one real .xlsx per chapter and ignores the rest).
CHAPTER_FILES = {
    1: "CBSE_Class_5_Chapter_1.xlsx",
    2: "CBSE_Class_5_Chapter_2_Fractionsxlsx.xlsx",
    3: "CBSE_Class_5_Chapter_3_Angles as Turn.xlsx",
    4: "CBSE_Class_5_Chapter_4_We_the_Travellers_II.xlsx",
    5: "CBSE_Class_5_Chapter_5_Far_and_Near_FULL_500_Questions.xlsx",
    6: "CBSE_Class_5_Chapter_6_The_Dairy_Farm.xlsx",
    7: "CBSE_Class_5_Chapter_7_Shapes_and_Patterns.xlsx",
    8: "CBSE_Class_5_Chapter_8_Weight_and_Capacity.xlsx",
    9: "CBSE_Class_5_Chapter_9_Coconut_Farm.xlsx",
    10: "CBSE_Class_5_Chapter_10_Symmetrical_Designs_FULL_500_Questions.xlsx",
    11: "CBSE_Class_5_Chapter_11_Grandmothers_Quilt_FULL_500_Questions(1).xlsx",
    12: "MathPath_CBSE_Class_5_Chapter_12_Racing_Seconds_FULL_500_Questions.xlsx",
    13: "CBSE_Class_5_Chapter_13_Animal_Jumps_FULL_500_Questions.xlsx",
    14: "MathPath_CBSE_Class_5_Chapter_14_Maps_and_Locations_FULL_500_Questions.xlsx",
    15: "CBSE_Class_5_Chapter_15_Data_Through_Pictures_FULL_500_Questions.xlsx",
}


def mask_database_url(url: str) -> str:
    if "@" not in url:
        return url
    scheme_and_creds, host_and_rest = url.rsplit("@", 1)
    scheme = scheme_and_creds.split("://", 1)[0] if "://" in scheme_and_creds else ""
    return f"{scheme}://***:***@{host_and_rest}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--content-dir",
        default=str(Path(__file__).resolve().parent.parent.parent.parent / "Content"),
        help='Folder containing the CBSE_Class_5_Chapter_*.xlsx files (default: "../../Content" from this script).',
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip the interactive confirmation prompt (for non-interactive/CI use).",
    )
    args = parser.parse_args()

    content_dir = Path(args.content_dir)
    if not content_dir.is_dir():
        print(f"Content directory not found: {content_dir}")
        return 1

    missing = [f"CH{num:02d}: {name}" for num, name in CHAPTER_FILES.items() if not (content_dir / name).exists()]
    if missing:
        print("The following expected files are missing from --content-dir:")
        for line in missing:
            print(f"  {line}")
        return 1

    from app.database import SessionLocal, engine
    from app.services.curriculum_import_service import import_chapter_workbook

    db_url = str(engine.url)
    print(f"Target database: {mask_database_url(db_url)}")
    if "sqlite" in db_url:
        print("WARNING: DATABASE_URL is not set (or points at SQLite) -- this will NOT write to production.")
    print(f"Content directory: {content_dir}")
    print(f"Chapters to import: {len(CHAPTER_FILES)} (all land in DRAFT -- nothing becomes visible to anyone)")

    if not args.yes:
        confirm = input("Type YES to proceed: ")
        if confirm.strip() != "YES":
            print("Aborted.")
            return 1

    db = SessionLocal()
    succeeded, failed = [], []
    try:
        for num in sorted(CHAPTER_FILES):
            path = content_dir / CHAPTER_FILES[num]
            print(f"\n=== Chapter {num:02d}: {path.name} ===")
            try:
                result = import_chapter_workbook(db, str(path))
                print(
                    f"  OK -- {result.chapter_code} {result.chapter_title!r}: "
                    f"{result.concept_lessons_created} lessons created / {result.concept_lessons_updated} updated, "
                    f"{result.questions_created} questions created / {result.questions_updated} updated"
                )
                if result.warnings:
                    print(f"  {len(result.warnings)} warning(s):")
                    for warning in result.warnings:
                        print(f"    - {warning}")
                succeeded.append(num)
            except Exception as exc:  # noqa: BLE001 -- one bad chapter shouldn't abort the rest
                db.rollback()
                print(f"  FAILED: {exc}")
                failed.append((num, str(exc)))
    finally:
        db.close()

    print("\n=== Summary ===")
    print(f"Succeeded: {len(succeeded)}/{len(CHAPTER_FILES)} -- {[f'CH{n:02d}' for n in succeeded]}")
    if failed:
        print(f"Failed: {len(failed)}")
        for num, reason in failed:
            print(f"  CH{num:02d}: {reason}")
        return 1

    print("\nAll chapters are now in the database with status DRAFT.")
    print("Review and publish each one in the admin Curriculum Studio (/admin/curriculum) when ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
