"""Task #35: runs the free automated quality checks (question_quality_service.py
-- structural checks + math-pattern verifiers + duplicate detection) against
every question in the real, already-imported content, chapter by chapter, and
prints a report broken down by chapter so a human knows exactly what to look
at before publishing.

Why this exists: the quality checks already run automatically inside the app
(lazily, the first time a SUPER_ADMIN opens a lesson for review, or in bulk
via the "Approve All Verified" button on a chapter -- see
routes_curriculum_admin.py's list_concept_lesson_questions() and
_bulk_approve_questions()), so this script doesn't add a new check. What it
adds is visibility: a single run across all 15 real Class 5 Maths chapters
that tells you, up front, how many of the ~7,500 imported questions are
VERIFIED (safe to bulk-approve), FLAGGED (needs a human, with the exact
reason), or UNVERIFIED (structurally clean, no verifier applies -- typically
open-ended word problems) -- before you go chapter-by-chapter in the UI.

Deliberately a standalone script, not something Claude ran directly: same
reasoning as import_class5_maths.py and create_super_admin.py -- writing
quality_status/quality_flags onto real content rows in the production
database is a deliberate, visible step you run yourself with production
credentials, not something that happens silently in an agent session. No
tool available to Claude in this session has write access to production
Postgres (the Render MCP's query tool is read-only by design, and its IP
allowlist is scoped to your own machine anyway).

Safe to re-run: this only ever overwrites a question's OWN quality columns
(quality_status, quality_flags, quality_checked_at) based on that question's
own current content -- it never touches status (draft/review/published),
never creates or deletes rows, and running it twice in a row against
unchanged content produces the identical result both times.

Usage (from backend/, with DATABASE_URL set to the target database):
    python scripts/run_quality_checks.py
    python scripts/run_quality_checks.py --chapter-code CH-CBSE-C5-MATHEMATICS-01
    python scripts/run_quality_checks.py --dry-run   # report only, don't persist
"""
import argparse
import json
import sys
from collections import defaultdict
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
    parser.add_argument(
        "--chapter-code",
        default=None,
        help="Only check this one chapter (by its Chapter.code). Default: every chapter in the database.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute and print the report but don't write quality_status/quality_flags back to the database.",
    )
    parser.add_argument(
        "--max-flags-shown",
        type=int,
        default=15,
        help="Cap how many individual FLAGGED questions are printed per chapter, to keep the report readable (default 15). The summary count is never capped.",
    )
    args = parser.parse_args()

    from datetime import datetime, timezone

    from app.database import SessionLocal, engine
    from app.models import Chapter, ConceptLesson, Question
    from app.services.question_quality_service import run_quality_checks

    print(f"Target database: {mask_database_url(str(engine.url))}")
    if "sqlite" in str(engine.url):
        print("WARNING: DATABASE_URL is not set (or points at SQLite) -- this will NOT read/write production.")
    if args.dry_run:
        print("--dry-run: report only, nothing will be written back to the database.\n")

    db = SessionLocal()
    try:
        chapter_query = db.query(Chapter).order_by(Chapter.chapter_no)
        if args.chapter_code:
            chapter_query = chapter_query.filter(Chapter.code == args.chapter_code)
        chapters = chapter_query.all()
        if not chapters:
            print("No chapters found matching that filter.")
            return 1

        grand_total = 0
        grand_verified = 0
        grand_flagged = 0
        grand_unverified = 0
        chapters_with_flags: list[str] = []

        for chapter in chapters:
            lessons = (
                db.query(ConceptLesson)
                .filter(ConceptLesson.chapter_id == chapter.id)
                .order_by(ConceptLesson.sequence)
                .all()
            )
            questions = (
                db.query(Question)
                .filter(Question.concept_lesson_id.in_([l.id for l in lessons]))
                .order_by(Question.code)
                .all()
                if lessons
                else []
            )

            print(f"\n=== {chapter.code} -- {chapter.title} ===")
            if not questions:
                print("  (no questions)")
                continue

            results = run_quality_checks(questions)
            by_status: dict[str, int] = defaultdict(int)
            flagged_lines: list[str] = []
            for question in questions:
                result = results[question.id]
                by_status[result.status] += 1
                if result.status == "FLAGGED":
                    flagged_lines.append(f"    {question.code}: {'; '.join(result.flags)}")
                if not args.dry_run:
                    question.quality_status = result.status
                    question.quality_flags = json.dumps(result.flags) if result.flags else None
                    question.quality_checked_at = datetime.now(timezone.utc)

            total = len(questions)
            verified = by_status["VERIFIED"]
            flagged = by_status["FLAGGED"]
            unverified = by_status["UNVERIFIED"]
            print(f"  {total} questions -- VERIFIED: {verified}  FLAGGED: {flagged}  UNVERIFIED: {unverified}")
            if flagged_lines:
                chapters_with_flags.append(chapter.code)
                shown = flagged_lines[: args.max_flags_shown]
                for line in shown:
                    print(line)
                if len(flagged_lines) > len(shown):
                    print(f"    ... and {len(flagged_lines) - len(shown)} more FLAGGED question(s) in this chapter")

            grand_total += total
            grand_verified += verified
            grand_flagged += flagged
            grand_unverified += unverified

        if not args.dry_run:
            db.commit()

        print("\n" + "=" * 60)
        print(f"TOTAL across {len(chapters)} chapter(s): {grand_total} questions")
        print(f"  VERIFIED:   {grand_verified}")
        print(f"  FLAGGED:    {grand_flagged}")
        print(f"  UNVERIFIED: {grand_unverified}")
        if chapters_with_flags:
            print(f"\nChapters with at least one FLAGGED question: {', '.join(chapters_with_flags)}")
            print("Open each of these in Curriculum Studio (SUPER_ADMIN) to review and fix before publishing.")
        else:
            print("\nNo FLAGGED questions in any checked chapter.")
        if args.dry_run:
            print("\n(--dry-run: nothing was written back to the database. Re-run without --dry-run to persist these results.)")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
