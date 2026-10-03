"""The first password is the school's; the second has to be the person's own
(3 Oct 2026, UI revamp Phase B, slice 3).

What is proved here:

  * A teacher or student holding a password somebody else issued can sign in
    and can reach exactly what they need to replace it -- and nothing else.
    Until 3 Oct 2026 this gate covered admins only.
  * Replacing it with `keepSignedIn` leaves them signed in on that browser
    and signs every other session of the account out.
  * "Replace" means replace: the issued password typed again is refused.
  * A session token is bound to the password it was issued under, so a
    change ends the old password's sessions exactly -- including ones the
    clock cannot tell apart from the change itself.
  * A class behind one school connection can all get through.
  * The optional `password` column of a bulk sheet: a row's own password is
    used, held to the rules a person's own choice is held to, and still has
    to be replaced at first sign-in.

Same fixture and sign-in pattern as test_roster.py, kept local to this file
the way the other test files keep theirs.
"""
import io

import pyotp
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.api.routes_roster import _cell_text
from app.core.security import (
    create_access_token,
    decode_token,
    hash_password,
    password_fingerprint,
    strong_password_issue,
    verify_password,
)
from app.core.totp import ISSUER_NAME, totp_provisioning_uri
from app.main import _SENTRY_DENYLIST_FIELDS, app
from app.models import AuditLog, School, SchoolAdmin, Student, User, UserSession
from app.services.session_service import start_session

PASSWORD = "Passw0rd1"
OWN_PASSWORD = "Mango-Tree-42"
TEST_TOTP_SECRET = pyotp.random_base32()

_AS = {role: {"x-auth-role": role} for role in ("ADMIN", "SUPER_ADMIN", "TEACHER", "STUDENT")}


def _make_school_admin(db, email: str, school_name: str):
    school = School(name=school_name, board="CBSE", city="Bengaluru")
    db.add(school)
    db.flush()
    user = User(
        full_name="School Admin",
        email=email,
        password_hash=hash_password(PASSWORD),
        role="ADMIN",
        totp_enabled=True,
        totp_secret=TEST_TOTP_SECRET,
    )
    db.add(user)
    db.flush()
    db.add(SchoolAdmin(user_id=user.id, school_id=school.id))
    db.commit()
    return user, school


def _admin_headers(client, email: str) -> dict:
    challenge = client.post("/api/auth/login", json={"identifier": email, "password": PASSWORD}).json()
    verified = client.post(
        "/api/auth/2fa/verify-login",
        json={"challengeToken": challenge["challengeToken"], "code": pyotp.TOTP(TEST_TOTP_SECRET).now()},
    )
    assert verified.status_code == 200
    return {"x-csrf-token": client.cookies.get("se_csrf"), **_AS["ADMIN"]}


def _create(client, headers, **person) -> dict:
    response = client.post("/api/roster/people", json=person, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _sign_in(client, identifier: str, password: str):
    return client.post("/api/auth/login", json={"identifier": identifier, "password": password})


def _own_headers(client, role: str) -> dict:
    return {"x-csrf-token": client.cookies.get("se_csrf"), **_AS[role]}


def _change(client, role: str, current: str, new: str, **extra):
    return client.post(
        "/api/auth/change-password",
        json={"currentPassword": current, "newPassword": new, **extra},
        headers=_own_headers(client, role),
    )


def _new_person(client, db_session, tag: str, role: str) -> dict:
    """An account the school has just created, with its issued password."""
    admin, _school = _make_school_admin(db_session, f"first-admin-{tag}@example.com", f"First Password School {tag}")
    headers = _admin_headers(client, admin.email)
    extra = {"className": "7", "section": "A"} if role == "STUDENT" else {}
    person = _create(client, headers, role=role, fullName=f"New {role.title()} {tag}", **extra)
    # The admin's cookies are per role, so they do not get in the way of the
    # teacher or student signing in on the same client.
    return person


# --- The gate ----------------------------------------------------------------


def test_an_issued_password_lets_a_teacher_in_only_as_far_as_replacing_it(client, db_session):
    teacher = _new_person(client, db_session, "gate-t", "TEACHER")

    signed_in = _sign_in(client, teacher["code"], teacher["initialPassword"])
    assert signed_in.status_code == 200
    # The sign-in itself says so, which is what lets the sign-in page go
    # straight to its "choose your own password" step.
    assert signed_in.json()["user"]["mustChangePassword"] is True

    # They can be told who they are...
    me = client.get("/api/auth/me", headers=_AS["TEACHER"])
    assert me.status_code == 200 and me.json()["mustChangePassword"] is True

    # ...and nothing else, with a sentence a person can act on.
    for path in ("/api/teacher-assignments/my-sections", "/api/learning/tracker/overview", "/api/auth/sessions"):
        blocked = client.get(path, headers=_AS["TEACHER"])
        assert blocked.status_code == 403, (path, blocked.text)
        detail = blocked.json()["detail"]
        assert detail["code"] == "PASSWORD_CHANGE_REQUIRED"
        assert detail["message"] == "Choose a new password to continue."
        assert detail["requestId"].startswith("SE-")


def test_an_issued_password_lets_a_student_in_only_as_far_as_replacing_it(client, db_session):
    student = _new_person(client, db_session, "gate-s", "STUDENT")
    assert _sign_in(client, student["code"], student["initialPassword"]).status_code == 200

    assert client.get("/api/auth/me", headers=_AS["STUDENT"]).status_code == 200
    blocked = client.get("/api/learning/assignments", headers=_AS["STUDENT"])
    assert blocked.status_code == 403
    assert blocked.json()["detail"]["code"] == "PASSWORD_CHANGE_REQUIRED"

    # Signing out is always allowed: a child who opened the wrong account
    # must be able to leave it.
    assert client.post("/api/auth/logout", headers=_own_headers(client, "STUDENT")).status_code == 200


def test_the_gate_is_about_the_flag_not_about_being_new(client, db_session):
    """An account whose owner has already chosen their password is not
    gated, whatever its role -- the common case for everyone who was using
    the product before this shipped and had changed theirs from the menu."""
    user = User(full_name="Settled Teacher", email="first-settled@example.com", password_hash=hash_password(PASSWORD), role="TEACHER")
    db_session.add(user)
    db_session.commit()
    assert _sign_in(client, user.email, PASSWORD).json()["user"]["mustChangePassword"] is False
    # 404 (no teacher profile row in this bare fixture), not the 403 gate.
    response = client.get("/api/teacher-assignments/my-sections", headers=_AS["TEACHER"])
    assert response.json()["detail"]["code"] != "PASSWORD_CHANGE_REQUIRED"


# --- Replacing it, and staying signed in -------------------------------------


def test_choosing_a_password_keeps_this_browser_signed_in(client, db_session):
    teacher = _new_person(client, db_session, "keep", "TEACHER")
    assert _sign_in(client, teacher["code"], teacher["initialPassword"]).status_code == 200
    session_cookie_before = client.cookies.get("se_teacher_sess")
    [session_row] = db_session.query(UserSession).filter(UserSession.user_id == teacher["id"]).all()

    response = _change(client, "TEACHER", teacher["initialPassword"], OWN_PASSWORD, keepSignedIn=True)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["updated"] is True and body["staySignedIn"] is True
    assert body["message"] == "Your password has been changed."
    # The profile comes back with the flag already cleared, so the page can
    # carry straight on without asking again.
    assert body["user"]["id"] == teacher["id"]
    assert body["user"]["mustChangePassword"] is False
    assert "accessToken" not in body and "token" not in response.text.lower()

    # A fresh cookie for the SAME session -- not a new login -- issued under
    # the new password.
    session_cookie_after = client.cookies.get("se_teacher_sess")
    before, after = decode_token(session_cookie_before), decode_token(session_cookie_after)
    assert after["sid"] == before["sid"] == session_row.id
    assert after["pwd"] != before["pwd"]
    db_session.expire_all()
    rows = db_session.query(UserSession).filter(UserSession.user_id == teacher["id"]).all()
    assert [row.id for row in rows] == [session_row.id]
    assert rows[0].revoked_at is None

    # And it works, immediately, for what was refused a moment ago.
    me = client.get("/api/auth/me", headers=_AS["TEACHER"])
    assert me.status_code == 200 and me.json()["mustChangePassword"] is False
    assert client.get("/api/auth/sessions", headers=_AS["TEACHER"]).status_code == 200

    stored = db_session.get(User, teacher["id"])
    assert verify_password(OWN_PASSWORD, stored.password_hash)
    assert not verify_password(teacher["initialPassword"], stored.password_hash)
    assert stored.must_change_password is False
    assert after["pwd"] == password_fingerprint(stored.password_hash)

    # The token this same session held a moment ago is dead, even though it
    # was issued in the same second as the change and carries the session id
    # that was kept: it was issued under the old password.
    with TestClient(app) as copied:
        copied.cookies.set("se_teacher_sess", session_cookie_before)
        stale = copied.get("/api/auth/me", headers=_AS["TEACHER"])
        assert stale.status_code == 401
        assert stale.json()["detail"]["message"] == (
            "Your password was changed, so this session has ended. Please sign in with your new password."
        )
        as_bearer = copied.get("/api/auth/me", headers={"Authorization": f"Bearer {session_cookie_before}"})
        assert as_bearer.status_code == 401

    [audit] = db_session.query(AuditLog).filter(AuditLog.event_type == "auth.password_changed", AuditLog.user_id == teacher["id"]).all()
    assert '"keptThisSession": true' in audit.event_data_json
    assert OWN_PASSWORD not in audit.event_data_json


def test_choosing_a_password_signs_every_other_device_out(client, db_session):
    """Whoever else had the issued password -- and may already be signed in
    with it -- is out the moment its owner replaces it. Both sign-ins here
    happen within the same second as the change, which is exactly the case
    the token's own timestamp cannot tell apart: the other session's row is
    revoked, not merely out-dated."""
    student = _new_person(client, db_session, "others", "STUDENT")
    assert _sign_in(client, student["code"], student["initialPassword"]).status_code == 200

    with TestClient(app) as elsewhere:
        assert _sign_in(elsewhere, student["code"], student["initialPassword"]).status_code == 200
        assert elsewhere.get("/api/auth/me", headers=_AS["STUDENT"]).status_code == 200

        changed = _change(client, "STUDENT", student["initialPassword"], OWN_PASSWORD, keepSignedIn=True)
        assert changed.status_code == 200 and changed.json()["staySignedIn"] is True

        # This browser carries on...
        assert client.get("/api/auth/me", headers=_AS["STUDENT"]).status_code == 200
        # ...the other one is told its session is over.
        ended = elsewhere.get("/api/auth/me", headers=_AS["STUDENT"])
        assert ended.status_code == 401
        assert ended.json()["detail"]["code"] == "UNAUTHORIZED"

        # And the issued password opens nothing any more.
        assert _sign_in(elsewhere, student["code"], student["initialPassword"]).status_code == 401
        assert _sign_in(elsewhere, student["code"], OWN_PASSWORD).status_code == 200

    db_session.expire_all()
    rows = db_session.query(UserSession).filter(UserSession.user_id == student["id"]).all()
    # The kept session, the revoked one, and the fresh sign-in just above.
    assert sorted(row.revoked_at is None for row in rows) == [False, True, True]


def test_without_keep_signed_in_a_password_change_ends_the_session(client, db_session):
    """The profile menu's Change Password and the admin security page do not
    ask to stay signed in. For them a change ends every session, this one
    included -- and since 3 Oct 2026 that is true to the second, not merely
    for tokens old enough for the clock to tell apart."""
    user = User(full_name="Menu Teacher", email="first-menu@example.com", password_hash=hash_password(PASSWORD), role="TEACHER")
    db_session.add(user)
    db_session.commit()
    assert _sign_in(client, user.email, PASSWORD).status_code == 200
    cookie_before = client.cookies.get("se_teacher_sess")

    response = _change(client, "TEACHER", PASSWORD, OWN_PASSWORD)
    assert response.status_code == 200
    body = response.json()
    assert body["staySignedIn"] is False and "user" not in body
    assert body["message"] == "Your password has been changed. Please sign in again with the new one."

    # The browser's cookie is taken away...
    assert client.cookies.get("se_teacher_sess") is None
    assert client.get("/api/auth/me", headers=_AS["TEACHER"]).status_code == 401
    # ...and the token it carried is dead for anyone who kept a copy,
    # though it was issued within the same second as the change.
    with TestClient(app) as copied:
        copied.cookies.set("se_teacher_sess", cookie_before)
        assert copied.get("/api/auth/me", headers=_AS["TEACHER"]).status_code == 401
    db_session.expire_all()
    assert all(row.revoked_at is not None for row in db_session.query(UserSession).filter(UserSession.user_id == user.id))


def test_a_sign_in_already_under_way_with_the_old_password_does_not_outlive_the_change(client, db_session, monkeypatch):
    """Someone else holds the issued password and starts signing in with it.
    Their request has read the old password and found it correct; before it
    finishes, the owner replaces the password. The session that sign-in then
    creates is newer than the change by every clock -- and must still be
    refused, because it was opened with a password that no longer exists.

    Driven through the real sign-in, with the owner's change slotted in at
    the exact point the race happens: after the other request's password
    check, before it issues its token. (An earlier version of this test
    built the late token by hand, bound to the old hash -- which is what
    the code should do, and at the time was not what it did: it re-read the
    account after a commit and bound the token to the NEW password.)"""
    from app.services import auth_service

    student = _new_person(client, db_session, "race", "STUDENT")
    assert _sign_in(client, student["code"], student["initialPassword"]).status_code == 200

    real_verify = auth_service.verify_password
    state = {"changed": False}

    def verify_then_let_the_owner_change_it(password, password_hash):
        correct = real_verify(password, password_hash)
        if correct and not state["changed"]:
            state["changed"] = True
            changed = _change(client, "STUDENT", student["initialPassword"], OWN_PASSWORD, keepSignedIn=True)
            assert changed.status_code == 200 and changed.json()["staySignedIn"] is True
        return correct

    with TestClient(app) as elsewhere:
        monkeypatch.setattr(auth_service, "verify_password", verify_then_let_the_owner_change_it)
        late = _sign_in(elsewhere, student["code"], student["initialPassword"])
        monkeypatch.setattr(auth_service, "verify_password", real_verify)
        assert state["changed"] is True
        # The sign-in itself may well answer 200 -- it checked the password
        # it was given against the password the account had. What it must
        # not be is a way in.
        assert late.status_code == 200
        refused = elsewhere.get("/api/auth/me", headers=_AS["STUDENT"])
        assert refused.status_code == 401
        assert refused.json()["detail"]["code"] == "UNAUTHORIZED"
        late_claims = decode_token(elsewhere.cookies.get("se_student_sess"))

    account = db_session.get(User, student["id"])
    db_session.refresh(account)
    assert late_claims["pwd"] != password_fingerprint(account.password_hash)
    # The owner's own browser is untouched by any of it.
    assert client.get("/api/auth/me", headers=_AS["STUDENT"]).status_code == 200


def test_the_second_step_of_a_sign_in_does_not_outlive_a_password_change(client, db_session):
    """An admin's password step is passed; before the authenticator code is
    entered, the password is reset. The code is right -- and the sign-in is
    still over, because the password it began with is gone."""
    admin, _school = _make_school_admin(db_session, "first-admin-2fa@example.com", "First Password School 2FA")
    challenge = _sign_in(client, admin.email, PASSWORD).json()
    assert challenge["twoFactorRequired"] is True
    assert "pwd" in decode_token(challenge["challengeToken"])

    admin.password_hash = hash_password("Reset-By-Someone-9")
    db_session.commit()

    verified = client.post(
        "/api/auth/2fa/verify-login",
        json={"challengeToken": challenge["challengeToken"], "code": pyotp.TOTP(TEST_TOTP_SECRET).now()},
    )
    assert verified.status_code == 401
    assert verified.json()["detail"]["message"] == "This verification step has expired. Please sign in again."
    assert client.cookies.get("se_admin_sess") is None

    # Starting again with the password the account has now works as ever.
    challenge = _sign_in(client, admin.email, "Reset-By-Someone-9").json()
    verified = client.post(
        "/api/auth/2fa/verify-login",
        json={"challengeToken": challenge["challengeToken"], "code": pyotp.TOTP(TEST_TOTP_SECRET).now()},
    )
    assert verified.status_code == 200


def test_a_password_the_hasher_cannot_take_is_just_wrong(client, db_session):
    user = User(full_name="Odd Input", email="first-odd@example.com", password_hash=hash_password(PASSWORD), role="TEACHER")
    db_session.add(user)
    db_session.commit()
    assert verify_password("has\x00nul", user.password_hash) is False
    response = _sign_in(client, user.email, "has\x00nul-in-it")
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "INVALID_CREDENTIALS"


def test_a_token_from_before_the_binding_existed_still_works(client, db_session):
    """Sessions that were open when this shipped carry no "pwd" claim. They
    are not signed out by its arrival; they are judged, as before, by when
    they were issued."""
    user = User(full_name="Earlier Teacher", email="first-earlier@example.com", password_hash=hash_password(PASSWORD), role="TEACHER")
    db_session.add(user)
    db_session.commit()
    session_id = start_session(db_session, user)
    db_session.commit()
    unbound = create_access_token(user.id, user.role, session_id=session_id)
    assert "pwd" not in decode_token(unbound)

    client.cookies.set("se_teacher_sess", unbound)
    assert client.get("/api/auth/me", headers=_AS["TEACHER"]).status_code == 200


def test_every_real_sign_in_binds_its_token_to_the_password(client, db_session):
    user = User(full_name="Bound Teacher", email="first-bound@example.com", password_hash=hash_password(PASSWORD), role="TEACHER")
    db_session.add(user)
    db_session.commit()
    assert _sign_in(client, user.email, PASSWORD).status_code == 200
    claims = decode_token(client.cookies.get("se_teacher_sess"))
    assert claims["pwd"] == password_fingerprint(user.password_hash)
    # Says nothing about the hash to someone reading the token.
    assert claims["pwd"] not in user.password_hash and len(claims["pwd"]) == 16


def test_a_script_holding_a_token_is_never_handed_a_new_one(client, db_session):
    user = User(full_name="Script Teacher", email="first-script@example.com", password_hash=hash_password(PASSWORD), role="TEACHER")
    db_session.add(user)
    db_session.commit()
    from app.core.security import create_access_token
    from app.services.session_service import start_session

    session_id = start_session(db_session, user)
    db_session.commit()
    token = create_access_token(user.id, user.role, session_id=session_id)

    with TestClient(app) as script:
        response = script.post(
            "/api/auth/change-password",
            json={"currentPassword": PASSWORD, "newPassword": OWN_PASSWORD, "keepSignedIn": True},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        assert response.json()["staySignedIn"] is False
        assert "set-cookie" not in {name.lower() for name in response.headers}
        assert token not in response.text


def test_a_chosen_password_that_matches_the_current_one_is_refused_for_that_reason(client, db_session):
    """"Replace" has to mean replace: a password that passes every strength
    rule, offered as its own replacement, is refused -- otherwise the forced
    first change could be met by typing the issued password again. (A fixed
    password rather than a generated one: one generated password in seven
    has no digit, and would be refused a step earlier for that instead.)"""
    user = User(
        full_name="Same Again",
        email="first-same-again@example.com",
        password_hash=hash_password(OWN_PASSWORD),
        role="STUDENT",
        must_change_password=True,
    )
    db_session.add(user)
    db_session.commit()
    assert _sign_in(client, user.email, OWN_PASSWORD).status_code == 200

    response = _change(client, "STUDENT", OWN_PASSWORD, OWN_PASSWORD, keepSignedIn=True)
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "VALIDATION_ERROR"
    assert response.json()["detail"]["message"] == "Choose a password that's different from your current one."
    db_session.refresh(user)
    assert user.must_change_password is True
    assert verify_password(OWN_PASSWORD, user.password_hash)
    # Still gated.
    assert client.get("/api/auth/sessions", headers=_AS["STUDENT"]).status_code == 403


def test_a_refused_change_changes_nothing(client, db_session):
    teacher = _new_person(client, db_session, "refused", "TEACHER")
    issued = teacher["initialPassword"]
    assert _sign_in(client, teacher["code"], issued).status_code == 200

    cases = [
        ("not-the-issued-one", OWN_PASSWORD, "INVALID_PASSWORD", "Your current password isn't right. Please try again."),
        (issued, "short1", "VALIDATION_ERROR", "Password must be at least 8 characters."),
        (issued, "Password123", "VALIDATION_ERROR", "That password is too common and easy to guess. Please choose a less predictable one."),
        (issued, "", "VALIDATION_ERROR", "Enter a new password."),
        (issued, "   ", "VALIDATION_ERROR", "Enter a new password."),
        # What is typed is what is stored, so a space at either end is
        # refused rather than quietly removed (sign-in would then fail for
        # the person who typed it).
        (issued, " Mango-Tree-42", "VALIDATION_ERROR", "Password can't start or end with a space."),
        (issued, "Mango-Tree-42 ", "VALIDATION_ERROR", "Password can't start or end with a space."),
        (issued, "Aa1" + "x" * 70, "VALIDATION_ERROR", "Password is too long. Keep it to 72 characters or fewer."),
        (issued, "Mango\tTree-42", "VALIDATION_ERROR", "Password contains characters that can't be used. Please type it again."),
    ]
    for current, new, code, message in cases:
        response = _change(client, "TEACHER", current, new, keepSignedIn=True)
        assert response.status_code == 400, (current, new, response.text)
        assert response.json()["detail"]["code"] == code
        assert response.json()["detail"]["message"] == message
        assert "user" not in response.json()

    stored = db_session.get(User, teacher["id"])
    db_session.refresh(stored)
    assert stored.must_change_password is True
    assert verify_password(issued, stored.password_hash)


def test_the_current_password_is_compared_exactly_as_sign_in_compares_it(client, db_session):
    teacher = _new_person(client, db_session, "exact", "TEACHER")
    issued = teacher["initialPassword"]
    assert _sign_in(client, teacher["code"], issued).status_code == 200

    padded = _change(client, "TEACHER", issued + " ", OWN_PASSWORD, keepSignedIn=True)
    assert padded.status_code == 400
    assert padded.json()["detail"]["code"] == "INVALID_PASSWORD"
    blank = _change(client, "TEACHER", "   ", OWN_PASSWORD, keepSignedIn=True)
    assert blank.status_code == 400
    assert blank.json()["detail"]["message"] == "Enter your current password."

    assert _change(client, "TEACHER", issued, OWN_PASSWORD, keepSignedIn=True).status_code == 200


def test_an_admin_reset_puts_a_settled_teacher_back_behind_the_gate(client, db_session):
    """The fallback Shailesh asked for: a teacher who forgets their password
    gets a temporary one from the school admin -- and has to replace that
    too, the same way."""
    admin, _school = _make_school_admin(db_session, "first-admin-reset@example.com", "First Password School Reset")
    headers = _admin_headers(client, admin.email)
    teacher = _create(client, headers, role="TEACHER", fullName="Forgetful Teacher")

    assert _sign_in(client, teacher["code"], teacher["initialPassword"]).status_code == 200
    assert _change(client, "TEACHER", teacher["initialPassword"], OWN_PASSWORD, keepSignedIn=True).status_code == 200
    assert client.get("/api/auth/sessions", headers=_AS["TEACHER"]).status_code == 200

    # (The CSRF cookie is one cookie shared by every role signed in on a
    # browser, and the teacher's sign-in replaced it -- so the admin's
    # header is read afresh, as the real page reads it on every request.)
    reset = client.post(f"/api/roster/people/{teacher['id']}/reset-password", headers=_own_headers(client, "ADMIN"))
    assert reset.status_code == 200, reset.text
    temporary = reset.json()["temporaryPassword"]

    # The session they had is over; the old password is dead; the temporary
    # one gets them only as far as choosing again.
    assert client.get("/api/auth/sessions", headers=_AS["TEACHER"]).status_code == 401
    assert _sign_in(client, teacher["code"], OWN_PASSWORD).status_code == 401
    assert _sign_in(client, teacher["code"], temporary).json()["user"]["mustChangePassword"] is True
    assert client.get("/api/auth/sessions", headers=_AS["TEACHER"]).status_code == 403
    assert _change(client, "TEACHER", temporary, "Second-Choice-77", keepSignedIn=True).status_code == 200
    assert client.get("/api/auth/sessions", headers=_AS["TEACHER"]).status_code == 200


def test_a_whole_class_on_one_connection_can_choose_their_passwords(client, db_session):
    """Thirty students share one school connection, and every one of them
    comes through change-password the first time they sign in. The limit on
    it is per account, so the seventh is not refused for what the first six
    did. (At the old 5-a-minute-per-address, this test fails at the sixth.)"""
    admin, _school = _make_school_admin(db_session, "first-admin-class@example.com", "First Password School Class")
    headers = _admin_headers(client, admin.email)
    students = [
        _create(client, headers, role="STUDENT", fullName=f"Classmate {n}", className="6", section="C") for n in range(8)
    ]
    for n, student in enumerate(students):
        with TestClient(app) as desk:
            assert _sign_in(desk, student["code"], student["initialPassword"]).status_code == 200
            changed = _change(desk, "STUDENT", student["initialPassword"], f"Desk-{n}-Lantern-7", keepSignedIn=True)
            assert changed.status_code == 200, (n, changed.text)


def test_guesses_at_one_accounts_current_password_are_limited(client, db_session):
    teacher = _new_person(client, db_session, "guess", "TEACHER")
    assert _sign_in(client, teacher["code"], teacher["initialPassword"]).status_code == 200
    statuses = [_change(client, "TEACHER", f"guess-number-{n}", OWN_PASSWORD).status_code for n in range(11)]
    assert statuses[:10] == [400] * 10
    assert statuses[10] == 429
    # Someone else on the same connection is not caught by that.
    other = User(full_name="Bystander", email="first-bystander@example.com", password_hash=hash_password(PASSWORD), role="TEACHER")
    db_session.add(other)
    db_session.commit()
    with TestClient(app) as desk:
        assert _sign_in(desk, other.email, PASSWORD).status_code == 200
        assert _change(desk, "TEACHER", PASSWORD, OWN_PASSWORD, keepSignedIn=True).status_code == 200


def test_the_two_rules_added_with_this_change():
    assert strong_password_issue(" Mango-Tree-42") == "Password can't start or end with a space."
    assert strong_password_issue("Mango-Tree-42\t") == "Password can't start or end with a space."
    assert strong_password_issue("Mango Tree 42") is None  # spaces inside are fine
    assert strong_password_issue("Aa1" + "x" * 69) is None  # exactly 72 bytes
    assert strong_password_issue("Aa1" + "x" * 70) == "Password is too long. Keep it to 72 characters or fewer."
    # Counted in bytes, which is what the hash reads: 25 three-byte letters
    # are 27 characters and 77 bytes, and the sentence does not tell someone
    # with 27 characters to "keep it to 72".
    assert strong_password_issue("a1" + "\u0915" * 25) == "Password is too long for the letters it uses. Please shorten it a little."
    unusable = "Password contains characters that can't be used. Please type it again."
    assert strong_password_issue("Mango\x00Tree-42") == unusable
    assert strong_password_issue("Mango\nTree-42") == unusable
    assert strong_password_issue("Mango-Tree-42\ud800") == unusable


def test_crash_reports_carry_no_passwords():
    """Stack frames are reported without their local variables: a list of
    names cannot scrub an uploaded sheet held as bytes, or a request model's
    repr. The name list stays for everything that is reported by name."""
    import pathlib

    main_source = pathlib.Path(__file__).resolve().parents[1].joinpath("app", "main.py").read_text()
    assert "include_local_variables=False" in main_source
    for name in ("chosen_password", "initial_password", "initialpassword", "temporary_password", "temporarypassword", "password_hash"):
        assert name in _SENTRY_DENYLIST_FIELDS


# --- A first password chosen by the school (bulk sheet) -----------------------


def _bulk(client, headers, role: str, filename: str, raw: bytes):
    return client.post(
        "/api/roster/people/bulk",
        data={"role": role},
        files={"file": (filename, io.BytesIO(raw), "application/octet-stream")},
        headers=headers,
    )


def test_a_sheet_can_carry_each_persons_first_password(client, db_session):
    admin, school = _make_school_admin(db_session, "first-bulk-admin@example.com", "First Bulk School")
    headers = _admin_headers(client, admin.email)
    csv_text = (
        "fullName,email,className,section,password\n"
        "Asha Rao,,7,A,Welcome2Class7\n"      # the school's choice
        "Bela Shah,,7,A,\n"                    # blank: generated, as before
        "Chirag Jain,,7,A,short1\n"            # too short
        "Diya Nair,,7,A,Password123\n"         # too common
        "Eshan Roy,,7,A,Welcome2Class7\n"      # the same one again: allowed
    )
    response = _bulk(client, headers, "STUDENT", "students.csv", csv_text.encode("utf-8"))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] == 3 and body["attempted"] == 5
    rows = {row["fullName"]: row for row in body["results"]}

    assert rows["Asha Rao"]["status"] == "created"
    assert rows["Asha Rao"]["initialPassword"] == "Welcome2Class7"
    assert rows["Asha Rao"]["passwordSource"] == "sheet"
    assert rows["Eshan Roy"]["initialPassword"] == "Welcome2Class7"

    assert rows["Bela Shah"]["status"] == "created"
    assert rows["Bela Shah"]["passwordSource"] == "generated"
    assert len(rows["Bela Shah"]["initialPassword"]) == 12

    assert rows["Chirag Jain"] == {
        "row": 4,
        "fullName": "Chirag Jain",
        "status": "skipped",
        "error": "The password in this row can't be used. Password must be at least 8 characters.",
    }
    assert rows["Diya Nair"]["status"] == "skipped"
    assert rows["Diya Nair"]["error"] == (
        "The password in this row can't be used. That password is too common and easy to guess. "
        "Please choose a less predictable one."
    )

    # A refused row made nothing.
    names = {
        user.full_name
        for user in db_session.query(User).join(Student, Student.user_id == User.id).filter(Student.school_id == school.id)
    }
    assert names == {"Asha Rao", "Bela Shah", "Eshan Roy"}

    # The school's password really is the password -- and really is
    # temporary: it opens the account only as far as replacing it.
    assert _sign_in(client, rows["Asha Rao"]["code"], "Welcome2Class7").json()["user"]["mustChangePassword"] is True
    assert client.get("/api/learning/assignments", headers=_AS["STUDENT"]).status_code == 403
    assert _change(client, "STUDENT", "Welcome2Class7", OWN_PASSWORD, keepSignedIn=True).status_code == 200
    assert client.get("/api/auth/sessions", headers=_AS["STUDENT"]).status_code == 200

    # The audit trail counts them and never holds one.
    [audit] = db_session.query(AuditLog).filter(AuditLog.event_type == "roster.bulk_import", AuditLog.user_id == admin.id).all()
    assert '"chosenPasswords": 2' in audit.event_data_json
    everything = " ".join(row.event_data_json or "" for row in db_session.query(AuditLog).all())
    assert "Welcome2Class7" not in everything


def test_a_sheet_with_no_password_column_behaves_exactly_as_before(client, db_session):
    admin, _school = _make_school_admin(db_session, "first-bulk-admin2@example.com", "First Bulk School Two")
    headers = _admin_headers(client, admin.email)
    response = _bulk(client, headers, "TEACHER", "teachers.csv", b"fullName,email,designation\nFarah Ali,,Maths Teacher\n")
    assert response.status_code == 200
    [row] = response.json()["results"]
    assert row["status"] == "created" and row["passwordSource"] == "generated"
    assert len(row["initialPassword"]) == 12


def test_an_excel_sheet_hands_passwords_back_the_way_they_were_typed(client, db_session):
    """A spreadsheet turns a cell that looks like a number into a number.
    A password must come back as the characters that were typed -- and one
    that is all digits is then refused for the honest reason (no letter),
    not created as "20261234.0"."""
    admin, _school = _make_school_admin(db_session, "first-bulk-admin3@example.com", "First Bulk School Three")
    headers = _admin_headers(client, admin.email)

    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["fullName", "email", "className", "section", "password"])
    sheet.append(["Gauri Menon", None, "8", "B", "Monsoon2026Term"])
    sheet.append(["Hari Das", None, "8", "B", 20261234])
    sheet.append(["Isha Paul", None, "8", "B", None])
    buffer = io.BytesIO()
    workbook.save(buffer)

    response = _bulk(client, headers, "STUDENT", "students.xlsx", buffer.getvalue())
    assert response.status_code == 200, response.text
    rows = {row["fullName"]: row for row in response.json()["results"]}
    assert rows["Gauri Menon"]["initialPassword"] == "Monsoon2026Term"
    assert rows["Hari Das"]["status"] == "skipped"
    assert rows["Hari Das"]["error"] == "The password in this row can't be used. Password must include at least one letter."
    assert rows["Isha Paul"]["passwordSource"] == "generated"


def test_a_heading_is_read_whatever_its_capitals_or_spacing(client, db_session):
    """A heading typed "Password", or after a comma and a space, used to be
    a column the import never read -- every account got a random password
    and nothing said so. Headings are matched by their letters, and the ones
    that match nothing are reported."""
    admin, _school = _make_school_admin(db_session, "first-bulk-admin4@example.com", "First Bulk School Four")
    headers = _admin_headers(client, admin.email)
    csv_text = "Full Name, Email , Class Name ,SECTION, Password ,Roll No,House\nJaya Sen,,6,B,Riverbank2026x,14,Blue\n"
    response = _bulk(client, headers, "STUDENT", "students.csv", csv_text.encode("utf-8"))
    assert response.status_code == 200, response.text
    body = response.json()
    [row] = body["results"]
    assert row["status"] == "created" and row["fullName"] == "Jaya Sen"
    assert row["initialPassword"] == "Riverbank2026x" and row["passwordSource"] == "sheet"
    assert body["unrecognisedColumns"] == ["Roll No", "House"]
    student = db_session.query(Student).filter(Student.student_code == row["code"]).first()
    assert (student.class_name, student.section) == ("6", "B")

    workbook = Workbook()
    sheet = workbook.active
    sheet.append([" FULLNAME ", "email", "PassWord", "Notes"])
    sheet.append(["Kiran Bedi", None, "Hillside2026y", "new joiner"])
    buffer = io.BytesIO()
    workbook.save(buffer)
    body = _bulk(client, headers, "TEACHER", "teachers.xlsx", buffer.getvalue()).json()
    assert body["results"][0]["initialPassword"] == "Hillside2026y"
    assert body["unrecognisedColumns"] == ["Notes"]

    # A sheet with only the columns the import reads reports none.
    body = _bulk(client, headers, "TEACHER", "t.csv", b"fullName,email\nLata Rao,\n").json()
    assert body["unrecognisedColumns"] == []


def test_a_second_heading_for_the_same_column_never_replaces_the_first(client, db_session):
    """ "Email 2" is not "Email", and a blank "Pass Word" column must not
    wipe out the "Password" column beside it. Each column is read from the
    first heading that names it; the rest are reported as not used."""
    admin, _school = _make_school_admin(db_session, "first-bulk-admin7@example.com", "First Bulk School Seven")
    headers = _admin_headers(client, admin.email)
    csv_text = (
        "Full Name,Email,Email 2,Password,Pass Word\n"
        "Sana Mir,sana.mir7@example.com,parent.of.sana@example.com,Lakeside2026v,\n"
    )
    body = _bulk(client, headers, "TEACHER", "teachers.csv", csv_text.encode("utf-8")).json()
    [row] = body["results"]
    assert row["status"] == "created"
    assert row["email"] == "sana.mir7@example.com"
    assert row["initialPassword"] == "Lakeside2026v" and row["passwordSource"] == "sheet"
    assert body["unrecognisedColumns"] == ["Email 2", "Pass Word"]


def test_a_file_with_no_name_column_is_refused_once_not_row_by_row(client, db_session):
    admin, _school = _make_school_admin(db_session, "first-bulk-admin8@example.com", "First Bulk School Eight")
    headers = _admin_headers(client, admin.email)
    message = (
        "We couldn't find a fullName column in that file. Its first row must be the column headings, "
        "and one of them must be fullName. Download the template to see them all."
    )
    for raw in (b"Name,Email\nTara Sen,\n", b"fullName;email\nTara Sen;\n", b"Tara Sen,tara@example.com\nUma Roy,\n"):
        response = _bulk(client, headers, "TEACHER", "teachers.csv", raw)
        assert response.status_code == 422, raw
        assert response.json()["detail"]["code"] == "VALIDATION_ERROR"
        assert response.json()["detail"]["message"] == message
    assert db_session.query(User).filter(User.full_name.in_(["Tara Sen", "Uma Roy"])).count() == 0


def test_a_password_that_is_printed_next_to_the_person_is_refused(client, db_session):
    """A sheet that fills the password column with each person's own code
    or name has given every account a password anyone can read off the
    roster. Refused, and the refused row creates nothing."""
    admin, school = _make_school_admin(db_session, "first-bulk-admin5@example.com", "Printed Next To Them")
    headers = _admin_headers(client, admin.email)
    # The first student of this school is issued STU-PRIN-0001.
    csv_text = (
        "fullName,email,password\n"
        "Mohan Lal2026,,stu-prin-0001\n"       # their own sign-in code, in any case
        "Nisha Roy2026,,NishaRoy2026\n"        # their own name, spaces removed
        "Omar Ali,omar.ali2026@example.com,omar.ali2026@example.com\n"  # their own email
        "Priya Das,,Courtyard2026z\n"
    )
    body = _bulk(client, headers, "STUDENT", "students.csv", csv_text.encode("utf-8")).json()
    rows = {row["fullName"]: row for row in body["results"]}
    same = "The password in this row can't be used. It is the same as this person's sign-in code, name or email."
    assert rows["Mohan Lal2026"]["error"] == same
    assert rows["Nisha Roy2026"]["error"] == same
    assert rows["Omar Ali"]["error"] == same
    # Nothing was written for the refused rows, so the one good row gets the
    # code the first of them would have had.
    assert rows["Priya Das"]["status"] == "created" and rows["Priya Das"]["code"] == "STU-PRIN-0001"
    assert db_session.query(Student).filter(Student.school_id == school.id).count() == 1
    assert db_session.query(User).filter(User.email == "omar.ali2026@example.com").count() == 0


def test_a_refused_row_does_not_hold_its_email_against_the_next(client, db_session):
    admin, _school = _make_school_admin(db_session, "first-bulk-admin6@example.com", "First Bulk School Six")
    headers = _admin_headers(client, admin.email)
    csv_text = (
        "fullName,email,password\n"
        "Qadir Khan,qadir.first@example.com,short1\n"          # refused for its password
        "Qadir Khan,qadir.first@example.com,Orchard2026w\n"    # same person, corrected
        "Rhea Sen,qadir.first@example.com,Orchard2026w\n"      # now a real repeat
    )
    body = _bulk(client, headers, "TEACHER", "teachers.csv", csv_text.encode("utf-8")).json()
    statuses = [(row["row"], row["status"]) for row in body["results"]]
    assert statuses == [(2, "skipped"), (3, "created"), (4, "skipped")]
    assert body["results"][2]["error"] == "This email address is already used on row 3 of this file."


def test_cell_text_reads_a_cell_the_way_it_was_typed():
    assert _cell_text(None) is None
    assert _cell_text("") is None
    assert _cell_text("   ") is None
    assert _cell_text("  Monsoon2026  ") == "Monsoon2026"
    assert _cell_text(20261234) == "20261234"
    assert _cell_text(20261234.0) == "20261234"
    assert _cell_text(12.5) == "12.5"
    assert _cell_text(0) == "0"


# --- The name an authenticator app shows --------------------------------------


def test_new_two_factor_enrolments_are_filed_under_the_products_name():
    assert ISSUER_NAME == "Krama"
    uri = totp_provisioning_uri(pyotp.random_base32(), "admin@school.example")
    assert uri.startswith("otpauth://totp/Krama:admin%40school.example?")
    assert "issuer=Krama" in uri
    assert "MathPath" not in uri
