"""Proves curriculum_import_service.import_chapter_workbook() against a
small synthetic workbook matching the real content team's format (verified
directly against the actual CBSE_Class_5_Chapter_1.xlsx/Chapter_7.xlsx/
Chapter_10.xlsx files during development -- see curriculum_import_service.py
docstring). The real 500-question chapter files are proprietary client
content and are not committed to this public repo, so this fixture is
intentionally small and self-contained rather than checking in real content.

Each test builds a workbook with its own chapter number -- the test DB is an
in-memory SQLite instance shared across the whole session (see conftest.py),
not reset per test, so distinct chapter/question codes avoid cross-test
collisions the same way test_auth.py and test_platform.py already do.
"""
import openpyxl
import pytest

from app.models import Board, BoardCourse, Chapter, ConceptLesson, Question
from app.services.curriculum_import_service import import_chapter_workbook

QUESTION_BANK_HEADER = [
    "Question ID", "Board", "Class", "Subject", "Chapter No", "Chapter",
    "Skill ID", "Skill", "Assignment ID", "Stage", "Difficulty", "Competency",
    "Question Type", "Question Stem", "Option A", "Option B", "Option C", "Option D",
    "Correct Answer", "Accepted Variants", "Hint", "Step-by-Step Explanation",
    "Misconception Tag", "Marks", "Time (seconds)", "Auto-gradable", "Shuffle Options",
    "Response Format", "Media Required", "Teacher Note", "Status", "Source Alignment",
]

SKILL_MAP_HEADER = [
    "Skill ID", "Skill", "Learning Outcome", "Prerequisite / Gap Check",
    "Priority Misconception", "Question Count", "Diagnostic", "Core Practice",
    "Support / Extension", "Coverage Check",
]


def _build_fixture_workbook(path: str, chapter_no: int, title: str) -> None:
    ch = f"CH{chapter_no:02d}"
    skill1, skill2 = f"T5-C{chapter_no}-S01", f"T5-C{chapter_no}-S02"

    wb = openpyxl.Workbook()
    qb = wb.active
    qb.title = "Question Bank"
    qb.append(QUESTION_BANK_HEADER)
    qb.append([
        f"TEST-C5-{ch}-Q001", "CBSE / NCERT", 5, "Mathematics", chapter_no, title,
        skill1, "Test skill one", f"{ch}-DIAG", "Diagnostic", 1, "Fluency",
        "Numeric Entry", "What is 2 + 2?", None, None, None, None,
        "4", "4", "Add the numbers.", "2 + 2 = 4", "Miscounts", 1, 30,
        "Yes", "No", "Integer", "None", None, "Draft", "Test alignment",
    ])
    qb.append([
        f"TEST-C5-{ch}-Q002", "CBSE / NCERT", 5, "Mathematics", chapter_no, title,
        skill2, "Test skill two", f"{ch}-P01", "Core Practice", 2, "Application",
        "Single Select", "Which is even?", "3", "4", "5", "7",
        "B", None, "Even numbers divide by 2.", "4 / 2 = 2", "Confuses odd/even", 1, 45,
        "Yes", "No", "Choice", "None", None, "Published", "Test alignment",
    ])

    sm = wb.create_sheet("Skill Map")
    sm.append([f"{title} Skill Map"])
    sm.append([])
    sm.append(SKILL_MAP_HEADER)
    sm.append([skill1, "Test skill one", "Add small numbers.", "Counting to 10.", "Miscounts", 1, 1, 0, 0, "Complete"])
    sm.append([skill2, "Test skill two", "Identify even numbers.", "Division by 2.", "Confuses odd/even", 1, 0, 1, 0, "Complete"])

    wb.save(path)


@pytest.fixture()
def fixture_workbook(tmp_path):
    path = tmp_path / "test_chapter.xlsx"
    _build_fixture_workbook(str(path), chapter_no=1, title="Test Chapter One")
    return str(path)


def test_import_creates_full_hierarchy(db_session, fixture_workbook):
    result = import_chapter_workbook(db_session, fixture_workbook)

    assert result.chapter_code == "CH01"
    assert result.chapter_title == "Test Chapter One"
    assert result.concept_lessons_created == 2
    assert result.questions_created == 2
    assert result.warnings == []

    board = db_session.query(Board).filter(Board.code == "CBSE").first()
    assert board is not None
    chapter = db_session.query(Chapter).filter(Chapter.code == "CH01").first()
    assert chapter is not None
    assert chapter.status == "DRAFT"

    lessons = db_session.query(ConceptLesson).filter(ConceptLesson.chapter_id == chapter.id).all()
    assert len(lessons) == 2
    assert {l.code for l in lessons} == {"T5-C1-S01", "T5-C1-S02"}

    q1 = db_session.query(Question).filter(Question.code == "TEST-C5-CH01-Q001").first()
    assert q1.question_type == "Numeric Entry"
    assert q1.correct_answer == "4"
    assert q1.status == "DRAFT"  # source said "Draft"

    q2 = db_session.query(Question).filter(Question.code == "TEST-C5-CH01-Q002").first()
    # The workbook says "Published" for this row. Until 27 Nov 2026 it landed
    # PUBLISHED, which is A-035: a supplier's spreadsheet could put a question
    # in front of children with nobody having read it. A new question is now
    # always a Draft, and the run says so.
    assert q2.status == "DRAFT"
    assert q2.option_b == "4"


def test_import_is_idempotent(db_session, tmp_path):
    path = tmp_path / "ch2.xlsx"
    _build_fixture_workbook(str(path), chapter_no=2, title="Idempotency Test Chapter")

    import_chapter_workbook(db_session, str(path))
    second = import_chapter_workbook(db_session, str(path))

    assert second.concept_lessons_created == 0
    assert second.concept_lessons_updated == 2
    assert second.questions_created == 0
    assert second.questions_updated == 2

    assert db_session.query(Chapter).filter(Chapter.code == "CH02").count() == 1
    assert db_session.query(Question).filter(Question.code.like("TEST-C5-CH02-%")).count() == 2


def test_second_chapter_reuses_shared_master_data(db_session, tmp_path):
    boards_before = db_session.query(Board).count()
    board_courses_before = db_session.query(BoardCourse).count()

    path_a = tmp_path / "ch3.xlsx"
    _build_fixture_workbook(str(path_a), chapter_no=3, title="Shared Master Data Chapter A")
    import_chapter_workbook(db_session, str(path_a))

    path_b = tmp_path / "ch4.xlsx"
    _build_fixture_workbook(str(path_b), chapter_no=4, title="Shared Master Data Chapter B")
    result = import_chapter_workbook(db_session, str(path_b))
    assert result.chapter_code == "CH04"

    # Master data (board/board_course/discipline) shared, not duplicated --
    # both chapters use the same default CBSE/Mathematics/Class 5 codes.
    assert db_session.query(Board).count() == boards_before
    assert db_session.query(BoardCourse).count() == board_courses_before
    assert db_session.query(Chapter).filter(Chapter.code.in_(["CH03", "CH04"])).count() == 2


def test_import_warns_on_orphan_skill_reference(db_session, tmp_path):
    path = tmp_path / "ch5.xlsx"
    _build_fixture_workbook(str(path), chapter_no=5, title="Orphan Reference Chapter")

    wb = openpyxl.load_workbook(path)
    qb = wb["Question Bank"]
    qb.cell(row=2, column=7, value="T5-C5-S99")  # Skill ID column, not in Skill Map
    wb.save(path)

    result = import_chapter_workbook(db_session, str(path))
    assert len(result.warnings) == 1
    assert "T5-C5-S99" in result.warnings[0]
    assert result.questions_created == 1  # the other, valid row still imports


# --- Marking columns (Phase 4, #164, 13 Oct 2026) ----------------------------

MARKING_HEADERS = ["Answer Unit", "Unit Rule", "Allow Conversion", "Tolerance", "Decimal Places", "Unit Mark"]


def _with_marking_columns(path: str, chapter_no: int, title: str, q001_marking: list, *, headers=MARKING_HEADERS) -> None:
    """The fixture workbook with the marking columns added after the 32
    existing ones, filled for Q001 and left empty for Q002."""
    _build_fixture_workbook(path, chapter_no, title)
    wb = openpyxl.load_workbook(path)
    qb = wb["Question Bank"]
    for offset, header in enumerate(headers):
        qb.cell(row=1, column=33 + offset, value=header)
        qb.cell(row=2, column=33 + offset, value=q001_marking[offset])
    wb.save(path)


def test_marking_columns_are_read_by_header_name(db_session, tmp_path):
    path = tmp_path / "marking.xlsx"
    _with_marking_columns(str(path), 903, "Marking One", ["Grams", "required", "Yes", 0.5, 1, 2])
    result = import_chapter_workbook(db_session, str(path))
    assert result.warnings == []
    q = db_session.query(Question).filter(Question.code == "TEST-C5-CH903-Q001").one()
    assert (q.answer_unit, q.unit_rule, q.allow_unit_conversion) == ("g", "REQUIRED", True)
    assert (q.numeric_tolerance, q.decimal_places, q.unit_mark) == ("0.5", 1, 2)
    other = db_session.query(Question).filter(Question.code == "TEST-C5-CH903-Q002").one()
    assert (other.answer_unit, other.unit_rule, other.allow_unit_conversion) == (None, None, False)
    assert (other.numeric_tolerance, other.decimal_places, other.unit_mark) == (None, None, None)


def test_a_workbook_without_the_columns_imports_as_before_and_keeps_stored_values(db_session, tmp_path):
    with_columns = tmp_path / "with.xlsx"
    _with_marking_columns(str(with_columns), 904, "Marking Two", ["cm", "Stated", "No", None, None, None])
    import_chapter_workbook(db_session, str(with_columns))
    old_format = tmp_path / "old.xlsx"
    _build_fixture_workbook(str(old_format), 904, "Marking Two")
    result = import_chapter_workbook(db_session, str(old_format))
    assert result.warnings == [] and result.questions_updated == 2
    q = db_session.query(Question).filter(Question.code == "TEST-C5-CH904-Q001").one()
    assert (q.answer_unit, q.unit_rule) == ("cm", "STATED")  # not wiped by the older file


def test_an_empty_cell_clears_and_a_bad_value_is_warned_and_left(db_session, tmp_path):
    first = tmp_path / "first.xlsx"
    _with_marking_columns(str(first), 905, "Marking Three", ["kg", "Required", "No", "0.1", 2, 1])
    import_chapter_workbook(db_session, str(first))
    second = tmp_path / "second.xlsx"
    _with_marking_columns(str(second), 905, "Marking Three", [None, "Sometimes", "maybe", "-1", 2.5, "two"])
    result = import_chapter_workbook(db_session, str(second))
    q = db_session.query(Question).filter(Question.code == "TEST-C5-CH905-Q001").one()
    assert q.answer_unit is None  # empty cell: cleared
    assert (q.unit_rule, q.allow_unit_conversion, q.numeric_tolerance, q.decimal_places, q.unit_mark) == (
        "REQUIRED", False, "0.1", 2, 1,
    )  # each bad value left as it was
    assert len(result.warnings) == 5
    assert all(w.startswith("Question TEST-C5-CH905-Q001: ") and w.endswith("Left as it was.") for w in result.warnings)
    assert any("Unit Rule must be None, Stated or Required." in w for w in result.warnings)


def test_only_some_marking_columns_may_be_present(db_session, tmp_path):
    path = tmp_path / "some.xlsx"
    _with_marking_columns(str(path), 906, "Marking Four", ["m", "Stated"], headers=["answer unit", " UNIT RULE "])
    result = import_chapter_workbook(db_session, str(path))
    assert result.warnings == []
    q = db_session.query(Question).filter(Question.code == "TEST-C5-CH906-Q001").one()
    assert (q.answer_unit, q.unit_rule, q.allow_unit_conversion, q.unit_mark) == ("m", "STATED", False, None)


def test_a_new_question_is_always_a_draft_whatever_the_workbook_says(db_session, tmp_path):
    """A-035. The Status column is the supplier's claim, not a decision of
    ours. `import_class5_maths.py` has always printed "all land in DRAFT" on
    screen; now that is true."""
    path = tmp_path / "ch41.xlsx"
    _build_fixture_workbook(str(path), chapter_no=41, title="Draft On Arrival Chapter")
    result = import_chapter_workbook(db_session, str(path))

    published_row = db_session.query(Question).filter(Question.code == "TEST-C5-CH41-Q002").one()
    assert published_row.status == "DRAFT"
    assert published_row.approval_source is None, "an import is not an approval"
    # Counted, not warned: a new question starting as a Draft is the rule,
    # and a supplier workbook can carry hundreds of such rows.
    assert result.questions_status_ignored == 1
    assert result.warnings == [], result.warnings


def test_importing_the_same_workbook_twice_does_not_approve_anything(db_session, tmp_path):
    """The hole a first draft of this fix left open. Run one lands the row as
    a Draft; run two used to take the workbook at its word and approve it --
    and this loader advertises itself as safe to re-run, so that is the
    likely path, not an edge case."""
    path = tmp_path / "ch44.xlsx"
    _build_fixture_workbook(str(path), chapter_no=44, title="Re-run Chapter")
    import_chapter_workbook(db_session, str(path))
    import_chapter_workbook(db_session, str(path))

    question = db_session.query(Question).filter(Question.code == "TEST-C5-CH44-Q002").one()
    assert question.status == "DRAFT", "a second run must not approve what the first left as a draft"
    assert question.approval_source is None


def test_an_import_never_sends_a_live_question_back(db_session, tmp_path):
    """The same rule in the other direction. A workbook's "SME Review" on an
    approved question would pull it out of every set it is in, which is
    A-011 part 4 undone by a spreadsheet."""
    path = tmp_path / "ch45.xlsx"
    _build_fixture_workbook(str(path), chapter_no=45, title="No Send Back Chapter")
    import_chapter_workbook(db_session, str(path))

    question = db_session.query(Question).filter(Question.code == "TEST-C5-CH45-Q001").one()
    question.status = "APPROVED"
    db_session.commit()

    import_chapter_workbook(db_session, str(path))

    db_session.refresh(question)
    assert question.status == "APPROVED"
    assert question.sent_back_at is None


def test_a_workbook_does_not_overwrite_a_question_a_person_approved(db_session, tmp_path):
    """A-035's main event: a re-import used to rewrite the stem, the key and
    the marking of live content without a word."""
    path = tmp_path / "ch46.xlsx"
    _build_fixture_workbook(str(path), chapter_no=46, title="Approved Content Chapter")
    import_chapter_workbook(db_session, str(path))

    question = db_session.query(Question).filter(Question.code == "TEST-C5-CH46-Q001").one()
    question.status = "APPROVED"
    question.stem = "A reviewer's own wording."
    question.correct_answer = "5"
    db_session.commit()

    result = import_chapter_workbook(db_session, str(path))

    db_session.refresh(question)
    assert question.stem == "A reviewer's own wording.", "the workbook must not overrule a reviewer"
    assert question.correct_answer == "5"
    assert result.questions_skipped_approved == 1
    warning = next(w for w in result.warnings if "already approved" in w)
    # The fields are named, so a run over live content says WHY it refused --
    # "differs in: answer_unit" is actionable where "it differs" is not.
    assert "differs in:" in warning, warning
    assert "stem" in warning and "correct_answer" in warning, warning


def test_the_override_flag_replaces_it_and_names_it(db_session, tmp_path):
    """And the way through, for when the supplier is right. What it replaced
    is recorded BY CODE -- A-012's finding was that a count cannot answer
    "which ones"."""
    path = tmp_path / "ch47.xlsx"
    _build_fixture_workbook(str(path), chapter_no=47, title="Override Chapter")
    import_chapter_workbook(db_session, str(path))

    question = db_session.query(Question).filter(Question.code == "TEST-C5-CH47-Q001").one()
    question.status = "APPROVED"
    question.stem = "A reviewer's own wording."
    db_session.commit()

    result = import_chapter_workbook(db_session, str(path), allow_approved_overwrite=True)

    db_session.refresh(question)
    assert question.stem == "What is 2 + 2?", "the workbook's version is applied"
    assert result.overwritten_codes == ["TEST-C5-CH47-Q001"]
    assert question.status == "APPROVED", "replacing the content is not re-approving it"


def test_an_unchanged_approved_row_is_skipped_without_a_warning(db_session, tmp_path):
    """A re-run over a whole class is mostly rows that match what is stored.
    Warning on every one of them would bury the handful that differ."""
    path = tmp_path / "ch48.xlsx"
    _build_fixture_workbook(str(path), chapter_no=48, title="Quiet Re-run Chapter")
    import_chapter_workbook(db_session, str(path))

    question = db_session.query(Question).filter(Question.code == "TEST-C5-CH48-Q001").one()
    question.status = "APPROVED"
    db_session.commit()

    result = import_chapter_workbook(db_session, str(path))

    assert result.questions_skipped_approved == 0
    assert not [w for w in result.warnings if "already approved" in w]


def test_a_question_id_that_belongs_to_another_chapter_is_refused(db_session, tmp_path):
    """A-036. A question is found by its code alone and uq_question_code is
    global, so a workbook reusing another board's Question ID did not
    collide -- it moved that question into this chapter and rewrote it,
    inside whatever sets already held it."""
    first = tmp_path / "ch49.xlsx"
    _build_fixture_workbook(str(first), chapter_no=49, title="Original Chapter")
    import_chapter_workbook(db_session, str(first))
    original = db_session.query(Question).filter(Question.code == "TEST-C5-CH49-Q001").one()
    original_lesson_id = original.concept_lesson_id
    original_stem = original.stem

    # A second chapter whose workbook reuses the first chapter's Question ID.
    second = tmp_path / "ch50.xlsx"
    _build_fixture_workbook(str(second), chapter_no=50, title="Colliding Chapter")
    book = openpyxl.load_workbook(str(second))
    sheet = book["Question Bank"]
    sheet.cell(row=2, column=1).value = "TEST-C5-CH49-Q001"
    sheet.cell(row=2, column=14).value = "A different question that stole the ID."
    book.save(str(second))

    result = import_chapter_workbook(db_session, str(second))

    db_session.refresh(original)
    assert original.concept_lesson_id == original_lesson_id, "it must not be moved"
    assert original.stem == original_stem, "it must not be rewritten"
    assert result.questions_skipped_other_chapter == 1
    assert any("another chapter" in w for w in result.warnings), result.warnings


def test_an_import_leaves_an_audit_row(db_session, tmp_path):
    """A-035: an import used to leave no trace at all."""
    from app.models import AuditLog

    path = tmp_path / "ch51.xlsx"
    _build_fixture_workbook(str(path), chapter_no=51, title="Audited Chapter")
    import_chapter_workbook(db_session, str(path))

    # AuditLog.id is a uuid string, so ordering by it is not chronological --
    # the row is found by what it says instead.
    rows = [
        r.event_data_json
        for r in db_session.query(AuditLog).filter(
            AuditLog.event_type == "curriculum.chapter.imported"
        )
    ]
    mine = [r for r in rows if r and "CH51" in r]
    assert len(mine) == 1, rows
    assert "ch51.xlsx" in mine[0]
    assert '"questionsCreated": 2' in mine[0]


def test_a_published_chapters_skills_are_not_rewritten(db_session, tmp_path):
    """A-035 extended to skills, after a production dry run showed 225 skill
    rows being rewritten per pass -- including the names Ashalatha reviewed.
    A workbook does not overrule a reviewer there either."""
    from app.models import Chapter, ConceptLesson

    path = tmp_path / "ch52.xlsx"
    _build_fixture_workbook(str(path), chapter_no=52, title="Published Skills Chapter")
    import_chapter_workbook(db_session, str(path))

    chapter = db_session.query(Chapter).filter(Chapter.code == "CH52").one()
    chapter.status = "PUBLISHED"
    lesson = (
        db_session.query(ConceptLesson)
        .filter(ConceptLesson.chapter_id == chapter.id, ConceptLesson.code == "T5-C52-S01")
        .one()
    )
    lesson.title = "A reviewer's own skill name."
    db_session.commit()

    result = import_chapter_workbook(db_session, str(path))

    db_session.refresh(lesson)
    assert lesson.title == "A reviewer's own skill name."
    assert result.concept_lessons_skipped_published == 1
    assert any("this chapter is published" in w for w in result.warnings), result.warnings


def test_an_unpublished_chapters_skills_are_still_updated(db_session, tmp_path):
    """Nothing is live to protect in a chapter nobody has published, and a
    re-import correcting a skill name there is the point of the loader."""
    from app.models import ConceptLesson

    path = tmp_path / "ch53.xlsx"
    _build_fixture_workbook(str(path), chapter_no=53, title="Draft Skills Chapter")
    import_chapter_workbook(db_session, str(path))

    lesson = db_session.query(ConceptLesson).filter(ConceptLesson.code == "T5-C53-S01").one()
    lesson.title = "Stale name."
    db_session.commit()

    result = import_chapter_workbook(db_session, str(path))

    db_session.refresh(lesson)
    assert lesson.title == "Test skill one", "a draft chapter still takes the workbook's version"
    assert result.concept_lessons_skipped_published == 0
