"""Converts the CISCE ("ICSE") lesson workbooks into the importer's layout and
writes a plain-text report of every check. Reads files only; writes only the
converted files and the report; never touches a database.

    python scripts/convert_cisce_workbooks.py --src <folder of lesson .xlsx> \
        --out <new folder> --class-level 5 --subject Mathematics \
        --source-label "CISCE Class 5 Mathematics"

Then load the converted files with scripts/import_cisce_workbooks.py.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.cisce_converter import convert_workbook, lesson_number


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--src", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--class-level", required=True)
    parser.add_argument("--subject", default="Mathematics")
    parser.add_argument("--source-label", required=True)
    args = parser.parse_args()

    src, out = Path(args.src), Path(args.out)
    files = sorted(src.glob("*.xlsx"), key=lambda p: lesson_number(p))
    if not files:
        print(f"No .xlsx files in {src}")
        return 1
    lines, bad = [], 0
    all_ids: dict[str, str] = {}
    for path in files:
        report = convert_workbook(
            path, out / f"CISCE_Class_{args.class_level}_Lesson_{lesson_number(path):02d}.xlsx",
            class_level=args.class_level, subject=args.subject, source_label=args.source_label,
        )
        lines.append(f"Lesson {report.lesson_no}: {report.lesson_title} ({path.name})")
        lines.append(f"  questions {report.questions}, skills {report.skills}, types {dict(report.types)}, marks {dict(report.marks)}")
        lines.append(f"  units set {dict(report.units)}; counted things (number only) {report.counted_nouns}; two-part answers (two boxes later) {report.two_part}")
        lines.append(f"  name prefixes removed {sum(report.stripped_names.values())} ({len(report.stripped_names)} names)")
        lines.append(f"  repeats once names are ignored {report.repeated_stems}; plain arithmetic keys recomputed {report.arithmetic_checked}; written answers of 3 words or fewer {report.short_written}")
        for w in report.warnings:
            lines.append(f"  WARNING {w}")
        for e in report.errors:
            lines.append(f"  ERROR   {e}")
        if not report.ok:
            bad += 1
        lines.append("")
    # IDs must be unique across the whole set.
    import openpyxl
    for converted in sorted(out.glob("*.xlsx")):
        wb = openpyxl.load_workbook(converted, read_only=True)
        for row in wb["Question Bank"].iter_rows(min_row=2, values_only=True):
            if row[0]:
                if row[0] in all_ids:
                    lines.append(f"ERROR {row[0]} is in both {all_ids[row[0]]} and {converted.name}")
                    bad += 1
                all_ids[row[0]] = converted.name
    lines.append(f"Total questions {len(all_ids)}; files with errors {bad}")
    report_path = out / "conversion_report.txt"
    report_path.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))
    print(f"\nReport written to {report_path}")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
