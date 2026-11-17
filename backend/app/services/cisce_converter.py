"""Converts a CISCE ("ICSE" on screen) lesson workbook into the layout the
chapter importer reads (task #234, 17 Nov 2026).

The ICSE Class 5 and Class 7 workbooks come in a 16-column layout (Question
Bank, Answer Key, Marking Guide, Five-Day Plan, Skill Map ...) that has no
options, hints, difficulty, variants or misconception tags. The importer
reads the older 32-column Question Bank by position, so this module rewrites
each lesson file into that layout, plus the six marking columns, and returns
a report of every check it made. Nothing here touches a database.

What it does, following Ashalatha's decision record
KRAMA-CISCE-C5M-DECISIONS-v1.0 (16 Nov 2026):
- removes the child's-name prefix ("Aarav: ") from every stem (B9);
- keeps every question ID exactly as given (immutable IDs);
- loads everything as Draft (nothing is child-visible because it was loaded);
- a Written Response becomes a Constructed Response, teacher-marked, with the
  rubric carried into the teacher note;
- a measured answer with an Expected Unit becomes Answer Unit + Unit Rule
  REQUIRED, so the child must type the unit (his call, 17 Nov: "the unit is a
  must"; the locked-unit box is a later slice and then moves these to STATED
  where the question names the unit);
- fields the file does not have (options, hints, difficulty, misconception
  notes, accepted variants) stay empty and are listed in the report, never
  invented.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path

import openpyxl

from app.services import units

BOARD_CODE = "CISCE"  # stored; the screen says ICSE
BOARD_DISPLAY_NAME = "ICSE"

QB_HEADERS = [
    "Question ID", "Board", "Class", "Subject", "Chapter No.", "Chapter", "Skill ID", "Skill",
    "Assignment ID", "Stage", "Difficulty (1-4)", "Competency", "Question Type", "Question Stem",
    "Option A", "Option B", "Option C", "Option D", "Correct Answer", "Accepted Variants", "Hint",
    "Step-by-Step Explanation", "Misconception Tag", "Marks", "Time (seconds)", "Auto-gradable",
    "Shuffle Options", "Response Format", "Media Required", "Teacher Note", "Status", "Source Alignment",
    # The six marking columns (read by header name).
    "Answer Unit", "Unit Rule", "Allow Conversion", "Tolerance", "Decimal Places", "Unit Mark",
]
SM_HEADERS = ["Skill ID", "Skill", "Learning Outcome", "Prerequisite / Gap Check", "Priority Misconception", "Question Count"]

# A first name then a colon at the very start of a stem. Words that are not
# names are never stripped.
_NAME_PREFIX = re.compile(r"^([A-Z][a-z]{2,11}):\s+")
_NOT_NAMES = frozenset({"Note", "Hint", "Given", "Find", "Step", "Answer", "Question", "Example", "Remember", "Check", "Tip"})

# Counted things need no unit (her decision B12): the answer is just the number.
COUNT_NOUNS = frozenset({
    "learners", "learner", "students", "student", "items", "item", "units", "unit", "responses", "response",
    "children", "people", "pupils", "votes", "marks", "tickets", "books", "pencils", "apples", "boxes",
    "mugs", "cards", "coins", "balls", "points", "terms", "numbers", "digits", "sides", "rows", "columns", "pieces",
})
_TYPE_MAP = {"Written Response": "Constructed Response"}
_ARITH = re.compile(r"^Calculate\s+([\d,]+)\s*([+−×÷x*/-])\s*([\d,]+)\s*\.?$")


@dataclass
class ConvertReport:
    source: str
    lesson_no: int
    lesson_title: str = ""
    questions: int = 0
    skills: int = 0
    stripped_names: Counter = field(default_factory=Counter)
    types: Counter = field(default_factory=Counter)
    marks: Counter = field(default_factory=Counter)
    units: Counter = field(default_factory=Counter)
    errors: list = field(default_factory=list)  # block the import
    warnings: list = field(default_factory=list)  # for her and for us
    repeated_stems: int = 0
    arithmetic_checked: int = 0
    short_written: int = 0
    counted_nouns: int = 0
    two_part: int = 0

    @property
    def ok(self) -> bool:
        return not self.errors


def lesson_number(path: Path) -> int:
    match = re.search(r"Lesson_(\d+)_", path.name)
    if not match:
        raise ValueError(f"Cannot read the lesson number from the file name {path.name!r}")
    return int(match.group(1))


def _rows(ws) -> list[dict]:
    raw = list(ws.iter_rows(values_only=True))
    if not raw:
        return []
    header = [str(c).strip() if c is not None else "" for c in raw[0]]
    out = []
    for row in raw[1:]:
        if not row or not row[0]:
            continue
        out.append({header[i]: row[i] for i in range(min(len(header), len(row))) if header[i]})
    return out


def _clean(value):
    """Empty text, 'None' and 'Not applicable' mean nothing in these files."""
    if value is None:
        return None
    text = str(value).strip()
    return None if text in ("", "None", "Not applicable") else text


def _num(text: str):
    try:
        return Decimal(text.replace(",", "").strip())
    except (InvalidOperation, AttributeError):
        return None


def _recompute(stem: str):
    """The answer to a plain 'Calculate a op b' stem, or None."""
    match = _ARITH.match(stem.strip())
    if not match:
        return None
    a, op, b = _num(match.group(1)), match.group(2), _num(match.group(3))
    if a is None or b is None:
        return None
    if op == "+":
        return a + b
    if op in ("−", "-"):
        return a - b
    if op in ("×", "x", "*"):
        return a * b
    if b == 0:
        return None
    return a / b


def convert_workbook(src: Path, dst: Path, *, class_level: str, subject: str, source_label: str) -> ConvertReport:
    """Reads one ICSE-layout lesson file and writes the importer layout to
    `dst`. Returns the report; check `report.ok` before importing."""
    report = ConvertReport(source=src.name, lesson_no=lesson_number(src))
    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    for sheet in ("Question Bank", "Answer Key", "Marking Guide", "Skill Map"):
        if sheet not in wb.sheetnames:
            report.errors.append(f"The sheet {sheet!r} is missing.")
    if report.errors:
        return report

    qb = _rows(wb["Question Bank"])
    answers = {str(r["Question ID"]).strip(): r for r in _rows(wb["Answer Key"])}
    guides = {str(r["Question ID"]).strip(): r for r in _rows(wb["Marking Guide"])}
    skill_rows = _rows(wb["Skill Map"])
    wb.close()

    if not qb:
        report.errors.append("The Question Bank has no questions.")
        return report
    report.questions = len(qb)
    report.lesson_title = str(qb[0]["Lesson"]).strip()
    skill_ids = [str(r["Skill ID"]).strip() for r in skill_rows]
    report.skills = len(skill_ids)

    out = openpyxl.Workbook()
    ws = out.active
    ws.title = "Question Bank"
    ws.append(QB_HEADERS)

    seen_ids: set[str] = set()
    stems: Counter = Counter()
    per_skill: Counter = Counter()
    for row in qb:
        qid = str(row["Question ID"]).strip()
        if qid in seen_ids:
            report.errors.append(f"{qid}: the question ID appears twice.")
        seen_ids.add(qid)
        skill_id = str(row["Skill ID"]).strip()
        per_skill[skill_id] += 1
        if skill_id not in skill_ids:
            report.errors.append(f"{qid}: skill {skill_id} is not in the Skill Map.")
        key = answers.get(qid)
        guide = guides.get(qid, {})
        if key is None or _clean(key.get("Correct Answer")) is None:
            report.errors.append(f"{qid}: there is no correct answer in the Answer Key.")
            correct = ""
        else:
            correct = str(key["Correct Answer"]).strip()

        stem = str(row.get("Question") or "").strip()
        match = _NAME_PREFIX.match(stem)
        if match and match.group(1) not in _NOT_NAMES:
            report.stripped_names[match.group(1)] += 1
            stem = stem[match.end():].strip()
        if not stem:
            report.errors.append(f"{qid}: the question has no wording.")
        stems[stem.lower()] += 1

        qtype = _TYPE_MAP.get(str(row["Question Type"]).strip(), str(row["Question Type"]).strip())
        if qtype not in ("Numeric Entry", "Text Entry", "Constructed Response"):
            report.errors.append(f"{qid}: question type {row['Question Type']!r} is not one the platform knows.")
        report.types[qtype] += 1
        try:
            marks = int(row["Marks"])
        except (TypeError, ValueError):
            report.errors.append(f"{qid}: marks {row['Marks']!r} is not a whole number.")
            marks = 1
        report.marks[marks] += 1

        if qtype == "Numeric Entry" and correct and _num(correct) is None:
            report.errors.append(f"{qid}: a Numeric Entry answer {correct!r} is not a number.")
        if qtype == "Numeric Entry":
            expected = _recompute(stem)
            if expected is not None:
                report.arithmetic_checked += 1
                got = _num(correct)
                if got is not None and abs(got - expected) > Decimal("0.0001"):
                    report.errors.append(f"{qid}: the key says {correct} but {stem} is {expected.normalize()}.")

        unit_text = _clean(row.get("Expected Unit"))
        answer_unit = unit_rule = None
        if unit_text:
            code = units.unit_code(unit_text)
            if code is None and unit_text.lower() in COUNT_NOUNS:
                report.counted_nouns += 1
            elif code is None and " and " in unit_text:
                report.two_part += 1  # "kg and g": needs the two-box answer slice
            elif code is None:
                report.warnings.append(f"{qid}: the unit {unit_text!r} is not one marking knows; no unit rule was set.")
            else:
                answer_unit, unit_rule = code, "Required"
                report.units[code] += 1
        decimal_places = None
        rounding = _clean(row.get("Rounding Rule"))
        if rounding and "nearest" in rounding.lower() and "whole" in rounding.lower():
            decimal_places = 0

        teacher_note = None
        if qtype == "Constructed Response":
            parts = [_clean(guide.get("Rubric")), _clean(guide.get("Teacher Note"))]
            teacher_note = " ".join(p for p in parts if p) or None
            if len(correct.split()) <= 3:
                report.short_written += 1
        day, form = row.get("Day"), str(row.get("Form") or "").strip()
        assignment = f"L{report.lesson_no:02d}-D{int(day)}{form}"
        response_format = {"Numeric Entry": "Number and unit" if answer_unit else "Number",
                           "Text Entry": "Short text", "Constructed Response": "Written explanation or working"}.get(qtype)
        ws.append([
            qid, BOARD_DISPLAY_NAME, class_level, subject, report.lesson_no, report.lesson_title, skill_id,
            str(row["Skill"]).strip(), assignment, str(row.get("Stage") or "").strip(), None,
            str(row["Skill"]).strip(), qtype, stem, None, None, None, None, correct, None, None,
            _clean(key.get("Explanation")) if key else None, None, marks, 180 if marks >= 3 else 60,
            "No" if qtype == "Constructed Response" else "Yes", "No", response_format, "None",
            teacher_note, "Draft", f"{source_label}; lesson {report.lesson_no} {report.lesson_title}; school textbook to map",
            answer_unit, unit_rule, "No" if answer_unit else None, None, decimal_places, None,
        ])

    for skill_id in skill_ids:
        if per_skill[skill_id] != 25:
            report.warnings.append(f"Skill {skill_id} has {per_skill[skill_id]} questions, not 25.")
    report.repeated_stems = sum(n - 1 for n in stems.values() if n > 1)

    sm = out.create_sheet("Skill Map")
    sm.append(SM_HEADERS)
    for row in skill_rows:
        sm.append([
            str(row["Skill ID"]).strip(), str(row["Skill"]).strip(), _clean(row.get("Official Theme")),
            _clean(row.get("Prerequisite Skill")), None, per_skill[str(row["Skill ID"]).strip()],
        ])
    dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(dst)
    return report
