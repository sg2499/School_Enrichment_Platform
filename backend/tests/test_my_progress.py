"""My Progress (#184, 26 Oct 2026): a student's skill map and self-practice.

The rules under test (PHASE6_MY_PROGRESS_DESIGN.md): each question's latest
marked answer counts; bands Strong 80+, Getting There 50-79, Needs Work
below 50, from 3 marked questions ("Just Started" below that, "Not Started"
with none); a written answer waiting for its mark is skipped. Self-practice
opens a weak skill's published Extra Practice or Remediation set, is reused
while it has attempts left, is left out of the student's Daily Practice
list, the tracker's assignment list and numbers, and term marks, and is
refused for a strong skill, a set of another kind or an unmapped chapter.
"""
from app.models import Assignment, AssignmentTarget, Chapter, ClassLevel, Question, SchoolCurriculumMap
from app.services import learning_service, progress_service
from tests import test_learning
from tests.test_learning import (
    _ac,
    _add_question,
    _assign_teacher_section,
    _login,
    _make_chapter_with_skills,
    _make_school,
    _make_sectioned_student,
    _make_teacher,
    _publish,
)

test_learning._CHAPTER_NUM.update({"MP1": 131, "MP2": 132, "MP3": 133})


def _setup(db, suffix):
    """A chapter with three skills, mapped to a school's Class 5:
    skill 1 has a 4-question core set (one a written answer) and a 2-question
    remediation set; skill 2 a 2-question core set; skill 3 nothing."""
    chapter, (s1, s2, s3) = _make_chapter_with_skills(db, suffix, n_skills=3)
    core1 = [
        _add_question(db, s1, f"{suffix}-C1-{i}", assignment_code=_ac(suffix, "P01")) for i in range(1, 4)
    ]
    written = _add_question(
        db, s1, f"{suffix}-C1-W", assignment_code=_ac(suffix, "P01"), question_type="Constructed Response",
        correct_answer="Because.", auto_gradable=False,
    )
    for i in range(1, 3):
        _add_question(db, s1, f"{suffix}-R1-{i}", assignment_code=_ac(suffix, "REM-S01"))
        _add_question(db, s2, f"{suffix}-C2-{i}", assignment_code=_ac(suffix, "P02"))
    db.commit()
    activities = learning_service.generate_activities_for_chapter(db, chapter, created_by_user_id=None)
    by_code = {a.source_assignment_code: a for a in activities}
    for activity in activities:
        _publish(db, activity)
    school = _make_school(db, suffix)
    db.add(SchoolCurriculumMap(school_id=school.id, board_course_id=chapter.board_course_id, chapter_id=chapter.id, class_name="5"))
    student = _make_sectioned_student(db, school, f"{suffix}-s", class_name="5", section="A")
    teacher = _make_teacher(db, school, suffix)
    _assign_teacher_section(db, teacher, chapter.board_course_id, "A")
    db.commit()
    return {
        "chapter": chapter, "skills": (s1, s2, s3), "core1": core1, "written": written, "school": school,
        "student": student, "teacher": teacher,
        "p01": by_code[_ac(suffix, "P01")], "p02": by_code[_ac(suffix, "P02")], "rem": by_code[_ac(suffix, "REM-S01")],
    }


def _assign(db, setup, activity):
    assignment = learning_service.create_assignment(
        db, school=setup["school"], learning_activity=activity, assigned_by_user_id=setup["teacher"].user_id,
        class_name="5", section="A",
    )
    return db.query(AssignmentTarget).filter_by(assignment_id=assignment.id).one()


def _do(db, student, target_id, answers):
    attempt = learning_service.start_attempt(db, student, target_id)
    for question_id, text in answers.items():
        learning_service.save_answer(db, student, attempt.id, question_id, text)
    learning_service.submit_attempt(db, student, attempt.id)
    return attempt


def _skill(payload, skill_id):
    return next(s for ch in payload["chapters"] for s in ch["skills"] if s["id"] == skill_id)


def test_scores_use_the_latest_marked_answer_and_bands_follow(db_session):
    setup = _setup(db_session, "MP1")
    student, (s1, s2, s3) = setup["student"], setup["skills"]
    core = setup["core1"]
    target = _assign(db_session, setup, setup["p01"])
    _do(db_session, student, target.id, {core[0].id: "A", core[1].id: "B", core[2].id: "B", setup["written"].id: "x"})
    payload = progress_service.progress_payload(db_session, student, for_student=True)
    first = _skill(payload, s1.id)
    # 1 of 3 marked (the written answer is waiting for its mark).
    assert (first["answered"], first["percent"], first["band"]) == (3, 33.3, "NEEDS_WORK")
    assert _skill(payload, s3.id)["band"] == "NOT_STARTED"

    target2 = _assign(db_session, setup, setup["p02"])
    p02_questions = db_session.query(Question).filter_by(concept_lesson_id=s2.id).all()
    _do(db_session, student, target2.id, {q.id: "A" for q in p02_questions})
    assert _skill(progress_service.progress_payload(db_session, student, for_student=True), s2.id)["band"] == "JUST_STARTED"

    # A second attempt, all right: the latest answers replace the first.
    _do(db_session, student, target.id, {q.id: "A" for q in core})
    again = progress_service.progress_payload(db_session, student, for_student=True)
    assert (_skill(again, s1.id)["percent"], _skill(again, s1.id)["band"]) == (100.0, "STRONG")
    assert again["summary"]["strong"] == 1 and again["summary"]["skills"] == 3
    assert progress_service.band_for(79.9, 3) == "GETTING_THERE" and progress_service.band_for(50, 5) == "GETTING_THERE"


def test_self_practice_on_a_weak_skill(client, db_session):
    setup = _setup(db_session, "MP2")
    student, (s1, _s2, _s3) = setup["student"], setup["skills"]
    target = _assign(db_session, setup, setup["p01"])
    _do(db_session, student, target.id, {q.id: "B" for q in setup["core1"]})

    headers = {**_login(client, student.user.email), "x-auth-role": "STUDENT"}
    mine = client.get("/api/learning/my-progress", headers=headers).json()
    [nxt] = mine["practiseNext"]
    assert nxt["skill"]["id"] == s1.id and nxt["skill"]["band"] == "NEEDS_WORK"
    assert [s["learningActivityId"] for s in nxt["selfPractice"]] == [setup["rem"].id]

    made = client.post("/api/learning/self-practice", json={"learningActivityId": setup["rem"].id}, headers=headers)
    assert made.status_code == 200, made.text
    target_id = made.json()["assignmentTargetId"]
    again = client.post("/api/learning/self-practice", json={"learningActivityId": setup["rem"].id}, headers=headers)
    assert again.json()["assignmentTargetId"] == target_id

    started = client.post("/api/learning/attempts", json={"assignmentTargetId": target_id}, headers=headers)
    assert started.status_code == 200 and started.json()["selfPractice"] is True
    listed = client.get("/api/learning/assignments", headers=headers).json()["assignments"]
    assert target_id not in {a["assignmentTargetId"] for a in listed} and len(listed) == 1
    after = client.get("/api/learning/my-progress", headers=headers).json()
    assert after["selfPractice"][0]["assignmentTargetId"] == target_id
    assert after["practiseNext"][0]["selfPractice"][0]["openTargetId"] == target_id

    # Recorded as the student's section's, so their teacher reads it.
    assignment = db_session.get(Assignment, db_session.get(AssignmentTarget, target_id).assignment_id)
    level = db_session.query(ClassLevel).filter_by(code="5").one()
    assert (assignment.reason, assignment.section, assignment.class_level_id) == ("SELF_PRACTICE", "A", level.id)
    assert assignment.board_course_id == db_session.get(Chapter, setup["chapter"].id).board_course_id

    # Refused: a core set, and a strong skill.
    core = client.post("/api/learning/self-practice", json={"learningActivityId": setup["p01"].id}, headers=headers)
    assert core.status_code == 404

    teacher_headers = {**_login(client, setup["teacher"].user.email), "x-auth-role": "TEACHER"}
    tracker = client.get("/api/learning/tracker/assignments", headers=teacher_headers).json()
    assert [row["id"] for row in tracker["items"]] == [target.assignment_id]
    overview = client.get("/api/learning/tracker/overview", headers=teacher_headers).json()
    assert overview["counts"]["assignments"] == 1
    history = client.get(f"/api/learning/tracker/students/{student.id}", headers=teacher_headers).json()
    assert {item["assignment"]["reason"] for item in history["items"]} == {"SCHEDULED", "SELF_PRACTICE"}
    assert history["student"]["stats"]["assigned"] == 1
    skills = client.get(f"/api/learning/tracker/students/{student.id}/skills", headers=teacher_headers)
    assert skills.status_code == 200 and _skill(skills.json(), s1.id)["band"] == "NEEDS_WORK"
    assert "selfPractice" not in skills.json()
    refused = client.post(
        "/api/learning/assignments",
        json={"learningActivityId": setup["rem"].id, "className": "5", "section": "A", "reason": "SELF_PRACTICE"},
        headers=teacher_headers,
    )
    assert refused.status_code == 422


def test_self_practice_refusals_and_limit(db_session, monkeypatch):
    import pytest

    from fastapi import HTTPException as ApiError

    setup = _setup(db_session, "MP3")
    student = setup["student"]
    # Not practised yet: not a weak skill.
    with pytest.raises(ApiError) as refused:
        progress_service.start_self_practice(db_session, student, setup["rem"].id)
    assert refused.value.detail["code"] == "NOT_A_WEAK_SKILL"
    target = _assign(db_session, setup, setup["p01"])
    _do(db_session, student, target.id, {q.id: "B" for q in setup["core1"]})
    # Another school's student, whose school has no such chapter mapped.
    other = _make_sectioned_student(db_session, _make_school(db_session, "MP3-other"), "MP3-o", class_name="5", section="A")
    with pytest.raises(ApiError) as unmapped:
        progress_service.start_self_practice(db_session, other, setup["rem"].id)
    assert unmapped.value.status_code == 404
    # The daily limit.
    monkeypatch.setattr(progress_service, "SELF_PRACTICE_DAILY_LIMIT", 1)
    first = progress_service.start_self_practice(db_session, student, setup["rem"].id)
    # Used up: the next start makes a new one, which the limit refuses.
    for _ in range(3):
        _do(db_session, student, first.id, {})
    with pytest.raises(ApiError) as limited:
        progress_service.start_self_practice(db_session, student, setup["rem"].id)
    assert limited.value.detail["code"] == "SELF_PRACTICE_LIMIT"


test_learning._CHAPTER_NUM.update({"MP4": 134, "MP5": 135})


def test_what_is_offered_is_what_is_allowed(client, db_session):
    """#184 review: a set the teacher has set is done from Daily Practice,
    not offered again; a skill whose chapter is no longer mapped keeps its
    score but offers nothing; a student with no section can't start one; a
    written answer in a self-practice reaches the teacher's Needs Review."""
    import pytest
    from fastapi import HTTPException

    setup = _setup(db_session, "MP4")
    student, (s1, _s2, _s3) = setup["student"], setup["skills"]
    target = _assign(db_session, setup, setup["p01"])
    _do(db_session, student, target.id, {q.id: "B" for q in setup["core1"]})

    # The teacher sets the Remediation set: not offered as self-practice.
    teacher_rem = _assign(db_session, setup, setup["rem"])
    [nxt] = progress_service.progress_payload(db_session, student, for_student=True)["practiseNext"]
    assert [a["assignmentTargetId"] for a in nxt["assigned"]] == [teacher_rem.id] and nxt["selfPractice"] == []
    with pytest.raises(HTTPException) as refused:
        progress_service.start_self_practice(db_session, student, setup["rem"].id)
    assert refused.value.status_code == 409
    learning_service.submit_attempt(db_session, student, learning_service.start_attempt(db_session, student, teacher_rem.id).id)

    # No section: refused, so no teacher is left unable to see it.
    student.section = None
    db_session.commit()
    with pytest.raises(HTTPException) as no_section:
        progress_service.start_self_practice(db_session, student, setup["rem"].id)
    assert no_section.value.detail["code"] == "SECTION_NOT_SET"
    student.section = "A"
    db_session.commit()

    # Unmapped: the score stays, nothing is offered.
    mapping = db_session.query(SchoolCurriculumMap).filter_by(school_id=setup["school"].id).one()
    mapping.class_name = "6"
    db_session.commit()
    payload = progress_service.progress_payload(db_session, student, for_student=True)
    assert _skill(payload, s1.id)["band"] == "NEEDS_WORK"
    assert payload["practiseNext"][0]["selfPractice"] == []
    mapping.class_name = "5"
    db_session.commit()


def test_a_written_answer_in_self_practice_reaches_needs_review(client, db_session):
    setup = _setup(db_session, "MP5")
    student, (s1, _s2, _s3) = setup["student"], setup["skills"]
    _add_question(
        db_session, s1, "MP5-R1-W", assignment_code=_ac("MP5", "REM-S01"), question_type="Constructed Response",
        correct_answer="Because.", auto_gradable=False,
    )
    db_session.commit()
    from app.models import LearningActivityQuestion

    written = db_session.query(Question).filter_by(code="MP5-R1-W").one()
    db_session.add(LearningActivityQuestion(learning_activity_id=setup["rem"].id, question_id=written.id, sequence=9))
    db_session.commit()
    target = _assign(db_session, setup, setup["p01"])
    _do(db_session, student, target.id, {q.id: "B" for q in setup["core1"]})
    own = progress_service.start_self_practice(db_session, student, setup["rem"].id)
    _do(db_session, student, own.id, {written.id: "My reason."})

    headers = {**_login(client, setup["teacher"].user.email), "x-auth-role": "TEACHER"}
    queue = client.get("/api/learning/tracker/review-queue", headers=headers).json()
    assert len(queue["items"]) == 2  # the core set's written answer, and the self-practice's
    stats = client.get(f"/api/learning/tracker/students/{student.id}", headers=headers).json()["student"]["stats"]
    assert (stats["assigned"], stats["needsReview"]) == (1, 2)
