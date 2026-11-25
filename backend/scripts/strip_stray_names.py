"""Take the stray character name out of the written question stems (#267).

A child reading ICSE Class 5 Measurement sees:

    Show all working and explain your reasoning. Vihaan: Convert 49800 cm to metres.

"Vihaan:" should never have reached them. `cisce_converter` strips a name
that leads a stem, but its `_NAME_PREFIX` is anchored at the START, so it
never matched a stem that opens with the "Show all working" instruction.
`_SHOW_WORKING`, which handles exactly that shape, was added hours later the
same day (`0670410`, the Class 7 import) -- after the Class 5 content had
already been imported by `465c998`. The converter has been right ever since;
only the rows loaded in that window are wrong.

Measured on production 24 Nov 2026: 60 stems in ICSE Class 5 Measurement,
three per lesson across 20 lessons -- Naina on every Q281, Saanvi on every
Q381, Vihaan on every Q481. Those are the Fluency E, Application E and
Mastery E sets. Other chapters and boards are checked here too rather than
assumed: the script reports whatever it finds.

This reuses the converter's OWN functions rather than a fresh regular
expression, so what it strips here is exactly what a re-import would strip.
A name inside the question's wording is left alone -- "Vihaan: Vihaan buys 3
items" becomes "Vihaan buys 3 items", which is the sentence as written.

Usage, from backend/ with DATABASE_URL set to production:

    python scripts/strip_stray_names.py                      # report, writes nothing
    python scripts/strip_stray_names.py --apply --expect 60  # the count the report printed

Every affected row is written in full to strip_stray_names_audit.csv (id,
code, name, stem now, stem after) BEFORE anything is changed. Keep that file:
the printed report truncates, so the CSV is the undo record, not the report.
"""
import argparse
import csv
import sys
from collections import Counter
from collections.abc import Collection

sys.path.insert(0, ".")

from app.database import SessionLocal
from app.models import Question
from app.services.cisce_converter import (
    _NAME_PREFIX,
    _NOT_NAMES,
    _SHOW_WORKING,
)

# The names measured on production on 24 Nov 2026: Naina on every Q281,
# Saanvi on every Q381, Vihaan on every Q481 of ICSE Class 5 Measurement.
#
# This script strips ONLY these, and that restriction is the whole safety
# argument. The converter's own `_NAME_PREFIX` is `^([A-Z][a-z]{2,11}):\s+`
# and it rejects a match only if the word is in `_NOT_NAMES`, a hand-written
# list of eleven ("Answer", "Check", "Example", "Find", "Given", "Hint",
# "Note", "Question", "Remember", "Step", "Tip"). That is safe at IMPORT
# time, where the source content is known. It is NOT safe here, because this
# runs over every question on every board: measured in the test suite, the
# bare pattern also matches "Complete:", "Calculate:" and "True:", and it
# would have silently cut those words off real stems. A-047's first
# production run made exactly this mistake, selecting 27 rows it should
# never have touched.
#
# So the pattern decides WHERE a name could be, and this list decides
# whether it is one. Anything else the pattern matches is REPORTED and left
# alone, so a new name can be added deliberately with --names.
DEFAULT_NAMES = ("Naina", "Saanvi", "Vihaan")


def stripped(stem: str, names: Collection[str] = DEFAULT_NAMES) -> tuple[str, str | None]:
    """The stem as the converter would write it today, and the name taken
    off the front -- None when there was none to take.

    The name is returned from the match rather than worked out by comparing
    lengths afterwards. Where the stem opens with the "Show all working"
    instruction the name sits in the MIDDLE of it, so a prefix slice of the
    difference in length gives the first few words of the instruction
    instead ("Show all"), and the report would have named the wrong thing in
    the one place a person checks before writing to production."""
    if not stem:
        return stem, None
    instruction = _SHOW_WORKING.match(stem)
    lead = stem[instruction.end():] if instruction else stem
    match = _NAME_PREFIX.match(lead)
    if not match or match.group(1) in _NOT_NAMES or match.group(1) not in names:
        return stem, None
    lead = lead[match.end():].strip()
    fixed = (instruction.group(1) + " " + lead) if instruction else lead
    return fixed, match.group(1)


def plan(
    db,
    *,
    apply: bool = False,
    audit_path: str | None = None,
    expect: int | None = None,
    names_allowed: Collection[str] = DEFAULT_NAMES,
):
    """(names stripped, rows, questions looked at, words declined). Separate
    from main() so the suite can drive both halves: this writes to production.

    `rows` is EVERY affected question in full, not a sample -- id, code, the
    stem now and the stem after. That file is the undo record; the printed
    report truncates, so it is not one.

    `declined` is every OTHER word the pattern matched and this script left
    alone, with a count each. It is reported rather than acted on: that is
    how "Complete:" and "Calculate:" stay on the stems they belong to while
    a genuinely new name can still be seen and then added with --names.

    `expect` is a safety catch. A-047's first production run selected 27 rows
    it should never have touched, so --apply refuses unless the count is
    exactly what the report showed."""
    questions = db.query(Question).all()
    names: Counter = Counter()
    declined: Counter = Counter()
    rows: list[dict] = []
    for question in questions:
        stem = question.stem or ""
        fixed, name = stripped(stem, names_allowed)
        if name is None or fixed == stem:
            # Nothing was taken off. Was there a word there that this script
            # chose not to treat as a name? Say so, without touching it.
            instruction = _SHOW_WORKING.match(stem)
            lead = stem[instruction.end():] if instruction else stem
            other = _NAME_PREFIX.match(lead)
            if other and other.group(1) not in _NOT_NAMES and other.group(1) not in names_allowed:
                declined[other.group(1)] += 1
            continue
        names[name] += 1
        rows.append({"id": question.id, "code": question.code, "name": name, "now": stem, "then": fixed})

    found = len(rows)
    if apply and expect is not None and found != expect:
        raise SystemExit(
            f"Refusing to write: --expect {expect} but {found} stems match now. "
            "Re-run the report, read it, and pass the number it prints."
        )

    # The record is written BEFORE the change, so it exists even if the
    # commit then fails.
    if audit_path and rows:
        with open(audit_path, "w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["id", "code", "name", "now", "then"])
            writer.writeheader()
            writer.writerows(rows)

    if apply:
        by_id = {row["id"]: row["then"] for row in rows}
        for question in questions:
            if question.id in by_id:
                question.stem = by_id[question.id]
        db.commit()
    return names, rows, len(questions), declined


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the changes (default: report only)")
    parser.add_argument(
        "--expect",
        type=int,
        default=None,
        help="with --apply: refuse unless exactly this many stems match (the number the report printed)",
    )
    parser.add_argument(
        "--names",
        default=",".join(DEFAULT_NAMES),
        help=(
            "comma-separated names to strip. Default: "
            + ", ".join(DEFAULT_NAMES)
            + ". Only these are touched; any other word the pattern finds is reported, not changed."
        ),
    )
    parser.add_argument(
        "--audit",
        default="strip_stray_names_audit.csv",
        help="where to write every affected row in full -- this file is the undo record",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        allowed = tuple(n.strip() for n in args.names.split(",") if n.strip())
        names, rows, looked_at, declined = plan(
            db,
            apply=args.apply,
            audit_path=args.audit,
            expect=args.expect,
            names_allowed=allowed,
        )
        print(f"Questions looked at: {looked_at}")
        print(f"Names being stripped: {', '.join(allowed)}")
        if declined:
            print("\nLeft alone -- a word in the same position that is NOT in that list.")
            print("Check these before adding any of them with --names:")
            for word, count in sorted(declined.items(), key=lambda kv: -kv[1]):
                print(f"  {word}: {count}")
        if not names:
            print("\nNothing to change: no stem begins with one of those names.")
            return 0
        print(f"Stems beginning with a stray name: {sum(names.values())}")
        for name, count in sorted(names.items(), key=lambda kv: -kv[1]):
            print(f"  {name}: {count}")
        print("\nFirst few, as a child sees them now:")
        for row in rows[:10]:
            print(f"  {row['code']}\n    now:  {row['now'][:96]}\n    then: {row['then'][:96]}")
        print(f"\nEvery affected row, in full: {args.audit}  ({len(rows)} rows)")
        print("Keep that file. It is what an undo would be built from.")
        if args.apply:
            print(f"\nApplied to {len(rows)} questions.")
        else:
            print(
                f"\nReport only -- nothing was written. To change these {len(rows)} stems, re-run as:\n"
                f"    python scripts/strip_stray_names.py --apply --expect {len(rows)}"
            )
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
