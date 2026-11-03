"""#213 (3 Nov 2026): Krama on its own addresses.

The browser used to reach this API only through Vercel's rewrite, so every
school's requests arrived at Render from Vercel's shared servers, and
Render's front door sometimes refused them as "Too Many Requests" before
this app saw them. Now the app (krama.zetta-metrics.com) calls the API
directly (api.krama.zetta-metrics.com). These pin what that needs:

- cookies issued for the shared parent when, and only when, the request came
  in on an address under it, and cleared with the same Domain;
- the caller's address read from the header Render's front door writes, not
  from one a client can forge;
- rate limits per signed-in account, so a class behind one school
  connection does not share one allowance.
"""
from http.cookies import SimpleCookie

import pytest
from starlette.requests import Request

from app.core import cookies as cookies_module
from app.core import rate_limit as rate_limit_module
from app.core.rate_limit import account_or_ip_key, get_real_client_ip
from app.core.security import create_access_token, create_two_factor_challenge_token, hash_password
from app.models import User

PASSWORD = "Xk4$nQ8vPz"
PARENT = "krama.example.test"
API_HOST = f"api.{PARENT}"


@pytest.fixture()
def own_addresses(monkeypatch):
    monkeypatch.setattr(cookies_module, "COOKIE_DOMAIN", PARENT)
    monkeypatch.setattr(rate_limit_module, "COOKIE_DOMAIN", PARENT)


def _request(headers: dict, client_host: str = "10.0.0.9") -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/x",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": (client_host, 1234),
        "query_string": b"",
    }
    return Request(scope)


def _user(db, email: str, role: str = "TEACHER") -> User:
    user = User(full_name="Address Test User", email=email, password_hash=hash_password(PASSWORD), role=role)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _set_cookies(response) -> dict[str, dict]:
    found = {}
    for raw in response.headers.get_list("set-cookie"):
        jar = SimpleCookie()
        jar.load(raw)
        for name, morsel in jar.items():
            found[name] = {"value": morsel.value, "domain": morsel["domain"], "path": morsel["path"], "raw": raw}
    return found


# ---------------------------------------------------------------- cookies


def test_cookie_domain_follows_the_address_the_request_came_in_on(own_addresses):
    assert cookies_module.cookie_domain_for(_request({"host": API_HOST})) == PARENT
    assert cookies_module.cookie_domain_for(_request({"host": f"{API_HOST}:443"})) == PARENT
    assert cookies_module.cookie_domain_for(_request({"host": PARENT})) == PARENT
    # Vercel's rewrite calls the onrender.com address: host-only, as before.
    assert cookies_module.cookie_domain_for(_request({"host": "school-enrichment-backend.onrender.com"})) is None
    # A look-alike is not "under" the parent.
    assert cookies_module.cookie_domain_for(_request({"host": f"evil{PARENT}"})) is None


def test_no_cookie_domain_configured_changes_nothing(monkeypatch):
    monkeypatch.setattr(cookies_module, "COOKIE_DOMAIN", None)
    assert cookies_module.cookie_domain_for(_request({"host": API_HOST})) is None


def test_sign_in_on_the_api_address_issues_cookies_for_the_parent(client, db_session, own_addresses):
    _user(db_session, "addr-direct@example.com")
    response = client.post(
        "/api/auth/login",
        json={"identifier": "addr-direct@example.com", "password": PASSWORD},
        headers={"host": API_HOST},
    )
    assert response.status_code == 200, response.text
    issued = _set_cookies(response)
    assert issued["se_teacher_sess"]["domain"] == PARENT
    assert issued["se_teacher_sess"]["path"] == "/api"
    assert "httponly" in issued["se_teacher_sess"]["raw"].lower()
    assert "samesite=lax" in issued["se_teacher_sess"]["raw"].lower()
    assert issued["se_csrf"]["domain"] == PARENT
    assert issued["se_csrf"]["path"] == "/"


def test_sign_in_through_the_rewrite_keeps_host_only_cookies(client, db_session, own_addresses):
    _user(db_session, "addr-rewrite@example.com")
    response = client.post(
        "/api/auth/login",
        json={"identifier": "addr-rewrite@example.com", "password": PASSWORD},
        headers={"host": "school-enrichment-backend.onrender.com"},
    )
    assert response.status_code == 200, response.text
    issued = _set_cookies(response)
    assert issued["se_teacher_sess"]["domain"] == ""
    assert issued["se_csrf"]["domain"] == ""


def test_sign_out_on_the_api_address_clears_with_the_same_domain(client, db_session, own_addresses):
    _user(db_session, "addr-out@example.com")
    headers = {"host": API_HOST}
    login = client.post("/api/auth/login", json={"identifier": "addr-out@example.com", "password": PASSWORD}, headers=headers)
    assert login.status_code == 200, login.text
    token = _set_cookies(login)["se_teacher_sess"]["value"]
    csrf = _set_cookies(login)["se_csrf"]["value"]
    response = client.post(
        "/api/auth/logout",
        headers={**headers, "X-Auth-Role": "TEACHER", "X-CSRF-Token": csrf,
                 "cookie": f"se_teacher_sess={token}; se_csrf={csrf}"},
    )
    assert response.status_code == 200, response.text
    cleared = _set_cookies(response)
    assert cleared["se_teacher_sess"]["domain"] == PARENT and cleared["se_teacher_sess"]["value"] == ""
    assert cleared["se_csrf"]["domain"] == PARENT and cleared["se_csrf"]["value"] == ""


def test_a_signed_in_request_on_the_api_address_renews_the_csrf_cookie_for_the_parent(client, db_session, own_addresses):
    _user(db_session, "addr-touch@example.com")
    headers = {"host": API_HOST}
    login = client.post("/api/auth/login", json={"identifier": "addr-touch@example.com", "password": PASSWORD}, headers=headers)
    token = _set_cookies(login)["se_teacher_sess"]["value"]
    client.cookies.clear()
    me = client.get("/api/auth/me", headers={**headers, "X-Auth-Role": "TEACHER", "cookie": f"se_teacher_sess={token}"})
    assert me.status_code == 200, me.text
    assert _set_cookies(me)["se_csrf"]["domain"] == PARENT


# ---------------------------------------------------------------- the caller's address


def test_direct_requests_use_the_address_the_front_door_saw(own_addresses):
    request = _request({"host": API_HOST, "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4, 203.0.113.7"})
    assert get_real_client_ip(request) == "203.0.113.7"


def test_a_forged_forwarded_for_does_not_choose_the_address_on_a_direct_request(own_addresses):
    # A caller can put anything at the front of X-Forwarded-For; on a direct
    # request it is not what decides their rate-limit bucket.
    first = _request({"host": API_HOST, "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "9.9.9.1"})
    second = _request({"host": API_HOST, "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "9.9.9.2"})
    assert get_real_client_ip(first) == get_real_client_ip(second) == "203.0.113.7"


def test_a_malformed_front_door_header_is_not_used(own_addresses):
    request = _request({"host": API_HOST, "cf-connecting-ip": "not-an-ip", "x-forwarded-for": "198.51.100.4"})
    assert get_real_client_ip(request) == "198.51.100.4"


def test_requests_through_the_rewrite_keep_the_first_forwarded_hop(own_addresses):
    # Through Vercel, CF-Connecting-IP is Vercel's shared server: not used.
    request = _request({
        "host": "school-enrichment-backend.onrender.com",
        "cf-connecting-ip": "76.76.21.21",
        "x-forwarded-for": "198.51.100.4, 76.76.21.21",
    })
    assert get_real_client_ip(request) == "198.51.100.4"


def test_with_no_headers_the_connection_address_is_used(own_addresses):
    assert get_real_client_ip(_request({"host": "localhost"}, client_host="127.0.0.1")) == "127.0.0.1"


def test_sign_in_records_the_callers_address(client, db_session, own_addresses):
    from app.models import UserSession

    user = _user(db_session, "addr-session@example.com")
    response = client.post(
        "/api/auth/login",
        json={"identifier": "addr-session@example.com", "password": PASSWORD},
        headers={"host": API_HOST, "cf-connecting-ip": "203.0.113.50"},
    )
    assert response.status_code == 200, response.text
    session = db_session.query(UserSession).filter(UserSession.user_id == user.id).one()
    assert session.ip_address == "203.0.113.50"


# ---------------------------------------------------------------- rate-limit keys


def test_signed_in_requests_are_limited_per_account(own_addresses):
    token_a = create_access_token("user-a", "STUDENT")
    token_b = create_access_token("user-b", "STUDENT")
    same_school = {"host": API_HOST, "cf-connecting-ip": "203.0.113.7"}
    a = _request({**same_school, "cookie": f"se_student_sess={token_a}"})
    b = _request({**same_school, "cookie": f"se_student_sess={token_b}"})
    assert account_or_ip_key(a) == "account:user-a"
    assert account_or_ip_key(b) == "account:user-b"


def test_a_made_up_cookie_does_not_buy_a_fresh_allowance(own_addresses):
    request = _request({"host": API_HOST, "cf-connecting-ip": "203.0.113.7", "cookie": "se_student_sess=made-up"})
    assert account_or_ip_key(request) == "203.0.113.7"


def test_a_second_step_token_is_not_an_account_key(own_addresses):
    challenge = create_two_factor_challenge_token("user-c")
    request = _request({"host": API_HOST, "cf-connecting-ip": "203.0.113.7", "authorization": f"Bearer {challenge}"})
    assert account_or_ip_key(request) == "203.0.113.7"


def test_a_class_behind_one_connection_is_not_refused_together(client, db_session, own_addresses):
    """Forty-one students, one school address, a few requests each: nobody
    is turned away. Before #213 the default 200-a-minute was per address."""
    students = [_user(db_session, f"addr-class-{n}@example.com", "STUDENT") for n in range(41)]
    school = {"host": API_HOST, "cf-connecting-ip": "203.0.113.99", "X-Auth-Role": "STUDENT"}
    for student in students:
        token = create_access_token(student.id, "STUDENT")
        client.cookies.clear()
        for _ in range(5):
            response = client.get("/api/auth/me", headers={**school, "cookie": f"se_student_sess={token}"})
            assert response.status_code == 200, response.text


def test_sign_in_allows_a_class_from_one_connection(client, db_session, own_addresses):
    _user(db_session, "addr-many@example.com")
    school = {"host": API_HOST, "cf-connecting-ip": "203.0.113.120"}
    for _ in range(100):
        client.cookies.clear()
        response = client.post("/api/auth/login", json={"identifier": "nobody@example.com", "password": "wrong"}, headers=school)
        assert response.status_code != 429, "refused before a class's worth of sign-ins"


def test_sign_in_still_has_a_ceiling_per_address(client, own_addresses):
    school = {"host": API_HOST, "cf-connecting-ip": "203.0.113.121"}
    statuses = []
    for _ in range(125):
        client.cookies.clear()
        statuses.append(client.post("/api/auth/login", json={"identifier": "nobody@example.com", "password": "wrong"}, headers=school).status_code)
    assert 429 in statuses


def test_a_refusal_tells_a_cross_origin_page_when_to_retry(client, own_addresses):
    from app.core.config import FRONTEND_URL

    school = {"host": API_HOST, "cf-connecting-ip": "203.0.113.122", "origin": FRONTEND_URL}
    response = None
    for _ in range(125):
        response = client.post("/api/auth/login", json={"identifier": "nobody@example.com", "password": "wrong"}, headers=school)
        if response.status_code == 429:
            break
    assert response is not None and response.status_code == 429
    assert response.headers.get("retry-after")
    exposed = response.headers.get("access-control-expose-headers", "").lower()
    assert "retry-after" in exposed
    assert response.json()["detail"]["code"] == "RATE_LIMITED"


def test_cors_allows_only_listed_origins(client):
    from app.core.config import FRONTEND_URL

    allowed = client.options(
        "/api/auth/login",
        headers={"origin": FRONTEND_URL, "access-control-request-method": "POST"},
    )
    assert allowed.headers.get("access-control-allow-origin") == FRONTEND_URL.rstrip("/")
    assert allowed.headers.get("access-control-allow-credentials") == "true"
    refused = client.options(
        "/api/auth/login",
        headers={"origin": "https://elsewhere.example", "access-control-request-method": "POST"},
    )
    assert refused.headers.get("access-control-allow-origin") is None


def test_the_second_sign_in_step_is_limited_per_sign_in(own_addresses):
    import json

    from app.api.routes_auth import _challenge_key

    school = {"host": API_HOST, "cf-connecting-ip": "203.0.113.7", "content-type": "application/json"}
    a = _request(school)
    a._body = json.dumps({"challengeToken": create_two_factor_challenge_token("admin-a"), "code": "000000"}).encode()
    b = _request(school)
    b._body = json.dumps({"challengeToken": create_two_factor_challenge_token("admin-b"), "code": "000000"}).encode()
    forged = _request(school)
    forged._body = json.dumps({"challengeToken": "not-a-token", "code": "000000"}).encode()
    assert _challenge_key(a) == "challenge:admin-a"
    assert _challenge_key(b) == "challenge:admin-b"
    assert _challenge_key(forged) == "203.0.113.7"


def test_the_second_sign_in_step_reads_the_body_in_the_running_app(client, db_session, own_addresses):
    """The key function runs inside the route wrapper, after FastAPI has read
    the body: checked on the real route, not only in isolation."""
    limits = [l for route_limits in rate_limit_module.limiter._route_limits.values() for l in route_limits]
    keyed = [l for l in limits if getattr(l.key_func, "__name__", "") == "_challenge_key"]
    assert keyed, "verify-login is not limited per sign-in"
    user = _user(db_session, "addr-2fa@example.com", "ADMIN")
    token = create_two_factor_challenge_token(user.id)
    response = client.post(
        "/api/auth/2fa/verify-login",
        json={"challengeToken": token, "code": "000000"},
        headers={"host": API_HOST, "cf-connecting-ip": "203.0.113.8"},
    )
    assert response.status_code in (401, 400, 422), response.text
    storage = rate_limit_module.limiter._storage
    counted = " ".join(str(k) for k in getattr(storage, "storage", {}))
    assert f"challenge:{user.id}" in counted, counted
