"""Proves POST /api/platform/schools (routes_platform.py) actually works end
to end: it's the only way to create the first login for a new school, so
this is direct coverage of the Phase 1 exit gate, not just a unit test.

Each test uses its own unique admin email -- the test DB is an in-memory
SQLite instance shared across the whole session (see conftest.py), not reset
per test, so distinct emails avoid cross-test collisions the same way
test_auth.py already does.
"""
from app.models import School, SchoolAdmin, User

HEADERS = {"X-Platform-Key": "test-platform-operator-key"}


def _payload(email: str, school_name: str = "Green Valley Public School") -> dict:
    return {
        "schoolName": school_name,
        "board": "CBSE",
        "city": "Bengaluru",
        "adminFullName": "Ashalatha Gupta",
        "adminEmail": email,
        "adminPassword": "Passw0rd1",
    }


def test_provision_school_creates_school_and_admin(client, db_session):
    response = client.post("/api/platform/schools", json=_payload("admin-create@example.com"), headers=HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["school"]["name"] == "Green Valley Public School"
    assert body["admin"]["email"] == "admin-create@example.com"

    school = db_session.query(School).filter(School.id == body["school"]["id"]).first()
    assert school is not None
    admin_user = db_session.query(User).filter(User.id == body["admin"]["id"]).first()
    assert admin_user is not None
    assert admin_user.role == "ADMIN"
    school_admin = db_session.query(SchoolAdmin).filter(SchoolAdmin.user_id == admin_user.id).first()
    assert school_admin is not None
    assert school_admin.school_id == school.id


def test_provisioned_admin_can_actually_log_in(client):
    provision_response = client.post(
        "/api/platform/schools", json=_payload("admin-login-loop@example.com"), headers=HEADERS
    )
    assert provision_response.status_code == 200
    school_id = provision_response.json()["school"]["id"]

    login_response = client.post(
        "/api/auth/login", json={"identifier": "admin-login-loop@example.com", "password": "Passw0rd1"}
    )
    assert login_response.status_code == 200
    assert login_response.json()["user"]["role"] == "ADMIN"

    me_response = client.get("/api/auth/me")
    assert me_response.status_code == 200
    assert me_response.json()["admin"]["schoolId"] == school_id


def test_provision_rejects_missing_key(client):
    response = client.post("/api/platform/schools", json=_payload("admin-nokey@example.com"))
    assert response.status_code == 401


def test_provision_rejects_wrong_key(client):
    response = client.post(
        "/api/platform/schools", json=_payload("admin-wrongkey@example.com"), headers={"X-Platform-Key": "not-the-real-key"}
    )
    assert response.status_code == 401


def test_provision_rejects_weak_password(client):
    payload = _payload("admin-weakpw@example.com")
    payload["adminPassword"] = "short"
    response = client.post("/api/platform/schools", json=payload, headers=HEADERS)
    assert response.status_code == 422


def test_provision_rejects_duplicate_admin_email(client):
    first = client.post("/api/platform/schools", json=_payload("admin-dupe@example.com"), headers=HEADERS)
    assert first.status_code == 200

    second = client.post(
        "/api/platform/schools", json=_payload("admin-dupe@example.com", school_name="Another School"), headers=HEADERS
    )
    assert second.status_code == 409
