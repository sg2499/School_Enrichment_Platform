"""A blank written practice answer is scored 0 (A-043; 24 Nov 2026).

Shailesh, 24 Nov 2026: "blank means either the student does not know the
answer or did not have time to answer it, either way it counts as not
answered so it should be 0." A blank was built in batch B and then held,
because scoring it makes it a *marked* answer and practice has re-attempts
where a mock paper has none. It is built now with the three places that read
a marked answer differently handled with it -- that, not the one line in
submit_attempt, is the fix:

  * `routes_learning`'s result holds the model answer back while the child
    can still answer the question (the 4 Oct 2026 rule), or leaving a
    question blank becomes the way to read the key and re-attempt.
  * `analytics_service` does not let a blank flag a misconception: a blank
    says nothing about which mistake a child makes (the rule #226 applied to
    a mock paper's blanks). Until now a blank had no score, so the "no score"
    test dropped it by accident.
  * `progress_service` and `standing_service` count it as 0, which the 26 Oct
    2026 My Progress design asks for. The cost is pinned in
    test_my_progress.py: a child who re-attempts and skips a written question
    loses the teacher's earlier mark for it.

Every test here fails on the code as shipped at 44bb837. The guards that
pass unfixed are in test_blank_answers_batch_b.py and say so there.
"""
from app.models import ConceptLesson, MisconceptionReview
from app.models.learning import Attempt, AttemptAnswer, Evaluation, LearningActivityQuestion
from app.services import analytics_service, learning_service
from tests.test_answer_attachments import _pdf, _put, _setup, _signed_in
from tests.test_practice_tracker import _CH, _target

_CH["A431"], _CH["A432"], _CH["A433"], _CH["A434"] = 101, 102, 103, 104


def _started(db, suffix, tag):
    world = _setup(db, suffix, tag)
    browser, headers = _signed_in(world.student.user.email)
    target = _target(db, world.assignment, world.student)
    attempt = browser.post("/api/learning/attempts", json={"assignmentTargetId": target.id}, headers=headers).json()
    return world, browser, headers, target, attempt


def _answer(db, attempt_id, question_id):
    return (
        db.query(AttemptAnswer)
        .filter(AttemptAnswer.attempt_id == attempt_id, AttemptAnswer.question_id == question_id)
        .first()
    )


def _save(browser, headers, attempt_id, question_id, text):
    return browser.put(f"/api/learning/attempts/{attempt_id}/answers",
                       json={"questionId": question_id, "responseText": text}, headers=headers)


def test_a_blank_written_answer_is_scored_nought_and_says_why(client, db_session):
    """The row itself. Fails unfixed: auto_score stayed None, the set went to
    PENDING_REVIEW, and the answer sat in a teacher's queue with nothing in
    it for them to mark."""
    db = db_session
    w, browser, headers, _target_row, attempt = _started(db, "A431", "a431")
    _save(browser, headers, attempt["id"], w.q1.id, "A")
    # q2 and q3 are written answers a teacher marks, and are never touched.
    assert browser.post(f"/api/learning/attempts/{attempt['id']}/submit", headers=headers).status_code == 200
    db.expire_all()

    for question in (w.q2, w.q3):
        blank = _answer(db, attempt["id"], question.id)
        assert blank.auto_score == 0 and blank.is_correct is False, question.id
        assert blank.grading_note == learning_service.BLANK
        # Nothing is left for a teacher to mark.
        assert learning_service.needs_manual_grade(blank) is False

    assert db.query(Evaluation).filter(Evaluation.attempt_id == attempt["id"]).one().review_status == "AUTO_FINALISED"
    # The child is told why it earned nothing, rather than shown a bare 0.
    result = browser.get(f"/api/learning/attempts/{attempt['id']}/result", headers=headers).json()
    note = {a["questionId"]: a["gradingNoteText"] for a in result["answers"]}[w.q2.id]
    assert note == "Nothing was written or attached, so this earned no marks."

    # The teacher's review says the same thing, and does not ask for a mark.
    teacher_c, teacher_h = _signed_in(w.teacher.user.email)
    review = teacher_c.get(f"/api/learning/tracker/attempts/{attempt['id']}", headers=teacher_h).json()
    shown = {a["questionId"]: a for a in review["answers"]}[w.q2.id]
    assert shown["needsManualGrade"] is False and shown["gradingNoteText"] == note


def test_a_blank_does_not_hand_over_the_model_answer(client, db_session):
    """The 4 Oct 2026 rule, kept. Fails unfixed: once the blank is scored it
    is a marked answer, so the result sent `correctAnswer` and `explanation`
    while the child still had attempts -- leave it blank, read the answer,
    re-attempt."""
    db = db_session
    w, browser, headers, _target_row, attempt = _started(db, "A432", "a432")
    _save(browser, headers, attempt["id"], w.q1.id, "A")
    browser.post(f"/api/learning/attempts/{attempt['id']}/submit", headers=headers)

    result = browser.get(f"/api/learning/attempts/{attempt['id']}/result", headers=headers).json()
    held = {a["questionId"]: a for a in result["answers"]}[w.q2.id]
    assert result["attemptsUsed"] < result["maxAttempts"] + result["bonusAttempts"]
    assert held["autoScore"] == 0 and held["correctAnswer"] is None and held["explanation"] is None

    # A teacher reading the same attempt always gets them.
    teacher_c, teacher_h = _signed_in(w.teacher.user.email)
    seen = teacher_c.get(f"/api/learning/tracker/attempts/{attempt['id']}", headers=teacher_h).json()
    assert {a["questionId"]: a for a in seen["answers"]}[w.q2.id]["correctAnswer"] == w.q2.correct_answer


def test_the_last_attempt_being_open_still_holds_the_answer_back(client, db_session):
    """The limit counts an attempt that is still open, so "attempts used <
    the limit" says no as soon as the last one is started. Fails unfixed and
    fails against a gate that only counts attempts: the child blanks the
    question on attempt 2, starts attempt 3, and attempt 2's result hands
    over the key while attempt 3 sits open in front of them."""
    db = db_session
    w, browser, headers, target_row, first = _started(db, "A433", "a433")
    browser.post(f"/api/learning/attempts/{first['id']}/submit", headers=headers)
    second = browser.post("/api/learning/attempts", json={"assignmentTargetId": target_row.id}, headers=headers).json()
    _save(browser, headers, second["id"], w.q1.id, "A")
    browser.post(f"/api/learning/attempts/{second['id']}/submit", headers=headers)

    # The third and last attempt is started but not handed in.
    third = browser.post("/api/learning/attempts", json={"assignmentTargetId": target_row.id}, headers=headers).json()
    open_now = db.query(Attempt).filter(Attempt.id == third["id"]).one()
    assert open_now.status not in ("SUBMITTED", "EVALUATED")

    result = browser.get(f"/api/learning/attempts/{second['id']}/result", headers=headers).json()
    # Every attempt is used, by the count the result reports...
    assert result["attemptsUsed"] == result["maxAttempts"] + result["bonusAttempts"]
    # ...but one of them is still open, so the answer stays held back.
    assert {a["questionId"]: a for a in result["answers"]}[w.q2.id]["correctAnswer"] is None

    # Handed in, with nothing left to answer: now the child may see it.
    browser.post(f"/api/learning/attempts/{third['id']}/submit", headers=headers)
    db.expire_all()
    done = browser.get(f"/api/learning/attempts/{second['id']}/result", headers=headers).json()
    assert {a["questionId"]: a for a in done["answers"]}[w.q2.id]["correctAnswer"] == w.q2.correct_answer


def test_a_pdf_with_nothing_typed_is_still_an_answer(client, db_session):
    """A-013's rule, which A-043 must not undo: a child who draws their
    working and types nothing has answered, so it is not scored 0 here and
    the teacher still marks it."""
    db = db_session
    w, browser, headers, _target_row, attempt = _started(db, "A434", "a434")
    _save(browser, headers, attempt["id"], w.q1.id, "A")
    assert _put(browser, headers, attempt["id"], w.q2.id, _pdf(2), "My working.pdf").status_code == 200
    browser.post(f"/api/learning/attempts/{attempt['id']}/submit", headers=headers)
    db.expire_all()

    drawn = _answer(db, attempt["id"], w.q2.id)
    assert drawn.auto_score is None and drawn.grading_note is None
    assert learning_service.needs_manual_grade(drawn) is True
    # The one with neither is scored, so only the drawing waits.
    assert _answer(db, attempt["id"], w.q3.id).auto_score == 0
    assert db.query(Evaluation).filter(Evaluation.attempt_id == attempt["id"]).one().review_status == "PENDING_REVIEW"


def test_a_blank_written_answer_does_not_flag_a_misconception(client, db_session):
    """A question left blank says nothing about which mistake a child makes,
    which is why a mock paper's blanks were stopped from flagging one (#226).
    Fails unfixed: a written blank had no score, so analytics_service's "no
    score" test dropped it by accident; scored 0, it reads as a question the
    child got wrong, and two of them on one skill flag a misconception the
    child has shown no evidence of -- on the teacher's Class Analytics, and
    in Set Practice for These Students.

    An auto-marked blank has always been scored 0 and has always counted
    here, so this is only about written ones; the wider question is in the
    handover."""
    from app.models import AssignmentTarget
    from tests.test_class_analytics import _ac, _add_question, _do, _world
    from tests.test_learning import _CHAPTER_NUM

    _CHAPTER_NUM.setdefault("CA9", 105)

    db = db_session
    w = _world(db, "CA9")
    # A second written question carrying the same misconception as the
    # first, so two of them can make a pattern.
    # The same skill as the first written question, or the two sit in
    # different groups and neither can reach two questions. (Ordering
    # ConceptLesson by id picks whichever uuid sorts first, which is why
    # this is read off the question itself.)
    skill = db.get(ConceptLesson, w["qs"][4].concept_lesson_id)
    second = _add_question(db, skill, "CA9-W2", assignment_code=_ac("CA9", "P01"),
                           question_type="Constructed Response", correct_answer="Because.", auto_gradable=False)
    second.misconception_tag = "Explains without the rule."
    # Approved, or the note is held back from the teacher whatever the
    # counts (Ashalatha's wording, Q14 26 Oct 2026).
    db.add(MisconceptionReview(
        concept_lesson_id=skill.id, tag_key=analytics_service.tag_key("Explains without the rule."),
        status="APPROVED", shown_note="Explains without the rule.", next_step="Ask for the rule in words.",
    ))
    db.commit()
    db.add(LearningActivityQuestion(learning_activity_id=w["core"].id, question_id=second.id, sequence=9))
    db.commit()

    a, b, _c = w["students"]
    q1, q2, q3, q4, wr = w["qs"]
    targets = {t.student_id: t for t in db.query(AssignmentTarget).filter_by(assignment_id=w["assignment"].id)}
    # a writes both written answers and a teacher marks them below full
    # marks; b leaves both blank.
    _do(db, a, targets[a.id].id, {q1: "A", q2: "A", q3: "A", q4: "10", wr: "Mine", second: "Mine too"})
    _do(db, b, targets[b.id].id, {q1: "A", q2: "A", q3: "A", q4: "10"})
    db.expire_all()

    teacher_c, teacher_h = _signed_in(w["teacher"].user.email)
    teacher_h = {**teacher_h, "x-auth-role": "TEACHER"}
    a_attempt = db.query(Attempt).filter(Attempt.assignment_target_id == targets[a.id].id).one()
    marked = teacher_c.post(
        f"/api/learning/tracker/attempts/{a_attempt.id}/grades",
        json={"grades": [{"questionId": wr.id, "score": 0}, {"questionId": second.id, "score": 0}]},
        headers=teacher_h)
    assert marked.status_code == 200, marked.text
    db.expire_all()

    # b's two blanks really were scored, so this does not pass by accident.
    notes = [
        row.grading_note
        for row in db.query(AttemptAnswer).join(Attempt, Attempt.id == AttemptAnswer.attempt_id)
        .filter(Attempt.assignment_target_id == targets[b.id].id, AttemptAnswer.question_id.in_([wr.id, second.id]))
    ]
    assert notes == [learning_service.BLANK, learning_service.BLANK]

    scope = f"{w['assignment'].class_level_id}|A|{w['assignment'].board_course_id}"
    report = teacher_c.get(
        f"/api/learning/analytics/chapters/{w['chapter'].id}/misconceptions",
        params={"scope": scope}, headers=teacher_h,
    ).json()
    written_one = [m for m in report["misconceptions"] if m["misconception"] == "Explains without the rule."]
    flagged = {s_["studentCode"] for m in written_one for s_ in m["students"]}
    # The child whose answers a teacher judged wrong is flagged; the one who
    # left them blank is not.
    assert a.student_code in flagged
    assert b.student_code not in flagged
