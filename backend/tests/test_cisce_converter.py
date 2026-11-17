"""The CISCE ("ICSE" on screen) lesson workbooks are converted to the importer's
layout (task #234). Small synthetic workbook in the real files' layout; the
real 5,000 questions are not committed."""
import openpyxl

from app.models import Board, Chapter, ConceptLesson, Question
from app.services import learning_service
from app.services.cisce_converter import BOARD_CODE, convert_workbook
from app.services.curriculum_import_service import import_chapter_workbook

QB = ["Question ID", "Lesson", "Skill ID", "Skill", "Day", "Form", "Stage", "Question Type", "Marks",
      "Question", "Expected Unit", "Equivalent Units Allowed", "Rounding Rule", "Working Required",
      "Visual/Data Status", "Publisher Chapter"]
AK = ["Question ID", "Correct Answer", "Explanation", "Answer Type", "Expected Unit", "Accepted Answer Rule", "Rounding Rule"]
MG = ["Question ID", "Marks", "Grading Mode", "Working Required", "Rubric", "Unit Enforcement", "Teacher Note"]
SM = ["Skill ID", "Skill", "Official Theme", "Questions", "Prerequisite Skill", "Direct Remediation Route", "School Textbook Chapter"]


def _lesson_file(tmp_path, n, *, key_for_q2="1700"):
    wb = openpyxl.Workbook()
    wb.active.title = "Start Here"
    qb, ak, mg, sm = (wb.create_sheet(t) for t in ("Question Bank", "Answer Key", "Marking Guide", "Skill Map"))
    for ws, header in ((qb, QB), (ak, AK), (mg, MG), (sm, SM)):
        ws.append(header)
    p = f"T{n}"
    rows = [
        (f"{p}-Q001", f"{p}-S01", "Add", "Numeric Entry", 1, "Aarav: Calculate 1,200 + 34.", "None", "1234"),
        (f"{p}-Q002", f"{p}-S01", "Add", "Numeric Entry", 1, "Ira: A shopkeeper buys an item for ₹1700. Cost price?", "rupees", key_for_q2),
        (f"{p}-Q003", f"{p}-S02", "Temperature", "Numeric Entry", 1, "Thermometer reads -9°C. Which integer?", "°C", "-9"),
        (f"{p}-Q004", f"{p}-S02", "Temperature", "Text Entry", 1, "Name the shape with four equal sides.", "None", "Square"),
        (f"{p}-Q005", f"{p}-S02", "Temperature", "Written Response", 3, "Explain why -3 is less than 2.", "None", "Because it is left of 2 on the number line."),
    ]
    for qid, sid, skill, qtype, marks, stem, unit, key in rows:
        qb.append([qid, "Numbers", sid, skill, 1, "A", "Diagnostic and foundation", qtype, marks, stem, unit,
                   "Not applicable", "Exact; no rounding", "No", "No external visual", "School to map"])
        ak.append([qid, key, "Because.", qtype, unit, "Exact", "Exact"])
        mg.append([qid, marks, "Teacher" if qtype == "Written Response" else "Auto-grade", "No",
                   "1 mark for the reason." if qtype == "Written Response" else "1 mark.", "x", "Teacher note"])
    sm.append([f"{p}-S01", "Add", "Theme 1: Numbers", "3", "Class 4 prerequisite review", "-", "School to map"])
    sm.append([f"{p}-S02", "Temperature", "Theme 1: Numbers", "2", f"{p}-S01", "-", "School to map"])
    src = tmp_path / f"CISCE_Class_5_Maths_Lesson_{n}_Numbers_500Q.xlsx"
    wb.save(src)
    return src


def _convert(tmp_path, n, **kw):
    src = _lesson_file(tmp_path, n, **kw)
    dst = tmp_path / f"out{n}.xlsx"
    report = convert_workbook(src, dst, class_level="5", subject="Mathematics", source_label="CISCE Class 5 Mathematics")
    return report, dst


def test_converts_strips_names_and_keeps_ids(tmp_path):
    report, dst = _convert(tmp_path, 71)
    assert report.ok  # the fixture's skills have 3 and 2 questions, not 25: a warning, not an error
    assert any("not 25" in w for w in report.warnings)
    assert sum(report.stripped_names.values()) == 2
    rows = list(openpyxl.load_workbook(dst, read_only=True)["Question Bank"].iter_rows(values_only=True))
    header, first = rows[0], dict(zip(rows[0], rows[1]))
    assert first["Question ID"] == "T71-Q001"
    assert first["Question Stem"] == "Calculate 1,200 + 34."
    assert first["Status"] == "Draft"
    assert first["Chapter No."] == 71
    assert "Answer Unit" in header and "Unit Rule" in header


def test_written_becomes_constructed_response_with_rubric(tmp_path):
    _, dst = _convert(tmp_path, 72)
    rows = list(openpyxl.load_workbook(dst, read_only=True)["Question Bank"].iter_rows(values_only=True))
    written = dict(zip(rows[0], rows[5]))
    assert written["Question Type"] == "Constructed Response"
    assert written["Auto-gradable"] == "No"
    assert "1 mark for the reason." in written["Teacher Note"]
    assert written["Marks"] == 3


def test_a_wrong_key_for_plain_arithmetic_blocks_the_lesson(tmp_path):
    src = _lesson_file(tmp_path, 73)
    wb = openpyxl.load_workbook(src)
    wb["Answer Key"]["B2"] = "1235"  # 1,200 + 34 is 1234
    wb.save(src)
    report = convert_workbook(src, tmp_path / "o.xlsx", class_level="5", subject="Mathematics", source_label="x")
    assert not report.ok
    assert any("1234" in e for e in report.errors)


def test_a_missing_answer_blocks_the_lesson(tmp_path):
    src = _lesson_file(tmp_path, 74)
    wb = openpyxl.load_workbook(src)
    wb["Answer Key"]["B3"] = None
    wb.save(src)
    report = convert_workbook(src, tmp_path / "o.xlsx", class_level="5", subject="Mathematics", source_label="x")
    assert any("no correct answer" in e for e in report.errors)


def test_imports_as_invisible_draft_under_the_cisce_board(tmp_path, db_session):
    _report, dst = _convert(tmp_path, 75)
    result = import_chapter_workbook(
        db_session, str(dst), board_code=BOARD_CODE, board_display_name="ICSE", class_level_code="5",
        curriculum_version_status="DRAFT",
    )
    assert result.questions_created == 5 and not result.warnings
    board = db_session.query(Board).filter(Board.code == "CISCE").one()
    assert board.display_name == "ICSE"
    chapter = db_session.query(Chapter).filter(Chapter.title == "Numbers", Chapter.chapter_no == 75).one()
    assert chapter.status == "DRAFT"
    questions = db_session.query(Question).join(ConceptLesson, Question.concept_lesson_id == ConceptLesson.id).filter(
        ConceptLesson.chapter_id == chapter.id).all()
    assert {q.status for q in questions} == {"DRAFT"}
    assert {q.code: q.question_type for q in questions}["T75-Q005"] == "Constructed Response"


def test_unit_is_required_and_celsius_is_known(tmp_path, db_session):
    _, dst = _convert(tmp_path, 76)
    import_chapter_workbook(db_session, str(dst), board_code=BOARD_CODE, board_display_name="ICSE",
                            class_level_code="5", curriculum_version_status="DRAFT")
    rupees = db_session.query(Question).filter(Question.code == "T76-Q002").one()
    temp = db_session.query(Question).filter(Question.code == "T76-Q003").one()
    assert (rupees.answer_unit, rupees.unit_rule) == ("rupee", "REQUIRED")
    assert (temp.answer_unit, temp.unit_rule) == ("celsius", "REQUIRED")
    # the child must type the unit
    assert learning_service.grade_answer(temp, "-9 °C")[0] is True
    assert learning_service.grade_answer(temp, "-9")[0] is not True
    assert learning_service.grade_answer(rupees, "1700 rupees")[0] is True
    assert learning_service.grade_answer(rupees, "1700")[0] is not True
