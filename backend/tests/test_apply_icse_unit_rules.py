"""scripts/apply_icse_unit_rules.py -- moves an ICSE measured answer from
Required to Stated where the question itself names the unit (A-047,
23 Nov 2026).

Runs the real script functions against a throwaway in-memory database with
the full chain a question hangs from (Board -> BoardCourse -> Chapter ->
ConceptLesson -> Question), because the script picks its questions by board
and not by reading their codes. The rules under test: only a Required row
whose wording names the recorded unit moves; a wording that names a
different unit is reported and left alone; a wording that names none is
left alone; CBSE is out of scope, so Ashalatha's own reviewed rules are
never touched; the moved rows' Response Format follows; a second run
changes nothing; a change that would mark a question's own correct answer
wrong is rolled back; one audit entry records every old and new value.
"""
import importlib.util
import json
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    AuditLog,
    Board,
    BoardCourse,
    Chapter,
    ClassLevel,
    ConceptLesson,
    CurriculumVersion,
    Discipline,
    Question,
    SubjectGroup,
)

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "apply_icse_unit_rules.py"
spec = importlib.util.spec_from_file_location("apply_icse_unit_rules", SCRIPT)
script = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = script  # dataclasses looks its module up here
spec.loader.exec_module(script)
StopBeforeWriting = script.StopBeforeWriting


def _chain(session, board_code: str) -> str:
    """One board's chain, returning the concept lesson's id."""
    suffix = board_code.lower()
    group = SubjectGroup(id=f"sg-{suffix}", code=f"MATHS-{suffix}", display_name="Mathematics")
    discipline = Discipline(
        id=f"d-{suffix}", code=f"MATH-{suffix}", display_name="Maths", subject_group_id=group.id
    )
    board = Board(id=f"b-{suffix}", code=board_code, display_name=board_code)
    level = ClassLevel(id=f"cl-{suffix}", code=f"C5-{suffix}", display_name="Class 5", display_order=5)
    course = BoardCourse(
        id=f"bc-{suffix}", board_id=board.id, class_level_id=level.id,
        code=f"{board_code}-C5", display_name=f"{board_code} Class 5",
    )
    version = CurriculumVersion(id=f"v-{suffix}", board_id=board.id, code=f"V1-{suffix}", label="2026")
    chapter = Chapter(
        id=f"ch-{suffix}", discipline_id=discipline.id, board_course_id=course.id,
        curriculum_version_id=version.id, code=f"CH01-{suffix}", chapter_no=1, title="Measures",
    )
    lesson = ConceptLesson(id=f"cl1-{suffix}", chapter_id=chapter.id, code=f"L01-{suffix}", title="Lesson 1")
    session.add_all([group, discipline, board, level, course, version, chapter, lesson])
    return lesson.id


def _question(lesson_id, code, stem, answer, unit, rule="REQUIRED", response_format="Number and unit",
              question_type="Numeric Entry", marks=1, auto_gradable=True):
    return Question(
        concept_lesson_id=lesson_id, code=code, question_type=question_type, stem=stem,
        correct_answer=answer, marks=marks, auto_gradable=auto_gradable, answer_unit=unit, unit_rule=rule,
        response_format=response_format,
    )


# The rule decides no mark on these, so they are out of scope however well
# their wording names the unit. The production run of 23 Nov tripped on the
# Constructed Response ones: the platform gives no verdict on a
# teacher-marked answer, the strict re-mark read that as "would be marked
# wrong", and the whole run rolled back.
OUT_OF_SCOPE = [
    ("CISCE-C5-CH01-Q101", "Show all working and explain your reasoning. Convert 49800 cm to metres.",
     "498", "m", "Constructed Response", 3, False, "Written explanation or working"),
    ("CISCE-C5-CH01-Q102", "Convert 2 km to metres.", "2000", "m", "Text Entry", 1, True, "Short text"),
]


# The wording names the recorded unit: these move.
NAMED = [
    ("CISCE-C5-CH01-Q001", "Add 1770 m and 994 m. Give the answer in metres.", "2764", "m"),
    ("C5-OPS-Q007", "Convert 420 seconds to minutes.", "7", "min"),
]
# The wording names no unit: these stay Required.
SILENT = [("CISCE-C5-CH01-Q003", "Find its length.", "12", "m")]
# The wording names a different unit from the one recorded: reported only.
DISAGREES = [("CISCE-C5-CH01-Q004", "Find the elapsed time in minutes.", "90", "s")]


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, future=True)()
    icse = _chain(session, "ICSE")
    cbse = _chain(session, "CBSE")
    for code, stem, answer, unit in NAMED + SILENT + DISAGREES:
        session.add(_question(icse, code, stem, answer, unit))
    for code, stem, answer, unit, qtype, marks, auto, fmt in OUT_OF_SCOPE:
        session.add(_question(icse, code, stem, answer, unit, question_type=qtype, marks=marks,
                              auto_gradable=auto, response_format=fmt))
    # Ashalatha's own Required, on a CBSE question whose wording DOES name
    # the unit: out of scope, so it must not move (#180).
    session.add(_question(cbse, "CBSE-C5-CH05-Q034", "Add 2 m and 3 m. Give the answer in metres.", "5", "m"))
    session.commit()
    yield session
    session.close()


def test_only_a_wording_that_names_the_recorded_unit_moves(db):
    plan = script.make_plan(db)
    assert sorted(q.code for q, _read in plan.to_change) == sorted(code for code, *_ in NAMED)
    assert plan.unread == len(SILENT)
    assert [q.code for q, _read in plan.disagreed] == [DISAGREES[0][0]]


def test_cbse_is_out_of_scope(db):
    plan = script.make_plan(db)
    assert "CBSE-C5-CH05-Q034" not in [q.code for q, _read in plan.to_change]
    script.apply_plan(db, plan)
    kept = db.query(Question).filter(Question.code == "CBSE-C5-CH05-Q034").one()
    assert kept.unit_rule == "REQUIRED"
    assert kept.response_format == "Number and unit"


def test_the_rule_and_the_response_format_both_move(db):
    plan = script.make_plan(db)
    assert plan.formats_reset == len(NAMED)
    script.apply_plan(db, plan)
    for code, *_rest in NAMED:
        moved = db.query(Question).filter(Question.code == code).one()
        assert moved.unit_rule == "STATED"
        assert moved.response_format == "Number"


def test_the_number_alone_is_right_once_the_rule_has_moved(db):
    from app.services.learning_service import grade_answer

    moved = db.query(Question).filter(Question.code == "CISCE-C5-CH01-Q001").one()
    assert grade_answer(moved, "2764")[0] is False  # Required: the unit is missing
    script.apply_plan(db, script.make_plan(db))
    db.refresh(moved)
    assert grade_answer(moved, "2764")[0] is True
    assert grade_answer(moved, "2764 m")[0] is True
    assert grade_answer(moved, "2764 metres")[0] is True
    assert grade_answer(moved, "2764 cm")[0] is False  # the wrong unit is still wrong


def test_a_round_number_key_survives_the_re_mark(db):
    # format(..., "f") and not str(): str(Decimal("100").normalize()) is
    # "1E+2", which would fail the re-mark and roll the whole run back.
    lesson = db.query(ConceptLesson).filter(ConceptLesson.id == "cl1-icse").one()
    db.add(_question(lesson.id, "CISCE-C5-CH01-Q009", "Add 40 m and 60 m. Give the answer in metres.", "100", "m"))
    db.commit()
    script.apply_plan(db, script.make_plan(db))
    moved = db.query(Question).filter(Question.code == "CISCE-C5-CH01-Q009").one()
    assert moved.unit_rule == "STATED"


def test_a_second_run_changes_nothing(db):
    script.apply_plan(db, script.make_plan(db))
    again = script.make_plan(db)
    assert again.to_change == []


def test_one_audit_entry_records_every_change(db):
    plan = script.make_plan(db)
    script.apply_plan(db, plan)
    entries = db.query(AuditLog).filter(AuditLog.event_type == script.AUDIT_EVENT).all()
    assert len(entries) == 1
    details = json.loads(entries[0].event_data_json)
    assert details["questionsChanged"] == len(NAMED)
    assert details["questionsWhereWordingDisagrees"] == len(DISAGREES)
    assert {change["code"] for change in details["changes"]} == {code for code, *_ in NAMED}
    for change in details["changes"]:
        assert change["old"] == "REQUIRED" and change["new"] == "STATED"
        assert change["oldResponseFormat"] == "Number and unit"


def test_a_key_that_would_be_marked_wrong_rolls_the_whole_run_back(db):
    lesson = db.query(ConceptLesson).filter(ConceptLesson.id == "cl1-icse").one()
    # A key in a unit the wording does not name: once the rule is Stated the
    # number is checked against the recorded unit, and "9 kg" is not 9 m.
    db.add(_question(lesson.id, "CISCE-C5-CH01-Q010", "Add 4 m and 5 m. Give the answer in metres.", "9 kg", "m"))
    db.commit()
    with pytest.raises(StopBeforeWriting):
        script.apply_plan(db, script.make_plan(db))
    assert db.query(Question).filter(Question.code == "CISCE-C5-CH01-Q001").one().unit_rule == "REQUIRED"
    assert db.query(AuditLog).filter(AuditLog.event_type == script.AUDIT_EVENT).count() == 0


def test_a_question_whose_mark_the_rule_does_not_decide_is_left_alone(db):
    plan = script.make_plan(db)
    moved = {q.code for q, _read in plan.to_change}
    for code, *_rest in OUT_OF_SCOPE:
        assert code not in moved
    assert plan.out_of_scope == len(OUT_OF_SCOPE)


def test_the_apply_succeeds_with_those_rows_present(db):
    # The production run of 23 Nov stopped here: a teacher-marked question
    # has no verdict, the strict re-mark counted that as wrong, and all 457
    # rolled back. They are now out of scope, so the apply goes through.
    script.apply_plan(db, script.make_plan(db))
    for code, *_rest in OUT_OF_SCOPE:
        untouched = db.query(Question).filter(Question.code == code).one()
        assert untouched.unit_rule == "REQUIRED"
    for code, *_rest in NAMED:
        assert db.query(Question).filter(Question.code == code).one().unit_rule == "STATED"


def test_no_verdict_inside_the_scope_is_a_hard_stop(db):
    # If the selection and the marker ever disagree, nothing is written.
    moved = db.query(Question).filter(Question.code == NAMED[0][0]).one()
    plan = script.make_plan(db)
    moved.auto_gradable = False  # the marker now declines it, after selection
    db.flush()
    with pytest.raises(StopBeforeWriting) as stop:
        script.apply_plan(db, plan)
    assert "not auto-marked after all" in str(stop.value)
    assert db.query(AuditLog).filter(AuditLog.event_type == script.AUDIT_EVENT).count() == 0
