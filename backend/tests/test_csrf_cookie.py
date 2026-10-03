"""The CSRF cookie is one cookie shared by every role signed in on a
browser. Signing out of any one of them deletes it, and until 3 Oct 2026
nothing but signing in again ever put it back -- so with two roles signed in
side by side, signing one out left the other unable to change anything, and
told to "refresh the page" when a refresh did not help.

These pin the repair (app/core/cookies.py, touch_csrf_cookie): any
authenticated request re-issues a missing cookie, and doing so opens nothing
to a request that arrives without the matching header.
"""
from app.core.security import hash_password
from app.models import User

PASSWORD = "Xk4$nQ8vPz"
AS_TEACHER = {"X-Auth-Role": "TEACHER"}
AS_STUDENT = {"X-Auth-Role": "STUDENT"}


def _user(db, email: str, role: str) -> User:
    user = User(full_name="Csrf Test User", email=email, password_hash=hash_password(PASSWORD), role=role)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _login(client, email: str) -> None:
    response = client.post("/api/auth/login", json={"identifier": email, "password": PASSWORD})
    assert response.status_code == 200, response.text


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("se_csrf")}


def _two_roles_then_sign_the_teacher_out(client, db, tag: str):
    # The schema is shared by the whole test session, so each test brings
    # its own pair of accounts.
    _user(db, f"csrf-teacher-{tag}@example.com", "TEACHER")
    _user(db, f"csrf-student-{tag}@example.com", "STUDENT")
    _login(client, f"csrf-teacher-{tag}@example.com")
    _login(client, f"csrf-student-{tag}@example.com")
    signed_out = client.post("/api/auth/logout", headers={**_csrf(client), **AS_TEACHER})
    assert signed_out.status_code == 200
    # /logout answers with two Set-Cookie headers for se_csrf, in this
    # order: the usual refresh of its value, then its deletion.
    csrf_headers = [h for h in signed_out.headers.get_list("set-cookie") if h.startswith("se_csrf=")]
    assert len(csrf_headers) == 2 and "Max-Age=0" in csrf_headers[-1], csrf_headers
    # A browser applies them in order, so the cookie ends up gone. The test
    # client's cookie jar applies deletions first and keeps the value, so
    # the browser's result is reproduced here by hand.
    client.cookies.delete("se_csrf")
    # The situation these tests are about: the student is still signed in,
    # and the shared CSRF cookie went with the teacher.
    assert client.cookies.get("se_csrf") is None
    assert client.cookies.get("se_student_sess")


def test_signing_one_role_out_takes_the_shared_csrf_cookie_and_the_next_request_brings_it_back(client, db_session):
    _two_roles_then_sign_the_teacher_out(client, db_session, "reissue")

    me = client.get("/api/auth/me", headers=AS_STUDENT)
    assert me.status_code == 200
    assert me.json()["role"] == "STUDENT"
    reissued = client.cookies.get("se_csrf")
    assert reissued, "an authenticated request should have re-issued the CSRF cookie"

    # ...and with it the student can change things again, without signing in.
    signed_out = client.post("/api/auth/logout", headers={"X-CSRF-Token": reissued, **AS_STUDENT})
    assert signed_out.status_code == 200


def test_a_change_made_while_the_cookie_is_missing_is_still_refused(client, db_session):
    _two_roles_then_sign_the_teacher_out(client, db_session, "refused")

    # No cookie, no header: exactly what a forged cross-site request looks like.
    refused = client.post("/api/auth/logout", headers=AS_STUDENT)
    assert refused.status_code == 403
    assert refused.json()["detail"]["code"] == "CSRF_VALIDATION_FAILED"
    # A header alone is no better: there is no cookie for it to match.
    guessed = client.post("/api/auth/logout", headers={"X-CSRF-Token": "anything", **AS_STUDENT})
    assert guessed.status_code == 403
    # The refusal itself must not hand out a cookie (a refused request gets
    # nothing), and the session it was aimed at is untouched.
    assert "se_csrf" not in refused.cookies and "se_csrf" not in guessed.cookies
    assert client.get("/api/auth/me", headers=AS_STUDENT).status_code == 200


def test_a_reissued_cookie_does_not_let_a_request_through_without_the_matching_header(client, db_session):
    _two_roles_then_sign_the_teacher_out(client, db_session, "header")
    client.get("/api/auth/me", headers=AS_STUDENT)
    assert client.cookies.get("se_csrf")

    # The browser now sends the cookie by itself, as it would for a forged
    # request; only the page that can READ it can also send the header.
    without_header = client.post("/api/auth/logout", headers=AS_STUDENT)
    assert without_header.status_code == 403
    wrong_header = client.post("/api/auth/logout", headers={"X-CSRF-Token": "not-the-cookie", **AS_STUDENT})
    assert wrong_header.status_code == 403


def test_an_existing_cookie_keeps_its_value(client, db_session):
    _user(db_session, "csrf-steady@example.com", "TEACHER")
    _login(client, "csrf-steady@example.com")
    before = client.cookies.get("se_csrf")

    for _ in range(3):
        assert client.get("/api/auth/me").status_code == 200
    assert client.cookies.get("se_csrf") == before


def test_no_cookie_is_issued_to_someone_who_is_not_signed_in(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 401
    assert "se_csrf" not in response.cookies
    assert client.cookies.get("se_csrf") is None


def test_any_signed_in_request_reissues_it_not_only_the_session_check(client, db_session):
    _two_roles_then_sign_the_teacher_out(client, db_session, "anyget")

    # An ordinary data request a page makes by itself -- no refresh needed.
    listed = client.get("/api/auth/sessions", headers=AS_STUDENT)
    assert listed.status_code == 200
    assert client.cookies.get("se_csrf")


def test_a_session_that_has_been_ended_is_not_handed_a_csrf_cookie(client, db_session):
    _user(db_session, "csrf-revoked@example.com", "TEACHER")
    _login(client, "csrf-revoked@example.com")
    everywhere = client.post("/api/auth/logout-all-sessions", headers=_csrf(client))
    assert everywhere.status_code == 200
    # Keep presenting the old session cookie, as a stolen or stale copy
    # would, with no CSRF cookie beside it.
    stale_session = everywhere.request.headers.get("cookie", "")
    token = next(part.split("=", 1)[1] for part in stale_session.split("; ") if part.startswith("se_teacher_sess="))
    client.cookies.clear()
    client.cookies.set("se_teacher_sess", token)

    refused = client.get("/api/auth/me", headers=AS_TEACHER)
    assert refused.status_code == 401
    assert "se_csrf" not in refused.cookies
    assert client.cookies.get("se_csrf") is None
