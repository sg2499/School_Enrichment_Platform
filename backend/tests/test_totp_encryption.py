"""Proves TOTP secrets are encrypted at rest (1 Oct 2026, A6 review
remainder):

- a fresh enrolment (2FA setup -> enable) stores Fernet ciphertext in BOTH
  users.totp_pending_secret and users.totp_secret -- checked by reading the
  raw DB columns, not through the model -- and the full login round trip
  still works on top of it;
- a user enrolled BEFORE this change (plaintext in the column) can still
  sign in with their existing authenticator after alembic f7c2a9d4e1b8 runs:
  a real file-backed SQLite DB is migrated to the previous head, given
  plaintext secrets the way the old code stored them, migrated to head, and
  then logged into through the real API;
- the migration is idempotent (re-running it never double-encrypts),
  handles a mix of already-encrypted and plaintext rows, round-trips
  through downgrade, and refuses to run with the wrong key without
  changing a single row;
- a secret that can't be decrypted (wrong key, or plaintext that never
  went through the migration) fails loudly -- a TotpSecretDecryptionError /
  HTTP 500 -- and is never treated as a valid or absent second factor:
  even the correct code is not accepted, no session is issued, and the
  lockout counter doesn't move;
- key rotation (several comma-separated keys) and the production boot
  guard on TOTP_ENCRYPTION_KEY.
"""
import os
import subprocess
import sys
from pathlib import Path

import pyotp
import pytest
from alembic.config import Config
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from alembic import command
from app.core import config
from app.core.security import hash_password
from app.core.totp_crypto import TotpSecretDecryptionError, decrypt_totp_secret, encrypt_totp_secret
from app.database import get_db
from app.main import app
from app.models import School, SchoolAdmin, User

PASSWORD = "Passw0rd1"
BACKEND_DIR = Path(__file__).resolve().parents[1]
PREVIOUS_HEAD = "e3b8d1f4a2c6"
FERNET_PREFIX = "gAAAAA"


def _raw_secrets(db, user_id: str) -> tuple[str | None, str | None]:
    """The columns exactly as stored -- bypasses the model's properties."""
    row = db.execute(
        text("SELECT totp_secret, totp_pending_secret FROM users WHERE id = :id"), {"id": user_id}
    ).one()
    return row[0], row[1]


def _make_admin(db, email: str) -> User:
    school = School(name=f"TOTP Crypto School {email}", board="CBSE", city="Bengaluru")
    db.add(school)
    db.flush()
    user = User(full_name="Crypto Admin", email=email, password_hash=hash_password(PASSWORD), role="ADMIN")
    db.add(user)
    db.flush()
    db.add(SchoolAdmin(user_id=user.id, school_id=school.id))
    db.commit()
    db.refresh(user)
    return user


def _password_login(client, email: str):
    return client.post("/api/auth/login", json={"identifier": email, "password": PASSWORD})


# --- fresh enrolment ----------------------------------------------------------


def test_fresh_enrollment_stores_ciphertext_never_plaintext(client, db_session):
    user = _make_admin(db_session, "totp-crypto-fresh@example.com")
    login = _password_login(client, user.email)
    assert login.status_code == 200
    headers = {"x-csrf-token": client.cookies.get("se_csrf")}

    setup = client.post("/api/auth/2fa/setup", headers=headers)
    assert setup.status_code == 200
    secret = setup.json()["secret"]  # shown to the user once, for manual entry

    db_session.expire_all()
    raw_secret, raw_pending = _raw_secrets(db_session, user.id)
    assert raw_secret is None
    assert raw_pending is not None and raw_pending.startswith(FERNET_PREFIX)
    assert secret not in raw_pending
    assert decrypt_totp_secret(raw_pending) == secret

    enable = client.post("/api/auth/2fa/enable", json={"code": pyotp.TOTP(secret).now()}, headers=headers)
    assert enable.status_code == 200, enable.text

    db_session.expire_all()
    raw_secret, raw_pending = _raw_secrets(db_session, user.id)
    assert raw_pending is None
    assert raw_secret is not None and raw_secret.startswith(FERNET_PREFIX)
    assert secret not in raw_secret
    assert decrypt_totp_secret(raw_secret) == secret
    # Through the model it still reads as the plaintext secret.
    assert db_session.get(User, user.id).totp_secret == secret

    # And the encrypted secret still completes a real sign-in.
    client.post("/api/auth/logout", headers=headers)
    client.cookies.clear()
    challenge = _password_login(client, user.email).json()
    assert challenge["twoFactorRequired"] is True
    verified = client.post(
        "/api/auth/2fa/verify-login",
        json={"challengeToken": challenge["challengeToken"], "code": pyotp.TOTP(secret).now()},
    )
    assert verified.status_code == 200, verified.text


def test_each_encryption_is_randomised(db_session):
    """Same secret, two users -> two different tokens (Fernet uses a fresh
    IV per encryption), so equal ciphertexts can't reveal shared secrets."""
    secret = pyotp.random_base32()
    assert encrypt_totp_secret(secret) != encrypt_totp_secret(secret)


# --- decryption failure is loud -------------------------------------------------


def test_undecryptable_secret_fails_loudly_and_is_never_accepted(db_session):
    secret = pyotp.random_base32()
    user = User(
        full_name="Wrong Key Admin", email="totp-crypto-wrongkey@example.com",
        password_hash=hash_password(PASSWORD), role="SUPER_ADMIN", totp_enabled=True, totp_secret=secret,
    )
    db_session.add(user)
    db_session.commit()

    # Encrypted under some OTHER key -- what a wrong/rotated-away
    # TOTP_ENCRYPTION_KEY looks like from the app's side.
    foreign_token = Fernet(Fernet.generate_key()).encrypt(secret.encode()).decode()
    for bad_value in (foreign_token, secret, "not-a-token"):  # wrong key / never migrated / corrupt
        db_session.execute(
            text("UPDATE users SET totp_secret = :v WHERE id = :id"), {"v": bad_value, "id": user.id}
        )
        db_session.commit()
        db_session.expire_all()
        with pytest.raises(TotpSecretDecryptionError) as excinfo:
            _ = db_session.get(User, user.id).totp_secret
        assert secret not in str(excinfo.value)

    # Through the real API: the CORRECT code is still not accepted, no
    # session is issued, and the failure doesn't count against the account.
    db_session.execute(
        text("UPDATE users SET totp_secret = :v WHERE id = :id"), {"v": foreign_token, "id": user.id}
    )
    db_session.commit()

    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    try:
        with TestClient(app, raise_server_exceptions=False) as raw_client:
            challenge = _password_login(raw_client, user.email).json()
            assert challenge["twoFactorRequired"] is True
            response = raw_client.post(
                "/api/auth/2fa/verify-login",
                json={"challengeToken": challenge["challengeToken"], "code": pyotp.TOTP(secret).now()},
            )
            assert response.status_code == 500
            assert response.json()["error"]["code"] == "INTERNAL_SERVER_ERROR"
            assert secret not in response.text
            assert "se_csrf" not in response.cookies and not any(
                name.startswith("se_session") for name in response.cookies
            )
    finally:
        app.dependency_overrides.clear()

    db_session.expire_all()
    stored = db_session.get(User, user.id)
    assert stored.failed_login_attempts == 0
    assert stored.totp_last_used_step is None


# --- key rotation -----------------------------------------------------------------


def test_key_rotation_decrypts_old_tokens_and_encrypts_with_the_newest_key(monkeypatch):
    old_key, new_key = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    secret = pyotp.random_base32()

    monkeypatch.setattr(config, "TOTP_ENCRYPTION_KEYS", [old_key])
    old_token = encrypt_totp_secret(secret)

    monkeypatch.setattr(config, "TOTP_ENCRYPTION_KEYS", [new_key, old_key])
    assert decrypt_totp_secret(old_token) == secret
    new_token = encrypt_totp_secret(secret)
    assert Fernet(new_key).decrypt(new_token.encode()).decode() == secret

    monkeypatch.setattr(config, "TOTP_ENCRYPTION_KEYS", [new_key])  # old key dropped too early
    with pytest.raises(TotpSecretDecryptionError):
        decrypt_totp_secret(old_token)


# --- production boot guard ---------------------------------------------------------


def _import_config(**env_overrides) -> subprocess.CompletedProcess:
    """config.py runs its checks at import time, so each case needs a fresh
    interpreter with exactly the environment under test."""
    env = {k: v for k, v in os.environ.items() if k not in ("ENVIRONMENT", "TOTP_ENCRYPTION_KEY")}
    env.update({"SECRET_KEY": "a-real-secret", **env_overrides})
    return subprocess.run(
        [sys.executable, "-c", "import app.core.config as c; print(len(c.TOTP_ENCRYPTION_KEYS))"],
        cwd=BACKEND_DIR, env=env, capture_output=True, text=True, check=False,
    )


def test_production_refuses_to_boot_without_a_real_totp_key(tmp_path):
    dev_key = config._DEV_TOTP_ENCRYPTION_KEY
    real_key = Fernet.generate_key().decode()

    for env in ({}, {"TOTP_ENCRYPTION_KEY": "   "}, {"TOTP_ENCRYPTION_KEY": dev_key},
                {"TOTP_ENCRYPTION_KEY": f"{real_key},{dev_key}"}):
        result = _import_config(ENVIRONMENT="production", **env)
        assert result.returncode != 0, env
        assert "TOTP_ENCRYPTION_KEY is not set" in result.stderr

    malformed = _import_config(ENVIRONMENT="production", TOTP_ENCRYPTION_KEY="not-a-fernet-key")
    assert malformed.returncode != 0
    assert "is not a valid Fernet key" in malformed.stderr
    assert "not-a-fernet-key" not in malformed.stderr  # the value itself is never echoed

    ok = _import_config(ENVIRONMENT="production", TOTP_ENCRYPTION_KEY=real_key)
    assert ok.returncode == 0, ok.stderr
    rotated = _import_config(ENVIRONMENT="production", TOTP_ENCRYPTION_KEY=f"{real_key}, {Fernet.generate_key().decode()}")
    assert rotated.returncode == 0 and rotated.stdout.strip() == "2", rotated.stderr

    # Local dev falls back to the documented dev key.
    dev = _import_config(ENVIRONMENT="development")
    assert dev.returncode == 0 and dev.stdout.strip() == "1", dev.stderr


# --- the data migration (alembic f7c2a9d4e1b8) --------------------------------------


@pytest.fixture()
def migrated_db(tmp_path, monkeypatch):
    """A real SQLite file migrated with the real Alembic scripts. env.py
    reads app.core.config.DATABASE_URL each run, so pointing that at the
    file is all it takes. No alembic.ini is loaded, so env.py's fileConfig()
    can't reconfigure the test session's logging."""
    db_url = f"sqlite:///{tmp_path / 'totp_migration.db'}"
    monkeypatch.setattr(config, "DATABASE_URL", db_url)
    alembic_cfg = Config()
    alembic_cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    engine = create_engine(db_url)
    try:
        yield alembic_cfg, engine
    finally:
        engine.dispose()


def _seed_pre_migration_users(engine) -> dict[str, dict]:
    """Users as the OLD code stored them: plaintext base32 in the columns.
    Created through the ORM (so every NOT NULL column is right), then the
    secret columns are overwritten with plaintext via raw SQL -- the ORM
    would encrypt them."""
    Session = sessionmaker(bind=engine)
    seeded = {
        "enrolled": {"secret": pyotp.random_base32(), "pending": None},
        "mid_setup": {"secret": None, "pending": pyotp.random_base32()},
        "re_enrolling": {"secret": pyotp.random_base32(), "pending": pyotp.random_base32()},
    }
    with Session() as db:
        for label, values in seeded.items():
            user = User(
                full_name=f"Pre-migration {label}", email=f"premig-{label}@example.com",
                password_hash=hash_password(PASSWORD), role="SUPER_ADMIN",
                totp_enabled=values["secret"] is not None,
            )
            db.add(user)
            db.flush()
            values["id"] = user.id
            db.execute(
                text("UPDATE users SET totp_secret = :s, totp_pending_secret = :p WHERE id = :id"),
                {"s": values["secret"], "p": values["pending"], "id": user.id},
            )
        db.commit()
    return seeded


def _raw(engine, user_id):
    with engine.connect() as conn:
        return tuple(
            conn.execute(
                text("SELECT totp_secret, totp_pending_secret FROM users WHERE id = :id"), {"id": user_id}
            ).one()
        )


def test_user_enrolled_before_encryption_can_still_sign_in_after_migration(migrated_db):
    alembic_cfg, engine = migrated_db
    command.upgrade(alembic_cfg, PREVIOUS_HEAD)
    seeded = _seed_pre_migration_users(engine)
    assert _raw(engine, seeded["enrolled"]["id"]) == (seeded["enrolled"]["secret"], None)

    command.upgrade(alembic_cfg, "head")

    for values in seeded.values():
        raw_secret, raw_pending = _raw(engine, values["id"])
        for raw, original in ((raw_secret, values["secret"]), (raw_pending, values["pending"])):
            if original is None:
                assert raw is None
            else:
                assert raw.startswith(FERNET_PREFIX) and original not in raw
                assert decrypt_totp_secret(raw) == original

    # The real sign-in path, against the migrated DB, with a code from the
    # authenticator app the user set up BEFORE the change.
    Session = sessionmaker(bind=engine)
    db = Session()

    def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    try:
        with TestClient(app) as migrated_client:
            enrolled = seeded["enrolled"]
            challenge = _password_login(migrated_client, "premig-enrolled@example.com").json()
            assert challenge["twoFactorRequired"] is True
            signed_in = migrated_client.post(
                "/api/auth/2fa/verify-login",
                json={"challengeToken": challenge["challengeToken"], "code": pyotp.TOTP(enrolled["secret"]).now()},
            )
            assert signed_in.status_code == 200, signed_in.text
            assert signed_in.json()["user"]["id"] == enrolled["id"]

            # A user who was half-way through setup can still finish it with
            # the QR code they already scanned.
            migrated_client.cookies.clear()
            mid = seeded["mid_setup"]
            assert _password_login(migrated_client, "premig-mid_setup@example.com").status_code == 200
            finished = migrated_client.post(
                "/api/auth/2fa/enable",
                json={"code": pyotp.TOTP(mid["pending"]).now()},
                headers={"x-csrf-token": migrated_client.cookies.get("se_csrf")},
            )
            assert finished.status_code == 200, finished.text
    finally:
        app.dependency_overrides.clear()
        db.close()

    raw_secret, raw_pending = _raw(engine, seeded["mid_setup"]["id"])
    assert raw_pending is None and decrypt_totp_secret(raw_secret) == seeded["mid_setup"]["pending"]


def test_migration_is_idempotent_handles_mixed_rows_and_round_trips(migrated_db):
    alembic_cfg, engine = migrated_db
    command.upgrade(alembic_cfg, PREVIOUS_HEAD)
    seeded = _seed_pre_migration_users(engine)

    # A row already holding ciphertext before the migration runs (e.g.
    # written by the new code during a partial rollout) -- must be left
    # byte-for-byte alone, not encrypted a second time.
    already = pyotp.random_base32()
    already_token = encrypt_totp_secret(already)
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE users SET totp_pending_secret = :t WHERE id = :id"),
            {"t": already_token, "id": seeded["enrolled"]["id"]},
        )

    command.upgrade(alembic_cfg, "head")
    after_first = {label: _raw(engine, v["id"]) for label, v in seeded.items()}
    assert after_first["enrolled"][1] == already_token

    # Re-run the same migration over already-encrypted data.
    command.stamp(alembic_cfg, PREVIOUS_HEAD)
    command.upgrade(alembic_cfg, "head")
    assert {label: _raw(engine, v["id"]) for label, v in seeded.items()} == after_first

    # downgrade -1 restores exactly the plaintext the old code expects...
    command.downgrade(alembic_cfg, "-1")
    for label, values in seeded.items():
        expected_pending = already if label == "enrolled" else values["pending"]
        assert _raw(engine, values["id"]) == (values["secret"], expected_pending)

    # ...and upgrading again re-encrypts it, still decrypting correctly.
    command.upgrade(alembic_cfg, "head")
    for label, values in seeded.items():
        raw_secret, _ = _raw(engine, values["id"])
        if values["secret"] is not None:
            assert raw_secret.startswith(FERNET_PREFIX)
            assert decrypt_totp_secret(raw_secret) == values["secret"]


def test_migration_with_the_wrong_key_stops_without_changing_anything(migrated_db, monkeypatch):
    alembic_cfg, engine = migrated_db
    command.upgrade(alembic_cfg, PREVIOUS_HEAD)
    seeded = _seed_pre_migration_users(engine)
    command.upgrade(alembic_cfg, "head")
    before = {label: _raw(engine, v["id"]) for label, v in seeded.items()}

    # Add one more plaintext row so a partial run WOULD be visible, then
    # re-run with a key that can't read the existing ciphertext.
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE users SET totp_pending_secret = :p WHERE id = :id"),
            {"p": pyotp.random_base32(), "id": seeded["mid_setup"]["id"]},
        )
    snapshot = {label: _raw(engine, v["id"]) for label, v in seeded.items()}
    command.stamp(alembic_cfg, PREVIOUS_HEAD)

    right_keys = list(config.TOTP_ENCRYPTION_KEYS)
    monkeypatch.setattr(config, "TOTP_ENCRYPTION_KEYS", [Fernet.generate_key().decode()])
    with pytest.raises(RuntimeError) as excinfo:
        command.upgrade(alembic_cfg, "head")
    assert "no rows were changed" in str(excinfo.value)
    for values in seeded.values():
        for original in (values["secret"], values["pending"]):
            if original:
                assert original not in str(excinfo.value)
    assert {label: _raw(engine, v["id"]) for label, v in seeded.items()} == snapshot
    assert before["enrolled"] == snapshot["enrolled"]  # existing ciphertext untouched

    # With the right key back, the same run completes.
    monkeypatch.setattr(config, "TOTP_ENCRYPTION_KEYS", right_keys)
    command.upgrade(alembic_cfg, "head")
    assert _raw(engine, seeded["mid_setup"]["id"])[1].startswith(FERNET_PREFIX)
