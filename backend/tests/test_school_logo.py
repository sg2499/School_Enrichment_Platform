"""The school's logo (#202, 26 Oct 2026).

Rules under test: only the school's own admin uploads or removes it; the
image is decoded, upright, trimmed of transparent margins, fitted and kept as
a PNG; anything that isn't a real PNG, JPG or WEBP (an SVG, a renamed file)
is refused in words; everyone signed in at the school can load it and
another school can't; the session carries its address, which changes when
it is replaced; the weekly report and report card PDFs print it.
"""
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.services import report_card_pdf, school_logo_service, weekly_report_pdf
from tests.test_learning import _login, _make_school, _make_school_admin, _make_sectioned_student, _make_teacher


def _png(size=(400, 200), margin=20, fmt="PNG") -> bytes:
    image = Image.new("RGBA", (size[0] + 2 * margin, size[1] + 2 * margin), (0, 0, 0, 0))
    image.paste(Image.new("RGBA", size, (30, 60, 160, 255)), (margin, margin))
    out = BytesIO()
    (image.convert("RGB") if fmt == "JPEG" else image).save(out, format=fmt)
    return out.getvalue()


def _upload(client, headers, content: bytes, name="logo.png", kind="image/png"):
    return client.put("/api/school-settings/logo", files={"file": (name, content, kind)}, headers=headers)


def test_upload_show_and_remove(client, db_session):
    db = db_session
    school = _make_school(db, "logo-a")
    admin = _make_school_admin(db, school, "logo-a")
    teacher = _make_teacher(db, school, "logo-a")
    student = _make_sectioned_student(db, school, "logo-a", class_name="5", section="A")
    other_school = _make_school(db, "logo-b")
    other_admin = _make_school_admin(db, other_school, "logo-b")
    db.commit()

    # Each person in their own browser (an admin signs in once: two-factor).
    admin_c = TestClient(app)
    admin_h = {**_login(admin_c, admin.email), "x-auth-role": "ADMIN"}
    client = admin_c
    assert client.get("/api/school-settings", headers=admin_h).json()["school"]["logoUrl"] is None

    # Refused, in words: not an image, an SVG, too small.
    bad = _upload(client, admin_h, b"<svg xmlns='http://www.w3.org/2000/svg'/>", "logo.svg", "image/svg+xml")
    assert bad.status_code == 422 and "PNG, JPG or WEBP" in bad.json()["detail"]["message"]
    renamed = _upload(client, admin_h, b"not really a png at all", "logo.png")
    assert renamed.status_code == 422
    tiny = _upload(client, admin_h, _png((10, 10), margin=0))
    assert tiny.status_code == 422 and "too small" in tiny.json()["detail"]["message"]

    saved = _upload(client, admin_h, _png((1200, 600)))
    assert saved.status_code == 200, saved.text
    body = saved.json()
    url = body["school"]["logoUrl"]
    assert url.startswith(f"/api/schools/{school.id}/logo?v=") and body["user"]["schoolLogoUrl"] == url

    # Kept as a PNG within 600 pixels, transparent margins trimmed (1200x600 -> 600x300).
    png = school_logo_service.logo_bytes(db, school.id)
    with Image.open(BytesIO(png)) as stored:
        assert stored.format == "PNG" and stored.size[0] == 600 and abs(stored.size[1] - 300) <= 1

    # Everyone at the school can load it; the session carries the address.
    people = {"ADMIN": (admin_c, admin_h)}
    for user, role in ((teacher.user, "TEACHER"), (student.user, "STUDENT")):
        browser = TestClient(app)
        people[role] = (browser, {**_login(browser, user.email), "x-auth-role": role})
    for role, (browser, headers) in people.items():
        me = browser.get("/api/auth/me", headers=headers).json()
        assert me["schoolLogoUrl"] == url, role
        shown = browser.get(url, headers=headers)
        assert shown.status_code == 200 and shown.headers["content-type"] == "image/png" and shown.content == png

    # Another school can't, and only an admin can change it.
    other_c = TestClient(app)
    other_h = {**_login(other_c, other_admin.email), "x-auth-role": "ADMIN"}
    assert other_c.get(url, headers=other_h).status_code == 404
    teacher_c, teacher_h = people["TEACHER"]
    assert _upload(teacher_c, teacher_h, _png()).status_code == 403

    # Replacing it changes the address; removing it clears it.
    again = _upload(client, admin_h, _png((300, 300), fmt="JPEG"), "logo.jpg", "image/jpeg").json()["school"]["logoUrl"]
    assert again and again != url
    gone = client.delete("/api/school-settings/logo", headers=admin_h).json()
    assert gone["school"]["logoUrl"] is None and gone["user"]["schoolLogoUrl"] is None
    assert client.get(again, headers=admin_h).status_code == 404


def test_pdfs_print_the_logo():
    wide, square = _png((800, 300), margin=0), _png((300, 300), margin=0)
    page = {
        "title": "Weekly Practice Report", "school": {"name": "Test School", "city": "Pune"},
        "student": {"id": "s", "name": "A B", "code": "C1", "classLevel": "Class 5", "section": "A"},
        "week": {"start": "2026-10-19", "end": "2026-10-25", "label": "19 to 25 Oct 2026"},
        "sets": [], "totals": {"given": 0, "done": 0, "onTime": 0, "late": 0, "notDone": 0, "open": 0},
        "weekNumbers": {"answered": 0, "marked": 0, "percent": None, "ownPractice": 0},
        "skills": {"strong": [], "workOn": []}, "notes": {"section": None, "child": None},
    }
    for logo in (wide, square):
        pdf = weekly_report_pdf.render([page], logo)
        assert pdf[:4] == b"%PDF" and b"/Subtype /Image" in pdf
    assert b"/Subtype /Image" not in weekly_report_pdf.render([page])
    # A logo that can't be read is left out, never an error.
    assert weekly_report_pdf.render([page], b"junk")[:4] == b"%PDF"
    card = {
        "cardTerm": "TERM_1", "title": "Term 1 Report Card", "year": "2026-27",
        "school": {"name": "Test School", "city": "Pune"},
        "student": {"name": "A B", "code": "C1", "classLevel": "Class 5", "section": "A", "dob": None},
        "subjects": [], "coScholastic": {"areas": [], "grades": {}, "scale": []}, "attendance": {}, "remark": None,
        "issuedAt": "2026-10-26T06:00:00+00:00",
    }
    assert b"/Subtype /Image" in report_card_pdf.render([card], wide)
    assert report_card_pdf.render([card], b"junk")[:4] == b"%PDF"


def test_review_fixes(client, db_session):
    """#202 review: a huge canvas in a small file is refused before it is
    decoded; an empty (fully transparent) image is refused; the size limit is
    applied after trimming; a damaged stored logo leaves the PDFs whole; an
    old logo address is not served; an oversized upload is refused from its
    declared length; a report on screen carries its school's logo."""
    import pytest

    big = Image.new("1", (9000, 9000))
    out = BytesIO()
    big.save(out, format="PNG")
    with pytest.raises(school_logo_service.LogoError) as huge:
        school_logo_service.clean_logo(out.getvalue())
    assert "too large in pixels" in huge.value.message
    with pytest.raises(school_logo_service.LogoError) as empty:
        school_logo_service.clean_logo(_blank())
    assert "looks empty" in empty.value.message
    with pytest.raises(school_logo_service.LogoError) as dot:
        school_logo_service.clean_logo(_png((2, 2), margin=99))
    assert "too small" in dot.value.message

    good = _png((300, 300), margin=0)
    truncated = good[: len(good) // 2]
    assert school_logo_service.readable_logo(truncated) is None
    page = {
        "title": "Weekly Practice Report", "school": {"name": "T", "city": None},
        "student": {"id": "s", "name": "A B", "code": "C1", "classLevel": "Class 5", "section": "A"},
        "week": {"start": "2026-10-19", "end": "2026-10-25", "label": "x"},
        "sets": [], "totals": {"given": 0, "done": 0, "onTime": 0, "late": 0, "notDone": 0, "open": 0},
        "weekNumbers": {"answered": 0, "marked": 0, "percent": None, "ownPractice": 0},
        "skills": {"strong": [], "workOn": []}, "notes": {"section": None, "child": None},
    }
    assert weekly_report_pdf.render([page], truncated)[:4] == b"%PDF"

    db = db_session
    school = _make_school(db, "logo-c")
    admin = _make_school_admin(db, school, "logo-c")
    db.commit()
    browser = TestClient(app)
    headers = {**_login(browser, admin.email), "x-auth-role": "ADMIN"}
    first = _upload(browser, headers, good).json()["school"]["logoUrl"]
    second = _upload(browser, headers, _png((200, 100), margin=0)).json()["school"]["logoUrl"]
    assert browser.get(first, headers=headers).status_code == 404
    assert browser.get(second, headers=headers).status_code == 200
    too_big = browser.put(
        "/api/school-settings/logo", files={"file": ("logo.png", b"x" * 4_100_000, "image/png")}, headers=headers
    )
    assert too_big.status_code == 413 and "too large" in too_big.json()["detail"]["message"]
    shown = school_logo_service.with_logo(db, {"school": {"name": "T"}}, school.id)
    assert shown["school"]["logoUrl"] == second


def _blank() -> bytes:
    out = BytesIO()
    Image.new("RGBA", (200, 200), (0, 0, 0, 0)).save(out, format="PNG")
    return out.getvalue()
