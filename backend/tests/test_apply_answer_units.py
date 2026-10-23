"""scripts/apply_answer_units.py -- records Ashalatha's reviewed answer
units on the Class 5 questions (#180, 23 Oct 2026).

Runs the real script functions against a throwaway in-memory database and
a small workbook laid out like hers (the "Proposed Units" sheet, the same
headers). The rules under test: her decision is read row by row (Approve
takes the proposal, Change takes hers); any unusable row, missing question
or question reworded since her review stops the run before anything is
written; only Answer Unit and Unit Rule change; a change that would mark a
question's own correct answer wrong is rolled back; a second run changes
nothing; one audit entry records every old and new value.
"""
import importlib.util
import json
import sys
from pathlib import Path

import openpyxl
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import AuditLog, Question

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "apply_answer_units.py"
spec = importlib.util.spec_from_file_location("apply_answer_units", SCRIPT)
apply_answer_units = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = apply_answer_units  # dataclasses looks its module up here
spec.loader.exec_module(apply_answer_units)
StopBeforeWriting = apply_answer_units.StopBeforeWriting

HEADERS = [
    "Chapter No", "Chapter", "Question ID", "Question", "Correct Answer", "Marks", "Response Format",
    "Proposed Answer Unit", "Proposed Unit Rule", "How It Was Found", "Confidence",
    "Current Accepted Variants", "Proposed Accepted Variants", "Variants Changed", "Decision",
    "Your Answer Unit", "Your Unit Rule", "Notes", "Final Answer Unit", "Final Unit Rule",
    "Unit Read by the Platform Now",
]
STATED = "Integer; unit stated in question"

# (code, stem, answer, proposed unit, proposed rule, decision, her unit, her rule, notes)
ROWS = [
    ("CBSE-C5-CH05-Q034", "2 cm equals how many millimetres?", "20", "millimetres", "Stated", "Approve", None, None, None),
    ("CBSE-C5-CH05-Q464", "2 feet equal how many inches?", "24", None, "None", "Change", "inches", "Stated",
     "The question asks for inches; inches has been added to the unit list."),
    ("CBSE-C5-CH11-Q336", "A chain of 4 unit squares has 3 shared sides. Use 4n−2s to find its perimeter.", "10",
     "seconds", "Stated", "Change", None, "None", "Here s means shared sides, not seconds."),
    ("CBSE-C5-CH13-Q001", "How many jumps does the frog make?", "6", None, "None", "Approve", None, None, None),
]


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, future=True)()
    for code, stem, answer, *_rest in ROWS:
        session.add(
            Question(
                concept_lesson_id="lesson-1",
                code=code,
                question_type="Numeric Entry",
                stem=stem,
                correct_answer=answer,
                marks=1,
                auto_gradable=True,
                response_format=STATED,
                status="PUBLISHED",
                numeric_tolerance="0.5" if code.endswith("Q034") else None,
            )
        )
    session.commit()
    yield session
    session.close()


def _workbook(tmp_path, rows=ROWS, name="reviewed.xlsx") -> str:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "How to Review"
    sheet = wb.create_sheet("Proposed Units")
    sheet.append(HEADERS)
    for code, stem, answer, p_unit, p_rule, decision, y_unit, y_rule, notes in rows:
        line = dict.fromkeys(HEADERS)
        line.update({
            "Question ID": code, "Question": stem, "Correct Answer": answer, "Response Format": STATED,
            "Proposed Answer Unit": p_unit, "Proposed Unit Rule": p_rule, "Decision": decision,
            "Your Answer Unit": y_unit, "Your Unit Rule": y_rule, "Notes": notes,
            # As in hers: formulas, which openpyxl leaves uncalculated.
            "Final Answer Unit": '=IF(O2="Change",P2,H2)',
        })
        sheet.append([line[h] for h in HEADERS])
    path = tmp_path / name
    wb.save(path)
    return str(path)


def _get(db, code):
    return db.query(Question).filter(Question.code == code).one()


def test_her_decisions_are_read_approve_takes_the_proposal_change_takes_hers(tmp_path):
    decisions = {d.code: d for d in apply_answer_units.read_decisions(_workbook(tmp_path))}
    assert (decisions["CBSE-C5-CH05-Q034"].answer_unit, decisions["CBSE-C5-CH05-Q034"].unit_rule) == ("mm", "STATED")
    assert (decisions["CBSE-C5-CH05-Q464"].answer_unit, decisions["CBSE-C5-CH05-Q464"].unit_rule) == ("inch", "STATED")
    assert (decisions["CBSE-C5-CH11-Q336"].answer_unit, decisions["CBSE-C5-CH11-Q336"].unit_rule) == (None, "NONE")
    assert (decisions["CBSE-C5-CH13-Q001"].answer_unit, decisions["CBSE-C5-CH13-Q001"].unit_rule) == (None, "NONE")


def test_a_report_writes_nothing(db, tmp_path):
    plan = apply_answer_units.make_plan(db, apply_answer_units.read_decisions(_workbook(tmp_path)))
    assert len(plan.to_change) == 4 and plan.already_set == 0
    assert _get(db, "CBSE-C5-CH05-Q034").answer_unit is None
    assert db.query(AuditLog).count() == 0


def test_apply_sets_only_unit_and_rule_and_audits_old_and_new(db, tmp_path):
    path = _workbook(tmp_path)
    plan = apply_answer_units.make_plan(db, apply_answer_units.read_decisions(path))
    apply_answer_units.apply_plan(db, plan, workbook_name="reviewed.xlsx", workbook_sha256="abc")
    q = _get(db, "CBSE-C5-CH05-Q034")
    assert (q.answer_unit, q.unit_rule) == ("mm", "STATED")
    assert q.numeric_tolerance == "0.5" and q.status == "PUBLISHED"  # untouched
    assert (_get(db, "CBSE-C5-CH05-Q464").answer_unit, _get(db, "CBSE-C5-CH05-Q464").unit_rule) == ("inch", "STATED")
    assert _get(db, "CBSE-C5-CH11-Q336").unit_rule == "NONE"
    entries = db.query(AuditLog).all()
    assert [e.event_type for e in entries] == ["curriculum.answer_units.applied"]
    details = json.loads(entries[0].event_data_json)
    assert details["questionsChanged"] == 4 and details["workbookSha256"] == "abc"
    assert {"code": "CBSE-C5-CH05-Q464", "old": [None, None], "new": ["inch", "STATED"]} in details["changes"]


def test_after_apply_marking_follows_her_units(db, tmp_path):
    from app.services.learning_service import grade_answer

    path = _workbook(tmp_path)
    apply_answer_units.apply_plan(
        db, apply_answer_units.make_plan(db, apply_answer_units.read_decisions(path)), workbook_name="w", workbook_sha256="s"
    )
    inches = _get(db, "CBSE-C5-CH05-Q464")
    assert grade_answer(inches, "24")[0] and grade_answer(inches, "24 inches")[0]
    assert not grade_answer(inches, "24 cm")[0]
    shared = _get(db, "CBSE-C5-CH11-Q336")  # "s" is shared sides, not seconds
    assert grade_answer(shared, "10")[0]


def test_a_second_run_changes_nothing(db, tmp_path):
    path = _workbook(tmp_path)
    apply_answer_units.apply_plan(
        db, apply_answer_units.make_plan(db, apply_answer_units.read_decisions(path)), workbook_name="w", workbook_sha256="s"
    )
    again = apply_answer_units.make_plan(db, apply_answer_units.read_decisions(path))
    assert again.to_change == [] and again.already_set == 4


@pytest.mark.parametrize(
    "row, message",
    [
        (("CBSE-C5-CH05-Q034", "2 cm equals how many millimetres?", "20", "millimetres", "Stated", "", None, None, None),
         "not Approve or Change"),
        (("CBSE-C5-CH05-Q034", "2 cm equals how many millimetres?", "20", "furlongs", "Stated", "Approve", None, None, None),
         "not one of the units marking knows"),
        (("CBSE-C5-CH05-Q034", "2 cm equals how many millimetres?", "20", None, "Stated", "Approve", None, None, None),
         "no Answer Unit"),
        (("CBSE-C5-CH05-Q034", "2 cm equals how many millimetres?", "20", "x", "x", "Change", "grams", "None", None),
         "Unit Rule None, but an Answer Unit"),
    ],
)
def test_an_unusable_row_stops_everything(tmp_path, row, message):
    with pytest.raises(StopBeforeWriting, match=message):
        apply_answer_units.read_decisions(_workbook(tmp_path, rows=[row, ROWS[1]]))


def test_a_question_reworded_since_her_review_stops_everything(db, tmp_path):
    q = _get(db, "CBSE-C5-CH05-Q034")
    q.stem = "3 cm equals how many millimetres?"
    db.commit()
    with pytest.raises(StopBeforeWriting, match="CBSE-C5-CH05-Q034: its wording or correct answer has changed"):
        apply_answer_units.make_plan(db, apply_answer_units.read_decisions(_workbook(tmp_path)))
    assert _get(db, "CBSE-C5-CH05-Q464").answer_unit is None


def test_a_missing_question_stops_everything(db, tmp_path):
    rows = ROWS + [("CBSE-C5-CH05-Q999", "Not loaded.", "1", "metres", "Stated", "Approve", None, None, None)]
    with pytest.raises(StopBeforeWriting, match="CBSE-C5-CH05-Q999: not in the database"):
        apply_answer_units.make_plan(db, apply_answer_units.read_decisions(_workbook(tmp_path, rows=rows)))


def test_a_change_that_would_mark_a_key_wrong_is_rolled_back(db, tmp_path, monkeypatch):
    path = _workbook(tmp_path)
    plan = apply_answer_units.make_plan(db, apply_answer_units.read_decisions(path))
    monkeypatch.setattr(apply_answer_units, "check_keys_still_right", lambda changed: ["X: \"1\" would be marked wrong."])
    with pytest.raises(StopBeforeWriting, match="Nothing was saved"):
        apply_answer_units.apply_plan(db, plan, workbook_name="w", workbook_sha256="s")
    db.expire_all()
    assert _get(db, "CBSE-C5-CH05-Q034").answer_unit is None
    assert db.query(AuditLog).count() == 0


def test_required_checks_the_key_with_its_unit_not_alone(db, tmp_path):
    # Under Required a bare "20" is meant to lose the unit mark, so it must
    # not count as "the key marked wrong" and cancel the run.
    rows = [("CBSE-C5-CH05-Q034", "2 cm equals how many millimetres?", "20", "x", "x", "Change", "millimetres",
             "Required", None)]
    path = _workbook(tmp_path, rows=rows)
    plan = apply_answer_units.make_plan(db, apply_answer_units.read_decisions(path))
    assert apply_answer_units.check_keys_still_right(plan.to_change) == []
    apply_answer_units.apply_plan(db, plan, workbook_name="w", workbook_sha256="s")
    assert _get(db, "CBSE-C5-CH05-Q034").unit_rule == "REQUIRED"


def test_a_key_that_carries_its_unit_is_tried_as_written(db, tmp_path):
    q = _get(db, "CBSE-C5-CH05-Q464")
    q.correct_answer = "24 inches"
    db.commit()
    rows = [("CBSE-C5-CH05-Q464", "2 feet equal how many inches?", "24 inches", None, "None", "Change", "inches",
             "Stated", None)]
    plan = apply_answer_units.make_plan(db, apply_answer_units.read_decisions(_workbook(tmp_path, rows=rows)))
    assert apply_answer_units.check_keys_still_right(plan.to_change) == []


@pytest.mark.parametrize(
    "rows, message",
    [
        ([ROWS[0], ROWS[0]], "appears more than once"),
        ([("CBSE-C5-CH05-Q034", "2 cm equals how many millimetres?", "20", "millimetres", "Stated", "Change",
           "millimetres", None, None)], "no Unit Rule"),
    ],
)
def test_duplicates_and_a_change_without_a_rule_stop_everything(tmp_path, rows, message):
    with pytest.raises(StopBeforeWriting, match=message):
        apply_answer_units.read_decisions(_workbook(tmp_path, rows=rows))


def test_approve_ignores_anything_typed_in_her_columns(tmp_path):
    rows = [("CBSE-C5-CH05-Q034", "2 cm equals how many millimetres?", "20", "millimetres", "Stated", " approve ",
             "grams", "Required", None)]
    (decision,) = apply_answer_units.read_decisions(_workbook(tmp_path, rows=rows))
    assert (decision.answer_unit, decision.unit_rule) == ("mm", "STATED")


def test_the_locked_recheck_reads_the_same_plan(db, tmp_path):
    decisions = apply_answer_units.read_decisions(_workbook(tmp_path))
    first = apply_answer_units.make_plan(db, decisions)
    db.rollback()
    again = apply_answer_units.make_plan(db, decisions, lock=True)
    assert [d.code for _q, d in again.to_change] == [d.code for _q, d in first.to_change]
