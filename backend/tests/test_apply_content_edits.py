"""scripts/apply_content_edits.py -- the approved content edits of 10 Nov
2026 (#218): any field, whole-question rewrites, questions added after
another one, skill names. Runs the real script functions against a
throwaway in-memory database and a small workbook in the real layout."""
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
from app.models import AuditLog, ConceptLesson, LearningActivityQuestion, Question

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "apply_content_edits.py"
spec = importlib.util.spec_from_file_location("apply_content_edits", SCRIPT)
apply_content_edits = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = apply_content_edits
spec.loader.exec_module(apply_content_edits)
StopBeforeWriting = apply_content_edits.StopBeforeWriting

FIELDS = ["Question Stem", "Option A", "Option B", "Option C", "Option D", "Correct Answer", "Accepted Variants", "Marks",
          "Question Type", "Response Format", "Auto-gradable", "Figure"]


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, future=True)()
    session.add(ConceptLesson(id="lesson-1", chapter_id="ch-1", code="C5-SD-S09", title="Coordinate reflection across a vertical line"))
    for code, stem, answer, variants, qtype, marks in [
        ("Q1", "Express 3,235 g in kilograms and grams.", "3 kg 235 g", "3 kg 235 g|3235 g|3,235 g", "Text Entry", 2),
        ("Q2", "Reflect point (5, 6) across the vertical line x=9.", "(13, 6)", "(13, 6)|13,6", "Text Entry", 2),
        ("Q3", "How many factors does 20 have?", "6", "6|6 units", "Numeric Entry", 1),
    ]:
        session.add(Question(concept_lesson_id="lesson-1", code=code, question_type=qtype, stem=stem, correct_answer=answer,
                             accepted_variants=variants, marks=marks, auto_gradable=True, status="PUBLISHED", assignment_code="P09"))
    session.flush()
    q3 = session.query(Question).filter_by(code="Q3").one()
    session.add(LearningActivityQuestion(learning_activity_id="act-1", question_id=q3.id, sequence=1))
    session.add(LearningActivityQuestion(learning_activity_id="act-1", question_id="other", sequence=2))
    session.commit()
    yield session
    session.close()


def _workbook(tmp_path, *, edits=(), rewrites=(), new=(), skills=()) -> str:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    ws = wb.create_sheet("Edits")
    ws.append(["Question ID", "Field", "Current", "New", "Condition", "Why"])
    for row in edits:
        ws.append(list(row))
    ws = wb.create_sheet("Rewrites")
    ws.append(["Question ID", "Current Question", "Current Answer", "Condition"] + FIELDS)
    for row in rewrites:
        ws.append(list(row))
    ws = wb.create_sheet("New Questions")
    ws.append(["Question ID", "After", "Condition"] + FIELDS)
    for row in new:
        ws.append(list(row))
    ws = wb.create_sheet("Skill Names")
    ws.append(["Skill ID", "Current Name", "New Name"])
    for row in skills:
        ws.append(list(row))
    path = tmp_path / "edits.xlsx"
    wb.save(path)
    return str(path)


GRID = json.dumps({"type": "grid", "rows": 5, "cols": 10, "shaded": [[2, 1]], "labels": [[2, 8, "A"], [2, 9, "B"], [1, 8, "C"], [3, 6, "D"]],
                   "mirror": {"orientation": "vertical", "after": 4}})
EDITS = [
    ("Q1", "Accepted Variants", "3 kg 235 g|3235 g|3,235 g", "3 kg 235 g", "A2", "single-unit conversion"),
    ("Q1", "Marks", "2", "1", "A6", "1 mark"),
    ("Q3", "Accepted Variants", "6|6 units", "6", "A1", "a word not asked for"),
]
REWRITE = [("Q2", "Reflect point (5, 6) across the vertical line x=9.", "(13, 6)", "B9",
            "The shaded square is 4 squares to the left of the vertical mirror line. Which labelled square is its reflection?",
            "Square A", "Square B", "Square C", "Square D", "A", None, 1, "Single Select", "Choice", "Yes", GRID)]
NEW = [("Q4", "Q3", "B4", "How many factors does 20 have? List them in order.", None, None, None, None, "1;2;4;5;10;20", None, 1,
        "Text Entry", "Short list", "Yes", None)]
SKILLS = [("C5-SD-S09", "Coordinate reflection across a vertical line", "Reflection in a vertical mirror line on a grid")]


def test_a_dry_run_reports_and_writes_nothing(db, tmp_path):
    plan = apply_content_edits.read_and_plan(db, _workbook(tmp_path, edits=EDITS, rewrites=REWRITE, new=NEW, skills=SKILLS))
    assert (len(plan.edits), len(plan.rewrites), len(plan.new), len(plan.skills)) == (3, 1, 1, 1)
    assert db.query(Question).filter_by(code="Q1").one().accepted_variants == "3 kg 235 g|3235 g|3,235 g"


def test_apply_changes_everything_once_and_records_it(db, tmp_path):
    path = _workbook(tmp_path, edits=EDITS, rewrites=REWRITE, new=NEW, skills=SKILLS)
    done = apply_content_edits.apply_plan(db, apply_content_edits.read_and_plan(db, path), workbook_name="edits.xlsx", workbook_sha256="x")
    assert done["questions"] == 4
    q1, q2, q4 = (db.query(Question).filter_by(code=c).one() for c in ("Q1", "Q2", "Q4"))
    assert (q1.accepted_variants, q1.marks) == ("3 kg 235 g", 1)
    assert q2.question_type == "Single Select" and q2.correct_answer == "A" and json.loads(q2.figure)["mirror"]["after"] == 4
    assert q4.status == "PUBLISHED" and q4.concept_lesson_id == "lesson-1"
    links = {l.question_id: l.sequence for l in db.query(LearningActivityQuestion).all()}
    assert links[q4.id] == 2 and links["other"] == 3  # straight after Q3 in its set
    assert db.query(ConceptLesson).one().title == "Reflection in a vertical mirror line on a grid"
    [audit] = db.query(AuditLog).filter_by(event_type=apply_content_edits.AUDIT_EVENT).all()
    assert json.loads(audit.event_data_json)["questionsTouched"] == 4
    again = apply_content_edits.read_and_plan(db, path)
    assert (len(again.edits), len(again.rewrites), len(again.new), len(again.skills)) == (0, 0, 0, 0)


def test_a_question_changed_since_the_sheet_stops_everything(db, tmp_path):
    db.query(Question).filter_by(code="Q3").one().accepted_variants = "6|six"
    db.commit()
    with pytest.raises(StopBeforeWriting, match="Q3"):
        apply_content_edits.read_and_plan(db, _workbook(tmp_path, edits=EDITS))
    assert db.query(Question).filter_by(code="Q1").one().marks == 2


def test_a_figure_that_cannot_be_drawn_or_an_unknown_field_is_refused(db, tmp_path):
    bad = [("Q3", "Figure", None, '{"type": "image", "src": "x"}', "B9", ""), ("Q3", "Colour", None, "red", "B9", "")]
    with pytest.raises(StopBeforeWriting) as stop:
        apply_content_edits.read_and_plan(db, _workbook(tmp_path, edits=bad))
    assert "cannot be drawn" in str(stop.value) and "Colour is not a field" in str(stop.value)


def test_a_change_that_would_mark_an_accepted_answer_wrong_is_rolled_back(db, tmp_path):
    # A unit recorded as grams, with "6 kg" still listed: rule 1 would mark it wrong.
    wrong = [("Q3", "Answer Unit", None, "grams", "A3", ""), ("Q3", "Unit Rule", None, "Stated", "A3", ""),
             ("Q3", "Accepted Variants", "6|6 units", "6|6 kg", "A1", "")]
    plan = apply_content_edits.read_and_plan(db, _workbook(tmp_path, edits=wrong))
    with pytest.raises(StopBeforeWriting, match="Nothing was saved"):
        apply_content_edits.apply_plan(db, plan, workbook_name="x", workbook_sha256="x")
    assert db.query(Question).filter_by(code="Q3").one().accepted_variants == "6|6 units"
