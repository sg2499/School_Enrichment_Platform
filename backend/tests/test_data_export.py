"""Proves the 2026-08-19 self-service "download my data" export
(GET /api/auth/me/export, app/services/auth_service.py's export_user_data())
-- Data Protection Task #61.
"""
from app.core.security import hash_password
from app.models import School, Student, Teacher, User

PASSWORD = "Xk4$nQ8vPz"


def _login_headers(client, email: str) -> dict:
    response = client.post("/api/auth/login", json={"identifier": email, "password": PASSWORD})
    assert response.status_code == 200
    return {"X-CSRF-Token": client.cookies.get("se_csrf")}


def test_teacher_export_includes_profile_and_no_secrets(client, db_session):
    school = School(name="Export Test School")
    db_session.add(school)
    db_session.flush()
    user = User(
        full_name="Export Teacher", email="export-teacher@example.com",
        password_hash=hash_password(PASSWORD), role="TEACHER",
    )
    db_session.add(user)
    db_session.flush()
    db_session.add(Teacher(user_id=user.id, school_id=school.id, teacher_code="TCH-EXPORT-1", designation="PGT"))
    db_session.commit()

    headers = _login_headers(client, "export-teacher@example.com")
    response = client.get("/api/auth/me/export", headers=headers)
    assert response.status_code == 200
    data = response.json()

    assert data["account"]["email"] == "export-teacher@example.com"
    assert data["teacherProfile"]["teacherCode"] == "TCH-EXPORT-1"
    assert data["teacherProfile"]["schoolName"] == "Export Test School"
    assert "studentProfile" not in data
    assert "passwordHash" not in data["account"]
    assert "totpSecret" not in data["account"]
    assert isinstance(data["loginSessions"], list) and len(data["loginSessions"]) >= 1
    assert isinstance(data["accountActivity"], list)


def test_student_export_includes_parent_contact_fields(client, db_session):
    school = School(name="Export Test School 2")
    db_session.add(school)
    db_session.flush()
    user = User(
        full_name="Export Student", email="export-student@example.com",
        password_hash=hash_password(PASSWORD), role="STUDENT",
    )
    db_session.add(user)
    db_session.flush()
    db_session.add(Student(
        user_id=user.id, school_id=school.id, student_code="STU-EXPORT-1",
        father_name="Export Father", mother_mobile="9999999999",
    ))
    db_session.commit()

    headers = _login_headers(client, "export-student@example.com")
    response = client.get("/api/auth/me/export", headers=headers)
    assert response.status_code == 200
    data = response.json()

    assert data["studentProfile"]["studentCode"] == "STU-EXPORT-1"
    assert data["studentProfile"]["fatherName"] == "Export Father"
    assert data["studentProfile"]["motherMobile"] == "9999999999"


def test_export_only_ever_returns_the_caller_s_own_data(client, db_session):
    school = School(name="Export Isolation School")
    db_session.add(school)
    db_session.flush()
    user_a = User(full_name="A", email="export-iso-a@example.com", password_hash=hash_password(PASSWORD), role="TEACHER")
    user_b = User(full_name="B", email="export-iso-b@example.com", password_hash=hash_password(PASSWORD), role="TEACHER")
    db_session.add_all([user_a, user_b])
    db_session.flush()
    db_session.add(Teacher(user_id=user_a.id, school_id=school.id, teacher_code="TCH-ISO-A"))
    db_session.add(Teacher(user_id=user_b.id, school_id=school.id, teacher_code="TCH-ISO-B"))
    db_session.commit()

    headers_a = _login_headers(client, "export-iso-a@example.com")
    data_a = client.get("/api/auth/me/export", headers=headers_a).json()
    assert data_a["teacherProfile"]["teacherCode"] == "TCH-ISO-A"
    assert data_a["account"]["email"] == "export-iso-a@example.com"
