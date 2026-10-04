"""Each way in on the sign-in page takes only its own kind of account
(4 Oct 2026).

Until this date the choice of Student / Teacher / Admin only changed the
page's wording: whoever the email and password belonged to was signed in,
so an admin's details under "Teacher" went on to the two-factor step and
into the admin workspace. The page now tells the server which way in was
chosen, and the server refuses the wrong one.

What these tests hold:
  * the right way in works for all four roles (a Super Admin uses "Admin");
  * right details on the wrong way in are refused, with no session, no
    two-factor challenge, and a sentence that names the right choice;
  * a WRONG password is refused with the same sentence it always was, on
    every way in -- the page must not reveal what kind of account an
    address belongs to to someone who does not know its password;
  * a locked account is told it is locked, and nothing else, on every way in;
  * a request that does not say which way in (an older page) still works;
  * the refusal is in the audit log, and does not count as a failed attempt;
  * what was chosen is recorded beside every accepted password.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.core.security import hash_password
from app.models import AuditLog, School, SchoolAdmin, Student, Teacher, User

PASSWORD = "Passw0rd1"
TEST_TOTP_SECRET = "JBSWY3DPEHPK3PXP"

# Which of the three ways in each role uses.
WAY_IN = {"STUDENT": "STUDENT", "TEACHER": "TEACHER", "ADMIN": "ADMIN", "SUPER_ADMIN": "ADMIN"}
ROLES = list(WAY_IN)
WAYS_IN = ("STUDENT", "TEACHER", "ADMIN")
WHOSE = {
    "STUDENT": ("a student's", "Student"),
    "TEACHER": ("a teacher's", "Teacher"),
    "ADMIN": ("a school admin's", "Admin"),
    "SUPER_ADMIN": ("a Super Admin's", "Admin"),
}


class Accounts:
    """One account of each role, in one school, with addresses and codes no
    other test uses (the test database is shared by the whole run)."""

    def __init__(self, db):
        tag = uuid.uuid4().hex[:8]
        school = School(name=f"Way In School {tag}", board="CBSE", city="Pune")
        db.add(school)
        db.commit()
        db.refresh(school)
        self.users: dict[str, User] = {}
        self.email: dict[str, str] = {}
        for role in ROLES:
            self.email[role] = f"{role.lower()}.{tag}@example.com"
            user = User(full_name=f"{role.title()} Person", email=self.email[role], password_hash=hash_password(PASSWORD), role=role)
            db.add(user)
            db.commit()
            db.refresh(user)
            self.users[role] = user
        self.student_code = f"STU-{tag[:4].upper()}-0001"
        db.add(Student(user_id=self.users["STUDENT"].id, school_id=school.id, student_code=self.student_code, class_name="5", section="A"))
        db.add(Teacher(user_id=self.users["TEACHER"].id, school_id=school.id, teacher_code=f"TCH-{tag[:4].upper()}-0001"))
        db.add(SchoolAdmin(user_id=self.users["ADMIN"].id, school_id=school.id))
        db.commit()


def _login(client, identifier, sign_in_as=None, password=PASSWORD):
    body = {"identifier": identifier, "password": password}
    if sign_in_as is not None:
        body["signInAs"] = sign_in_as
    return client.post("/api/auth/login", json=body)


@pytest.mark.parametrize("role", ROLES)
def test_the_right_way_in_signs_each_role_in(client, db_session, role):
    accounts = Accounts(db_session)
    response = _login(client, accounts.email[role], WAY_IN[role])
    assert response.status_code == 200, response.text
    assert response.json()["user"]["role"] == role


@pytest.mark.parametrize("role", ROLES)
def test_right_details_on_the_wrong_way_in_are_refused(client, db_session, role):
    accounts = Accounts(db_session)
    users, email, way_in = accounts.users, accounts.email[role], WAY_IN[role]
    whose, choice = WHOSE[role]
    for chosen in WAYS_IN:
        if chosen == way_in:
            continue
        response = _login(client, email, chosen)
        assert response.status_code == 403, (role, chosen, response.text)
        detail = response.json()["detail"]
        assert detail["code"] == "WRONG_SIGN_IN_TAB"
        assert detail["message"] == f"These are {whose} sign-in details. Choose {choice} above to sign in."
        assert detail["details"] == {"signInAs": way_in}
        # Nothing was issued: the body is the refusal and only the refusal, no
        # session cookie came with it, and /me still says nobody is signed in.
        assert set(response.json()) == {"detail"}
        assert not any(name.endswith("_sess") for name in response.cookies), dict(response.cookies)
        assert client.get("/api/auth/me").status_code == 401

    events = db_session.query(AuditLog).filter(AuditLog.user_id == users[role].id, AuditLog.event_type == "auth.login.wrong_way_in").all()
    assert len(events) == 2
    assert {json.loads(e.event_data_json)["chosen"] for e in events} == set(WAYS_IN) - {way_in}
    assert all(json.loads(e.event_data_json)["accountUses"] == way_in for e in events)
    assert db_session.query(AuditLog).filter(AuditLog.user_id == users[role].id, AuditLog.event_type == "auth.login.success").count() == 0


def test_a_student_code_is_refused_under_teacher_and_admin(client, db_session):
    accounts = Accounts(db_session)
    assert _login(client, accounts.student_code, "STUDENT").status_code == 200
    client.cookies.clear()
    for chosen in ("TEACHER", "ADMIN"):
        response = _login(client, accounts.student_code.lower(), chosen)
        assert response.status_code == 403
        assert response.json()["detail"]["details"] == {"signInAs": "STUDENT"}


def test_a_wrong_password_says_the_same_thing_on_every_way_in(client, db_session):
    """Who an address belongs to is told only to someone who knows its password."""
    accounts = Accounts(db_session)
    sentences = set()
    for role in ROLES:
        for chosen in (None, *WAYS_IN):
            response = _login(client, accounts.email[role], chosen, password="not-the-password")
            assert response.status_code in (401, 423), (role, chosen, response.text)
            detail = response.json()["detail"]
            assert detail["code"] in ("INVALID_CREDENTIALS", "ACCOUNT_LOCKED")
            assert "signInAs" not in detail["details"]
            if detail["code"] == "INVALID_CREDENTIALS":
                sentences.add(detail["message"])
        # Nor is a guess recorded as anything but a failed attempt.
        assert db_session.query(AuditLog).filter(AuditLog.user_id == accounts.users[role].id, AuditLog.event_type == "auth.login.wrong_way_in").count() == 0
    # An address nobody has, on every way in: the same sentence again.
    for chosen in (None, *WAYS_IN):
        response = _login(client, "nobody.at.all@example.com", chosen)
        assert response.status_code == 401
        sentences.add(response.json()["detail"]["message"])
    assert sentences == {"Those sign-in details don't match. Please check them and try again."}


def test_an_admin_with_two_factor_gets_no_challenge_on_the_wrong_way_in(client, db_session):
    accounts = Accounts(db_session)
    admin = accounts.users["ADMIN"]
    admin.totp_enabled = True
    admin.totp_secret = TEST_TOTP_SECRET
    db_session.commit()

    wrong = _login(client, accounts.email["ADMIN"], "TEACHER")
    assert wrong.status_code == 403
    assert set(wrong.json()) == {"detail"}
    assert db_session.query(AuditLog).filter(AuditLog.user_id == admin.id, AuditLog.event_type == "auth.login.password_ok_awaiting_2fa").count() == 0

    right = _login(client, accounts.email["ADMIN"], "ADMIN")
    assert right.status_code == 200
    assert right.json()["twoFactorRequired"] is True and right.json()["challengeToken"]


def test_a_request_that_does_not_say_which_way_in_still_signs_in(client, db_session):
    """A page that was loaded before the field existed keeps working."""
    accounts = Accounts(db_session)
    for role in ROLES:
        response = _login(client, accounts.email[role])
        assert response.status_code == 200, (role, response.text)
        assert response.json()["user"]["role"] == role
        client.cookies.clear()


def test_a_way_in_that_does_not_exist_is_a_malformed_request(client, db_session):
    accounts = Accounts(db_session)
    for bad in ("SUPER_ADMIN", "student", "PARENT", ""):
        response = _login(client, accounts.email["STUDENT"], bad)
        assert response.status_code == 422, (bad, response.text)
        assert response.json()["detail"]["code"] == "VALIDATION_ERROR"
    assert client.get("/api/auth/me").status_code == 401


def test_the_wrong_way_in_does_not_count_towards_the_lockout(client, db_session):
    """The password was right: this is the account's owner, not a guess."""
    accounts = Accounts(db_session)
    users, email = accounts.users, accounts.email["TEACHER"]
    # Two real wrong passwords first, so there is a count to clear.
    for _ in range(2):
        assert _login(client, email, "TEACHER", password="not-the-password").status_code == 401
    db_session.refresh(users["TEACHER"])
    assert users["TEACHER"].failed_login_attempts == 2
    for _ in range(8):
        assert _login(client, email, "STUDENT").status_code == 403
    db_session.refresh(users["TEACHER"])
    assert users["TEACHER"].failed_login_attempts == 0
    assert users["TEACHER"].locked_until is None
    assert _login(client, email, "TEACHER").status_code == 200


def test_an_inactive_account_is_told_it_is_inactive_whatever_was_chosen(client, db_session):
    """The more useful sentence wins: choosing the right way in would not help."""
    accounts = Accounts(db_session)
    accounts.users["TEACHER"].is_active = False
    db_session.commit()
    for chosen in WAYS_IN:
        response = _login(client, accounts.email["TEACHER"], chosen)
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "ACCOUNT_INACTIVE"


def test_a_locked_account_is_told_only_that_it_is_locked(client, db_session):
    """The lock is checked before the password, so even the right password
    on the wrong way in learns nothing about the account while it is locked."""
    accounts = Accounts(db_session)
    teacher = accounts.users["TEACHER"]
    teacher.locked_until = datetime.now(timezone.utc) + timedelta(minutes=10)
    db_session.commit()
    seen = set()
    for chosen in (None, *WAYS_IN):
        for password in (PASSWORD, "not-the-password"):
            response = _login(client, accounts.email["TEACHER"], chosen, password=password)
            assert response.status_code == 423, (chosen, response.text)
            detail = response.json()["detail"]
            assert detail["code"] == "ACCOUNT_LOCKED" and detail["details"] == {}
            seen.add(detail["message"])
    assert len(seen) == 1
    assert db_session.query(AuditLog).filter(AuditLog.user_id == teacher.id, AuditLog.event_type == "auth.login.wrong_way_in").count() == 0


def test_what_was_chosen_is_recorded_beside_every_accepted_password(client, db_session):
    """So the audit trail shows when pages that do not say have stopped arriving."""
    accounts = Accounts(db_session)

    def last(user, event_type):
        row = db_session.query(AuditLog).filter(AuditLog.user_id == user.id, AuditLog.event_type == event_type).order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).first()
        return None if row is None or row.event_data_json is None else json.loads(row.event_data_json)

    assert _login(client, accounts.email["STUDENT"], "STUDENT").status_code == 200
    assert last(accounts.users["STUDENT"], "auth.login.success") == {"signInAs": "STUDENT"}
    client.cookies.clear()
    # An older page: accepted, and recorded as not having said.
    assert _login(client, accounts.email["TEACHER"]).status_code == 200
    assert last(accounts.users["TEACHER"], "auth.login.success") is None
    client.cookies.clear()
    admin = accounts.users["ADMIN"]
    admin.totp_enabled = True
    admin.totp_secret = TEST_TOTP_SECRET
    db_session.commit()
    assert _login(client, accounts.email["ADMIN"], "ADMIN").json()["twoFactorRequired"] is True
    assert last(admin, "auth.login.password_ok_awaiting_2fa") == {"signInAs": "ADMIN"}


def test_the_sentences_name_the_three_choices_as_the_page_does():
    """ "Choose Teacher above" only helps if "Teacher" is what the page says.
    The other half of this is frontend/tests/unit/signInCopy.test.mjs."""
    from app.core.errors import WAY_IN_FOR_ROLE, wrong_way_in_message

    assert set(WAY_IN_FOR_ROLE.values()) == {"STUDENT", "TEACHER", "ADMIN"}
    assert wrong_way_in_message("STUDENT") == "These are a student's sign-in details. Choose Student above to sign in."
    assert wrong_way_in_message("TEACHER") == "These are a teacher's sign-in details. Choose Teacher above to sign in."
    assert wrong_way_in_message("ADMIN") == "These are a school admin's sign-in details. Choose Admin above to sign in."
    assert wrong_way_in_message("SUPER_ADMIN") == "These are a Super Admin's sign-in details. Choose Admin above to sign in."
