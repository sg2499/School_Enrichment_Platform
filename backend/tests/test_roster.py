"""Proves the account-creation / roster endpoints (routes_roster.py):
SUPER_ADMIN creating ADMIN accounts, ADMIN creating TEACHER/STUDENT accounts
for their own school, the random initial-password scheme (A1 fix, 30 Sep
2026 review -- previously firstname-lastname), code generation, roster
listing/search, status (activate/deactivate), and the CSV bulk-import path.

Mirrors test_curriculum_admin.py's fixture/login pattern (2FA pre-enrolled,
CSRF token attached to every mutating request) rather than importing from
it, keeping this file self-contained the same way the other admin test
files are.
"""
import io

import pyotp

from app.core.security import hash_password, verify_password
from app.models import School, SchoolAdmin, Student, Teacher, User

PASSWORD = "Passw0rd1"
TEST_TOTP_SECRET = pyotp.random_base32()


def _make_super_admin(db, email: str) -> User:
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


# --- Single-entry creation -------------------------------------------------


def test_super_admin_creates_admin_for_existing_school(client, db_session):
    super_admin = _make_super_admin(db_session, "roster-sa1@example.com")
    school = School(name="Delhi Public School", board="CBSE", city="Delhi")
    db_session.add(school)
    db_session.commit()
    db_session.refresh(school)

    headers = _login(client, super_admin.email)
    response = client.post(
        "/api/roster/people",
        json={"role": "ADMIN", "fullName": "Priya Sharma", "email": "priya.sharma@dps.example.com", "schoolId": school.id},
        headers=headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "ADMIN"
    # A1 fix (30 Sep 2026 review): initial passwords are now random, not
    # derived from the name -- assert it's genuinely random/unguessable and
    # that it actually works, rather than a fixed expected string.
    assert body["initialPassword"] != "priya-sharma"
    assert len(body["initialPassword"]) >= 12
    assert body["code"] is None
    assert body["schoolId"] == school.id

    created = db_session.query(User).filter(User.email == "priya.sharma@dps.example.com").first()
    assert created is not None
    assert verify_password(body["initialPassword"], created.password_hash)
    assert created.must_change_password is True
    assert db_session.query(SchoolAdmin).filter(SchoolAdmin.user_id == created.id).first() is not None


def test_admin_cannot_create_admin_account(client, db_session):
    admin, school = _make_school_admin(db_session, "roster-admin1@example.com", "Green Valley School")
    headers = _login(client, admin.email)
    response = client.post(
        "/api/roster/people",
        json={"role": "ADMIN", "fullName": "Someone Else", "email": "someone@example.com", "schoolId": school.id},
        headers=headers,
    )
    assert response.status_code == 403


def test_admin_creates_teacher_with_generated_code_and_password(client, db_session):
    admin, school = _make_school_admin(db_session, "roster-admin2@example.com", "Oakwood School")
    headers = _login(client, admin.email)
    response = client.post(
        "/api/roster/people",
        json={"role": "TEACHER", "fullName": "Ravi Kumar", "designation": "TGT", "subjectSpecialization": "Mathematics"},
        headers=headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "TEACHER"
    # A1 fix: random initial password, not derived from the name.
    assert body["initialPassword"] != "ravi-kumar"
    assert len(body["initialPassword"]) >= 12
    assert body["code"].startswith("TCH-")
    assert body["schoolId"] == school.id

    teacher = db_session.query(Teacher).filter(Teacher.teacher_code == body["code"]).first()
    assert teacher is not None
    assert teacher.designation == "TGT"


def test_admin_creates_student_scoped_to_own_school(client, db_session):
    admin, school = _make_school_admin(db_session, "roster-admin3@example.com", "Riverside School")
    headers = _login(client, admin.email)
    response = client.post(
        "/api/roster/people",
        json={"role": "STUDENT", "fullName": "Ananya Rao", "className": "5", "section": "B"},
        headers=headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["code"].startswith("STU-")
    student = db_session.query(Student).filter(Student.student_code == body["code"]).first()
    assert student is not None
    assert student.school_id == school.id
    assert student.class_name == "5"
    assert student.section == "B"


def test_admin_cannot_create_for_another_school(client, db_session):
    admin, _own_school = _make_school_admin(db_session, "roster-admin4@example.com", "Hillcrest School")
    other_school = School(name="Other School", board="ICSE", city="Mumbai")
    db_session.add(other_school)
    db_session.commit()
    db_session.refresh(other_school)

    headers = _login(client, admin.email)
    response = client.post(
        "/api/roster/people",
        json={"role": "TEACHER", "fullName": "Cross School Teacher", "schoolId": other_school.id},
        headers=headers,
    )
    assert response.status_code == 403


def test_single_name_still_generates_a_random_password(client, db_session):
    """A1 fix (30 Sep 2026 review): this used to prove the firstname-lastname
    scheme's single-name fallback ("cher-cher"). The password is now fully
    random regardless of name shape -- this just proves a single-word name
    doesn't crash account creation and still produces a real, working,
    random password."""
    admin, _school = _make_school_admin(db_session, "roster-admin5@example.com", "Sunrise School")
    headers = _login(client, admin.email)
    response = client.post(
        "/api/roster/people",
        json={"role": "STUDENT", "fullName": "Cher"},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["initialPassword"] != "cher-cher"
    assert len(response.json()["initialPassword"]) >= 12


def test_duplicate_email_rejected(client, db_session):
    admin, _school = _make_school_admin(db_session, "roster-admin6@example.com", "Maple School")
    headers = _login(client, admin.email)
    payload = {"role": "TEACHER", "fullName": "Dup Teacher", "email": "dup-teacher@example.com"}
    first = client.post("/api/roster/people", json=payload, headers=headers)
    assert first.status_code == 200
    second = client.post("/api/roster/people", json=payload, headers=headers)
    assert second.status_code == 422


# --- Listing / search --------------------------------------------------


def test_admin_lists_own_school_roster_with_search(client, db_session):
    admin, _school = _make_school_admin(db_session, "roster-admin7@example.com", "Lakeside School")
    headers = _login(client, admin.email)
    client.post("/api/roster/people", json={"role": "TEACHER", "fullName": "Meera Nair"}, headers=headers)
    client.post("/api/roster/people", json={"role": "STUDENT", "fullName": "Arjun Iyer", "className": "6"}, headers=headers)

    all_people = client.get("/api/roster/people", headers=headers)
    assert all_people.status_code == 200
    names = {p["fullName"] for p in all_people.json()["people"]}
    assert {"Meera Nair", "Arjun Iyer"}.issubset(names)

    search = client.get("/api/roster/people", params={"search": "meera"}, headers=headers)
    assert [p["fullName"] for p in search.json()["people"]] == ["Meera Nair"]

    role_filtered = client.get("/api/roster/people", params={"role": "STUDENT"}, headers=headers)
    assert all(p["role"] == "STUDENT" for p in role_filtered.json()["people"])


def test_super_admin_without_school_id_sees_only_admins(client, db_session):
    super_admin = _make_super_admin(db_session, "roster-sa2@example.com")
    admin, school = _make_school_admin(db_session, "roster-admin8@example.com", "Cedar School")

    headers = _login(client, super_admin.email)
    response = client.get("/api/roster/people", headers=headers)
    assert response.status_code == 200
    people = response.json()["people"]
    assert all(p["role"] == "ADMIN" for p in people)
    assert any(p["email"] == admin.email for p in people)

    scoped = client.get("/api/roster/people", params={"schoolId": school.id, "role": "STUDENT"}, headers=headers)
    assert scoped.status_code == 200
    assert scoped.json()["people"] == []


# --- Status changes ------------------------------------------------------


def test_admin_deactivates_teacher_and_login_is_blocked(client, db_session):
    admin, _school = _make_school_admin(db_session, "roster-admin9@example.com", "Birchwood School")
    headers = _login(client, admin.email)
    create_response = client.post(
        "/api/roster/people",
        json={"role": "TEACHER", "fullName": "Deactivate Me", "email": "deactivate-me@example.com"},
        headers=headers,
    )
    person_id = create_response.json()["id"]
    # A1 fix: the initial password is random now, so it has to be read back
    # from the create response rather than assumed from the name.
    initial_password = create_response.json()["initialPassword"]

    status_response = client.patch(
        f"/api/roster/people/{person_id}/status", json={"isActive": False}, headers=headers
    )
    assert status_response.status_code == 200
    assert status_response.json()["isActive"] is False

    login_response = client.post(
        "/api/auth/login", json={"identifier": "deactivate-me@example.com", "password": initial_password}
    )
    assert login_response.status_code == 403
    assert login_response.json()["detail"]["code"] == "ACCOUNT_INACTIVE"


def test_admin_cannot_deactivate_admin_account(client, db_session):
    super_admin = _make_super_admin(db_session, "roster-sa3@example.com")
    admin, _school = _make_school_admin(db_session, "roster-admin10@example.com", "Fairview School")

    headers = _login(client, admin.email)
    response = client.patch(f"/api/roster/people/{super_admin.id}/status", json={"isActive": False}, headers=headers)
    assert response.status_code == 403


# --- Bulk import -----------------------------------------------------------


def test_bulk_csv_import_creates_students_and_reports_errors(client, db_session):
    admin, school = _make_school_admin(db_session, "roster-admin11@example.com", "Pinewood School")
    headers = _login(client, admin.email)

    csv_content = (
        "fullName,email,className,section\n"
        "Kabir Singh,kabir.singh@example.com,7,A\n"
        "Zara Khan,,7,B\n"
        ",missing-name@example.com,7,C\n"
    )
    files = {"file": ("roster.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    response = client.post(
        "/api/roster/people/bulk", data={"role": "STUDENT"}, files=files, headers=headers
    )
    assert response.status_code == 200
    body = response.json()
    assert body["created"] == 2
    assert body["attempted"] == 3
    statuses = {r["fullName"]: r["status"] for r in body["results"]}
    assert statuses["Kabir Singh"] == "created"
    assert statuses["Zara Khan"] == "created"
    assert statuses[""] == "skipped"

    # Created rows carry the one-time initial password (and login) so the
    # admin can actually hand bulk-created accounts off -- previously only
    # `code` was returned and the random password was lost.
    by_name = {r["fullName"]: r for r in body["results"]}
    kabir = by_name["Kabir Singh"]
    zara = by_name["Zara Khan"]
    for row in (kabir, zara):
        assert isinstance(row["initialPassword"], str)
        assert row["initialPassword"]
        assert len(row["initialPassword"]) >= 12
        assert row["code"].startswith("STU-")
    assert kabir["initialPassword"] != zara["initialPassword"]
    assert kabir["email"] == "kabir.singh@example.com"
    assert zara["email"] is None  # no email given -- the student code is the login
    skipped = by_name[""]
    assert "initialPassword" not in skipped
    assert "email" not in skipped

    students = db_session.query(Student).join(User, Student.user_id == User.id).filter(Student.school_id == school.id).all()
    assert len(students) == 2

    # The returned password is the real one: it verifies against the stored hash.
    kabir_user = db_session.query(User).filter(User.email == "kabir.singh@example.com").first()
    assert kabir_user is not None
    assert verify_password(kabir["initialPassword"], kabir_user.password_hash)
    assert kabir_user.must_change_password is True
    zara_student = db_session.query(Student).filter(Student.student_code == zara["code"]).first()
    assert zara_student is not None
    zara_user = db_session.get(User, zara_student.user_id)
    assert verify_password(zara["initialPassword"], zara_user.password_hash)


# --- Email enumeration (A14 remainder, 1 Oct 2026) ---------------------------


def _taken_emails(db_session, own_school: School, tag: str) -> dict[str, str]:
    """One registered address per place it could live: this school, another
    school (teacher and admin), and the platform super admin."""
    other_admin, other_school = _make_school_admin(db_session, f"enum-{tag}-other-admin@example.com", f"Other Enum School {tag}")
    super_admin = _make_super_admin(db_session, f"enum-{tag}-super-admin@example.com")

    def _person(email, role, school, profile):
        user = User(full_name=f"Existing {role}", email=email, password_hash=hash_password(PASSWORD), role=role)
        db_session.add(user)
        db_session.flush()
        db_session.add(profile(user, school))
        return email

    taken = {
        "own_school_student": _person(
            f"enum-{tag}-own-student@example.com", "STUDENT", own_school,
            lambda u, s: Student(user_id=u.id, school_id=s.id, student_code=f"STU-ENUM-{tag}", class_name="5", section="A"),
        ),
        "other_school_teacher": _person(
            f"enum-{tag}-other-teacher@example.com", "TEACHER", other_school,
            lambda u, s: Teacher(user_id=u.id, school_id=s.id, teacher_code=f"TCH-ENUM-{tag}"),
        ),
        "other_school_admin": other_admin.email,
        "super_admin": super_admin.email,
    }
    db_session.commit()
    return taken


def _audit_rows(db_session, event_type: str, user_id: str):
    from app.models import AuditLog

    return db_session.query(AuditLog).filter(AuditLog.event_type == event_type, AuditLog.user_id == user_id).all()


def test_taken_email_rejection_is_identical_wherever_the_email_lives(client, db_session, caplog):
    """The admin-facing response for a taken email is byte-identical whether
    the address belongs to someone in the caller's own school, another
    school's teacher or admin, or the super admin -- and never contains the
    address or says it exists. Before this fix it read "A user with email
    <address> already exists.", confirming existence platform-wide. No log
    line at any level carries the address either. A genuinely free address
    still creates the account normally."""
    import logging

    from app.api.routes_roster import EMAIL_NOT_ACCEPTED_MESSAGE

    admin, school = _make_school_admin(db_session, "enum-admin@example.com", "Enum School")
    taken = _taken_emails(db_session, school, "single")
    headers = _login(client, admin.email)
    users_before = db_session.query(User).count()

    caplog.set_level(logging.DEBUG)
    responses = {}
    for where, email in {**taken, "case_and_space_variant": "  ENUM-single-Other-Teacher@Example.com "}.items():
        response = client.post(
            "/api/roster/people", json={"role": "TEACHER", "fullName": "New Teacher", "email": email}, headers=headers,
        )
        assert response.status_code == 422, (where, response.text)
        body = response.json()
        responses[where] = (response.status_code, body)
        assert email.strip().lower() not in response.text.lower()
        assert "exist" not in body["detail"]["message"].lower()

    # One shape for all of them.
    assert len({repr(r) for r in responses.values()}) == 1
    _status, body = next(iter(responses.values()))
    assert body["detail"] == {"code": "VALIDATION_ERROR", "message": EMAIL_NOT_ACCEPTED_MESSAGE, "details": {}}

    # Nothing was created, and the address is in no log record or audit row.
    assert db_session.query(User).count() == users_before
    for email in taken.values():
        assert not any(email in record.getMessage() for record in caplog.records)
    rejections = _audit_rows(db_session, "roster.person_create_email_rejected", admin.id)
    assert len(rejections) == len(responses)
    for row in rejections:
        assert "@" not in (row.event_data_json or "")

    # A free address still works exactly as before.
    created = client.post(
        "/api/roster/people",
        json={"role": "TEACHER", "fullName": "Fresh Teacher", "email": "enum-fresh-teacher@example.com"},
        headers=headers,
    )
    assert created.status_code == 200, created.text
    assert created.json()["email"] == "enum-fresh-teacher@example.com"
    assert created.json()["initialPassword"]
    assert db_session.query(User).filter(User.email == "enum-fresh-teacher@example.com").count() == 1


def test_super_admin_creating_an_admin_gets_the_same_generic_rejection(client, db_session):
    """The ADMIN-account path (email mandatory, SUPER_ADMIN only) -- the one
    the review pointed at -- behaves the same way."""
    from app.api.routes_roster import EMAIL_NOT_ACCEPTED_MESSAGE

    super_admin = _make_super_admin(db_session, "enum-sa-caller@example.com")
    _, school = _make_school_admin(db_session, "enum-sa-school-admin@example.com", "Enum SA School")
    taken = _taken_emails(db_session, school, "sa")
    headers = _login(client, super_admin.email)

    bodies = []
    for email in (taken["other_school_teacher"], taken["other_school_admin"], taken["super_admin"]):
        response = client.post(
            "/api/roster/people",
            json={"role": "ADMIN", "fullName": "New Admin", "email": email, "schoolId": school.id},
            headers=headers,
        )
        assert response.status_code == 422
        assert email not in response.text
        bodies.append(response.json())
    assert all(b == bodies[0] for b in bodies)
    assert bodies[0]["detail"]["message"] == EMAIL_NOT_ACCEPTED_MESSAGE

    created = client.post(
        "/api/roster/people",
        json={"role": "ADMIN", "fullName": "Real New Admin", "email": "enum-real-new-admin@example.com", "schoolId": school.id},
        headers=headers,
    )
    assert created.status_code == 200, created.text
    assert created.json()["role"] == "ADMIN"


def test_bulk_import_never_echoes_a_taken_email_but_flags_in_file_duplicates(client, db_session):
    from app.api.routes_roster import EMAIL_NOT_ACCEPTED_MESSAGE

    admin, school = _make_school_admin(db_session, "enum-bulk-admin@example.com", "Enum Bulk School")
    taken = _taken_emails(db_session, school, "bulk")
    headers = _login(client, admin.email)

    csv_content = (
        "fullName,email,className,section\n"
        f"Taken Elsewhere,{taken['other_school_teacher']},7,A\n"
        "Free Student,enum-bulk-free@example.com,7,A\n"
        "Typed Twice,ENUM-BULK-FREE@example.com,7,B\n"
    )
    files = {"file": ("roster.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    response = client.post("/api/roster/people/bulk", data={"role": "STUDENT"}, files=files, headers=headers)
    assert response.status_code == 200, response.text
    assert taken["other_school_teacher"] not in response.text

    by_name = {r["fullName"]: r for r in response.json()["results"]}
    assert by_name["Taken Elsewhere"]["status"] == "skipped"
    assert by_name["Taken Elsewhere"]["error"] == EMAIL_NOT_ACCEPTED_MESSAGE
    assert by_name["Free Student"]["status"] == "created"
    assert by_name["Typed Twice"]["status"] == "skipped"
    assert by_name["Typed Twice"]["error"] == "This email address is already used on row 3 of this file."

    [bulk_audit] = _audit_rows(db_session, "roster.bulk_import", admin.id)
    assert '"emailRejected": 1' in bulk_audit.event_data_json
    assert "@" not in bulk_audit.event_data_json
