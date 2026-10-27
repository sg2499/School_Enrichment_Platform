"""Records Ashalatha's decisions on question patterns (#166, 27 Oct 2026).

Reads her reviewed sheet ("Patterns": Pattern ID, Decision, and Version
when the sheet has one). Approve makes a pattern usable in papers; Reject
retires it; Change leaves it DRAFT for us to revise. A pattern changed
since the sheet was made is refused, and then nothing is written. See
app/services/pattern_store.py.

Usage (from backend/):
    python scripts/approve_patterns.py --workbook "C:\\path\\to\\SE_Class_5_Sample_Patterns_Reviewed.xlsx"
    python scripts/approve_patterns.py --workbook "..." --apply
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

REVIEWER = "Ashalatha Gupta"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--workbook", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()
    path = Path(args.workbook)
    if not path.is_file():
        print(f"Workbook not found: {path}")
        return 1

    from app.database import SessionLocal, engine
    from app.services import pattern_store
    from scripts.apply_answer_units import mask_database_url

    print(f"Target database: {mask_database_url(str(engine.url))}")
    db = SessionLocal()
    try:
        decisions = pattern_store.read_decisions(str(path))
        counts = Counter(d.status for d in decisions)
        print(f"Decisions: {counts['APPROVED']} Approve, {counts['DRAFT']} Change, {counts['RETIRED']} Reject")
        if not args.apply:
            print("\nReport only: nothing was written. Run again with --apply to record these.")
            return 0
        if not args.yes and input("\nType YES to record her decisions: ").strip() != "YES":
            print("Stopped: nothing was written.")
            return 1
        result = pattern_store.apply_decisions(db, decisions, reviewer=REVIEWER, workbook=path.name)
        print(f"\nDone: {result['changed']} patterns changed, {result['unchanged']} already as she decided.")
        return 0
    except pattern_store.StopBeforeWriting as stop:
        print(f"\nStopped before writing anything:\n{stop}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
