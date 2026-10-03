"""Password hashing, JWT issuance, and the two-factor challenge-token pattern.

Retained as-is from MathPath's app/core/security.py (Phase 0 audit, "Retain
as-is" bucket) -- this is generic auth mechanics with no Abacus-specific
logic anywhere in it.
"""
import hashlib
import hmac
import re
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import ACCESS_TOKEN_EXPIRE_MINUTES, ALGORITHM, SECRET_KEY

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    # A password bcrypt cannot be given at all (one containing a NUL byte,
    # or text that is not valid Unicode) is not anyone's password. It used
    # to raise from inside the hasher and surface as a 500 on sign-in;
    # it is simply wrong.
    try:
        return pwd_context.verify(password, password_hash)
    except (ValueError, UnicodeError):
        return False


# A7 fix (30 Sep 2026 security/DPDP review): a login attempt against an
# identifier that matches no account used to skip bcrypt entirely and return
# immediately, while an attempt against a real account always ran a bcrypt
# verify first -- bcrypt is deliberately slow (~100ms+), so the two cases
# were trivially distinguishable by response time alone, letting an attacker
# enumerate valid identifiers without ever seeing a different status code or
# message. Hashed once at import time (a fixed, unguessable plaintext -- it
# is never anyone's real password) so auth_service.login() can run the same
# bcrypt verify on this constant when no user is found, equalizing the
# timing of both code paths.
_DUMMY_PASSWORD_HASH = hash_password("0f3a9c2e-7b1d-4e5a-9f8c-timing-equalization-only")


def verify_dummy_password() -> None:
    """Run a throwaway bcrypt verify, purely to burn the same wall-clock time
    a real verify_password() call would have taken. See _DUMMY_PASSWORD_HASH
    above for why this exists."""
    pwd_context.verify("irrelevant-input", _DUMMY_PASSWORD_HASH)


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


MAX_PASSWORD_BYTES = 72


def strong_password_issue(password: str) -> str | None:
    """Return a human-readable validation error, or None if the password is strong enough.

    Applied wherever a PERSON chooses a password: the self-service
    change-password path, and a first password a school types into the bulk
    sheet's optional `password` column (routes_roster.py). Not applied to
    the passwords the system generates itself -- those are random, and a
    rule about memorable-but-weak choices has nothing to say about them.

    The browser runs the same rules as the person types
    (frontend/lib/passwordRules.ts, pinned to this file by its unit tests).
    A rule added here must be added there.
    """
    # Sign-in compares exactly what was typed. A password saved with its
    # edge spaces quietly removed (which is what change-password used to do)
    # then fails at the next sign-in for the person who typed it, or for the
    # password manager that saved it. Refused instead, so what was typed is
    # what is stored.
    if password != password.strip():
        return "Password can't start or end with a space."
    # Nothing a keyboard types into a password box: a pasted tab or line
    # break, a NUL byte the hasher would choke on, half of a surrogate pair.
    try:
        encoded = password.encode("utf-8")
    except UnicodeError:
        return "Password contains characters that can't be used. Please type it again."
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in password):
        return "Password contains characters that can't be used. Please type it again."
    if len(password) < 8:
        return "Password must be at least 8 characters."
    # bcrypt reads only the first 72 bytes. Anything longer would be
    # accepted, and then so would any other password with the same first 72.
    # The limit is in bytes; the sentence says "characters" when that is the
    # same thing, and says why when it is not (a Devanagari letter is three).
    if len(encoded) > MAX_PASSWORD_BYTES:
        if len(password) > MAX_PASSWORD_BYTES:
            return "Password is too long. Keep it to 72 characters or fewer."
        return "Password is too long for the letters it uses. Please shorten it a little."
    if not re.search(r"[A-Za-z]", password):
        return "Password must include at least one letter."
    if not re.search(r"[0-9]", password):
        return "Password must include at least one number."
    if password.lower() in _COMMON_FULL_PATTERNS or _base_word(password) in _COMMON_PASSWORD_ROOTS:
        return "That password is too common and easy to guess. Please choose a less predictable one."
    if _is_trivially_patterned(password):
        return "That password is a predictable pattern (repeated or sequential characters). Please choose something less guessable."
    return None


# B11 fix (30 Sep 2026 review): STUDENT sessions previously renewed on the
# same 24-hour idle window as every other role, on shared/school-lab
# computers, indefinitely for as long as the device kept being used by
# *someone*. Roles not listed here keep the global ACCESS_TOKEN_EXPIRE_MINUTES
# idle window unchanged; see session_service.py's MAX_SESSION_LIFETIME_MINUTES_BY_ROLE
# for the companion absolute-lifetime cap on the same role.
ACCESS_TOKEN_EXPIRE_MINUTES_BY_ROLE: dict[str, int] = {
    "STUDENT": 480,  # 8 hours -- covers a full school day without renewing indefinitely overnight
}


def expire_minutes_for_role(role: str) -> int:
    return ACCESS_TOKEN_EXPIRE_MINUTES_BY_ROLE.get(role, ACCESS_TOKEN_EXPIRE_MINUTES)


def password_fingerprint(password_hash: str) -> str:
    """A short, keyed digest of a stored password hash, carried in a token
    as its "pwd" claim (3 Oct 2026).

    Why it exists. "Changing a password ends every session" used to rest on
    one comparison: a token's `iat` against `password_changed_at`. Both are
    clock readings, compared in whole seconds, so anything stamped in the
    same second as the change survived it -- a token renewed a moment
    before, or one from a sign-in with the OLD password that was already in
    flight when the change committed. That mattered little while a change
    always ended the session that made it. It matters now that the browser
    making the change can stay signed in: the old tokens of that same
    session must die and its new one must not.

    A token now also says WHICH password it was issued under. The moment
    the stored hash changes -- by its owner, or by an admin's reset -- every
    token issued under the old one stops matching, whatever the clocks say
    (dependencies.py, get_current_user). The `iat` check stays as the
    mechanism for tokens minted before this claim existed.

    Keyed with SECRET_KEY so the claim says nothing about the hash to
    anyone who reads a token; 64 bits is far more than a mismatch check
    needs.
    """
    return hmac.new(SECRET_KEY.encode("utf-8"), password_hash.encode("utf-8"), hashlib.sha256).hexdigest()[:16]


def create_access_token(
    subject: str,
    role: str,
    session_id: str | None = None,
    password_hash: str | None = None,
) -> str:
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

    `password_hash` is the account's stored hash at the moment of issue; it
    becomes the "pwd" claim (see password_fingerprint). Every real issuer
    passes it. Optional for the same reason session_id is.
    """
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=expire_minutes_for_role(role))
    payload = {"sub": subject, "role": role, "exp": expire, "iat": now}
    if session_id:
        payload["sid"] = session_id
    if password_hash:
        payload["pwd"] = password_fingerprint(password_hash)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


TWO_FACTOR_CHALLENGE_EXPIRE_MINUTES = 5


def create_two_factor_challenge_token(subject: str, password_hash: str | None = None) -> str:
    """A short-lived, single-purpose token for the gap between "password
    verified" and "2FA code verified" during login.

    Deliberately NOT a real access token -- it carries a "purpose" claim
    that get_current_user() explicitly rejects (see dependencies.py), so
    even if this token leaked in transit it could not be used to call any
    authenticated endpoint. It can only be redeemed at
    POST /api/auth/2fa/verify-login, and only for 5 minutes.

    `password_hash` is the hash the password step was just passed against;
    it rides along as the same "pwd" claim an access token carries (see
    password_fingerprint), so the second step can refuse to finish a
    sign-in whose password has been changed or reset in the meantime.
    """
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=TWO_FACTOR_CHALLENGE_EXPIRE_MINUTES)
    payload = {"sub": subject, "purpose": "2fa_challenge", "exp": expire, "iat": now}
    if password_hash:
        payload["pwd"] = password_fingerprint(password_hash)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def two_factor_challenge_password_claim(token: str) -> str | None:
    """The "pwd" claim of a valid 2FA challenge token, or None if it has
    none (one issued before the claim existed) or is not such a token."""
    payload = decode_token(token)
    if not payload or payload.get("purpose") != "2fa_challenge":
        return None
    claim = payload.get("pwd")
    return claim if isinstance(claim, str) and claim else None


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
