"""encrypt TOTP secrets at rest

Revision ID: f7c2a9d4e1b8
Revises: e3b8d1f4a2c6
Create Date: 2026-10-01 12:00:00.000000

Data-only migration (1 Oct 2026, A6 security review remainder): no schema
change. users.totp_secret and users.totp_pending_secret keep their names
and Text type; their VALUES change from plaintext base32 TOTP secrets to
Fernet tokens encrypted with TOTP_ENCRYPTION_KEY (see app/core/config.py
and app/core/totp_crypto.py; the User model encrypts/decrypts them from
now on).

Key: read from app.core.config.TOTP_ENCRYPTION_KEYS -- the exact same
parsing the running app uses (first key encrypts, every key decrypts).
render.yaml runs `alembic upgrade head` in the build with the service's
env vars, so production migrates with the same key it then serves with;
config.py refuses to load at all in production without a real key, so this
can't silently run with the public dev key there.

Idempotent and safe to re-run -- no marker column needed, because the two
value shapes can't be confused:
  - a plaintext secret is pyotp base32: only A-Z and 2-7 (+ optional "="
    padding);
  - a Fernet token is url-safe base64 of a 0x80 version byte + timestamp +
    IV + ciphertext + HMAC: it always starts "gAAAAA" and always contains
    lowercase letters, so it can never match the base32 pattern.
Each non-NULL value is classified as: already encrypted (decrypts under
the current keyring -- left alone, never double-encrypted), plaintext
(matches the base32 pattern -- encrypted), or neither. "Neither" means a
token from a different key (wrong/rotated-away TOTP_ENCRYPTION_KEY) or
corrupt data: the migration stops with an error naming the user id and
column (never the value), and because every row is classified BEFORE any
row is written, nothing has been changed when it stops -- even on SQLite,
where Alembic doesn't wrap the run in a transaction.

Downgrade decrypts back to plaintext with the same two-pass rule (tokens
decrypted, plaintext left alone, anything else stops it unchanged). It
exists so a rollback of this release restores exactly what the previous
code expects; it re-exposes plaintext at rest, so it's for rollback only.

The Fernet calls are inlined here on purpose rather than imported from
app.core.totp_crypto, so later edits to that module can't change what this
historical migration does.
"""
import re

import sqlalchemy as sa
from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from alembic import op

# revision identifiers, used by Alembic.
revision = "f7c2a9d4e1b8"
down_revision = "e3b8d1f4a2c6"
branch_labels = None
depends_on = None

_COLUMNS = ("totp_secret", "totp_pending_secret")
_PLAINTEXT_TOTP_SECRET = re.compile(r"[A-Z2-7]+=*")


def _keyring() -> MultiFernet:
    from app.core import config

    return MultiFernet([Fernet(key) for key in config.TOTP_ENCRYPTION_KEYS])


def _decrypt_or_none(keyring: MultiFernet, value: str) -> str | None:
    try:
        return keyring.decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeError):
        return None


def _rows_with_secrets(connection):
    return (
        connection.execute(
            sa.text(
                "SELECT id, totp_secret, totp_pending_secret FROM users "
                "WHERE totp_secret IS NOT NULL OR totp_pending_secret IS NOT NULL"
            )
        )
        .mappings()
        .all()
    )


def _unrecognised(user_id: str, column: str, direction: str) -> RuntimeError:
    return RuntimeError(
        f"users.{column} for user id {user_id} is neither a plaintext base32 TOTP secret nor a value the "
        f"configured TOTP_ENCRYPTION_KEY can decrypt -- most likely the wrong key. {direction} stopped "
        "before writing anything; no rows were changed."
    )


def _apply(connection, updates: list[tuple[str, dict]]) -> None:
    for user_id, values in updates:
        assignments = ", ".join(f"{column} = :{column}" for column in values)
        connection.execute(
            sa.text(f"UPDATE users SET {assignments} WHERE id = :user_id"), {**values, "user_id": user_id}
        )


def upgrade() -> None:
    connection = op.get_bind()
    keyring = _keyring()

    # Pass 1: classify everything; raise before touching a single row.
    updates: list[tuple[str, dict]] = []
    for row in _rows_with_secrets(connection):
        values = {}
        for column in _COLUMNS:
            value = row[column]
            if value is None or _decrypt_or_none(keyring, value) is not None:
                continue  # NULL, or already encrypted under this keyring
            if not _PLAINTEXT_TOTP_SECRET.fullmatch(value):
                raise _unrecognised(row["id"], column, "Encryption")
            values[column] = keyring.encrypt(value.encode("utf-8")).decode("ascii")
        if values:
            updates.append((row["id"], values))

    # Pass 2: write.
    _apply(connection, updates)


def downgrade() -> None:
    connection = op.get_bind()
    keyring = _keyring()

    updates: list[tuple[str, dict]] = []
    for row in _rows_with_secrets(connection):
        values = {}
        for column in _COLUMNS:
            value = row[column]
            if value is None:
                continue
            plaintext = _decrypt_or_none(keyring, value)
            if plaintext is not None:
                values[column] = plaintext
            elif not _PLAINTEXT_TOTP_SECRET.fullmatch(value):
                raise _unrecognised(row["id"], column, "Decryption")
            # else: already plaintext -- leave it.
        if values:
            updates.append((row["id"], values))

    _apply(connection, updates)
