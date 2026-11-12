"""The overview screens (#224, 12 Nov 2026): Question Bank (counts only),
Papers and Mocks, Reports, Settings and the teacher's My Classes.

Rules under test: only counts and settings leave the server (no question
wording, answer or explanation, no address or browser); a school's admin
sees only published chapters of the school's own board; the platform
screens are the Super Admin's alone; a child is "A student" in the activity
log; a teacher sees only their own sections.
"""
import json
from datetime import date, timedelta

from app.models import (
    AuditLog,
    Chapter,
    MockPaper,
    Question,
    QuestionPattern,
    SchoolCurriculumMap,
)
from app.api.routes_overviews import _today
from tests.test_learning import (
    _add_question,
    _assign_teacher_section,
    _login,
    _make_chapter_with_skills,
    _make_school,
    _make_school_admin,
    _make_sectioned_student,
    _make_super_admin,
    _make_teacher,
)

SECRET_WORDS = ("stem", "correct_answer", "correctAnswer", "explanation", "hint", "option_a", "optionA")


def _bank_world(db, sx="OV1"):
    chapter, (s1, s2) = _make_chapter_with_skills(db, sx, n_skills=2)
    q1 = _add_question(db, s1, f"{sx}-Q1", assignment_code="X")
    q2 = _add_question(db, s1, f"{sx}-Q2", assignment_code="X")
    q3 = _add_question(db, s2, f"{sx}-Q3", assignment_code="X")
    q1.difficulty, q2.difficulty, q3.difficulty = 1, 2, 2
    q2.status = "SME_REVIEW"
    q3.quality_status = "FLAGGED"
    q3.status = "DRAFT"
    db.commit()
    return chapter


def _entry(body, chapter):
    return next(c for c in body["chapters"] if c["id"] == chapter.id)


def test_question_bank_counts_only_for_super_admin(client, db_session):
    chapter = _bank_world(db_session, "OV1")
    sa = _make_super_admin(db_session, "ov1")
    headers = _login(client, sa.email)
    response = client.get("/api/overview/question-bank", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["scope"] == "platform"
    item = _entry(body, chapter)
    assert (item["skillCount"], item["questions"], item["approved"], item["inReview"], item["flagged"]) == (2, 3, 1, 1, 1)
    assert item["byDifficulty"] == {"1": 1, "2": 2}
    skills = {s["code"]: s for s in item["skills"]}
    assert skills["SOV1-01"]["questions"] == 2 and skills["SOV1-01"]["approved"] == 1
    assert skills["SOV1-02"]["flagged"] == 1
    text = json.dumps(body)
    for word in SECRET_WORDS:
        assert word not in text
    assert "OV1-Q1" not in text and "Question OV1-Q1?" not in text


def test_question_bank_for_a_school_admin_is_published_chapters_of_its_board(client, db_session):
    published = _bank_world(db_session, "OV2")
    hidden = _bank_world(db_session, "OV3")
    hidden.status = "DRAFT"
    db_session.commit()
    school = _make_school(db_session, "ov2")
    admin = _make_school_admin(db_session, school, "ov2")
    headers = _login(client, admin.email)
    body = client.get("/api/overview/question-bank", headers=headers).json()
    assert body["scope"] == "school"
    ids = {c["id"] for c in body["chapters"]}
    assert published.id in ids and hidden.id not in ids
    item = _entry(body, published)
    assert item["questions"] == 3 and "inReview" not in item and "flagged" not in item
    assert "inReview" not in body["totals"]

    school.board = "ICSE"
    db_session.commit()
    other = client.get("/api/overview/question-bank", headers=headers).json()
    assert published.id not in {c["id"] for c in other["chapters"]}


def test_question_bank_refuses_teachers_and_students(client, db_session):
    school = _make_school(db_session, "ov4")
    teacher = _make_teacher(db_session, school, "ov4")
    _login(client, teacher.user.email)
    assert client.get("/api/overview/question-bank").status_code == 403
    assert client.get("/api/overview/patterns").status_code == 403
    assert client.get("/api/overview/usage").status_code == 403


def test_patterns_counts(client, db_session):
    chapter = _bank_world(db_session, "OV5")
    skill = db_session.query(Question).filter(Question.code == "OV5-Q1").one().concept_lesson_id
    for i, (status, marks) in enumerate((("APPROVED", 1), ("APPROVED", 2), ("DRAFT", 2))):
        db_session.add(
            QuestionPattern(
                code=f"OV5-P{i}", board_course_id=chapter.board_course_id, chapter_id=chapter.id, concept_lesson_id=skill,
                question_type="Numeric Entry", marks=marks, spec_json="{}", spec_sha256="x" * 64, status=status,
            )
        )
    db_session.commit()
    sa = _make_super_admin(db_session, "ov5")
    headers = _login(client, sa.email)
    body = client.get("/api/overview/patterns", headers=headers).json()
    item = _entry(body, chapter)
    assert (item["patterns"], item["approved"], item["draft"]) == (3, 2, 1)
    assert item["byMarks"] == {"1": 1, "2": 2}
    assert "spec" not in json.dumps(body)


def test_usage_and_platform_settings(client, db_session):
    school = _make_school(db_session, "ov6")
    _make_teacher(db_session, school, "ov6")
    _make_sectioned_student(db_session, school, "ov6", class_name="5", section="A")
    sa = _make_super_admin(db_session, "ov6")
    headers = _login(client, sa.email)
    usage = client.get("/api/overview/usage", headers=headers).json()
    row = next(s for s in usage["schools"] if s["id"] == school.id)
    assert (row["students"], row["teachers"], row["assignmentsSet"], row["papersSet"]) == (1, 1, 0, 0)
    assert usage["totals"]["students"] >= 1

    settings = client.get("/api/overview/platform", headers=headers).json()
    assert settings["product"]["name"] == "Krama" and settings["product"]["company"] == "Zetta Metrics"
    rules = {r["role"]: r for r in settings["signIn"]["rules"]}
    assert rules["STUDENT"]["idle"] == "8 hours" and rules["STUDENT"]["max"] == "10 hours"
    assert rules["ADMIN"]["twoFactor"] == "Required" and rules["TEACHER"]["twoFactor"] == "Not used"
    assert settings["signIn"]["lockoutAttempts"] == 5 and settings["signIn"]["lockoutMinutes"] == 15
    assert "secret" not in json.dumps(settings).lower()


def test_activity_names_staff_not_children_and_leaves_out_addresses(client, db_session):
    school = _make_school(db_session, "ov7")
    teacher = _make_teacher(db_session, school, "ov7")
    student = _make_sectioned_student(db_session, school, "ov7", class_name="5", section="A")
    for user_id, event in ((teacher.user_id, "weekly_report.issued"), (student.user_id, "auth.login.success")):
        db_session.add(AuditLog(user_id=user_id, event_type=event, event_data_json='{"x": 1}', ip_address="203.0.113.9", user_agent="Browser"))
    db_session.commit()
    sa = _make_super_admin(db_session, "ov7")
    headers = _login(client, sa.email)
    body = client.get("/api/overview/activity", params={"pageSize": 100}, headers=headers).json()
    # The database is shared with other tests, so look for this test's own rows.
    assert any(i["event"] == "Weekly Reports Issued" and i["who"] == teacher.user.full_name for i in body["items"])
    mine = [i for i in body["items"] if i["role"] == "STUDENT"]
    assert mine and all(i["who"] == "A student" for i in mine)
    text = json.dumps(body)
    assert "203.0.113.9" not in text and "Browser" not in text and '"x"' not in text
    assert "Student ov7" not in text

    marks = client.get("/api/overview/activity", params={"category": "Marks and Reports"}, headers=headers).json()
    assert marks["items"] and all(i["group"] == "Marks and Reports" for i in marks["items"])
    assert client.get("/api/overview/activity", params={"category": "Nope"}, headers=headers).status_code == 422


def test_my_classes_lists_only_the_teachers_own_sections(client, db_session):
    chapter, _ = _make_chapter_with_skills(db_session, "OV8", n_skills=1)
    school = _make_school(db_session, "ov8")
    teacher = _make_teacher(db_session, school, "ov8")
    other = _make_teacher(db_session, school, "ov8b")
    _assign_teacher_section(db_session, teacher, chapter.board_course_id, "A")
    _assign_teacher_section(db_session, other, chapter.board_course_id, "B")
    for i in range(3):
        _make_sectioned_student(db_session, school, f"ov8-{i}", class_name="5", section="A")
    _make_sectioned_student(db_session, school, "ov8-gone", class_name="5", section="A", is_active=False)
    _make_sectioned_student(db_session, school, "ov8-b", class_name="5", section="B")
    today = _today()
    ch2 = Chapter(
        discipline_id=chapter.discipline_id, board_course_id=chapter.board_course_id,
        curriculum_version_id=chapter.curriculum_version_id, code="CH-OV8-2", chapter_no=2, title="Next Chapter", status="PUBLISHED",
    )
    db_session.add(ch2)
    db_session.flush()
    db_session.add_all(
        [
            SchoolCurriculumMap(
                school_id=school.id, board_course_id=chapter.board_course_id, chapter_id=chapter.id, class_name="5",
                planned_start_date=(today - timedelta(days=5)).isoformat(), planned_end_date=(today + timedelta(days=5)).isoformat(),
            ),
            SchoolCurriculumMap(
                school_id=school.id, board_course_id=chapter.board_course_id, chapter_id=ch2.id, class_name="5",
                planned_start_date=(today + timedelta(days=10)).isoformat(), planned_end_date=(today + timedelta(days=20)).isoformat(),
            ),
        ]
    )
    db_session.commit()
    _login(client, teacher.user.email)
    body = client.get("/api/overview/my-classes").json()
    assert [(c["classCode"], c["section"]) for c in body["classes"]] == [("5", "A")]
    entry = body["classes"][0]
    assert entry["students"] == 3 and entry["practiceSet"] == 0 and entry["papers"] == 0
    assert entry["runningChapter"]["title"] == "Chapter OV8"
    assert entry["nextChapter"]["title"] == "Next Chapter"
    assert "Student" not in json.dumps(body)


def test_my_classes_is_a_teachers_alone(client, db_session):
    school = _make_school(db_session, "ov9")
    admin = _make_school_admin(db_session, school, "ov9")
    _login(client, admin.email)
    assert client.get("/api/overview/my-classes").status_code == 403


def test_activity_labels_for_team_scripts_and_two_factor_events_are_words(client, db_session):
    for event in ("content.patterns.loaded", "auth.login.password_ok_awaiting_2fa", "auth.2fa.enabled"):
        db_session.add(AuditLog(event_type=event, event_data_json="{}"))
    db_session.commit()
    sa = _make_super_admin(db_session, "ov10")
    headers = _login(client, sa.email)
    body = client.get("/api/overview/activity", params={"pageSize": 100}, headers=headers).json()
    seen = {i["event"]: i["group"] for i in body["items"]}
    assert seen["Mock Paper Patterns Loaded"] == "Content"
    assert seen["Password Accepted, Second Step Pending"] == "Sign-In and Accounts"
    assert seen["Two-Factor Turned On"] == "Sign-In and Accounts"
    content = client.get("/api/overview/activity", params={"category": "Content", "pageSize": 100}, headers=headers).json()
    assert any(i["event"] == "Mock Paper Patterns Loaded" for i in content["items"])
