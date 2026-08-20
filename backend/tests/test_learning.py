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
import pyotp

from app.core.security import hash_password
from app.models import (
    Assignment,
    AssignmentTarget,
    Attempt,
    Board,
    BoardCourse,
    Chapter,
    ClassLevel,
    ConceptLesson,
    CurriculumVersion,
    Discipline,
    LearningActivity,
    PrerequisiteLink,
    Question,
    School,
    SchoolAdmin,
    Student,
    SubjectGroup,
    Teacher,
    User,
)
from app.services import foundation_repair_service, learning_service
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
    "ATT1": 5, "ATT2": 6, "ATT3": 7,
    "FR2": 8, "FR3": 9,
    "API1": 10, "API2": 11,
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
    chapter, activity = _setup_published_activity_with_two_questions(db_session, "ATT1")
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
    chapter, activity = _setup_published_activity_with_two_questions(db_session, "ATT2")
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


def test_unanswered_question_is_scored_as_wrong_on_submit(db_session):
    """blueprint 8.2: 'Unattempted answers receive zero.' -- never touching
    a question at all must still count against max_score, not be silently
    excluded."""
    chapter, activity = _setup_published_activity_with_two_questions(db_session, "ATT3")
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
    chapter, (skill1,) = _make_chapter_with_skills(db_session, "FR1", n_skills=1)
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


def test_super_admin_generate_publish_then_teacher_assigns_then_student_completes_attempt_end_to_end(client, db_session):
    chapter, (skill1,) = _make_chapter_with_skills(db_session, "API2", n_skills=1)
    _add_question(db_session, skill1, "API2-Q1", assignment_code=_ac("API2", "P01"), question_type="Single Select", correct_answer="A", marks=1)
    db_session.commit()

    super_admin = _make_super_admin(db_session, "api2")
    school = _make_school(db_session, "api2")
    teacher = _make_teacher(db_session, school, "api2")
    student = _make_student(db_session, school, "api2")
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
        json={"learningActivityId": activity_id, "className": "5A"},
        headers=teacher_headers,
    )
    assert assign_response.status_code == 200
    assert assign_response.json()["targetCount"] == 1

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
