"""Mock papers (#166 step 3, 27 Oct 2026).

Rules under test: a section's teacher builds a paper from any format (a
starting point, a saved one, or one made on the spot) and approves it; on
approval every active student in the section gets their own version, all
at once; a student never gets a question they have had; versions differ
wherever the pattern allows; the admin looks but doesn't change; another
teacher, another school and the Super Admin see nothing; an approved paper
is frozen and can be withdrawn only before it opens.
"""
import json
from datetime import UTC, datetime, timedelta

import pytest

from app.models import BoardCourse, Question
from app.models.papers import GeneratedQuestion, MockPaper, MockPaperVersion, MockPaperVersionItem, QuestionPattern
from app.services import mock_paper_service, paper_formats, pattern_store
from app.services.paper_formats import FormatError
from app.services.practice_access_service import resolve_viewer
from tests.test_learning import (
    _assign_teacher_section,
    _login,
    _make_chapter_with_skills,
    _make_school,
    _make_school_admin,
    _make_sectioned_student,
    _make_super_admin,
    _make_teacher,
)
from tests.test_pattern_engine import CONTENT

NOW = datetime.now(UTC)
LATER = (NOW + timedelta(days=2)).isoformat()
MUCH_LATER = (NOW + timedelta(days=9)).isoformat()


def _chapter_one(db, sx):
    """A chapter with 15 skills and Chapter 1's 59 patterns, all approved."""
    chapter, skills = _make_chapter_with_skills(db, sx, n_skills=15)
    raw = json.loads((CONTENT / "chapter-01.json").read_text(encoding="utf-8"))["patterns"]
    engine = {"board": "CBSE", "classLevel": "5", "course": f"MATH-{sx}"}
    entries = [("t.json", engine, {**p, "code": f"{sx}-{p['code']}", "skill": f"S{sx}-{p['skill'][-2:]}"}) for p in raw]
    pattern_store.apply_plan(db, pattern_store.make_plan(db, entries, trial_count=20, min_distinct=2))
    db.query(QuestionPattern).filter(QuestionPattern.board_course_id == chapter.board_course_id).update({"status": "APPROVED"})
    db.commit()
    return chapter, skills


def _world(db, sx, students=3, patterns=True):
    if patterns:
        chapter, skills = _chapter_one(db, sx)
    else:
        chapter, skills = _make_chapter_with_skills(db, sx, n_skills=2)
    school = _make_school(db, sx.lower())
    teacher = _make_teacher(db, school, sx.lower())
    _assign_teacher_section(db, teacher, chapter.board_course_id, "A")
    other = _make_teacher(db, school, f"{sx.lower()}-b")
    _assign_teacher_section(db, other, chapter.board_course_id, "B")
    kids = [_make_sectioned_student(db, school, f"{sx.lower()}-{i}", class_name="5", section="A") for i in range(students)]
    _make_sectioned_student(db, school, f"{sx.lower()}-gone", class_name="5", section="A", is_active=False)
    _make_sectioned_student(db, school, f"{sx.lower()}-b0", class_name="5", section="B")
    db.commit()
    level_id = db.get(BoardCourse, chapter.board_course_id).class_level_id
    scope = f"{level_id}|A|{chapter.board_course_id}"
    return {"chapter": chapter, "skills": skills, "school": school, "teacher": teacher, "other": other,
            "students": kids, "scope": scope}


def _as(client, user, role):
    return {**_login(client, user.email), "x-auth-role": role}


def _new(client, headers, w, **extra):
    body = {"scope": w["scope"], "title": "Chapter 1 Practice Paper", "formatId": "builtin-full",
            "chapterIds": [w["chapter"].id], "opensAt": LATER, "closesAt": MUCH_LATER, **extra}
    response = client.post("/api/mock-papers", json=body, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["id"]


def test_formats_are_checked_in_words():
    assert paper_formats.clean_format(paper_formats.STARTING_POINTS[0])["totalMarks"] == 60
    assert paper_formats.clean_format(paper_formats.STARTING_POINTS[1])["totalMarks"] == 40
    assert paper_formats.clean_format(paper_formats.STARTING_POINTS[2])["totalMarks"] == 20
    with pytest.raises(FormatError) as bad:
        paper_formats.clean_format({
            "name": "", "timeMinutes": 2,
            "sections": [{"marks": 4, "count": 2, "kind": "ANY"}, {"marks": 3, "count": 2, "choices": 3, "kind": "CHOICE"},
                         {"marks": 5, "count": 50}],
            "difficulty": {"easy": 50, "medium": 50, "hard": 10},
        })
    text = " | ".join(bad.value.problems)
    for words in ("Give the test format a name", "4-mark questions are case studies", "can't be more than the questions",
                  "multiple-choice questions are worth 1 or 2 marks", "keep it to 200", "from 5 minutes", "add up to 100%"):
        assert words in text, words


def test_a_teacher_builds_previews_and_approves_a_full_paper(client, db_session):
    db = db_session
    w = _world(db, "MKP1")
    teacher = _as(client, w["teacher"].user, "TEACHER")

    sections = client.get("/api/mock-papers/sections", headers=teacher).json()["sections"]
    assert [s["key"] for s in sections if s["canChange"]] == [w["scope"]]
    chapters = client.get("/api/mock-papers/chapters", params={"scope": w["scope"]}, headers=teacher).json()["chapters"]
    assert chapters[0]["approvedPatterns"] == 59
    full = paper_formats.STARTING_POINTS[0]
    supply = client.post("/api/mock-papers/supply", json={"scope": w["scope"], "format": full, "chapterIds": [w["chapter"].id]},
                         headers=teacher).json()
    assert supply["totalMarks"] == 60 and all(s["enough"] for s in supply["sections"])

    paper_id = _new(client, teacher, w)
    detail = client.get(f"/api/mock-papers/{paper_id}", headers=teacher).json()
    assert detail["status"] == "DRAFT" and detail["canChange"] and detail["totalMarks"] == 60
    assert [len(s["slots"]) for s in detail["sections"]] == [15, 8, 6, 3, 1]
    assert detail["checks"]["marks"] == 60 and detail["checks"]["canApprove"]
    slots = [slot for s in detail["sections"] for slot in s["slots"]]
    assert all(slot["sample"] and slot["pattern"] for slot in slots)
    case = detail["sections"][4]["slots"][0]
    assert case["sample"]["stimulus"] and len(case["sample"]["questions"]) == 4
    # An either/or pair: same marks, a different skill.
    pair = [slot for slot in detail["sections"][2]["slots"] if slot["choiceGroup"]]
    assert len(pair) == 2 and pair[1]["alternative"] and pair[0]["pattern"]["skill"] != pair[1]["pattern"]["skill"]
    # No pattern fills more than two places.
    codes = [slot["pattern"]["code"] for slot in slots]
    assert max(codes.count(c) for c in codes) <= 2
    # Nothing is stored for students while it's a draft.
    assert db.query(GeneratedQuestion).filter_by(school_id=w["school"].id).count() == 0

    # New numbers for one place; another question for another.
    first = detail["sections"][0]["slots"][0]
    again = client.post(f"/api/mock-papers/{paper_id}/slots/{first['slotId']}/regenerate", json={"mode": "numbers"}, headers=teacher).json()
    same = again["sections"][0]["slots"][0]
    assert same["pattern"]["code"] == first["pattern"]["code"] and same["sample"] != first["sample"]
    swapped = client.post(f"/api/mock-papers/{paper_id}/slots/{first['slotId']}/regenerate", json={"mode": "question"}, headers=teacher).json()
    assert swapped["sections"][0]["slots"][0]["pattern"]["code"] != first["pattern"]["code"]

    renamed = client.patch(f"/api/mock-papers/{paper_id}", json={"title": "  Practice   Paper 1 "}, headers=teacher).json()
    assert renamed["title"] == "Practice Paper 1"
    assert client.patch(f"/api/mock-papers/{paper_id}", json={"closesAt": LATER}, headers=teacher).status_code == 422

    # The admin looks; doesn't change. The other teacher and the Super Admin see nothing.
    admin_user = _make_school_admin(db, w["school"], "mkp1")
    admin = _as(client, admin_user, "ADMIN")
    looked = client.get(f"/api/mock-papers/{paper_id}", headers=admin).json()
    assert looked["canChange"] is False and [p["id"] for p in client.get("/api/mock-papers", headers=admin).json()["papers"]] == [paper_id]
    assert client.post(f"/api/mock-papers/{paper_id}/approve", headers=admin).status_code == 403
    other = _as(client, w["other"].user, "TEACHER")
    assert client.get(f"/api/mock-papers/{paper_id}", headers=other).status_code == 404
    assert client.get("/api/mock-papers", headers=other).json()["papers"] == []
    sa = _as(client, _make_super_admin(db, "mkp1"), "SUPER_ADMIN")
    assert client.get("/api/mock-papers", headers=sa).status_code == 403
    admin_viewer = resolve_viewer(db, admin_user)
    with pytest.raises(Exception) as refused:
        mock_paper_service.approve(db, admin_viewer, paper_id)
    assert refused.value.status_code == 403
    db.rollback()
    teacher = _as(client, w["teacher"].user, "TEACHER")  # one signed-in user per client at a time

    approved = client.post(f"/api/mock-papers/{paper_id}/approve", headers=teacher)
    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert body["status"] == "SCHEDULED" and body["versions"] == 3 and body["canChange"]

    # Every active student in Section A, and only them, has their own version.
    versions = db.query(MockPaperVersion).filter_by(paper_id=paper_id).all()
    assert sorted(v.student_id for v in versions) == sorted(s.id for s in w["students"])
    expected_items = sum(len(s["sample"]["questions"]) for s in [slot for sec in body["sections"] for slot in sec["slots"]])
    papers = []
    for v in versions:
        items = db.query(MockPaperVersionItem).filter_by(version_id=v.id).all()
        assert len(items) == expected_items
        records = db.query(GeneratedQuestion).filter(GeneratedQuestion.question_id.in_([i.question_id for i in items])).all()
        assert {r.student_id for r in records} == {v.student_id}
        prints = [r.fingerprint for r in records]
        assert len(prints) == len(set(prints)), "a student got the same question twice on one paper"
        papers.append(set(prints))
    # Versions differ: no two students share more than a handful of questions.
    assert all(len(papers[i] & papers[j]) <= 5 for i in range(3) for j in range(i + 1, 3))
    assert all(q.origin == "GENERATED" for q in db.query(Question).filter(Question.id.in_(
        [i.question_id for v in versions for i in db.query(MockPaperVersionItem).filter_by(version_id=v.id)])))

    # Frozen now.
    assert client.post(f"/api/mock-papers/{paper_id}/slots/{first['slotId']}/regenerate", json={"mode": "numbers"},
                       headers=teacher).status_code == 409
    assert client.patch(f"/api/mock-papers/{paper_id}", json={"title": "X"}, headers=teacher).status_code == 409
    assert client.delete(f"/api/mock-papers/{paper_id}", headers=teacher).status_code == 409
    assert client.post(f"/api/mock-papers/{paper_id}/approve", headers=teacher).status_code == 409

    # Withdrawn before it opens, with a reason.
    assert client.post(f"/api/mock-papers/{paper_id}/withdraw", json={"reason": " "}, headers=teacher).status_code == 422
    # Review: an edited pattern changes nothing on the approved paper.
    shown = [slot["sample"] for sec in body["sections"] for slot in sec["slots"]]
    edited = db.query(QuestionPattern).filter_by(id=body["sections"][0]["slots"][0]["pattern"]["id"]).one()
    raw = json.loads(edited.spec_json)
    raw["text"] = "EDITED " + raw["text"]
    edited.spec_json, edited.version, edited.status = json.dumps(raw), edited.version + 1, "DRAFT"
    db.commit()
    still = client.get(f"/api/mock-papers/{paper_id}", headers=teacher).json()
    assert [slot["sample"] for sec in still["sections"] for slot in sec["slots"]] == shown
    assert not any(slot["problem"] for sec in still["sections"] for slot in sec["slots"])
    late = _make_sectioned_student(db, w["school"], "mkp1-late", class_name="5", section="A")
    paper_row = db.get(MockPaper, paper_id)
    version = mock_paper_service.ensure_version(db, paper_row, late)
    db.commit()
    late_ids = [i.question_id for i in db.query(MockPaperVersionItem).filter_by(version_id=version.id)]
    records = db.query(GeneratedQuestion).filter(GeneratedQuestion.question_id.in_(late_ids)).all()
    assert all(r.pattern_version == 1 for r in records)
    assert not any(q.stem.startswith("EDITED") for q in db.query(Question).filter(Question.id.in_(late_ids)))

    out = client.post(f"/api/mock-papers/{paper_id}/withdraw", json={"reason": "Wrong chapter"}, headers=teacher).json()
    assert out["status"] == "WITHDRAWN" and out["withdrawReason"] == "Wrong chapter"
    # Nobody saw it, so its questions no longer count as had.
    student_ids = [s.id for s in w["students"]] + [late.id]
    assert db.query(GeneratedQuestion).filter(GeneratedQuestion.student_id.in_(student_ids)).count() == 0


def test_a_student_never_meets_a_question_again(db_session):
    """Two papers from a tiny pattern: the second gives each student the
    numbers they haven't had; when none are left the teacher is told."""
    db = db_session
    w = _world(db, "MKP2", students=2, patterns=False)
    skill = w["skills"][0]
    engine = {"board": "CBSE", "classLevel": "5", "course": "MATH-MKP2"}
    tiny = {"code": "MKP2-TINY", "chapter": 1, "questionType": "Numeric Entry", "marks": 1, "skill": skill.code,
            "values": [{"name": "n", "int": {"min": 1, "max": 3}}], "text": "Write the number {n}.", "answer": "n"}
    pattern_store.apply_plan(db, pattern_store.make_plan(db, [("t.json", engine, tiny)], trial_count=30, min_distinct=3))
    db.query(QuestionPattern).filter_by(code="MKP2-TINY").update({"status": "APPROVED"})
    db.commit()
    viewer = resolve_viewer(db, w["teacher"].user)
    scope = mock_paper_service.analytics_service.parse_scope(w["scope"])
    one = {"name": "One Question", "sections": [{"name": "A", "marks": 1, "count": 1}], "timeMinutes": 5}

    def paper():
        made = mock_paper_service.create_draft(
            db, viewer, scope, title="Quick", raw_format=one, format_id=None, chapter_ids=[w["chapter"].id],
            opens_at=NOW + timedelta(days=1), closes_at=NOW + timedelta(days=2),
        )
        mock_paper_service.approve(db, viewer, made.id)
        db.commit()
        return made

    got = {s.id: [] for s in w["students"]}
    for _ in range(3):
        made = paper()
        for v in db.query(MockPaperVersion).filter_by(paper_id=made.id):
            item = db.query(MockPaperVersionItem).filter_by(version_id=v.id).one()
            got[v.student_id].append(db.get(Question, item.question_id).stem)
        if len(got[w["students"][0].id]) == 1:
            # The two students get different numbers on the same paper.
            assert got[w["students"][0].id] != got[w["students"][1].id]
    for stems in got.values():
        assert sorted(stems) == ["Write the number 1.", "Write the number 2.", "Write the number 3."]
    made = mock_paper_service.create_draft(
        db, viewer, scope, title="Fourth", raw_format=one, format_id=None, chapter_ids=[w["chapter"].id],
        opens_at=NOW + timedelta(days=1), closes_at=NOW + timedelta(days=2),
    )
    with pytest.raises(Exception) as used_up:
        mock_paper_service.approve(db, viewer, made.id)
    assert "no new copy left" in str(used_up.value.detail["message"])
    db.rollback()

    # A student who joins later gets their own version when they open it.
    first = db.query(MockPaper).filter_by(title="Quick").first()
    late = _make_sectioned_student(db, w["school"], "mkp2-late", class_name="5", section="A")
    version = mock_paper_service.ensure_version(db, first, late)
    db.commit()
    assert version.student_id == late.id and mock_paper_service.ensure_version(db, first, late).id == version.id


def test_shortages_block_approval_and_changed_patterns_are_caught(client, db_session):
    db = db_session
    w = _world(db, "MKP3", students=1)
    teacher = _as(client, w["teacher"].user, "TEACHER")
    big = {"name": "Long Answers", "sections": [{"name": "A", "marks": 5, "count": 5, "kind": "WRITTEN"}], "timeMinutes": 60,
           "difficulty": None, "applicationMin": None}
    supply = client.post("/api/mock-papers/supply", json={"scope": w["scope"], "format": big, "chapterIds": [w["chapter"].id]},
                         headers=teacher).json()
    assert supply["sections"][0] == {"section": 0, "name": "A", "places": 5, "filled": 5, "patterns": 3, "enough": True}
    seven = {**big, "sections": [{"name": "A", "marks": 5, "count": 7, "kind": "WRITTEN"}]}
    supply = client.post("/api/mock-papers/supply", json={"scope": w["scope"], "format": seven, "chapterIds": [w["chapter"].id]},
                         headers=teacher).json()
    assert supply["sections"][0]["enough"] is False
    bad = client.post("/api/mock-papers/supply", json={"scope": w["scope"], "format": {**big, "timeMinutes": 1}, "chapterIds": []},
                      headers=teacher).json()
    assert bad["problems"] and bad["sections"] == []

    paper_id = _new(client, teacher, w, formatId=None, format=seven)
    detail = client.get(f"/api/mock-papers/{paper_id}", headers=teacher).json()
    assert detail["checks"]["canApprove"] is False
    assert sum(1 for s in detail["sections"][0]["slots"] if s["problem"]) == 1
    assert client.post(f"/api/mock-papers/{paper_id}/approve", headers=teacher).status_code == 409
    assert client.delete(f"/api/mock-papers/{paper_id}", headers=teacher).json() == {"ok": True}

    # A pattern changed after the paper was drafted: the place says so.
    paper_id = _new(client, teacher, w)
    detail = client.get(f"/api/mock-papers/{paper_id}", headers=teacher).json()
    slot = detail["sections"][0]["slots"][0]
    pattern = db.query(QuestionPattern).filter_by(code=slot["pattern"]["code"]).one()
    pattern.version += 1
    db.commit()
    detail = client.get(f"/api/mock-papers/{paper_id}", headers=teacher).json()
    stale = [s for s in detail["sections"][0]["slots"] if s["problem"]]
    assert stale and "changed" in stale[0]["problem"] and detail["checks"]["canApprove"] is False
    assert client.post(f"/api/mock-papers/{paper_id}/approve", headers=teacher).status_code == 409
    for s in stale:
        client.post(f"/api/mock-papers/{paper_id}/slots/{s['slotId']}/regenerate", json={"mode": "numbers"}, headers=teacher)
    assert client.post(f"/api/mock-papers/{paper_id}/approve", headers=teacher).status_code == 200


def test_saved_formats_belong_to_the_teacher_or_the_school(client, db_session):
    """One signed-in user per client at a time, so each step signs in."""
    db = db_session
    w = _world(db, "MKP4", students=1, patterns=False)
    admin_user = _make_school_admin(db, w["school"], "mkp4")
    teacher = lambda: _as(client, w["teacher"].user, "TEACHER")
    other = lambda: _as(client, w["other"].user, "TEACHER")
    admin = lambda: _as(client, admin_user, "ADMIN")
    weekly = {"name": "Monday Test", "sections": [{"name": "A", "marks": 1, "count": 10, "kind": "CHOICE"}], "timeMinutes": 20}

    mine = client.post("/api/mock-papers/formats", json={"format": weekly}, headers=teacher()).json()["id"]
    h = admin()  # an admin signs in once a test (the 2FA code can't be replayed)
    school = client.post("/api/mock-papers/formats", json={"format": {**weekly, "name": "Weekly"}}, headers=h).json()["id"]
    assert client.put(f"/api/mock-papers/formats/{school}", json={"format": {**weekly, "name": "School Weekly"}}, headers=h).status_code == 200
    listed = {f["name"]: f for f in client.get("/api/mock-papers/formats", headers=teacher()).json()["formats"]}
    assert listed["Monday Test"]["owner"] == "MINE" and listed["Monday Test"]["canEdit"]
    assert listed["School Weekly"]["owner"] == "SCHOOL" and not listed["School Weekly"]["canEdit"]
    assert listed["Full Paper (60 Marks)"]["owner"] == "STARTING_POINT"
    h = teacher()
    assert client.put(f"/api/mock-papers/formats/{school}", json={"format": weekly}, headers=h).status_code == 403
    refused = client.post("/api/mock-papers/formats", json={"format": {**weekly, "timeMinutes": 500}}, headers=h)
    assert refused.status_code == 422 and refused.json()["detail"]["details"]["problems"]
    h = other()
    assert "Monday Test" not in {f["name"] for f in client.get("/api/mock-papers/formats", headers=h).json()["formats"]}
    assert client.put(f"/api/mock-papers/formats/{mine}", json={"format": weekly}, headers=h).status_code == 404
    assert client.delete(f"/api/mock-papers/formats/{mine}", headers=teacher()).status_code == 200


def test_sections_share_patterns_and_either_or_is_two_questions(db_session):
    """Review: the supply check chooses the whole paper, so two sections
    drawing on the same patterns aren't both told there's enough; an
    either/or pair is two different questions; and a paper can't be
    approved once its opening time has passed."""
    db = db_session
    w = _world(db, "MKP5", students=1, patterns=False)
    skill = w["skills"][0]
    engine = {"board": "CBSE", "classLevel": "5", "course": "MATH-MKP5"}
    specs = [{"code": f"MKP5-N{i}", "chapter": 1, "questionType": "Numeric Entry", "marks": 1, "skill": skill.code,
              "values": [{"name": "n", "int": {"min": 1, "max": 40}}], "text": f"Pattern {i}: write {{n}}.", "answer": "n"}
             for i in range(3)]
    pattern_store.apply_plan(db, pattern_store.make_plan(db, [("t.json", engine, sp) for sp in specs], trial_count=20, min_distinct=2))
    db.query(QuestionPattern).filter(QuestionPattern.code.like("MKP5-%")).update({"status": "APPROVED"}, synchronize_session=False)
    db.commit()
    patterns = mock_paper_service.approved_patterns(db, w["chapter"].board_course_id, [w["chapter"].id])
    two = paper_formats.clean_format({"name": "T", "timeMinutes": 30, "sections": [
        {"name": "A", "marks": 1, "count": 5, "kind": "ANY"}, {"name": "B", "marks": 1, "count": 5, "kind": "NUMBER"}]})
    lines = mock_paper_service.supply(patterns, two, [w["chapter"].id])
    assert [x["filled"] for x in lines] == [1, 5] and [x["enough"] for x in lines] == [False, True]

    pair = paper_formats.clean_format({"name": "P", "timeMinutes": 30, "sections": [
        {"name": "A", "marks": 1, "count": 2, "choices": 2, "kind": "ANY"}]})
    import random
    picks = mock_paper_service.plan(pair, patterns, [w["chapter"].id], random.Random(1))
    groups = {}
    for pk in picks:
        groups.setdefault(pk.choice_group, []).append(pk.pattern.id if pk.pattern else None)
    assert all(len(set(ids)) == 2 for ids in groups.values())

    viewer = resolve_viewer(db, w["teacher"].user)
    scope = mock_paper_service.analytics_service.parse_scope(w["scope"])
    one = {"name": "One", "sections": [{"name": "A", "marks": 1, "count": 1}], "timeMinutes": 5}
    made = mock_paper_service.create_draft(db, viewer, scope, title="Late", raw_format=one, format_id=None,
                                           chapter_ids=[w["chapter"].id], opens_at=NOW + timedelta(hours=1),
                                           closes_at=NOW + timedelta(days=1))
    with pytest.raises(Exception) as late:
        mock_paper_service.approve(db, viewer, made.id, now=NOW + timedelta(hours=2))
    assert "opening time has passed" in late.value.detail["message"]
    db.rollback()
