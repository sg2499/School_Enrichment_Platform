"""#161 and #160 (23 Oct 2026).

#161: a teacher sets practice for chosen students of a section they teach.
The students must all be in that section (anyone else refuses the whole
request), the assignment is recorded as that section's, and only the chosen
students get it. The list of a section's students is for its current
teacher and the school's admin only.

#160: an answer in several parts ("21310;22410") is offered to the student
as that many boxes, named when the question names them ("Enter
groups;remainder."); marking is unchanged.
"""
from app.models import Assignment, AssignmentTarget, Chapter
from app.services import learning_service
from tests import test_learning
from tests.test_learning import (
    _add_question,
    _assign_teacher_section,
    _login,
    _make_chapter_with_skills,
    _make_school,
    _make_school_admin,
    _make_sectioned_student,
    _make_teacher,
    _published_single_activity,
)

# Distinct chapter numbers, clear of every other test file.
test_learning._CHAPTER_NUM.update({"CS1": 121, "CS2": 122})


def test_a_teacher_assigns_chosen_students_of_their_own_section(client, db_session):
    activity = _published_single_activity(db_session, "CS1")
    school = _make_school(db_session, "cs1")
    teacher = _make_teacher(db_session, school, "cs1")
    course_id = db_session.get(Chapter, activity.chapter_id).board_course_id
    _assign_teacher_section(db_session, teacher, course_id, "A")
    a1 = _make_sectioned_student(db_session, school, "cs1-a1", class_name="5", section="A")
    a2 = _make_sectioned_student(db_session, school, "cs1-a2", class_name="5", section="A")
    a3 = _make_sectioned_student(db_session, school, "cs1-a3", class_name="5", section="A")
    b1 = _make_sectioned_student(db_session, school, "cs1-b1", class_name="5", section="B")
    db_session.commit()
    headers = _login(client, teacher.user.email)

    listed = client.get("/api/learning/section-students", params={"className": "5", "section": "A"}, headers=headers)
    assert listed.status_code == 200
    assert [s["studentCode"] for s in listed.json()["students"]] == [a1.student_code, a2.student_code, a3.student_code]
    other = client.get("/api/learning/section-students", params={"className": "5", "section": "B"}, headers=headers)
    assert other.status_code == 403

    body = {"learningActivityId": activity.id, "className": "5", "section": "A", "studentIds": [a1.id, a3.id]}
    made = client.post("/api/learning/assignments", json=body, headers=headers)
    assert made.status_code == 200, made.text
    assert made.json()["targetCount"] == 2
    assignment = db_session.get(Assignment, made.json()["id"])
    assert (assignment.section, assignment.board_course_id) == ("A", course_id) and assignment.class_level_id
    targets = {t.student_id for t in db_session.query(AssignmentTarget).filter_by(assignment_id=assignment.id)}
    assert targets == {a1.id, a3.id}

    for bad in ([a1.id, b1.id], [a1.id, a1.id]):
        refused = client.post("/api/learning/assignments", json={**body, "studentIds": bad}, headers=headers)
        assert refused.status_code == 422
    no_section = client.post("/api/learning/assignments", json={**body, "section": ""}, headers=headers)
    assert no_section.status_code == 422
    # A blank list must not become the whole section.
    blank = client.post("/api/learning/assignments", json={**body, "studentIds": [""]}, headers=headers)
    assert blank.status_code == 422


def test_an_admin_lists_and_chooses_students_too(client, db_session):
    activity = _published_single_activity(db_session, "CS2")
    school = _make_school(db_session, "cs2")
    admin = _make_school_admin(db_session, school, "cs2")
    a1 = _make_sectioned_student(db_session, school, "cs2-a1", class_name="5", section="A")
    b1 = _make_sectioned_student(db_session, school, "cs2-b1", class_name="5", section="B")
    db_session.commit()
    headers = _login(client, admin.email)
    listed = client.get("/api/learning/section-students", params={"className": "5", "section": "B"}, headers=headers)
    assert [s["id"] for s in listed.json()["students"]] == [b1.id]
    body = {"learningActivityId": activity.id, "className": "5", "section": "A", "studentIds": [a1.id]}
    assert client.post("/api/learning/assignments", json=body, headers=headers).json()["targetCount"] == 1
    mixed = client.post("/api/learning/assignments", json={**body, "studentIds": [a1.id, b1.id]}, headers=headers)
    assert mixed.status_code == 422
    # With no section named, an admin's chosen students work as before.
    loose = client.post(
        "/api/learning/assignments",
        json={"learningActivityId": activity.id, "studentIds": [a1.id, b1.id]},
        headers=headers,
    )
    assert loose.status_code == 200 and loose.json()["targetCount"] == 2


def test_an_answer_in_parts_gets_a_box_per_part(db_session):
    _chapter, (skill,) = _make_chapter_with_skills(db_session, "BLK1", n_skills=1)
    q2 = _add_question(
        db_session, skill, "BLK1-Q1", question_type="Text Entry", correct_answer="21310;22410", marks=2,
        auto_gradable=True, assignment_code="CH123-P01",
    )
    q2.stem = "Write the next two terms: 18,010, 19,110, 20,210, ___, ___."
    named = _add_question(
        db_session, skill, "BLK1-Q2", question_type="Text Entry", correct_answer="94;385", marks=2, auto_gradable=True,
        assignment_code="CH123-P01",
    )
    named.stem = "Divide 47,385 into complete groups of 500. Enter groups;remainder."
    single = _add_question(
        db_session, skill, "BLK1-Q3", question_type="Numeric Entry", correct_answer="5", marks=1, auto_gradable=True,
        assignment_code="CH123-P01",
    )
    choice = _add_question(
        db_session, skill, "BLK1-Q4", question_type="Single Select", correct_answer="A;B", marks=1, auto_gradable=True,
        assignment_code="CH123-P01",
    )
    db_session.commit()
    assert [learning_service.answer_blanks(q) for q in (q2, named, single, choice)] == [2, 2, 1, 1]
    assert learning_service.answer_blank_labels(q2) is None
    assert learning_service.answer_blank_labels(named) == ["Groups", "Remainder"]
    # Marking is as before: the boxes are joined with ";".
    assert learning_service.grade_answer(named, "94;385") == (True, 2)
    assert learning_service.grade_answer(named, "94; 385 ") == (True, 2)
    assert learning_service.grade_answer(named, "385;94") == (False, 0)
    assert learning_service.grade_answer(named, ";385") == (False, 0)
