"""The weekly parent report (#187, 26 Oct 2026).

Rules under test: a child's week lists the practice set or due that week
(not cancelled, not their own practice), each Done on Time, Done Late or Not
Done; the week's numbers count every answer handed in that week, their own
practice included; notes are drafts until the week is issued; issuing keeps
each page exactly as issued, once per section and week; a withdrawn week can
be issued again; the student sees only their own issued pages; another
section's teacher, another school's admin and the Super Admin see nothing.
"""
from datetime import UTC, date, datetime, time, timedelta

from app.models import Attempt, AssignmentTarget, TeacherSectionAssignment, WeeklyReport
from app.services import learning_service
from app.services import weekly_report_service as service
from app.services.assessment_service import SCHOOL_TIMEZONE
from tests import test_learning
from tests.test_class_analytics import _do, _world
from tests.test_learning import _login, _make_school, _make_school_admin, _make_super_admin, _make_teacher

test_learning._CHAPTER_NUM.update({"WR1": 161})


def _at(day: date, hour: int, minute: int = 0) -> datetime:
    """A moment in India, stored as UTC (SQLite keeps no time zone, and
    the app reads a bare time as UTC, as Postgres hands it back)."""
    return datetime.combine(day, time(hour, minute), tzinfo=SCHOOL_TIMEZONE).astimezone(UTC)


def _submitted(db, target_id: str, when: datetime) -> None:
    for attempt in db.query(Attempt).filter(Attempt.assignment_target_id == target_id).all():
        attempt.submitted_at = when
    db.commit()


def test_weeks():
    assert service.week_label(date(2026, 10, 19)) == "19 to 25 Oct 2026"
    assert service.week_label(date(2026, 10, 26)) == "26 Oct to 1 Nov 2026"
    assert service.week_label(date(2026, 12, 28)) == "28 Dec 2026 to 3 Jan 2027"
    monday = date(2026, 10, 26)
    assert service.default_week(monday) == date(2026, 10, 19)  # weekdays: last week
    assert service.default_week(date(2026, 10, 31)) == monday  # Saturday: this week
    weeks = service.recent_weeks(date(2026, 10, 28))
    assert len(weeks) == 12 and weeks[0] == {"start": "2026-10-26", "label": "26 Oct to 1 Nov 2026", "isCurrent": True}
    assert service.parse_week("2026-10-19", monday) == date(2026, 10, 19)


def test_weekly_report_end_to_end(client, db_session):
    w = _world(db_session, "WR1")
    db = db_session
    a, b, c = w["students"]
    q1, q2, q3, q4, wr = w["qs"]
    last = service.monday_of(service.today()) - timedelta(weeks=1)
    level_id = w["assignment"].class_level_id
    scope = (level_id, "A", w["assignment"].board_course_id)

    # The world's assignment: set this week with no due date; move it back to
    # three weeks ago so it isn't this week's or last week's.
    w["assignment"].created_at = _at(last - timedelta(weeks=2), 9)
    # Last week's set: set Tuesday, due Wednesday.
    core = learning_service.create_assignment(
        db, school=w["school"], learning_activity=w["core"], assigned_by_user_id=w["teacher"].user_id,
        class_name="5", section="A", due_date=(last + timedelta(days=2)).isoformat(),
    )
    core.created_at = _at(last + timedelta(days=1), 9)
    # A cancelled one doesn't count.
    gone = learning_service.create_assignment(
        db, school=w["school"], learning_activity=w["remediation"], assigned_by_user_id=w["teacher"].user_id,
        class_name="5", section="A", due_date=(last + timedelta(days=3)).isoformat(),
    )
    gone.status = "CANCELLED"
    # One the teacher excused c from: not given to c.
    excused = learning_service.create_assignment(
        db, school=w["school"], learning_activity=w["remediation"], assigned_by_user_id=w["teacher"].user_id,
        student_ids=[c.id], due_date=(last + timedelta(days=4)).isoformat(),
    )
    excused.created_at = _at(last + timedelta(days=1), 10)
    db.commit()
    db.query(AssignmentTarget).filter_by(assignment_id=excused.id).one().status = "SKIPPED"
    db.commit()
    targets = {t.student_id: t for t in db.query(AssignmentTarget).filter_by(assignment_id=core.id)}
    _do(db, a, targets[a.id].id, {q1: "A", q2: "A", q3: "A", q4: "10"})
    _submitted(db, targets[a.id].id, _at(last + timedelta(days=2), 23, 50))  # 23:50 on the due day: on time
    _do(db, b, targets[b.id].id, {q1: "B", q2: "A", q3: "A", q4: "10"})
    _submitted(db, targets[b.id].id, _at(last + timedelta(days=4), 10))  # two days late
    # a's own practice that week: counted in the numbers, not in the sets.
    own = learning_service.create_assignment(
        db, school=w["school"], learning_activity=w["remediation"], assigned_by_user_id=a.user_id,
        student_ids=[a.id], reason="SELF_PRACTICE", section_scope=scope,
    )
    own.created_at = _at(last + timedelta(days=3), 9)
    db.commit()
    own_target = db.query(AssignmentTarget).filter_by(assignment_id=own.id).one()
    _do(db, a, own_target.id, {})
    _submitted(db, own_target.id, _at(last + timedelta(days=3), 19))

    teacher = {**_login(client, w["teacher"].user.email), "x-auth-role": "TEACHER"}
    sections = client.get("/api/weekly-reports/sections", headers=teacher).json()
    assert [(s["section"], s["canChange"]) for s in sections["sections"]] == [("A", True)]
    assert len(sections["weeks"]) == 12

    params = {"classLevelId": level_id, "section": "A", "weekStart": last.isoformat()}
    week = client.get("/api/weekly-reports/week", params=params, headers=teacher).json()
    assert week["issue"] is None and week["canChange"] is True
    rows = {r["studentCode"]: r for r in week["students"]}
    assert rows[a.student_code]["totals"] == {"given": 1, "done": 1, "onTime": 1, "late": 0, "notDone": 0, "open": 0}
    assert rows[b.student_code]["totals"]["late"] == 1
    assert rows[c.student_code]["totals"]["notDone"] == 1
    assert rows[a.student_code]["weekNumbers"]["ownPractice"] == 1
    # a answered the core's four auto-marked questions that week; the written
    # one left blank and the empty own practice are not answers.
    assert rows[a.student_code]["weekNumbers"]["answered"] == 4

    # Notes: one for the section and one for a.
    saved = client.put(
        "/api/weekly-reports/notes",
        json={**params, "sectionNote": "  Test on   Friday. ", "notes": [{"studentId": a.id, "note": "Well done."}]},
        headers=teacher,
    )
    assert saved.status_code == 200 and saved.json()["saved"] == 2
    stranger = test_learning._make_sectioned_student(db, w["school"], "wr1-x", class_name="5", section="B")
    db.commit()
    refused = client.put(
        "/api/weekly-reports/notes", json={**params, "updateSection": False, "notes": [{"studentId": stranger.id, "note": "x"}]},
        headers=teacher,
    )
    # A student who isn't in the section is skipped, never written.
    assert refused.status_code == 200 and refused.json()["saved"] == 0

    preview = client.get("/api/weekly-reports/preview", params={**params, "studentId": a.id}, headers=teacher).json()["report"]
    assert preview["notes"] == {"section": "Test on Friday.", "child": "Well done."}
    assert [s["statusLabel"] for s in preview["sets"]] == ["Done on Time"]
    assert set(preview["skills"]) == {"strong", "workOn"}
    assert "rank" not in str(preview).lower() and "standing" not in str(preview).lower()

    # Another section's teacher and another school's admin can't open it; the Super Admin is refused.
    other = {**_login(client, w["other_teacher"].user.email), "x-auth-role": "TEACHER"}
    assert client.get("/api/weekly-reports/week", params=params, headers=other).status_code == 404
    outsider = _make_school_admin(db, _make_school(db, "wr1-x"), "wr1-x")
    sup = _make_super_admin(db, "wr1-sup")
    db.commit()
    outsider_h = {**_login(client, outsider.email), "x-auth-role": "ADMIN"}
    assert client.get("/api/weekly-reports/week", params=params, headers=outsider_h).status_code == 404
    sup_h = {**_login(client, sup.email), "x-auth-role": "SUPER_ADMIN"}
    assert client.get("/api/weekly-reports/sections", headers=sup_h).status_code == 403
    # A future week, or a day that isn't a Monday, is refused.
    future = (service.monday_of(service.today()) + timedelta(weeks=1)).isoformat()
    assert client.get("/api/weekly-reports/week", params={**params, "weekStart": future}, headers=teacher).status_code == 422
    assert client.get(
        "/api/weekly-reports/week", params={**params, "weekStart": (last + timedelta(days=1)).isoformat()}, headers=teacher
    ).status_code == 422

    # A teacher who taught 5A until this Monday: reads issued pages of the
    # weeks they taught, never drafts or previews, and changes nothing.
    former = _make_teacher(db, w["school"], "wr1-former")
    db.add(TeacherSectionAssignment(
        school_id=w["school"].id, teacher_id=former.id, class_level_id=level_id, section="A",
        board_course_id=w["assignment"].board_course_id, start_date=last - timedelta(weeks=1),
        end_date=service.monday_of(service.today()),
    ))
    db.commit()
    former_h = {**_login(client, former.user.email), "x-auth-role": "TEACHER"}
    listed = client.get("/api/weekly-reports/sections", headers=former_h).json()["sections"]
    assert [(s["section"], s["canChange"]) for s in listed] == [("A", False)]
    assert listed[0]["weeks"] == [last.isoformat(), (last - timedelta(weeks=1)).isoformat()]
    drafts = client.get("/api/weekly-reports/week", params=params, headers=former_h).json()
    assert drafts["live"] is False and drafts["students"] == []
    assert client.get("/api/weekly-reports/preview", params={**params, "studentId": a.id}, headers=former_h).status_code == 403
    this_week = {**params, "weekStart": service.monday_of(service.today()).isoformat()}
    assert client.get("/api/weekly-reports/week", params=this_week, headers=former_h).status_code == 404

    # Issue: once per section and week; notes are then locked.
    teacher = {**_login(client, w["teacher"].user.email), "x-auth-role": "TEACHER"}
    issued = client.post("/api/weekly-reports/issues", json=params, headers=teacher)
    assert issued.status_code == 200, issued.text
    issue = issued.json()
    assert issue["status"] == "ISSUED" and issue["reportCount"] == 3
    assert client.post("/api/weekly-reports/issues", json=params, headers=teacher).status_code == 422
    assert client.put("/api/weekly-reports/notes", json={**params, "sectionNote": "x"}, headers=teacher).status_code == 422

    week = client.get("/api/weekly-reports/week", params=params, headers=teacher).json()
    assert week["issue"]["id"] == issue["id"] and all(r["reportId"] for r in week["students"])
    a_report = next(r["reportId"] for r in week["students"] if r["studentCode"] == a.student_code)
    # Kept as issued, whatever changes later.
    _do(db, c, targets[c.id].id, {q1: "A"})
    page = client.get(f"/api/weekly-reports/reports/{a_report}", headers=teacher).json()["report"]
    assert page["issuedBy"] == w["teacher"].user.full_name and page["notes"]["child"] == "Well done."
    week = client.get("/api/weekly-reports/week", params=params, headers=teacher).json()
    assert {r["studentCode"]: r for r in week["students"]}[c.student_code]["totals"]["notDone"] == 1

    pdf = client.get(f"/api/weekly-reports/issues/{issue['id']}/pdf", headers=teacher)
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF" and pdf.headers["content-type"] == "application/pdf"
    one = client.get(f"/api/weekly-reports/reports/{a_report}/pdf", headers=teacher)
    assert one.status_code == 200 and one.content[:4] == b"%PDF"
    sets = {r["studentCode"]: r for r in week["students"]}
    assert sets[c.student_code]["totals"]["given"] == 1  # the excused set isn't there

    # The former teacher reads the issued week but can't change it; another school's admin can't open a page.
    former_h = {**_login(client, former.user.email), "x-auth-role": "TEACHER"}
    seen = client.get("/api/weekly-reports/week", params=params, headers=former_h).json()
    assert seen["live"] is True and len(seen["students"]) == 3 and seen["canChange"] is False
    assert client.get(f"/api/weekly-reports/reports/{a_report}/pdf", headers=former_h).status_code == 200
    assert client.post(f"/api/weekly-reports/issues/{issue['id']}/withdraw", json={"reason": "x"}, headers=former_h).status_code == 403
    outsider2 = _make_school_admin(db, _make_school(db, "wr1-y"), "wr1-y")
    db.commit()
    outsider_h = {**_login(client, outsider2.email), "x-auth-role": "ADMIN"}
    assert client.get(f"/api/weekly-reports/reports/{a_report}", headers=outsider_h).status_code == 404
    assert client.get(f"/api/weekly-reports/issues/{issue['id']}/pdf", headers=outsider_h).status_code == 404
    teacher = {**_login(client, w["teacher"].user.email), "x-auth-role": "TEACHER"}

    # The student sees only their own issued page.
    a_h = {**_login(client, a.user.email), "x-auth-role": "STUDENT"}
    mine = client.get("/api/weekly-reports/mine", headers=a_h).json()["reports"]
    assert [m["id"] for m in mine] == [a_report]
    assert client.get(f"/api/weekly-reports/mine/{a_report}", headers=a_h).status_code == 200
    assert client.get(f"/api/weekly-reports/mine/{a_report}/pdf", headers=a_h).content[:4] == b"%PDF"
    b_h = {**_login(client, b.user.email), "x-auth-role": "STUDENT"}
    assert client.get(f"/api/weekly-reports/mine/{a_report}", headers=b_h).status_code == 404
    other = {**_login(client, w["other_teacher"].user.email), "x-auth-role": "TEACHER"}
    assert client.get(f"/api/weekly-reports/reports/{a_report}", headers=other).status_code == 404

    # Withdraw needs a reason; then the student no longer sees it, and it can be issued again.
    teacher = {**_login(client, w["teacher"].user.email), "x-auth-role": "TEACHER"}
    url = f"/api/weekly-reports/issues/{issue['id']}/withdraw"
    assert client.post(url, json={"reason": " "}, headers=teacher).status_code == 422
    done = client.post(url, json={"reason": "Wrong note."}, headers=teacher).json()
    assert done["status"] == "WITHDRAWN" and done["withdrawReason"] == "Wrong note."
    # A withdrawn week's pages can't be opened or downloaded any more.
    assert client.get(f"/api/weekly-reports/issues/{issue['id']}/pdf", headers=teacher).status_code == 404
    assert client.get(f"/api/weekly-reports/reports/{a_report}/pdf", headers=teacher).status_code == 404
    a_h = {**_login(client, a.user.email), "x-auth-role": "STUDENT"}
    assert client.get("/api/weekly-reports/mine", headers=a_h).json()["reports"] == []
    assert client.get(f"/api/weekly-reports/mine/{a_report}", headers=a_h).status_code == 404
    teacher = {**_login(client, w["teacher"].user.email), "x-auth-role": "TEACHER"}
    again = client.post("/api/weekly-reports/issues", json=params, headers=teacher)
    assert again.status_code == 200
    assert db.query(WeeklyReport).count() == 6
    # c's set now shows as Done Late (handed in after the due date).
    week = client.get("/api/weekly-reports/week", params=params, headers=teacher).json()
    assert {r["studentCode"]: r for r in week["students"]}[c.student_code]["totals"]["late"] == 1
    assert len(week["withdrawn"]) == 1


def test_pdf_uses_the_product_typefaces():
    """The fonts ship with the app (app/assets/fonts); if a file went
    missing the PDF would quietly fall back to Helvetica."""
    from app.services import weekly_report_pdf

    assert weekly_report_pdf.SERIF == "WR-Serif" and weekly_report_pdf.SANS == "WR-Sans"
    page = {
        "title": "Weekly Practice Report", "school": {"name": "Test School", "city": None},
        "student": {"id": "s", "name": "A B", "code": "C1", "classLevel": "Class 5", "section": "A"},
        "week": {"start": "2026-10-19", "end": "2026-10-25", "label": "19 to 25 Oct 2026"},
        "sets": [], "totals": {"given": 0, "done": 0, "onTime": 0, "late": 0, "notDone": 0, "open": 0},
        "weekNumbers": {"answered": 0, "marked": 0, "percent": None, "ownPractice": 0},
        "skills": {"strong": [], "workOn": []}, "notes": {"section": None, "child": None},
    }
    pdf = weekly_report_pdf.render([page, page])
    assert pdf[:4] == b"%PDF" and pdf.count(b"/Type /Page\n") + pdf.count(b"/Type /Page ") >= 2
