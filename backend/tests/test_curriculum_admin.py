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
from fastapi.testclient import TestClient

from app.core.security import hash_password
from app.models import (
    Board,
    BoardCourse,
    Chapter,
    ClassLevel,
    ConceptLesson,
    Discipline,
    Question,
    School,
    SchoolAdmin,
    SchoolCurriculumMap,
    SubjectGroup,
    User,
)

PASSWORD = "Passw0rd1"


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

    db.commit()
    return board_course, discipline


def _make_chapter(db, suffix: str, status: str = "DRAFT"):
    board_course, discipline = _get_or_create_board_course(db)
    chapter = Chapter(
        discipline_id=discipline.id,
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
    user = User(full_name="Platform Super Admin", email=email, password_hash=hash_password(PASSWORD), role="SUPER_ADMIN")
    db.add(user)
    db.commit()
    return user


def _make_school_admin(db, email: str, school_name: str):
    school = School(name=school_name, board="CBSE", city="Bengaluru")
    db.add(school)
    db.flush()
    user = User(full_name="School Admin", email=email, password_hash=hash_password(PASSWORD), role="ADMIN")
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
    """
    response = client.post("/api/auth/login", json={"identifier": email, "password": PASSWORD})
    assert response.status_code == 200
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
            "section": "A",
            "sequence": 1,
        },
        headers=csrf,
    )
    assert create_response.status_code == 200
    body = create_response.json()
    assert body["schoolId"] == school.id
    mapping_id = body["id"]

    list_response = client.get("/api/curriculum-admin/school-curriculum-maps")
    assert list_response.status_code == 200
    assert len(list_response.json()["schoolCurriculumMaps"]) == 1

    dupe_response = client.post(
        "/api/curriculum-admin/school-curriculum-maps",
        json={"boardCourseId": board_course.id, "chapterId": chapter.id, "className": "5", "section": "A"},
        headers=csrf,
    )
    assert dupe_response.status_code == 409
    assert dupe_response.json()["detail"]["code"] == "ALREADY_MAPPED"

    delete_response = client.delete(f"/api/curriculum-admin/school-curriculum-maps/{mapping_id}", headers=csrf)
    assert delete_response.status_code == 200
    assert db_session.query(SchoolCurriculumMap).filter(SchoolCurriculumMap.id == mapping_id).first() is None


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
            "section": "B",
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
        json={"boardCourseId": board_course.id, "chapterId": chapter.id, "className": "5", "section": "A"},
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
            "section": "A",
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
        json={"boardCourseId": board_course.id, "chapterId": chapter.id, "className": "5", "section": "A"},
        headers=csrf,
    )
    assert response.status_code == 422
