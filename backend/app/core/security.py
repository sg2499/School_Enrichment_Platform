"""Password hashing, JWT issuance, and the two-factor challenge-token pattern.

Retained as-is from MathPath's app/core/security.py (Phase 0 audit, "Retain
as-is" bucket) -- this is generic auth mechanics with no Abacus-specific
logic anywhere in it.
"""
import re
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import ACCESS_TOKEN_EXPIRE_MINUTES, ALGORITHM, SECRET_KEY

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def strong_password_issue(password: str) -> str | None:
    """Return a human-readable validation error, or None if the password is strong enough.

    Deliberately used ONLY at the self-service change-password path, not at
    account creation or admin-triggered reset. Admin-issued initial/reset
    passwords intentionally stay simple (e.g. a first-last-name pattern) so
    onboarding many students/teachers at once stays practical -- the real
    policy applies the moment someone takes ownership of their own account
    and picks their own password.
    """
    if len(password) < 8:
        return "Password must be at least 8 characters."
    if not re.search(r"[A-Za-z]", password):
        return "Password must include at least one letter."
    if not re.search(r"[0-9]", password):
        return "Password must include at least one number."
    return None


def create_access_token(subject: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": subject, "role": role, "exp": expire, "iat": now}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


TWO_FACTOR_CHALLENGE_EXPIRE_MINUTES = 5


def create_two_factor_challenge_token(subject: str) -> str:
    """A short-lived, single-purpose token for the gap between "password
    verified" and "2FA code verified" during login.

    Deliberately NOT a real access token -- it carries a "purpose" claim
    that get_current_user() explicitly rejects (see dependencies.py), so
    even if this token leaked in transit it could not be used to call any
    authenticated endpoint. It can only be redeemed at
    POST /api/auth/2fa/verify-login, and only for 5 minutes.
    """
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=TWO_FACTOR_CHALLENGE_EXPIRE_MINUTES)
    payload = {"sub": subject, "purpose": "2fa_challenge", "exp": expire, "iat": now}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_two_factor_challenge_token(token: str) -> str | None:
    """Return the user id encoded in a valid, unexpired 2FA challenge token, or None."""
    payload = decode_token(token)
    if not payload or payload.get("purpose") != "2fa_challenge":
        return None
    return payload.get("sub")


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
