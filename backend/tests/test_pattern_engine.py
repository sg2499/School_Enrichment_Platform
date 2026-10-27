"""The mock paper engine's core (#166 step 1, 27 Oct 2026).

Rules under test: pattern expressions are exact and safe (nothing outside a
short list can run); a spec with a problem is refused with every problem
listed; the same seed always makes the same question and different seeds
different ones; every copy of the five Chapter 1 sample patterns has the
right answer, worked out here independently; multiple-choice options are
all different with the mistake behind each wrong one kept; a case study's
parts and a long answer's marking steps come out whole; loading adds DRAFT
patterns, leaves unchanged ones alone and sends a changed one back to DRAFT
at the next version; only an approved pattern makes questions for a
school, never one the school already has; generated questions are marked
like any other and stay out of Curriculum Studio and practice sets; only
the Super Admin can see or preview patterns.
"""
import json
import math
import re
from fractions import Fraction
from pathlib import Path

import pytest

from app.models import AuditLog, Question
from app.models.papers import GeneratedQuestion, QuestionPattern
from app.services import learning_service, pattern_engine, pattern_expr, pattern_store
from app.services.pattern_engine import GenerationError, PatternError
from tests.test_learning import _login, _make_chapter_with_skills, _make_school, _make_student, _make_super_admin, _make_teacher

CONTENT = Path(__file__).resolve().parents[1] / "content" / "patterns" / "cbse-class-5-mathematics"


def _num(text: str) -> int:
    return int(text.replace(",", ""))


# --- expressions ------------------------------------------------------------------


def test_expressions_are_exact_and_safe():
    ev = lambda text, **env: pattern_expr.evaluate(pattern_expr.parse(text), env)  # noqa: E731
    assert ev("7 / 2") == Fraction(7, 2) and ev("6 / 3") == 2 and isinstance(ev("6 / 3"), int)
    assert ev("round_half_up(5250, 100)") == 5300 and ev("round_half_up(5249, 100)") == 5200
    assert ev("digit(58306, 1000)") == 8 and ev("count_digit(1211, 1)") == 3
    assert ev("ceil_div(53, 9)") == 6 and ev("frac(6, 8)") == Fraction(3, 4)
    assert ev("mode.lo + 1", mode={"lo": 3}) == 4
    assert ev("'up' if a > b else 'down'", a=2, b=1) == "up"
    for bad in (
        "__import__('os')", "a.__class__", "(1).real", "[1, 2][0]", "lambda: 1", "1.5 + 1", "open('x')",
        "a[0]", "{1: 2}", "x := 1", "2 ** 99", "print(1)", "max(*a)", "f'{a}'",
    ):
        with pytest.raises(pattern_expr.ExprError):
            ev(bad, a=[1], x=1)
    with pytest.raises(pattern_expr.ExprError):
        ev("1 / 0")
    with pytest.raises(pattern_expr.ExprError):
        pattern_expr.parse("1 + " * 100 + "1")  # too long
    # Review: a value too large on the way is refused at once, not only the result.
    for big in ("(((9 ** 12) ** 12) ** 12) % 7", "frac(1, 10 ** 12) ** 12", "num_digits((9 ** 12) ** 12)"):
        with pytest.raises(pattern_expr.ExprError, match="too large"):
            ev(big)
    for wrong_count in ("digit(5)", "abs(1, 2)", "min()"):
        with pytest.raises(pattern_expr.ExprError):
            pattern_expr.parse(wrong_count)


def test_a_broken_spec_lists_every_problem():
    with pytest.raises(PatternError) as stop:
        pattern_engine.clean_spec({
            "code": "X-1", "chapter": 1, "skill": "S1", "questionType": "Single Select", "marks": 2,
            "values": [{"name": "n", "int": {"min": 1, "max": 9}}],
            "text": "What is {m}?",
            "options": {"correct": "n", "wrong": [{"expr": "n + 1", "mistake": "one more"}]},
        })
    problems = " ".join(stop.value.problems)
    assert "uses m" in problems and "3 wrong ones" in problems and "needs marking steps" in problems
    with pytest.raises(PatternError) as stop:
        pattern_engine.clean_spec({
            "code": "X-2", "chapter": 1, "skill": "S1", "questionType": "Numeric Entry", "marks": 2,
            "values": [{"name": "n", "int": {"min": 1, "max": 9}}], "text": "What is {n}?", "answer": "n",
            "misconception": "Confuses {n:money2} with {n}", "steps": [{"marks": 1, "text": "x"}, {"marks": 1}],
            "unit": "furlongs", "competency": "c" * 151,
        })
    problems = " ".join(stop.value.problems)
    assert "money2" in problems and "step 2: needs its text" in problems and "furlongs" in problems and "competency" in problems


# --- generating ----------------------------------------------------------------------


def _content_specs():
    data = json.loads((CONTENT / "chapter-01.json").read_text(encoding="utf-8"))
    return {p["code"]: pattern_engine.clean_spec(p) for p in data["patterns"]}


SAMPLES = ("C5-WT1-S01-P1", "C5-WT1-S03-P1", "C5-WT1-S09-P1", "C5-WT1-S12-P1", "C5-WT1-S13-P1")


def test_every_chapter_1_pattern_works():
    """#166 step 2: every Chapter 1 pattern loads, makes a valid question in
    each of 200 tries with at least 20 different ones, carries its skill's
    own misconception note (so her reviews apply), and adds up its marks."""
    bank_notes = {
        "C5-WT1-S12": "Adds the rate once instead of multiplying by the number of equal intervals.",
    }
    specs = _content_specs()
    assert len(specs) >= 59
    kinds = {"1": 0, "2": 0, "3": 0, "4": 0, "5": 0}
    for code, spec in specs.items():
        result = pattern_engine.trial(spec, 200)
        assert result["failed"] == 0 and result["distinct"] >= 20, (code, result)
        kinds[str(spec.marks)] += 1
        made = pattern_engine.make(spec, "marks")
        assert sum(q["marks"] for q in made.questions) == spec.marks
        if spec.skill in bank_notes:
            assert made.misconception == bank_notes[spec.skill], code
    assert kinds["3"] >= 3 and kinds["4"] >= 3 and kinds["5"] >= 3 and kinds["2"] >= 15


def test_chapters_2_to_4_patterns_work():
    """#166 step 5, batch 1: Chapters 2 (Fractions), 3 (Angles as Turns) and
    4 (We the Travellers II). Each pattern loads, belongs to its chapter and
    skill, makes a valid question every time with at least 20 different
    ones, adds up its marks, and its key gets full marks from the
    platform's own marking."""
    prefixes = {2: "C5-FR2-", 3: "C5-AT-", 4: "C5-WT2-"}
    seen = set(_content_specs())
    for chapter, prefix in prefixes.items():
        data = json.loads((CONTENT / f"chapter-{chapter:02d}.json").read_text(encoding="utf-8"))
        assert data["engine"] == {"board": "CBSE", "classLevel": "5", "course": "MATHEMATICS"}
        kinds = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
        for raw in data["patterns"]:
            spec = pattern_engine.clean_spec(raw)
            assert spec.code not in seen and spec.code.startswith(prefix) and spec.skill.startswith(prefix), spec.code
            assert spec.chapter == chapter, spec.code
            seen.add(spec.code)
            kinds[spec.marks] += 1
            result = pattern_engine.trial(spec, 100)
            assert result["failed"] == 0 and result["distinct"] >= 20, (spec.code, result)
            for i in range(10):
                made = pattern_engine.make(spec, f"key-{i}")
                assert sum(q["marks"] for q in made.questions) == spec.marks, spec.code
                for q in made.questions:
                    if not q["auto_gradable"]:
                        continue
                    question = Question(
                        question_type=q["question_type"], correct_answer=q["correct_answer"],
                        accepted_variants=q["accepted_variants"], marks=q["marks"], auto_gradable=True,
                        answer_unit=q["answer_unit"], unit_rule=q["unit_rule"], response_format=q["response_format"],
                    )
                    assert learning_service.grade_answer(question, q["correct_answer"]) == (True, q["marks"]), (spec.code, q["stem"])
        assert len(data["patterns"]) >= 55 and kinds[3] >= 3 and kinds[4] >= 3 and kinds[5] >= 3, (chapter, kinds)


def test_the_same_seed_makes_the_same_question():
    spec = _content_specs()["C5-WT1-S09-P1"]
    one, two = pattern_engine.make(spec, "abc"), pattern_engine.make(spec, "abc")
    assert one.questions == two.questions
    others = {pattern_engine.make(spec, f"s{i}").questions[0]["stem"] for i in range(30)}
    assert len(others) == 30
    # A new version of the pattern draws differently from the same seed.
    assert pattern_engine.make(spec, "abc", version=2).questions != one.questions


def test_every_sample_copy_has_the_right_answer():
    """200 copies of each Chapter 1 sample pattern, each answer worked out
    here a second way, from the question's own words."""
    specs = {c: s for c, s in _content_specs().items() if c in SAMPLES}
    assert len(specs) == 5
    for code, spec in specs.items():
        for i in range(200):
            q = pattern_engine.make(spec, f"check-{i}").questions[0]
            stem, key = q["stem"], q["correct_answer"]
            chosen = q.get(f"option_{key.lower()}") if q["question_type"] == "Single Select" else None
            if code == "C5-WT1-S01-P1":
                a, b, c = [_num(x) for x in re.findall(r"\d[\d,]*", stem)[:3]]
                assert b - a == c - b and int(key) == c + (c - b), stem
            elif code == "C5-WT1-S03-P1":
                d, n = re.search(r"digit (\d) in ([\d,]+)", stem).groups()
                s = n.replace(",", "")
                assert s.count(d) == 1 and d != "0"
                assert _num(chosen) == int(d) * 10 ** (len(s) - 1 - s.index(d)), stem
            elif code == "C5-WT1-S09-P1":
                n = _num(re.search(r"Round ([\d,]+)", stem).group(1))
                assert _num(chosen) == (n + 50) // 100 * 100, stem
            elif code == "C5-WT1-S12-P1":
                speed, hours = re.search(r"at (\d+) km each hour.* in (\d+) hours", stem).groups()
                assert int(key) == int(speed) * int(hours), stem
            elif code == "C5-WT1-S13-P1":
                n, cap = re.search(r"^(\d+) children.*carry (\d+)", stem).groups()
                assert int(n) % int(cap) != 0 and int(key) == math.ceil(int(n) / int(cap)), stem
            else:
                pytest.fail(f"no independent check for {code}")
            if q["question_type"] == "Single Select":
                shown = [q[f"option_{x}"] for x in "abcd"]
                assert len(set(shown)) == 4
                assert set(q["mistakes"]) == set("ABCD") - {key}
            assert len(stem.split()) <= spec.max_words and "{" not in stem


CASE_STUDY = {
    "code": "T-CASE-1", "chapter": 1, "skill": "S1", "marks": 4,
    "values": [
        {"name": "price", "int": {"min": 12, "max": 40}},
        {"name": "count", "int": {"min": 3, "max": 9}},
        {"name": "paid", "expr": "round_half_up(price * count + 50, 100)"},
    ],
    "require": ["paid > price * count"],
    "stimulus": "Case study: A class buys {count} footballs at ₹{price} each and pays with ₹{paid:num}.",
    "parts": [
        {"questionType": "Numeric Entry", "marks": 1, "text": "(a) What is the total cost?", "answer": "price * count"},
        {"questionType": "Numeric Entry", "marks": 1, "text": "(b) How much change is given?", "answer": "paid - price * count"},
        {"questionType": "Single Select", "marks": 1, "text": "(c) Which is the cost of one football?",
         "options": {"correct": "price", "wrong": [
             {"expr": "price * count", "mistake": "gives the total"},
             {"expr": "paid", "mistake": "gives the amount paid"},
             {"expr": "price + count", "mistake": "adds the price and the number"}]}},
        {"questionType": "Numeric Entry", "marks": 1, "text": "(d) How many more footballs could the change buy?",
         "answer": "(paid - price * count) // price"},
    ],
}

LONG_ANSWER = {
    "code": "T-LONG-1", "chapter": 1, "skill": "S1", "questionType": "Constructed Response", "marks": 5,
    "values": [{"name": "who", "list": "names"}, {"name": "km", "int": {"min": 120, "max": 480, "step": 10}},
               {"name": "days", "int": {"min": 2, "max": 6}}],
    "require": ["km % days == 0"],
    "text": "{who.name} plans a {km} km trip over {days} days, going the same distance each day. How far does {who.he} go each day? Show your working.",
    "answer": "{km} ÷ {days} = {km // days} km each day.",
    "steps": [
        {"marks": 1, "text": "Sees that the trip is shared equally between {days} days."},
        {"marks": 2, "text": "Divides {km} by {days} correctly."},
        {"marks": 1, "text": "Answer {km // days}."},
        {"marks": 1, "text": "Writes the unit, km."},
    ],
}


def test_case_studies_and_long_answers():
    case = pattern_engine.clean_spec(CASE_STUDY)
    made = pattern_engine.make(case, "x")
    assert case.is_group and case.question_type == "Case Study" and len(made.questions) == 4 and sum(q["marks"] for q in made.questions) == 4
    assert all(q["stem"].startswith("Case study: A class buys") for q in made.questions)
    price, count, paid = (made.values[k] for k in ("price", "count", "paid"))
    assert int(made.questions[1]["correct_answer"]) == paid - price * count
    long = pattern_engine.make(pattern_engine.clean_spec(LONG_ANSWER), "y").questions[0]
    assert long["auto_gradable"] is False and long["teacher_note"].count("\n") == 3
    assert long["teacher_note"].startswith("1 mark: Sees") and "2 marks: Divides" in long["teacher_note"]
    with pytest.raises(PatternError):
        pattern_engine.clean_spec({**CASE_STUDY, "marks": 5})
    with pytest.raises(PatternError):
        pattern_engine.clean_spec({**LONG_ANSWER, "steps": LONG_ANSWER["steps"][:2]})


def test_fraction_answers_are_marked_in_every_right_form():
    from app.models import Question

    spec = pattern_engine.clean_spec({
        "code": "T-FRAC", "chapter": 1, "skill": "S1", "questionType": "Numeric Entry", "marks": 1,
        "answerFormat": "fraction", "values": [{"name": "a", "choice": [7]}, {"name": "b", "choice": [2]}],
        "text": "Share {a} cakes equally between {b} children. How much does each child get?", "answer": "frac(a, b)",
    })
    data = pattern_engine.make(spec, "f").questions[0]
    assert (data["correct_answer"], data["accepted_variants"]) == ("7/2", "3.5|3 1/2")
    q = Question(question_type="Numeric Entry", stem=data["stem"], correct_answer=data["correct_answer"],
                 accepted_variants=data["accepted_variants"], marks=1, auto_gradable=True)
    for right in ("7/2", "3.5", "3 1/2"):
        assert learning_service.grade_answer(q, right)[0] is True, right
    assert learning_service.grade_answer(q, "3")[0] is False


def test_an_unworkable_pattern_says_so():
    spec = pattern_engine.clean_spec({
        "code": "T-NEVER", "chapter": 1, "skill": "S1", "questionType": "Numeric Entry", "marks": 1,
        "values": [{"name": "n", "int": {"min": 1, "max": 9}}], "require": ["n > 100"],
        "text": "What is {n}?", "answer": "n",
    })
    with pytest.raises(GenerationError):
        pattern_engine.make(spec, "z")
    assert pattern_engine.trial(spec, 3) == {"tried": 3, "failed": 3, "distinct": 0}


# --- loading, approving, storing --------------------------------------------------------


def _entries(course_code: str, skill_code: str, patterns: list[dict]):
    engine = {"board": "CBSE", "classLevel": "5", "course": course_code}
    return [("t.json", engine, {**p, "skill": skill_code}) for p in patterns]


def _tiny(code="T-TINY", top=3):
    return {"code": code, "chapter": 1, "questionType": "Numeric Entry", "marks": 1,
            "values": [{"name": "n", "int": {"min": 1, "max": top}}], "text": "Write the number {n}.", "answer": "n"}


def test_load_approve_and_generate_for_a_school(db_session, tmp_path):
    db = db_session
    chapter, (skill, _s2) = _make_chapter_with_skills(db, "PE1")
    school = _make_school(db, "pe1")
    student = _make_student(db, school, "pat-pe1")
    db.commit()

    patterns = json.loads((CONTENT / "chapter-01.json").read_text(encoding="utf-8"))["patterns"]
    spec = {**next(p for p in patterns if p["code"] == "C5-WT1-S12-P1"), "code": "T-RATE"}
    entries = _entries("MATH-PE1", skill.code, [spec, _tiny(top=25)])
    loads_before = db.query(AuditLog).filter(AuditLog.event_type == pattern_store.AUDIT_LOAD).count()
    plan = pattern_store.make_plan(db, entries, trial_count=60)
    assert len(plan.add) == 2 and not plan.change
    pattern_store.apply_plan(db, plan)
    rate = db.query(QuestionPattern).filter_by(code="T-RATE").one()
    assert (rate.status, rate.version, rate.concept_lesson_id) == ("DRAFT", 1, skill.id)
    again = pattern_store.make_plan(db, entries, trial_count=60)
    assert (again.add, again.change, again.unchanged) == ([], [], 2)

    # A DRAFT pattern makes nothing for a school.
    with pytest.raises(GenerationError, match="not approved"):
        pattern_engine.generate_for_student(db, rate, school_id=school.id, student_id=student.id)

    # Her sheet approves it (version 1).
    import openpyxl
    book = openpyxl.Workbook()
    sheet = book.active
    sheet.title = "Patterns"
    sheet.append(["Pattern ID", "Decision"])
    sheet.append(["T-RATE", "Approve"])
    sheet.append(["T-TINY", "Reject"])
    path = tmp_path / "reviewed.xlsx"
    book.save(path)
    result = pattern_store.apply_decisions(db, pattern_store.read_decisions(str(path)), reviewer="Ashalatha Gupta", workbook="reviewed.xlsx")
    assert result == {"changed": 2, "unchanged": 0}
    db.refresh(rate)
    assert rate.status == "APPROVED" and rate.approved_by == "Ashalatha Gupta"

    rows = pattern_engine.generate_for_student(db, rate, school_id=school.id, student_id=student.id)
    db.commit()
    (question,) = rows
    assert question.origin == "GENERATED" and question.concept_lesson_id == skill.id and question.code.startswith("GEN-")
    record = db.query(GeneratedQuestion).filter_by(question_id=question.id).one()
    assert (record.school_id, record.student_id, record.pattern_version) == (school.id, student.id, 1)
    values = json.loads(record.values_json)
    # Marked like any other question.
    right = str(values["speed"] * values["hours"])
    assert learning_service.grade_answer(question, right) == (True, 1)
    assert learning_service.grade_answer(question, f"{right} km")[0] is True
    assert learning_service.grade_answer(question, str(int(right) + 1))[0] is False

    # Never in Curriculum Studio's counts or a chapter's practice sets.
    from app.models import LearningActivityQuestion

    learning_service.generate_activities_for_chapter(db, chapter, created_by_user_id=None)
    assert db.query(LearningActivityQuestion).filter_by(question_id=question.id).count() == 0
    assert db.query(Question).filter(Question.concept_lesson_id == skill.id, Question.origin == "BANK").count() == 0

    # Changing an approved pattern sends it back to DRAFT at version 2, and
    # her version-1 approval can't be replayed onto it.
    changed = pattern_store.make_plan(db, _entries("MATH-PE1", skill.code, [{**spec, "maxWords": 50}]), trial_count=60)
    pattern_store.apply_plan(db, changed)
    db.refresh(rate)
    assert (rate.status, rate.version, rate.approved_by) == ("DRAFT", 2, None)
    with pytest.raises(pattern_store.StopBeforeWriting, match="not the version she reviewed"):
        pattern_store.apply_decisions(db, pattern_store.read_decisions(str(path)), reviewer="A", workbook="r")
    assert db.query(AuditLog).filter(AuditLog.event_type == pattern_store.AUDIT_LOAD).count() == loads_before + 2


def test_a_student_never_gets_the_same_question_twice(db_session):
    """Shailesh, 27 Oct 2026: uniqueness is per student (per school would
    use a small pattern up within one class)."""
    db = db_session
    chapter, (skill, _s2) = _make_chapter_with_skills(db, "PE2")
    school = _make_school(db, "pe2")
    student, classmate = _make_student(db, school, "pat-pe2"), _make_student(db, school, "pat-pe2-o")
    db.commit()
    plan = pattern_store.make_plan(db, _entries("MATH-PE2", skill.code, [_tiny("T-TINY-2", top=3)]), trial_count=30, min_distinct=3)
    pattern_store.apply_plan(db, plan)
    tiny = db.query(QuestionPattern).filter_by(code="T-TINY-2").one()
    tiny.status = "APPROVED"
    db.commit()
    make = lambda who, n: pattern_engine.generate_for_student(db, tiny, school_id=school.id, student_id=who.id, attempts=n)  # noqa: E731
    stems = {make(student, 60)[0].stem for _ in range(3)}
    db.commit()
    assert stems == {"Write the number 1.", "Write the number 2.", "Write the number 3."}
    with pytest.raises(GenerationError, match="used up"):
        make(student, 30)
    # A classmate is a separate count.
    assert make(classmate, 60)
    db.commit()


def test_reshuffled_options_are_the_same_question(db_session):
    """Review: a multiple-choice question with its options in another order
    is the same question, for the trial count and for a student."""
    spec_raw = {
        "code": "T-SS-SMALL", "chapter": 1, "questionType": "Single Select", "marks": 1,
        "values": [{"name": "n", "int": {"min": 3, "max": 4}}], "text": "What is {n} + {n}?",
        "options": {"correct": "n + n", "wrong": [
            {"expr": "n * n", "mistake": "multiplies"}, {"expr": "n", "mistake": "gives n"},
            {"expr": "n + 1", "mistake": "adds one"}]},
    }
    spec = pattern_engine.clean_spec({**spec_raw, "skill": "S"})
    assert pattern_engine.trial(spec, 40)["distinct"] == 2
    db = db_session
    _chapter, (skill, _s2) = _make_chapter_with_skills(db, "PE5")
    school = _make_school(db, "pe5")
    student = _make_student(db, school, "pat-pe5")
    db.commit()
    plan = pattern_store.make_plan(db, _entries("MATH-PE5", skill.code, [spec_raw]), trial_count=40, min_distinct=2)
    pattern_store.apply_plan(db, plan)
    pattern = db.query(QuestionPattern).filter_by(code="T-SS-SMALL").one()
    pattern.status = "APPROVED"
    db.commit()
    stems = {pattern_engine.generate_for_student(db, pattern, school_id=school.id, student_id=student.id, attempts=80)[0].stem for _ in range(2)}
    db.commit()
    assert stems == {"What is 3 + 3?", "What is 4 + 4?"}
    with pytest.raises(GenerationError, match="used up"):
        pattern_engine.generate_for_student(db, pattern, school_id=school.id, student_id=student.id, attempts=40)


def test_a_bad_file_stops_the_load(db_session):
    db = db_session
    _chapter, (skill, _s2) = _make_chapter_with_skills(db, "PE3")
    with pytest.raises(pattern_store.StopBeforeWriting) as stop:
        pattern_store.make_plan(db, _entries("MATH-PE3", "NO-SUCH-SKILL", [_tiny()]) + _entries("NOPE", skill.code, [_tiny("T-2")]))
    assert "no single skill NO-SUCH-SKILL" in str(stop.value) and "No single course" in str(stop.value)
    one_value = {**_tiny("T-ONE", top=1)}
    with pytest.raises(pattern_store.StopBeforeWriting, match="only 1 different"):
        pattern_store.make_plan(db, _entries("MATH-PE3", skill.code, [one_value]), trial_count=30)
    assert db.query(QuestionPattern).filter(QuestionPattern.code.in_(["T-ONE", "T-2"])).count() == 0


def test_only_the_super_admin_sees_patterns(client, db_session):
    db = db_session
    _chapter, (skill, _s2) = _make_chapter_with_skills(db, "PE4")
    school = _make_school(db, "pe4")
    teacher = _make_teacher(db, school, "pe4")
    sa = _make_super_admin(db, "pe4")
    student = _make_student(db, school, "pat-pe4")
    db.commit()
    pattern_store.apply_plan(db, pattern_store.make_plan(db, _entries("MATH-PE4", skill.code, [_tiny("T-TINY-4", top=50)]), trial_count=30))
    pattern = db.query(QuestionPattern).filter_by(code="T-TINY-4").one()

    headers = {**_login(client, sa.email), "x-auth-role": "SUPER_ADMIN"}
    listed = client.get("/api/question-patterns", params={"boardCourseId": pattern.board_course_id}, headers=headers).json()
    assert [p["code"] for p in listed["patterns"]] == ["T-TINY-4"] and listed["counts"]["DRAFT"] == 1
    detail = client.get(f"/api/question-patterns/{pattern.id}", headers=headers).json()
    assert detail["spec"]["code"] == "T-TINY-4" and detail["skill"]["code"] == skill.code
    shown = client.post(f"/api/question-patterns/{pattern.id}/preview", json={"count": 3, "seed": "a1"}, headers=headers)
    assert shown.status_code == 200, shown.text
    copies = shown.json()["copies"]
    assert len(copies) == 3 and copies[0]["questions"][0]["stem"].startswith("Write the number")
    # Previewing stores nothing.
    assert db.query(GeneratedQuestion).filter_by(pattern_id=pattern.id).count() == 0
    assert client.post(f"/api/question-patterns/{pattern.id}/preview", json={"count": 50}, headers=headers).status_code == 422

    # A generated question stays out of Curriculum Studio and can't be edited there.
    pattern.status = "APPROVED"
    db.commit()
    (made,) = pattern_engine.generate_for_student(db, pattern, school_id=school.id, student_id=student.id)
    db.commit()
    studio = client.get(f"/api/curriculum-admin/chapters/{_chapter.id}", headers=headers)
    assert studio.status_code == 200, studio.text
    lessons = {lesson["code"]: lesson for lesson in studio.json()["conceptLessons"]}
    assert lessons[skill.code]["questionCount"] == 0 and made.code not in studio.text
    edit = client.patch(f"/api/curriculum-admin/questions/{made.id}/status", json={"status": "DRAFT"}, headers=headers)
    assert edit.status_code == 409 and edit.json()["detail"]["code"] == "GENERATED_QUESTION"

    from fastapi.testclient import TestClient

    from app.main import app
    other = TestClient(app)
    teacher_headers = {**_login(other, teacher.user.email), "x-auth-role": "TEACHER"}
    assert other.get("/api/question-patterns", headers=teacher_headers).status_code == 403
