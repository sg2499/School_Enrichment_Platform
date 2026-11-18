"""A child's PDF on an answer (#237, 17 Nov 2026).

Rules under test: the box is only for questions the platform reads as asking
for working or a drawing (a reviewer's choice wins); only a real PDF within
20 MB and 15 pages, with no scripts, is accepted, refused in words
otherwise; one file per answer, replaced by a new upload and removable until
the practice is submitted; the child, their teacher and their school's admin
can open it, another school, another child and the Super Admin cannot; the
storage behind it is swappable.
"""
import io
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from reportlab.pdfgen import canvas

from app.main import app
from app.models import AnswerAttachment, StoredFile
from app.services import attachment_service, file_storage, upload_rule_service
from tests.test_learning import (
    _assign_teacher_section,
    _login,
    _make_school,
    _make_school_admin,
    _make_sectioned_student,
    _make_super_admin,
    _make_teacher,
)
from tests.test_practice_tracker import _CH, _activity, _assign, _question, _target

_CH["PDF1"] = 91
_CH["PDF2"] = 92
_CH["PDF3"] = 93


def _pdf(pages=1) -> bytes:
    out = io.BytesIO()
    pdf = canvas.Canvas(out)
    for n in range(pages):
        pdf.drawString(72, 720, f"Working, page {n + 1}")
        pdf.showPage()
    pdf.save()
    return out.getvalue()


def _q(stem, *, auto=False, kind="Constructed Response", rule=None):
    return SimpleNamespace(auto_gradable=auto, question_type=kind, stem=stem, response_format=None, upload_rule=rule)


# --- which questions take a PDF ---------------------------------------------------------------


def test_the_rule_reads_the_question():
    assert upload_rule_service.detect(_q("Draw a triangle with sides 3, 4 and 5 cm."))[0] == "REQUIRED"
    assert upload_rule_service.detect(_q("Show all working and explain your reasoning. Construct angle ABC = 60 degrees."))[0] == "REQUIRED"
    assert upload_rule_service.detect(_q("Plot the points on a graph, then attach a photo."))[0] == "REQUIRED"
    assert upload_rule_service.detect(_q("Explain why a square is a rectangle."))[0] == "OPTIONAL"
    assert upload_rule_service.detect(_q("Show your working for 14 x 12."))[0] == "OPTIONAL"
    # "Draw or describe": a typed answer can earn full marks, so it is optional.
    assert upload_rule_service.detect(_q("Draw or describe two right angles. Explain why both are right angles."))[0] == "OPTIONAL"
    assert upload_rule_service.detect(_q("Sketch or write the steps to bisect an angle."))[0] == "OPTIONAL"
    # Only mentions drawing: a question to answer in words.
    assert upload_rule_service.detect(_q("In an SSS construction, after drawing the base, what locates the apex?"))[0] == "NONE"
    assert upload_rule_service.detect(_q("Name the longest side."))[0] == "NONE"
    # A question the platform marks itself never gets the box.
    assert upload_rule_service.detect(_q("Draw the shape and write its name.", auto=True, kind="Text Entry"))[0] == "NONE"


def test_a_reviewers_choice_wins():
    assert upload_rule_service.effective(_q("Name the longest side.", rule="REQUIRED"))[0] == "REQUIRED"
    assert upload_rule_service.effective(_q("Draw a triangle.", rule="NONE"))[0] == "NONE"
    assert upload_rule_service.effective(_q("Draw a triangle.", rule=""))[0] == "REQUIRED"


# --- the PDF checks ---------------------------------------------------------------------------


def _refused(data: bytes) -> str:
    with pytest.raises(Exception) as caught:
        attachment_service.check_pdf(data)
    return caught.value.detail["code"] if hasattr(caught.value, "detail") else str(caught.value)


def test_only_a_plain_pdf_within_the_limits_is_accepted():
    assert attachment_service.check_pdf(_pdf(3)) == 3
    assert _refused(b"") == "VALIDATION_ERROR"
    assert _refused(b"GIF89a not a pdf") == "NOT_A_PDF"
    assert _refused(_pdf(1)[:200]) == "NOT_A_PDF"  # cut off
    assert _refused(_pdf(attachment_service.MAX_PAGES + 1)) == "TOO_MANY_PAGES"
    assert _refused(_pdf(1) + b"\n% /JavaScript (app.alert(1))") == "UNSAFE_PDF"
    assert _refused(b"%PDF-1.4\n" + b"0" * (attachment_service.MAX_BYTES + 1)) == "FILE_TOO_LARGE"
    locked = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(200, 200)
    writer.encrypt("secret")
    writer.write(locked)
    assert _refused(locked.getvalue()) == "NOT_A_PDF"


def test_file_names_are_made_safe():
    assert attachment_service.clean_filename("../../etc/passwd") == "passwd.pdf"
    assert attachment_service.clean_filename('My "work".pdf') == "My _work_.pdf"
    assert attachment_service.clean_filename(None) == "working.pdf"
    assert attachment_service.clean_filename("a" * 300 + ".pdf").endswith(".pdf")
    assert len(attachment_service.clean_filename("a" * 300 + ".pdf")) <= attachment_service.MAX_FILENAME


# --- storage is swappable ---------------------------------------------------------------------


def test_the_storage_is_a_setting(db_session, tmp_path, monkeypatch):
    assert file_storage.get_storage().name == "database"
    monkeypatch.setenv("FILE_STORAGE", "local")
    monkeypatch.setenv("FILE_STORAGE_DIR", str(tmp_path))
    local = file_storage.get_storage()
    assert local.name == "local"
    for storage in (file_storage.get_storage("database"), local):
        storage.save(db_session, "answers/x/one.pdf", b"%PDF-bytes")
        assert storage.read(db_session, "answers/x/one.pdf") == b"%PDF-bytes"
        storage.delete(db_session, "answers/x/one.pdf")
        assert storage.read(db_session, "answers/x/one.pdf") is None
    with pytest.raises(ValueError):
        local.save(db_session, "../escape.pdf", b"x")
    monkeypatch.setenv("FILE_STORAGE", "bucket")
    with pytest.raises(RuntimeError):
        file_storage.get_storage()


# --- the whole practice flow ------------------------------------------------------------------


def _setup(db, suffix, tag):
    activity, chapter = _activity(db, suffix, constructed=True)
    q2, q3 = _question(db, f"{suffix}-Q2"), _question(db, f"{suffix}-Q3")
    q2.stem = "Draw a triangle with sides 3, 4 and 5 cm."
    q3.stem = "Explain how you found the perimeter."
    school = _make_school(db, tag)
    teacher = _make_teacher(db, school, tag)
    student = _make_sectioned_student(db, school, f"{tag}-a", class_name="5", section="A")
    other_student = _make_sectioned_student(db, school, f"{tag}-b", class_name="5", section="A")
    admin = _make_school_admin(db, school, tag)
    _assign_teacher_section(db, teacher, chapter.board_course_id, "A")
    assignment = _assign(db, school, activity, teacher.user_id)
    db.commit()
    return SimpleNamespace(school=school, teacher=teacher, student=student, other=other_student, admin=admin,
                           assignment=assignment, q1=_question(db, f"{suffix}-Q1"), q2=q2, q3=q3)


def _signed_in(email, role=None):
    browser = TestClient(app)
    headers = _login(browser, email)
    if role:
        headers["x-auth-role"] = role
    return browser, headers


def _put(browser, headers, attempt_id, question_id, content, name="working.pdf", kind="application/pdf"):
    return browser.put(f"/api/learning/attempts/{attempt_id}/answers/{question_id}/attachment",
                       files={"file": (name, content, kind)}, headers=headers)


def test_a_child_attaches_replaces_and_removes_a_pdf_until_submitting(client, db_session):
    db = db_session
    world = _setup(db, "PDF1", "pdf1")
    student_c, student_h = _signed_in(world.student.user.email)
    target = _target(db, world.assignment, world.student)
    attempt = student_c.post("/api/learning/attempts", json={"assignmentTargetId": target.id}, headers=student_h).json()
    rules = {q["id"]: q["uploadRule"] for q in attempt["questions"]}
    assert rules == {world.q1.id: "NONE", world.q2.id: "REQUIRED", world.q3.id: "OPTIONAL"}
    assert all(q["attachment"] is None for q in attempt["questions"])

    # Not a question that takes one; not a PDF; too many pages.
    no_box = _put(student_c, student_h, attempt["id"], world.q1.id, _pdf())
    assert no_box.status_code == 422 and no_box.json()["detail"]["code"] == "NO_UPLOAD_HERE"
    photo = _put(student_c, student_h, attempt["id"], world.q2.id, b"\xff\xd8\xff photo", "work.jpg", "image/jpeg")
    assert photo.status_code == 422 and "scanner app" in photo.json()["detail"]["message"]
    long = _put(student_c, student_h, attempt["id"], world.q2.id, _pdf(16))
    assert long.status_code == 422 and long.json()["detail"]["code"] == "TOO_MANY_PAGES"
    assert db.query(AnswerAttachment).count() == 0

    first = _put(student_c, student_h, attempt["id"], world.q2.id, _pdf(2), "My triangle.pdf")
    assert first.status_code == 200, first.text
    saved = first.json()["attachment"]
    assert (saved["filename"], saved["pageCount"]) == ("My triangle.pdf", 2)

    # Resuming shows it; a newer upload replaces it (one file per answer).
    resumed = student_c.post("/api/learning/attempts", json={"assignmentTargetId": target.id}, headers=student_h).json()
    assert {q["id"]: q["attachment"] for q in resumed["questions"]}[world.q2.id]["id"] == saved["id"]
    second = _put(student_c, student_h, attempt["id"], world.q2.id, _pdf(1), "Better.pdf").json()["attachment"]
    assert second["id"] != saved["id"] and db.query(AnswerAttachment).count() == 1
    assert db.query(StoredFile).count() == 1  # the old bytes went too

    gone = student_c.delete(f"/api/learning/attempts/{attempt['id']}/answers/{world.q2.id}/attachment", headers=student_h)
    assert gone.status_code == 200 and db.query(AnswerAttachment).count() == 0 and db.query(StoredFile).count() == 0

    # Attach again, answer the rest, submit: the file is locked.
    kept = _put(student_c, student_h, attempt["id"], world.q2.id, _pdf(2)).json()["attachment"]
    for question in (world.q1, world.q3):
        student_c.put(f"/api/learning/attempts/{attempt['id']}/answers",
                      json={"questionId": question.id, "responseText": "A"}, headers=student_h)
    assert student_c.post(f"/api/learning/attempts/{attempt['id']}/submit", headers=student_h).status_code == 200
    locked = _put(student_c, student_h, attempt["id"], world.q2.id, _pdf(1))
    assert locked.status_code == 409 and locked.json()["detail"]["code"] == "ATTEMPT_LOCKED"
    removal = student_c.delete(f"/api/learning/attempts/{attempt['id']}/answers/{world.q2.id}/attachment", headers=student_h)
    assert removal.status_code == 409

    # The child's result and the teacher's review both carry it.
    result = student_c.get(f"/api/learning/attempts/{attempt['id']}/result", headers=student_h).json()
    by_id = {a["questionId"]: a for a in result["answers"]}
    assert by_id[world.q2.id]["attachment"]["id"] == kept["id"] and by_id[world.q2.id]["uploadRule"] == "REQUIRED"
    teacher_c, teacher_h = _signed_in(world.teacher.user.email)
    review = teacher_c.get(f"/api/learning/tracker/attempts/{attempt['id']}", headers=teacher_h).json()
    assert {a["questionId"]: a["attachment"] for a in review["answers"]}[world.q2.id]["id"] == kept["id"]


def test_who_can_open_a_file(client, db_session):
    db = db_session
    world = _setup(db, "PDF2", "pdf2")
    student_c, student_h = _signed_in(world.student.user.email)
    target = _target(db, world.assignment, world.student)
    attempt = student_c.post("/api/learning/attempts", json={"assignmentTargetId": target.id}, headers=student_h).json()
    pdf = _pdf(2)
    attachment = _put(student_c, student_h, attempt["id"], world.q2.id, pdf).json()["attachment"]
    url = f"/api/attachments/{attachment['id']}"

    # The child, their teacher and the school's admin.
    for browser, headers in (
        (student_c, student_h),
        _signed_in(world.teacher.user.email),
        _signed_in(world.admin.email, "ADMIN"),
    ):
        opened = browser.get(url, headers=headers)
        assert opened.status_code == 200 and opened.content == pdf
        assert opened.headers["content-type"] == "application/pdf"
        assert opened.headers["cache-control"] == "private, no-store"
        assert opened.headers["x-content-type-options"] == "nosniff"

    # Not another child, another school's teacher or admin, or the Super Admin.
    other_child = _signed_in(world.other.user.email)
    assert other_child[0].get(url, headers=other_child[1]).status_code == 404
    other_school = _make_school(db, "pdf2-other")
    stranger = _make_teacher(db, other_school, "pdf2-other")
    stranger_admin = _make_school_admin(db, other_school, "pdf2-other")
    super_admin = _make_super_admin(db, "pdf2")
    db.commit()
    for email, role in ((stranger.user.email, None), (stranger_admin.email, "ADMIN"), (super_admin.email, "SUPER_ADMIN")):
        browser, headers = _signed_in(email, role)
        assert browser.get(url, headers=headers).status_code == 404, email
    assert student_c.get("/api/attachments/not-a-file", headers=student_h).status_code == 404
    # And the teacher's opening is on the audit trail.
    from app.models import AuditLog
    assert db.query(AuditLog).filter(AuditLog.event_type == "attachment.opened").count() >= 2


def test_the_questions_setting_can_be_set_by_a_reviewer(client, db_session):
    db = db_session
    world = _setup(db, "PDF3", "pdf3")
    super_admin = _make_super_admin(db, "pdf3")
    db.commit()
    browser, headers = _signed_in(super_admin.email, "SUPER_ADMIN")
    url = f"/api/curriculum-admin/questions/{world.q1.id}/marking"
    detail = browser.patch(url, json={"uploadRule": "required"}, headers=headers)
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert (body["uploadRule"], body["effectiveUploadRule"]) == ("REQUIRED", "REQUIRED")
    bad = browser.patch(url, json={"uploadRule": "sometimes"}, headers=headers)
    assert bad.status_code == 422
    cleared = browser.patch(url, json={"uploadRule": None}, headers=headers).json()
    assert cleared["uploadRule"] is None and cleared["effectiveUploadRule"] == "NONE"


# --- a mock paper -----------------------------------------------------------------------------


def test_a_pdf_on_a_mock_paper_follows_the_sitting_rules(db_session):
    import json
    from datetime import timedelta

    from fastapi import HTTPException

    from app.models.papers import QuestionPattern
    from app.services import mock_sitting_service as sit
    from tests.test_mock_papers import _world
    from tests.test_mock_sittings import SMALL, T1, WRITTEN, _paper

    db = db_session
    w = _world(db, "ATM9", students=1)
    for p in db.query(QuestionPattern).filter(QuestionPattern.board_course_id == w["chapter"].board_course_id,
                                              QuestionPattern.marks == 3):
        spec = json.loads(p.spec_json)
        keep = {k: spec[k] for k in ("code", "chapter", "skill", "difficulty", "competency") if k in spec}
        p.spec_json, p.question_type = json.dumps({**keep, **WRITTEN}), "Constructed Response"
    db.commit()
    paper, teacher = _paper(db, w, SMALL)
    (student,) = w["students"]
    view = sit.start(db, student, paper.id, now=T1)
    writing = T1 + timedelta(minutes=6)
    (part,) = view["sections"][1]["places"][0]["halves"][0]["parts"]
    from app.models import Question
    question = db.get(Question, part["id"])
    question.stem = "Draw a rectangle 4 cm by 3 cm and mark its diagonals."
    db.commit()
    assert sit.view(db, student, paper.id, now=writing)["sections"][1]["places"][0]["halves"][0]["parts"][0]["uploadRule"] == "REQUIRED"

    # Not in reading time.
    with pytest.raises(HTTPException) as early:
        sit.answer_for_upload(db, student, paper.id, part["id"], now=T1 + timedelta(minutes=1))
    assert early.value.detail["code"] == "READING_TIME"

    # While writing: the answer row is made and the PDF attaches.
    answer, _q = sit.answer_for_upload(db, student, paper.id, part["id"], now=writing)
    record = attachment_service._store(db, student, student.user, question, _pdf(2), "rect.pdf", 2, mock_answer_id=answer.id)
    sit.save_answer(db, student, paper.id, part["id"], "See the attached drawing.", now=writing)
    db.commit()
    shown = sit.view(db, student, paper.id, now=writing)["sections"][1]["places"][0]["halves"][0]["parts"][0]
    assert shown["attachment"]["id"] == record.id and shown["attachment"]["pageCount"] == 2

    # Handed in: the teacher marking sees it; the student's result too; locked now.
    sit.submit(db, student, paper.id, now=writing + timedelta(minutes=1))
    marking = sit.marking(db, teacher, paper.id, now=writing + timedelta(minutes=2))
    (marked,) = marking["questions"][0]["answers"]
    assert marked["attachment"]["id"] == record.id and marked["uploadRule"] == "REQUIRED"
    with pytest.raises(HTTPException) as late:
        sit.answer_for_upload(db, student, paper.id, part["id"], now=writing + timedelta(minutes=3))
    assert late.value.detail["code"] == "HANDED_IN"


def test_who_can_open_a_mock_paper_file(client, db_session):
    """The same opening rules hold for a PDF on a mock paper: the child, the
    teacher of that section and the school's admin; not another child, another
    section's teacher, another school, or the Super Admin."""
    import json
    from datetime import timedelta

    from app.models import Question
    from app.models.papers import QuestionPattern
    from app.services import mock_sitting_service as sit
    from tests.test_mock_papers import _world
    from tests.test_mock_sittings import SMALL, T1, WRITTEN, _paper

    db = db_session
    w = _world(db, "ATM8", students=2)
    for p in db.query(QuestionPattern).filter(QuestionPattern.board_course_id == w["chapter"].board_course_id,
                                              QuestionPattern.marks == 3):
        spec = json.loads(p.spec_json)
        keep = {k: spec[k] for k in ("code", "chapter", "skill", "difficulty", "competency") if k in spec}
        p.spec_json, p.question_type = json.dumps({**keep, **WRITTEN}), "Constructed Response"
    db.commit()
    paper, teacher = _paper(db, w, SMALL)
    student, classmate = w["students"]
    view = sit.start(db, student, paper.id, now=T1)
    writing = T1 + timedelta(minutes=6)
    (part,) = view["sections"][1]["places"][0]["halves"][0]["parts"]
    db.get(Question, part["id"]).stem = "Draw a rectangle 4 cm by 3 cm and mark its diagonals."
    db.commit()
    answer, question = sit.answer_for_upload(db, student, paper.id, part["id"], now=writing)
    pdf = _pdf(1)
    record = attachment_service._store(db, student, student.user, question, pdf, "rect.pdf", 1, mock_answer_id=answer.id)
    db.commit()
    url = f"/api/attachments/{record.id}"

    admin = _make_school_admin(db, w["school"], "atm8")
    other_school = _make_school(db, "atm8-other")
    stranger = _make_teacher(db, other_school, "atm8-other")
    stranger_admin = _make_school_admin(db, other_school, "atm8-other")
    super_admin = _make_super_admin(db, "atm8")
    db.commit()

    for browser, headers in (
        _signed_in(student.user.email),
        _signed_in(teacher.user.email),
        _signed_in(admin.email, "ADMIN"),
    ):
        opened = browser.get(url, headers=headers)
        assert opened.status_code == 200 and opened.content == pdf

    for email, role in (
        (classmate.user.email, None),
        (w["other"].user.email, None),
        (stranger.user.email, None),
        (stranger_admin.email, "ADMIN"),
        (super_admin.email, "SUPER_ADMIN"),
    ):
        browser, headers = _signed_in(email, role)
        assert browser.get(url, headers=headers).status_code == 404, email
