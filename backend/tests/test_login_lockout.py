"""Proves the 2026-08-19 per-account login lockout (app/services/
auth_service.py's login()) -- a second, account-keyed layer independent of
the existing per-IP slowapi rate limit on POST /auth/login, which does
nothing against an attack spread across many source IPs.
"""
import json
from datetime import datetime, timedelta, timezone

import pyotp

from app.core.security import hash_password
from app.models import School, SchoolAdmin, User

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


# --- 13 Oct 2026: a correct password no longer clears the count -----------
# Until then, every correct password reset failed_login_attempts, so someone
# holding an admin's password could alternate wrong two-factor codes with a
# fresh password step and never be locked out. The count now clears only
# when a sign-in is complete.

TOTP_SECRET = pyotp.random_base32()


def _make_two_factor_admin(db, email: str) -> User:
    school = School(name=f"Lockout School {email}", board="CBSE", city="Pune")
    db.add(school)
    db.flush()
    user = User(
        full_name="Lockout Two-Factor Admin",
        email=email,
        password_hash=hash_password(PASSWORD),
        role="ADMIN",
        totp_enabled=True,
        totp_secret=TOTP_SECRET,
    )
    db.add(user)
    db.flush()
    db.add(SchoolAdmin(user_id=user.id, school_id=school.id))
    db.commit()
    db.refresh(user)
    return user


def _wrong_code() -> str:
    """A six-digit code that is not valid in any window the server accepts."""
    totp = pyotp.TOTP(TOTP_SECRET)
    now = datetime.now(timezone.utc)
    valid = {totp.at(now + timedelta(seconds=offset)) for offset in (-60, -30, 0, 30, 60)}
    candidate = 0
    while f"{candidate:06d}" in valid:
        candidate += 1
    return f"{candidate:06d}"


def _password_step(client, email: str) -> str:
    response = client.post("/api/auth/login", json={"identifier": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    assert response.json()["twoFactorRequired"] is True
    return response.json()["challengeToken"]


def test_fresh_password_step_does_not_clear_two_factor_failures(client, db_session):
    email = "lockout-2fa-alternate@example.com"
    user = _make_two_factor_admin(db_session, email)

    # Four rounds of: right password, wrong code. Each round starts afresh.
    for attempt in range(1, 5):
        challenge = _password_step(client, email)
        wrong = client.post("/api/auth/2fa/verify-login", json={"challengeToken": challenge, "code": _wrong_code()})
        assert wrong.status_code == 401
        db_session.refresh(user)
        assert user.failed_login_attempts == attempt

    # The fifth wrong code locks the account, fresh password step or not.
    challenge = _password_step(client, email)
    locking = client.post("/api/auth/2fa/verify-login", json={"challengeToken": challenge, "code": _wrong_code()})
    assert locking.status_code == 423
    assert locking.json()["detail"]["code"] == "ACCOUNT_LOCKED"

    # And it stays locked: the right password is refused, and so is the
    # right code on a challenge issued before the lock.
    refused = client.post("/api/auth/login", json={"identifier": email, "password": PASSWORD})
    assert refused.status_code == 423
    late = client.post(
        "/api/auth/2fa/verify-login",
        json={"challengeToken": challenge, "code": pyotp.TOTP(TOTP_SECRET).now()},
    )
    assert late.status_code == 423


def test_password_step_keeps_count_until_second_factor_clears(client, db_session):
    email = "lockout-2fa-complete@example.com"
    user = _make_two_factor_admin(db_session, email)

    for _ in range(3):
        client.post("/api/auth/login", json={"identifier": email, "password": "wrong-password"})
    db_session.refresh(user)
    assert user.failed_login_attempts == 3

    # Right password: the count is untouched while the second factor is due.
    challenge = _password_step(client, email)
    db_session.refresh(user)
    assert user.failed_login_attempts == 3

    # Right code: the sign-in is complete, and only now is the count cleared.
    done = client.post(
        "/api/auth/2fa/verify-login",
        json={"challengeToken": challenge, "code": pyotp.TOTP(TOTP_SECRET).now()},
    )
    assert done.status_code == 200, done.text
    db_session.refresh(user)
    assert user.failed_login_attempts == 0
    assert user.locked_until is None


def test_backup_code_sign_in_clears_the_count(client, db_session):
    email = "lockout-2fa-backup@example.com"
    user = _make_two_factor_admin(db_session, email)
    user.totp_backup_codes_json = json.dumps([hash_password("8f3k-q2m9")])
    user.failed_login_attempts = 3
    db_session.commit()

    challenge = _password_step(client, email)
    done = client.post("/api/auth/2fa/verify-login", json={"challengeToken": challenge, "code": "8f3k-q2m9"})
    assert done.status_code == 200, done.text
    db_session.refresh(user)
    assert user.failed_login_attempts == 0


def test_an_expired_lock_starts_a_fresh_count(client, db_session):
    """A correct password no longer clears the count, so without a fresh
    start one mistyped code after a lock ran out would lock the owner out
    again at once."""
    email = "lockout-2fa-expired@example.com"
    user = _make_two_factor_admin(db_session, email)
    user.failed_login_attempts = 5
    user.locked_until = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()

    challenge = _password_step(client, email)
    typo = client.post("/api/auth/2fa/verify-login", json={"challengeToken": challenge, "code": _wrong_code()})
    assert typo.status_code == 401
    db_session.refresh(user)
    assert user.failed_login_attempts == 1
    assert user.locked_until is None

    # Still five guesses per window: four more wrong codes lock it again.
    for _ in range(3):
        challenge = _password_step(client, email)
        assert client.post(
            "/api/auth/2fa/verify-login", json={"challengeToken": challenge, "code": _wrong_code()}
        ).status_code == 401
    challenge = _password_step(client, email)
    locked = client.post("/api/auth/2fa/verify-login", json={"challengeToken": challenge, "code": _wrong_code()})
    assert locked.status_code == 423
