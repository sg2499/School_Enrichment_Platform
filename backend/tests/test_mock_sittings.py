"""Sitting a mock paper online (#166 step 4, 27 Oct 2026).

Rules under test: a student of the section sits their own version once,
while the paper is open; the server keeps the time (reading time locks
answers, the paper is handed in when the time is up or it closes); no key,
hint or explanation reaches the student while sitting; in an either/or
pair only the chosen question counts; number and choice answers are marked
at once, written answers by the section's teacher; the student sees their
marks at hand-in and the right answers and solutions once the paper closes
(#208: no release step); a mark can be changed at any time; a one-way paper
can't go back a section.
"""
import json
from datetime import timedelta

import pytest
from fastapi import HTTPException

from app.models import Question
from app.models.papers import MockPaperAnswer, MockPaperSitting, MockPaperVersionItem
from app.services import mock_paper_service
from app.services import mock_sitting_service as sit
from app.services.practice_access_service import resolve_viewer
from tests.test_learning import _login, _make_sectioned_student
from tests.test_mock_papers import NOW, _world

T0 = NOW + timedelta(hours=1)  # the paper opens
T1 = T0 + timedelta(minutes=1)  # a student starts


def _paper(db, w, fmt, *, closes=timedelta(hours=3)):
    viewer = resolve_viewer(db, w["teacher"].user)
    scope = mock_paper_service.analytics_service.parse_scope(w["scope"])
    paper = mock_paper_service.create_draft(
        db, viewer, scope, title="Practice", raw_format=fmt, format_id=None, chapter_ids=[w["chapter"].id],
        opens_at=T0, closes_at=T0 + closes,
    )
    mock_paper_service.approve(db, viewer, paper.id, now=NOW)
    db.commit()
    return paper, viewer


SMALL = {
    "name": "Small", "timeMinutes": 30, "readingMinutes": 5, "difficulty": None, "applicationMin": None,
    "sections": [
        {"name": "A", "marks": 1, "count": 2, "kind": "NUMBER"},
        {"name": "B", "marks": 3, "count": 1, "choices": 1, "kind": "WRITTEN"},
    ],
}


def _refused(call, code):
    with pytest.raises(HTTPException) as err:
        call()
    assert err.value.detail["code"] == code, err.value.detail
    return err.value.detail


def _items(db, view):
    return [(place, half, part) for sec in view["sections"] for place in sec["places"]
            for half in place["halves"] for part in half["parts"]]


def test_a_student_sits_hands_in_and_sees_results_at_once(db_session):
    """#208: every question marks itself (a 3-mark question comes in steps,
    each its own box), so the result is final at hand-in; the right answers
    and solutions follow once the paper closes."""
    db = db_session
    w = _world(db, "MKS1", students=2)
    paper, teacher = _paper(db, w, SMALL)
    a, b = w["students"]

    _refused(lambda: sit.start(db, a, paper.id, now=NOW), "PAPER_NOT_OPEN")
    view = sit.start(db, a, paper.id, now=T1)
    assert view["sitting"]["phase"] == "READING"
    text = json.dumps(view)
    for secret in ("correctAnswer", "correct_answer", "explanation", "markingSteps", "hint"):
        assert secret not in text
    places = _items(db, view)
    pair = view["sections"][1]["places"][0]
    first_half, second_half = pair["halves"]
    # 2 one-mark questions, then an either/or pair of 3-mark questions in steps.
    assert len(view["sections"]) == 2 and len(places) == 2 + len(first_half["parts"]) + len(second_half["parts"])
    assert second_half["stimulus"] and len(second_half["parts"]) >= 2
    # The steps are lettered by their own text, so no second label ("(a) (a)").
    assert second_half["parts"][0]["text"].startswith("(a)") and second_half["parts"][1]["text"].startswith("(b)")
    assert all(p["label"] is None for p in second_half["parts"])
    first = places[0][2]
    _refused(lambda: sit.save_answer(db, a, paper.id, first["id"], "1", now=T1), "READING_TIME")

    writing = T1 + timedelta(minutes=6)
    keys = {q.id: q for q in db.query(Question).filter(Question.id.in_([p[2]["id"] for p in places]))}
    one, two = places[0][2], places[1][2]
    sit.save_answer(db, a, paper.id, one["id"], keys[one["id"]].correct_answer, now=writing)
    sit.save_answer(db, a, paper.id, two["id"], "999999", now=writing)
    # Choosing the second half, then answering both: only the chosen counts.
    sit.choose(db, a, paper.id, second_half["slotId"], now=writing)
    sit.save_answer(db, a, paper.id, first_half["parts"][0]["id"], "Not chosen.", now=writing)
    steps = second_half["parts"]
    right = sum(keys[s["id"]].marks for s in steps[:-1])
    for s in steps[:-1]:
        sit.save_answer(db, a, paper.id, s["id"], keys[s["id"]].correct_answer, now=writing)
    sit.save_answer(db, a, paper.id, steps[-1]["id"], "999999", now=writing)
    again = sit.view(db, a, paper.id, now=writing)
    assert again["sections"][1]["places"][0]["chosenSlotId"] == second_half["slotId"]
    assert again["sections"][0]["places"][0]["halves"][0]["parts"][0]["response"] == keys[one["id"]].correct_answer

    done = sit.submit(db, a, paper.id, now=writing + timedelta(minutes=1))
    assert done["sitting"]["status"] == "SUBMITTED" and done["sections"] == []
    early = done["result"]
    assert early["waiting"] == 0 and early["score"] == 1 + right == early["scoreSoFar"] and not early["solutionsOpen"]
    for sec in early["sections"]:
        for place in sec["places"]:
            for part in place["parts"]:
                assert part["correctAnswer"] is None and part["explanation"] is None and part["markingSteps"] is None
    _refused(lambda: sit.save_answer(db, a, paper.id, one["id"], "2", now=writing), "HANDED_IN")
    sitting_a = db.query(MockPaperSitting).filter_by(paper_id=paper.id, student_id=a.id).one()
    assert sitting_a.final_score == 1 + right  # nothing waits for a teacher

    # B starts and never hands in: handed in when the time is up.
    sit.start(db, b, paper.id, now=T1)
    late = T1 + timedelta(minutes=36)
    assert sit.view(db, b, paper.id, now=late)["sitting"]["submittedHow"] == "TIME"
    # Nothing for the teacher to mark; a step's mark is the platform's.
    marking = sit.marking(db, teacher, paper.id, now=late)
    assert marking["toMark"] == 0 and marking["questions"] == []
    step_answer = db.query(MockPaperAnswer).filter_by(sitting_id=sitting_a.id, question_id=steps[-1]["id"]).one()
    _refused(lambda: sit.save_marks(db, teacher, paper.id, [{"answerId": step_answer.id, "score": 1}]), "VALIDATION_ERROR")

    # Just after closing, a last save may still arrive: no solutions yet.
    just = T0 + timedelta(hours=3, seconds=5)
    assert not sit.view(db, a, paper.id, now=just)["result"]["solutionsOpen"]
    assert not sit.results(db, teacher, paper.id, now=just)["solutionsOpen"]
    closed = T0 + timedelta(hours=3, minutes=1)
    grid = sit.results(db, teacher, paper.id, now=closed)
    assert grid["solutionsOpen"] and grid["handedIn"] == 2
    result = sit.view(db, a, paper.id, now=closed)["result"]
    assert result["score"] == 1 + right and result["maxScore"] == 5 and result["solutionsOpen"]
    shown = result["sections"][1]["places"][0]["parts"]
    assert [p["score"] for p in shown] == [keys[s["id"]].marks for s in steps[:-1]] + [0]
    assert all(p["correctAnswer"] for p in shown)
    listed = sit.student_papers(db, a, now=closed)
    assert listed[0]["solutionsOpen"] and listed[0]["score"] == 1 + right and listed[0]["waiting"] == 0

    # The unchosen half was saved but not counted.
    unchosen = db.query(MockPaperAnswer).filter_by(sitting_id=sitting_a.id, response_text="Not chosen.").one()
    assert unchosen.counted is False


WRITTEN = {
    "questionType": "Constructed Response", "marks": 3, "responseFormat": "Written working",
    "values": [{"name": "a", "int": {"min": 120, "max": 480}}, {"name": "b", "int": {"min": 3, "max": 9}}],
    "text": "Find {a} × {b}. Show your working.", "answer": "{a * b}",
    "steps": [{"marks": 1, "text": "Sets up {a} × {b}."}, {"marks": 1, "text": "Multiplies."}, {"marks": 1, "text": "{a * b}."}],
}


def test_a_written_answer_still_waits_for_the_teacher(db_session):
    """A written answer from a pattern not (yet) in steps is the one thing a
    teacher marks; the total says so far until then, and a mark can be
    changed at any time."""
    from app.models.papers import QuestionPattern

    db = db_session
    w = _world(db, "MKS6", students=1)
    for p in db.query(QuestionPattern).filter(QuestionPattern.board_course_id == w["chapter"].board_course_id,
                                              QuestionPattern.marks == 3):
        spec = json.loads(p.spec_json)
        keep = {k: spec[k] for k in ("code", "chapter", "skill", "difficulty", "competency") if k in spec}
        p.spec_json, p.question_type = json.dumps({**keep, **WRITTEN}), "Constructed Response"
    db.commit()
    paper, teacher = _paper(db, w, SMALL)
    (a,) = w["students"]
    view = sit.start(db, a, paper.id, now=T1)
    writing = T1 + timedelta(minutes=6)
    half = view["sections"][1]["places"][0]["halves"][0]
    (written_part,) = half["parts"]
    sit.save_answer(db, a, paper.id, written_part["id"], "My working and answer.", now=writing)
    early = sit.submit(db, a, paper.id, now=writing + timedelta(minutes=1))["result"]
    assert early["waiting"] == 1 and early["score"] is None and early["scoreSoFar"] == 0
    marking = sit.marking(db, teacher, paper.id, now=writing + timedelta(minutes=2))
    assert marking["toMark"] == 1
    (answer,) = marking["questions"][0]["answers"]
    assert answer["response"] == "My working and answer." and answer["markingSteps"]
    _refused(lambda: sit.save_marks(db, teacher, paper.id, [{"answerId": answer["answerId"], "score": 4}]), "VALIDATION_ERROR")
    sit.save_marks(db, teacher, paper.id, [{"answerId": answer["answerId"], "score": 2}])
    db.commit()
    assert sit.view(db, a, paper.id, now=writing + timedelta(minutes=3))["result"]["score"] == 2
    sit.save_marks(db, teacher, paper.id, [{"answerId": answer["answerId"], "score": 3}])
    db.commit()
    assert sit.view(db, a, paper.id, now=T0 + timedelta(hours=4))["result"]["score"] == 3


def test_who_can_sit_and_when(db_session):
    db = db_session
    w = _world(db, "MKS2", students=1)
    paper, _teacher = _paper(db, w, SMALL)
    student = w["students"][0]
    from app.models import Student

    other_section = db.query(Student).filter(Student.student_code == "STU-mks2-b0").one()
    _refused(lambda: sit.start(db, other_section, paper.id, now=T1), "NOT_FOUND")
    assert sit.student_papers(db, other_section, now=T1) == []
    assert [p["id"] for p in sit.student_papers(db, student, now=T1)] == [paper.id]
    # After it closes, a student who never started can't.
    _refused(lambda: sit.start(db, student, paper.id, now=T0 + timedelta(hours=4)), "PAPER_NOT_OPEN")
    # A student who joins after approval gets their own version on starting.
    late = _make_sectioned_student(db, w["school"], "mks2-late", class_name="5", section="A")
    view = sit.start(db, late, paper.id, now=T1)
    assert len(_items(db, view)) >= 6  # 2 one-mark, then two 3-mark questions in steps
    # Closing cuts the time short: the deadline is the closing time.
    short, _t = _paper(db, w, {**SMALL, "timeMinutes": 120, "readingMinutes": 0}, closes=timedelta(minutes=30))
    v = sit.start(db, student, short.id, now=T1)
    assert v["sitting"]["deadlineAt"] == (T0 + timedelta(minutes=30)).isoformat()
    assert sit.view(db, student, short.id, now=T0 + timedelta(minutes=31))["sitting"]["submittedHow"] == "CLOSED"


def test_a_one_way_paper_moves_forward_only(db_session):
    db = db_session
    w = _world(db, "MKS3", students=1)
    paper, _t = _paper(db, w, {**SMALL, "navigation": "FORWARD", "readingMinutes": 0})
    student = w["students"][0]
    view = sit.start(db, student, paper.id, now=T1)
    from app.models.papers import MockPaperVersion

    version = db.query(MockPaperVersion).filter_by(paper_id=paper.id, student_id=student.id).one()
    later_slot = next(s for s in mock_paper_service.slots_of(db, paper) if s.section_index == 1)
    later_q = db.query(MockPaperVersionItem).filter_by(version_id=version.id, slot_id=later_slot.id).first().question_id
    first_q = view["sections"][0]["places"][0]["halves"][0]["parts"][0]["id"]
    _refused(lambda: sit.save_answer(db, student, paper.id, later_q, "x", now=T1), "SECTION_CLOSED")
    later_shown = sit.view(db, student, paper.id, now=T1)["sections"][1]["places"]
    assert later_shown == []  # not sent until reached
    moved = sit.next_section(db, student, paper.id, now=T1)
    assert moved["sitting"]["sectionIndex"] == 1 and moved["sections"][1]["places"]
    sit.save_answer(db, student, paper.id, later_q, "x", now=T1)
    _refused(lambda: sit.save_answer(db, student, paper.id, first_q, "1", now=T1), "SECTION_CLOSED")
    _refused(lambda: sit.next_section(db, student, paper.id, now=T1), "LAST_SECTION")


def test_the_student_api(client, db_session):
    db = db_session
    w = _world(db, "MKS4", students=1)
    paper, _t = _paper(db, w, SMALL)
    # Open it now, so the routes (which use the real time) can be sat.
    paper.opens_at = NOW - timedelta(minutes=5)
    db.commit()
    student = w["students"][0]
    headers = {**_login(client, student.user.email), "x-auth-role": "STUDENT"}
    listed = client.get("/api/my-papers", headers=headers)
    assert listed.status_code == 200, listed.text
    assert [p["status"] for p in listed.json()["papers"]] == ["OPEN"]
    started = client.post(f"/api/my-papers/{paper.id}/start", headers=headers)
    assert started.status_code == 200, started.text
    assert started.json()["sitting"]["phase"] == "READING"
    teacher_headers = {**_login(client, w["teacher"].user.email), "x-auth-role": "TEACHER"}
    assert client.get("/api/my-papers", headers=teacher_headers).status_code == 403
    grid = client.get(f"/api/mock-papers/{paper.id}/results", headers=teacher_headers).json()
    assert [r["state"] for r in grid["students"]] == ["IN_PROGRESS"] and grid["solutionsOpen"] is False
    items = db.query(MockPaperVersionItem).count()
    assert items > 0


def test_review_fixes(db_session):
    """Choosing is for the writing time; a start with no time left is
    refused; the admin may mark; #208: a 2-mark number answer keeps its
    working box, but on a mock the working earns no method marks: the
    platform's mark is final (a teacher can't change it)."""
    db = db_session
    w = _world(db, "MKS5", students=2)
    fmt = {**SMALL, "readingMinutes": 0, "sections": [
        {"name": "A", "marks": 2, "count": 1, "kind": "NUMBER"},
        {"name": "B", "marks": 3, "count": 1, "choices": 1, "kind": "WRITTEN"}]}
    paper, teacher = _paper(db, w, fmt, closes=timedelta(minutes=20))
    a, b = w["students"]
    view = sit.start(db, a, paper.id, now=T1)
    q = view["sections"][0]["places"][0]["halves"][0]["parts"][0]
    assert q["acceptsWorking"] is True
    sit.save_answer(db, a, paper.id, q["id"], "1", "my steps", working_sent=True, now=T1)
    assert db.query(MockPaperAnswer).filter_by(question_id=q["id"]).one().working_text == "my steps"
    pair = view["sections"][1]["places"][0]["halves"]
    end = T0 + timedelta(minutes=20)
    _refused(lambda: sit.choose(db, a, paper.id, pair[1]["slotId"], now=end + timedelta(seconds=5)), "TIME_UP")
    # B starts with only seconds left: refused.
    _refused(lambda: sit.start(db, b, paper.id, now=end - timedelta(seconds=30)), "TOO_LATE")
    from tests.test_learning import _make_school_admin

    admin = resolve_viewer(db, _make_school_admin(db, w["school"], "mks5"))
    marking = sit.marking(db, admin, paper.id, now=end + timedelta(minutes=1))
    assert marking["canMark"]
    assert [g for g in marking["questions"] if g["marks"] == 2] == []
    number = db.query(MockPaperAnswer).filter_by(question_id=q["id"]).one()
    assert number.auto_score == 0
    _refused(lambda: sit.save_marks(db, admin, paper.id, [{"answerId": number.id, "score": 1}]), "VALIDATION_ERROR")


def test_part_letters_show_once():
    """A part is lettered by the platform only when its own text isn't
    (#208 review): "(a) (a)" never shows."""
    assert sit._part_label({"part": 1, "text": "(a) How many?"}, 3) is None
    assert sit._part_label({"part": 2, "text": "How many?"}, 3) == "b"
    assert sit._part_label({"part": 1, "text": "How many?"}, 1) is None
    assert sit._part_label({"part": None, "text": "How many?"}, 3) is None
