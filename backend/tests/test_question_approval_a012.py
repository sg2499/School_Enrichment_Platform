"""A-012: who approved a question, when, and by what route.

The finding's own test was *"ask the database which of the 28,430 approved
questions the academic owner has signed off"*, and nothing could answer it:
a question recorded only its status, the bulk approval's audit row carries
counts and not question ids, and the publish script's rows carry no user at
all.

Four columns answer it, written in one place
(`app/services/question_approval_service.py`). These tests pin two things:
every route that can approve a question says which route it was, and -- the
part that is a real behaviour change -- a batch approval can no longer
re-approve a question a person deliberately sent back for rework, which is
his decision of 23 Nov 2026 (#251, A-011 part 4) and was being undone by the
next publish run.
"""
from types import SimpleNamespace

import pytest

from app.api import routes_curriculum_admin as admin
from app.models import ConceptLesson
from app.services import pattern_engine, question_approval_service
from tests.test_curriculum_admin import (
    _add_question,
    _login,
    _make_chapter,
    _make_super_admin,
)


def _lesson(db, suffix):
    chapter, _ = _make_chapter(db, suffix)
    lesson = ConceptLesson(chapter_id=chapter.id, code=f"SKL-{suffix}", title=f"Skill {suffix}", status="DRAFT")
    db.add(lesson)
    db.commit()
    db.refresh(lesson)
    return lesson


def _good(db, lesson, code):
    """A question the quality checks clear, so bulk approval will take it."""
    return _add_question(db, lesson, code, stem="Round 4,236 to the nearest 10.", correct_answer="4240")


def _bulk(db, questions, *, user_id=None, source=question_approval_service.SOURCE_BULK):
    """The batch, called the way publish_courses.py calls it: no request, and
    an actor that is only an id."""
    return admin._bulk_approve_questions(
        db,
        questions,
        True,
        user=SimpleNamespace(id=user_id),
        request=None,
        scope={"via": "tests"},
        source=source,
    )


# --- the route is recorded ------------------------------------------------


def test_the_studio_records_the_person_and_the_route(client, db_session):
    """A-012's gap at its narrowest: a question approved by a person clicking
    Approve now says who, when, and that it came from the review screen."""
    lesson = _lesson(db_session, "a012sc")
    question = _good(db_session, lesson, "Q-A012SC")
    question.status = "SME_REVIEW"
    db_session.commit()

    user = _make_super_admin(db_session, "sa-a012sc@example.com")
    csrf = _login(client, "sa-a012sc@example.com")
    response = client.patch(
        f"/api/curriculum-admin/questions/{question.id}/status",
        json={"status": "APPROVED"},
        headers=csrf,
    )
    assert response.status_code == 200

    db_session.refresh(question)
    assert question.status == "APPROVED"
    assert question.approved_by_user_id == user.id
    assert question.approved_at is not None
    assert question.approval_source == question_approval_service.SOURCE_REVIEW_SCREEN


def test_a_script_run_records_the_route_it_cannot_record_a_person_for(db_session):
    """publish_courses.py runs with no signed-in user, deliberately. The
    source is what carries the fact the user id cannot."""
    lesson = _lesson(db_session, "a012ps")
    question = _good(db_session, lesson, "Q-A012PS")
    db_session.commit()

    _bulk(db_session, [question], source=question_approval_service.SOURCE_PUBLISH_SCRIPT)

    assert question.status == "APPROVED"
    assert question.approved_by_user_id is None
    assert question.approval_source == question_approval_service.SOURCE_PUBLISH_SCRIPT


def test_a_generated_question_says_its_pattern_approved_it(db_session):
    """A question made for one school's paper is approved because its PATTERN
    was approved -- nobody read this particular wording of it. It must never
    look like curriculum somebody signed off."""
    pattern = SimpleNamespace(
        id="pat-a012", code="PAT-A012", chapter_id="ch-a012", concept_lesson_id="skl-a012",
        version=1, difficulty=2, competency="Number",
    )
    made = pattern_engine.Made(
        seed="seed-a012",
        values={"a": 1},
        questions=[{
            "question_type": "Numeric Entry", "stem": "What is 2 + 2?",
            "option_a": None, "option_b": None, "option_c": None, "option_d": None,
            "correct_answer": "4", "accepted_variants": None, "hint": None,
            "explanation": None, "marks": 1, "auto_gradable": True,
            "response_format": None, "teacher_note": None, "answer_unit": None,
            "unit_rule": None, "mistakes": None,
        }],
        stimulus=None,
        misconception=None,
    )

    (question, _record), = pattern_engine.build_rows(
        pattern, made, school_id="sch-a012", student_id=None
    )

    assert question.status == "APPROVED"
    assert question.approval_source == question_approval_service.SOURCE_PATTERN
    assert question.approved_by_user_id is None


# --- a sign-off is the only thing that overwrites a stamp -----------------


def test_an_import_re_run_cannot_overwrite_a_sign_off(db_session):
    """The importer rewrites a live question's fields wholesale (A-035). It
    must not turn the academic owner's sign-off into "IMPORT" on the way
    past."""
    lesson = _lesson(db_session, "a012so")
    question = _good(db_session, lesson, "Q-A012SO")
    db_session.commit()

    question_approval_service.approve(
        question, to_status="APPROVED", user_id="ash", source=question_approval_service.SOURCE_SIGN_OFF
    )
    question_approval_service.approve(
        question, to_status="APPROVED", user_id=None, source=question_approval_service.SOURCE_IMPORT
    )

    assert question.approval_source == question_approval_service.SOURCE_SIGN_OFF
    assert question.approved_by_user_id == "ash"


def test_a_sign_off_does_overwrite_an_in_app_approval(db_session):
    """The other direction, because it is the whole point of the finding: her
    reading the question is the more important of the two facts."""
    lesson = _lesson(db_session, "a012sb")
    question = _good(db_session, lesson, "Q-A012SB")
    db_session.commit()

    question_approval_service.approve(
        question, to_status="APPROVED", user_id="someone", source=question_approval_service.SOURCE_BULK
    )
    question_approval_service.approve(
        question, to_status="APPROVED", user_id="ash", source=question_approval_service.SOURCE_SIGN_OFF
    )

    assert question.approval_source == question_approval_service.SOURCE_SIGN_OFF


def test_approve_refuses_a_status_that_is_not_an_approval(db_session):
    lesson = _lesson(db_session, "a012rf")
    question = _good(db_session, lesson, "Q-A012RF")
    db_session.commit()

    with pytest.raises(ValueError):
        question_approval_service.approve(
            question, to_status="DRAFT", user_id=None, source=question_approval_service.SOURCE_BULK
        )
    with pytest.raises(ValueError):
        question_approval_service.approve(
            question, to_status="APPROVED", user_id=None, source="MADE_UP"
        )


# --- the behaviour change: a send-back stands -----------------------------


def test_a_send_back_is_stamped(client, db_session):
    lesson = _lesson(db_session, "a012sk")
    question = _good(db_session, lesson, "Q-A012SK")
    question.status = "APPROVED"
    db_session.commit()

    _make_super_admin(db_session, "sa-a012sk@example.com")
    csrf = _login(client, "sa-a012sk@example.com")
    response = client.patch(
        f"/api/curriculum-admin/questions/{question.id}/status",
        json={"status": "SME_REVIEW"},
        headers=csrf,
    )
    assert response.status_code == 200

    db_session.refresh(question)
    assert question_approval_service.is_sent_back(question)


def test_a_batch_will_not_re_approve_a_question_a_person_sent_back(db_session):
    """The defect. A-011 part 4 says only a human send-back pulls a question
    from a live set -- and the next publish run was putting it straight
    back, with nothing in the audit row naming it."""
    lesson = _lesson(db_session, "a012bk")
    question = _good(db_session, lesson, "Q-A012BK")
    question.status = "APPROVED"
    db_session.commit()

    question_approval_service.send_back(question)
    question.status = "SME_REVIEW"
    db_session.commit()

    counts = _bulk(db_session, [question])

    assert question.status == "SME_REVIEW", "a batch must not undo a person's send-back"
    assert counts["skippedSentBackCount"] == 1
    assert counts["approvedCount"] == 0


def test_a_question_approved_before_the_columns_existed_is_still_protected(db_session):
    """Every one of the 28,430 questions approved before this change has an
    empty approval stamp, so the rule cannot be "it was approved once and is
    now in review" -- that would never fire for any question live today."""
    lesson = _lesson(db_session, "a012old")
    question = _good(db_session, lesson, "Q-A012OLD")
    question.status = "APPROVED"
    question.approved_at = None
    question.approved_by_user_id = None
    question.approval_source = None
    db_session.commit()

    question_approval_service.send_back(question)
    question.status = "SME_REVIEW"
    db_session.commit()

    counts = _bulk(db_session, [question])

    assert question.status == "SME_REVIEW"
    assert counts["skippedSentBackCount"] == 1


def test_sent_back_then_moved_to_draft_is_still_skipped(db_session):
    """SME_REVIEW -> DRAFT is an allowed transition, and the batch walks DRAFT
    straight through SME_REVIEW to APPROVED -- so a status test would have
    been dodged by one more click."""
    lesson = _lesson(db_session, "a012dr")
    question = _good(db_session, lesson, "Q-A012DR")
    question.status = "APPROVED"
    db_session.commit()

    question_approval_service.send_back(question)
    question.status = "DRAFT"
    db_session.commit()

    counts = _bulk(db_session, [question])

    assert question.status == "DRAFT"
    assert counts["skippedSentBackCount"] == 1


def test_in_review_without_a_send_back_is_still_approved(db_session):
    """Nothing is stranded. A workbook's Status column can say "SME Review"
    (`curriculum_import_service.STATUS_MAP`), and an earlier partial run can
    leave a question there, so sitting at SME_REVIEW is not evidence that a
    person rejected anything."""
    lesson = _lesson(db_session, "a012im")
    question = _good(db_session, lesson, "Q-A012IM")
    question.status = "SME_REVIEW"
    db_session.commit()
    assert question.sent_back_at is None

    counts = _bulk(db_session, [question])

    assert question.status == "APPROVED"
    assert counts["skippedSentBackCount"] == 0
    assert counts["approvedCount"] == 1


def test_approving_in_the_studio_clears_the_send_back(client, db_session):
    """The way back. A question stamped by the migration, or really sent
    back and then reworked, returns by one click -- and only by that click."""
    lesson = _lesson(db_session, "a012cl")
    question = _good(db_session, lesson, "Q-A012CL")
    question.status = "SME_REVIEW"
    question_approval_service.send_back(question)
    db_session.commit()

    _make_super_admin(db_session, "sa-a012cl@example.com")
    csrf = _login(client, "sa-a012cl@example.com")
    response = client.patch(
        f"/api/curriculum-admin/questions/{question.id}/status",
        json={"status": "APPROVED"},
        headers=csrf,
    )
    assert response.status_code == 200

    db_session.refresh(question)
    assert question.status == "APPROVED"
    assert question.sent_back_at is None
    assert question.approval_source == question_approval_service.SOURCE_REVIEW_SCREEN

    counts = _bulk(db_session, [question])
    assert counts["skippedSentBackCount"] == 0


def test_publishing_an_approved_question_is_not_a_second_approval(client, db_session):
    """A question approved before these columns existed has an empty stamp.
    Publishing it in the studio must not fill that in with the publisher's
    name -- they published it, they did not approve it."""
    lesson = _lesson(db_session, "a012pb")
    question = _good(db_session, lesson, "Q-A012PB")
    question.status = "APPROVED"
    question.approval_source = None
    question.approved_at = None
    db_session.commit()

    _make_super_admin(db_session, "sa-a012pb@example.com")
    csrf = _login(client, "sa-a012pb@example.com")
    response = client.patch(
        f"/api/curriculum-admin/questions/{question.id}/status",
        json={"status": "PUBLISHED"},
        headers=csrf,
    )
    assert response.status_code == 200

    db_session.refresh(question)
    assert question.status == "PUBLISHED"
    assert question.approval_source is None
    assert question.approved_at is None


def test_only_the_studio_and_a_sign_off_can_bring_back_a_sent_back_question(db_session):
    """The backstop inside the service, which covers the routes that have no
    count of their own: the workbook importer and the content-edit script."""
    lesson = _lesson(db_session, "a012bs")
    question = _good(db_session, lesson, "Q-A012BS")
    question.status = "SME_REVIEW"
    question_approval_service.send_back(question)
    db_session.commit()

    for source in (
        question_approval_service.SOURCE_BULK,
        question_approval_service.SOURCE_PUBLISH_SCRIPT,
        question_approval_service.SOURCE_IMPORT,
        question_approval_service.SOURCE_CONTENT_EDIT,
        question_approval_service.SOURCE_PATTERN,
    ):
        changed = question_approval_service.approve(
            question, to_status="APPROVED", user_id=None, source=source
        )
        assert changed is False, source
        assert question.status == "SME_REVIEW", source
        assert question_approval_service.is_sent_back(question), source

    assert question_approval_service.approve(
        question, to_status="APPROVED", user_id="ash",
        source=question_approval_service.SOURCE_SIGN_OFF,
    )
    assert question.status == "APPROVED"
    assert question.sent_back_at is None
