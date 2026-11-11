"""Applies an approved content-edits workbook to the question bank (#218).

Why this exists (11 Nov 2026). Ashalatha's conditional approval of 10 Nov
asked for many kinds of change at once: accepted answers, the six unit
fields, marks, wording, hints, explanations, marking guides, questions
split into steps, Chapter 10 rewritten as mirror work on a drawn grid,
items labelled Challenge, skill names. The earlier loaders each set one
field. This one sets any of them from one workbook Krama builds from her
decisions, with the same safety as the others.

The workbook (SE_Class_5_Content_Edits_*.xlsx):
  "Edits":        Question ID | Field | Current | New | Condition | Why
                  One field of one question. Current is what the question
                  should hold now; the row is applied only if it does (or is
                  skipped if the question already holds New).
  "Rewrites":     Question ID | Current Question | Current Answer | Condition |
                  then one column per field to write (blank cells are written
                  as empty). The question is rewritten only if its wording and
                  correct answer are still the ones in the sheet.
  "New Questions": Question ID | After | Condition | then the fields. Added
                  to the same skill as the question named in After, with its
                  status, and placed straight after it in every practice set
                  that holds it.
  "Skill Names":  Skill ID | Current Name | New Name.

Fields are named as in the chapter workbooks: Question Stem, Option A to D,
Correct Answer, Accepted Variants, Hint, Step-by-Step Explanation,
Misconception Tag, Marks, Question Type, Response Format, Media Required,
Teacher Note, Stage, Auto-gradable, Answer Unit, Unit Rule, Allow
Conversion, Tolerance, Decimal Places, Unit Mark, Figure.

What it does, and why it is safe to run:
  * Checks every row before anything is written. If any row fails, it
    stops and changes nothing, listing every problem.
  * After the changes (still before saving), every auto-marked question it
    touched must mark its own correct answer and every accepted answer
    right; if not, nothing is saved.
  * Without --apply it only reports what would change.
  * With --apply it writes in ONE transaction with one audit-log entry
    ("curriculum.content_edits.applied") holding every old and new value.
  * Running it again is harmless: what is already set is counted, not
    written again.

Run apply_misconception_reviews.py with her decided notes BEFORE this
script: it checks the notes still match, and this one rewrites some.

Usage (from backend/, DATABASE_URL set to the production database):
    python scripts/apply_content_edits.py --workbook "C:\\path\\to\\SE_Class_5_Content_Edits_11Nov.xlsx"
    python scripts/apply_content_edits.py --workbook "..." --apply
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

AUDIT_EVENT = "curriculum.content_edits.applied"

# Workbook field -> Question attribute.
FIELDS = {
    "Question Stem": "stem",
    "Option A": "option_a",
    "Option B": "option_b",
    "Option C": "option_c",
    "Option D": "option_d",
    "Correct Answer": "correct_answer",
    "Accepted Variants": "accepted_variants",
    "Hint": "hint",
    "Step-by-Step Explanation": "explanation",
    "Misconception Tag": "misconception_tag",
    "Marks": "marks",
    "Question Type": "question_type",
    "Response Format": "response_format",
    "Media Required": "media_required",
    "Teacher Note": "teacher_note",
    "Stage": "stage",
    "Auto-gradable": "auto_gradable",
    "Answer Unit": "answer_unit",
    "Unit Rule": "unit_rule",
    "Allow Conversion": "allow_unit_conversion",
    "Tolerance": "numeric_tolerance",
    "Decimal Places": "decimal_places",
    "Unit Mark": "unit_mark",
    "Figure": "figure",
}
MARKING = {"answer_unit", "unit_rule", "allow_unit_conversion", "numeric_tolerance", "decimal_places", "unit_mark"}
QUESTION_TYPES = ("Single Select", "Multi Select", "Numeric Entry", "Text Entry", "Ordering", "Constructed Response")


class StopBeforeWriting(Exception):
    """Something that must stop the run before it changes anything."""


def _text(value) -> str:
    return "" if value is None else str(value).strip()


def _norm(value) -> str:
    text = " ".join(_text(value).split())
    return "" if text in ("—", "-") else text


def to_stored(attribute: str, raw):
    """A workbook value as the Question attribute stores it, or raises
    ValueError with the reason in words."""
    from app.services import figures
    from app.services.learning_service import clean_marking_fields

    text = _text(raw)
    if attribute in MARKING:
        values, problems = clean_marking_fields({attribute: raw if text else None})
        if problems:
            raise ValueError(problems[0][1])
        return values.get(attribute)
    if attribute == "marks":
        try:
            marks = int(float(text))
        except ValueError:
            raise ValueError("Marks must be a whole number.") from None
        if not 0 <= marks <= 20:
            raise ValueError("Marks must be from 0 to 20.")
        return marks
    if attribute == "auto_gradable":
        if text.lower() in ("yes", "y", "true", "1"):
            return True
        if text.lower() in ("no", "n", "false", "0"):
            return False
        raise ValueError("Auto-gradable must be Yes or No.")
    if attribute == "question_type":
        if text not in QUESTION_TYPES:
            raise ValueError(f"Question Type must be one of: {', '.join(QUESTION_TYPES)}.")
        return text
    if attribute == "figure":
        if not text:
            return None
        try:
            return json.dumps(figures.check(text))
        except figures.FigureError as exc:
            raise ValueError(f"The figure cannot be drawn: {exc}") from None
    if attribute in ("stem", "correct_answer") and not text:
        raise ValueError("The question and its correct answer cannot be empty.")
    return text or None


def same_stored(attribute: str, now, value) -> bool:
    if attribute == "figure":
        try:
            return json.loads(now or "null") == json.loads(value or "null")
        except ValueError:
            return False
    if isinstance(value, bool) or isinstance(now, bool):
        return bool(now) == bool(value)
    return _norm(now) == _norm(value)


@dataclass
class Plan:
    edits: list = field(default_factory=list)  # (question, attribute, old, new, condition)
    rewrites: list = field(default_factory=list)  # (question, {attribute: value}, condition)
    new: list = field(default_factory=list)  # (after_question, code, {attribute: value}, condition)
    skills: list = field(default_factory=list)  # (lesson, new_name)
    already: Counter = field(default_factory=Counter)


def _sheet(workbook, name):
    if name not in workbook.sheetnames:
        return None, []
    rows = workbook[name].iter_rows(values_only=True)
    header = [_text(c) for c in next(rows, ())]
    return header, [dict(zip(header, r)) for r in rows if any(v is not None for v in r)]


def read_and_plan(db, path: str, *, lock: bool = False) -> Plan:
    import openpyxl

    from app.models import ConceptLesson, Question

    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    problems: list[str] = []
    plan = Plan()
    _, edit_rows = _sheet(workbook, "Edits")
    rewrite_header, rewrite_rows = _sheet(workbook, "Rewrites")
    new_header, new_rows = _sheet(workbook, "New Questions")
    _, skill_rows = _sheet(workbook, "Skill Names")
    workbook.close()
    if not (edit_rows or rewrite_rows or new_rows or skill_rows):
        raise StopBeforeWriting("The workbook has no Edits, Rewrites, New Questions or Skill Names rows.")

    codes = {_text(r.get("Question ID")) for r in edit_rows + rewrite_rows} | {_text(r.get("After")) for r in new_rows} | {_text(r.get("Question ID")) for r in new_rows}
    query = db.query(Question).filter(Question.code.in_(codes - {""}), Question.origin == "BANK")
    if lock:
        query = query.with_for_update()
    by_code = {q.code: q for q in query.all()}

    rewritten = {_text(r.get("Question ID")) for r in rewrite_rows}
    for number, row in enumerate(edit_rows, start=2):
        code, label = _text(row.get("Question ID")), _text(row.get("Field"))
        where = f"Edits row {number} ({code}, {label})"
        question = by_code.get(code)
        attribute = FIELDS.get(label)
        if question is None:
            problems.append(f"{where}: not in the database.")
            continue
        if attribute is None:
            problems.append(f"{where}: {label} is not a field this script sets.")
            continue
        if code in rewritten:
            problems.append(f"{where}: this question is also on the Rewrites sheet; change it in one place.")
            continue
        try:
            current = to_stored(attribute, row.get("Current")) if _text(row.get("Current")) or attribute not in ("stem", "correct_answer") else None
            new = to_stored(attribute, row.get("New"))
        except ValueError as exc:
            problems.append(f"{where}: {exc}")
            continue
        now = getattr(question, attribute)
        if same_stored(attribute, now, new):
            plan.already["edits"] += 1
        elif same_stored(attribute, now, current) or (attribute in MARKING and now in (None, False) and current in (None, False)):
            plan.edits.append((question, attribute, now, new, _text(row.get("Condition"))))
        else:
            problems.append(f"{where}: it now holds something else than the sheet expects, so it is left for a fresh look.")

    fields_in = lambda header: [h for h in header if h in FIELDS]  # noqa: E731
    for number, row in enumerate(rewrite_rows, start=2):
        code = _text(row.get("Question ID"))
        where = f"Rewrites row {number} ({code})"
        question = by_code.get(code)
        if question is None:
            problems.append(f"{where}: not in the database.")
            continue
        values = {}
        try:
            for label in fields_in(rewrite_header):
                values[FIELDS[label]] = to_stored(FIELDS[label], row.get(label))
        except ValueError as exc:
            problems.append(f"{where}: {exc}")
            continue
        if all(same_stored(a, getattr(question, a), v) for a, v in values.items()):
            plan.already["rewrites"] += 1
            continue
        if _norm(question.stem) != _norm(row.get("Current Question")) or _norm(question.correct_answer) != _norm(row.get("Current Answer")):
            problems.append(f"{where}: its wording or correct answer has changed since the sheet was made.")
            continue
        plan.rewrites.append((question, values, _text(row.get("Condition"))))

    planned_new: set[str] = set()
    for number, row in enumerate(new_rows, start=2):
        code, after_code = _text(row.get("Question ID")), _text(row.get("After"))
        where = f"New Questions row {number} ({code})"
        after = by_code.get(after_code) or (after_code if after_code in planned_new else None)
        if after is None:
            problems.append(f"{where}: the question it follows, {after_code}, is not in the database or earlier on this sheet.")
            continue
        values = {}
        try:
            for label in fields_in(new_header):
                values[FIELDS[label]] = to_stored(FIELDS[label], row.get(label))
        except ValueError as exc:
            problems.append(f"{where}: {exc}")
            continue
        existing = by_code.get(code)
        if existing is not None:
            if all(same_stored(a, getattr(existing, a), v) for a, v in values.items()):
                plan.already["new"] += 1
            else:
                problems.append(f"{where}: a question with this ID already exists with other content.")
            continue
        plan.new.append((after, code, values, _text(row.get("Condition"))))
        planned_new.add(code)

    if skill_rows:
        lessons = {l.code: l for l in db.query(ConceptLesson).filter(ConceptLesson.code.in_([_text(r.get("Skill ID")) for r in skill_rows]))}
        for number, row in enumerate(skill_rows, start=2):
            code, new_name = _text(row.get("Skill ID")), _text(row.get("New Name"))
            where = f"Skill Names row {number} ({code})"
            lesson = lessons.get(code)
            if lesson is None:
                problems.append(f"{where}: no such skill.")
            elif not new_name or len(new_name) > 200:
                problems.append(f"{where}: the new name must be 1 to 200 characters.")
            elif _norm(lesson.title) == _norm(new_name):
                plan.already["skills"] += 1
            elif _norm(lesson.title) != _norm(row.get("Current Name")):
                problems.append(f"{where}: its name has changed since the sheet was made.")
            else:
                plan.skills.append((lesson, new_name))
    if problems:
        raise StopBeforeWriting("\n".join(problems))
    return plan


def apply_plan(db, plan: Plan, *, workbook_name: str, workbook_sha256: str) -> dict:
    import uuid

    from app.models import LearningActivityQuestion, Question
    from app.services.audit_service import log_audit_event
    from app.services.learning_service import grade_answer

    changes, touched = [], {}
    for question, attribute, old, new, condition in plan.edits:
        setattr(question, attribute, new)
        changes.append({"code": question.code, "field": attribute, "old": old, "new": new, "condition": condition})
        touched[question.code] = question
    for question, values, condition in plan.rewrites:
        for attribute, value in values.items():
            old = getattr(question, attribute)
            if not same_stored(attribute, old, value):
                setattr(question, attribute, value)
                changes.append({"code": question.code, "field": attribute, "old": old, "new": value, "condition": condition})
        touched[question.code] = question
    added: dict = {}
    for after, code, values, condition in plan.new:
        if isinstance(after, str):  # a question added earlier in this run
            after = added[after]
        question = Question(id=str(uuid.uuid4()), code=code, concept_lesson_id=after.concept_lesson_id, origin="BANK",
                            assignment_code=after.assignment_code, difficulty=after.difficulty, competency=after.competency,
                            source_alignment=after.source_alignment, status=after.status, time_seconds=after.time_seconds,
                            shuffle_options=False, misconception_tag=after.misconception_tag)
        for attribute, value in values.items():
            setattr(question, attribute, value)
        if question.stage is None:
            question.stage = after.stage
        db.add(question)
        db.flush()
        for link in db.query(LearningActivityQuestion).filter_by(question_id=after.id).all():
            later = db.query(LearningActivityQuestion).filter(
                LearningActivityQuestion.learning_activity_id == link.learning_activity_id,
                LearningActivityQuestion.sequence > link.sequence,
            ).all()
            for other in later:
                other.sequence += 1
            db.add(LearningActivityQuestion(learning_activity_id=link.learning_activity_id, question_id=question.id, sequence=link.sequence + 1))
        changes.append({"code": code, "field": "*", "old": None, "new": "added after " + after.code, "condition": condition})
        touched[code] = question
        added[code] = question
    for lesson, new_name in plan.skills:
        changes.append({"code": lesson.code, "field": "skill name", "old": lesson.title, "new": new_name, "condition": "B9"})
        lesson.title = new_name
    db.flush()
    failures = []
    for code, question in touched.items():
        if not question.auto_gradable or question.question_type in ("Single Select", "Multi Select", "Constructed Response"):
            continue
        for given in [question.correct_answer] + [v for v in (question.accepted_variants or "").split("|") if v.strip()]:
            if grade_answer(question, given)[0] is not True:
                failures.append(f'{code}: "{given}" would be marked wrong.')
    if failures:
        db.rollback()
        raise StopBeforeWriting("Nothing was saved. After the change:\n" + "\n".join(failures[:50]))
    log_audit_event(
        db, AUDIT_EVENT,
        details={"workbook": workbook_name, "workbookSha256": workbook_sha256, "changes": len(changes),
                 "questionsTouched": len(touched), "byCondition": dict(Counter(c["condition"] for c in changes)), "detail": changes},
    )
    db.commit()
    return {"changes": len(changes), "questions": len(touched)}


def _summary(plan: Plan) -> str:
    by = Counter(c for *_, c in plan.edits) + Counter(c for *_, c in plan.rewrites) + Counter(c for *_, c in plan.new)
    lines = [
        f"To change: {len(plan.edits)} fields, {len(plan.rewrites)} questions rewritten, {len(plan.new)} questions added, {len(plan.skills)} skill names.",
        f"Already as decided: {plan.already['edits']} fields, {plan.already['rewrites']} rewrites, {plan.already['new']} added, {plan.already['skills']} skill names.",
    ]
    if by:
        lines.append("By condition: " + ", ".join(f"{k} {v}" for k, v in sorted(by.items())))
    return "\n".join(lines)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--workbook", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    path = Path(args.workbook)
    if not path.is_file():
        print(f"There is no file at {path}.")
        return 2
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        plan = read_and_plan(db, str(path))
        print(_summary(plan))
        if not args.apply:
            print("Nothing written. Run again with --apply to make these changes.")
            return 0
        if input("Type YES to write these changes: ").strip() != "YES":
            print("Nothing written.")
            return 1
        db.close()
        db = SessionLocal()  # fresh connection after the wait, checked again and locked
        plan = read_and_plan(db, str(path), lock=True)
        done = apply_plan(db, plan, workbook_name=path.name, workbook_sha256=digest)
        print(f"Saved: {done['changes']} changes to {done['questions']} questions.")
        return 0
    except StopBeforeWriting as exc:
        db.rollback()
        print("Nothing was written:\n" + str(exc))
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
