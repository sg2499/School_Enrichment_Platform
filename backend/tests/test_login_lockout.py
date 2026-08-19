"""Proves the 2026-08-19 per-account login lockout (app/services/
auth_service.py's login()) -- a second, account-keyed layer independent of
the existing per-IP slowapi rate limit on POST /auth/login, which does
nothing against an attack spread across many source IPs.
"""
from datetime import datetime, timedelta, timezone

from app.core.security import hash_password
from app.models import User

PASSWORD = "Xk4$nQ8vPz"


def _make_user(db, email: str) -> User:
    user = User(full_name="Lockout Test User", email=email, password_hash=hash_password(PASSWORD), role="TEACHER")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_account_locks_after_five_failed_attempts(client, db_session):
    _make_user(db_session, "lockout-basic@example.com")

    for _ in range(4):
        response = client.post(
            "/api/auth/login", json={"identifier": "lockout-basic@example.com", "password": "wrong-password"}
        )
        assert response.status_code == 401

    # 5th failed attempt crosses the threshold and locks the account.
    locking_response = client.post(
        "/api/auth/login", json={"identifier": "lockout-basic@example.com", "password": "wrong-password"}
    )
    assert locking_response.status_code == 423
    assert locking_response.json()["detail"]["code"] == "ACCOUNT_LOCKED"


def test_correct_password_rejected_while_locked(client, db_session):
    user = _make_user(db_session, "lockout-correct-pw@example.com")
    user.failed_login_attempts = 5
    user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=15)
    db_session.commit()

    response = client.post(
        "/api/auth/login", json={"identifier": "lockout-correct-pw@example.com", "password": PASSWORD}
    )
    assert response.status_code == 423
    assert response.json()["detail"]["code"] == "ACCOUNT_LOCKED"


def test_lockout_expires_and_login_succeeds_again(client, db_session):
    user = _make_user(db_session, "lockout-expired@example.com")
    user.failed_login_attempts = 5
    # Already in the past -- the lock has expired.
    user.locked_until = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()

    response = client.post(
        "/api/auth/login", json={"identifier": "lockout-expired@example.com", "password": PASSWORD}
    )
    assert response.status_code == 200

    db_session.refresh(user)
    assert user.failed_login_attempts == 0
    assert user.locked_until is None


def test_successful_login_resets_failed_attempt_counter(client, db_session):
    user = _make_user(db_session, "lockout-reset@example.com")

    for _ in range(3):
        client.post("/api/auth/login", json={"identifier": "lockout-reset@example.com", "password": "wrong"})
    db_session.refresh(user)
    assert user.failed_login_attempts == 3

    success_response = client.post(
        "/api/auth/login", json={"identifier": "lockout-reset@example.com", "password": PASSWORD}
    )
    assert success_response.status_code == 200

    db_session.refresh(user)
    assert user.failed_login_attempts == 0
    assert user.locked_until is None
