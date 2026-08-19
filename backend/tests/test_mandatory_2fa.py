"""Proves the 2026-08-19 security hardening's mandatory-2FA requirement for
ADMIN/SUPER_ADMIN (Shailesh: "Yes, mandatory for both"):

- An ADMIN/SUPER_ADMIN account without 2FA enabled can reach only the small
  allowlist of setup-related endpoints (dependencies.py's
  TWO_FACTOR_SETUP_REQUIRED check) and is blocked from everything else.
- The full setup -> enable -> backup-codes flow actually lifts that block.
- 2FA cannot be self-service disabled for these roles (routes_auth.py's
  TWO_FACTOR_MANDATORY check).
- The login-time challenge/verify-login round trip works end to end,
  including a backup code being consumable exactly once.
- TEACHER/STUDENT are unaffected -- 2FA is not mandatory for them.
"""
import pyotp
import pytest

from app.core.security import hash_password
from app.models import School, SchoolAdmin, Student, Teacher, User

PASSWORD = "Passw0rd1"


def _make_school(db) -> School:
    school = School(name="Mandatory 2FA Test School", board="CBSE", city="Bengaluru")
    db.add(school)
    db.commit()
    db.refresh(school)
    return school


def _make_admin(db, email: str, school: School) -> User:
    user = User(full_name="Unenrolled Admin", email=email, password_hash=hash_password(PASSWORD), role="ADMIN")
    db.add(user)
    db.flush()
    db.add(SchoolAdmin(user_id=user.id, school_id=school.id))
    db.commit()
    db.refresh(user)
    return user


def _make_super_admin(db, email: str) -> User:
    user = User(full_name="Unenrolled Super Admin", email=email, password_hash=hash_password(PASSWORD), role="SUPER_ADMIN")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _login(client, email: str) -> dict:
    response = client.post("/api/auth/login", json={"identifier": email, "password": PASSWORD})
    assert response.status_code == 200
    csrf_token = client.cookies.get("se_csrf")
    assert csrf_token
    return {"x-csrf-token": csrf_token}


def test_admin_without_2fa_is_blocked_from_protected_endpoint(client, db_session):
    school = _make_school(db_session)
    _make_admin(db_session, "unenrolled-admin@example.com", school)
    _login(client, "unenrolled-admin@example.com")

    response = client.get("/api/curriculum-admin/board-courses")
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "TWO_FACTOR_SETUP_REQUIRED"


def test_admin_without_2fa_can_still_reach_setup_allowlist(client, db_session):
    school = _make_school(db_session)
    _make_admin(db_session, "setup-path-admin@example.com", school)
    headers = _login(client, "setup-path-admin@example.com")

    me_response = client.get("/api/auth/me")
    assert me_response.status_code == 200
    assert me_response.json()["twoFactorEnabled"] is False

    setup_response = client.post("/api/auth/2fa/setup", headers=headers)
    assert setup_response.status_code == 200
    assert "qrCodeDataUrl" in setup_response.json()

    logout_response = client.post("/api/auth/logout", headers=headers)
    assert logout_response.status_code == 200


def test_full_setup_flow_unlocks_protected_endpoints(client, db_session):
    school = _make_school(db_session)
    _make_admin(db_session, "full-flow-admin@example.com", school)
    headers = _login(client, "full-flow-admin@example.com")

    # Blocked before setup.
    assert client.get("/api/curriculum-admin/board-courses").status_code == 403

    setup_response = client.post("/api/auth/2fa/setup", headers=headers)
    assert setup_response.status_code == 200
    secret = setup_response.json()["secret"]

    valid_code = pyotp.TOTP(secret).now()
    enable_response = client.post("/api/auth/2fa/enable", json={"code": valid_code}, headers=headers)
    assert enable_response.status_code == 200
    backup_codes = enable_response.json()["backupCodes"]
    assert len(backup_codes) == 10

    # Unlocked after setup, same session, no new login required.
    unlocked_response = client.get("/api/curriculum-admin/board-courses", headers=headers)
    assert unlocked_response.status_code == 200

    me_response = client.get("/api/auth/me")
    assert me_response.json()["twoFactorEnabled"] is True


def test_2fa_cannot_be_disabled_for_mandatory_role(client, db_session):
    school = _make_school(db_session)
    user = _make_admin(db_session, "disable-attempt-admin@example.com", school)
    headers = _login(client, "disable-attempt-admin@example.com")

    setup_response = client.post("/api/auth/2fa/setup", headers=headers)
    secret = setup_response.json()["secret"]
    client.post("/api/auth/2fa/enable", json={"code": pyotp.TOTP(secret).now()}, headers=headers)

    disable_response = client.post("/api/auth/2fa/disable", json={"password": PASSWORD}, headers=headers)
    assert disable_response.status_code == 400
    assert disable_response.json()["detail"]["code"] == "TWO_FACTOR_MANDATORY"

    db_session.refresh(user)
    assert user.totp_enabled is True


def test_login_challenge_and_verify_login_round_trip(client, db_session):
    school = _make_school(db_session)
    _make_admin(db_session, "challenge-admin@example.com", school)
    headers = _login(client, "challenge-admin@example.com")
    setup_response = client.post("/api/auth/2fa/setup", headers=headers)
    secret = setup_response.json()["secret"]
    enable_response = client.post(
        "/api/auth/2fa/enable", json={"code": pyotp.TOTP(secret).now()}, headers=headers
    )
    backup_codes = enable_response.json()["backupCodes"]
    client.post("/api/auth/logout", headers=headers)
    client.cookies.clear()

    # Password alone now returns a challenge, not a session.
    login_response = client.post(
        "/api/auth/login", json={"identifier": "challenge-admin@example.com", "password": PASSWORD}
    )
    assert login_response.status_code == 200
    body = login_response.json()
    assert body["twoFactorRequired"] is True
    challenge_token = body["challengeToken"]

    # A wrong code is rejected.
    bad_response = client.post(
        "/api/auth/2fa/verify-login", json={"challengeToken": challenge_token, "code": "000000"}
    )
    assert bad_response.status_code == 401

    # The right TOTP code completes sign-in.
    good_response = client.post(
        "/api/auth/2fa/verify-login",
        json={"challengeToken": challenge_token, "code": pyotp.TOTP(secret).now()},
    )
    assert good_response.status_code == 200
    assert good_response.json()["user"]["role"] == "ADMIN"

    # A backup code also works, and only once.
    client.post("/api/auth/logout")
    client.cookies.clear()
    login_response_2 = client.post(
        "/api/auth/login", json={"identifier": "challenge-admin@example.com", "password": PASSWORD}
    )
    challenge_token_2 = login_response_2.json()["challengeToken"]
    backup_code = backup_codes[0]

    first_use = client.post(
        "/api/auth/2fa/verify-login", json={"challengeToken": challenge_token_2, "code": backup_code}
    )
    assert first_use.status_code == 200

    client.cookies.clear()
    login_response_3 = client.post(
        "/api/auth/login", json={"identifier": "challenge-admin@example.com", "password": PASSWORD}
    )
    challenge_token_3 = login_response_3.json()["challengeToken"]
    second_use = client.post(
        "/api/auth/2fa/verify-login", json={"challengeToken": challenge_token_3, "code": backup_code}
    )
    assert second_use.status_code == 401


def test_backup_codes_regenerate_invalidates_old_codes(client, db_session):
    school = _make_school(db_session)
    _make_admin(db_session, "regen-admin@example.com", school)
    headers = _login(client, "regen-admin@example.com")
    setup_response = client.post("/api/auth/2fa/setup", headers=headers)
    secret = setup_response.json()["secret"]
    enable_response = client.post(
        "/api/auth/2fa/enable", json={"code": pyotp.TOTP(secret).now()}, headers=headers
    )
    old_codes = enable_response.json()["backupCodes"]

    regen_response = client.post(
        "/api/auth/2fa/backup-codes/regenerate", json={"password": PASSWORD}, headers=headers
    )
    assert regen_response.status_code == 200
    new_codes = regen_response.json()["backupCodes"]
    assert new_codes != old_codes

    client.post("/api/auth/logout", headers=headers)
    client.cookies.clear()
    login_response = client.post(
        "/api/auth/login", json={"identifier": "regen-admin@example.com", "password": PASSWORD}
    )
    challenge_token = login_response.json()["challengeToken"]

    old_code_response = client.post(
        "/api/auth/2fa/verify-login", json={"challengeToken": challenge_token, "code": old_codes[0]}
    )
    assert old_code_response.status_code == 401


def test_super_admin_without_2fa_is_also_blocked(client, db_session):
    _make_super_admin(db_session, "unenrolled-super@example.com")
    headers = _login(client, "unenrolled-super@example.com")

    response = client.get("/api/curriculum-admin/board-courses", headers=headers)
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "TWO_FACTOR_SETUP_REQUIRED"


def test_teacher_and_student_are_not_subject_to_mandatory_2fa(client, db_session):
    school = _make_school(db_session)
    teacher_user = User(
        full_name="Test Teacher", email="teacher-2fa@example.com", password_hash=hash_password(PASSWORD), role="TEACHER"
    )
    db_session.add(teacher_user)
    db_session.flush()
    db_session.add(Teacher(user_id=teacher_user.id, school_id=school.id, teacher_code="TCH-2FA"))
    db_session.commit()

    headers = _login(client, "teacher-2fa@example.com")
    me_response = client.get("/api/auth/me", headers=headers)
    assert me_response.status_code == 200
    assert me_response.json()["twoFactorEnabled"] is False
