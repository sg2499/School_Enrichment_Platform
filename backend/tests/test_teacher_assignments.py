"""Proves Phase 0 of the Practice Overview redesign
(routes_teacher_assignments.py / teacher_assignment_service.py): admin-only
assign/transfer of a teacher to a (class_level, section, board_course),
that a section can't be double-assigned while active, that a teacher's own
`/my-sections` reflects only what's currently active, and the two access-
scope helpers a future Practice Tracker will gate reads/writes with --
teacher_may_currently_act_on (current-only) and teacher_may_read_record
(any window the teacher ever held, matching Shailesh's 20 Aug 2026 answer
that an outgoing teacher keeps read access to what happened on their watch
but not to anything created after the handover).

Mirrors test_learning.py's/test_curriculum_admin.py's fixture and login
pattern (2FA pre-enrolled for ADMIN/SUPER_ADMIN, CSRF token on every
mutating request, unique suffixes since the test DB isn't reset per test).
"""
from datetime import date, datetime, timedelta, timezone

import pyotp

from app.core.security import hash_password
from app.models import Board, BoardCourse, ClassLevel, School, SchoolAdmin, Teacher, User
from app.services import teacher_assignment_service

PASSWORD = "Passw0rd1"
TEST_TOTP_SECRET = pyotp.random_base32()


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
    board_course = BoardCourse(
        board_id=board.id, class_level_id=class_level.id, code=f"MATH-{suffix}", display_name="Mathematics",
        status="PUBLISHED",
    )
    db.add(board_course)
    db.commit()
    return board_course, class_level


def _make_school(db, suffix: str) -> School:
    school = School(name=f"Test School {suffix}", board="CBSE", city="Bengaluru")
    db.add(school)
    db.flush()
    return school


def _make_teacher(db, school: School, suffix: str) -> Teacher:
    user = User(full_name=f"Teacher {suffix}", email=f"tsa-teacher-{suffix}@example.com", password_hash=hash_password(PASSWORD), role="TEACHER")
    db.add(user)
    db.flush()
    teacher = Teacher(user_id=user.id, school_id=school.id, teacher_code=f"TSA-TCH-{suffix}")
    db.add(teacher)
    db.commit()
    return teacher


def _make_school_admin(db, school: School, suffix: str) -> User:
    user = User(
        full_name=f"Admin {suffix}", email=f"tsa-admin-{suffix}@example.com", password_hash=hash_password(PASSWORD),
        role="ADMIN", totp_enabled=True, totp_secret=TEST_TOTP_SECRET,
    )
    db.add(user)
    db.flush()
    db.add(SchoolAdmin(user_id=user.id, school_id=school.id))
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


# --- assign ----------------------------------------------------------------


def test_admin_can_assign_teacher_to_section(client, db_session):
    school = _make_school(db_session, "assign1")
    teacher = _make_teacher(db_session, school, "assign1")
    board_course, class_level = _get_or_create_board_course(db_session, "assign1")
    admin = _make_school_admin(db_session, school, "assign1")
    headers = _login(client, admin.email)

    response = client.post(
        "/api/teacher-assignments",
        json={
            "teacherId": teacher.id,
            "classLevelId": class_level.id,
            "section": "A",
            "boardCourseId": board_course.id,
            "startDate": "2026-04-01",
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["teacherId"] == teacher.id
    assert body["section"] == "A"
    assert body["isCurrent"] is True
    assert body["endDate"] is None


def test_assign_conflicts_when_section_already_has_an_active_teacher(client, db_session):
    school = _make_school(db_session, "assign2")
    teacher_a = _make_teacher(db_session, school, "assign2a")
    teacher_b = _make_teacher(db_session, school, "assign2b")
    board_course, class_level = _get_or_create_board_course(db_session, "assign2")
    admin = _make_school_admin(db_session, school, "assign2")
    headers = _login(client, admin.email)

    payload = {
        "classLevelId": class_level.id,
        "section": "B",
        "boardCourseId": board_course.id,
        "startDate": "2026-04-01",
    }
    first = client.post("/api/teacher-assignments", json={**payload, "teacherId": teacher_a.id}, headers=headers)
    assert first.status_code == 200, first.text

    second = client.post("/api/teacher-assignments", json={**payload, "teacherId": teacher_b.id}, headers=headers)
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "SECTION_ALREADY_ASSIGNED"


def test_teacher_cannot_assign_or_transfer(client, db_session):
    school = _make_school(db_session, "assign3")
    teacher = _make_teacher(db_session, school, "assign3")
    board_course, class_level = _get_or_create_board_course(db_session, "assign3")
    user = User(full_name="Plain Teacher", email="tsa-plain-assign3@example.com", password_hash=hash_password(PASSWORD), role="TEACHER")
    db_session.add(user)
    db_session.flush()
    plain_teacher = Teacher(user_id=user.id, school_id=school.id, teacher_code="TSA-PLAIN-3")
    db_session.add(plain_teacher)
    db_session.commit()
    headers = _login(client, "tsa-plain-assign3@example.com")

    response = client.post(
        "/api/teacher-assignments",
        json={
            "teacherId": teacher.id,
            "classLevelId": class_level.id,
            "section": "C",
            "boardCourseId": board_course.id,
            "startDate": "2026-04-01",
        },
        headers=headers,
    )
    assert response.status_code == 403


def test_admin_cannot_assign_into_another_schools_section(client, db_session):
    school_a = _make_school(db_session, "assign4a")
    school_b = _make_school(db_session, "assign4b")
    teacher_b = _make_teacher(db_session, school_b, "assign4b")
    board_course, class_level = _get_or_create_board_course(db_session, "assign4")
    admin_a = _make_school_admin(db_session, school_a, "assign4")
    headers = _login(client, admin_a.email)

    response = client.post(
        "/api/teacher-assignments",
        json={
            "schoolId": school_b.id,
            "teacherId": teacher_b.id,
            "classLevelId": class_level.id,
            "section": "D",
            "boardCourseId": board_course.id,
            "startDate": "2026-04-01",
        },
        headers=headers,
    )
    assert response.status_code == 403


# --- transfer ----------------------------------------------------------------


def test_admin_can_transfer_and_history_is_preserved(client, db_session):
    school = _make_school(db_session, "xfer1")
    teacher_old = _make_teacher(db_session, school, "xfer1old")
    teacher_new = _make_teacher(db_session, school, "xfer1new")
    board_course, class_level = _get_or_create_board_course(db_session, "xfer1")
    admin = _make_school_admin(db_session, school, "xfer1")
    headers = _login(client, admin.email)

    assign_response = client.post(
        "/api/teacher-assignments",
        json={
            "teacherId": teacher_old.id,
            "classLevelId": class_level.id,
            "section": "E",
            "boardCourseId": board_course.id,
            "startDate": "2026-04-01",
        },
        headers=headers,
    )
    assignment_id = assign_response.json()["id"]

    transfer_response = client.post(
        f"/api/teacher-assignments/{assignment_id}/transfer",
        json={"newTeacherId": teacher_new.id, "transferDate": "2026-08-20"},
        headers=headers,
    )
    assert transfer_response.status_code == 200, transfer_response.text
    body = transfer_response.json()
    assert body["endedAssignment"]["endDate"] == "2026-08-20"
    assert body["endedAssignment"]["isCurrent"] is False
    assert body["newAssignment"]["teacherId"] == teacher_new.id
    assert body["newAssignment"]["startDate"] == "2026-08-20"
    assert body["newAssignment"]["isCurrent"] is True

    # Only the new teacher shows up as "current" for the section.
    listing = client.get(
        "/api/teacher-assignments",
        params={"classLevelId": class_level.id, "section": "E", "boardCourseId": board_course.id},
        headers=headers,
    )
    current_teacher_ids = {row["teacherId"] for row in listing.json()["assignments"]}
    assert current_teacher_ids == {teacher_new.id}

    # Both rows still show up with includeEnded=true, i.e. history isn't lost.
    full_history = client.get(
        "/api/teacher-assignments",
        params={"classLevelId": class_level.id, "section": "E", "boardCourseId": board_course.id, "includeEnded": True},
        headers=headers,
    )
    all_teacher_ids = {row["teacherId"] for row in full_history.json()["assignments"]}
    assert all_teacher_ids == {teacher_old.id, teacher_new.id}


def test_transfer_rejects_date_before_assignment_start(client, db_session):
    school = _make_school(db_session, "xfer2")
    teacher_old = _make_teacher(db_session, school, "xfer2old")
    teacher_new = _make_teacher(db_session, school, "xfer2new")
    board_course, class_level = _get_or_create_board_course(db_session, "xfer2")
    admin = _make_school_admin(db_session, school, "xfer2")
    headers = _login(client, admin.email)

    assign_response = client.post(
        "/api/teacher-assignments",
        json={
            "teacherId": teacher_old.id,
            "classLevelId": class_level.id,
            "section": "F",
            "boardCourseId": board_course.id,
            "startDate": "2026-08-01",
        },
        headers=headers,
    )
    assignment_id = assign_response.json()["id"]

    response = client.post(
        f"/api/teacher-assignments/{assignment_id}/transfer",
        json={"newTeacherId": teacher_new.id, "transferDate": "2026-07-01"},
        headers=headers,
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_TRANSFER_DATE"


def test_transfer_rejects_future_date(client, db_session):
    school = _make_school(db_session, "xfer3")
    teacher_old = _make_teacher(db_session, school, "xfer3old")
    teacher_new = _make_teacher(db_session, school, "xfer3new")
    board_course, class_level = _get_or_create_board_course(db_session, "xfer3")
    admin = _make_school_admin(db_session, school, "xfer3")
    headers = _login(client, admin.email)

    assign_response = client.post(
        "/api/teacher-assignments",
        json={
            "teacherId": teacher_old.id,
            "classLevelId": class_level.id,
            "section": "G",
            "boardCourseId": board_course.id,
            "startDate": "2026-04-01",
        },
        headers=headers,
    )
    assignment_id = assign_response.json()["id"]

    far_future = (date.today() + timedelta(days=30)).isoformat()
    response = client.post(
        f"/api/teacher-assignments/{assignment_id}/transfer",
        json={"newTeacherId": teacher_new.id, "transferDate": far_future},
        headers=headers,
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_TRANSFER_DATE"


def test_transferring_an_already_ended_assignment_fails(client, db_session):
    school = _make_school(db_session, "xfer4")
    teacher_a = _make_teacher(db_session, school, "xfer4a")
    teacher_b = _make_teacher(db_session, school, "xfer4b")
    teacher_c = _make_teacher(db_session, school, "xfer4c")
    board_course, class_level = _get_or_create_board_course(db_session, "xfer4")
    admin = _make_school_admin(db_session, school, "xfer4")
    headers = _login(client, admin.email)

    assign_response = client.post(
        "/api/teacher-assignments",
        json={
            "teacherId": teacher_a.id,
            "classLevelId": class_level.id,
            "section": "H",
            "boardCourseId": board_course.id,
            "startDate": "2026-04-01",
        },
        headers=headers,
    )
    assignment_id = assign_response.json()["id"]
    first_transfer = client.post(
        f"/api/teacher-assignments/{assignment_id}/transfer",
        json={"newTeacherId": teacher_b.id, "transferDate": "2026-08-01"},
        headers=headers,
    )
    assert first_transfer.status_code == 200

    second_transfer = client.post(
        f"/api/teacher-assignments/{assignment_id}/transfer",
        json={"newTeacherId": teacher_c.id, "transferDate": "2026-08-15"},
        headers=headers,
    )
    assert second_transfer.status_code == 409
    assert second_transfer.json()["detail"]["code"] == "ASSIGNMENT_ALREADY_ENDED"


# --- teacher's own "my sections" -------------------------------------------


def test_teacher_my_sections_shows_only_current_assignments(client, db_session):
    school = _make_school(db_session, "mysec1")
    teacher_old = _make_teacher(db_session, school, "mysec1old")
    teacher_new = _make_teacher(db_session, school, "mysec1new")
    board_course, class_level = _get_or_create_board_course(db_session, "mysec1")
    admin = _make_school_admin(db_session, school, "mysec1")
    admin_headers = _login(client, admin.email)

    assign_response = client.post(
        "/api/teacher-assignments",
        json={
            "teacherId": teacher_old.id,
            "classLevelId": class_level.id,
            "section": "I",
            "boardCourseId": board_course.id,
            "startDate": "2026-04-01",
        },
        headers=admin_headers,
    )
    assignment_id = assign_response.json()["id"]
    client.post(
        f"/api/teacher-assignments/{assignment_id}/transfer",
        json={"newTeacherId": teacher_new.id, "transferDate": "2026-08-20"},
        headers=admin_headers,
    )

    # The admin's own session cookie is still sitting in the jar alongside
    # whichever teacher just logged in (cookies.py: each role gets its own
    # cookie precisely so more than one can be signed in at once) -- the
    # x-auth-role header disambiguates which one a request means, the same
    # way a real multi-tab browser session would via cookies.py's own
    # per-role cookie split.
    old_headers = {**_login(client, teacher_old.user.email), "x-auth-role": "TEACHER"}
    old_sections = client.get("/api/teacher-assignments/my-sections", headers=old_headers)
    assert old_sections.status_code == 200, old_sections.text
    assert old_sections.json()["sections"] == []

    db_session.refresh(teacher_new)
    new_headers = {**_login(client, teacher_new.user.email), "x-auth-role": "TEACHER"}
    new_sections = client.get("/api/teacher-assignments/my-sections", headers=new_headers)
    assert new_sections.status_code == 200, new_sections.text
    sections = new_sections.json()["sections"]
    assert len(sections) == 1
    assert sections[0]["section"] == "I"
    assert sections[0]["isCurrent"] is True


# --- access-scope service helpers (used by the future Practice Tracker) ---


def test_teacher_may_currently_act_on_is_true_only_for_the_current_teacher(db_session):
    school = _make_school(db_session, "scope1")
    teacher_old = _make_teacher(db_session, school, "scope1old")
    teacher_new = _make_teacher(db_session, school, "scope1new")
    board_course, class_level = _get_or_create_board_course(db_session, "scope1")

    assignment = teacher_assignment_service.assign_teacher_to_section(
        db_session, school_id=school.id, teacher_id=teacher_old.id, class_level_id=class_level.id,
        section="J", board_course_id=board_course.id, start_date=date(2026, 4, 1), admin_user_id=None,
    )
    db_session.commit()

    kwargs = {"class_level_id": class_level.id, "section": "J", "board_course_id": board_course.id}
    assert teacher_assignment_service.teacher_may_currently_act_on(db_session, teacher_id=teacher_old.id, **kwargs)
    assert not teacher_assignment_service.teacher_may_currently_act_on(db_session, teacher_id=teacher_new.id, **kwargs)

    teacher_assignment_service.transfer_teacher(
        db_session, assignment=assignment, new_teacher_id=teacher_new.id,
        transfer_date=date(2026, 8, 20), admin_user_id=None,
    )
    db_session.commit()

    # After the handover, control has moved: the outgoing teacher can no
    # longer act, only the incoming one can.
    assert not teacher_assignment_service.teacher_may_currently_act_on(db_session, teacher_id=teacher_old.id, **kwargs)
    assert teacher_assignment_service.teacher_may_currently_act_on(db_session, teacher_id=teacher_new.id, **kwargs)


def test_teacher_may_read_record_is_windowed_by_who_was_responsible_when(db_session):
    school = _make_school(db_session, "scope2")
    teacher_old = _make_teacher(db_session, school, "scope2old")
    teacher_new = _make_teacher(db_session, school, "scope2new")
    board_course, class_level = _get_or_create_board_course(db_session, "scope2")

    assignment = teacher_assignment_service.assign_teacher_to_section(
        db_session, school_id=school.id, teacher_id=teacher_old.id, class_level_id=class_level.id,
        section="K", board_course_id=board_course.id, start_date=date(2026, 4, 1), admin_user_id=None,
    )
    db_session.commit()
    teacher_assignment_service.transfer_teacher(
        db_session, assignment=assignment, new_teacher_id=teacher_new.id,
        transfer_date=date(2026, 8, 20), admin_user_id=None,
    )
    db_session.commit()

    kwargs = {"class_level_id": class_level.id, "section": "K", "board_course_id": board_course.id}
    before_handover = datetime(2026, 6, 1, tzinfo=timezone.utc)
    after_handover = datetime(2026, 9, 1, tzinfo=timezone.utc)

    # The outgoing teacher keeps read access to what happened on their
    # watch (Shailesh, 20 Aug 2026) -- but nothing created after they were
    # transferred off the section.
    assert teacher_assignment_service.teacher_may_read_record(
        db_session, teacher_id=teacher_old.id, record_created_at=before_handover, **kwargs
    )
    assert not teacher_assignment_service.teacher_may_read_record(
        db_session, teacher_id=teacher_old.id, record_created_at=after_handover, **kwargs
    )

    # The incoming teacher sees only what was created from their own start
    # date forward, not the predecessor's period.
    assert not teacher_assignment_service.teacher_may_read_record(
        db_session, teacher_id=teacher_new.id, record_created_at=before_handover, **kwargs
    )
    assert teacher_assignment_service.teacher_may_read_record(
        db_session, teacher_id=teacher_new.id, record_created_at=after_handover, **kwargs
    )
