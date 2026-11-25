"""A-011: a question sent back for rework is not served, not marked, and
not counted -- so no child is marked against a key a person has rejected.

The rule is Shailesh's, decided 23 Nov 2026 (#251), in four parts:
  1. hide the QUESTION, not the set, unless hiding it leaves the set under
     the minimum, and then hold the set;
  2. a question pulled from an attempt already open is not counted at all --
     not right, not wrong, and out of the total;
  3. attempts already submitted and marked keep their marks;
  4. only a human send-back (APPROVED -> SME_REVIEW) pulls a question. An
     automatic FLAGGED from Re-run Checks does not.
"""
import pytest

from app.models import AssignmentTarget, AttemptAnswer, Question
from app.services import learning_service
from tests import test_learning
from tests.test_class_analytics import _world

test_learning._CHAPTER_NUM.update({"WDR": 201, "WDRB": 202, "WDRC": 203, "WDRD": 204, "WDRE": 205})


def _target(db, w, student):
    return (
        db.query(AssignmentTarget)
        .filter_by(assignment_id=w["assignment"].id, student_id=student.id)
        .one()
    )


def test_a_sent_back_question_is_no_longer_served_or_marked(db_session):
    """The defect itself: a child opening the set tomorrow still got the
    question and was marked against the rejected key."""
    db = db_session
    w = _world(db, "WDR")
    activity_id = w["assignment"].learning_activity_id
    pulled = w["qs"][0]

    before = {q.id for q in learning_service.servable_questions(db, activity_id)}
    assert pulled.id in before

    pulled.status = "SME_REVIEW"
    db.commit()

    after = {q.id for q in learning_service.servable_questions(db, activity_id)}
    assert pulled.id not in after
    assert after == before - {pulled.id}, "only the sent-back question goes"


def test_a_flagged_question_is_still_served(db_session):
    """#251 part 4. The quality checker has false positives, so a FLAGGED
    question is reported, never taken out from under a child."""
    db = db_session
    w = _world(db, "WDRB")
    activity_id = w["assignment"].learning_activity_id
    flagged = w["qs"][0]
    flagged.quality_status = "FLAGGED"
    db.commit()

    served = {q.id for q in learning_service.servable_questions(db, activity_id)}
    assert flagged.id in served, "a flagged question must still be served"


def test_a_question_pulled_mid_attempt_is_out_of_the_total(db_session):
    """#251 part 2. A child must never be marked out of a question that was
    taken away from them, and their answer to it must not land in the
    teacher's queue."""
    db = db_session
    w = _world(db, "WDRC")
    student = w["students"][0]
    target = _target(db, w, student)
    activity_id = w["assignment"].learning_activity_id

    attempt = learning_service.start_attempt(db, student, target.id)
    served = learning_service.servable_questions(db, activity_id)
    whole_set_marks = sum(q.marks for q in served)
    pulled = served[0]

    # The child answers it, and then it is sent back.
    learning_service.save_answer(db, student, attempt.id, pulled.id, "an answer")
    pulled.status = "SME_REVIEW"
    db.commit()

    evaluation = learning_service.submit_attempt(db, student, attempt.id)

    assert evaluation.max_score == whole_set_marks - pulled.marks, (
        "the withdrawn question must be out of the total, not marked 0"
    )
    row = (
        db.query(AttemptAnswer)
        .filter_by(attempt_id=attempt.id, question_id=pulled.id)
        .one()
    )
    assert row.response_text == "an answer", "the child's work is kept"
    assert row.grading_note == learning_service.WITHDRAWN
    assert row.auto_score is None and row.is_correct is None, "neither right nor wrong"
    assert not learning_service.needs_manual_grade(row), (
        "a withdrawn question must not reach the teacher's marking queue"
    )


def test_saving_an_answer_to_a_withdrawn_question_says_so_kindly(db_session):
    """The child's screen still shows the question, so the refusal is the
    first they hear of it -- and it is not their mistake."""
    db = db_session
    w = _world(db, "WDRD")
    student = w["students"][0]
    target = _target(db, w, student)
    activity_id = w["assignment"].learning_activity_id

    attempt = learning_service.start_attempt(db, student, target.id)
    pulled = learning_service.servable_questions(db, activity_id)[0]
    pulled.status = "SME_REVIEW"
    db.commit()

    with pytest.raises(Exception) as caught:
        learning_service.save_answer(db, student, attempt.id, pulled.id, "x")
    message = str(getattr(caught.value, "detail", caught.value))
    assert "taken this question out" in message
    assert "saved" in message, "the child is told their other work is safe"
    # Not phrased as the child's error.
    assert "isn't part of this practice" not in message


def test_a_set_that_was_always_small_is_not_held(db_session):
    """#251 part 1's limit. A five-question set is held only if it LOST a
    question -- the demo school's Case Study is five by design, and holding
    it would be this fix breaking something nobody asked it to touch."""
    db = db_session
    w = _world(db, "WDRE")
    activity_id = w["assignment"].learning_activity_id
    served = learning_service.servable_questions(db, activity_id)
    assert len(served) < learning_service.MIN_SET_SIZE, "fixture is a small set"
    # Nothing withdrawn in this world yet beyond the first test's own.
    for q in db.query(Question).filter(Question.id.in_([x.id for x in served])).all():
        q.status = "APPROVED"
    db.commit()
    assert learning_service.set_is_held(db, activity_id) is False
