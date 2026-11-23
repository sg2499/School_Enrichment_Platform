"""Moves an ICSE measured answer from Required to Stated where the question
itself names the unit (A-047, 23 Nov 2026).

Why this exists. Ashalatha's decision (16 Nov 2026, KRAMA-CISCE-C5M-DECISIONS
-v1.0) is that a locked unit sits beside the answer box and the child types
the number only; where the question does not say which unit, the child types
the unit too (his call, 17 Nov: "the unit is a must"). The converter reads
that from the workbook's "Input Mode" column. The ICSE 16-column layout has
no such column, so every ICSE measured answer fell through to Required --
5,117 of them, not one of them CBSE, because the CBSE Class 7 files do have
the column and their locked units are already Stated. Among them are
questions that have already named the unit, such as "Add 1770 m and 994 m.
Give the answer in metres.", where a Class 5 child doing one mark of
arithmetic must also type "m" and an ICSE child carries a rule a CBSE child
does not.

cisce_converter.py now reads the wording when there is no Input Mode column,
so files converted from here on are right. This script is for the questions
already loaded.

Why not re-import the converted workbooks: the importer rewrites every field
of every question from the file, its status included, so a re-import could
undo anything changed in Curriculum Studio since and take published
questions back to the file's status (the same reason
scripts/apply_answer_units.py exists). This script changes one field, Unit
Rule, and nothing else.

What it does, in order, and why it is safe to run:

  * Finds every question whose stored Unit Rule is Required, that has an
    Answer Unit recorded, **whose mark the rule actually decides**, and
    whose own wording names that same unit --
    the scope being the marker's own test
    (learning_service.uses_measured_marking) and not a question-type string
    of this script's own, so it cannot drift from what marking does. A
    teacher-marked answer ("Show all working and explain your reasoning")
    and a Text Entry answer are left alone: there the rule decides no mark,
    the teacher's judgement stands, and moving it would only alter the
    record of his 17 Nov call on written work. The wording is
    read by app/services/unit_reader.py, the module that has done this since
    13 Oct 2026 and whose 380 reads were checked by hand. Only an exact
    agreement counts: where the reader is unsure it says nothing, and the
    question stays Required. A wording that names a DIFFERENT unit from the
    one recorded is never changed either; it is reported, because one of the
    two is wrong and that is a content question, not a marking one.
  * Without --apply it only reports what would change, with a breakdown by
    board, class and chapter and every question's wording. Nothing is
    written.
  * With --apply it writes in ONE transaction and then re-marks every
    changed question's own correct answer three ways: as the key is written,
    as a bare number, and with the unit after it. All three must be right
    under Stated -- the number alone is the point of the change, and the
    number with its unit must not become wrong. If any fails, the
    transaction is rolled back untouched.
  * One audit-log entry ("curriculum.icse_unit_rules.applied") records every
    question's old and new value, so the change can be traced and undone.
  * Running it again is harmless: a question already Stated is not selected.

Usage (from backend/, with DATABASE_URL set to the production database, as
for scripts/apply_answer_units.py):
    python scripts/apply_icse_unit_rules.py
    python scripts/apply_icse_unit_rules.py --apply
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

AUDIT_EVENT = "curriculum.icse_unit_rules.applied"


class StopBeforeWriting(Exception):
    """Something that must stop the run before it changes anything."""


DEFAULT_BOARDS = ("ICSE", "CISCE")


@dataclass
class Plan:
    to_change: list = field(default_factory=list)  # (question, read_unit)
    disagreed: list = field(default_factory=list)  # (question, read_unit) -- reported, never changed
    unread: int = 0  # the wording does not name the unit: stays Required
    out_of_scope: int = 0  # the rule decides no mark on this question
    by_group: Counter = field(default_factory=Counter)
    formats_reset: int = 0


def _text(value) -> str:
    return "" if value is None else str(value).strip()


def make_plan(db, *, boards=DEFAULT_BOARDS, lock: bool = False) -> Plan:
    """What would change. With lock=True the questions are locked until the
    transaction ends (Postgres SELECT ... FOR UPDATE), so nothing can change
    them between this check and the write.

    Scoped to the boards given, through the question's own chain up to its
    Board (Question -> ConceptLesson -> Chapter -> BoardCourse -> Board),
    not by reading its code: the codes in the content are not all of one
    shape ("CISCE-C5-CH01-Q001", but also "C5-OPS-Q007"). The scope
    matters. The 1,270 CBSE Class 5 questions whose Answer Unit and Unit
    Rule Ashalatha reviewed row by row on 13 Oct 2026 (#180,
    scripts/apply_answer_units.py) hold her own decisions, and a Required
    she chose is not this script's to overturn."""
    from app.models import Board, BoardCourse, Chapter, ConceptLesson, Question
    from app.services import unit_reader, units
    from app.services.learning_service import marking_rule, uses_measured_marking

    plan = Plan()
    query = (
        db.query(Question)
        .join(ConceptLesson, Question.concept_lesson_id == ConceptLesson.id)
        .join(Chapter, ConceptLesson.chapter_id == Chapter.id)
        .join(BoardCourse, Chapter.board_course_id == BoardCourse.id)
        .join(Board, BoardCourse.board_id == Board.id)
        .filter(Board.code.in_(tuple(boards)))
        .filter(Question.unit_rule.isnot(None), Question.answer_unit.isnot(None))
    )
    if lock:
        query = query.with_for_update(of=Question)
    for question in query.all():
        if _text(question.unit_rule).upper() != "REQUIRED":
            continue
        recorded = units.unit_code(_text(question.answer_unit))
        if recorded is None:
            continue  # a unit marking does not know: not this script's business
        # Only where the rule decides a mark. A-047 is a child scoring 0 for
        # the right number, and that can only happen where the platform
        # marks the answer against the unit -- the marker's own test, not a
        # question-type string, so this cannot drift from it. On a
        # teacher-marked question ("Show all working and explain your
        # reasoning", 27 of them) and on a Text Entry answer (23) the rule
        # plays no part in the mark, the teacher's judgement stands, and
        # moving it would be a change to his 17 Nov call on written work
        # for no gain.
        if not question.auto_gradable or not uses_measured_marking(question, marking_rule(question)):
            plan.out_of_scope += 1
            continue
        read = unit_reader.answer_unit_from_question(question.stem)
        if read is None:
            plan.unread += 1
        elif read == recorded:
            plan.to_change.append((question, read))
            plan.by_group[_group(question)] += 1
            if _text(question.response_format).lower() == "number and unit":
                plan.formats_reset += 1
        else:
            plan.disagreed.append((question, read))
    return plan


def _group(question) -> str:
    """Where a question sits, for the report: its chapter's board course and
    the chapter, read from the chain rather than from its code."""
    lesson = getattr(question, "concept_lesson", None)
    chapter = getattr(lesson, "chapter", None)
    if chapter is None:
        return "?"
    course = getattr(chapter, "board_course", None)
    board = getattr(course, "board", None)
    return f"{getattr(board, 'code', '?')} {getattr(course, 'code', '?')}"


def check_keys_still_right(changed) -> list[str]:
    """Every changed question's own correct answer must still be marked
    right under Stated: as the key is written, as a bare number, and with
    the unit written after it. The bare number is the whole point of the
    change; the other two must not become wrong because of it."""
    from app.services import units
    from app.services.learning_service import grade_answer

    failures = []
    for question, _read in changed:
        key = _text(question.correct_answer)
        attempts = [key]
        measured = units.parse_measurement(key)
        if measured is not None:
            # format(..., "f") and not str(): str() gives "1E+2" for a round
            # hundred, which no child types and nothing marks right.
            bare = format(measured.number.normalize(), "f")
            label = units.unit_label(question.answer_unit, plural=measured.number != 1)
            attempts.extend([bare, f"{bare} {question.answer_unit}", f"{bare} {label}"])
        for given in dict.fromkeys(a for a in attempts if a):
            is_correct, _score = grade_answer(question, given)
            if is_correct is None:
                # Not a skip. Every question here was selected because the
                # marker marks it, so "no verdict" means the selection and
                # the marker disagree, and nothing should be written until
                # that is understood.
                failures.append(
                    f"{question.code}: the platform gives no verdict on \"{given}\", "
                    "so it is not auto-marked after all."
                )
            elif not is_correct:
                failures.append(f'{question.code}: "{given}" would be marked wrong.')
    return failures


def apply_plan(db, plan: Plan) -> None:
    """Writes the plan in one transaction; rolls back if any answer key
    would be marked wrong afterwards."""
    from app.services.audit_service import log_audit_event

    changes = []
    for question, read in plan.to_change:
        change = {
            "code": question.code,
            "old": question.unit_rule,
            "new": "STATED",
            "unitReadFromWording": read,
        }
        question.unit_rule = "STATED"
        # The converter writes "Number and unit" only for a Required unit,
        # and "Number" otherwise, so a row that moves takes the Response
        # Format that matches. Nothing in marking reads this field once a
        # Unit Rule is stored (learning_service.default_unit_rule is the
        # fallback for a row with no rule at all, and "Number and unit"
        # means NONE there as "Number" does); it is what a reviewer is
        # shown, and it would otherwise say the child types the unit while
        # the rule says it is given.
        if _text(question.response_format).lower() == "number and unit":
            change["oldResponseFormat"] = question.response_format
            question.response_format = "Number"
        changes.append(change)
    db.flush()
    failures = check_keys_still_right(plan.to_change)
    if failures:
        db.rollback()
        raise StopBeforeWriting("Nothing was saved. After the change:\n" + "\n".join(failures))
    log_audit_event(
        db,
        AUDIT_EVENT,
        details={
            "questionsChanged": len(changes),
            "questionsLeftRequired": plan.unread,
            "questionsWhereWordingDisagrees": len(plan.disagreed),
            "changes": changes,
        },
    )
    db.commit()


def _report(plan: Plan, *, examples: int) -> None:
    from app.services import units

    print(f"Required questions whose wording names the recorded unit: {len(plan.to_change)}")
    if plan.by_group:
        print("  " + ", ".join(f"{group} {n}" for group, n in sorted(plan.by_group.items())))
    print(f'  of those, Response Format "Number and unit" -> "Number": {plan.formats_reset}')
    print(f"Required questions whose wording does not name it (left Required): {plan.unread}")
    print(f"Required questions where the rule decides no mark (not touched): {plan.out_of_scope}")
    if plan.disagreed:
        print(f"\nWording names a DIFFERENT unit from the one recorded: {len(plan.disagreed)}")
        print("Not changed. One of the two is wrong, so these need a content decision:")
        for question, read in plan.disagreed:
            recorded = units.unit_label(question.answer_unit) or question.answer_unit
            print(f"  {question.code}: recorded {recorded}, wording says {units.unit_label(read) or read}")
            print(f"      {_text(question.stem)[:150]}")
    if plan.to_change and examples:
        print(f"\nFirst {min(examples, len(plan.to_change))} to change:")
        for question, read in plan.to_change[:examples]:
            print(f"  {question.code} ({units.unit_label(read) or read}, {question.marks} mark)")
            print(f"      {_text(question.stem)[:150]}")
            print(f"      key: {_text(question.correct_answer)}")


def mask_database_url(url: str) -> str:
    if "@" not in url:
        return url
    scheme_and_creds, host_and_rest = url.rsplit("@", 1)
    scheme = scheme_and_creds.split("://", 1)[0] if "://" in scheme_and_creds else ""
    return f"{scheme}://***:***@{host_and_rest}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="Write the changes. Without it, only report.")
    parser.add_argument("--yes", action="store_true", help="With --apply, skip the typed confirmation.")
    parser.add_argument("--examples", type=int, default=20, help="How many questions to print in the report.")
    parser.add_argument(
        "--board", action="append", dest="boards", metavar="CODE",
        help=f"Board code to include; repeatable. Default: {', '.join(DEFAULT_BOARDS)}.",
    )
    args = parser.parse_args()
    boards = tuple(args.boards) if args.boards else DEFAULT_BOARDS

    from app.database import SessionLocal, engine

    db_url = str(engine.url)
    print(f"Target database: {mask_database_url(db_url)}")
    if "sqlite" in db_url:
        print("NOTE: DATABASE_URL is not set (or points at SQLite), so this is not production.")
    print(f"Boards: {', '.join(boards)}")
    print()

    db = SessionLocal()
    try:
        plan = make_plan(db, boards=boards)
        _report(plan, examples=args.examples)
        if not args.apply:
            print("\nReport only: nothing was written. Run again with --apply to record these.")
            return 0
        if not plan.to_change:
            print("\nNothing to change.")
            return 0
        if not args.yes:
            confirm = input(f"\nType YES to move {len(plan.to_change)} questions to Stated: ")
            if confirm.strip() != "YES":
                print("Stopped: nothing was written.")
                return 1
        # Check again now, with the questions locked, in case one was edited
        # in Curriculum Studio while the prompt was waiting.
        db.rollback()
        plan = make_plan(db, boards=boards, lock=True)
        apply_plan(db, plan)
        print(f"\nDone: {len(plan.to_change)} questions moved to Stated, each one's correct answer re-marked right.")
        return 0
    except StopBeforeWriting as stop:
        print(f"\nStopped before writing anything:\n{stop}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
