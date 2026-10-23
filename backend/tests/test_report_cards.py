"""Report cards the school issues (#188, 23 Oct 2026).

PHASE4_REPORT_CARD_DESIGN.md, Shailesh's four decisions: a marks card with
attendance, co-scholastic grades and a remark, as a PDF; the school Admin
issues a section's cards and they keep the figures printed; nothing is
issued while a result is Provisional; a set given and never done counts 0
once it closes.

Proves:
- a term's own result (Term 1 components only, weights in proportion);
- the never-done rule: 0 once the set is closed or past due, missing while
  it is open;
- what teachers record (attendance, grades, remark) and its checks;
- issuing: refused with every missing mark listed; then issued, kept as
  printed when marks change, refused a second time, withdrawn with a
  reason, and issued again;
- the PDFs; the Year-End card's two terms;
- who may do what: Admin, Super Admin, teacher (current and past), student
  (only their own, only while issued), another school.
"""
from datetime import date, timedelta

from app.models import AuditLog, TeacherSectionAssignment
from app.services import assessment_service as service
from app.services import report_card_service as cards
from tests import test_assessment_scheme as tas
from tests.test_assessment_scheme import _component, _enter, _Person, _published, _submit
from tests.test_learning import _make_school_admin, _make_super_admin
from tests.test_practice_tracker import _assign

# Distinct chapter numbers, clear of the other test files (1-33, 61-74, 81-96).
tas._CH.update({f"RC{n}": 100 + n for n in range(1, 11)})


def _termed(name, max_marks, weight, term, **kw):
    c = _component(name, max_marks, weight, **kw)
    c.term = term
    return c


def _world(db, suffix):
    w = tas._world(db, suffix)
    w["admin"] = _make_school_admin(db, w["school"], suffix.lower())
    from app.models import ClassLevel

    w["level"] = db.query(ClassLevel).filter(ClassLevel.code == "5").one()
    return w


def _other_course(db, w):
    """A second Class 5 subject on the same board, for a draft scheme."""
    from app.models import BoardCourse

    first = db.get(BoardCourse, w["course_id"])
    other = BoardCourse(
        board_id=first.board_id, class_level_id=first.class_level_id, code=f"{first.code}-SCI",
        display_name="Science", status="PUBLISHED",
    )
    db.add(other)
    db.commit()
    return other.id


def _two_term_scheme(db, w):
    return _published(
        db, w,
        [_termed("Half-Yearly", "80", "50", "TERM_1"), _termed("Annual", "80", "50", "TERM_2")],
    )


def test_a_terms_own_result_counts_that_terms_components_only(db_session):
    w = _world(db_session, "RC1")
    a1 = w["students"]["A1"]
    scheme = _published(
        db_session, w,
        [
            _termed("PT 1", "20", "10", "TERM_1"),
            _termed("Half-Yearly", "80", "40", "TERM_1"),
            _termed("Annual", "80", "50", "TERM_2"),
        ],
    )
    _enter(db_session, scheme, "PT 1", {a1: "10"})          # 50%
    _enter(db_session, scheme, "Half-Yearly", {a1: "60"})   # 75%
    (term1,) = service.results(db_session, scheme, [a1.id], term="TERM_1")
    # (50 x 10 + 75 x 40) / 50 = 70
    assert (term1.shown, term1.provisional, len(term1.components)) == (70, False, 2)
    (year,) = service.results(db_session, scheme, [a1.id])
    assert year.provisional is True  # the Annual is still to come


def test_a_set_never_done_counts_zero_once_it_closes(db_session):
    w = _world(db_session, "RC2")
    a1, a2 = w["students"]["A1"], w["students"]["A2"]
    assignment = _assign(db_session, w["school"], w["activity"], w["teacher"].user_id, section="A")
    _submit(db_session, w, a1, assignment, q1="A", q2="5")  # 4 of 4
    scheme = _published(
        db_session, w, [_component("Practice", "10", "100", source="PLATFORM", activity_ids=[w["activity"].id])]
    )
    # Open, no due date: A2 is still missing, so Provisional.
    (r,) = service.results(db_session, scheme, [a2.id])
    assert (r.components[0].status, r.provisional) == ("MISSING", True)
    # Past its due date (India): 0 out of the set's 4 marks.
    assignment.due_date = (date.today() - timedelta(days=2)).isoformat()
    db_session.commit()
    (r,) = service.results(db_session, scheme, [a2.id])
    assert (r.components[0].status, r.components[0].percent, r.shown, r.provisional) == ("MARKS", 0, 0, False)
    # Due later: open again. Closed by the teacher: 0 again.
    assignment.due_date = (date.today() + timedelta(days=3)).isoformat()
    db_session.commit()
    assert service.results(db_session, scheme, [a2.id])[0].components[0].status == "MISSING"
    assignment.status = "CLOSED"
    db_session.commit()
    assert service.results(db_session, scheme, [a2.id])[0].shown == 0
    # The student who did it keeps their marks.
    assert service.results(db_session, scheme, [a1.id])[0].shown == 100
    # Given again with a new date: open again, so not 0 (review).
    _assign(db_session, w["school"], w["activity"], w["teacher"].user_id, section="A")
    assert service.results(db_session, scheme, [a2.id])[0].components[0].status == "MISSING"


def _records_body(w, term, entries):
    return {"yearId": w["year"].id, "classLevelId": w["level"].id, "section": "A", "term": term, "entries": entries}


def test_issuing_a_sections_cards_end_to_end(client, db_session):
    w = _world(db_session, "RC3")
    a1, a2, b1 = w["students"]["A1"], w["students"]["A2"], w["students"]["B1"]
    scheme = _two_term_scheme(db_session, w)
    admin = _Person(w["admin"].email)
    scope = {"yearId": w["year"].id, "classLevelId": w["level"].id, "section": "A"}

    overview = admin.get("/api/report-cards/overview", params={"yearId": w["year"].id}).json()
    assert [(s["classLevel"]["displayName"], s["section"]) for s in overview["sections"]] == [("Class 5", "A"), ("Class 5", "B")]
    assert overview["settings"]["areas"] == cards.DEFAULT_AREAS and overview["settings"]["saved"] is False

    # Records: checked all at once, then saved.
    bad = admin.put("/api/report-cards/records", json=_records_body(w, "TERM_1", [
        {"studentId": a1.id, "workingDays": 100, "daysPresent": 101},
        {"studentId": a2.id, "grades": {"Art Education": "Z"}},
        {"studentId": b1.id, "workingDays": 100},
    ]))
    assert bad.status_code == 422
    assert bad.json()["detail"]["details"]["problems"] == [
        "Days present can't be more than the working days.",
        "\"Z\" is not on the school's grade scale.",
        "One of these students is not in a section you can record for.",
    ]
    grades = {area: "A" for area in cards.DEFAULT_AREAS}
    ok = admin.put("/api/report-cards/records", json=_records_body(w, "TERM_1", [
        {"studentId": a1.id, "workingDays": 100, "daysPresent": 96, "grades": grades, "remark": "Works steadily."},
        {"studentId": a2.id, "workingDays": 100, "daysPresent": 90, "grades": grades},
    ]))
    assert ok.status_code == 200 and ok.json() == {"saved": 2}
    again = admin.put("/api/report-cards/records", json=_records_body(w, "TERM_1", [
        {"studentId": a1.id, "workingDays": 100, "daysPresent": 96, "grades": grades, "remark": "Works steadily."},
    ]))
    assert again.json() == {"saved": 0}
    rows = admin.get("/api/report-cards/records", params={**scope, "term": "TERM_1"}).json()["rows"]
    assert [(r["studentCode"], r["daysPresent"], r["remark"]) for r in rows] == [
        (a1.student_code, 96, "Works steadily."), (a2.student_code, 90, None),
    ]

    # Not ready: every missing mark is listed, and issuing is refused.
    ready = admin.get("/api/report-cards/readiness", params={**scope, "cardTerm": "TERM_1"}).json()
    assert ready["students"] == 2 and ready["subjects"] == [scheme.board_course.display_name]
    assert len(ready["problems"]) == 2 and "Half-Yearly: no marks entered." in ready["problems"][0]
    assert ready["warnings"] == [f"1 student has no remark: Student {w['suffix'].lower()}-a2."]
    refused = admin.post("/api/report-cards/issues", json={**scope, "cardTerm": "TERM_1"})
    assert refused.status_code == 422 and len(refused.json()["detail"]["details"]["problems"]) == 2

    _enter(db_session, scheme, "Half-Yearly", {a1: "72", a2: "ABSENT"})
    issued = admin.post("/api/report-cards/issues", json={**scope, "cardTerm": "TERM_1"})
    assert issued.status_code == 200, issued.text
    issue = issued.json()
    assert (issue["status"], issue["cardCount"], issue["cardTerm"]) == ("ISSUED", 2, "TERM_1")
    twice = admin.post("/api/report-cards/issues", json={**scope, "cardTerm": "TERM_1"})
    assert twice.status_code == 422 and "already issued" in twice.json()["detail"]["message"]

    detail = admin.get(f"/api/report-cards/issues/{issue['id']}").json()
    first = detail["cards"][0]
    assert first["studentCode"] == a1.student_code and first["subjects"][0]["result"] == "90"
    card = admin.get(f"/api/report-cards/cards/{first['id']}").json()["card"]
    assert card["attendance"]["TERM_1"] == {"workingDays": 100, "daysPresent": 96}
    assert card["remark"] == "Works steadily." and card["subjects"][0]["grade"] == "A2"
    absent = admin.get(f"/api/report-cards/cards/{detail['cards'][1]['id']}").json()["card"]
    assert absent["subjects"][0]["components"][0]["status"] == "ABSENT" and absent["subjects"][0]["result"] == "0"

    # The printed figures stay as issued when marks change.
    _enter(db_session, scheme, "Half-Yearly", {a1: "40"}, reason="Re-checked")
    assert admin.get(f"/api/report-cards/cards/{first['id']}").json()["card"]["subjects"][0]["result"] == "90"

    pdf = admin.get(f"/api/report-cards/issues/{issue['id']}/pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf" and pdf.content.startswith(b"%PDF")
    assert "attachment" in pdf.headers["content-disposition"]
    one = admin.get(f"/api/report-cards/cards/{first['id']}/pdf")
    assert one.status_code == 200 and one.content.startswith(b"%PDF")

    # The student sees their own card, only while it is issued.
    student = _Person(a1.user.email)
    mine = student.get("/api/report-cards/mine").json()["cards"]
    assert [c["title"] for c in mine] == ["Term 1 Report Card"]
    assert student.get(f"/api/report-cards/mine/{mine[0]['id']}/pdf").content.startswith(b"%PDF")
    other = detail["cards"][1]["id"]
    assert student.get(f"/api/report-cards/mine/{other}").status_code == 404
    assert student.get(f"/api/report-cards/cards/{first['id']}").status_code == 403

    # Withdrawn needs a reason; then the student sees nothing; issued again.
    no_reason = admin.post(f"/api/report-cards/issues/{issue['id']}/withdraw", json={"reason": " "})
    assert no_reason.status_code == 422
    withdrawn = admin.post(f"/api/report-cards/issues/{issue['id']}/withdraw", json={"reason": "Half-yearly re-checked"})
    assert withdrawn.status_code == 200 and withdrawn.json()["status"] == "WITHDRAWN"
    assert student.get("/api/report-cards/mine").json() == {"cards": []}
    reissued = admin.post("/api/report-cards/issues", json={**scope, "cardTerm": "TERM_1"})
    assert reissued.status_code == 200
    new_first = admin.get(f"/api/report-cards/issues/{reissued.json()['id']}").json()["cards"][0]
    assert new_first["subjects"][0]["result"] == "50"
    history = admin.get("/api/report-cards/issues", params=scope).json()["issues"]
    assert [i["status"] for i in history] == ["ISSUED", "WITHDRAWN"]

    events = {e.event_type for e in db_session.query(AuditLog).all()}
    assert {"report.records.saved", "report.cards.issued", "report.cards.withdrawn"} <= events


def test_the_year_end_card_shows_both_terms(client, db_session):
    w = _world(db_session, "RC4")
    a1, a2 = w["students"]["A1"], w["students"]["A2"]
    scheme = _two_term_scheme(db_session, w)
    _enter(db_session, scheme, "Half-Yearly", {a1: "60", a2: "40"})
    _enter(db_session, scheme, "Annual", {a1: "80", a2: "EXEMPT"})
    built = cards.build_cards(
        db_session, school=w["school"], year=w["year"], class_level=w["level"], section="A", card_term="YEAR_END"
    )
    assert built.problems == []
    subject = built.cards[0]["subjects"][0]
    # Term 1 75, Term 2 100, the year (75 x 50 + 100 x 50) / 100 = 87.5 -> 88.
    assert subject["terms"] == {"TERM_1": {"result": "75", "grade": "B1"}, "TERM_2": {"result": "100", "grade": "A1"}}
    assert subject["result"] == "88" and subject["unrounded"] == "87.5"
    exempt = built.cards[1]["subjects"][0]
    assert exempt["terms"]["TERM_2"]["result"] is None and exempt["result"] == "50"
    assert set(built.cards[0]["attendance"]) == {"TERM_1", "TERM_2"}

    # A grade left from before the scale changed is not printed, and a
    # subject still only in draft is named in the warnings (review).
    from app.models import StudentTermRecord

    db_session.add(StudentTermRecord(
        school_id=w["school"].id, academic_year_id=w["year"].id, student_id=a1.id, term="TERM_1",
        grades_json='{"Art Education": "Z", "Discipline": "A"}',
    ))
    tas._scheme(db_session, {**w, "course_id": _other_course(db_session, w)}, [_component("Annual", "80", "100")], name="Science")
    built = cards.build_cards(
        db_session, school=w["school"], year=w["year"], class_level=w["level"], section="A", card_term="YEAR_END"
    )
    assert built.cards[0]["coScholastic"]["grades"]["TERM_1"] == {"Discipline": "A"}
    assert any("has no published scheme yet" in warning for warning in built.warnings)
    from app.services import report_card_pdf

    assert report_card_pdf.render([{**c, "issuedAt": "2027-03-31T10:00:00+00:00"} for c in built.cards]).startswith(b"%PDF")


def test_settings_and_who_may_do_what(client, db_session):
    w = _world(db_session, "RC5")
    a1, b1 = w["students"]["A1"], w["students"]["B1"]
    _two_term_scheme(db_session, w)
    admin = _Person(w["admin"].email)
    teacher = _Person(w["teacher"].user.email)
    scope = {"yearId": w["year"].id, "classLevelId": w["level"].id}

    bad = admin.put("/api/report-cards/settings", json={"yearId": w["year"].id, "areas": ["Art", "art"], "scale": [{"label": "A"}]})
    assert bad.status_code == 422
    assert bad.json()["detail"]["details"]["problems"] == [
        "Two areas have the same name.", "The grade scale needs at least two grades.",
    ]
    saved = admin.put("/api/report-cards/settings", json={
        "yearId": w["year"].id, "areas": ["Art", "Sports"], "scale": [{"label": "1", "meaning": "Very good"}, {"label": "2"}],
    })
    assert saved.status_code == 200 and saved.json()["areas"] == ["Art", "Sports"] and saved.json()["saved"] is True
    assert teacher.put("/api/report-cards/settings", json={"yearId": w["year"].id, "areas": ["X"], "scale": []}).status_code == 403

    # The teacher of A records for A only, and cannot issue.
    view = teacher.get("/api/report-cards/overview", params={"yearId": w["year"].id}).json()
    assert [s["section"] for s in view["sections"]] == ["A"] and view["canManage"] is False
    ok = teacher.put("/api/report-cards/records", json=_records_body(w, "TERM_2", [
        {"studentId": a1.id, "grades": {"Art": "1"}, "remark": "Good year."},
    ]))
    assert ok.status_code == 200
    body_b = {**_records_body(w, "TERM_1", [{"studentId": b1.id, "workingDays": 10}]), "section": "B"}
    assert teacher.put("/api/report-cards/records", json=body_b).status_code == 404
    assert teacher.post("/api/report-cards/issues", json={**scope, "section": "A", "cardTerm": "TERM_1"}).status_code == 403
    assert teacher.get("/api/report-cards/readiness", params={**scope, "section": "A", "cardTerm": "TERM_1"}).status_code == 200

    # A teacher who has moved on reads but cannot record.
    window = db_session.query(TeacherSectionAssignment).filter_by(teacher_id=w["teacher"].id).one()
    window.end_date = date.today()
    db_session.commit()
    assert teacher.get("/api/report-cards/records", params={**scope, "section": "A", "term": "TERM_2"}).json()["canRecord"] is False
    assert teacher.put("/api/report-cards/records", json=_records_body(w, "TERM_2", [{"studentId": a1.id}])).status_code == 403

    # Another school's admin sees none of it; a Super Admin names the school.
    other = _world(db_session, "RC6")
    outsider = _Person(other["admin"].email)
    assert outsider.get("/api/report-cards/overview", params={"yearId": w["year"].id}).status_code == 404
    super_admin = _make_super_admin(db_session, "rc5")
    platform = _Person(super_admin.email)
    assert platform.get("/api/report-cards/overview", params={"yearId": w["year"].id}).status_code == 422
    seen = platform.get("/api/report-cards/overview", params={"yearId": w["year"].id, "schoolId": w["school"].id})
    assert seen.status_code == 200 and seen.json()["settings"]["areas"] == ["Art", "Sports"]
