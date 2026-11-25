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
test_learning._CHAPTER_NUM.update({"PDFA": 171, "PDFB": 172, "PDFC": 173, "PDFD": 174})


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


# --- A-038: a database error must not carry the row into the logs ------------


def test_a_database_error_does_not_carry_the_row_into_the_logs():
    """A-038. Measured on Postgres 16 on 25 Nov 2026: `hide_parameters` on
    the engine hides SQLAlchemy's parameter list but NOT Postgres's own
    DETAIL line, which names the value. That message is what reaches the
    hosting logs and Sentry's issue title.

    The real message from a duplicate insert, with a child's email and a
    child's answer in it."""
    from app.core.error_handling import scrub_row_values

    message = (
        '(psycopg2.errors.UniqueViolation) duplicate key value violates '
        'unique constraint "uq_attempt_answer"\n'
        "DETAIL:  Key (email)=(child@school.test) already exists.\n\n"
        "[SQL: INSERT INTO attempt_answers (response_text) VALUES (%(response_text)s)]\n"
        "[parameters: {'response_text': '498 m'}]"
    )
    safe = scrub_row_values(message)

    assert "child@school.test" not in safe
    assert "498 m" not in safe
    assert "response_text" not in safe
    # What a person debugging actually needs is kept.
    assert "uq_attempt_answer" in safe
    assert "UniqueViolation" in safe


def test_the_scrubber_leaves_an_ordinary_message_alone():
    from app.core.error_handling import scrub_row_values

    assert scrub_row_values("ValueError: that chapter has no questions") == (
        "ValueError: that chapter has no questions"
    )
    assert scrub_row_values("") == ""


def test_a_detail_on_one_line_still_loses_its_value():
    from app.core.error_handling import scrub_row_values

    safe = scrub_row_values("UniqueViolation: Key (student_code)=(STU-ABCP-0001) already exists.")
    assert "STU-ABCP-0001" not in safe
    assert "student_code" in safe  # the column is useful; the child's code is not


def test_the_scrubber_keeps_the_whole_traceback():
    """The bug the first version of this had. A real database error is
    chained: the driver's error and its DETAIL line come first, the frames
    in OUR code come after. Matching to the end of the text deleted the
    second half, so the log said a unique constraint failed and never said
    where. Measured on Postgres 16: the app's own frame vanished."""
    from app.core.error_handling import scrub_row_values

    text = (
        "Traceback (most recent call last):\n"
        '  File "sqlalchemy/engine/base.py", line 1953, in _exec_single_context\n'
        "    self.dialect.do_execute(\n"
        "psycopg2.errors.UniqueViolation: duplicate key value violates "
        'unique constraint "uq_attempt_answer"\n'
        "DETAIL:  Key (email)=(child@school.test) already exists.\n"
        "\n"
        "The above exception was the direct cause of the following exception:\n"
        "\n"
        "Traceback (most recent call last):\n"
        '  File "app/services/learning_service.py", line 660, in save_answer\n'
        "    db.commit()\n"
        "[SQL: INSERT INTO attempt_answers (response_text)\n"
        " VALUES (%(response_text)s)]\n"
        "[parameters: {'response_text': '498 m'}]\n"
    )
    safe = scrub_row_values(text)

    # The values are gone...
    assert "child@school.test" not in safe
    assert "498 m" not in safe
    # ...and everything that makes the crash findable is not.
    assert "save_answer" in safe, "the frame in our own code must survive"
    assert "learning_service.py" in safe
    assert "The above exception was the direct cause" in safe
    assert "uq_attempt_answer" in safe
    # The multi-line [SQL: ...] block closes on its own line, so the line
    # after it is not swallowed with it.
    assert "VALUES" not in safe


def test_the_sentry_hook_scrubs_the_issue_title():
    """Sentry shows the exception's value as the issue title, and the
    EventScrubber works on field names and cannot see inside a string."""
    from app.main import _sentry_before_send

    event = {
        "exception": {
            "values": [
                {
                    "type": "IntegrityError",
                    "value": (
                        'duplicate key value violates unique constraint "uq_attempt_answer"\n'
                        "DETAIL:  Key (student_code)=(STU-ABCP-0001) already exists."
                    ),
                }
            ]
        },
        "request": {"data": {"password": "hunter2"}, "cookies": {"se_session": "abc"}},
    }
    out = _sentry_before_send(event, {})

    assert "STU-ABCP-0001" not in out["exception"]["values"][0]["value"]
    assert "uq_attempt_answer" in out["exception"]["values"][0]["value"]
    # The body and cookies it already stripped are still stripped.
    assert "data" not in out["request"] and "cookies" not in out["request"]


def test_a_pdf_answer_marked_wrong_is_not_called_blank_on_the_grid():
    """#271, the last surface. A child answered a written question with a
    PDF of their working and typed nothing; their teacher read it and marked
    it 0. The grid then showed "Left blank (0 of 3)" for it -- seen live on
    production on 25 Nov 2026 -- because cell_state judged the answer by its
    text, and a PDF answer has none.

    Blank and wrong are different things to say to a teacher about a child."""
    from app.services.analytics_service import cell_state

    # Nothing at all: still blank.
    assert cell_state(0, 3, None) == "BLANK"
    assert cell_state(0, 3, "   ") == "BLANK"
    # Answered on paper and marked 0: wrong, not blank.
    assert cell_state(0, 3, None, has_file=True) == "WRONG"
    # The rest of the states are unchanged.
    assert cell_state(0, 3, "nonsense") == "WRONG"
    assert cell_state(3, 3, "498 m") == "CORRECT"
    assert cell_state(1, 3, "498") == "PARTIAL"
    assert cell_state(None, 3, "498 m") == "PENDING"


def test_the_grid_itself_calls_a_marked_pdf_answer_wrong_not_blank(db_session):
    """#271 end to end, not just at the helper. The helper test above passes
    even if _answers never passes the flag through, which is exactly the
    mistake worth guarding: the defect was seen on the GRID, so the grid is
    what this asserts."""
    from app.models import AssignmentTarget
    from app.services import analytics_service

    db = db_session
    w = _world(db, "PDFD")
    student = w["students"][0]
    written = w["qs"][4]
    target = (
        db.query(AssignmentTarget)
        .filter_by(assignment_id=w["assignment"].id, student_id=student.id)
        .one()
    )

    attempt = learning_service.start_attempt(db, student, target.id)
    learning_service.save_answer(db, student, attempt.id, written.id, "")
    answer = (
        db.query(AttemptAnswer).filter_by(attempt_id=attempt.id, question_id=written.id).one()
    )
    _attach(db, student, answer)
    learning_service.submit_attempt(db, student, attempt.id)

    # The teacher reads the PDF and marks it 0 -- wrong, but answered.
    learning_service.apply_manual_grades(
        db, attempt=attempt, grades={written.id: 0}, grader_user_id=w["teacher"].user_id
    )
    db.commit()

    rows = analytics_service._answers(db, [w["assignment"].id])
    row = next(r for r in rows if r[1] == written.id and r[0] == student.id)
    assert analytics_service.cell_state(row[2], row[3], row[4], has_file=bool(row[7])) == "WRONG", (
        "the grid must not tell a teacher an answer they just marked was left blank"
    )
    # And the flag really came from the query, not from a default.
    assert row[7] is True
