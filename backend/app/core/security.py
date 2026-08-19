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


# 2026-08-19 security hardening: a length/character-class check alone still
# lets through "Password1" or "Welcome123" -- both technically pass the old
# rule but are at the top of every real-world breach/credential-stuffing
# wordlist. Rather than trying to enumerate every "word + trailing digits"
# combination as a literal string (an unmaintainable, easily-dodged list),
# _base_word() below strips the part a person predictably bolts on --
# trailing digits, a trailing "!" -- and undoes common leetspeak swaps
# (P@ssw0rd -> password), then checks the remaining root against this
# small set of common password roots. It is deliberately NOT an attempt to
# replicate a full breached-password API (e.g. Have I Been Pwned's
# k-anonymity range API) -- that would mean an outbound network call from
# every password-change request, a new external dependency and failure
# mode, for a check whose highest-value target (the passwords below, which
# dominate real breach corpora) it already catches locally, instantly, and
# offline.
_COMMON_PASSWORD_ROOTS = frozenset(
    {
        "password", "qwerty", "qwertyuiop", "letmein", "welcome", "admin", "administrator",
        "iloveyou", "trustno", "sunshine", "princess", "football", "baseball", "dragon",
        "monkey", "shadow", "master", "superman", "batman", "changeme", "root", "student",
        "teacher", "school", "mypassword", "qazwsx", "zxcvbnm", "abcdef", "abcdefg",
        "abcdefgh", "passw0rd", "p@ssword",
    }
)

# A handful of specific full patterns (keyboard walks with interspersed
# digits, e.g. "1qaz2wsx") that _base_word()'s trailing-strip wouldn't
# catch since the digits aren't only at the end -- checked as exact,
# unmodified (lowercased) matches rather than against the root set above.
_COMMON_FULL_PATTERNS = frozenset({"1qaz2wsx", "1qaz2wsx3edc", "1q2w3e4r", "q1w2e3r4"})

_LEET_SUBSTITUTIONS = {"@": "a", "$": "s", "0": "o", "1": "i", "3": "e", "!": "i"}


def _base_word(password: str) -> str:
    """Lowercase, strip a trailing run of digits/"!" (the part people
    predictably append to satisfy a "must include a number" rule), then
    undo leetspeak substitutions on what's left -- turns "Password123",
    "P@ssw0rd!", and "welcome1" all into their plain-word root so one entry
    in _COMMON_PASSWORD_ROOTS covers every trivial variant of it."""
    lowered = password.lower()
    stripped = lowered.rstrip("0123456789!")
    return "".join(_LEET_SUBSTITUTIONS.get(ch, ch) for ch in stripped)


def _is_trivially_patterned(password: str) -> bool:
    """Catches sequential runs ("12345678", "abcdefgh") and single-character
    repeats ("aaaaaaaa") that a fixed wordlist won't enumerate but are just
    as weak -- these are pattern checks, not membership checks."""
    if len(set(password)) == 1:
        return True
    lowered = password.lower()
    ascending = all(ord(lowered[i + 1]) - ord(lowered[i]) == 1 for i in range(len(lowered) - 1))
    descending = all(ord(lowered[i]) - ord(lowered[i + 1]) == 1 for i in range(len(lowered) - 1))
    return ascending or descending


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
    if password.lower() in _COMMON_FULL_PATTERNS or _base_word(password) in _COMMON_PASSWORD_ROOTS:
        return "That password is too common and easy to guess. Please choose a less predictable one."
    if _is_trivially_patterned(password):
        return "That password is a predictable pattern (repeated or sequential characters). Please choose something less guessable."
    return None


def create_access_token(subject: str, role: str, session_id: str | None = None) -> str:
    """`session_id` (the "sid" claim) is the stable identifier of a single
    login for the life of that login, distinct from `exp`/`iat` which move
    on every sliding-renewal reissue (see dependencies.py's get_current_user).
    A fresh login passes a newly generated session_id (see auth_service.login
    and routes_auth.py's two_factor_verify_login, which also create the
    matching UserSession row); a renewal passes the sid already on the token
    being renewed, so the session stays the same "device" in the user's
    Security Settings list across the whole login, not a new row every
    renewal. session_id is optional only for backward compatibility with
    call sites that don't yet track sessions (e.g. tests exercising the
    token mechanics directly) -- a token with no sid simply isn't subject to
    the per-session revocation/lifetime checks in get_current_user().
    """
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": subject, "role": role, "exp": expire, "iat": now}
    if session_id:
        payload["sid"] = session_id
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
