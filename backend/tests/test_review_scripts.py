"""The scripts that record Ashalatha's answers of 26 Oct 2026.

apply_question_marks.py (Q3): two written questions become worth 2 marks
with her guidance, only while they read as she reviewed them.
apply_question_reviews.py (Q2, Q4): her reviewed Accepted Variants or
Marking Guidance; a row without a decision, or Keep Current, leaves the
question alone; a question changed since the sheet was made, or a variant
that would be marked wrong, stops the run before anything is saved.
apply_misconception_reviews.py (Q14): her decision on each skill's note,
tied to the note she read.

Each runs against a throwaway in-memory database; a second run changes
nothing; one audit entry records each run.
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
from app.models import AuditLog, ConceptLesson, MisconceptionReview, Question


def _load(name):
    path = Path(__file__).resolve().parents[1] / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


marks = _load("apply_question_marks")
reviews = _load("apply_question_reviews")
notes = _load("apply_misconception_reviews")


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, future=True)()
    skill = ConceptLesson(chapter_id="ch-1", code="C5-WT1-S01", title="Rounding", sequence=1)
    session.add(skill)
    session.flush()
    for d in marks.DECISIONS:
        session.add(Question(
            concept_lesson_id=skill.id, code=d.code, question_type="Constructed Response", stem=d.stem,
            correct_answer="8,600", marks=1, teacher_note="Award 1 mark.", auto_gradable=False,
            misconception_tag="Looks at the wrong digit.",
        ))
    session.add(Question(
        concept_lesson_id=skill.id, code="CBSE-C5-CH05-Q034", question_type="Numeric Entry",
        stem="2 cm equals how many millimetres?", correct_answer="20", response_format="Integer; unit stated in question",
        accepted_variants="20|20 mm|20 cm|₹20", misconception_tag="Looks at the wrong digit.",
    ))
    session.commit()
    yield session
    session.close()


def _audits(db, event):
    return [json.loads(a.event_data_json) for a in db.query(AuditLog).filter(AuditLog.event_type == event)]


def test_two_questions_become_worth_two_marks(db):
    to_change, already = marks.make_plan(db)
    assert (len(to_change), already) == (2, 0)
    # Not while an attempt in progress has an answer saved to one of them.
    from app.models import Attempt, AttemptAnswer

    q89 = db.query(Question).filter_by(code="CBSE-C5-CH01-Q089").one()
    attempt = Attempt(assignment_target_id="t1", status="IN_PROGRESS")
    db.add(attempt)
    db.flush()
    db.add(AttemptAnswer(attempt_id=attempt.id, question_id=q89.id, response_text="8,600"))
    db.commit()
    with pytest.raises(marks.StopBeforeWriting, match="still in progress"):
        marks.make_plan(db)
    attempt.status = "SUBMITTED"
    db.commit()
    to_change, already = marks.make_plan(db)
    marks.apply_plan(db, to_change, already)
    q89 = db.query(Question).filter_by(code="CBSE-C5-CH01-Q089").one()
    assert q89.marks == 2 and q89.teacher_note.startswith("1 mark for 8,600")
    assert marks.make_plan(db) == ([], 2)
    assert _audits(db, marks.AUDIT_EVENT)[0]["changes"][0]["old"]["marks"] == 1

    q89.stem = "Reworded."
    db.commit()
    with pytest.raises(marks.StopBeforeWriting, match="wording has changed"):
        marks.make_plan(db)


def _sheet(tmp_path, name, headers, rows):
    book = openpyxl.Workbook()
    sheet = book.active
    sheet.title = name
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    path = tmp_path / f"{name}.xlsx"
    book.save(path)
    return str(path)


VARIANT_HEADERS = ["Question ID", "Question", "Correct Answer", "Current Accepted Variants",
                   "Proposed Accepted Variants", "Decision", "Your Accepted Variants", "Comments"]
STEM = "2 cm equals how many millimetres?"


def _run_reviews(db, path):
    attribute, label, rows, undecided = reviews.read_rows(path)
    plan = reviews.make_plan(db, attribute, label, rows)
    reviews.apply_plan(db, plan, workbook_name="x.xlsx", workbook_sha256="abc")
    return plan, undecided


def test_accepted_variants(db, tmp_path):
    q = db.query(Question).filter_by(code="CBSE-C5-CH05-Q034").one()
    undecided = _sheet(tmp_path, "Accepted Variants", VARIANT_HEADERS, [
        ["CBSE-C5-CH05-Q034", STEM, "20", "20|20 mm|20 cm|₹20", "20|20 mm", None, None, None],
    ])
    plan, waiting = _run_reviews(db, undecided)
    assert (plan.to_change, waiting, q.accepted_variants) == ([], 1, "20|20 mm|20 cm|₹20")

    approved = _sheet(tmp_path, "Accepted Variants", VARIANT_HEADERS, [
        ["CBSE-C5-CH05-Q034", STEM, "20", "20|20 mm|20 cm|₹20", "20| 20 mm |20 mm", "approve", None, None],
    ])
    plan, _ = _run_reviews(db, approved)
    db.refresh(q)
    assert len(plan.to_change) == 1 and q.accepted_variants == "20|20 mm"
    plan, _ = _run_reviews(db, approved)
    assert (plan.to_change, plan.already_set) == ([], 1)
    assert [a["changes"] for a in _audits(db, reviews.AUDIT_EVENT) if a["changes"]][0] == [
        {"code": "CBSE-C5-CH05-Q034", "decision": "Approve", "old": "20|20 mm|20 cm|₹20", "new": "20|20 mm"}
    ]

    # Changed since the sheet was made: left for a fresh look.
    stale = _sheet(tmp_path, "Accepted Variants", VARIANT_HEADERS, [
        ["CBSE-C5-CH05-Q034", STEM, "20", "20|20 mm|20 cm|₹20", "20", "Approve", None, None],
    ])
    attribute, label, rows, _ = reviews.read_rows(stale)
    with pytest.raises(reviews.StopBeforeWriting, match="changed since the sheet was made"):
        reviews.make_plan(db, attribute, label, rows)

    # A variant that would be marked wrong saves nothing.
    wrong = _sheet(tmp_path, "Accepted Variants", VARIANT_HEADERS, [
        ["CBSE-C5-CH05-Q034", STEM, "20", "20|20 mm", "20", "Change", "20|21", None],
    ])
    with pytest.raises(reviews.StopBeforeWriting, match='"21" is not the same amount'):
        _run_reviews(db, wrong)
    db.refresh(q)
    assert q.accepted_variants == "20|20 mm"

    # The answer "20" is in millimetres (read from the question, as marking
    # does), so "20 cm" or "₹20" is not the same amount; "2 cm" is (review).
    for listed, ok in (("20|20 cm", False), ("20|₹20", False), ("20|20 mm|2 cm", True)):
        sheet = _sheet(tmp_path, "Accepted Variants", VARIANT_HEADERS, [
            ["CBSE-C5-CH05-Q034", STEM, "20", "20|20 mm", "20", "Change", listed, None],
        ])
        if ok:
            _run_reviews(db, sheet)
        else:
            with pytest.raises(reviews.StopBeforeWriting, match="is not the same amount"):
                _run_reviews(db, sheet)
        db.refresh(q)
    assert q.accepted_variants == "20|20 mm|2 cm"


def test_marking_guidance_and_bad_rows(db, tmp_path):
    headers = ["Question ID", "Question", "Correct Answer", "Current Marking Guidance", "Proposed Marking Guidance",
               "Decision", "Your Marking Guidance", "Comments"]
    d1, d2 = marks.DECISIONS
    path = _sheet(tmp_path, "Marking Guidance", headers, [
        [d1.code, d1.stem, "8,600", "Award 1 mark.", "1 mark: idea\n1 mark: method", "Approve", None, None],
        [d2.code, d2.stem, "8,600", "Award 1 mark.", "1 mark: x", "Keep Current", None, None],
    ])
    plan, _ = _run_reviews(db, path)
    assert (len(plan.to_change), plan.kept) == (1, 1)
    assert db.query(Question).filter_by(code=d1.code).one().teacher_note == "1 mark: idea\n1 mark: method"

    bad = _sheet(tmp_path, "Marking Guidance", headers, [
        [d1.code, d1.stem, "8,600", "x", "y", "Maybe", None, None],
        [d2.code, d2.stem, "8,600", "x", "y", "Change", None, None],
    ])
    with pytest.raises(reviews.StopBeforeWriting) as stop:
        reviews.read_rows(bad)
    assert "not Approve, Change or Keep Current" in str(stop.value) and "Your Marking Guidance is empty" in str(stop.value)


def test_misconception_reviews(db, tmp_path):
    headers = ["Skill ID", "Current Note", "Proposed Note", "Proposed Next Step", "Decision", "Your Note", "Your Next Step"]
    path = _sheet(tmp_path, "Misconception Notes", headers, [
        ["C5-WT1-S01", "Looks at the wrong digit.", "Rounds using the wrong digit.", "Underline the deciding digit.",
         "Change", "Rounds by the digit after the place asked for.", None],
    ])
    rows, waiting = notes.read_rows(path)
    plan = notes.make_plan(db, rows)
    notes.apply_plan(db, plan, workbook_name="x.xlsx", workbook_sha256="abc")
    review = db.query(MisconceptionReview).one()
    assert (review.status, review.shown_note, review.next_step) == (
        "APPROVED", "Rounds by the digit after the place asked for.", "Underline the deciding digit."
    )
    assert notes.make_plan(db, notes.read_rows(path)[0]).already_set == 1

    rejected = _sheet(tmp_path, "Misconception Notes", headers, [
        ["C5-WT1-S01", "Looks at the wrong digit.", "x", "y", "Reject", None, None],
    ])
    notes.apply_plan(db, notes.make_plan(db, notes.read_rows(rejected)[0]), workbook_name="y", workbook_sha256="d")
    db.refresh(review)
    assert review.status == "REJECTED" and db.query(MisconceptionReview).count() == 1

    gone = _sheet(tmp_path, "Misconception Notes", headers, [
        ["C5-WT1-S01", "A note no question has.", "x", "y", "Approve", None, None],
        ["C5-XX-S99", "Looks at the wrong digit.", "x", "y", "Approve", None, None],
    ])
    with pytest.raises(notes.StopBeforeWriting) as stop:
        notes.make_plan(db, notes.read_rows(gone)[0])
    assert "no question of this skill" in str(stop.value) and "no skill on the platform" in str(stop.value)
