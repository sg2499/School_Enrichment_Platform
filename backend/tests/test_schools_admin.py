"""Schools for the Super Admin (#211, 29 Oct 2026).

Rules under test: only the Super Admin may list, add, change, suspend or
restore schools; a school is added with its board and its first admin
(whose generated first password signs in); the board must be one Krama
has, and can't be changed while teachers teach another board's courses;
a school with the same name in the same city is refused; an email already
on Krama is refused without saying so, and leaves no half-made school;
suspending needs the school's name typed out, ends its people's sessions at
once and stops them signing in, and restoring lets them back; the Super
Admin can set a school's logo.
"""

import io

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.models import AuditLog, School, User
from tests.test_learning import (
    PASSWORD,
    _assign_teacher_section,
    _get_or_create_board_course,
    _login,
    _make_school,
    _make_school_admin,
    _make_super_admin,
    _make_teacher,
)


def _sa(client, db, sx):
    sa = _make_super_admin(db, sx)
    return {**_login(client, sa.email), "x-auth-role": "SUPER_ADMIN"}, sa


def test_add_a_school_and_its_first_admin(client, db_session):
    db = db_session
    _get_or_create_board_course(db, "SCH1")  # the CBSE board
    db.commit()
    headers, sa = _sa(client, db, "sch1")

    body = client.post(
        "/api/schools-admin",
        headers=headers,
        json={
            "name": "  Green   Valley School ",
            "board": "cbse",
            "city": "Mysuru",
            "state": "Karnataka",
            "adminFullName": "Lakshmi Rao",
            "adminEmail": "Lakshmi.GV@example.com",
        },
    )
    assert body.status_code == 200, body.text
    made = body.json()
    assert made["school"]["name"] == "Green Valley School" and made["school"]["board"] == "CBSE"
    assert made["admin"]["email"] == "lakshmi.gv@example.com" and len(made["admin"]["initialPassword"]) == 12
    with TestClient(app) as other:
        signed = other.post(
            "/api/auth/login",
            json={
                "identifier": "lakshmi.gv@example.com",
                "password": made["admin"]["initialPassword"],
                "signInAs": "ADMIN",
            },
        )
        assert signed.status_code == 200, signed.text

    listed = client.get("/api/schools-admin", headers=headers).json()
    row = next(s for s in listed["schools"] if s["id"] == made["school"]["id"])
    assert row["counts"]["admins"] == 1 and row["counts"]["notSignedIn"] == 1 and row["isActive"]
    assert "CBSE" in [b["code"] for b in listed["boards"]]
    detail = client.get(f"/api/schools-admin/{row['id']}", headers=headers).json()
    assert [a["fullName"] for a in detail["admins"]] == ["Lakshmi Rao"] and detail["admins"][0]["signedIn"] is False
    assert (
        db.query(AuditLog).filter(AuditLog.event_type == "platform.school_created", AuditLog.user_id == sa.id).count()
        == 1
    )
    assert made["admin"]["initialPassword"] not in str(
        [a.event_data_json for a in db.query(AuditLog).filter(AuditLog.user_id == sa.id)]
    )

    # What is refused: no board, an unknown board, the same school again, a used email.
    def refused(**changes):
        data = {
            "name": "Hill View",
            "board": "CBSE",
            "city": "Mysuru",
            "adminFullName": "A B",
            "adminEmail": "hv@example.com",
        }
        return client.post("/api/schools-admin", headers=headers, json={**data, **changes})

    assert "Choose the school's board" in refused(board="").json()["detail"]["message"]
    assert refused(board="IB").status_code == 422
    assert (
        "already a school called Green Valley School in Mysuru"
        in refused(name="green valley school").json()["detail"]["message"]
    )
    taken = refused(adminEmail="lakshmi.gv@example.com")
    assert taken.status_code == 422 and "lakshmi" not in taken.text
    assert db.query(School).filter(School.name == "Hill View").count() == 0  # nothing half-made
    assert refused(adminEmail="").status_code == 422


def test_edit_a_school_and_its_board(client, db_session):
    db = db_session
    course, _d, _v = _get_or_create_board_course(db, "SCH2")
    school = _make_school(db, "sch2")
    school.board = None  # like the test school on production
    db.commit()
    headers, _sa_user = _sa(client, db, "sch2")

    body = client.patch(
        f"/api/schools-admin/{school.id}", headers=headers, json={"board": "CBSE", "city": " Hubballi "}
    )
    assert body.status_code == 200, body.text
    assert body.json()["school"]["board"] == "CBSE" and body.json()["school"]["city"] == "Hubballi"
    assert client.patch(f"/api/schools-admin/{school.id}", headers=headers, json={"name": ""}).status_code == 422

    # A teacher teaching a CBSE course: the board can't move to another board under them.
    from app.models.curriculum import Board

    if not db.query(Board).filter(Board.code == "ICSE").first():
        db.add(Board(code="ICSE", display_name="ICSE"))
        db.commit()
    teacher = _make_teacher(db, school, "sch2-t")
    _assign_teacher_section(db, teacher, course.id, "A")
    moved = client.patch(f"/api/schools-admin/{school.id}", headers=headers, json={"board": "ICSE"})
    assert (
        moved.status_code == 422
        and "has 1 section taught on another board's courses" in moved.json()["detail"]["message"]
    )
    db.refresh(school)
    assert school.board == "CBSE"


def test_suspend_and_restore(client, db_session):
    db = db_session
    _get_or_create_board_course(db, "SCH3")
    school = _make_school(db, "sch3")
    db.commit()
    teacher = _make_teacher(db, school, "sch3-t")
    headers, _sa_user = _sa(client, db, "sch3")

    with TestClient(app) as t_client:
        t_headers = {**_login(t_client, teacher.user.email), "x-auth-role": "TEACHER"}
        assert t_client.get("/api/auth/me", headers=t_headers).status_code == 200

        stray = client.post(f"/api/schools-admin/{school.id}/status", headers=headers, json={"active": False})
        assert stray.status_code == 422  # the name must be typed
        off = client.post(
            f"/api/schools-admin/{school.id}/status",
            headers=headers,
            json={"active": False, "confirmName": school.name.upper()},
        )
        assert off.status_code == 200 and off.json()["school"]["isActive"] is False
        ended = t_client.get("/api/auth/me", headers=t_headers)
        assert ended.status_code == 401 and "paused" in ended.json()["detail"]["message"]

    with TestClient(app) as again:
        blocked = again.post("/api/auth/login", json={"identifier": teacher.user.email, "password": PASSWORD})
        assert blocked.status_code == 403 and blocked.json()["detail"]["code"] == "SCHOOL_SUSPENDED"
        wrong = again.post("/api/auth/login", json={"identifier": teacher.user.email, "password": "Wrong-pass-1"})
        assert wrong.status_code == 401  # a wrong password learns nothing about the school
    listed = client.get("/api/schools-admin", headers=headers).json()["schools"]
    assert next(s for s in listed if s["id"] == school.id)["isActive"] is False

    on = client.post(f"/api/schools-admin/{school.id}/status", headers=headers, json={"active": True})
    assert on.status_code == 200 and on.json()["school"]["isActive"] is True
    with TestClient(app) as back:
        assert (
            back.post("/api/auth/login", json={"identifier": teacher.user.email, "password": PASSWORD}).status_code
            == 200
        )
    events = [a.event_type for a in db.query(AuditLog).filter(AuditLog.event_type.like("platform.school_%"))]
    assert "platform.school_suspended" in events and "platform.school_restored" in events


def test_a_schools_logo(client, db_session):
    db = db_session
    school = _make_school(db, "sch4")
    db.commit()
    headers, _sa_user = _sa(client, db, "sch4")
    png = io.BytesIO()
    Image.new("RGB", (120, 60), (20, 60, 120)).save(png, format="PNG")
    up = client.put(
        f"/api/schools-admin/{school.id}/logo",
        headers=headers,
        files={"file": ("logo.png", png.getvalue(), "image/png")},
    )
    assert up.status_code == 200, up.text
    url = up.json()["school"]["logoUrl"]
    assert url and client.get(url, headers=headers).status_code == 200
    gone = client.delete(f"/api/schools-admin/{school.id}/logo", headers=headers)
    assert gone.json()["school"]["logoUrl"] is None


def test_only_the_super_admin(client, db_session):
    db = db_session
    school = _make_school(db, "sch5")
    db.commit()
    admin = _make_school_admin(db, school, "sch5")
    a_headers = {**_login(client, admin.email), "x-auth-role": "ADMIN"}
    assert client.get("/api/schools-admin", headers=a_headers).status_code == 403
    assert client.get(f"/api/schools-admin/{school.id}", headers=a_headers).status_code == 403
    assert client.patch(f"/api/schools-admin/{school.id}", headers=a_headers, json={"board": "CBSE"}).status_code == 403
    assert (
        client.post(f"/api/schools-admin/{school.id}/status", headers=a_headers, json={"active": True}).status_code
        == 403
    )
    new = {"name": "X", "board": "CBSE", "adminFullName": "Y Z", "adminEmail": "yz-sch5@example.com"}
    assert client.post("/api/schools-admin", headers=a_headers, json=new).status_code == 403
    assert db.get(User, admin.id).is_active


def test_review_fixes(client, db_session):
    """The 29 Oct review's findings, each as it was found."""
    from datetime import UTC, datetime

    db = db_session
    _get_or_create_board_course(db, "SCH6")
    school = _make_school(db, "sch6")
    school.name = "St.  Mary  School"  # doubled spaces, as the old operator endpoint allowed
    db.commit()
    teacher = _make_teacher(db, school, "sch6-t")
    headers, _sa_user = _sa(client, db, "sch6")

    # 1. Suspending ends sessions: restoring doesn't bring back one left open.
    with TestClient(app) as t_client:
        t_headers = {**_login(t_client, teacher.user.email), "x-auth-role": "TEACHER"}
        # 3. The name, typed with ordinary spacing, suspends it.
        off = client.post(
            f"/api/schools-admin/{school.id}/status",
            headers=headers,
            json={"active": False, "confirmName": "st. mary school"},
        )
        assert off.status_code == 200, off.text
        client.post(f"/api/schools-admin/{school.id}/status", headers=headers, json={"active": True})
        assert t_client.get("/api/auth/me", headers=t_headers).status_code == 401

    # 3. ...and the same name with ordinary spacing is the same school.
    same = client.post(
        "/api/schools-admin",
        headers=headers,
        json={
            "name": "St. Mary School",
            "board": "CBSE",
            "city": "Bengaluru",
            "adminFullName": "A B",
            "adminEmail": "ab-sch6@example.com",
        },
    )
    assert same.status_code == 422 and "already a school called" in same.json()["detail"]["message"]

    # 5. An over-long admin name is refused in words, not a database error.
    long = client.post(
        "/api/schools-admin",
        headers=headers,
        json={
            "name": "Long Name School",
            "board": "CBSE",
            "adminFullName": "A" * 151,
            "adminEmail": "ln-sch6@example.com",
        },
    )
    assert long.status_code == 422 and "150 characters" in long.json()["detail"]["message"]

    # 6. Someone who has used Krama isn't "not signed in" after a password reset.
    teacher.user.must_change_password = True
    teacher.user.last_active_at = datetime.now(UTC)
    db.commit()
    row = next(s for s in client.get("/api/schools-admin", headers=headers).json()["schools"] if s["id"] == school.id)
    assert row["counts"]["teachers"] == 1 and row["counts"]["notSignedIn"] == 0

    # 2. A suspended school can still be chosen on People and Classes & Sections.
    client.post(
        f"/api/schools-admin/{school.id}/status",
        headers=headers,
        json={"active": False, "confirmName": "St. Mary School"},
    )
    picker = client.get("/api/curriculum-admin/schools", headers=headers, params={"includeSuspended": "true"}).json()
    assert {"id": school.id, "isActive": False}.items() <= next(
        s for s in picker["schools"] if s["id"] == school.id
    ).items()
    assert school.id not in [
        s["id"] for s in client.get("/api/curriculum-admin/schools", headers=headers).json()["schools"]
    ]
