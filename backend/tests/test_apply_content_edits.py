"""scripts/apply_content_edits.py -- the approved content edits of 10 Nov
2026 (#218): any field, whole-question rewrites, questions added after
another one, skill names. Runs the real script functions against a
throwaway in-memory database and a small workbook in the real layout."""
import importlib.util
import json
import sys
import uuid
from pathlib import Path

import openpyxl
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Assignment,
    AuditLog,
    Board,
    BoardCourse,
    Chapter,
    ClassLevel,
    ConceptLesson,
    CurriculumVersion,
    Discipline,
    LearningActivity,
    LearningActivityQuestion,
    Question,
    School,
    SubjectGroup,
)

from .conftest import _IS_SQLITE, TEST_DATABASE_URL

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
    """A database of this test's own, on whichever engine TEST_DATABASE_URL
    names (A-027, applied to this file on 27 Nov 2026).

    This file used to hardcode SQLite, so it ignored TEST_DATABASE_URL and
    #262's LearningActivity/Assignment joins had never run on Postgres. It
    must NOT simply borrow conftest's shared session instead: that database
    is shared with the whole suite and never rolled back, other tests leave
    rows with the same codes behind (a "CBSE" board, class "5", questions
    Q1 to Q9, ids such as "ch-1"), and cleaning up after itself there would
    mean deleting their rows too. So each test gets a private database:
    SQLite in memory as before, or on Postgres a private schema, created
    here and dropped afterwards. Postgres enforces the foreign keys, so the
    rows below carry their real parents, chapter included."""
    if _IS_SQLITE:
        admin, schema = None, None
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    else:
        schema = "ace_" + uuid.uuid4().hex[:12]
        admin = create_engine(TEST_DATABASE_URL, future=True)
        with admin.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = create_engine(TEST_DATABASE_URL, future=True,
                               connect_args={"options": f"-csearch_path={schema}"})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, future=True)()
    session.add_all([
        SubjectGroup(id="sg1", code="SCI", display_name="Sciences"),
        Board(id="b1", code="CBSE", display_name="CBSE"),
        ClassLevel(id="cl1", code="5", display_name="Class 5", display_order=5),
        School(id="school-1", name="Test School"),
    ])
    session.flush()
    session.add_all([
        Discipline(id="d1", code="MATH", display_name="Mathematics", subject_group_id="sg1"),
        BoardCourse(id="bc1", board_id="b1", class_level_id="cl1", code="CBSE-5", display_name="CBSE Class 5"),
        CurriculumVersion(id="cv1", board_id="b1", code="CV1", label="2026-27"),
    ])
    session.flush()
    session.add(Chapter(id="ch-1", discipline_id="d1", board_course_id="bc1", curriculum_version_id="cv1",
                        code="CH01", chapter_no=1, title="Factors And Multiples"))
    session.flush()
    session.add(ConceptLesson(id="lesson-1", chapter_id="ch-1", code="C5-SD-S09", title="Coordinate reflection across a vertical line"))
    for code, stem, answer, variants, qtype, marks in [
        ("Q1", "Express 3,235 g in kilograms and grams.", "3 kg 235 g", "3 kg 235 g|3235 g|3,235 g", "Text Entry", 2),
        ("Q2", "Reflect point (5, 6) across the vertical line x=9.", "(13, 6)", "(13, 6)|13,6", "Text Entry", 2),
        ("Q3", "How many factors does 20 have?", "6", "6|6 units", "Numeric Entry", 1),
        # only ever the question sitting after Q3 in act-1, so that a test can
        # show its sequence does not shift. Q1 is deliberately in no set.
        ("Q9", "Round 48 to the nearest ten.", "50", "50", "Numeric Entry", 1),
    ]:
        session.add(Question(concept_lesson_id="lesson-1", code=code, question_type=qtype, stem=stem, correct_answer=answer,
                             accepted_variants=variants, marks=marks, auto_gradable=True, status="PUBLISHED", assignment_code="P09"))
    session.flush()
    q3, q9 = (session.query(Question).filter_by(code=c).one() for c in ("Q3", "Q9"))
    # A real activity row, and a real neighbouring question. Both used to be
    # invented ids ("act-1" with no activity, "other" with no question), which
    # only SQLite allowed -- on Postgres the foreign keys refuse them.
    session.add(LearningActivity(id="act-1", chapter_id="ch-1", concept_lesson_id="lesson-1",
                                 activity_type="CORE_PRACTICE", title="Practice act-1", status="DRAFT"))
    session.flush()
    session.add(LearningActivityQuestion(learning_activity_id="act-1", question_id=q3.id, sequence=1))
    session.add(LearningActivityQuestion(learning_activity_id="act-1", question_id=q9.id, sequence=2))
    session.commit()
    yield session
    session.close()
    engine.dispose()
    if admin is not None:
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


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
    assert q4.id not in links and links[db.query(Question).filter_by(code="Q9").one().id] == 2
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
    and it reaches a set only once a person approves it and activities are
    generated for the chapter."""
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
    assert "takes it once activities are generated" in summary and "Practice act-open" in summary
    [(code, after, root, sets)] = plan.where
    assert (code, after, root) == ("Q4", "Q3", "Q3")
    assert sorted(sets) == [("Practice act-1", False), ("Practice act-live", True),
                            ("Practice act-open", False)]
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
    assert "CHECK Q3 BEFORE CHILDREN PRACTISE AGAIN" in apply_content_edits._summary(plan)
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
    assert "Approve the new parts and generate activities to close that" not in summary
    assert "CHECK Q3 BEFORE CHILDREN PRACTISE AGAIN" in summary


def test_trimming_variants_is_not_treated_as_a_split(db, tmp_path):
    """The other half of the rule. EDITS trims Q3's accepted variants while
    NEW adds Q4 after Q3 -- the same shape as a split, but a variants trim
    cannot be one. A warning that fired here would be ignored when it
    mattered."""
    plan = apply_content_edits.read_and_plan(db, _workbook(tmp_path, edits=EDITS, new=NEW))
    assert plan.paired == []
    assert "BEFORE CHILDREN PRACTISE AGAIN" not in apply_content_edits._summary(plan)


def test_an_approved_new_question_reaches_its_set_when_activities_are_generated(db, tmp_path):
    """#262 end to end, against the real generator rather than a string in a
    report. The edit run adds Q4 as a Draft in no set; generating activities
    while it is still a Draft leaves it out (A-001); once a person approves
    it, generating places it. A set that is published and assigned never
    takes it at all, which is why the summary says so.

    This drives `generate_activities_for_chapter` directly, which is all the
    Super Admin generate route does. It is deliberately NOT the Approve and
    Publish path: that bulk-approves every unflagged question in the chapter
    first, so it would approve Q4 unread. And because the report tells the
    operator this route "approves nothing", every generate call below is
    followed by a check that no question's status moved."""
    from app.services import learning_service

    def statuses():
        return {q.code: q.status for q in db.query(Question).all()}

    for question in db.query(Question).all():  # the generator ignores a code it cannot classify
        question.assignment_code = "CH01-P09"
    open_set = LearningActivity(id="act-open", chapter_id="ch-1", concept_lesson_id="lesson-1",
                                activity_type="CORE_PRACTICE", title="Core Practice", status="PUBLISHED",
                                source_assignment_code="CH01-P09")
    db.add(open_set)
    db.add(LearningActivityQuestion(learning_activity_id="act-open",
                                    question_id=db.query(Question).filter_by(code="Q3").one().id, sequence=1))
    # a second Draft in the same chapter, which no generate call may approve
    db.query(Question).filter_by(code="Q1").one().status = "DRAFT"
    db.commit()
    chapter = db.query(Chapter).one()

    apply_content_edits.apply_plan(db, apply_content_edits.read_and_plan(db, _workbook(tmp_path, new=NEW)),
                                   workbook_name="edits.xlsx", workbook_sha256="x")
    q4 = db.query(Question).filter_by(code="Q4").one()

    before = statuses()
    learning_service.generate_activities_for_chapter(db, chapter, None)
    db.commit()
    assert statuses() == before, "generating approves nothing"
    assert before["Q4"] == "DRAFT" and before["Q1"] == "DRAFT"
    assert db.query(LearningActivityQuestion).filter_by(question_id=q4.id).count() == 0, \
        "a Draft must not be placed in a published set"

    q4.status = "APPROVED"  # a person, in Curriculum Studio
    db.commit()
    before = statuses()
    learning_service.generate_activities_for_chapter(db, chapter, None)
    db.commit()
    assert statuses() == before, "generating approves nothing"
    assert [l.learning_activity_id for l in db.query(LearningActivityQuestion).filter_by(question_id=q4.id).all()] \
        == ["act-open"], "once approved, generating activities places it in its own set"

    # the frozen case: the same set, now assigned, takes nothing more
    db.query(LearningActivityQuestion).filter_by(question_id=q4.id).delete()
    db.add(Assignment(school_id="school-1", learning_activity_id="act-open", status="ACTIVE"))
    db.commit()
    before = statuses()
    learning_service.generate_activities_for_chapter(db, chapter, None)
    db.commit()
    assert statuses() == before, "generating approves nothing"
    assert db.query(LearningActivityQuestion).filter_by(question_id=q4.id).count() == 0, \
        "a published, assigned set can never take another question"
    assert db.query(Question).filter_by(code="Q1").one().status == "DRAFT", \
        "and the other Draft in the chapter is still a Draft at the end"


def test_the_route_the_report_prints_is_the_real_one(db, tmp_path):
    """The report names one route as the safe way to place a new question.
    If that route moved or were mistyped, the operator would be sent nowhere
    -- and the first build did mistype it, leaving out the /api prefix. This
    checks the printed path against what the app actually serves.

    Read from the OpenAPI schema, not `app.routes`: FastAPI 0.148 (the pinned
    version) keeps each included router as one `_IncludedRouter` entry there,
    so walking `app.routes` finds no API paths at all."""
    from app.main import app

    served = app.openapi()["paths"]
    assert "post" in served.get(apply_content_edits.GENERATE_ROUTE, {})
    summary = apply_content_edits._summary(apply_content_edits.read_and_plan(db, _workbook(tmp_path, new=NEW)))
    assert f"POST {apply_content_edits.GENERATE_ROUTE} with" in summary
    assert "it works on the whole" in summary and "It publishes nothing." in summary


# --- #262 follow-up, 27 Nov: every new question gets a line ------------------
#
# The first build keyed the report on the neighbour's sets, so a new question
# could be absent from it altogether -- and a question missing from the report
# reads as one needing no action. These pin the invariant itself.

CHAIN = [
    ("Q4", "Q3", "B4", "Step 1. List every factor of 20 in order.", None, None, None, None,
     "1;2;4;5;10;20", None, 1, "Text Entry", "Short list", "Yes", None),
    ("Q5", "Q4", "B4", "Step 2. How many factors are there?", None, None, None, None,
     "6", None, 1, "Numeric Entry", "Number", "Yes", None),
]
STEM_EDIT = [("Q3", "Question Stem", "How many factors does 20 have?",
              "Step 1. List every factor of 20.", "B4", "split into steps")]


def _codes_with_a_line(plan) -> set:
    """The new-question codes the printed summary actually names."""
    return {code for _a, code, *_ in plan.new
            if any(line.strip().startswith(f"{code} ") or line.strip().startswith(f"{code}:")
                   or line.strip().startswith(f"{code} -") or line.strip().startswith(f"{code} (")
                   for line in apply_content_edits._summary(plan).splitlines())}


def test_every_new_question_in_a_chain_gets_a_line(db, tmp_path):
    """Q5 follows Q4, which is added on the same sheet. Q4's `After` is a
    Question, Q5's is a plain code string resolved later -- and the first
    build skipped the string case, so a workbook adding 2 questions printed
    one placement line. A split into steps is always a chain: 11 Nov was
    "5 written questions in steps, 8 new IDs"."""
    _set(db, "act-open", status="DRAFT", assigned=False)
    plan = apply_content_edits.read_and_plan(db, _workbook(tmp_path, new=CHAIN))
    assert {code for _a, code, *_ in plan.new} == {"Q4", "Q5"}
    assert _codes_with_a_line(plan) == {"Q4", "Q5"}
    # Q5 lands where its root does, and the line says it came along the sheet
    # Q5's After is Q4, and its root is Q3: the line has to name BOTH, or it
    # contradicts the workbook the person is holding.
    assert [(c, a, r) for c, a, r, _s in plan.where] == [("Q4", "Q3", "Q3"), ("Q5", "Q4", "Q3")]
    assert all(sorted(s) == [("Practice act-1", False), ("Practice act-open", False)]
               for *_h, s in plan.where), "both land wherever Q3 already is"
    assert "Q5 (after Q4 on this sheet, so it lands with Q3) -> Practice act-open" \
        in apply_content_edits._summary(plan)


def test_a_new_question_whose_neighbour_is_in_no_set_still_gets_a_line(db, tmp_path):
    """The "in no set" line used to be printed only when NO new question had
    a placement line, so mixing the two silenced one of them. Q4 follows Q3,
    which is in a set; Q6 follows Q1, which is in none."""
    _set(db, "act-open", status="DRAFT", assigned=False)
    mixed = list(NEW) + [("Q6", "Q1", "B4", "Express 3,235 g in kilograms.", None, None, None, None,
                          "3 kg 235 g", None, 1, "Text Entry", "Short", "Yes", None)]
    plan = apply_content_edits.read_and_plan(db, _workbook(tmp_path, new=mixed))
    assert _codes_with_a_line(plan) == {"Q4", "Q6"}
    summary = apply_content_edits._summary(plan)
    assert "Q4 -> Practice act-1: this set takes it once activities are generated." in summary
    assert "Q6: Q1 is in no practice set, so this run cannot say where it will land." in summary
    assert "Generating activities may still place it." in summary


def test_the_audit_row_names_every_new_question_too(db, tmp_path):
    """Whatever the summary says, the record has to carry it."""
    _set(db, "act-open", status="DRAFT", assigned=False)
    plan = apply_content_edits.read_and_plan(db, _workbook(tmp_path, new=CHAIN))
    apply_content_edits.apply_plan(db, plan, workbook_name="edits.xlsx", workbook_sha256="x")
    [audit] = db.query(AuditLog).filter_by(event_type=apply_content_edits.AUDIT_EVENT).all()
    rows = json.loads(audit.event_data_json)["newQuestionsAwaitingPlacement"]
    assert {r["code"] for r in rows} == {"Q4", "Q5"}
    assert [r["after"] for r in rows] == ["Q3", "Q4"], "the After the workbook actually names"
    assert [r["root"] for r in rows] == ["Q3", "Q3"], "and the database question the chain ends at"
    assert all(sorted((s["set"], s["frozen"]) for s in r["sets"])
               == [("Practice act-1", False), ("Practice act-open", False)] for r in rows)


def test_an_edit_to_the_stem_flags_a_split_not_only_a_rewrite(db, tmp_path):
    """A split can be typed on the Edits sheet as a change to the stem, not
    only as a whole-question Rewrite. Added coverage, not a fix: the shipped
    script already flagged this, and this test fails against it only because
    the warning's heading changed."""
    plan = apply_content_edits.read_and_plan(db, _workbook(tmp_path, edits=STEM_EDIT, new=NEW))
    assert plan.paired == ["Q3"]
    assert "CHECK Q3 BEFORE CHILDREN PRACTISE AGAIN" in apply_content_edits._summary(plan)


def test_an_unrelated_frozen_set_does_not_change_a_fixable_pair_s_remedy(db, tmp_path):
    """The remedy used to be keyed on any frozen set in the whole plan, so
    one unrelated frozen addition told the operator to revert a pair that
    publishing the chapter would have fixed. Q3's own set is open; Q1 sits in
    a frozen one and has its own new question."""
    _set(db, "act-open", status="DRAFT", assigned=False)
    frozen = LearningActivity(id="act-live", chapter_id="ch-1", concept_lesson_id="lesson-1",
                              activity_type="PRACTICE", title="Practice act-live", status="PUBLISHED")
    db.add(frozen)
    db.add(LearningActivityQuestion(learning_activity_id="act-live",
                                    question_id=db.query(Question).filter_by(code="Q1").one().id, sequence=1))
    db.add(Assignment(school_id="school-1", learning_activity_id="act-live", status="ACTIVE"))
    db.commit()
    mixed = list(NEW) + [("Q6", "Q1", "B4", "Express 3,235 g in kilograms.", None, None, None, None,
                          "3 kg 235 g", None, 1, "Text Entry", "Short", "Yes", None)]
    plan = apply_content_edits.read_and_plan(db, _workbook(tmp_path, rewrites=REWRITE_Q3, new=mixed))
    summary = apply_content_edits._summary(plan)
    assert plan.paired == ["Q3"]
    assert "Approve the new parts and generate activities to close that" in summary
    assert "only remedy" not in summary


def test_the_report_does_not_send_the_operator_down_the_bulk_approve_path(db, tmp_path):
    """The instruction the report prints has to be the surgical one. Approve
    and Publish and publish_courses.py both call `_bulk_approve_questions` on
    every BANK question in the chapter BEFORE generating activities, walking
    DRAFT -> SME_REVIEW -> APPROVED. Telling the operator to publish the
    chapter would therefore approve this question unread -- and every other
    Draft in that chapter with it (production held 4,828 in published
    chapters on 26 Nov) -- which is the very thing #262 removes."""
    _set(db, "act-open", status="DRAFT", assigned=False)
    summary = apply_content_edits._summary(
        apply_content_edits.read_and_plan(db, _workbook(tmp_path, new=NEW)))
    assert "POST /api/learning/activities/generate" in summary
    assert "approves nothing itself" in summary
    assert "DO NOT use Approve and Publish, or publish_courses.py, to place it." in summary
    assert "publish the chapter again" not in summary
