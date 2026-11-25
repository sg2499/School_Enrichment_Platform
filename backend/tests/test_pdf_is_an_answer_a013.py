"""A-013, 24 Nov 2026: a PDF of a child's working is an answer.

Found live on production while verifying A-013 on the first teacher-marked
set a child could actually reach ("Measurement — Mastery E", 20 Constructed
Response questions). The rule had been applied to the mock paper and to the
Submit Practice confirmation, but not everywhere a count of answers is shown
to somebody -- so one child's answer was counted differently depending on who
was looking.

This file covers the server half. The screens are covered by
frontend/tests/unit/practiceStrip.test.mjs.
"""
from app.models import AnswerAttachment, AssignmentTarget, Attempt, AttemptAnswer
from app.services import learning_service, upload_rule_service, weekly_report_service

from tests import test_learning
from tests.test_class_analytics import _world

# Its own chapter numbers, so this file's worlds never clash with another
# file's (the suffix is what makes Chapter.code and assignment_code unique).
test_learning._CHAPTER_NUM.update({"PDFA": 171, "PDFB": 172, "PDFC": 173})


def _attach(db, student, answer):
    """The row an upload leaves behind, without a file store: this is about
    whether a count asks the question, not about storage."""
    db.add(
        AnswerAttachment(
            student_id=student.id,
            question_id=answer.question_id,
            attempt_answer_id=answer.id,
            filename="working.pdf",
            content_type="application/pdf",
            size_bytes=604,
            page_count=1,
            sha256="0" * 64,
            storage_backend="LOCAL",
            storage_key=f"test/{answer.id}.pdf",
        )
    )
    db.commit()


def test_the_parents_weekly_report_counts_a_pdf_with_nothing_typed(db_session):
    """A child answers a written question by attaching their working and
    typing nothing. The platform sends that answer to the teacher and does
    not score it 0 -- so the parent's "Questions Answered" has to count it.

    Before this fix the count read the typed text alone, so a child who did
    three questions on paper was reported to their parent as having answered
    none of them."""
    db = db_session
    w = _world(db, "PDFA")
    student = w["students"][0]
    written = w["qs"][4]  # the written, teacher-marked question in the world
    target = (
        db.query(AssignmentTarget)
        .filter_by(assignment_id=w["assignment"].id, student_id=student.id)
        .one()
    )

    attempt = learning_service.start_attempt(db, student, target.id)
    # Nothing typed anywhere: the PDF is the whole answer.
    learning_service.save_answer(db, student, attempt.id, written.id, "")
    answer = (
        db.query(AttemptAnswer)
        .filter_by(attempt_id=attempt.id, question_id=written.id)
        .one()
    )
    _attach(db, student, answer)
    learning_service.submit_attempt(db, student, attempt.id)

    submitted = db.get(Attempt, attempt.id).submitted_at
    week = weekly_report_service.monday_of(submitted.date())
    numbers = weekly_report_service._week_numbers(db, [student.id], week)

    assert numbers[student.id]["answered"] == 1, (
        "the parent's report must count an answer the child gave as a PDF"
    )


def test_a_question_with_neither_text_nor_a_pdf_is_still_not_answered(db_session):
    """The other half of the rule, so the fix cannot drift into counting
    everything: a question left truly blank is not an answer, and a parent
    should not be told otherwise."""
    db = db_session
    w = _world(db, "PDFB")
    student = w["students"][1]
    written = w["qs"][4]
    target = (
        db.query(AssignmentTarget)
        .filter_by(assignment_id=w["assignment"].id, student_id=student.id)
        .one()
    )

    attempt = learning_service.start_attempt(db, student, target.id)
    learning_service.save_answer(db, student, attempt.id, written.id, "")
    learning_service.submit_attempt(db, student, attempt.id)

    submitted = db.get(Attempt, attempt.id).submitted_at
    week = weekly_report_service.monday_of(submitted.date())
    numbers = weekly_report_service._week_numbers(db, [student.id], week)
    assert numbers[student.id]["answered"] == 0


def test_a_pdf_does_not_count_where_the_platform_marks_the_answer_itself(db_session):
    """The same condition the child's screens use. A reviewer may put an
    upload box on an auto-marked question, and there a PDF with nothing typed
    still scores 0 -- so counting it for the parent would only move the
    disagreement from one screen to another rather than end it."""
    db = db_session
    w = _world(db, "PDFC")
    student = w["students"][0]
    auto_marked = w["qs"][0]  # a multiple-choice question the platform marks
    assert not upload_rule_service.teacher_marked(auto_marked)
    target = (
        db.query(AssignmentTarget)
        .filter_by(assignment_id=w["assignment"].id, student_id=student.id)
        .one()
    )

    attempt = learning_service.start_attempt(db, student, target.id)
    learning_service.save_answer(db, student, attempt.id, auto_marked.id, "")
    answer = (
        db.query(AttemptAnswer)
        .filter_by(attempt_id=attempt.id, question_id=auto_marked.id)
        .one()
    )
    _attach(db, student, answer)
    learning_service.submit_attempt(db, student, attempt.id)

    submitted = db.get(Attempt, attempt.id).submitted_at
    week = weekly_report_service.monday_of(submitted.date())
    numbers = weekly_report_service._week_numbers(db, [student.id], week)
    assert numbers[student.id]["answered"] == 0
