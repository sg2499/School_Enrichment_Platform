"""Encryption at rest for TOTP shared secrets (1 Oct 2026, A6 review
remainder -- the "TOTP secrets stored in plaintext" item A14 deferred).

A TOTP secret is the second factor itself: anyone who reads it can mint
valid codes forever. Stored as plaintext Text, a database leak (a backup, a
mis-scoped read replica, a SQL-injection bug elsewhere) would have bypassed
mandatory admin 2FA outright. Each secret is now a Fernet token
(AES-128-CBC + HMAC-SHA256, from the `cryptography` package): confidential
AND authenticated, so a tampered or wrong-key value is detected, never
silently decrypted into a different secret.

Callers don't use this module directly -- the User model's totp_secret /
totp_pending_secret properties do (app/models/models.py), so every read and
write of either column goes through here and no code path can store
plaintext by accident. The data migration that encrypted pre-existing
secrets (alembic f7c2a9d4e1b8) deliberately carries its own copy of the
Fernet calls rather than importing this module, so later changes here can't
silently change what that historical migration does.

Failure is loud by design: decrypt_totp_secret raises
TotpSecretDecryptionError rather than returning None/"" -- a value that
can't be decrypted (wrong/rotated-away key, corruption, or a plaintext
value that never went through the migration) must never be mistaken for
"no 2FA" or quietly fail every code check. It surfaces through main.py's
global handler as a logged 500 (Sentry-captured when configured), and the
TOTP step is not attempted, so no lockout counter moves either.
"""
from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.core import config


class TotpSecretDecryptionError(RuntimeError):
    """A stored TOTP secret could not be decrypted with any configured key."""


def _keyring() -> MultiFernet:
    # Rebuilt per call (cheap: base64-decoding a few keys) so it always
    # reflects config.TOTP_ENCRYPTION_KEYS -- the first key encrypts, every
    # key is tried on decrypt (see config.py on rotation).
    return MultiFernet([Fernet(key) for key in config.TOTP_ENCRYPTION_KEYS])


def encrypt_totp_secret(secret: str) -> str:
    if not isinstance(secret, str) or not secret:
        raise ValueError("A TOTP secret to encrypt must be a non-empty string.")
    return _keyring().encrypt(secret.encode("utf-8")).decode("ascii")


def decrypt_totp_secret(stored: str) -> str:
    try:
        return _keyring().decrypt(stored.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeError, TypeError, AttributeError) as exc:
        # Never include `stored` (or anything derived from it) in the
        # message -- this ends up in logs/Sentry.
        raise TotpSecretDecryptionError(
            "A stored TOTP secret could not be decrypted with the configured TOTP_ENCRYPTION_KEY. "
            "Check that the key matches the one the secret was encrypted with (and that the TOTP "
            "encryption migration has run)."
        ) from exc
