"""Sign-in tokens after the move from python-jose to PyJWT (13 Oct 2026).

python-jose 3.5.0 carries CVE-2026-85394 with no fixed release, so
app/core/security.py now signs and checks tokens with PyJWT. What is proved
here:

  * A token built by hand to the HS256 standard -- the exact form python-jose
    wrote, header {"alg":"HS256","typ":"JWT"} -- is accepted. So every
    session and every two-factor step issued before the deploy still works.
  * What this app issues is that same standard form.
  * Everything else is refused: no signature ("alg": "none"), any other
    algorithm, the wrong key, a changed payload or signature, an expired
    token, and anything that is not a token at all.
"""
import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import warnings

import jwt

from app.core.config import SECRET_KEY
from app.core.security import (
    create_access_token,
    create_two_factor_challenge_token,
    decode_token,
    decode_two_factor_challenge_token,
)


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _hand_made_token(payload: dict, key: str = SECRET_KEY, header: dict | None = None) -> str:
    """HS256 by the book (RFC 7515/7519), with no JWT library involved."""
    header = header or {"alg": "HS256", "typ": "JWT"}
    signing_input = (
        _b64(json.dumps(header, separators=(",", ":")).encode())
        + "."
        + _b64(json.dumps(payload, separators=(",", ":")).encode())
    )
    signature = hmac.new(key.encode(), signing_input.encode("ascii"), hashlib.sha256).digest()
    return signing_input + "." + _b64(signature)


def _claims(minutes: int = 5, **extra) -> dict:
    now = int(datetime.now(timezone.utc).timestamp())
    return {"sub": "user-123", "role": "ADMIN", "iat": now, "exp": now + minutes * 60, **extra}


def test_a_standard_hs256_token_from_before_the_switch_is_accepted():
    claims = _claims(sid="session-1", pwd="0123456789abcdef")
    assert decode_token(_hand_made_token(claims)) == claims


def test_a_two_factor_step_started_before_the_switch_can_still_finish():
    claims = _claims(purpose="2fa_challenge")
    claims.pop("role")
    assert decode_two_factor_challenge_token(_hand_made_token(claims)) == "user-123"


def test_what_this_app_issues_is_the_same_standard_token():
    token = create_access_token("user-123", "TEACHER", session_id="session-1", password_hash="$2b$12$hash")
    header_part, payload_part, signature_part = token.split(".")
    assert json.loads(base64.urlsafe_b64decode(header_part + "==")) == {"alg": "HS256", "typ": "JWT"}
    expected = hmac.new(SECRET_KEY.encode(), f"{header_part}.{payload_part}".encode(), hashlib.sha256).digest()
    assert signature_part == _b64(expected)
    claims = decode_token(token)
    assert claims["sub"] == "user-123" and claims["role"] == "TEACHER" and claims["sid"] == "session-1"
    assert decode_two_factor_challenge_token(create_two_factor_challenge_token("user-123")) == "user-123"


def test_an_unsigned_token_is_refused():
    header = _b64(json.dumps({"alg": "none", "typ": "JWT"}).encode())
    payload = _b64(json.dumps(_claims()).encode())
    assert decode_token(f"{header}.{payload}.") is None


def test_any_other_algorithm_is_refused_even_with_the_right_key():
    for algorithm in ("HS384", "HS512"):
        with warnings.catch_warnings():
            # The suite's key is shorter than these two algorithms recommend.
            warnings.simplefilter("ignore", jwt.warnings.InsecureKeyLengthWarning)
            token = jwt.encode(_claims(), SECRET_KEY, algorithm=algorithm)
            # The token itself is sound: allowed that algorithm, it would pass.
            assert jwt.decode(token, SECRET_KEY, algorithms=[algorithm])["sub"] == "user-123"
        # So the refusal comes from the algorithm alone.
        assert decode_token(token) is None, algorithm


def test_the_wrong_key_is_refused():
    assert decode_token(_hand_made_token(_claims(), key=SECRET_KEY + "-not-ours")) is None


def test_a_changed_payload_or_signature_is_refused():
    token = _hand_made_token(_claims(role="STUDENT"))
    header_part, _, signature_part = token.split(".")
    promoted = _b64(json.dumps(_claims(role="SUPER_ADMIN"), separators=(",", ":")).encode())
    assert decode_token(f"{header_part}.{promoted}.{signature_part}") is None
    # A character in the middle: every bit of it is signature (the last
    # character of an HS256 signature carries two bits of padding).
    middle = len(signature_part) // 2
    flipped = signature_part[:middle] + ("A" if signature_part[middle] != "A" else "B") + signature_part[middle + 1 :]
    assert decode_token(f"{header_part}.{token.split('.')[1]}.{flipped}") is None


def test_an_expired_token_is_refused():
    assert decode_token(_hand_made_token(_claims(minutes=-1))) is None
    expired = jwt.encode(
        {"sub": "user-123", "exp": datetime.now(timezone.utc) - timedelta(seconds=1)}, SECRET_KEY, algorithm="HS256"
    )
    assert decode_token(expired) is None


def test_anything_that_is_not_a_token_is_refused():
    for value in ("", "not-a-token", "a.b", "a.b.c", "....", "x" * 5000, "\ud800", "é.é.é"):
        assert decode_token(value) is None, value[:20]


def test_a_two_factor_step_with_unreadable_text_is_refused_not_a_server_error(client):
    """A lone surrogate is valid JSON and reaches the route; it used to be a 500."""
    response = client.post(
        "/api/auth/2fa/verify-login",
        content=b'{"challengeToken": "\\ud800", "code": "123456"}',
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 401, response.text
