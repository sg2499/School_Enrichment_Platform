"""Proves the Phase 2 curriculum-admin endpoints (routes_curriculum_admin.py):
Chapter/ConceptLesson/Question status transitions (SUPER_ADMIN-only, explicit
allow-listed transitions, chapter-publish readiness check) and
SchoolCurriculumMap create/list/delete (school-scoped to the acting ADMIN's
own school, or any school for SUPER_ADMIN).

Each test builds its own Chapter/ConceptLesson/Question rows directly via the
ORM with a unique code suffix -- the test DB is an in-memory SQLite instance
shared across the whole session (see conftest.py), not reset per test, so
distinct codes avoid cross-test collisions the same way test_auth.py/
test_platform.py/test_curriculum_import.py already do. Shared master data
(Board/ClassLevel/SubjectGroup/Discipline/BoardCourse) is get-or-created by
code, mirroring curriculum_import_service.py's own idempotent pattern, so it
doesn't matter which test file runs first.

ADMIN and SUPER_ADMIN each have their own session-cookie name (see
cookies.py -- split 18 Aug 2026 so both can be signed in at once in separate
browser tabs). Tests written before that split still set a chapter's status
directly on the ORM object instead of round-tripping the publish endpoint
through a second client when a test needs both a SUPER_ADMIN action
(publish) and an ADMIN action (map) -- left as-is since it's equivalent and
the publish endpoint itself already gets full coverage from the
SUPER_ADMIN-only tests below.
"""
import pyotp
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.core.security import hash_password
from app.models import (
    Board,
    BoardCourse,
    Chapter,
    ClassLevel,
    ConceptLesson,
    CurriculumVersion,
    Discipline,
    Question,
    School,
    SchoolAdmin,
    SchoolCurriculumMap,
    SubjectGroup,
    Teacher,
    User,
)

PASSWORD = "Passw0rd1"

# Fixed TOTP secret for every ADMIN/SUPER_ADMIN test fixture below (2026-08-19
# security hardening: 2FA is now mandatory for both roles, see
# dependencies.py's MANDATORY_2FA_ROLES). A shared, known secret -- rather
# than each test calling the real /2fa/setup endpoint -- keeps every existing
# test's login a one-liner via _login()'s built-in challenge handling; the
# setup/enable flow itself gets its own dedicated coverage in
# tests/test_mandatory_2fa.py.
TEST_TOTP_SECRET = pyotp.random_base32()


def _get_or_create_board_course(db):
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

    board_course = (
        db.query(BoardCourse)
        .filter(
            BoardCourse.board_id == board.id,
            BoardCourse.class_level_id == class_level.id,
            BoardCourse.code == "MATHEMATICS",
        )
        .first()
    )
    if not board_course:
        board_course = BoardCourse(
            board_id=board.id,
            class_level_id=class_level.id,
            code="MATHEMATICS",
            display_name="Mathematics",
            status="DRAFT",
        )
        db.add(board_course)
        db.flush()

    curriculum_version = (
        db.query(CurriculumVersion)
        .filter(CurriculumVersion.board_id == board.id, CurriculumVersion.code == "2026-27")
        .first()
    )
    if not curriculum_version:
        curriculum_version = CurriculumVersion(
            board_id=board.id, code="2026-27", label="2026-27", status="PUBLISHED", effective_from="2026-04-01"
        )
        db.add(curriculum_version)
        db.flush()

    db.commit()
    return board_course, discipline, curriculum_version


def _make_chapter(db, suffix: str, status: str = "DRAFT"):
    board_course, discipline, curriculum_version = _get_or_create_board_course(db)
    chapter = Chapter(
        discipline_id=discipline.id,
        board_course_id=board_course.id,
        curriculum_version_id=curriculum_version.id,
        code=f"CH-ADMIN-{suffix}",
        chapter_no=900,
        title=f"Admin Test Chapter {suffix}",
        status=status,
    )
    db.add(chapter)
    db.commit()
    db.refresh(chapter)
    return chapter, board_course


def _add_lesson_with_question(db, chapter, suffix: str, lesson_status="DRAFT", question_status="DRAFT"):
    lesson = ConceptLesson(chapter_id=chapter.id, code=f"SKL-{suffix}", title=f"Skill {suffix}", status=lesson_status)
    db.add(lesson)
    db.flush()
    question = Question(
        concept_lesson_id=lesson.id,
        code=f"Q-{suffix}",
        question_type="Single Select",
        stem="2 + 2 = ?",
        correct_answer="4",
        status=question_status,
    )
    db.add(question)
    db.commit()
    db.refresh(lesson)
    return lesson, question


def _make_super_admin(db, email: str) -> User:
    # totp_enabled=True: 2FA is mandatory for ADMIN/SUPER_ADMIN as of the
    # 2026-08-19 security hardening (dependencies.py's MANDATORY_2FA_ROLES
    # check) -- without this, every curriculum-admin test below would be
    # blocked with a 403 TWO_FACTOR_SETUP_REQUIRED before its role check
    # ever ran. These tests exercise curriculum-admin behaviour, not 2FA
    # itself, so the fixture just pre-enrolls the account.
    user = User(
        full_name="Platform Super Admin",
        email=email,
        password_hash=hash_password(PASSWORD),
        role="SUPER_ADMIN",
        totp_enabled=True,
        totp_secret=TEST_TOTP_SECRET,
    )
    db.add(user)
    db.commit()
    return user


def _make_school_admin(db, email: str, school_name: str):
    school = School(name=school_name, board="CBSE", city="Bengaluru")
    db.add(school)
    db.flush()
    user = User(
        full_name="School Admin",
        email=email,
        password_hash=hash_password(PASSWORD),
        role="ADMIN",
        totp_enabled=True,
        totp_secret=TEST_TOTP_SECRET,
    )
    db.add(user)
    db.flush()
    db.add(SchoolAdmin(user_id=user.id, school_id=school.id))
    db.commit()
    return user, school


def _login(client, email: str) -> dict:
    """Logs in and returns the X-CSRF-Token header every mutating request in
    these tests must attach. get_current_user() (dependencies.py) requires
    it for any cookie-authenticated POST/PUT/PATCH/DELETE -- the double-
    submit CSRF check (see cookies.py) -- so a bare client.post/patch/delete
    after login gets rejected with a CSRF 403 before role checks ever run.

    Every ADMIN/SUPER_ADMIN fixture in this file has 2FA pre-enrolled with
    TEST_TOTP_SECRET (2026-08-19 security hardening), so /auth/login now
    returns a challenge instead of a session for them -- this transparently
    completes that second step with a freshly computed TOTP code so every
    existing call site here keeps working as a one-line login.
    """
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


# --- Chapter status transitions ------------------------------------------


def test_super_admin_can_list_and_view_chapter(client, db_session):
    chapter, _ = _make_chapter(db_session, "list01")
    _add_lesson_with_question(db_session, chapter, "list01")
    _make_super_admin(db_session, "sa-list01@example.com")
    _login(client, "sa-list01@example.com")

    list_response = client.get("/api/curriculum-admin/chapters", params={"status": "DRAFT"})
    assert list_response.status_code == 200
    codes = [c["code"] for c in list_response.json()["chapters"]]
    assert "CH-ADMIN-list01" in codes

    detail_response = client.get(f"/api/curriculum-admin/chapters/{chapter.id}")
    assert detail_response.status_code == 200
    body = detail_response.json()
    assert body["conceptLessonCount"] == 1
    assert body["questionCount"] == 1
    assert body["conceptLessons"][0]["code"] == "SKL-list01"


def test_school_admin_only_sees_published_chapters(client, db_session):
    draft_chapter, _ = _make_chapter(db_session, "vis01", status="DRAFT")
    published_chapter, _ = _make_chapter(db_session, "vis02", status="PUBLISHED")
    _make_school_admin(db_session, "admin-vis01@example.com", "Visibility Test School")
    _login(client, "admin-vis01@example.com")

    # A status filter from an ADMIN is overridden, not honoured -- they only
    # ever see PUBLISHED regardless of what they ask for.
    list_response = client.get("/api/curriculum-admin/chapters", params={"status": "DRAFT"})
    assert list_response.status_code == 200
    codes = [c["code"] for c in list_response.json()["chapters"]]
    assert "CH-ADMIN-vis02" in codes
    assert "CH-ADMIN-vis01" not in codes

    published_detail = client.get(f"/api/curriculum-admin/chapters/{published_chapter.id}")
    assert published_detail.status_code == 200

    draft_detail = client.get(f"/api/curriculum-admin/chapters/{draft_chapter.id}")
    assert draft_detail.status_code == 404


def test_board_courses_listing_available_to_both_roles(client, db_session):
    _get_or_create_board_course(db_session)
    _make_school_admin(db_session, "admin-bc01@example.com", "Board Course Test School")
    _login(client, "admin-bc01@example.com")

    response = client.get("/api/curriculum-admin/board-courses")
    assert response.status_code == 200
    courses = response.json()["boardCourses"]
    assert any(c["code"] == "MATHEMATICS" and c["boardCode"] == "CBSE" for c in courses)


def test_schools_listing_is_super_admin_only(client, db_session):
    """Also doubles as the regression test for the 18 Aug 2026 cookie split:
    ADMIN and SUPER_ADMIN now each get their own cookie name, so two
    separate TestClient instances sharing the same app/db (one per "browser
    tab") can be signed in as each role at once without either kicking the
    other out -- exactly the scenario the split was built for.
    """
    _make_school_admin(db_session, "admin-sl01@example.com", "Schools Listing Test School")
    _make_super_admin(db_session, "sa-sl01@example.com")

    admin_tab = TestClient(client.app)
    sa_tab = TestClient(client.app)

    _login(admin_tab, "admin-sl01@example.com")
    _login(sa_tab, "sa-sl01@example.com")

    # Both sessions coexist -- the admin tab is still unaffected by the
    # super-admin login that happened in the "other tab".
    admin_response = admin_tab.get("/api/curriculum-admin/schools")
    assert admin_response.status_code == 403

    sa_response = sa_tab.get("/api/curriculum-admin/schools")
    assert sa_response.status_code == 200
    names = [s["name"] for s in sa_response.json()["schools"]]
    assert "Schools Listing Test School" in names


def test_chapter_status_rejects_invalid_jump(client, db_session):
    chapter, _ = _make_chapter(db_session, "jump01")
    _make_super_admin(db_session, "sa-jump01@example.com")
    csrf = _login(client, "sa-jump01@example.com")

    response = client.patch(f"/api/curriculum-admin/chapters/{chapter.id}/status", json={"status": "PUBLISHED"}, headers=csrf)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "INVALID_STATUS_TRANSITION"


def test_chapter_publish_requires_review_and_ready_questions(client, db_session):
    chapter, _ = _make_chapter(db_session, "pub01")
    _lesson, question = _add_lesson_with_question(db_session, chapter, "pub01", question_status="DRAFT")
    _make_super_admin(db_session, "sa-pub01@example.com")
    csrf = _login(client, "sa-pub01@example.com")

    to_review = client.patch(f"/api/curriculum-admin/chapters/{chapter.id}/status", json={"status": "REVIEW"}, headers=csrf)
    assert to_review.status_code == 200
    assert to_review.json()["status"] == "REVIEW"

    not_ready = client.patch(f"/api/curriculum-admin/chapters/{chapter.id}/status", json={"status": "PUBLISHED"}, headers=csrf)
    assert not_ready.status_code == 409
    assert not_ready.json()["detail"]["code"] == "CHAPTER_NOT_READY"
    assert "SKL-pub01" in not_ready.json()["detail"]["details"]["conceptLessonsMissingQuestions"]

    approve_question = client.patch(
        f"/api/curriculum-admin/questions/{question.id}/status", json={"status": "SME_REVIEW"}, headers=csrf
    )
    assert approve_question.status_code == 200
    approve_question = client.patch(
        f"/api/curriculum-admin/questions/{question.id}/status", json={"status": "APPROVED"}, headers=csrf
    )
    assert approve_question.status_code == 200

    published = client.patch(f"/api/curriculum-admin/chapters/{chapter.id}/status", json={"status": "PUBLISHED"}, headers=csrf)
    assert published.status_code == 200
    assert published.json()["status"] == "PUBLISHED"


def test_chapter_publish_rejects_chapter_with_no_lessons(client, db_session):
    chapter, _ = _make_chapter(db_session, "empty01")
    _make_super_admin(db_session, "sa-empty01@example.com")
    csrf = _login(client, "sa-empty01@example.com")

    client.patch(f"/api/curriculum-admin/chapters/{chapter.id}/status", json={"status": "REVIEW"}, headers=csrf)
    response = client.patch(f"/api/curriculum-admin/chapters/{chapter.id}/status", json={"status": "PUBLISHED"}, headers=csrf)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "CHAPTER_NOT_READY"


def test_admin_cannot_transition_chapter_status(client, db_session):
    chapter, _ = _make_chapter(db_session, "forbid01")
    _make_school_admin(db_session, "admin-forbid01@example.com", "Forbid Test School")
    csrf = _login(client, "admin-forbid01@example.com")

    response = client.patch(f"/api/curriculum-admin/chapters/{chapter.id}/status", json={"status": "REVIEW"}, headers=csrf)
    assert response.status_code == 403


def test_concept_lesson_status_transition(client, db_session):
    chapter, _ = _make_chapter(db_session, "lesson01")
    lesson, _ = _add_lesson_with_question(db_session, chapter, "lesson01")
    _make_super_admin(db_session, "sa-lesson01@example.com")
    csrf = _login(client, "sa-lesson01@example.com")

    response = client.patch(f"/api/curriculum-admin/concept-lessons/{lesson.id}/status", json={"status": "REVIEW"}, headers=csrf)
    assert response.status_code == 200
    assert response.json()["status"] == "REVIEW"

    invalid = client.patch(f"/api/curriculum-admin/concept-lessons/{lesson.id}/status", json={"status": "ARCHIVED"}, headers=csrf)
    assert invalid.status_code == 409


def test_super_admin_can_read_full_question_content_for_review(client, db_session):
    """The actual regression test for the content-review gap Shailesh flagged
    18 Aug 2026: clicking "Review" in the studio moved straight to a Publish
    button with no way to see what was being published. This proves the new
    GET .../questions endpoint surfaces the real stem/options/correct answer
    (not just a status badge), and that it's still SUPER_ADMIN-only like
    every other endpoint that touches unreviewed master content."""
    chapter, _ = _make_chapter(db_session, "qcontent01")
    lesson, question = _add_lesson_with_question(db_session, chapter, "qcontent01")
    _make_super_admin(db_session, "sa-qcontent01@example.com")
    _make_school_admin(db_session, "admin-qcontent01@example.com", "Question Content Test School")

    _login(client, "sa-qcontent01@example.com")
    response = client.get(f"/api/curriculum-admin/concept-lessons/{lesson.id}/questions")
    assert response.status_code == 200
    questions = response.json()["questions"]
    assert len(questions) == 1
    assert questions[0]["id"] == question.id
    assert questions[0]["stem"] == "2 + 2 = ?"
    assert questions[0]["correctAnswer"] == "4"
    assert questions[0]["status"] == "DRAFT"

    missing = client.get("/api/curriculum-admin/concept-lessons/does-not-exist/questions")
    assert missing.status_code == 404

    _login(client, "admin-qcontent01@example.com")
    forbidden = client.get(f"/api/curriculum-admin/concept-lessons/{lesson.id}/questions")
    assert forbidden.status_code == 403


def test_get_questions_lazily_computes_and_persists_quality_status(client, db_session):
    """The Single Select question _add_lesson_with_question creates has no
    options at all, which the structural check correctly flags. Confirms
    the lazy-compute-on-read behavior actually writes the result back (not
    just returns it), so a reviewer opening the same lesson twice doesn't
    recompute for nothing, and so bulk-approve later sees a real status."""
    chapter, _ = _make_chapter(db_session, "quality01")
    lesson, question = _add_lesson_with_question(db_session, chapter, "quality01")
    assert question.quality_status == "UNCHECKED"
    _make_super_admin(db_session, "sa-quality01@example.com")
    _login(client, "sa-quality01@example.com")

    response = client.get(f"/api/curriculum-admin/concept-lessons/{lesson.id}/questions")
    assert response.status_code == 200
    body = response.json()["questions"][0]
    assert body["qualityStatus"] == "FLAGGED"
    assert any("option" in f.lower() for f in body["qualityFlags"])

    db_session.refresh(question)
    assert question.quality_status == "FLAGGED"
    assert question.quality_checked_at is not None


def test_recheck_quality_endpoint_forces_full_recompute(client, db_session):
    chapter, _ = _make_chapter(db_session, "quality02")
    lesson, question = _add_lesson_with_question(db_session, chapter, "quality02")
    _make_super_admin(db_session, "sa-quality02@example.com")
    csrf = _login(client, "sa-quality02@example.com")

    response = client.post(f"/api/curriculum-admin/concept-lessons/{lesson.id}/questions/recheck-quality", headers=csrf)
    assert response.status_code == 200
    assert response.json()["questions"][0]["qualityStatus"] == "FLAGGED"

    missing = client.post("/api/curriculum-admin/concept-lessons/does-not-exist/questions/recheck-quality", headers=csrf)
    assert missing.status_code == 404


def _add_question(db, lesson, code, **overrides):
    defaults = dict(
        concept_lesson_id=lesson.id,
        code=code,
        question_type="Numeric Entry",
        stem="Round 4,236 to the nearest 10.",
        correct_answer="4240",
        status="DRAFT",
    )
    defaults.update(overrides)
    question = Question(**defaults)
    db.add(question)
    db.commit()
    db.refresh(question)
    return question


def test_bulk_approve_lesson_only_advances_verified_by_default(client, db_session):
    chapter, _ = _make_chapter(db_session, "bulk01")
    lesson = ConceptLesson(chapter_id=chapter.id, code="SKL-bulk01", title="Skill bulk01", status="DRAFT")
    db_session.add(lesson)
    db_session.commit()
    db_session.refresh(lesson)

    verified_q = _add_question(db_session, lesson, "Q-BULK01-V", stem="Round 4,236 to the nearest 10.", correct_answer="4240")
    flagged_q = _add_question(db_session, lesson, "Q-BULK01-F", stem="", correct_answer="")
    unverified_q = _add_question(db_session, lesson, "Q-BULK01-U", stem="Explain your reasoning in one sentence.", correct_answer="Because.")

    _make_super_admin(db_session, "sa-bulk01@example.com")
    csrf = _login(client, "sa-bulk01@example.com")

    response = client.post(
        f"/api/curriculum-admin/concept-lessons/{lesson.id}/questions/bulk-approve",
        json={"includeUnverified": False},
        headers=csrf,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["approvedCount"] == 1
    assert body["skippedFlaggedCount"] == 1
    assert body["skippedUnverifiedCount"] == 1

    for q in (verified_q, flagged_q, unverified_q):
        db_session.refresh(q)
    assert verified_q.status == "APPROVED"
    assert flagged_q.status == "DRAFT"
    assert unverified_q.status == "DRAFT"


def test_bulk_approve_lesson_include_unverified_still_never_touches_flagged(client, db_session):
    chapter, _ = _make_chapter(db_session, "bulk02")
    lesson = ConceptLesson(chapter_id=chapter.id, code="SKL-bulk02", title="Skill bulk02", status="DRAFT")
    db_session.add(lesson)
    db_session.commit()
    db_session.refresh(lesson)

    flagged_q = _add_question(db_session, lesson, "Q-BULK02-F", stem="", correct_answer="")
    unverified_q = _add_question(db_session, lesson, "Q-BULK02-U", stem="Explain your reasoning in one sentence.", correct_answer="Because.")

    _make_super_admin(db_session, "sa-bulk02@example.com")
    csrf = _login(client, "sa-bulk02@example.com")

    response = client.post(
        f"/api/curriculum-admin/concept-lessons/{lesson.id}/questions/bulk-approve",
        json={"includeUnverified": True},
        headers=csrf,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["approvedCount"] == 1
    assert body["skippedFlaggedCount"] == 1

    db_session.refresh(flagged_q)
    db_session.refresh(unverified_q)
    assert flagged_q.status == "DRAFT"  # never bulk-approved, no matter what
    assert unverified_q.status == "APPROVED"


def test_bulk_approve_chapter_spans_every_lesson(client, db_session):
    chapter, _ = _make_chapter(db_session, "bulk03")
    lesson_a = ConceptLesson(chapter_id=chapter.id, code="SKL-bulk03a", title="A", status="DRAFT")
    lesson_b = ConceptLesson(chapter_id=chapter.id, code="SKL-bulk03b", title="B", status="DRAFT")
    db_session.add_all([lesson_a, lesson_b])
    db_session.commit()
    db_session.refresh(lesson_a)
    db_session.refresh(lesson_b)

    q_a = _add_question(db_session, lesson_a, "Q-BULK03-A", stem="Round 4,236 to the nearest 10.", correct_answer="4240")
    q_b = _add_question(db_session, lesson_b, "Q-BULK03-B", stem="What is the place value of 7 in 47,326?", correct_answer="7000")

    _make_super_admin(db_session, "sa-bulk03@example.com")
    csrf = _login(client, "sa-bulk03@example.com")

    response = client.post(
        f"/api/curriculum-admin/chapters/{chapter.id}/questions/bulk-approve",
        json={"includeUnverified": False},
        headers=csrf,
    )
    assert response.status_code == 200
    assert response.json()["approvedCount"] == 2

    db_session.refresh(q_a)
    db_session.refresh(q_b)
    assert q_a.status == "APPROVED"
    assert q_b.status == "APPROVED"


def test_bulk_approve_is_super_admin_only(client, db_session):
    chapter, _ = _make_chapter(db_session, "bulk04")
    lesson, _ = _add_lesson_with_question(db_session, chapter, "bulk04")
    _make_school_admin(db_session, "admin-bulk04@example.com", "Bulk Approve Test School")
    csrf = _login(client, "admin-bulk04@example.com")

    response = client.post(
        f"/api/curriculum-admin/concept-lessons/{lesson.id}/questions/bulk-approve",
        json={},
        headers=csrf,
    )
    assert response.status_code == 403


def test_bulk_chapter_status_send_all_to_review(client, db_session):
    chapter_a, _ = _make_chapter(db_session, "bulkstatus01", status="DRAFT")
    chapter_b, _ = _make_chapter(db_session, "bulkstatus02", status="DRAFT")
    chapter_c, _ = _make_chapter(db_session, "bulkstatus03", status="PUBLISHED")
    _make_super_admin(db_session, "sa-bulkstatus01@example.com")
    csrf = _login(client, "sa-bulkstatus01@example.com")

    response = client.post(
        "/api/curriculum-admin/chapters/bulk-status",
        json={"chapterIds": [chapter_a.id, chapter_b.id, chapter_c.id], "status": "REVIEW"},
        headers=csrf,
    )
    assert response.status_code == 200
    body = response.json()
    assert set(body["updatedChapters"]) == {chapter_a.code, chapter_b.code}
    assert body["skippedChapters"] == [chapter_c.code]

    db_session.refresh(chapter_a)
    db_session.refresh(chapter_b)
    db_session.refresh(chapter_c)
    assert chapter_a.status == "REVIEW"
    assert chapter_b.status == "REVIEW"
    assert chapter_c.status == "PUBLISHED"  # untouched -- not a valid REVIEW source


def test_bulk_chapter_status_is_super_admin_only(client, db_session):
    _make_chapter(db_session, "bulkstatus04", status="DRAFT")
    _make_school_admin(db_session, "admin-bulkstatus04@example.com", "Bulk Status Test School")
    csrf = _login(client, "admin-bulkstatus04@example.com")

    response = client.post(
        "/api/curriculum-admin/chapters/bulk-status",
        json={"status": "REVIEW"},
        headers=csrf,
    )
    assert response.status_code == 403


# --- SchoolCurriculumMap ---------------------------------------------------


def test_admin_can_map_published_chapter_into_own_school(client, db_session):
    chapter, board_course = _make_chapter(db_session, "map01", status="PUBLISHED")
    _admin_user, school = _make_school_admin(db_session, "admin-map01@example.com", "Map Test School One")
    csrf = _login(client, "admin-map01@example.com")

    create_response = client.post(
        "/api/curriculum-admin/school-curriculum-maps",
        json={
            "boardCourseId": board_course.id,
            "chapterId": chapter.id,
            "className": "5",
            "sequence": 1,
        },
        headers=csrf,
    )
    assert create_response.status_code == 200
    body = create_response.json()
    assert body["schoolId"] == school.id
    assert "section" not in body
    mapping_id = body["id"]

    list_response = client.get("/api/curriculum-admin/school-curriculum-maps")
    assert list_response.status_code == 200
    assert len(list_response.json()["schoolCurriculumMaps"]) == 1

    dupe_response = client.post(
        "/api/curriculum-admin/school-curriculum-maps",
        json={"boardCourseId": board_course.id, "chapterId": chapter.id, "className": "5"},
        headers=csrf,
    )
    assert dupe_response.status_code == 409
    assert dupe_response.json()["detail"]["code"] == "ALREADY_MAPPED"

    reschedule_response = client.patch(
        f"/api/curriculum-admin/school-curriculum-maps/{mapping_id}",
        json={"plannedStartDate": "2026-09-01", "plannedEndDate": "2026-09-20"},
        headers=csrf,
    )
    assert reschedule_response.status_code == 200
    rescheduled = reschedule_response.json()
    assert rescheduled["plannedStartDate"] == "2026-09-01"
    assert rescheduled["plannedEndDate"] == "2026-09-20"

    delete_response = client.delete(f"/api/curriculum-admin/school-curriculum-maps/{mapping_id}", headers=csrf)
    assert delete_response.status_code == 200
    assert db_session.query(SchoolCurriculumMap).filter(SchoolCurriculumMap.id == mapping_id).first() is None


def test_teacher_can_read_but_not_write_own_school_curriculum_map(client, db_session):
    """20 Aug 2026, Phase 3 frontend: a teacher needs a read-only way to see
    which chapters are mapped into their own school's calendar, to pick
    something to assign practice from -- see
    _resolve_school_id_for_read's docstring in routes_curriculum_admin.py."""
    chapter, board_course = _make_chapter(db_session, "map20", status="PUBLISHED")
    admin_user, school = _make_school_admin(db_session, "admin-map20@example.com", "Map Test School Twenty")
    admin_csrf = _login(client, "admin-map20@example.com")
    create_response = client.post(
        "/api/curriculum-admin/school-curriculum-maps",
        json={"boardCourseId": board_course.id, "chapterId": chapter.id, "className": "5"},
        headers=admin_csrf,
    )
    assert create_response.status_code == 200

    teacher_user = User(
        full_name="Map Teacher", email="teacher-map20@example.com", password_hash=hash_password(PASSWORD), role="TEACHER",
    )
    db_session.add(teacher_user)
    db_session.flush()
    db_session.add(Teacher(user_id=teacher_user.id, school_id=school.id, teacher_code="TCH-MAP20"))
    db_session.commit()

    client.cookies.clear()
    _login(client, "teacher-map20@example.com")

    list_response = client.get("/api/curriculum-admin/school-curriculum-maps")
    assert list_response.status_code == 200
    [mapping] = list_response.json()["schoolCurriculumMaps"]
    assert mapping["chapterId"] == chapter.id
    assert mapping["chapterTitle"] == chapter.title
    assert mapping["chapterCode"] == chapter.code
    assert mapping["chapterStatus"] == "PUBLISHED"

    # Read-only: a teacher still can't create/reschedule/delete a mapping.
    write_response = client.post(
        "/api/curriculum-admin/school-curriculum-maps",
        json={"boardCourseId": board_course.id, "chapterId": chapter.id, "className": "6"},
        headers={"x-csrf-token": client.cookies.get("se_csrf")},
    )
    assert write_response.status_code == 403


def test_teacher_cannot_read_another_schools_curriculum_map(client, db_session):
    chapter, board_course = _make_chapter(db_session, "map21", status="PUBLISHED")
    _admin_user, school = _make_school_admin(db_session, "admin-map21@example.com", "Map Test School TwentyOne")
    admin_csrf = _login(client, "admin-map21@example.com")
    client.post(
        "/api/curriculum-admin/school-curriculum-maps",
        json={"boardCourseId": board_course.id, "chapterId": chapter.id, "className": "5"},
        headers=admin_csrf,
    )

    other_school = School(name="Map Test School TwentyOne Sibling", board="CBSE", city="Bengaluru")
    db_session.add(other_school)
    db_session.flush()
    teacher_user = User(
        full_name="Other Map Teacher", email="teacher-map21-other@example.com", password_hash=hash_password(PASSWORD), role="TEACHER",
    )
    db_session.add(teacher_user)
    db_session.flush()
    db_session.add(Teacher(user_id=teacher_user.id, school_id=other_school.id, teacher_code="TCH-MAP21"))
    db_session.commit()

    client.cookies.clear()
    _login(client, "teacher-map21-other@example.com")
    response = client.get(
        "/api/curriculum-admin/school-curriculum-maps", params={"schoolId": school.id}
    )
    assert response.status_code == 403


def test_admin_cannot_map_curriculum_for_another_school(client, db_session):
    chapter, board_course = _make_chapter(db_session, "map02", status="PUBLISHED")
    _make_school_admin(db_session, "admin-map02@example.com", "Map Test School Two")
    _, other_school = _make_school_admin(db_session, "admin-map02-other@example.com", "Map Test School Three")
    csrf = _login(client, "admin-map02@example.com")

    response = client.post(
        "/api/curriculum-admin/school-curriculum-maps",
        json={
            "schoolId": other_school.id,
            "boardCourseId": board_course.id,
            "chapterId": chapter.id,
            "className": "5",
        },
        headers=csrf,
    )
    assert response.status_code == 403


def test_cannot_map_unpublished_chapter(client, db_session):
    chapter, board_course = _make_chapter(db_session, "map03", status="DRAFT")
    _make_school_admin(db_session, "admin-map03@example.com", "Map Test School Four")
    csrf = _login(client, "admin-map03@example.com")

    response = client.post(
        "/api/curriculum-admin/school-curriculum-maps",
        json={"boardCourseId": board_course.id, "chapterId": chapter.id, "className": "5"},
        headers=csrf,
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "CHAPTER_NOT_PUBLISHED"


def test_super_admin_can_map_for_any_school_with_explicit_school_id(client, db_session):
    chapter, board_course = _make_chapter(db_session, "map04", status="PUBLISHED")
    school = School(name="Map Test School Five", board="CBSE", city="Bengaluru")
    db_session.add(school)
    db_session.commit()
    _make_super_admin(db_session, "sa-map04@example.com")
    csrf = _login(client, "sa-map04@example.com")

    response = client.post(
        "/api/curriculum-admin/school-curriculum-maps",
        json={
            "schoolId": school.id,
            "boardCourseId": board_course.id,
            "chapterId": chapter.id,
            "className": "5",
        },
        headers=csrf,
    )
    assert response.status_code == 200
    assert response.json()["schoolId"] == school.id


def test_super_admin_mapping_without_school_id_is_rejected(client, db_session):
    chapter, board_course = _make_chapter(db_session, "map05", status="PUBLISHED")
    _make_super_admin(db_session, "sa-map05@example.com")
    csrf = _login(client, "sa-map05@example.com")

    response = client.post(
        "/api/curriculum-admin/school-curriculum-maps",
        json={"boardCourseId": board_course.id, "chapterId": chapter.id, "className": "5"},
        headers=csrf,
    )
    assert response.status_code == 422


def test_admin_can_reschedule_mapping_without_deleting_it(client, db_session):
    """The actual fix for "schedules slip because of holidays, elections,
    festivals, ..." (19 Aug 2026) -- a PATCH updates dates/teacher in place
    instead of forcing a delete-and-recreate."""
    chapter, board_course = _make_chapter(db_session, "map06", status="PUBLISHED")
    _make_school_admin(db_session, "admin-map06@example.com", "Map Test School Six")
    csrf = _login(client, "admin-map06@example.com")

    create_response = client.post(
        "/api/curriculum-admin/school-curriculum-maps",
        json={
            "boardCourseId": board_course.id,
            "chapterId": chapter.id,
            "className": "6",
            "plannedStartDate": "2026-06-01",
            "plannedEndDate": "2026-06-15",
        },
        headers=csrf,
    )
    assert create_response.status_code == 200
    mapping_id = create_response.json()["id"]

    # Partial patch -- only plannedEndDate changes (e.g. exam week pushed the
    # end date out); everything else is left untouched.
    patch_response = client.patch(
        f"/api/curriculum-admin/school-curriculum-maps/{mapping_id}",
        json={"plannedEndDate": "2026-06-25"},
        headers=csrf,
    )
    assert patch_response.status_code == 200
    body = patch_response.json()
    assert body["plannedStartDate"] == "2026-06-01"
    assert body["plannedEndDate"] == "2026-06-25"

    # The mapping still exists as the same row (id unchanged), not recreated.
    list_response = client.get("/api/curriculum-admin/school-curriculum-maps")
    ids = [m["id"] for m in list_response.json()["schoolCurriculumMaps"]]
    assert ids.count(mapping_id) == 1


def test_admin_cannot_reschedule_mapping_for_another_school(client, db_session):
    chapter, board_course = _make_chapter(db_session, "map07", status="PUBLISHED")
    _make_school_admin(db_session, "admin-map07@example.com", "Map Test School Seven")
    csrf_a = _login(client, "admin-map07@example.com")
    create_response = client.post(
        "/api/curriculum-admin/school-curriculum-maps",
        json={"boardCourseId": board_course.id, "chapterId": chapter.id, "className": "7"},
        headers=csrf_a,
    )
    mapping_id = create_response.json()["id"]

    _make_school_admin(db_session, "admin-map07-other@example.com", "Map Test School Eight")
    csrf_b = _login(client, "admin-map07-other@example.com")
    response = client.patch(
        f"/api/curriculum-admin/school-curriculum-maps/{mapping_id}",
        json={"plannedEndDate": "2026-07-01"},
        headers=csrf_b,
    )
    assert response.status_code == 403


def test_list_boards_and_disciplines(client, db_session):
    """Powers the Board / Subject cascading filter dropdowns (19 Aug 2026)."""
    _make_chapter(db_session, "lookup01", status="PUBLISHED")  # ensures CBSE + Mathematics exist
    _make_school_admin(db_session, "admin-lookup01@example.com", "Lookup Test School")
    csrf = _login(client, "admin-lookup01@example.com")

    boards_response = client.get("/api/curriculum-admin/boards", headers=csrf)
    assert boards_response.status_code == 200
    boards = boards_response.json()["boards"]
    assert any(b["code"] == "CBSE" for b in boards)

    disciplines_response = client.get("/api/curriculum-admin/disciplines", headers=csrf)
    assert disciplines_response.status_code == 200
    disciplines = disciplines_response.json()["disciplines"]
    assert any(d["code"] == "MATHEMATICS" for d in disciplines)


def test_chapters_and_board_courses_filter_by_board_and_class(client, db_session):
    chapter, board_course = _make_chapter(db_session, "lookup02", status="PUBLISHED")
    _make_super_admin(db_session, "sa-lookup02@example.com")
    csrf = _login(client, "sa-lookup02@example.com")

    board = db_session.query(Board).filter(Board.code == "CBSE").first()
    class_level = db_session.query(ClassLevel).filter(ClassLevel.code == "5").first()

    chapters_response = client.get(
        "/api/curriculum-admin/chapters",
        params={"board_id": board.id, "class_level_id": class_level.id},
        headers=csrf,
    )
    assert chapters_response.status_code == 200
    assert any(c["id"] == chapter.id for c in chapters_response.json()["chapters"])

    # A different (nonexistent) class filters it out.
    empty_response = client.get(
        "/api/curriculum-admin/chapters",
        params={"board_id": board.id, "class_level_id": "not-a-real-class-level"},
        headers=csrf,
    )
    assert empty_response.status_code == 200
    assert empty_response.json()["chapters"] == []

    board_courses_response = client.get(
        "/api/curriculum-admin/board-courses",
        params={"board_id": board.id, "class_level_id": class_level.id},
        headers=csrf,
    )
    assert board_courses_response.status_code == 200
    assert any(bc["id"] == board_course.id for bc in board_courses_response.json()["boardCourses"])


# --- Chapter identity scoping (board_course + discipline + curriculum
# version + code -- 18 Aug 2026, fixes the latent "chapter codes restart
# every class" collision, see Chapter model docstring and migration
# 7b3d4c9a1f06) --------------------------------------------------------


def _make_class_6_board_course(db):
    """A second, distinct class -- deliberately reuses the SAME board and
    discipline as _get_or_create_board_course's Class 5 Mathematics, since
    the whole point of this scoping fix is that identical subject +
    identical chapter code ("CH01" etc, numbering restarts every class)
    must still not collide once the class differs."""
    board_course, discipline, curriculum_version = _get_or_create_board_course(db)
    board = db.query(Board).filter(Board.id == board_course.board_id).first()

    class_level = db.query(ClassLevel).filter(ClassLevel.code == "6").first()
    if not class_level:
        class_level = ClassLevel(code="6", display_name="Class 6", display_order=6)
        db.add(class_level)
        db.flush()

    class_6_course = (
        db.query(BoardCourse)
        .filter(
            BoardCourse.board_id == board.id,
            BoardCourse.class_level_id == class_level.id,
            BoardCourse.code == "MATHEMATICS",
        )
        .first()
    )
    if not class_6_course:
        class_6_course = BoardCourse(
            board_id=board.id, class_level_id=class_level.id, code="MATHEMATICS",
            display_name="Mathematics", status="DRAFT",
        )
        db.add(class_6_course)
        db.flush()
    db.commit()
    return class_6_course, discipline, curriculum_version


def test_same_chapter_code_across_different_classes_does_not_collide(db_session):
    """The actual bug this scoping fix closes: real chapter numbering
    restarts at CH01 every class, and before board_course_id was part of a
    chapter's identity, a second class's CH01 would have silently collided
    with an existing one's under the old (discipline_id, code) constraint."""
    class_5_course, discipline, curriculum_version = _get_or_create_board_course(db_session)
    class_6_course, _, _ = _make_class_6_board_course(db_session)

    class_5_ch01 = Chapter(
        discipline_id=discipline.id, board_course_id=class_5_course.id, curriculum_version_id=curriculum_version.id,
        code="CH-IDENTITY-01", chapter_no=1, title="Class 5 Chapter 1", status="DRAFT",
    )
    class_6_ch01 = Chapter(
        discipline_id=discipline.id, board_course_id=class_6_course.id, curriculum_version_id=curriculum_version.id,
        code="CH-IDENTITY-01", chapter_no=1, title="Class 6 Chapter 1", status="DRAFT",
    )
    db_session.add_all([class_5_ch01, class_6_ch01])
    db_session.commit()  # must not raise

    assert class_5_ch01.id != class_6_ch01.id


def test_true_duplicate_chapter_identity_is_rejected_at_db_level(db_session):
    """Same board_course + discipline + curriculum_version + code IS a real
    collision and must still be rejected -- this scoping fix widens what
    counts as a distinct chapter, it doesn't remove the uniqueness
    guarantee entirely."""
    board_course, discipline, curriculum_version = _get_or_create_board_course(db_session)
    first = Chapter(
        discipline_id=discipline.id, board_course_id=board_course.id, curriculum_version_id=curriculum_version.id,
        code="CH-IDENTITY-DUP", chapter_no=901, title="First", status="DRAFT",
    )
    db_session.add(first)
    db_session.commit()

    duplicate = Chapter(
        discipline_id=discipline.id, board_course_id=board_course.id, curriculum_version_id=curriculum_version.id,
        code="CH-IDENTITY-DUP", chapter_no=901, title="Duplicate", status="DRAFT",
    )
    db_session.add(duplicate)
    try:
        with pytest.raises(IntegrityError):
            db_session.commit()
    finally:
        db_session.rollback()


# --- CurriculumVersion (syllabus edition/year) management ------------------


def test_super_admin_can_list_create_and_publish_curriculum_version(client, db_session):
    board = db_session.query(Board).filter(Board.code == "CBSE").first()
    if not board:
        board = Board(code="CBSE", display_name="CBSE")
        db_session.add(board)
        db_session.commit()
    _make_super_admin(db_session, "sa-cv01@example.com")
    csrf = _login(client, "sa-cv01@example.com")

    create_response = client.post(
        "/api/curriculum-admin/curriculum-versions",
        json={"boardId": board.id, "code": "2027-28-cv01", "label": "2027-28 edition"},
        headers=csrf,
    )
    assert create_response.status_code == 200
    body = create_response.json()
    assert body["status"] == "DRAFT"
    version_id = body["id"]

    list_response = client.get("/api/curriculum-admin/curriculum-versions", params={"board_id": board.id})
    assert list_response.status_code == 200
    codes = [v["code"] for v in list_response.json()["curriculumVersions"]]
    assert "2027-28-cv01" in codes

    review_response = client.patch(
        f"/api/curriculum-admin/curriculum-versions/{version_id}/status", json={"status": "REVIEW"}, headers=csrf
    )
    assert review_response.status_code == 200
    publish_response = client.patch(
        f"/api/curriculum-admin/curriculum-versions/{version_id}/status", json={"status": "PUBLISHED"}, headers=csrf
    )
    assert publish_response.status_code == 200
    assert publish_response.json()["status"] == "PUBLISHED"

    bad_response = client.patch(
        f"/api/curriculum-admin/curriculum-versions/{version_id}/status", json={"status": "DRAFT"}, headers=csrf
    )
    assert bad_response.status_code == 409


def test_curriculum_version_creation_is_super_admin_only(client, db_session):
    board = db_session.query(Board).filter(Board.code == "CBSE").first()
    if not board:
        board = Board(code="CBSE", display_name="CBSE")
        db_session.add(board)
        db_session.commit()
    _make_school_admin(db_session, "admin-cv02@example.com", "CV Test School")
    csrf = _login(client, "admin-cv02@example.com")

    response = client.post(
        "/api/curriculum-admin/curriculum-versions",
        json={"boardId": board.id, "code": "2027-28-cv02", "label": "2027-28 edition"},
        headers=csrf,
    )
    assert response.status_code == 403

    # Read access is still fine for ADMIN.
    list_response = client.get("/api/curriculum-admin/curriculum-versions")
    assert list_response.status_code == 200


def test_school_admin_cannot_see_chapter_from_unpublished_curriculum_version(client, db_session):
    """A chapter can individually be status=PUBLISHED while its whole
    syllabus edition is still being prepared (DRAFT/REVIEW) ahead of a
    future rollout -- a school ADMIN must not see or map into it before the
    platform owner actually releases that edition, even though the chapter
    itself looks ready."""
    board_course, discipline, _ = _get_or_create_board_course(db_session)
    board = db_session.query(Board).filter(Board.id == board_course.board_id).first()
    draft_edition = CurriculumVersion(
        board_id=board.id, code="2028-29-unreleased", label="2028-29 (not yet released)", status="DRAFT",
    )
    db_session.add(draft_edition)
    db_session.flush()

    chapter = Chapter(
        discipline_id=discipline.id, board_course_id=board_course.id, curriculum_version_id=draft_edition.id,
        code="CH-ADMIN-futureed01", chapter_no=902, title="Future Edition Chapter", status="PUBLISHED",
    )
    db_session.add(chapter)
    db_session.commit()
    db_session.refresh(chapter)

    _make_school_admin(db_session, "admin-futureed01@example.com", "Future Edition Test School")
    _login(client, "admin-futureed01@example.com")

    list_response = client.get("/api/curriculum-admin/chapters")
    assert list_response.status_code == 200
    codes = [c["code"] for c in list_response.json()["chapters"]]
    assert "CH-ADMIN-futureed01" not in codes

    detail_response = client.get(f"/api/curriculum-admin/chapters/{chapter.id}")
    assert detail_response.status_code == 404


def test_chapter_summary_exposes_board_course_and_curriculum_version_ids(client, db_session):
    chapter, board_course = _make_chapter(db_session, "fields01", status="DRAFT")
    _make_super_admin(db_session, "sa-fields01@example.com")
    _login(client, "sa-fields01@example.com")

    response = client.get(f"/api/curriculum-admin/chapters/{chapter.id}")
    assert response.status_code == 200
    body = response.json()
    assert body["boardCourseId"] == board_course.id
    assert body["curriculumVersionId"] == chapter.curriculum_version_id
