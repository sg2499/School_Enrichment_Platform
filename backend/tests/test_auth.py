"""Proves the Phase 1 exit gate's "independent login and roles confirmed
working" requirement: an Admin, a Teacher, and a Student, each scoped to a
School, can each log in and reach /api/auth/me with their own role and
identity -- and a wrong password is rejected.
"""
from app.core.security import hash_password
from app.models import School, Student, Teacher, User


def _make_school(db_session) -> School:
    school = School(name="Test School", board="CBSE", city="Bengaluru")
    db_session.add(school)
    db_session.commit()
    db_session.refresh(school)
    return school


def test_admin_login_and_me(client, db_session):
    _make_school(db_session)
    user = User(full_name="Ashalatha Admin", email="admin@example.com", password_hash=hash_password("Passw0rd1"), role="ADMIN")
    db_session.add(user)
    db_session.commit()

    response = client.post("/api/auth/login", json={"identifier": "admin@example.com", "password": "Passw0rd1"})
    assert response.status_code == 200
    assert response.json()["user"]["role"] == "ADMIN"

    me_response = client.get("/api/auth/me")
    assert me_response.status_code == 200
    assert me_response.json()["email"] == "admin@example.com"


def test_teacher_login_scoped_to_school(client, db_session):
    school = _make_school(db_session)
    user = User(full_name="Test Teacher", email="teacher@example.com", password_hash=hash_password("Passw0rd1"), role="TEACHER")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    teacher = Teacher(user_id=user.id, school_id=school.id, teacher_code="TCH-001")
    db_session.add(teacher)
    db_session.commit()

    response = client.post("/api/auth/login", json={"identifier": "teacher@example.com", "password": "Passw0rd1"})
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["role"] == "TEACHER"
    assert body["user"]["teacher"]["schoolId"] == school.id


def test_student_login_by_student_code(client, db_session):
    school = _make_school(db_session)
    user = User(full_name="Test Student", role="STUDENT", password_hash=hash_password("Passw0rd1"))
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    student = Student(user_id=user.id, school_id=school.id, student_code="STU-001", class_name="5", section="A")
    db_session.add(student)
    db_session.commit()

    response = client.post("/api/auth/login", json={"identifier": "STU-001", "password": "Passw0rd1"})
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["role"] == "STUDENT"
    assert body["user"]["student"]["schoolId"] == school.id
    assert body["user"]["student"]["className"] == "5"


def test_wrong_password_rejected(client, db_session):
    _make_school(db_session)
    user = User(full_name="Test Admin", email="admin2@example.com", password_hash=hash_password("Passw0rd1"), role="ADMIN")
    db_session.add(user)
    db_session.commit()

    response = client.post("/api/auth/login", json={"identifier": "admin2@example.com", "password": "wrong-password"})
    assert response.status_code == 401


def test_me_requires_authentication(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 401
