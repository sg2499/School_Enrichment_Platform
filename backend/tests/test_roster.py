"""Proves the account-creation / roster endpoints (routes_roster.py):
SUPER_ADMIN creating ADMIN accounts, ADMIN creating TEACHER/STUDENT accounts
for their own school, the firstname-lastname initial-password scheme, code
generation, roster listing/search, status (activate/deactivate), and the
CSV bulk-import path.

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
    assert body["initialPassword"] == "priya-sharma"
    assert body["code"] is None
    assert body["schoolId"] == school.id

    created = db_session.query(User).filter(User.email == "priya.sharma@dps.example.com").first()
    assert created is not None
    assert verify_password("priya-sharma", created.password_hash)
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
    assert body["initialPassword"] == "ravi-kumar"
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


def test_single_name_generates_repeated_password_half(client, db_session):
    admin, _school = _make_school_admin(db_session, "roster-admin5@example.com", "Sunrise School")
    headers = _login(client, admin.email)
    response = client.post(
        "/api/roster/people",
        json={"role": "STUDENT", "fullName": "Cher"},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["initialPassword"] == "cher-cher"


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
    admin, school = _make_school_admin(db_session, "roster-admin7@example.com", "Lakeside School")
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
    admin, school = _make_school_admin(db_session, "roster-admin9@example.com", "Birchwood School")
    headers = _login(client, admin.email)
    create_response = client.post(
        "/api/roster/people",
        json={"role": "TEACHER", "fullName": "Deactivate Me", "email": "deactivate-me@example.com"},
        headers=headers,
    )
    person_id = create_response.json()["id"]

    status_response = client.patch(
        f"/api/roster/people/{person_id}/status", json={"isActive": False}, headers=headers
    )
    assert status_response.status_code == 200
    assert status_response.json()["isActive"] is False

    login_response = client.post(
        "/api/auth/login", json={"identifier": "deactivate-me@example.com", "password": "deactivate-me"}
    )
    assert login_response.status_code == 403
    assert login_response.json()["detail"]["code"] == "ACCOUNT_INACTIVE"


def test_admin_cannot_deactivate_admin_account(client, db_session):
    super_admin = _make_super_admin(db_session, "roster-sa3@example.com")
    admin, school = _make_school_admin(db_session, "roster-admin10@example.com", "Fairview School")

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

    students = db_session.query(Student).join(User, Student.user_id == User.id).filter(Student.school_id == school.id).all()
    assert len(students) == 2
