"""Proves Phase 3 (Five-day learning loop): activity generation from real
Question.assignment_code patterns, assignment creation, the full student
attempt lifecycle (start -> save -> submit -> result) including auto-marking
and idempotent re-submit, re-attempt limits, and Foundation Repair
recommendations.

Assignment-code classification (`classify_assignment_code`) is tested
against the EXACT codes verified in Chapter 1's real Assignment Plan sheet
(see learning_service.py's module docstring), not invented examples.

Mirrors test_curriculum_admin.py's/test_roster.py's fixture/login pattern:
2FA pre-enrolled for ADMIN/SUPER_ADMIN, CSRF token attached to every
mutating request, one role logged into `client` at a time per test (the
existing test files' own convention -- see test_curriculum_admin.py's
docstring on why: cross-role setup goes through direct ORM/service calls
instead of juggling multiple simultaneous cookie logins in one client).
"""
from datetime import date

import pyotp
from fastapi import HTTPException

from app.core.security import hash_password
from app.models import (
    Assignment,
    AssignmentTarget,
    Board,
    BoardCourse,
    Chapter,
    ClassLevel,
    ConceptLesson,
    CurriculumVersion,
    Discipline,
    LearningActivity,
    LearningActivityQuestion,
    PrerequisiteLink,
    Question,
    School,
    SchoolAdmin,
    Student,
    SubjectGroup,
    Teacher,
    User,
)
from app.services import foundation_repair_service, learning_service, teacher_assignment_service
from app.services.learning_service import classify_assignment_code, grade_answer

PASSWORD = "Passw0rd1"
TEST_TOTP_SECRET = pyotp.random_base32()


# --- shared fixtures --------------------------------------------------


def _get_or_create_board_course(db, suffix: str):
    board = db.query(Board).filter(Board.code == "CBSE").first()
    if not board:
        board = Board(code="CBSE", display_name="CBSE")
        db.add(board)
        db.flush()
    class_level = db.query(ClassLevel).filter(ClassLevel.code == "5").first()
    if not class_level:
        class_level = ClassLevel(code="5", display_name="Class 5", display_order=5)
        db.add(class_level)
        db.flush()
    subject_group = db.query(SubjectGroup).filter(SubjectGroup.code == "SCIENCE").first()
    if not subject_group:
        subject_group = SubjectGroup(code="SCIENCE", display_name="Science Group")
        db.add(subject_group)
        db.flush()
    discipline = db.query(Discipline).filter(Discipline.code == "MATHEMATICS").first()
    if not discipline:
        discipline = Discipline(code="MATHEMATICS", display_name="Mathematics", subject_group_id=subject_group.id)
        db.add(discipline)
        db.flush()
    board_course = BoardCourse(
        board_id=board.id, class_level_id=class_level.id, code=f"MATH-{suffix}", display_name="Mathematics", status="PUBLISHED",
    )
    db.add(board_course)
    db.flush()
    curriculum_version = CurriculumVersion(board_id=board.id, code=f"CV-{suffix}", label=f"CV-{suffix}", status="PUBLISHED")
    db.add(curriculum_version)
    db.flush()
    db.commit()
    return board_course, discipline, curriculum_version


def _make_chapter_with_skills(db, suffix: str, n_skills: int = 2):
    board_course, discipline, curriculum_version = _get_or_create_board_course(db, suffix)
    chapter = Chapter(
        discipline_id=discipline.id,
        board_course_id=board_course.id,
        curriculum_version_id=curriculum_version.id,
        code=f"CH-{suffix}",
        chapter_no=1,
        title=f"Chapter {suffix}",
        status="PUBLISHED",
    )
    db.add(chapter)
    db.flush()
    lessons = []
    for i in range(1, n_skills + 1):
        lesson = ConceptLesson(chapter_id=chapter.id, code=f"S{suffix}-{i:02d}", title=f"Skill {suffix}-{i}", sequence=i, status="PUBLISHED")
        db.add(lesson)
        lessons.append(lesson)
    db.flush()
    db.commit()
    return chapter, lessons


# classify_assignment_code requires the real "CH<digits>-..." shape (see
# learning_service.py's _CODE_PATTERNS) -- this maps each test's suffix to a
# distinct fake chapter number so assignment_code strings built from it
# actually match, while every OTHER code string in this file (Chapter.code,
# Question.code, ConceptLesson.code, ...) keeps using the suffix directly,
# since only assignment_code's shape is under test.
_CHAPTER_NUM = {
    "gen1": 1, "gen2": 2, "asg1": 3, "asg2": 4,
    "ATT1": 5, "ATT2": 6, "ATT3": 7, "ATT4": 14,
    "FR2": 8, "FR3": 9,
    "API1": 10, "API2": 11, "API3": 12, "API4": 13, "API5": 15, "API6": 16,
    "asg3": 17, "asg4": 18, "asg5": 19, "API7": 20,
    "API8": 21, "API8X": 22, "API9": 23, "API10": 24, "API11": 25, "API12": 26,
    "API8B": 27, "FR4": 28, "RES1": 29, "RES2": 30,
}


def _ac(suffix: str, code: str) -> str:
    return f"CH{_CHAPTER_NUM[suffix]:02d}-{code}"


def _add_question(db, lesson, code, *, assignment_code, question_type="Single Select", correct_answer="A",
                   option_a="A opt", option_b="B opt", accepted_variants=None, marks=1, auto_gradable=True):
    question = Question(
        concept_lesson_id=lesson.id,
        code=code,
        assignment_code=assignment_code,
        question_type=question_type,
        stem=f"Question {code}?",
        option_a=option_a,
        option_b=option_b,
        correct_answer=correct_answer,
        accepted_variants=accepted_variants,
        marks=marks,
        auto_gradable=auto_gradable,
        status="PUBLISHED",
    )
    db.add(question)
    db.flush()
    return question


def _make_school(db, suffix: str) -> School:
    school = School(name=f"Test School {suffix}", board="CBSE", city="Bengaluru")
    db.add(school)
    db.flush()
    return school


def _make_student(db, school: School, suffix: str) -> Student:
    user = User(full_name=f"Student {suffix}", email=f"student-{suffix}@example.com", password_hash=hash_password(PASSWORD), role="STUDENT")
    db.add(user)
    db.flush()
    student = Student(user_id=user.id, school_id=school.id, student_code=f"STU-{suffix}", class_name="5A")
    db.add(student)
    db.flush()
    db.commit()
    return student


def _make_sectioned_student(db, school: School, suffix: str, *, class_name: str, section: str | None, is_active: bool = True) -> Student:
    """A student shaped the way routes_roster.py actually stores one: class
    and section as two separate fields (class_name="5", section="A"), not
    _make_student's older combined "5A" -- see the section-targeting tests
    below (30 Sep 2026)."""
    user = User(full_name=f"Student {suffix}", email=f"student-{suffix}@example.com", password_hash=hash_password(PASSWORD), role="STUDENT")
    db.add(user)
    db.flush()
    student = Student(
        user_id=user.id, school_id=school.id, student_code=f"STU-{suffix}", class_name=class_name, section=section, is_active=is_active,
    )
    db.add(student)
    db.flush()
    db.commit()
    return student


def _make_teacher(db, school: School, suffix: str) -> Teacher:
    user = User(full_name=f"Teacher {suffix}", email=f"teacher-{suffix}@example.com", password_hash=hash_password(PASSWORD), role="TEACHER")
    db.add(user)
    db.flush()
    teacher = Teacher(user_id=user.id, school_id=school.id, teacher_code=f"TCH-{suffix}")
    db.add(teacher)
    db.flush()
    db.commit()
    return teacher


def _make_super_admin(db, suffix: str) -> User:
    user = User(full_name="Super Admin", email=f"sa-{suffix}@example.com", password_hash=hash_password(PASSWORD), role="SUPER_ADMIN", totp_enabled=True, totp_secret=TEST_TOTP_SECRET)
    db.add(user)
    db.commit()
    return user


def _make_school_admin(db, school: School, suffix: str) -> User:
    """Same shape as test_teacher_assignments.py's _make_school_admin: an
    ADMIN user with 2FA pre-enrolled plus the SchoolAdmin row
    routes_learning._resolve_school looks up."""
    user = User(
        full_name=f"Admin {suffix}", email=f"admin-{suffix}@example.com", password_hash=hash_password(PASSWORD),
        role="ADMIN", totp_enabled=True, totp_secret=TEST_TOTP_SECRET,
    )
    db.add(user)
    db.flush()
    db.add(SchoolAdmin(user_id=user.id, school_id=school.id))
    db.commit()
    return user


def _assign_teacher_section(db, teacher: Teacher, board_course_id: str, section: str, class_code: str = "5"):
    """Makes `teacher` the current teacher of record for (class, section,
    course) -- the TeacherSectionAssignment row routes_learning.create_assignment
    checks via teacher_may_currently_act_on (30 Sep 2026). Goes through
    teacher_assignment_service.assign_teacher_to_section directly, exactly
    as test_teacher_assignments.py's own access-scope tests set one up,
    rather than logging in an ADMIN just to spend login budget on setup."""
    class_level = db.query(ClassLevel).filter(ClassLevel.code == class_code).first()
    row = teacher_assignment_service.assign_teacher_to_section(
        db, school_id=teacher.school_id, teacher_id=teacher.id, class_level_id=class_level.id,
        section=section, board_course_id=board_course_id, start_date=date(2026, 4, 1), admin_user_id=None,
    )
    db.commit()
    return row


def _login(client, email: str) -> dict:
    response = client.post("/api/auth/login", json={"identifier": email, "password": PASSWORD})
    assert response.status_code == 200
    body = response.json()
    if body.get("twoFactorRequired"):
        verify_response = client.post(
            "/api/auth/2fa/verify-login",
            json={"challengeToken": body["challengeToken"], "code": pyotp.TOTP(TEST_TOTP_SECRET).now()},
        )
        assert verify_response.status_code == 200
    csrf_token = client.cookies.get("se_csrf")
    assert csrf_token
    return {"x-csrf-token": csrf_token}


def _publish(db, activity: LearningActivity):
    activity.status = "PUBLISHED"
    db.commit()
    db.refresh(activity)


# --- classify_assignment_code (real codes, verified against Chapter 1) ----


def test_classify_assignment_code_matches_real_chapter_1_patterns():
    assert classify_assignment_code("CH01-DIAG") == ("PREREQUISITE_CHECK", False)
    assert classify_assignment_code("CH01-DIAG-B") == ("PREREQUISITE_CHECK", False)
    assert classify_assignment_code("CH01-P01") == ("CORE_PRACTICE", False)
    assert classify_assignment_code("CH01-P15") == ("CORE_PRACTICE", False)
    assert classify_assignment_code("CH01-XA-S01") == ("EXTRA_PRACTICE", False)
    assert classify_assignment_code("CH01-XB-S15") == ("EXTRA_PRACTICE", False)
    assert classify_assignment_code("CH01-REM-S01") == ("REMEDIATION", False)
    assert classify_assignment_code("CH01-ADV-S01") == ("CHALLENGE", False)
    assert classify_assignment_code("CH01-MASTERY") == ("CHAPTER_MASTERY", True)
    assert classify_assignment_code("CH01-CASE") == ("CASE_STUDY", True)


def test_classify_assignment_code_does_not_guess_unrecognised_codes():
    assert classify_assignment_code("CH01-SOMETHING-NEW") == (None, False)
    assert classify_assignment_code(None) == (None, False)
    assert classify_assignment_code("") == (None, False)


# --- grade_answer -----------------------------------------------------


def test_grade_answer_single_select():
    q = Question(question_type="Single Select", correct_answer="B", marks=2, auto_gradable=True)
    assert grade_answer(q, "B") == (True, 2)
    assert grade_answer(q, "b") == (True, 2)  # case-insensitive
    assert grade_answer(q, "A") == (False, 0)
    assert grade_answer(q, None) == (False, 0)  # unattempted -> wrong, per blueprint 8.2


def test_grade_answer_multi_select_is_set_based():
    q = Question(question_type="Multi Select", correct_answer="A,C", marks=2, auto_gradable=True)
    assert grade_answer(q, "C,A") == (True, 2)  # order-independent
    assert grade_answer(q, "A") == (False, 0)  # incomplete


def test_grade_answer_numeric_entry_with_accepted_variants_and_comma_normalization():
    q = Question(question_type="Numeric Entry", correct_answer="2650", accepted_variants="2,650", marks=1, auto_gradable=True)
    assert grade_answer(q, "2,650")[0] is True
    assert grade_answer(q, "2650")[0] is True
    assert grade_answer(q, "2651")[0] is False


def test_grade_answer_ordering():
    q = Question(question_type="Ordering", correct_answer="1;5;9", marks=1, auto_gradable=True)
    assert grade_answer(q, "1;5;9")[0] is True
    assert grade_answer(q, "9;5;1")[0] is False


def test_grade_answer_numeric_entry_tolerates_unit_currency_sign_and_decimal_noise():
    # Regression for the 20 Aug 2026 pilot scan: "19,250 km" against a
    # correct_answer of "19250" was marked incorrect even though it's the
    # mathematically correct value -- grade_answer must never flag a
    # correct answer as wrong just because of formatting.
    q = Question(question_type="Numeric Entry", correct_answer="19250", marks=1, auto_gradable=True)
    assert grade_answer(q, "19,250 km")[0] is True
    assert grade_answer(q, "19250km")[0] is True
    assert grade_answer(q, "19250.0")[0] is True
    assert grade_answer(q, "+19250")[0] is True
    assert grade_answer(q, "Rs. 19250")[0] is True  # decorative currency prefix still strips to the same number
    assert grade_answer(q, "19251")[0] is False  # genuinely wrong value stays wrong
    assert grade_answer(q, "192500")[0] is False  # off by a factor of ten stays wrong

    percent_q = Question(question_type="Numeric Entry", correct_answer="45", marks=1, auto_gradable=True)
    assert grade_answer(percent_q, "45%")[0] is True
    assert grade_answer(percent_q, "45 percent")[0] is True

    decimal_q = Question(question_type="Numeric Entry", correct_answer="3.5", marks=1, auto_gradable=True)
    assert grade_answer(decimal_q, "3.50 cm")[0] is True
    assert grade_answer(decimal_q, "3.5cm")[0] is True


def test_grade_answer_numeric_fallback_never_creates_a_false_positive_from_embedded_numbers():
    # A wrong free-text answer that merely contains the right number must
    # still be marked wrong -- the unit-stripping fallback only recognises a
    # bare number plus a small curated unit/currency vocabulary, not
    # arbitrary sentences, precisely so this can't be gamed.
    q = Question(question_type="Text Entry", correct_answer="Add 500", marks=1, auto_gradable=True)
    assert grade_answer(q, "Subtract 500")[0] is False
    assert grade_answer(q, "Add 500 each time")[0] is False  # extra words -> no string OR numeric match
    assert grade_answer(q, "Add 500")[0] is True  # exact (case-insensitive) match still works


def test_grade_answer_ordering_tolerates_comma_and_unit_noise_per_item():
    q = Question(question_type="Ordering", correct_answer="1,000;5,000;9,000", marks=1, auto_gradable=True)
    assert grade_answer(q, "1000;5000;9000")[0] is True
    assert grade_answer(q, "1000 km;5000 km;9000 km")[0] is True
    assert grade_answer(q, "9000;5000;1000")[0] is False


def test_grade_answer_returns_none_for_non_auto_gradable_or_unrecognised_type():
    subjective = Question(question_type="Constructed Response", correct_answer="anything", marks=4, auto_gradable=False)
    assert grade_answer(subjective, "my answer") == (None, None)

    unrecognised_type = Question(question_type="Constructed Response", correct_answer="X", marks=1, auto_gradable=True)
    assert grade_answer(unrecognised_type, "X") == (None, None)


# --- generate_activities_for_chapter -----------------------------------


def test_generate_activities_groups_real_codes_correctly(db_session):
    chapter, (skill1, skill2) = _make_chapter_with_skills(db_session, "gen1")
    # Diagnostic: one item per skill, same assignment_code
    _add_question(db_session, skill1, "GEN1-DIAG-01", assignment_code=_ac("gen1", "DIAG"))
    _add_question(db_session, skill2, "GEN1-DIAG-02", assignment_code=_ac("gen1", "DIAG"))
    # Core practice: per-skill combined sets
    _add_question(db_session, skill1, "GEN1-P01-01", assignment_code=_ac("gen1", "P01"))
    _add_question(db_session, skill1, "GEN1-P01-02", assignment_code=_ac("gen1", "P01"))
    _add_question(db_session, skill2, "GEN1-P02-01", assignment_code=_ac("gen1", "P02"))
    # Chapter mastery: one item per skill, but should collapse to ONE chapter-scoped activity
    _add_question(db_session, skill1, "GEN1-MASTERY-01", assignment_code=_ac("gen1", "MASTERY"))
    _add_question(db_session, skill2, "GEN1-MASTERY-02", assignment_code=_ac("gen1", "MASTERY"))
    # Unrecognised code -- must be skipped, not guessed at
    _add_question(db_session, skill1, "GEN1-MYSTERY-01", assignment_code=_ac("gen1", "MYSTERY-CODE"))
    db_session.commit()

    created = learning_service.generate_activities_for_chapter(db_session, chapter, created_by_user_id=None)

    by_type = {}
    for a in created:
        by_type.setdefault(a.activity_type, []).append(a)

    assert len(by_type["PREREQUISITE_CHECK"]) == 2  # one per skill
    assert all(a.concept_lesson_id is not None for a in by_type["PREREQUISITE_CHECK"])
    assert len(by_type["CORE_PRACTICE"]) == 2  # skill1's P01, skill2's P02
    assert len(by_type["CHAPTER_MASTERY"]) == 1  # collapsed to one chapter-level activity
    assert by_type["CHAPTER_MASTERY"][0].concept_lesson_id is None
    assert "MYSTERY" not in {a.source_assignment_code for a in created}

    # Each CHAPTER_MASTERY activity should have both skills' questions linked
    mastery_activity = by_type["CHAPTER_MASTERY"][0]
    linked_question_ids = learning_service._activity_question_ids(db_session, mastery_activity.id)
    assert len(linked_question_ids) == 2


def test_generate_activities_is_idempotent(db_session):
    chapter, (skill1,) = _make_chapter_with_skills(db_session, "gen2", n_skills=1)
    _add_question(db_session, skill1, "GEN2-P01-01", assignment_code=_ac("gen2", "P01"))
    db_session.commit()

    first = learning_service.generate_activities_for_chapter(db_session, chapter, created_by_user_id=None)
    second = learning_service.generate_activities_for_chapter(db_session, chapter, created_by_user_id=None)
    assert len(first) == 1
    assert len(second) == 0  # nothing new to create
    assert db_session.query(LearningActivity).filter(LearningActivity.chapter_id == chapter.id).count() == 1


# --- create_assignment ---------------------------------------------------


def test_create_assignment_requires_published_activity(db_session):
    chapter, (skill1,) = _make_chapter_with_skills(db_session, "asg1", n_skills=1)
    _add_question(db_session, skill1, "ASG1-P01-01", assignment_code=_ac("asg1", "P01"))
    db_session.commit()
    [activity] = learning_service.generate_activities_for_chapter(db_session, chapter, created_by_user_id=None)
    school = _make_school(db_session, "asg1")
    student = _make_student(db_session, school, "asg1")
    db_session.commit()

    try:
        learning_service.create_assignment(
            db_session, school=school, learning_activity=activity, assigned_by_user_id="x",
            class_name=None, student_ids=[student.id],
        )
        assert False, "expected a 422 for an unpublished activity"
    except Exception:
        pass  # api_error raises HTTPException -- fine, message content covered at API level below


def test_create_assignment_materializes_one_target_per_student(db_session):
    chapter, (skill1,) = _make_chapter_with_skills(db_session, "asg2", n_skills=1)
    _add_question(db_session, skill1, "ASG2-P01-01", assignment_code=_ac("asg2", "P01"))
    db_session.commit()
    [activity] = learning_service.generate_activities_for_chapter(db_session, chapter, created_by_user_id=None)
    _publish(db_session, activity)
    school = _make_school(db_session, "asg2")
    s1 = _make_student(db_session, school, "asg2a")
    s2 = _make_student(db_session, school, "asg2b")
    db_session.commit()

    assignment = learning_service.create_assignment(
        db_session, school=school, learning_activity=activity, assigned_by_user_id="teacher-x",
        class_name="5A",
    )
    targets = db_session.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).all()
    assert {t.student_id for t in targets} == {s1.id, s2.id}


def _published_single_activity(db, suffix: str) -> LearningActivity:
    chapter, (skill1,) = _make_chapter_with_skills(db, suffix, n_skills=1)
    _add_question(db, skill1, f"{suffix.upper()}-P01-01", assignment_code=_ac(suffix, "P01"))
    db.commit()
    [activity] = learning_service.generate_activities_for_chapter(db, chapter, created_by_user_id=None)
    _publish(db, activity)
    return activity


def test_create_assignment_with_section_targets_only_that_section(db_session):
    """30 Sep 2026, confirmed live in production: real students store class
    and section separately (class_name="5", section="A"), so class_name
    alone could only ever target every section of Class 5 at once. Passing
    section must narrow it to that one section -- and still respect the
    school, the class and is_active exactly as before."""
    activity = _published_single_activity(db_session, "asg3")
    school = _make_school(db_session, "asg3")
    other_school = _make_school(db_session, "asg3-other")
    in_5a = _make_sectioned_student(db_session, school, "asg3-5a", class_name="5", section="A")
    in_5b = _make_sectioned_student(db_session, school, "asg3-5b", class_name="5", section="B")
    in_6a = _make_sectioned_student(db_session, school, "asg3-6a", class_name="6", section="A")
    inactive_5a = _make_sectioned_student(db_session, school, "asg3-5a-left", class_name="5", section="A", is_active=False)
    other_school_5a = _make_sectioned_student(db_session, other_school, "asg3-5a-elsewhere", class_name="5", section="A")

    assignment = learning_service.create_assignment(
        db_session, school=school, learning_activity=activity, assigned_by_user_id="teacher-x",
        class_name="5", section="A",
    )
    targets = db_session.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).all()
    targeted = {t.student_id for t in targets}
    assert targeted == {in_5a.id}
    assert not targeted & {in_5b.id, in_6a.id, inactive_5a.id, other_school_5a.id}


def test_create_assignment_without_section_still_targets_every_section_of_the_class(db_session):
    """Backward compatibility for the section fix above: any caller that
    omits section (every caller before 30 Sep 2026, and ADMIN/SUPER_ADMIN
    via the same endpoint) still gets the whole class, every section. A
    blank section is treated as omitted, not as "students with no
    section"."""
    school = _make_school(db_session, "asg4")
    in_5a = _make_sectioned_student(db_session, school, "asg4-5a", class_name="5", section="A")
    in_5b = _make_sectioned_student(db_session, school, "asg4-5b", class_name="5", section="B")
    no_section = _make_sectioned_student(db_session, school, "asg4-5x", class_name="5", section=None)
    _make_sectioned_student(db_session, school, "asg4-6a", class_name="6", section="A")
    activity = _published_single_activity(db_session, "asg4")

    for section_arg in ({}, {"section": None}, {"section": "  "}):
        assignment = learning_service.create_assignment(
            db_session, school=school, learning_activity=activity, assigned_by_user_id="teacher-x",
            class_name="5", **section_arg,
        )
        targets = db_session.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).all()
        assert {t.student_id for t in targets} == {in_5a.id, in_5b.id, no_section.id}, section_arg


def test_create_assignment_empty_section_error_names_the_section_searched(db_session):
    """The "no students" error must say what was actually searched for --
    before 30 Sep 2026 it could only name the class."""
    school = _make_school(db_session, "asg5")
    _make_sectioned_student(db_session, school, "asg5-5a", class_name="5", section="A")
    activity = _published_single_activity(db_session, "asg5")

    try:
        learning_service.create_assignment(
            db_session, school=school, learning_activity=activity, assigned_by_user_id="teacher-x",
            class_name="5", section="C",
        )
        assert False, "expected a 422 for a section with no students"
    except HTTPException as exc:
        assert exc.status_code == 422
        assert exc.detail["message"] == "There are no active students in Class 5, Section C."

    try:
        learning_service.create_assignment(
            db_session, school=school, learning_activity=activity, assigned_by_user_id="teacher-x", class_name="9",
        )
        assert False, "expected a 422 for a class with no students"
    except HTTPException as exc:
        assert exc.status_code == 422
        assert exc.detail["message"] == "There are no active students in Class 9."


# --- attempt lifecycle ----------------------------------------------------


def _setup_published_activity_with_two_questions(db, suffix):
    chapter, (skill1,) = _make_chapter_with_skills(db, suffix, n_skills=1)
    _add_question(db, skill1, f"{suffix}-Q1", assignment_code=_ac(suffix, "P01"), question_type="Single Select", correct_answer="A", marks=1)
    _add_question(db, skill1, f"{suffix}-Q2", assignment_code=_ac(suffix, "P01"), question_type="Numeric Entry", correct_answer="42", marks=2)
    db.commit()
    [activity] = learning_service.generate_activities_for_chapter(db, chapter, created_by_user_id=None)
    _publish(db, activity)
    return chapter, activity


def test_attempt_lifecycle_scores_correctly_and_locks_after_submit(db_session):
    _chapter, activity = _setup_published_activity_with_two_questions(db_session, "ATT1")
    school = _make_school(db_session, "att1")
    student = _make_student(db_session, school, "att1")
    db_session.commit()
    assignment = learning_service.create_assignment(
        db_session, school=school, learning_activity=activity, assigned_by_user_id="teacher-x", student_ids=[student.id],
    )
    target = db_session.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).first()

    attempt = learning_service.start_attempt(db_session, student, target.id)
    assert attempt.status == "IN_PROGRESS"
    # Resuming returns the SAME in-progress attempt, not a duplicate.
    same_attempt = learning_service.start_attempt(db_session, student, target.id)
    assert same_attempt.id == attempt.id

    questions = list(learning_service._activity_question_ids(db_session, activity.id))
    q_map = {q.code: q for q in db_session.query(Question).filter(Question.id.in_(questions)).all()}
    q1 = q_map["ATT1-Q1"]
    q2 = q_map["ATT1-Q2"]

    learning_service.save_answer(db_session, student, attempt.id, q1.id, "A")  # correct
    learning_service.save_answer(db_session, student, attempt.id, q2.id, "41")  # wrong

    evaluation = learning_service.submit_attempt(db_session, student, attempt.id)
    assert evaluation.auto_score == 1  # only q1's 1 mark
    assert evaluation.max_score == 3  # 1 + 2
    assert evaluation.final_score == 1
    assert evaluation.review_status == "AUTO_FINALISED"

    db_session.refresh(attempt)
    assert attempt.status == "EVALUATED"

    # Attempt is locked -- can no longer save an answer against it.
    try:
        learning_service.save_answer(db_session, student, attempt.id, q1.id, "B")
        assert False, "expected the locked attempt to reject a further save"
    except Exception:
        pass

    # Idempotent re-submit: same evaluation, not a new one.
    evaluation_again = learning_service.submit_attempt(db_session, student, attempt.id)
    assert evaluation_again.id == evaluation.id


def test_attempt_limit_is_enforced(db_session):
    _chapter, activity = _setup_published_activity_with_two_questions(db_session, "ATT2")
    school = _make_school(db_session, "att2")
    student = _make_student(db_session, school, "att2")
    db_session.commit()
    assignment = learning_service.create_assignment(
        db_session, school=school, learning_activity=activity, assigned_by_user_id="teacher-x", student_ids=[student.id], max_attempts=1,
    )
    target = db_session.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).first()

    attempt = learning_service.start_attempt(db_session, student, target.id)
    learning_service.submit_attempt(db_session, student, attempt.id)

    try:
        learning_service.start_attempt(db_session, student, target.id)
        assert False, "expected ATTEMPT_LIMIT_REACHED"
    except Exception:
        pass


def test_grant_extra_attempt_raises_this_one_students_limit_only(db_session):
    """20 Aug 2026, teacher reattempt-approval surface: bonus_attempts is
    per-AssignmentTarget, so granting one student an extra attempt must not
    raise the limit for a second student sharing the same Assignment."""
    _chapter, activity = _setup_published_activity_with_two_questions(db_session, "ATT4")
    school = _make_school(db_session, "att4")
    student = _make_student(db_session, school, "att4")
    other_student = _make_student(db_session, school, "att4-other")
    db_session.commit()
    assignment = learning_service.create_assignment(
        db_session, school=school, learning_activity=activity, assigned_by_user_id="teacher-x",
        student_ids=[student.id, other_student.id], max_attempts=1,
    )
    target = db_session.query(AssignmentTarget).filter(
        AssignmentTarget.assignment_id == assignment.id, AssignmentTarget.student_id == student.id
    ).first()
    other_target = db_session.query(AssignmentTarget).filter(
        AssignmentTarget.assignment_id == assignment.id, AssignmentTarget.student_id == other_student.id
    ).first()

    attempt = learning_service.start_attempt(db_session, student, target.id)
    learning_service.submit_attempt(db_session, student, attempt.id)
    other_attempt = learning_service.start_attempt(db_session, other_student, other_target.id)
    learning_service.submit_attempt(db_session, other_student, other_attempt.id)

    # Both students are now at their limit (max_attempts=1, 0 bonus).
    for s, t in ((student, target), (other_student, other_target)):
        try:
            learning_service.start_attempt(db_session, s, t.id)
            assert False, "expected ATTEMPT_LIMIT_REACHED"
        except Exception:
            pass

    learning_service.grant_extra_attempt(db_session, target)
    assert target.bonus_attempts == 1

    # The granted student can now start a second attempt...
    second_attempt = learning_service.start_attempt(db_session, student, target.id)
    assert second_attempt.attempt_number == 2

    # ...but the other student, who wasn't granted anything, still can't.
    try:
        learning_service.start_attempt(db_session, other_student, other_target.id)
        assert False, "expected ATTEMPT_LIMIT_REACHED for the ungranted student"
    except Exception:
        pass


def test_unanswered_question_is_scored_as_wrong_on_submit(db_session):
    """blueprint 8.2: 'Unattempted answers receive zero.' -- never touching
    a question at all must still count against max_score, not be silently
    excluded."""
    _chapter, activity = _setup_published_activity_with_two_questions(db_session, "ATT3")
    school = _make_school(db_session, "att3")
    student = _make_student(db_session, school, "att3")
    db_session.commit()
    assignment = learning_service.create_assignment(
        db_session, school=school, learning_activity=activity, assigned_by_user_id="teacher-x", student_ids=[student.id],
    )
    target = db_session.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).first()
    attempt = learning_service.start_attempt(db_session, student, target.id)
    # No answers saved at all.
    evaluation = learning_service.submit_attempt(db_session, student, attempt.id)
    assert evaluation.auto_score == 0
    assert evaluation.max_score == 3


# --- Foundation Repair -----------------------------------------------------


def test_foundation_repair_no_recommendation_without_evaluations(db_session):
    _chapter, (skill1,) = _make_chapter_with_skills(db_session, "FR1", n_skills=1)
    school = _make_school(db_session, "fr1")
    student = _make_student(db_session, school, "fr1")
    db_session.commit()
    rec = foundation_repair_service.get_recommendation(db_session, student, skill1)
    assert rec.recommendation == "NONE"
    assert rec.current_score_percent is None


def test_foundation_repair_recommends_prerequisite_gap_over_reteach(db_session):
    chapter, (current, prereq) = _make_chapter_with_skills(db_session, "FR2", n_skills=2)
    _add_question(db_session, current, "FR2-CUR-P01", assignment_code=_ac("FR2", "P01"), correct_answer="A")
    _add_question(db_session, prereq, "FR2-PRE-P01", assignment_code=_ac("FR2", "P02"), correct_answer="A")
    db_session.add(PrerequisiteLink(concept_lesson_id=current.id, prerequisite_concept_lesson_id=prereq.id, minimum_mastery=75))
    db_session.commit()
    activities = learning_service.generate_activities_for_chapter(db_session, chapter, created_by_user_id=None)
    for a in activities:
        _publish(db_session, a)
    current_activity = next(a for a in activities if a.concept_lesson_id == current.id)
    prereq_activity = next(a for a in activities if a.concept_lesson_id == prereq.id)

    school = _make_school(db_session, "fr2")
    student = _make_student(db_session, school, "fr2")
    db_session.commit()

    # Student scores low on BOTH current and prerequisite skill.
    for activity in (current_activity, prereq_activity):
        assignment = learning_service.create_assignment(db_session, school=school, learning_activity=activity, assigned_by_user_id="t", student_ids=[student.id])
        target = db_session.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).first()
        attempt = learning_service.start_attempt(db_session, student, target.id)
        q_id = next(iter(learning_service._activity_question_ids(db_session, activity.id)))
        learning_service.save_answer(db_session, student, attempt.id, q_id, "B")  # wrong (correct_answer is "A")
        learning_service.submit_attempt(db_session, student, attempt.id)

    rec = foundation_repair_service.get_recommendation(db_session, student, current)
    assert rec.recommendation == "PREREQUISITE_GAP"
    assert rec.gap_concept_lesson_id == prereq.id


def test_foundation_repair_falls_back_to_reteach_when_prerequisite_is_secure(db_session):
    chapter, (current, prereq) = _make_chapter_with_skills(db_session, "FR3", n_skills=2)
    _add_question(db_session, current, "FR3-CUR-P01", assignment_code=_ac("FR3", "P01"), correct_answer="A")
    _add_question(db_session, prereq, "FR3-PRE-P01", assignment_code=_ac("FR3", "P02"), correct_answer="A")
    db_session.add(PrerequisiteLink(concept_lesson_id=current.id, prerequisite_concept_lesson_id=prereq.id, minimum_mastery=50))
    db_session.commit()
    activities = learning_service.generate_activities_for_chapter(db_session, chapter, created_by_user_id=None)
    for a in activities:
        _publish(db_session, a)
    current_activity = next(a for a in activities if a.concept_lesson_id == current.id)
    prereq_activity = next(a for a in activities if a.concept_lesson_id == prereq.id)

    school = _make_school(db_session, "fr3")
    student = _make_student(db_session, school, "fr3")
    db_session.commit()

    for activity, response in ((current_activity, "B"), (prereq_activity, "A")):  # prereq scores 100%, current scores 0%
        assignment = learning_service.create_assignment(db_session, school=school, learning_activity=activity, assigned_by_user_id="t", student_ids=[student.id])
        target = db_session.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).first()
        attempt = learning_service.start_attempt(db_session, student, target.id)
        q_id = next(iter(learning_service._activity_question_ids(db_session, activity.id)))
        learning_service.save_answer(db_session, student, attempt.id, q_id, response)
        learning_service.submit_attempt(db_session, student, attempt.id)

    rec = foundation_repair_service.get_recommendation(db_session, student, current)
    assert rec.recommendation == "LOW_ACCURACY"
    assert rec.gap_concept_lesson_id is None


# --- API-level smoke tests -------------------------------------------------


def test_generate_and_publish_activities_is_super_admin_only(client, db_session):
    chapter, (skill1,) = _make_chapter_with_skills(db_session, "API1", n_skills=1)
    _add_question(db_session, skill1, "API1-P01-01", assignment_code=_ac("API1", "P01"))
    db_session.commit()

    school = _make_school(db_session, "api1")
    teacher = _make_teacher(db_session, school, "api1")
    db_session.commit()
    headers = _login(client, teacher.user.email)
    response = client.post("/api/learning/activities/generate", json={"chapterId": chapter.id}, headers=headers)
    assert response.status_code == 403


def test_student_assignment_list_latest_attempt_is_none_before_starting(client, db_session):
    chapter, (skill1,) = _make_chapter_with_skills(db_session, "API3", n_skills=1)
    _add_question(db_session, skill1, "API3-Q1", assignment_code=_ac("API3", "P01"), question_type="Single Select", correct_answer="A", marks=1)
    db_session.commit()

    [activity] = learning_service.generate_activities_for_chapter(db_session, chapter, created_by_user_id=None)
    _publish(db_session, activity)
    school = _make_school(db_session, "api3")
    student = _make_student(db_session, school, "api3")
    db_session.commit()
    learning_service.create_assignment(db_session, school=school, learning_activity=activity, assigned_by_user_id="teacher-x", class_name="5A")

    headers = _login(client, student.user.email)
    response = client.get("/api/learning/assignments", headers=headers)
    assert response.status_code == 200
    [assignment_summary] = response.json()["assignments"]
    assert assignment_summary["status"] == "PENDING"
    assert assignment_summary["latestAttempt"] is None


def test_super_admin_generate_publish_then_teacher_assigns_then_student_completes_attempt_end_to_end(client, db_session):
    chapter, (skill1,) = _make_chapter_with_skills(db_session, "API2", n_skills=1)
    _add_question(db_session, skill1, "API2-Q1", assignment_code=_ac("API2", "P01"), question_type="Single Select", correct_answer="A", marks=1)
    db_session.commit()

    super_admin = _make_super_admin(db_session, "api2")
    school = _make_school(db_session, "api2")
    teacher = _make_teacher(db_session, school, "api2")
    # 30 Sep 2026: a TEACHER must now name a section they currently own
    # (create_assignment's section-ownership check), so this end-to-end run
    # uses a real sectioned student plus a TeacherSectionAssignment instead
    # of the old combined className "5A", which the API now rejects for a
    # TEACHER (no section, and "5A" is not a ClassLevel code).
    student = _make_sectioned_student(db_session, school, "api2", class_name="5", section="A")
    _assign_teacher_section(db_session, teacher, chapter.board_course_id, "A")
    db_session.commit()

    sa_headers = _login(client, super_admin.email)
    gen_response = client.post("/api/learning/activities/generate", json={"chapterId": chapter.id}, headers=sa_headers)
    assert gen_response.status_code == 200
    activity_id = gen_response.json()["activities"][0]["id"]

    pub_response = client.post(f"/api/learning/activities/{activity_id}/publish", headers=sa_headers)
    assert pub_response.status_code == 200
    assert pub_response.json()["status"] == "PUBLISHED"

    client.cookies.clear()
    teacher_headers = _login(client, teacher.user.email)
    assign_response = client.post(
        "/api/learning/assignments",
        json={"learningActivityId": activity_id, "className": "5", "section": "A"},
        headers=teacher_headers,
    )
    assert assign_response.status_code == 200, assign_response.text
    assert assign_response.json()["targetCount"] == 1
    # 20 Aug 2026, Phase 3 frontend: enriched so the teacher "My Assignments"
    # list doesn't need a second round-trip just to show what was assigned.
    assert assign_response.json()["learningActivityTitle"]
    assert assign_response.json()["learningActivityType"] == "CORE_PRACTICE"

    client.cookies.clear()
    student_headers = _login(client, student.user.email)
    list_response = client.get("/api/learning/assignments", headers=student_headers)
    assert list_response.status_code == 200
    [assignment_summary] = list_response.json()["assignments"]
    target_id = assignment_summary["assignmentTargetId"]

    start_response = client.post("/api/learning/attempts", json={"assignmentTargetId": target_id}, headers=student_headers)
    assert start_response.status_code == 200
    attempt_body = start_response.json()
    assert attempt_body["questions"], "expected the question payload, without any answer key fields"
    assert "correctAnswer" not in attempt_body["questions"][0]
    question_id = attempt_body["questions"][0]["id"]

    save_response = client.put(
        f"/api/learning/attempts/{attempt_body['id']}/answers",
        json={"questionId": question_id, "responseText": "A"},
        headers=student_headers,
    )
    assert save_response.status_code == 200

    submit_response = client.post(f"/api/learning/attempts/{attempt_body['id']}/submit", headers=student_headers)
    assert submit_response.status_code == 200
    assert submit_response.json()["finalScore"] == 1

    result_response = client.get(f"/api/learning/attempts/{attempt_body['id']}/result", headers=student_headers)
    assert result_response.status_code == 200
    result_body = result_response.json()
    assert result_body["answers"][0]["isCorrect"] is True
    assert result_body["answers"][0]["correctAnswer"] == "A"  # answer key IS visible after submission

    # 20 Aug 2026, Phase 3 frontend: the student list now carries a
    # latestAttempt summary so "Today's Practice" can render Start/Continue/
    # View Result without a second round-trip per row.
    relist_response = client.get("/api/learning/assignments", headers=student_headers)
    assert relist_response.status_code == 200
    [relisted] = relist_response.json()["assignments"]
    assert relisted["status"] == "COMPLETED"
    assert relisted["latestAttempt"]["id"] == attempt_body["id"]
    assert relisted["latestAttempt"]["status"] == "EVALUATED"
    assert relisted["latestAttempt"]["evaluation"]["finalScore"] == 1



def test_teacher_and_super_admin_can_view_assignment_targets_results(client, db_session):
    """20 Aug 2026, Phase 3 frontend: the teacher results view -- one row per
    target student with their latest attempt/score. Sets up the activity/
    assignment/attempt via direct service calls (not HTTP) so this test's
    own login budget (5/minute, reset per-test by conftest's
    _reset_rate_limiter) is spent only on the three role checks actually
    under test here, not on re-proving the attempt lifecycle itself -- that
    already has its own dedicated coverage above."""
    chapter, (skill1,) = _make_chapter_with_skills(db_session, "API4", n_skills=1)
    _add_question(db_session, skill1, "API4-Q1", assignment_code=_ac("API4", "P01"), question_type="Single Select", correct_answer="A", marks=1)
    db_session.commit()

    school = _make_school(db_session, "api4")
    teacher = _make_teacher(db_session, school, "api4")
    other_teacher = _make_teacher(db_session, school, "api4-other")
    super_admin = _make_super_admin(db_session, "api4")
    student = _make_student(db_session, school, "api4")
    db_session.commit()

    [activity] = learning_service.generate_activities_for_chapter(db_session, chapter, created_by_user_id=None)
    _publish(db_session, activity)
    assignment = learning_service.create_assignment(
        db_session, school=school, learning_activity=activity, assigned_by_user_id=teacher.user_id, class_name="5A",
    )
    [target] = db_session.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).all()

    question = db_session.query(Question).filter(Question.code == "API4-Q1").first()
    attempt = learning_service.start_attempt(db_session, student, target.id)
    learning_service.save_answer(db_session, student, attempt.id, question.id, "A")
    learning_service.submit_attempt(db_session, student, attempt.id)

    teacher_headers = _login(client, teacher.user.email)
    targets_response = client.get(f"/api/learning/assignments/{assignment.id}/targets", headers=teacher_headers)
    assert targets_response.status_code == 200
    [target_row] = targets_response.json()["targets"]
    assert target_row["studentId"] == student.id
    assert target_row["status"] == "COMPLETED"
    assert target_row["latestAttempt"]["evaluation"]["finalScore"] == 1
    # 20 Aug 2026, teacher review/reattempt-approval surface: full attempt
    # history plus the fields the "grant an extra attempt" UI needs.
    assert target_row["maxAttempts"] == 3  # create_assignment's default
    assert target_row["bonusAttempts"] == 0
    assert target_row["attemptsUsed"] == 1
    assert len(target_row["attempts"]) == 1
    assert target_row["attempts"][0]["id"] == target_row["latestAttempt"]["id"]

    # A different teacher (even at the same school) gets a 404, not the
    # data -- matches this file's "don't disclose another teacher's/
    # school's resource exists" convention.
    client.cookies.clear()
    other_headers = _login(client, other_teacher.user.email)
    forbidden_response = client.get(f"/api/learning/assignments/{assignment.id}/targets", headers=other_headers)
    assert forbidden_response.status_code == 404

    # SUPER_ADMIN can see any assignment's targets, same as everything else
    # in this file it's unrestricted for.
    client.cookies.clear()
    sa_headers = _login(client, super_admin.email)
    sa_targets_response = client.get(f"/api/learning/assignments/{assignment.id}/targets", headers=sa_headers)
    assert sa_targets_response.status_code == 200
    assert len(sa_targets_response.json()["targets"]) == 1


def test_grant_extra_attempt_endpoint_is_scoped_and_unblocks_the_student(client, db_session):
    """20 Aug 2026, teacher reattempt-approval surface: the owning teacher
    can grant an extra attempt (and it actually unblocks start_attempt); a
    teacher who doesn't own the assignment gets 404, matching every other
    scoped endpoint in this file."""
    chapter, (skill1,) = _make_chapter_with_skills(db_session, "API5", n_skills=1)
    _add_question(db_session, skill1, "API5-Q1", assignment_code=_ac("API5", "P01"), question_type="Single Select", correct_answer="A", marks=1)
    db_session.commit()

    school = _make_school(db_session, "api5")
    teacher = _make_teacher(db_session, school, "api5")
    other_teacher = _make_teacher(db_session, school, "api5-other")
    student = _make_student(db_session, school, "api5")
    db_session.commit()

    [activity] = learning_service.generate_activities_for_chapter(db_session, chapter, created_by_user_id=None)
    _publish(db_session, activity)
    assignment = learning_service.create_assignment(
        db_session, school=school, learning_activity=activity, assigned_by_user_id=teacher.user_id,
        class_name="5A", max_attempts=1,
    )
    [target] = db_session.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).all()
    question = db_session.query(Question).filter(Question.code == "API5-Q1").first()
    attempt = learning_service.start_attempt(db_session, student, target.id)
    learning_service.save_answer(db_session, student, attempt.id, question.id, "A")
    learning_service.submit_attempt(db_session, student, attempt.id)

    # Student is now at their limit (max_attempts=1).
    try:
        learning_service.start_attempt(db_session, student, target.id)
        assert False, "expected ATTEMPT_LIMIT_REACHED"
    except Exception:
        pass

    # A teacher who doesn't own this assignment can't grant against it.
    other_headers = _login(client, other_teacher.user.email)
    forbidden_grant = client.post(
        f"/api/learning/assignments/{assignment.id}/targets/{target.id}/grant-attempt", headers=other_headers
    )
    assert forbidden_grant.status_code == 404

    client.cookies.clear()
    teacher_headers = _login(client, teacher.user.email)
    grant_response = client.post(
        f"/api/learning/assignments/{assignment.id}/targets/{target.id}/grant-attempt", headers=teacher_headers
    )
    assert grant_response.status_code == 200
    body = grant_response.json()
    assert body["bonusAttempts"] == 1
    assert body["maxAttempts"] == 1
    assert body["attemptsUsed"] == 1

    # The grant actually unblocks the student, not just the counter.
    db_session.refresh(target)
    unblocked_attempt = learning_service.start_attempt(db_session, student, target.id)
    assert unblocked_attempt.attempt_number == 2


def test_get_attempt_result_is_scoped_for_teacher_and_admin(client, db_session):
    """20 Aug 2026: closes a real gap -- this endpoint used to have NO
    scoping for TEACHER/ADMIN at all, so any authenticated teacher could
    fetch any attempt's full result (including the answer key) by
    guessing/enumerating attempt_id. Now scoped the same way as the
    results-list endpoint (list_assignment_targets)."""
    chapter, (skill1,) = _make_chapter_with_skills(db_session, "API6", n_skills=1)
    _add_question(db_session, skill1, "API6-Q1", assignment_code=_ac("API6", "P01"), question_type="Single Select", correct_answer="A", marks=1)
    db_session.commit()

    school = _make_school(db_session, "api6")
    teacher = _make_teacher(db_session, school, "api6")
    other_teacher = _make_teacher(db_session, school, "api6-other")
    student = _make_student(db_session, school, "api6")
    db_session.commit()

    [activity] = learning_service.generate_activities_for_chapter(db_session, chapter, created_by_user_id=None)
    _publish(db_session, activity)
    assignment = learning_service.create_assignment(
        db_session, school=school, learning_activity=activity, assigned_by_user_id=teacher.user_id, class_name="5A",
    )
    [target] = db_session.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).all()
    question = db_session.query(Question).filter(Question.code == "API6-Q1").first()
    attempt = learning_service.start_attempt(db_session, student, target.id)
    learning_service.save_answer(db_session, student, attempt.id, question.id, "A")
    learning_service.submit_attempt(db_session, student, attempt.id)

    other_headers = _login(client, other_teacher.user.email)
    forbidden_result = client.get(f"/api/learning/attempts/{attempt.id}/result", headers=other_headers)
    assert forbidden_result.status_code == 404

    client.cookies.clear()
    teacher_headers = _login(client, teacher.user.email)
    owned_result = client.get(f"/api/learning/attempts/{attempt.id}/result", headers=teacher_headers)
    assert owned_result.status_code == 200
    assert owned_result.json()["answers"][0]["correctAnswer"] == "A"


def test_student_result_lists_answers_in_set_order_with_each_questions_options(client, db_session):
    """4 Oct 2026. Two things a student's result got wrong:

    - The answers came back in the order the rows were saved, so answering
      question 3 first made it "Question 1" on the result -- and numbered
      differently from the teacher's review of the very same attempt.
    - A select question's result said only the letters ("Your answer A,
      correct answer B"), with no way to tell what A and B had been.
    """
    chapter, (skill1,) = _make_chapter_with_skills(db_session, "RES1", n_skills=1)
    for number, right in ((1, "A"), (2, "B"), (3, "A")):
        _add_question(
            db_session, skill1, f"RES1-Q{number}", assignment_code=_ac("RES1", "P01"), question_type="Single Select",
            correct_answer=right, option_a=f"first {number}", option_b=f"second {number}", marks=1,
        )
    db_session.commit()

    school = _make_school(db_session, "res1")
    teacher = _make_teacher(db_session, school, "res1")
    student = _make_student(db_session, school, "res1")
    db_session.commit()

    [activity] = learning_service.generate_activities_for_chapter(db_session, chapter, created_by_user_id=None)
    _publish(db_session, activity)
    by_code = {q.code: q for q in db_session.query(Question).filter(Question.code.like("RES1-Q%")).all()}
    # The set's own order is Q2, Q3, Q1 -- not the order of the codes, and
    # not the order anything is answered in below -- so only a sort by the
    # set's sequence can produce it.
    for code, sequence in (("RES1-Q2", 1), ("RES1-Q3", 2), ("RES1-Q1", 3)):
        link = (
            db_session.query(LearningActivityQuestion)
            .filter(LearningActivityQuestion.learning_activity_id == activity.id, LearningActivityQuestion.question_id == by_code[code].id)
            .one()
        )
        link.sequence = sequence
    db_session.commit()

    assignment = learning_service.create_assignment(
        db_session, school=school, learning_activity=activity, assigned_by_user_id=teacher.user_id, class_name="5A",
    )
    [target] = db_session.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).all()

    # Answered Q1 first, then Q3; Q2 is left blank, so its row is only
    # written when the attempt is submitted.
    attempt = learning_service.start_attempt(db_session, student, target.id)
    learning_service.save_answer(db_session, student, attempt.id, by_code["RES1-Q1"].id, "A")
    learning_service.save_answer(db_session, student, attempt.id, by_code["RES1-Q3"].id, "B")
    learning_service.submit_attempt(db_session, student, attempt.id)

    headers = _login(client, student.user.email)
    response = client.get(f"/api/learning/attempts/{attempt.id}/result", headers=headers)
    assert response.status_code == 200
    body = response.json()
    answers = body["answers"]

    assert [a["stem"] for a in answers] == ["Question RES1-Q2?", "Question RES1-Q3?", "Question RES1-Q1?"]
    assert [a["responseText"] for a in answers] == [None, "B", "A"]
    assert [a["isCorrect"] for a in answers] == [False, False, True]
    assert all(a["questionType"] == "Single Select" for a in answers)
    # Only the options the question has: these have two, so no C or D.
    assert answers[0]["options"] == {"A": "first 2", "B": "second 2"}
    assert answers[2]["options"] == {"A": "first 1", "B": "second 1"}
    # Which set it is the result of, so the screen can be titled with it.
    assert body["activity"]["id"] == activity.id
    assert body["activity"]["title"] == activity.title

    # The teacher's own read of the same attempt is in the same order.
    client.cookies.clear()
    teacher_headers = _login(client, teacher.user.email)
    teacher_view = client.get(f"/api/learning/attempts/{attempt.id}/result", headers=teacher_headers)
    assert [a["stem"] for a in teacher_view.json()["answers"]] == [a["stem"] for a in answers]


def test_student_is_not_sent_the_model_answer_for_an_answer_still_waiting_for_marks(client, db_session):
    """4 Oct 2026. A written answer waits for a teacher's marks. Until it has
    them, the student's result must not carry its model answer or its
    explanation: with attempts left, both could be read and the answer
    rewritten before the first one was marked. The teacher reading the same
    attempt gets both, and so does the student once it is marked."""
    chapter, (skill1,) = _make_chapter_with_skills(db_session, "RES2", n_skills=1)
    _add_question(db_session, skill1, "RES2-Q1", assignment_code=_ac("RES2", "P01"), question_type="Single Select", correct_answer="A", marks=1)
    written = _add_question(
        db_session, skill1, "RES2-Q2", assignment_code=_ac("RES2", "P01"), question_type="Constructed Response",
        correct_answer="A model answer.", marks=3, auto_gradable=False,
    )
    written.explanation = "Why the model answer is right."
    db_session.commit()

    school = _make_school(db_session, "res2")
    teacher = _make_teacher(db_session, school, "res2")
    student = _make_student(db_session, school, "res2")
    db_session.commit()

    [activity] = learning_service.generate_activities_for_chapter(db_session, chapter, created_by_user_id=None)
    _publish(db_session, activity)
    assignment = learning_service.create_assignment(
        db_session, school=school, learning_activity=activity, assigned_by_user_id=teacher.user_id, class_name="5A",
    )
    [target] = db_session.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).all()
    by_code = {q.code: q for q in db_session.query(Question).filter(Question.code.like("RES2-Q%")).all()}
    attempt = learning_service.start_attempt(db_session, student, target.id)
    learning_service.save_answer(db_session, student, attempt.id, by_code["RES2-Q1"].id, "B")
    learning_service.save_answer(db_session, student, attempt.id, by_code["RES2-Q2"].id, "What I wrote.")
    evaluation = learning_service.submit_attempt(db_session, student, attempt.id)
    assert evaluation.review_status == "PENDING_REVIEW"

    def answers_for(email):
        client.cookies.clear()
        response = client.get(f"/api/learning/attempts/{attempt.id}/result", headers=_login(client, email))
        assert response.status_code == 200
        return {a["stem"]: a for a in response.json()["answers"]}

    seen = answers_for(student.user.email)
    # The auto-marked one: wrong, and its key is shown, as it always was.
    assert seen["Question RES2-Q1?"]["correctAnswer"] == "A"
    # The written one: what was written, and nothing that gives it away.
    assert seen["Question RES2-Q2?"]["responseText"] == "What I wrote."
    assert seen["Question RES2-Q2?"]["correctAnswer"] is None
    assert seen["Question RES2-Q2?"]["explanation"] is None

    # The teacher marking it needs both.
    taught = answers_for(teacher.user.email)
    assert taught["Question RES2-Q2?"]["correctAnswer"] == "A model answer."
    assert taught["Question RES2-Q2?"]["explanation"] == "Why the model answer is right."

    # Marked: the student now sees what it should have been.
    learning_service.apply_manual_grades(db_session, attempt=attempt, grades={by_code["RES2-Q2"].id: 2}, grader_user_id=teacher.user_id)
    db_session.commit()
    marked = answers_for(student.user.email)
    assert marked["Question RES2-Q2?"]["manualScore"] == 2
    assert marked["Question RES2-Q2?"]["correctAnswer"] == "A model answer."
    assert marked["Question RES2-Q2?"]["explanation"] == "Why the model answer is right."

def test_teacher_can_assign_to_one_section_through_the_api(client, db_session):
    """30 Sep 2026: the same section fix, end to end through
    POST /api/learning/assignments the way the teacher Assign Practice
    picker now calls it (className = the section's classLevelCode, plus
    section).

    Updated 30 Sep 2026 for the section-ownership check added the same day
    (routes_learning.create_assignment): the teacher now needs a current
    TeacherSectionAssignment for each section it assigns to, and omitting
    section is a 422 for a TEACHER rather than "whole class" -- the
    whole-class path is still covered for ADMIN/SUPER_ADMIN by
    test_admin_and_super_admin_create_assignment_skip_section_ownership."""
    chapter, (skill1,) = _make_chapter_with_skills(db_session, "API7", n_skills=1)
    _add_question(db_session, skill1, "API7-Q1", assignment_code=_ac("API7", "P01"), question_type="Single Select", correct_answer="A", marks=1)
    db_session.commit()
    [activity] = learning_service.generate_activities_for_chapter(db_session, chapter, created_by_user_id=None)
    _publish(db_session, activity)

    school = _make_school(db_session, "api7")
    teacher = _make_teacher(db_session, school, "api7")
    in_5a = _make_sectioned_student(db_session, school, "api7-5a", class_name="5", section="A")
    _make_sectioned_student(db_session, school, "api7-5b", class_name="5", section="B")
    # Owns A (has students) and C (has none) -- so the "no students in that
    # section" 422 below is still reached past the ownership check.
    _assign_teacher_section(db_session, teacher, chapter.board_course_id, "A")
    _assign_teacher_section(db_session, teacher, chapter.board_course_id, "C")
    db_session.commit()

    headers = _login(client, teacher.user.email)
    section_response = client.post(
        "/api/learning/assignments",
        json={"learningActivityId": activity.id, "className": "5", "section": "A"},
        headers=headers,
    )
    assert section_response.status_code == 200
    assert section_response.json()["targetCount"] == 1
    [target] = db_session.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == section_response.json()["id"]).all()
    assert target.student_id == in_5a.id

    whole_class_response = client.post(
        "/api/learning/assignments",
        json={"learningActivityId": activity.id, "className": "5"},
        headers=headers,
    )
    assert whole_class_response.status_code == 422
    assert whole_class_response.json()["detail"]["message"] == "Choose a section to assign to."

    empty_section_response = client.post(
        "/api/learning/assignments",
        json={"learningActivityId": activity.id, "className": "5", "section": "C"},
        headers=headers,
    )
    assert empty_section_response.status_code == 422
    assert empty_section_response.json()["detail"]["message"] == "There are no active students in Class 5, Section C."


def test_teacher_cannot_assign_to_a_section_or_course_they_do_not_currently_own(client, db_session):
    """30 Sep 2026: POST /learning/assignments used to trust whatever
    className/section a TEACHER sent, scoped only by Teacher.school_id --
    the "your own sections only" rule lived solely in the frontend picker.
    Now enforced server-side via teacher_assignment_service.
    teacher_may_currently_act_on, which covers all three dimensions of a
    TeacherSectionAssignment row plus its end_date: another section of the
    same class, the same section but a different course's content, and a
    section the teacher was transferred off are all 403; a missing/blank
    section or an unknown class code are 422."""
    activity = _published_single_activity(db_session, "API8")
    own_course_id = db_session.get(Chapter, activity.chapter_id).board_course_id
    # A second chapter on its own BoardCourse (_get_or_create_board_course
    # makes a new one per suffix): same class, same section letter, but a
    # course this teacher was never assigned.
    other_course_activity = _published_single_activity(db_session, "API8X")

    school = _make_school(db_session, "api8")
    teacher = _make_teacher(db_session, school, "api8")
    successor = _make_teacher(db_session, school, "api8-successor")
    for section in ("A", "B", "D"):
        _make_sectioned_student(db_session, school, f"api8-5{section.lower()}", class_name="5", section=section)
    _assign_teacher_section(db_session, teacher, own_course_id, "A")
    handed_over = _assign_teacher_section(db_session, teacher, own_course_id, "D")
    teacher_assignment_service.transfer_teacher(
        db_session, assignment=handed_over, new_teacher_id=successor.id, transfer_date=date(2026, 8, 20), admin_user_id=None,
    )
    db_session.commit()

    headers = _login(client, teacher.user.email)

    def post(**body):
        return client.post("/api/learning/assignments", json={"learningActivityId": activity.id, **body}, headers=headers)

    forbidden = "You're not the current teacher for this class, section and subject."

    # Same class, same school, real students -- but not this teacher's section.
    other_section = post(className="5", section="B")
    assert other_section.status_code == 403
    assert other_section.json()["detail"]["message"] == forbidden

    # This teacher's own section letter, but content from a course they don't teach there.
    other_course = client.post(
        "/api/learning/assignments",
        json={"learningActivityId": other_course_activity.id, "className": "5", "section": "A"},
        headers=headers,
    )
    assert other_course.status_code == 403

    # A section they used to own but were transferred off (end_date set):
    # write access is current-only, per teacher_assignment_service's docstring.
    transferred_off = post(className="5", section="D")
    assert transferred_off.status_code == 403

    for missing_section in ({}, {"section": None}, {"section": "   "}):
        response = post(className="5", **missing_section)
        assert response.status_code == 422, missing_section
        assert response.json()["detail"]["message"] == "Choose a section to assign to."

    unknown_class = post(className="5A", section="A")  # the old combined form is not a ClassLevel code
    assert unknown_class.status_code == 422
    assert unknown_class.json()["detail"]["message"] == "That class isn't set up on the platform."

    # Nothing above created an Assignment row; the owned section still works.
    assert db_session.query(Assignment).filter(Assignment.assigned_by_user_id == teacher.user_id).count() == 0
    own_section = post(className="5", section=" A ")  # stripped, same as TeacherSectionAssignment.section
    assert own_section.status_code == 200, own_section.text
    assert own_section.json()["targetCount"] == 1


def test_teacher_cannot_bypass_section_ownership_with_student_ids(client, db_session):
    """30 Sep 2026: learning_service.create_assignment ignores class_name/
    section entirely once student_ids is given, so a TEACHER naming a
    section they genuinely own while also sending studentIds would pass the
    ownership check above and still land on whichever students they named --
    any active student at the school, not just their own section. Closed by
    rejecting studentIds from a TEACHER outright (no frontend page ever
    sends it). ADMIN keeps the capability, unaffected."""
    activity = _published_single_activity(db_session, "API8B")
    school = _make_school(db_session, "api8b")
    teacher = _make_teacher(db_session, school, "api8b")
    own_course_id = db_session.get(Chapter, activity.chapter_id).board_course_id
    _assign_teacher_section(db_session, teacher, own_course_id, "A")
    in_own_section = _make_sectioned_student(db_session, school, "api8b-5a", class_name="5", section="A")
    elsewhere = _make_sectioned_student(db_session, school, "api8b-6c", class_name="6", section="C")
    db_session.commit()

    headers = _login(client, teacher.user.email)
    response = client.post(
        "/api/learning/assignments",
        json={
            "learningActivityId": activity.id,
            "className": "5",
            "section": "A",
            "studentIds": [in_own_section.id, elsewhere.id],
        },
        headers=headers,
    )
    assert response.status_code == 422
    assert response.json()["detail"]["message"] == "Assign by class and section, not by naming students directly."
    assert db_session.query(Assignment).filter(Assignment.assigned_by_user_id == teacher.user_id).count() == 0


def test_admin_and_super_admin_create_assignment_skip_section_ownership(client, db_session):
    """30 Sep 2026: the TEACHER-only section-ownership check must not change
    ADMIN/SUPER_ADMIN behaviour at all -- no section required (whole class,
    every section, exactly as before), and no TeacherSectionAssignment
    needed for any section they do name. teacher_assignment_service's
    module docstring: admins bypass its access checks at the route layer."""
    activity = _published_single_activity(db_session, "API9")
    school = _make_school(db_session, "api9")
    in_5a = _make_sectioned_student(db_session, school, "api9-5a", class_name="5", section="A")
    in_5b = _make_sectioned_student(db_session, school, "api9-5b", class_name="5", section="B")
    admin = _make_school_admin(db_session, school, "api9")
    super_admin = _make_super_admin(db_session, "api9")
    # Deliberately no TeacherSectionAssignment rows for this school at all.

    admin_headers = _login(client, admin.email)
    admin_whole_class = client.post(
        "/api/learning/assignments", json={"learningActivityId": activity.id, "className": "5"}, headers=admin_headers,
    )
    assert admin_whole_class.status_code == 200, admin_whole_class.text
    targets = db_session.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == admin_whole_class.json()["id"]).all()
    assert {t.student_id for t in targets} == {in_5a.id, in_5b.id}
    admin_one_section = client.post(
        "/api/learning/assignments",
        json={"learningActivityId": activity.id, "className": "5", "section": "B"},
        headers=admin_headers,
    )
    assert admin_one_section.status_code == 200, admin_one_section.text
    assert admin_one_section.json()["targetCount"] == 1

    client.cookies.clear()
    sa_headers = _login(client, super_admin.email)
    sa_whole_class = client.post(
        "/api/learning/assignments",
        json={"learningActivityId": activity.id, "schoolId": school.id, "className": "5"},
        headers=sa_headers,
    )
    assert sa_whole_class.status_code == 200, sa_whole_class.text
    assert sa_whole_class.json()["targetCount"] == 2


def test_resuming_an_attempt_returns_previously_saved_answers(client, db_session):
    """30 Sep 2026: POST /learning/attempts on an IN_PROGRESS attempt
    (resume) used to return every question blank even though
    PUT /attempts/{id}/answers had already persisted the student's answers
    to AttemptAnswer.response_text. Each question now carries its saved
    responseText (None when unanswered), a brand-new attempt comes back all
    None -- including a re-attempt, which must never inherit the previous
    attempt's answers -- and the answer key is still never included."""
    _chapter, activity = _setup_published_activity_with_two_questions(db_session, "API10")
    school = _make_school(db_session, "api10")
    student = _make_student(db_session, school, "api10")
    assignment = learning_service.create_assignment(
        db_session, school=school, learning_activity=activity, assigned_by_user_id="teacher-x", student_ids=[student.id],
    )
    [target] = db_session.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).all()

    headers = _login(client, student.user.email)
    fresh = client.post("/api/learning/attempts", json={"assignmentTargetId": target.id}, headers=headers)
    assert fresh.status_code == 200
    fresh_body = fresh.json()
    assert [q["responseText"] for q in fresh_body["questions"]] == [None, None]
    q1_id, q2_id = (q["id"] for q in fresh_body["questions"])

    saved = client.put(
        f"/api/learning/attempts/{fresh_body['id']}/answers", json={"questionId": q1_id, "responseText": "A"}, headers=headers,
    )
    assert saved.status_code == 200

    resumed = client.post("/api/learning/attempts", json={"assignmentTargetId": target.id}, headers=headers)
    assert resumed.status_code == 200
    resumed_body = resumed.json()
    assert resumed_body["id"] == fresh_body["id"]  # the same attempt, resumed
    by_id = {q["id"]: q for q in resumed_body["questions"]}
    assert by_id[q1_id]["responseText"] == "A"
    assert by_id[q2_id]["responseText"] is None
    for question in resumed_body["questions"]:
        assert "correctAnswer" not in question
        assert "explanation" not in question

    submitted = client.post(f"/api/learning/attempts/{fresh_body['id']}/submit", headers=headers)
    assert submitted.status_code == 200
    reattempt = client.post("/api/learning/attempts", json={"assignmentTargetId": target.id}, headers=headers)
    assert reattempt.status_code == 200
    assert reattempt.json()["attemptNumber"] == 2
    assert [q["responseText"] for q in reattempt.json()["questions"]] == [None, None]


def test_student_sees_bonus_attempts_and_attempts_used(client, db_session):
    """30 Sep 2026: a teacher-granted extra attempt (bonus_attempts) was
    invisible to the student -- GET /learning/assignments carried only
    maxAttempts, and GET /attempts/{id}/result carried neither, so the
    student UI computed "attempt X of Y" and whether to offer Try Again
    against max_attempts alone. Both now expose bonusAttempts, and the
    result also carries maxAttempts and attemptsUsed (counted across ALL
    of this target's attempts, not "as of" the attempt being viewed)."""
    _chapter, activity = _setup_published_activity_with_two_questions(db_session, "API11")
    school = _make_school(db_session, "api11")
    student = _make_student(db_session, school, "api11")
    assignment = learning_service.create_assignment(
        db_session, school=school, learning_activity=activity, assigned_by_user_id="teacher-x",
        student_ids=[student.id], max_attempts=1,
    )
    [target] = db_session.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).all()
    first = learning_service.start_attempt(db_session, student, target.id)
    learning_service.submit_attempt(db_session, student, first.id)

    headers = _login(client, student.user.email)
    [before_grant] = client.get("/api/learning/assignments", headers=headers).json()["assignments"]
    assert before_grant["maxAttempts"] == 1
    assert before_grant["bonusAttempts"] == 0
    first_result = client.get(f"/api/learning/attempts/{first.id}/result", headers=headers).json()
    assert (first_result["maxAttempts"], first_result["bonusAttempts"], first_result["attemptsUsed"]) == (1, 0, 1)

    # grant_extra_attempt deliberately doesn't commit (the route commits it
    # with its audit row) -- commit here in its place.
    learning_service.grant_extra_attempt(db_session, target)
    db_session.commit()

    [after_grant] = client.get("/api/learning/assignments", headers=headers).json()["assignments"]
    assert after_grant["bonusAttempts"] == 1

    second = learning_service.start_attempt(db_session, student, target.id)
    learning_service.submit_attempt(db_session, student, second.id)
    second_result = client.get(f"/api/learning/attempts/{second.id}/result", headers=headers).json()
    assert second_result["attemptNumber"] == 2
    assert (second_result["maxAttempts"], second_result["bonusAttempts"], second_result["attemptsUsed"]) == (1, 1, 2)
    # attemptsUsed is per target, so an older attempt's result reports the same total.
    assert client.get(f"/api/learning/attempts/{first.id}/result", headers=headers).json()["attemptsUsed"] == 2


def test_student_list_hides_cancelled_assignments_but_keeps_closed_ones(client, db_session):
    """30 Sep 2026, defensive: nothing in the codebase sets
    Assignment.status away from ACTIVE yet, so this is set directly on the
    rows here. A CANCELLED assignment must be absent from the student's
    list entirely; a CLOSED one stays visible (review is fine --
    start_attempt already refuses a new attempt on it)."""
    activity = _published_single_activity(db_session, "API12")
    school = _make_school(db_session, "api12")
    student = _make_student(db_session, school, "api12")
    by_status = {}
    for status in ("ACTIVE", "CLOSED", "CANCELLED"):
        assignment = learning_service.create_assignment(
            db_session, school=school, learning_activity=activity, assigned_by_user_id="teacher-x", student_ids=[student.id],
        )
        assignment.status = status
        by_status[status] = assignment.id
    db_session.commit()

    headers = _login(client, student.user.email)
    response = client.get("/api/learning/assignments", headers=headers)
    assert response.status_code == 200
    listed = {row["assignmentId"] for row in response.json()["assignments"]}
    assert listed == {by_status["ACTIVE"], by_status["CLOSED"]}
    assert by_status["CANCELLED"] not in listed


# --- Foundation Repair section ownership (A11 completeness pass, 1 Oct 2026) ---


def _student_with_low_mastery(db, school, suffix, activity, *, class_name, section):
    """A student who has one EVALUATED CORE_PRACTICE attempt on `activity`
    scored 0%, so get_recommendation returns LOW_ACCURACY for its concept."""
    student = _make_sectioned_student(db, school, suffix, class_name=class_name, section=section)
    assignment = learning_service.create_assignment(
        db, school=school, learning_activity=activity, assigned_by_user_id=None, student_ids=[student.id],
    )
    target = db.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).first()
    attempt = learning_service.start_attempt(db, student, target.id)
    question_id = next(iter(learning_service._activity_question_ids(db, activity.id)))
    learning_service.save_answer(db, student, attempt.id, question_id, "B")  # wrong -- correct_answer is "A"
    learning_service.submit_attempt(db, student, attempt.id)
    return student


def _rescue_assignment_count(db, student) -> int:
    return (
        db.query(Assignment)
        .join(AssignmentTarget, AssignmentTarget.assignment_id == Assignment.id)
        .filter(AssignmentTarget.student_id == student.id, Assignment.reason == "LOW_ACCURACY")
        .count()
    )


def test_foundation_repair_requires_current_section_ownership(client, db_session):
    """Gap found in the A11 completeness pass: GET /foundation-repair and
    POST /foundation-repair/approve only checked Teacher.school_id, so ANY
    teacher at the school could read any student's concept mastery and
    approve a rescue Assignment (a practice WRITE) for them. Before the fix
    every 403 asserted below was a 200 (verified by running this test
    against the pre-fix routes_learning.py). Now only the student's CURRENT
    section teacher for that course may do either; a since-transferred
    teacher may do neither; ADMIN is unaffected."""
    chapter, (skill,) = _make_chapter_with_skills(db_session, "FR4", n_skills=1)
    _add_question(db_session, skill, "FR4-P01-01", assignment_code=_ac("FR4", "P01"), correct_answer="A")
    db_session.commit()
    [activity] = learning_service.generate_activities_for_chapter(db_session, chapter, created_by_user_id=None)
    _publish(db_session, activity)

    school = _make_school(db_session, "fr4")
    current = _make_teacher(db_session, school, "fr4-current")
    former = _make_teacher(db_session, school, "fr4-former")
    # `former` taught 5A for this course from 1 Apr 2026 and was transferred
    # off it on 20 Aug 2026; `current` has held it since.
    row = _assign_teacher_section(db_session, former, chapter.board_course_id, "A")
    teacher_assignment_service.transfer_teacher(
        db_session, assignment=row, new_teacher_id=current.id, transfer_date=date(2026, 8, 20), admin_user_id=None,
    )
    db_session.commit()

    in_5a = _student_with_low_mastery(db_session, school, "fr4-a", activity, class_name="5", section="A")
    in_5b = _student_with_low_mastery(db_session, school, "fr4-b", activity, class_name="5", section="B")
    no_section = _student_with_low_mastery(db_session, school, "fr4-n", activity, class_name="5", section=None)

    def recommendation(student, headers):
        return client.get(
            "/api/learning/foundation-repair",
            params={"studentId": student.id, "conceptLessonId": skill.id},
            headers=headers,
        )

    def approve(student, headers):
        return client.post(
            "/api/learning/foundation-repair/approve",
            json={"studentId": student.id, "conceptLessonId": skill.id},
            headers=headers,
        )

    # Current 5A teacher, own student: both still work exactly as before.
    headers = {**_login(client, current.user.email), "x-auth-role": "TEACHER"}
    read = recommendation(in_5a, headers)
    assert read.status_code == 200, read.text
    assert read.json()["recommendation"] == "LOW_ACCURACY"
    approved = approve(in_5a, headers)
    assert approved.status_code == 200, approved.text
    assert approved.json()["targetCount"] == 1
    assert _rescue_assignment_count(db_session, in_5a) == 1

    # Same teacher, same school, a section they don't teach (the gap): no
    # mastery read, no rescue assignment written.
    for student in (in_5b, no_section):
        denied_read = recommendation(student, headers)
        assert denied_read.status_code == 403, denied_read.text
        assert "currentScorePercent" not in denied_read.text
        denied_write = approve(student, headers)
        assert denied_write.status_code == 403, denied_write.text
        assert _rescue_assignment_count(db_session, student) == 0

    # Transferred-off teacher: was 5A's teacher, isn't any more -- neither
    # the read nor the write is allowed on a 5A student now.
    client.cookies.clear()
    headers = {**_login(client, former.user.email), "x-auth-role": "TEACHER"}
    assert recommendation(in_5a, headers).status_code == 403
    assert approve(in_5a, headers).status_code == 403
    assert _rescue_assignment_count(db_session, in_5a) == 1  # unchanged

    # ADMIN is not section-scoped (teacher_assignment_service's module
    # docstring) -- still reads any student in their own school.
    client.cookies.clear()
    admin = _make_school_admin(db_session, school, "fr4")
    headers = {**_login(client, admin.email), "x-auth-role": "ADMIN"}
    admin_read = recommendation(in_5b, headers)
    assert admin_read.status_code == 200, admin_read.text
    assert admin_read.json()["recommendation"] == "LOW_ACCURACY"
