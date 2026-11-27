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
from app.models import (
    Assignment,
    Chapter,
    AuditLog,
    ConceptLesson,
    LearningActivity,
    LearningActivityQuestion,
    Question,
)

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
REWRITE_Q3 = [("Q3", "How many factors does 20 have?", "6", "B4",
               "Step 1. List every factor of 20 in order.", None, None, None, None,
               "1;2;4;5;10;20", None, 1, "Text Entry", "Short list", "Yes", None)]
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
    # #262: a Draft in Q3's skill, in no set, and Q3's own set untouched --
    # the sequence of what was already there does not shift.
    assert q4.status == "DRAFT" and q4.concept_lesson_id == "lesson-1"
    links = {l.question_id: l.sequence for l in db.query(LearningActivityQuestion).all()}
    assert q4.id not in links and links["other"] == 2
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


def test_a_required_unit_answer_is_checked_with_its_unit(db, tmp_path):
    # Key "840" with the unit rupees Required: the child types "840 rupees", so the stem
    # edit must not be refused because the bare number loses the unit mark.
    q3 = db.query(Question).filter_by(code="Q3").one()
    q3.stem, q3.correct_answer, q3.accepted_variants = "The principal is Rs 3500. What is the simple interest?", "840", None
    q3.answer_unit, q3.unit_rule, q3.marks, q3.unit_mark = "rupees", "REQUIRED", 1, 1
    db.commit()
    edit = [("Q3", "Question Stem", q3.stem, "The principal is Rs 3500. A learner adds it to the interest. What is the correct simple interest?", "", "")]
    done = apply_content_edits.apply_plan(
        db, apply_content_edits.read_and_plan(db, _workbook(tmp_path, edits=edit)), workbook_name="x", workbook_sha256="x")
    assert done["questions"] == 1


def test_a_question_added_by_an_edit_run_is_a_draft_in_no_set(db, tmp_path):
    """#262. Q4 is added after Q3, which is PUBLISHED. It used to take that
    status and write itself into every set holding Q3 -- a question nobody
    had read, inside a live set, past the ready filter A-001 put on the
    normal path. Now it is a Draft in no set, like every other new question,
    and it reaches a set only once a person approves it and the chapter is
    published again."""
    from app.models import LearningActivityQuestion

    path = _workbook(tmp_path, new=NEW)
    apply_content_edits.apply_plan(db, apply_content_edits.read_and_plan(db, path),
                                  workbook_name="edits.xlsx", workbook_sha256="x")
    added = db.query(Question).filter_by(code="Q4").one()
    assert added.status == "DRAFT", "a new question is never born approved"
    assert added.approval_source is None, "an edit run is not an approval"
    assert added.concept_lesson_id is not None, "it still joins its neighbour's skill"
    links = db.query(LearningActivityQuestion).filter_by(question_id=added.id).count()
    assert links == 0, "this script writes no set links at all"


def _set(db, activity_id: str, *, status: str, assigned: bool) -> None:
    """A real practice set holding Q3, so the run can report where a new
    question's neighbour sits. The base fixture links Q3 to an activity id
    with no row behind it, which is enough for the link tests but invisible
    to a join."""
    db.add(LearningActivity(id=activity_id, chapter_id="ch-1", concept_lesson_id="lesson-1",
                            activity_type="PRACTICE", title=f"Practice {activity_id}", status=status))
    q3 = db.query(Question).filter_by(code="Q3").one()
    db.add(LearningActivityQuestion(learning_activity_id=activity_id, question_id=q3.id, sequence=1))
    if assigned:
        db.add(Assignment(school_id="school-1", learning_activity_id=activity_id, status="ACTIVE"))
    db.commit()


def test_the_dry_run_says_where_a_new_question_will_land_before_anything_is_written(db, tmp_path):
    """#262. The person decides before the write, so the summary a dry run
    prints has to carry this -- not a line printed after the rows are in.
    A published set with an assignment against it is frozen by A-001, and
    nothing can be added to it ever again, so the summary says that and does
    not promise another publish will fix it."""
    _set(db, "act-live", status="PUBLISHED", assigned=True)
    _set(db, "act-open", status="DRAFT", assigned=False)
    plan = apply_content_edits.read_and_plan(db, _workbook(tmp_path, new=NEW))
    summary = apply_content_edits._summary(plan)
    assert "as a Draft, in no practice set" in summary
    assert "PUBLISHED AND ALREADY ASSIGNED" in summary and "Practice act-live" in summary
    assert "takes it at the next chapter publish" in summary and "Practice act-open" in summary
    # and it has written nothing
    assert db.query(Question).filter_by(code="Q4").one_or_none() is None


def test_a_question_reworded_and_given_a_new_one_after_it_is_flagged(db, tmp_path):
    """#262. A split into steps looks exactly like this: the original's
    wording changes and the new parts are added after it. Since the new
    parts are Drafts outside the set, a split going half-live would leave a
    child the first step and not the second. The script cannot tell a split
    from an unrelated pair, so it flags and lets the person judge -- it does
    not refuse, which would block ordinary work on a guess."""
    plan = apply_content_edits.read_and_plan(db, _workbook(tmp_path, rewrites=REWRITE_Q3, new=NEW))
    assert plan.paired == ["Q3"]
    assert "CHECK THESE BEFORE CHILDREN PRACTISE AGAIN" in apply_content_edits._summary(plan)
    apply_content_edits.apply_plan(db, plan, workbook_name="edits.xlsx", workbook_sha256="x")
    [audit] = db.query(AuditLog).filter_by(event_type=apply_content_edits.AUDIT_EVENT).all()
    assert json.loads(audit.event_data_json)["changedAndGivenANewQuestionAfter"] == ["Q3"]
    assert db.query(Question).filter_by(code="Q4").one().status == "DRAFT"


def test_a_frozen_set_changes_the_only_remedy_the_split_warning_offers(db, tmp_path):
    """Publishing the chapter again cannot place the new parts in a set that
    is already assigned, so telling the person to publish would be a false
    remedy. There, putting the change back is the only one."""
    _set(db, "act-live", status="PUBLISHED", assigned=True)
    summary = apply_content_edits._summary(
        apply_content_edits.read_and_plan(db, _workbook(tmp_path, rewrites=REWRITE_Q3, new=NEW)))
    assert "putting the change back is the only remedy" in summary
    assert "Approve the new parts and publish the chapter to close that" not in summary


def test_trimming_variants_is_not_treated_as_a_split(db, tmp_path):
    """The other half of the rule. EDITS trims Q3's accepted variants while
    NEW adds Q4 after Q3 -- the same shape as a split, but a variants trim
    cannot be one. A warning that fired here would be ignored when it
    mattered."""
    plan = apply_content_edits.read_and_plan(db, _workbook(tmp_path, edits=EDITS, new=NEW))
    assert plan.paired == []
    assert "CHECK THESE" not in apply_content_edits._summary(plan)


def test_an_approved_new_question_reaches_its_set_at_the_next_publish(db, tmp_path):
    """#262 end to end, against the real generator rather than a string in a
    report. The edit run adds Q4 as a Draft in no set; a publish while it is
    still a Draft leaves it out (A-001); once it is approved, the next
    publish places it. And a set that is published and assigned never takes
    it at all, which is why the summary says so."""
    from app.services import learning_service

    db.add(Chapter(id="ch-1", discipline_id="d1", board_course_id="bc1",
                   curriculum_version_id="cv1", code="CH01", chapter_no=1, title="Factors"))
    for question in db.query(Question).all():  # the generator ignores a code it cannot classify
        question.assignment_code = "CH01-P09"
    open_set = LearningActivity(id="act-open", chapter_id="ch-1", concept_lesson_id="lesson-1",
                                activity_type="CORE_PRACTICE", title="Core Practice", status="PUBLISHED",
                                source_assignment_code="CH01-P09")
    db.add(open_set)
    db.add(LearningActivityQuestion(learning_activity_id="act-open",
                                    question_id=db.query(Question).filter_by(code="Q3").one().id, sequence=1))
    db.commit()
    chapter = db.query(Chapter).one()

    apply_content_edits.apply_plan(db, apply_content_edits.read_and_plan(db, _workbook(tmp_path, new=NEW)),
                                   workbook_name="edits.xlsx", workbook_sha256="x")
    q4 = db.query(Question).filter_by(code="Q4").one()

    learning_service.generate_activities_for_chapter(db, chapter, None)
    db.commit()
    assert db.query(LearningActivityQuestion).filter_by(question_id=q4.id).count() == 0, \
        "a Draft must not be placed in a published set"

    q4.status = "APPROVED"
    db.commit()
    learning_service.generate_activities_for_chapter(db, chapter, None)
    db.commit()
    assert [l.learning_activity_id for l in db.query(LearningActivityQuestion).filter_by(question_id=q4.id).all()] \
        == ["act-open"], "once approved, the next publish places it in its own set"

    # the frozen case: the same set, now assigned, takes nothing more
    db.query(LearningActivityQuestion).filter_by(question_id=q4.id).delete()
    db.add(Assignment(school_id="school-1", learning_activity_id="act-open", status="ACTIVE"))
    db.commit()
    learning_service.generate_activities_for_chapter(db, chapter, None)
    db.commit()
    assert db.query(LearningActivityQuestion).filter_by(question_id=q4.id).count() == 0, \
        "a published, assigned set can never take another question"
