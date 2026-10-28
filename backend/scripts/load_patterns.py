"""Loads question patterns for the mock paper engine (#166, 27 Oct 2026).

Reads the pattern files (backend/content/patterns/<engine>/*.json), checks
every pattern and tries each one 200 times, then reports what would be
added or changed. With --apply it writes, in one transaction with one
audit entry. New and changed patterns are DRAFT: nothing is used in a
paper until Ashalatha approves it (scripts/approve_patterns.py). Running it
again changes nothing. See app/services/pattern_store.py for the rules.

Usage (from backend/, DATABASE_URL and ENVIRONMENT as for the other scripts):
    python scripts/load_patterns.py content/patterns/cbse-class-5-mathematics
    python scripts/load_patterns.py content/patterns/cbse-class-5-mathematics --apply
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _summary(plan) -> tuple:
    """What the person confirmed: the codes to add and to change."""
    return (sorted(f["code"] for f in plan.add), sorted(p.code for p, _ in plan.change), plan.unchanged)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paths", nargs="+", help="Pattern files, or folders of them.")
    parser.add_argument("--apply", action="store_true", help="Write the changes. Without it, only report.")
    parser.add_argument("--yes", action="store_true", help="With --apply, skip the typed confirmation.")
    args = parser.parse_args()

    files = []
    for p in args.paths:
        path = Path(p)
        files.extend(sorted(path.glob("*.json")) if path.is_dir() else [path])
    if not files:
        print("No pattern files found.")
        return 1

    from app.database import SessionLocal, engine
    from app.services import pattern_store
    from scripts.apply_answer_units import mask_database_url

    print(f"Target database: {mask_database_url(str(engine.url))}")
    db = SessionLocal()
    try:
        entries = pattern_store.read_files([str(f) for f in files])
        plan = pattern_store.make_plan(db, entries)
        print(f"Patterns in the files: {len(entries)}")
        print(f"To add: {len(plan.add)}  To change (back to DRAFT, next version): {len(plan.change)}  Unchanged: {plan.unchanged}")
        for code, result in sorted(plan.trials.items()):
            print(f"  {code}: {result['distinct']} different questions in {result['tried']} tries")
        if not args.apply:
            print("\nReport only: nothing was written. Run again with --apply to load these.")
            return 0
        if not plan.add and not plan.change:
            print("\nNothing to change.")
            return 0
        if not args.yes:
            # Hand the connection back while waiting: Render closes one left
            # idle at the prompt, and the write then fails (28 Oct 2026).
            confirmed = _summary(plan)
            db.close()
            if input("\nType YES to load these patterns: ").strip() != "YES":
                print("Stopped: nothing was written.")
                return 1
            print("Checking again on a fresh connection before writing ...")
            db = SessionLocal()
            plan = pattern_store.make_plan(db, entries)
            if _summary(plan) != confirmed:
                print("\nStopped: the database changed since the report above. Nothing was written; run it again.")
                return 1
        pattern_store.apply_plan(db, plan)
        print("\nDone. New and changed patterns are DRAFT until approved.")
        return 0
    except pattern_store.StopBeforeWriting as stop:
        print(f"\nStopped before writing anything:\n{stop}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
