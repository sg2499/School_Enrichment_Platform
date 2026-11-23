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


# ---- Class 7 (17 Nov 2026) ----

def _class7_file(tmp_path, n=81):
    wb = openpyxl.Workbook()
    wb.active.title = "Start Here"
    qb, ak, mg, sm = (wb.create_sheet(t) for t in ("Question Bank", "Answer Key", "Marking Guide", "Skill Map"))
    for ws, header in ((qb, QB), (ak, AK), (mg, MG), (sm, SM)):
        ws.append(header)
    p = f"U{n}"
    rows = [
        (f"{p}-Q001", "Constructed Response", 3, "Show all working and explain your reasoning. Aarav: What is 2 + 3?", "None", "5"),
        (f"{p}-Q002", "Constructed Response", 3, "Ira: Explain why a square is a rectangle in two lines.",
         "None", "Because a square has four right angles and opposite sides equal, which is what a rectangle needs."),
        (f"{p}-Q003", "Numeric Entry", 1, "Rahul: Speed of a car covering 120 km in 2 hours?", "km/h", "60"),
    ]
    for qid, qtype, marks, stem, unit, key in rows:
        qb.append([qid, "Numbers", f"{p}-S01", "Add", 1, "A", "Core", qtype, marks, stem, unit,
                   "Not applicable", "Exact; no rounding", "No", "No external visual", "School to map"])
        ak.append([qid, key, "Because.", qtype, unit, "Exact", "Exact"])
        mg.append([qid, marks, "Auto-grade", "No", "1 mark.", "x", "Note"])
    sm.append([f"{p}-S01", "Add", "Theme 1: Numbers", "3", "-", "-", "School to map"])
    src = tmp_path / f"CISCE_Class_7_Maths_Lesson_{n}_Numbers_500Q.xlsx"
    wb.save(src)
    return src


def test_class7_short_written_answers_become_auto_marked_and_marks_are_kept(tmp_path):
    dst = tmp_path / "c7.xlsx"
    report = convert_workbook(_class7_file(tmp_path), dst, class_level="7", subject="Mathematics",
                              source_label="ICSE Class 7 Mathematics", reclassify_short_written=True)
    assert report.ok
    assert report.reclassified == 1 and dict(report.reclassified_marks) == {3: 1}
    rows = list(openpyxl.load_workbook(dst, read_only=True)["Question Bank"].iter_rows(values_only=True))
    by_id = {r[0]: dict(zip(rows[0], r)) for r in rows[1:]}
    assert by_id["U81-Q001"]["Question Type"] == "Numeric Entry"
    assert "Show all working" not in by_id["U81-Q001"]["Question Stem"]
    assert by_id["U81-Q001"]["Marks"] == 3
    assert by_id["U81-Q002"]["Question Type"] == "Constructed Response"  # a real written answer stays written


def test_class7_flag_off_leaves_written_answers_alone(tmp_path):
    dst = tmp_path / "c7b.xlsx"
    convert_workbook(_class7_file(tmp_path, 82), dst, class_level="7", subject="Mathematics",
                     source_label="ICSE Class 7 Mathematics")
    rows = list(openpyxl.load_workbook(dst, read_only=True)["Question Bank"].iter_rows(values_only=True))
    assert {dict(zip(rows[0], r))["Question Type"] for r in rows[1:]} >= {"Constructed Response"}


def test_class7_units_parse_and_never_cross_convert():
    from app.services import units
    assert units.unit_code("km/h") == "kmh" and units.unit_code("m/s") == "ms"
    assert units.unit_code("cm³") == "cm3" and units.unit_code("years") == "year" and units.unit_code("Days") == "day"
    assert units.convert(units.Decimal(1), "kmh", "ms") is None  # a question must ask for that conversion
    assert units.convert(units.Decimal(1), "year", "day") is None
    assert units.parse_measurement("60 km/h").unit == "kmh"


# --- A-047: a locked unit read from the wording (23 Nov 2026) --------------
#
# These files have no "Input Mode" column, so every measured answer fell
# through to Required. Where the question itself names the answer's unit,
# that is the locked-unit box Ashalatha asked for, and the rule is Stated.

A047_QB = QB + ["Input Mode"]


def _a047_file(tmp_path, n, rows):
    wb = openpyxl.Workbook()
    wb.active.title = "Start Here"
    qb, ak, mg, sm = (wb.create_sheet(t) for t in ("Question Bank", "Answer Key", "Marking Guide", "Skill Map"))
    header = A047_QB if any(mode for *_rest, mode in rows) else QB
    for ws, head in ((qb, header), (ak, AK), (mg, MG), (sm, SM)):
        ws.append(head)
    p = f"U{n}"
    for i, (stem, unit, key, mode) in enumerate(rows, start=1):
        qid = f"{p}-Q{i:03d}"
        row = [qid, "Numbers", f"{p}-S01", "Measure", 1, "A", "Diagnostic and foundation",
               "Numeric Entry", 1, stem, unit, "Not applicable", "Exact; no rounding", "No",
               "No external visual", "School to map"]
        qb.append(row + [mode] if header is A047_QB else row)
        ak.append([qid, key, "Because.", "Numeric Entry", unit, "Exact", "Exact"])
        mg.append([qid, 1, "Auto-grade", "No", "1 mark.", "x", "Teacher note"])
    sm.append([f"{p}-S01", "Measure", "Theme 1: Numbers", str(len(rows)), "Class 4 prerequisite review", "-", "School to map"])
    src = tmp_path / f"CISCE_Class_5_Maths_Lesson_{n}_Numbers_500Q.xlsx"
    wb.save(src)
    dst = tmp_path / f"out{n}.xlsx"
    report = convert_workbook(src, dst, class_level="5", subject="Mathematics", source_label="CISCE Class 5 Mathematics")
    rows_out = list(openpyxl.load_workbook(dst, read_only=True)["Question Bank"].iter_rows(values_only=True))
    return report, [dict(zip(rows_out[0], r)) for r in rows_out[1:]]


def test_a_wording_that_names_the_unit_locks_it(tmp_path):
    report, out = _a047_file(tmp_path, 81, [
        ("Add 1770 m and 994 m. Give the answer in metres.", "metres", "2764", None),
    ])
    assert out[0]["Unit Rule"] == "Stated"
    assert out[0]["Answer Unit"] == "m"
    assert out[0]["Response Format"] == "Number"
    assert report.locked_units == 1 and report.locked_units_read_from_stem == 1


def test_a_wording_that_names_no_unit_still_requires_it(tmp_path):
    report, out = _a047_file(tmp_path, 82, [("Find its length.", "metres", "12", None)])
    assert out[0]["Unit Rule"] == "Required"
    assert out[0]["Response Format"] == "Number and unit"
    assert report.locked_units_read_from_stem == 0


def test_a_wording_that_names_another_unit_still_requires_it(tmp_path):
    # Only an exact agreement locks the unit. Here the wording says minutes
    # and the recorded unit is seconds, so one of the two is wrong and the
    # converter changes nothing.
    report, out = _a047_file(tmp_path, 83, [("Find the elapsed time in minutes.", "seconds", "90", None)])
    assert out[0]["Unit Rule"] == "Required"
    assert report.locked_units_read_from_stem == 0


def test_an_input_mode_column_still_wins(tmp_path):
    report, out = _a047_file(tmp_path, 84, [("Find its length.", "metres", "12", "Locked unit")])
    assert out[0]["Unit Rule"] == "Stated"
    assert report.locked_units == 1 and report.locked_units_read_from_stem == 0


def test_a_written_answer_is_not_locked_from_its_wording(tmp_path):
    # Same scope as the marker (learning_service.uses_measured_marking) and
    # as scripts/apply_icse_unit_rules.py: on a teacher-marked answer the
    # unit rule decides no mark, so the wording does not lock it and his
    # 17 Nov call on written work is left as it stands.
    wb = openpyxl.Workbook()
    wb.active.title = "Start Here"
    qb, ak, mg, sm = (wb.create_sheet(t) for t in ("Question Bank", "Answer Key", "Marking Guide", "Skill Map"))
    for ws, head in ((qb, QB), (ak, AK), (mg, MG), (sm, SM)):
        ws.append(head)
    stem = "Show all working and explain your reasoning. Convert 49800 cm to metres."
    qb.append(["U91-Q001", "Numbers", "U91-S01", "Measure", 1, "A", "Diagnostic and foundation",
               "Written Response", 3, stem, "metres", "Not applicable", "Exact; no rounding", "No",
               "No external visual", "School to map"])
    ak.append(["U91-Q001", "498", "Because.", "Written Response", "metres", "Exact", "Exact"])
    mg.append(["U91-Q001", 3, "Teacher", "No", "1 mark for the reason.", "x", "Teacher note"])
    sm.append(["U91-S01", "Measure", "Theme 1: Numbers", "1", "Class 4 prerequisite review", "-", "School to map"])
    src = tmp_path / "CISCE_Class_5_Maths_Lesson_91_Numbers_500Q.xlsx"
    wb.save(src)
    dst = tmp_path / "out91.xlsx"
    report = convert_workbook(src, dst, class_level="5", subject="Mathematics", source_label="CISCE Class 5 Mathematics")
    rows = list(openpyxl.load_workbook(dst, read_only=True)["Question Bank"].iter_rows(values_only=True))
    written = dict(zip(rows[0], rows[1]))
    assert written["Question Type"] == "Constructed Response"
    assert written["Unit Rule"] == "Required"
    assert report.locked_units_read_from_stem == 0
