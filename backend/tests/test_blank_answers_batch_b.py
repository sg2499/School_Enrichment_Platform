"""A blank answer, and a PDF that is not one (A-013; 23 Nov 2026).

One rule, in learning_service.answer_is_blank: a child has given nothing only
when they typed nothing AND attached nothing. A child who draws their working
on paper and attaches the PDF has answered; they just did not type.

What the 22 Nov audit found, and each row's test here:

  * A-013, mock papers. hand_in read the typed text alone, so a PDF-only
    answer was scored 0 -- and save_marks refuses a mark for any answer that
    already has one, so the teacher could never put it right. The same
    reading left the PDF-only half of an either/or pair uncounted, and showed
    the cell as blank on the teacher's grid.
  * A-043, practice. submit_attempt had no blank rule at all, so every blank
    written answer sat in a teacher's queue. Built, held for a day, and
    shipped on 24 Nov 2026 with the three places that read a marked answer
    differently handled alongside it -- see
    tests/test_blank_practice_answers_a043.py.

Two of these pass against the unfixed code and are guards on what already
worked: the mock scoring a wholly blank answer 0, and a typed answer coming
through untouched. They are marked GUARD below. The rest fail without the
fix, each for its own stated reason.
"""
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from app.models import AnswerAttachment
from app.models.learning import AttemptAnswer, Evaluation
from app.models.papers import MockPaperAnswer, MockPaperSitting
from app.services import learning_service
from app.services import mock_sitting_service as sit
from tests.test_answer_attachments import _pdf, _put, _setup, _signed_in
from tests.test_mock_papers import _world
from tests.test_mock_sittings import SMALL, WRITTEN
from tests.test_practice_tracker import _CH, _target

# Its own chapter numbers, so these sets do not collide with another file's.
_CH["NGV1"], _CH["NGV2"], _CH["NGV3"] = 94, 95, 96

# --- the rule itself -------------------------------------------------------------------------


def test_the_rule_reads_the_typed_text_and_the_file():
    blank = learning_service.answer_is_blank
    assert blank(None, has_file=False) is True
    assert blank("", has_file=False) is True
    assert blank("   \n ", has_file=False) is True
    # A drawing on paper is an answer.
    assert blank(None, has_file=True) is False
    assert blank("   ", has_file=True) is False
    # So is anything typed, file or no file.
    assert blank("0", has_file=False) is False
    assert blank("My working.", has_file=False) is False


# --- practice -------------------------------------------------------------------------------


def _written_pattern(db, chapter):
    """The chapter's 3-mark patterns become written questions a teacher marks."""
    from app.models.papers import QuestionPattern

    for p in db.query(QuestionPattern).filter(QuestionPattern.board_course_id == chapter.board_course_id,
                                              QuestionPattern.marks == 3):
        spec = json.loads(p.spec_json)
        keep = {k: spec[k] for k in ("code", "chapter", "skill", "difficulty", "competency") if k in spec}
        p.spec_json, p.question_type = json.dumps({**keep, **WRITTEN}), "Constructed Response"
    db.commit()


def _practice(db, suffix, tag):
    """A set with one auto-marked question and two a teacher marks, started."""
    world = _setup(db, suffix, tag)
    browser, headers = _signed_in(world.student.user.email)
    target = _target(db, world.assignment, world.student)
    attempt = browser.post("/api/learning/attempts", json={"assignmentTargetId": target.id}, headers=headers).json()
    return SimpleNamespace(world=world, browser=browser, headers=headers, attempt=attempt)


def _answer(db, attempt_id, question_id):
    return (
        db.query(AttemptAnswer)
        .filter(AttemptAnswer.attempt_id == attempt_id, AttemptAnswer.question_id == question_id)
        .first()
    )


def test_the_payloads_say_which_answers_a_teacher_marks(client, db_session):
    """A-041. The confirmations count an attached PDF as an answer only where
    a teacher marks it, so `teacherMarked` has to reach the screen. Nothing
    else in the suite reads it: without this, the field could go missing and a
    PDF-only answer would show as blank again with every test green."""
    db = db_session
    p = _practice(db, "NGV1", "ngv1")
    w = p.world
    marked = {q["id"]: q["teacherMarked"] for q in p.attempt["questions"]}
    assert marked == {w.q1.id: False, w.q2.id: True, w.q3.id: True}

    # A reviewer may put the box on a question the platform marks itself.
    # There the PDF earns nothing on its own, and the payload must say so.
    w.q1.upload_rule = "OPTIONAL"
    db.commit()
    again = p.browser.post("/api/learning/attempts", json={"assignmentTargetId": _target(db, w.assignment, w.student).id},
                           headers=p.headers).json()
    auto = {q["id"]: q for q in again["questions"]}[w.q1.id]
    assert auto["uploadRule"] == "OPTIONAL" and auto["teacherMarked"] is False

    # And on a mock paper's parts.
    s = _sat(db, "NGVM6")
    (part,) = s.view["sections"][1]["places"][0]["halves"][0]["parts"]
    assert part["teacherMarked"] is True


def test_practice_leaves_a_pdf_only_answer_for_the_teacher(client, db_session):
    """A child who draws their working, attaches the PDF and types nothing has
    answered, and the answer reaches their teacher. This is the half of A-013
    that practice inherited when A-043 arrived (24 Nov 2026): the blank rule
    must not reach an answer that has a drawing behind it."""
    db = db_session
    p = _practice(db, "NGV2", "ngv2")
    w = p.world
    p.browser.put(f"/api/learning/attempts/{p.attempt['id']}/answers",
                  json={"questionId": w.q1.id, "responseText": "A"}, headers=p.headers)
    # The drawing is the answer: a PDF, and nothing typed.
    assert _put(p.browser, p.headers, p.attempt["id"], w.q2.id, _pdf(2), "My triangle.pdf").status_code == 200
    assert p.browser.post(f"/api/learning/attempts/{p.attempt['id']}/submit", headers=p.headers).status_code == 200
    db.expire_all()

    drawn = _answer(db, p.attempt["id"], w.q2.id)
    assert drawn.auto_score is None and learning_service.needs_manual_grade(drawn) is True
    # The one with neither is scored 0 (A-043, 24 Nov 2026), so only the
    # drawing waits for the teacher.
    assert _answer(db, p.attempt["id"], w.q3.id).auto_score == 0

    evaluation = db.query(Evaluation).filter(Evaluation.attempt_id == p.attempt["id"]).one()
    assert evaluation.review_status == "PENDING_REVIEW"
    # And the teacher can mark it.
    teacher_c, teacher_h = _signed_in(w.teacher.user.email)
    marked = teacher_c.post(
        f"/api/learning/tracker/attempts/{p.attempt['id']}/grades",
        json={"grades": [{"questionId": w.q2.id, "score": 3}]}, headers=teacher_h)
    assert marked.status_code == 200, marked.text
    db.expire_all()
    assert _answer(db, p.attempt["id"], w.q2.id).manual_score == 3


def test_practice_leaves_a_typed_answer_exactly_as_it_was(client, db_session):
    """GUARD. Nothing in this batch may reach an answer with something in it."""
    db = db_session
    p = _practice(db, "NGV3", "ngv3")
    w = p.world
    for question, text in ((w.q1, "A"), (w.q2, "0"), (w.q3, "I counted the sides.")):
        p.browser.put(f"/api/learning/attempts/{p.attempt['id']}/answers",
                      json={"questionId": question.id, "responseText": text}, headers=p.headers)
    assert p.browser.post(f"/api/learning/attempts/{p.attempt['id']}/submit", headers=p.headers).status_code == 200
    db.expire_all()
    # "0" is an answer, not a blank.
    for question in (w.q2, w.q3):
        answer = _answer(db, p.attempt["id"], question.id)
        assert answer.auto_score is None and learning_service.needs_manual_grade(answer) is True


# --- A-013: mock papers ---------------------------------------------------------------------


def _sat(db, suffix, students=1):
    """A paper whose section B is an either/or pair of written questions,
    started by its student and in its writing time *by the real clock* -- the
    upload route keeps its own time, so a paper pinned to a fixed hour would
    refuse the file as reading time or as not open (#237 records this path as
    never live-tested, which is how that went unnoticed).
    """
    from app.services import mock_paper_service
    from app.services.practice_access_service import resolve_viewer

    real = datetime.now(UTC)
    w = _world(db, suffix, students=students)
    _written_pattern(db, w["chapter"])
    teacher = resolve_viewer(db, w["teacher"].user)
    scope = mock_paper_service.analytics_service.parse_scope(w["scope"])
    paper = mock_paper_service.create_draft(
        db, teacher, scope, title="Practice", raw_format=SMALL, format_id=None, chapter_ids=[w["chapter"].id],
        opens_at=real - timedelta(minutes=20), closes_at=real + timedelta(hours=2),
    )
    mock_paper_service.approve(db, teacher, paper.id, now=real - timedelta(minutes=30))
    db.commit()
    student = w["students"][0]
    # Started ten minutes ago, so its five minutes of reading time are over.
    view = sit.start(db, student, paper.id, now=real - timedelta(minutes=10))
    db.commit()
    return SimpleNamespace(world=w, paper=paper, teacher=teacher, student=student, view=view,
                           real=real, writing=real)


def _mock_put(browser, headers, paper_id, question_id, content, name="working.pdf"):
    return browser.put(f"/api/my-papers/{paper_id}/answers/{question_id}/attachment",
                       files={"file": (name, content, "application/pdf")}, headers=headers)


def test_a_mock_pdf_only_answer_reaches_the_teacher(client, db_session):
    """A-013. Uploaded through the real route (#237 records this path as never
    live-tested). Fails unfixed: hand_in scored it 0, and save_marks then
    refused the teacher a mark for it."""
    db = db_session
    s = _sat(db, "NGVM1")
    browser, headers = _signed_in(s.student.user.email)
    (part,) = s.view["sections"][1]["places"][0]["halves"][0]["parts"]

    uploaded = _mock_put(browser, headers, s.paper.id, part["id"], _pdf(2), "My rectangle.pdf")
    assert uploaded.status_code == 200, uploaded.text
    assert db.query(AnswerAttachment).filter_by(question_id=part["id"]).count() == 1
    sit.submit(db, s.student, s.paper.id, now=s.writing + timedelta(minutes=1))
    db.commit()

    answer = db.query(MockPaperAnswer).filter_by(question_id=part["id"]).one()
    assert answer.auto_score is None and answer.counted is True
    # The teacher is asked to mark it, sees the file, and the mark sticks.
    marking = sit.marking(db, s.teacher, s.paper.id, now=s.writing + timedelta(minutes=2))
    assert marking["toMark"] == 1
    (to_mark,) = marking["questions"][0]["answers"]
    assert to_mark["attachment"]["filename"] == "My rectangle.pdf" and to_mark["response"] is None
    sit.save_marks(db, s.teacher, s.paper.id, [{"answerId": to_mark["answerId"], "score": 3}])
    db.commit()
    assert sit.view(db, s.student, s.paper.id, now=s.writing + timedelta(minutes=3))["result"]["score"] == 3


def test_a_mock_answer_with_neither_is_still_scored_nought(client, db_session):
    """GUARD. A written answer with nothing in it has nothing to mark, and the
    mock has scored it 0 since #166. The fix must not change that."""
    db = db_session
    s = _sat(db, "NGVM2")
    (part,) = s.view["sections"][1]["places"][0]["halves"][0]["parts"]
    sit.submit(db, s.student, s.paper.id, now=s.writing + timedelta(minutes=1))
    db.commit()

    answer = db.query(MockPaperAnswer).filter_by(question_id=part["id"]).one()
    assert answer.auto_score == 0 and answer.is_correct is False
    assert sit.marking(db, s.teacher, s.paper.id, now=s.writing + timedelta(minutes=2))["toMark"] == 0


def test_a_pdf_chooses_its_half_of_an_either_or_pair(client, db_session):
    """A-013. Attaching a PDF answers the question, so it chooses that half
    exactly as typing does, and the upload says so back to the screen. Fails
    unfixed: the upload chose nothing, typing on the other half then chose
    that one, and the drawing went uncounted -- with save_marks refusing a
    mark on `not a.counted`."""
    db = db_session
    s = _sat(db, "NGVM3")
    browser, headers = _signed_in(s.student.user.email)
    pair = s.view["sections"][1]["places"][0]
    first, second = pair["halves"]
    assert pair["choiceGroup"] and pair["chosenSlotId"] is None

    # The drawing goes on the SECOND half; then the child types on the first.
    uploaded = _mock_put(browser, headers, s.paper.id, second["parts"][0]["id"], _pdf(1))
    assert uploaded.status_code == 200, uploaded.text
    # The screen learns the half from the upload itself, or the paper would
    # go on asking the child to choose one.
    assert uploaded.json()["chosenSlotId"] == second["slotId"]
    db.expire_all()
    assert sit.view(db, s.student, s.paper.id, now=s.writing)["sections"][1]["places"][0]["chosenSlotId"] == second["slotId"]
    sit.save_answer(db, s.student, s.paper.id, first["parts"][0]["id"], "Changed my mind.", now=s.writing)
    db.commit()

    sit.submit(db, s.student, s.paper.id, now=s.writing + timedelta(minutes=1))
    db.commit()
    drawn = db.query(MockPaperAnswer).filter_by(question_id=second["parts"][0]["id"]).one()
    assert drawn.counted is True and drawn.auto_score is None
    assert db.query(MockPaperAnswer).filter_by(question_id=first["parts"][0]["id"]).one().counted is False


def test_hand_in_picks_the_half_that_has_a_pdf(client, db_session):
    """A-013. The no-choice branch of hand_in reads the file too, so a sitting
    that already has a PDF and no choice recorded (one from before this fix)
    still counts the half the child worked on. Fails unfixed: the branch read
    response_text alone and fell back to the first half."""
    db = db_session
    s = _sat(db, "NGVM4")
    browser, headers = _signed_in(s.student.user.email)
    _first, second = s.view["sections"][1]["places"][0]["halves"]
    assert _mock_put(browser, headers, s.paper.id, second["parts"][0]["id"], _pdf(1)).status_code == 200

    # As a sitting from before the fix: the file is there, no choice is.
    sitting = db.query(MockPaperSitting).filter_by(paper_id=s.paper.id, student_id=s.student.id).one()
    sitting.choices_json = "{}"
    db.commit()

    sit.submit(db, s.student, s.paper.id, now=s.writing + timedelta(minutes=1))
    db.commit()
    assert db.query(MockPaperAnswer).filter_by(question_id=second["parts"][0]["id"]).one().counted is True


def test_the_teachers_grid_does_not_call_a_pdf_blank(client, db_session):
    """A-013. A cell marked blank is one a teacher scrolls past. Fails
    unfixed: the grid read response_text alone."""
    db = db_session
    s = _sat(db, "NGVM5")
    browser, headers = _signed_in(s.student.user.email)
    (part,) = s.view["sections"][1]["places"][0]["halves"][0]["parts"]
    assert _mock_put(browser, headers, s.paper.id, part["id"], _pdf(1)).status_code == 200
    sit.submit(db, s.student, s.paper.id, now=s.writing + timedelta(minutes=1))
    db.commit()

    grid = sit.results(db, s.teacher, s.paper.id, now=s.real + timedelta(hours=3))
    (row,) = [r for r in grid["students"] if r["cells"]]
    written = [c for key, c in row["cells"].items() if key.startswith("g")]
    assert written and all(c["blank"] is False for c in written)
    assert all(c["waiting"] is True for c in written)
