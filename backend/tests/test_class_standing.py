"""Class standing (#185, 26 Oct 2026).

Rules under test: the whole class at the school, all sections; only Top 10%
/ Top 25% / Top Half, nothing below; Top 10% only in a class of 30+; a
standing only when 10+ students each have 3+ marked answers; students level
on score share the better place; only practice the teacher set counts (not a
student's own practice); classmates who have left (inactive student or
sign-in) and other schools are not counted; the student is sent a band and
the class's name, nothing else.
"""
import pytest

from app.models import AssignmentTarget, SchoolCurriculumMap
from app.services import learning_service, progress_service, standing_service
from app.services.standing_service import TOP_10, TOP_25, TOP_HALF, _bands, band_from_position
from tests import test_learning
from tests.test_learning import (
    _ac,
    _add_question,
    _login,
    _make_chapter_with_skills,
    _make_school,
    _make_sectioned_student,
    _publish,
)

test_learning._CHAPTER_NUM.update({"CLS1": 141, "CLS2": 142})


@pytest.fixture(autouse=True)
def _fresh_cache():
    standing_service.clear_cache()
    yield
    standing_service.clear_cache()


def test_bands_from_position():
    # A class of 10: the top is Top 25%, never Top 10% (that would say "first").
    assert [band_from_position(above, 10) for above in range(10)] == [
        TOP_25, TOP_25, TOP_25, TOP_HALF, TOP_HALF, None, None, None, None, None,
    ]
    assert band_from_position(0, 29) == TOP_25 and band_from_position(0, 30) == TOP_10
    assert band_from_position(2, 30) == TOP_10 and band_from_position(3, 30) == TOP_25
    assert band_from_position(0, 0) is None
    assert band_from_position(24, 100) == TOP_25 and band_from_position(25, 100) == TOP_HALF


def test_enough_students_and_ties():
    ten = {f"s{i}": (10 - i) / 10 for i in range(10)}
    bands = _bands(ten)
    assert bands["s0"] == TOP_25 and "s5" not in bands
    level = {**ten, "s3": 1.0}  # level with the top
    assert _bands(level)["s3"] == TOP_25
    assert _bands({k: v for k, v in ten.items() if k != "s9"}) == {}


def _world(db, suffix, n_students, *, n_questions=3):
    chapter, (skill,) = _make_chapter_with_skills(db, suffix, n_skills=1)
    questions = [_add_question(db, skill, f"{suffix}-Q{i}", assignment_code=_ac(suffix, "P01")) for i in range(n_questions)]
    rem = [_add_question(db, skill, f"{suffix}-R{i}", assignment_code=_ac(suffix, "REM-S01")) for i in range(3)]
    db.commit()
    activities = learning_service.generate_activities_for_chapter(db, chapter, created_by_user_id=None)
    for a in activities:
        _publish(db, a)
    core = next(a for a in activities if a.activity_type == "CORE_PRACTICE")
    remediation = next(a for a in activities if a.activity_type == "REMEDIATION")
    school = _make_school(db, suffix.lower())
    db.add(SchoolCurriculumMap(school_id=school.id, board_course_id=chapter.board_course_id, chapter_id=chapter.id, class_name="5"))
    students = [
        _make_sectioned_student(db, school, f"{suffix.lower()}-{i}", class_name="5", section="A" if i % 2 else "B")
        for i in range(n_students)
    ]
    db.commit()
    return {"chapter": chapter, "questions": questions, "rem": rem, "core": core, "remediation": remediation, "school": school, "students": students}


def _do(db, w, activity, student, answers):
    assignment = learning_service.create_assignment(db, school=w["school"], learning_activity=activity, assigned_by_user_id=None, student_ids=[student.id])
    target = db.query(AssignmentTarget).filter_by(assignment_id=assignment.id).one()
    attempt = learning_service.start_attempt(db, student, target.id)
    for q, text in answers.items():
        learning_service.save_answer(db, student, attempt.id, q.id, text)
    learning_service.submit_attempt(db, student, attempt.id)
    return assignment


def test_the_student_sees_a_band_only_and_the_class_spans_sections(client, db_session):
    w = _world(db_session, "CLS1", 10, n_questions=10)
    # Scores 10, 9, 8, 7, 6, then 0 for five, out of 10.
    for student, right in zip(w["students"], [10, 9, 8, 7, 6, 0, 0, 0, 0, 0]):
        _do(db_session, w, w["core"], student, {q: ("A" if n < right else "B") for n, q in enumerate(w["questions"])})

    def mine(student):
        headers = {**_login(client, student.user.email), "x-auth-role": "STUDENT"}
        return client.get("/api/learning/my-progress", headers=headers).json()

    top = mine(w["students"][0])
    assert top["standing"] == {"overall": TOP_25, "classLabel": "Class 5"}
    assert top["chapters"][0]["standing"] == TOP_25
    assert mine(w["students"][2])["standing"]["overall"] == TOP_25
    assert mine(w["students"][3])["standing"]["overall"] == TOP_HALF
    low = mine(w["students"][9])
    assert low["standing"]["overall"] is None and low["chapters"][0]["standing"] is None
    # The teacher's view of a student carries none.
    teacher_view = progress_service.progress_payload(db_session, w["students"][0], for_student=False)
    assert "standing" not in teacher_view and "standing" not in teacher_view["chapters"][0]

    # A student whose sign-in is switched off leaves the class: nine left.
    standing_service.clear_cache()
    w["students"][9].user.is_active = False
    db_session.commit()
    assert standing_service.class_standing(db_session, w["students"][0], [w["chapter"].id]) == {"overall": None, "chapters": {}}


def test_own_practice_does_not_count_and_other_schools_do_not_either(db_session):
    w = _world(db_session, "CLS2", 10)
    s = w["students"]
    # s0 to s4 score 1 of 3 on the teacher's set; s5 to s9 score 0.
    for i, student in enumerate(s):
        right = 1 if i < 5 else 0
        _do(db_session, w, w["core"], student, {q: ("A" if n < right else "B") for n, q in enumerate(w["questions"])})
    # s9 does the (easier) Remediation set on their own, all right: as their
    # own practice, it doesn't lift them in the class.
    own = learning_service.create_assignment(
        db_session, school=w["school"], learning_activity=w["remediation"], assigned_by_user_id=s[9].user_id,
        student_ids=[s[9].id], reason="SELF_PRACTICE",
    )
    target = db_session.query(AssignmentTarget).filter_by(assignment_id=own.id).one()
    attempt = learning_service.start_attempt(db_session, s[9], target.id)
    for q in w["rem"]:
        learning_service.save_answer(db_session, s[9], attempt.id, q.id, "A")
    learning_service.submit_attempt(db_session, s[9], attempt.id)
    chapter_ids = [w["chapter"].id]
    # Counted, it would put s9 on top; it isn't, so s9 stays in the lower half.
    assert standing_service.class_standing(db_session, s[9], chapter_ids)["chapters"] == {}
    # The five level at the top share the better place: Top 25%.
    assert standing_service.class_standing(db_session, s[4], chapter_ids)["chapters"] == {w["chapter"].id: TOP_25}
    # 3 marked answers each is too few for an overall standing (10 needed).
    assert standing_service.class_standing(db_session, s[0], chapter_ids)["overall"] is None
    # Another school's Class 5 isn't part of this class.
    other = _make_sectioned_student(db_session, _make_school(db_session, "cls2-other"), "cls2-o", class_name="5", section="A")
    assert standing_service.class_standing(db_session, other, chapter_ids) == {"overall": None, "chapters": {}}
