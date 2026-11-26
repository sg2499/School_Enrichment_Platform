"""#261: a question a person sent back stays out of a live set, even after it
is moved on to Draft.

`_QUESTION_TRANSITIONS` allows APPROVED -> SME_REVIEW (a person sending a
question back for rework) and then SME_REVIEW -> DRAFT. Until 26 Nov 2026 the
serve-time filter was `WITHDRAWN_QUESTION_STATUSES = {"SME_REVIEW"}` alone, so
the second step walked the question back out of the filter and it was served
to children again -- unapproved, with nobody having approved it.

`learning_service.withdrawn_question_clause()` now reads A-012's
`sent_back_at` stamp as well as the status. The stamp is written by the only
human send-back path and survives the move to Draft by design.

Shailesh chose this over the obvious alternative -- serving only APPROVED or
PUBLISHED, which is what every publishing GATE does -- on 26 Nov, because a
whitelist would also hide questions no person ever rejected, and his decision
of 23 Nov (#251, A-011 part 4) is that only a human send-back pulls a question
from a live set. The last test here is what holds that line: a Draft nobody
sent back is still served.

Every transition below goes through the real PATCH endpoint, not a hand-set
status, so what is pinned is the stamp being written at the first step and
surviving the second.
"""
from app.models import AttemptAnswer
from app.services import learning_service
from tests import test_learning
from tests.test_class_analytics import _world
from tests.test_curriculum_admin import _login, _make_super_admin

test_learning._CHAPTER_NUM.update({"SBW": 231, "SBWB": 232, "SBWC": 233, "SBWD": 234, "SBWE": 235})


def _studio(client, db, email):
    _make_super_admin(db, email)
    return _login(client, email)


def _set_status(client, csrf, question, status):
    response = client.patch(
        f"/api/curriculum-admin/questions/{question.id}/status",
        json={"status": status},
        headers=csrf,
    )
    assert response.status_code == 200, response.text
    return response


def test_a_sent_back_question_moved_to_draft_is_still_not_served(client, db_session):
    """The defect. Two clicks in Curriculum Studio and the question was back
    in front of children."""
    db = db_session
    w = _world(db, "SBW")
    activity_id = w["assignment"].learning_activity_id
    pulled = w["qs"][0]
    pulled.status = "APPROVED"
    db.commit()

    before = {q.id for q in learning_service.servable_questions(db, activity_id)}
    assert pulled.id in before

    csrf = _studio(client, db, "sa-sbw@example.com")
    _set_status(client, csrf, pulled, "SME_REVIEW")
    db.refresh(pulled)
    assert pulled.sent_back_at is not None, "the send-back must be stamped at this step"

    after_review = {q.id for q in learning_service.servable_questions(db, activity_id)}
    assert pulled.id not in after_review, "A-011: a send-back pulls it from the set"

    _set_status(client, csrf, pulled, "DRAFT")
    db.refresh(pulled)
    assert pulled.status == "DRAFT"
    assert pulled.sent_back_at is not None, "the stamp survives the move to Draft"

    after_draft = {q.id for q in learning_service.servable_questions(db, activity_id)}
    assert pulled.id not in after_draft, "#261: and it stays out once it is a Draft"
    assert after_draft == before - {pulled.id}, "only that question goes"


def test_a_sent_back_draft_is_counted_as_withdrawn_and_can_hold_a_set(client, db_session):
    """The other two readers of the rule. `withdrawn_question_ids` feeds the
    teacher's queue and the result page; `set_is_held` is part 1's floor. All
    three have to agree, or A-011's "one place decides what a set contains"
    stops being true."""
    db = db_session
    w = _world(db, "SBWB")
    activity_id = w["assignment"].learning_activity_id
    pulled = w["qs"][0]
    pulled.status = "APPROVED"
    db.commit()

    assert learning_service.withdrawn_question_ids(db, activity_id) == set()

    csrf = _studio(client, db, "sa-sbwb@example.com")
    _set_status(client, csrf, pulled, "SME_REVIEW")
    _set_status(client, csrf, pulled, "DRAFT")

    assert learning_service.withdrawn_question_ids(db, activity_id) == {pulled.id}
    # _world builds a small set, so losing one question takes it under the
    # ten-question floor -- which is part 1 doing its job, not a surprise.
    assert learning_service.set_is_held(db, activity_id) is True


def test_approving_it_again_puts_it_back(client, db_session):
    """The way back, and the reason this is not a one-way door: the studio
    clears the stamp, and the question is served again."""
    db = db_session
    w = _world(db, "SBWC")
    activity_id = w["assignment"].learning_activity_id
    pulled = w["qs"][0]
    pulled.status = "APPROVED"
    db.commit()

    csrf = _studio(client, db, "sa-sbwc@example.com")
    _set_status(client, csrf, pulled, "SME_REVIEW")
    _set_status(client, csrf, pulled, "DRAFT")
    assert pulled.id not in {q.id for q in learning_service.servable_questions(db, activity_id)}

    _set_status(client, csrf, pulled, "SME_REVIEW")
    _set_status(client, csrf, pulled, "APPROVED")
    db.refresh(pulled)
    assert pulled.sent_back_at is None, "approving in the studio clears the stamp"

    served = {q.id for q in learning_service.servable_questions(db, activity_id)}
    assert pulled.id in served
    assert learning_service.withdrawn_question_ids(db, activity_id) == set()
    assert learning_service.set_is_held(db, activity_id) is False


def test_a_draft_nobody_sent_back_is_still_served(db_session):
    """What keeps this from quietly becoming the whitelist.

    A question at DRAFT that no person rejected -- an importer's doing, or
    #262's -- is still served. That is deliberate: his decision of 23 Nov is
    that only a human send-back takes a question away from a class, and
    hiding this one would mean a workbook could do it. Unapproved questions
    reaching a live set at all is #262's and A-035's to fix, at the source.
    """
    db = db_session
    w = _world(db, "SBWD")
    activity_id = w["assignment"].learning_activity_id
    never_reviewed = w["qs"][0]
    never_reviewed.status = "DRAFT"
    never_reviewed.sent_back_at = None
    db.commit()

    served = {q.id for q in learning_service.servable_questions(db, activity_id)}
    assert never_reviewed.id in served
    assert learning_service.withdrawn_question_ids(db, activity_id) == set()


def test_the_rule_is_one_predicate():
    """Guards the shape rather than the behaviour: if a fourth reader of the
    filter appears and writes its own version, this is the test that should
    have been updated and was not."""
    clause = str(learning_service.withdrawn_question_clause())
    assert "status IN" in clause
    assert "sent_back_at IS NOT NULL" in clause


def test_a_child_who_answered_it_mid_attempt_is_not_marked_against_it(client, db_session):
    """The fourth reader of the rule: submit_attempt. A-011 part 2 says a
    question pulled from an attempt already open is not counted at all --
    not right, not wrong, and out of the total. That has to hold for a
    send-back finished off in Draft too, not only one left in review.

    Mirrors A-011's own part 2 test, with the status moved through the real
    endpoint in two steps instead of being set on the object."""
    db = db_session
    w = _world(db, "SBWE")
    student = w["students"][0]
    target = (
        db.query(learning_service.AssignmentTarget)
        .filter_by(assignment_id=w["assignment"].id, student_id=student.id)
        .one()
    )
    activity_id = w["assignment"].learning_activity_id

    attempt = learning_service.start_attempt(db, student, target.id)
    served = learning_service.servable_questions(db, activity_id)
    whole_set_marks = sum(q.marks for q in served)
    pulled = served[0]
    pulled.status = "APPROVED"
    db.commit()

    learning_service.save_answer(db, student, attempt.id, pulled.id, "an answer")

    csrf = _studio(client, db, "sa-sbwe@example.com")
    _set_status(client, csrf, pulled, "SME_REVIEW")
    _set_status(client, csrf, pulled, "DRAFT")

    evaluation = learning_service.submit_attempt(db, student, attempt.id)

    assert evaluation.max_score == whole_set_marks - pulled.marks, (
        "a question sent back and then moved to Draft must still be out of the total"
    )
    row = db.query(AttemptAnswer).filter_by(attempt_id=attempt.id, question_id=pulled.id).one()
    assert row.response_text == "an answer", "the child's work is kept"
    assert row.grading_note == learning_service.WITHDRAWN
    assert row.auto_score is None and row.is_correct is None, "neither right nor wrong"
    assert not learning_service.needs_manual_grade(row), (
        "it must not reach the teacher's marking queue"
    )
