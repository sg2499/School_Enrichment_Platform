"""Proves the 2026-08-19 per-device session tracking feature: the JWT's new
"sid" claim, the backing UserSession table (app/services/session_service.py),
and the GET/DELETE /api/auth/sessions surface on top of it.
"""
from datetime import datetime, timedelta, timezone

from app.core.security import hash_password
from app.models import User, UserSession

PASSWORD = "Xk4$nQ8vPz"


def _make_user(db, email: str, role: str = "TEACHER") -> User:
    user = User(full_name="Session Test User", email=email, password_hash=hash_password(PASSWORD), role=role)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _login(client, email: str) -> dict:
    response = client.post("/api/auth/login", json={"identifier": email, "password": PASSWORD})
    assert response.status_code == 200
    csrf_token = client.cookies.get("se_csrf")
    assert csrf_token
    return {"X-CSRF-Token": csrf_token}


def test_login_creates_a_session_visible_in_the_list(client, db_session):
    _make_user(db_session, "session-basic@example.com")
    headers = _login(client, "session-basic@example.com")

    response = client.get("/api/auth/sessions", headers=headers)
    assert response.status_code == 200
    sessions = response.json()["sessions"]
    assert len(sessions) == 1
    assert sessions[0]["isCurrent"] is True
    assert "id" in sessions[0] and "createdAt" in sessions[0] and "lastSeenAt" in sessions[0]


def test_two_logins_show_as_two_separate_sessions(client, db_session):
    """Simulates "logged in on two devices" by using two separate
    TestClients (each with its own cookie jar) against the same backend DB."""
    from fastapi.testclient import TestClient
    from app.main import app

    _make_user(db_session, "session-multi@example.com")
    headers_a = _login(client, "session-multi@example.com")

    with TestClient(app) as client_b:
        login_b = client_b.post(
            "/api/auth/login", json={"identifier": "session-multi@example.com", "password": PASSWORD}
        )
        assert login_b.status_code == 200
        csrf_b = client_b.cookies.get("se_csrf")

        response_b = client_b.get("/api/auth/sessions", headers={"X-CSRF-Token": csrf_b})
        assert response_b.status_code == 200
        assert len(response_b.json()["sessions"]) == 2

    response_a = client.get("/api/auth/sessions", headers=headers_a)
    assert len(response_a.json()["sessions"]) == 2


def test_revoking_another_session_ends_it_without_touching_the_current_one(client, db_session):
    from fastapi.testclient import TestClient
    from app.main import app

    _make_user(db_session, "session-revoke@example.com")
    headers_a = _login(client, "session-revoke@example.com")

    with TestClient(app) as client_b:
        client_b.post("/api/auth/login", json={"identifier": "session-revoke@example.com", "password": PASSWORD})
        csrf_b = client_b.cookies.get("se_csrf")
        # Both sessions can land in the same SQLite-precision second, so pick
        # by isCurrent (correct by construction) rather than list order.
        sessions_b = client_b.get("/api/auth/sessions", headers={"X-CSRF-Token": csrf_b}).json()["sessions"]
        session_b_id = next(s["id"] for s in sessions_b if s["isCurrent"])

    # Revoke device B's session from device A.
    sessions_before = client.get("/api/auth/sessions", headers=headers_a).json()["sessions"]
    assert len(sessions_before) == 2
    delete_response = client.delete(f"/api/auth/sessions/{session_b_id}", headers=headers_a)
    assert delete_response.status_code == 200

    sessions_after = client.get("/api/auth/sessions", headers=headers_a).json()["sessions"]
    assert len(sessions_after) == 1
    assert sessions_after[0]["isCurrent"] is True

    # Device A itself still works fine.
    me_response = client.get("/api/auth/me", headers=headers_a)
    assert me_response.status_code == 200


def test_revoked_session_token_is_rejected_on_its_next_request(client, db_session):
    _make_user(db_session, "session-reject@example.com")
    headers = _login(client, "session-reject@example.com")

    session_id = client.get("/api/auth/sessions", headers=headers).json()["sessions"][0]["id"]
    session_row = db_session.get(UserSession, session_id)
    assert session_row is not None

    # Revoke directly at the DB layer (equivalent to what the endpoint does)
    # and confirm get_current_user() now rejects the still-cookied token.
    session_row.revoked_at = datetime.now(timezone.utc)
    db_session.commit()

    response = client.get("/api/auth/me", headers=headers)
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "UNAUTHORIZED"


def test_logout_revokes_only_the_current_device_session(client, db_session):
    from fastapi.testclient import TestClient
    from app.main import app

    _make_user(db_session, "session-logout@example.com")
    headers_a = _login(client, "session-logout@example.com")

    with TestClient(app) as client_b:
        client_b.post("/api/auth/login", json={"identifier": "session-logout@example.com", "password": PASSWORD})
        csrf_b = client_b.cookies.get("se_csrf")
        headers_b = {"X-CSRF-Token": csrf_b}

        logout_response = client_b.post("/api/auth/logout", headers=headers_b)
        assert logout_response.status_code == 200

    # Device A (never logged out) still sees exactly one active session --
    # its own -- proving B's logout didn't touch A.
    sessions = client.get("/api/auth/sessions", headers=headers_a).json()["sessions"]
    assert len(sessions) == 1
    assert sessions[0]["isCurrent"] is True


def test_admin_session_hard_expires_after_absolute_lifetime_regardless_of_activity(client, db_session):
    """SUPER_ADMIN/ADMIN sessions carry a 12-hour absolute cap
    (session_service.py's MAX_SESSION_LIFETIME_MINUTES_BY_ROLE) even though
    the token itself would otherwise keep sliding-renewing forever for an
    actively-used session."""
    import pyotp

    totp_secret = pyotp.random_base32()
    admin = User(
        full_name="Session Admin",
        email="session-admin-expiry@example.com",
        password_hash=hash_password(PASSWORD),
        role="SUPER_ADMIN",
        totp_enabled=True,
        totp_secret=totp_secret,
    )
    db_session.add(admin)
    db_session.commit()

    login_response = client.post(
        "/api/auth/login", json={"identifier": "session-admin-expiry@example.com", "password": PASSWORD}
    )
    challenge = login_response.json()
    verify_response = client.post(
        "/api/auth/2fa/verify-login",
        json={"challengeToken": challenge["challengeToken"], "code": pyotp.TOTP(totp_secret).now()},
    )
    assert verify_response.status_code == 200
    csrf_token = client.cookies.get("se_csrf")
    headers = {"X-CSRF-Token": csrf_token}

    session_id = client.get("/api/auth/sessions", headers=headers).json()["sessions"][0]["id"]
    session_row = db_session.get(UserSession, session_id)
    session_row.created_at = datetime.now(timezone.utc) - timedelta(hours=13)
    db_session.commit()

    response = client.get("/api/auth/me", headers=headers)
    assert response.status_code == 401


def test_teacher_session_has_no_absolute_lifetime_cap(client, db_session):
    """Contrast case: TEACHER/STUDENT are not in MAX_SESSION_LIFETIME_MINUTES_BY_ROLE,
    so a long-lived-but-still-valid (not revoked) session for those roles is
    unaffected by the age check -- only ADMIN/SUPER_ADMIN get the stricter cap."""
    _make_user(db_session, "session-teacher-no-cap@example.com")
    headers = _login(client, "session-teacher-no-cap@example.com")

    session_id = client.get("/api/auth/sessions", headers=headers).json()["sessions"][0]["id"]
    session_row = db_session.get(UserSession, session_id)
    session_row.created_at = datetime.now(timezone.utc) - timedelta(days=30)
    db_session.commit()

    response = client.get("/api/auth/me", headers=headers)
    assert response.status_code == 200
