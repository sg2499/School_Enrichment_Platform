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
                  to the same skill as the question named in After, as a
                  DRAFT. It is NOT put into any practice set by this script
                  (#262, 27 Nov 2026): it used to copy the neighbour's status
                  and write itself into every set holding it, published sets
                  included, which put a question nobody had read in front of
                  children. It reaches a set the way every other question
                  does -- approved in Curriculum Studio, then linked when the
                  chapter is next published (Approve and Publish, or
                  publish_courses.py) or the Super Admin generate-activities
                  endpoint is called. The run prints which sets its neighbour
                  is in, and which of those are frozen by A-001 because they
                  are published and assigned.
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
    paired: list = field(default_factory=list)  # codes whose WORDING changed AND given a new question after (#262)
    where: list = field(default_factory=list)  # (new code, set title, frozen?) -- where the neighbour sits (#262)
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

    from app.models import Assignment, ConceptLesson, LearningActivity, LearningActivityQuestion, Question

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
    # Where each new question's neighbour sits. Worked out HERE, at plan
    # time, because the summary has to be readable before --apply: the point
    # of both reports below is that the person decides before the write.
    for after, code, *_ in plan.new:
        if isinstance(after, str):
            continue
        for activity in (
            db.query(LearningActivity)
            .join(LearningActivityQuestion, LearningActivityQuestion.learning_activity_id == LearningActivity.id)
            .filter(LearningActivityQuestion.question_id == after.id)
            .all()
        ):
            # The same test top_up_activity uses to leave a set alone, so the
            # report and the behaviour cannot disagree: published, with any
            # assignment row against it, whatever that assignment's status.
            frozen = activity.status == "PUBLISHED" and bool(
                db.query(Assignment.id).filter(Assignment.learning_activity_id == activity.id).first()
            )
            plan.where.append((code, activity.title, frozen))

    # A question SPLIT INTO STEPS arrives as a change to the original's
    # WORDING plus a New row for each new part, and since #262 the new parts
    # land as Drafts outside the set while the change goes live at once -- so
    # a child could get step 1 with no step 2.
    #
    # Flagged, not refused. The same shape is also perfectly innocent, and
    # nothing in the file says which it is, so refusing would block real work
    # on a guess while saying nothing would let a split go half-live. Only a
    # change to the stem or the correct answer can be a split: trimming the
    # accepted variants or the marks of a question that happens to have a new
    # one added after it cannot be, and a warning that cried wolf on those
    # would be ignored.
    reworded = {q.code for q, *_ in plan.rewrites}
    reworded |= {q.code for q, attribute, *_ in plan.edits if attribute in ("stem", "correct_answer")}
    plan.paired = sorted(
        {after.code for after, *_ in plan.new if not isinstance(after, str) and after.code in reworded}
    )

    if problems:
        raise StopBeforeWriting("\n".join(problems))
    return plan


def apply_plan(db, plan: Plan, *, workbook_name: str, workbook_sha256: str) -> dict:
    import uuid

    from app.models import Question
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
                            source_alignment=after.source_alignment, time_seconds=after.time_seconds,
                            shuffle_options=False, misconception_tag=after.misconception_tag)
        for attribute, value in values.items():
            setattr(question, attribute, value)
        if question.stage is None:
            question.stage = after.stage
        # #262. This used to copy the neighbour's status and then write the
        # set links by hand, so a question nobody had read could arrive
        # APPROVED inside a published set -- straight past the ready filter
        # A-001 put on the normal path. Two rules now, the same ones every
        # other new question lives under since A-035:
        #   * it lands as a DRAFT, whatever its neighbour is;
        #   * this script writes no LearningActivityQuestion rows at all.
        # It joins a set through generate_activities_for_chapter, which runs
        # when the chapter is next published or the Super Admin
        # generate-activities endpoint is called -- never from here, because
        # that function commits part-way and would break this script's
        # rollback.
        question.status = "DRAFT"
        db.add(question)
        db.flush()
        changes.append({"code": code, "field": "*", "old": None,
                        "new": f"added after {after.code} as a Draft, in no set",
                        "condition": condition})
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
        # A measured answer whose unit is Required is only right with its unit
        # ("840" alone loses the unit mark), so the key is also tried the way a
        # child types it: the number, then the recorded unit.
        required_unit = (question.unit_rule or "").strip().upper() == "REQUIRED" and (question.answer_unit or "").strip()
        for given in [question.correct_answer] + [v for v in (question.accepted_variants or "").split("|") if v.strip()]:
            if grade_answer(question, given)[0] is True:
                continue
            if required_unit and grade_answer(question, f"{given} {question.answer_unit.strip()}")[0] is True:
                continue
            failures.append(f'{code}: "{given}" would be marked wrong.')
    if failures:
        db.rollback()
        raise StopBeforeWriting("Nothing was saved. After the change:\n" + "\n".join(failures[:50]))
    log_audit_event(
        db, AUDIT_EVENT,
        details={"workbook": workbook_name, "workbookSha256": workbook_sha256, "changes": len(changes),
                 "questionsTouched": len(touched), "byCondition": dict(Counter(c["condition"] for c in changes)),
                 "newQuestionsAwaitingPlacement": [
                     {"code": c, "set": s, "frozen": f} for c, s, f in plan.where],
                 "changedAndGivenANewQuestionAfter": plan.paired,
                 "detail": changes},
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
    if plan.new:
        lines.append("")
        lines.append("A new question is added to the bank as a Draft, in no practice set (#262). To")
        lines.append("place it: approve it in Curriculum Studio, then publish the chapter again. It is")
        lines.append("then sorted into its set by skill and question code -- not necessarily straight")
        lines.append("after the question named in After.")
        for code, title, frozen in plan.where:
            lines.append(f"  {code} -> {title}: " + (
                "THIS SET IS PUBLISHED AND ALREADY ASSIGNED, so nothing can be added to it any more. "
                "The new question will never reach the children already working on it."
                if frozen else "this set takes it at the next chapter publish."))
        if not plan.where:
            lines.append("  Its neighbour is in no set, so there is nothing to report.")
    if plan.paired:
        frozen_codes = {c for c, _t, f in plan.where if f}
        lines.append("")
        lines.append("CHECK THESE BEFORE CHILDREN PRACTISE AGAIN. Each of these questions has its")
        lines.append("wording or answer changed AND a new question added after it, which is what a")
        lines.append("split into steps looks like. The change goes live at once while the new parts")
        lines.append("are Drafts outside the set, so a child could get the first step and not the")
        lines.append("second.")
        if frozen_codes:
            lines.append("At least one of the sets involved is published and assigned, so the new parts")
            lines.append("CANNOT be added to it at all -- putting the change back is the only remedy.")
        else:
            lines.append("Approve the new parts and publish the chapter to close that, or put the")
            lines.append("change back.")
        lines.append("If the two changes are unrelated, nothing is wrong.")
        for code in plan.paired:
            lines.append(f"  {code}")
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
