"""The verification-residue delete. IRREVERSIBLE, so it is tested hard.

Two things this has to prove, neither of which an empty database can show:

  1. A delete takes the stored PDF bytes as well as the attachment row.
     `answer_attachments` has no foreign key to the bytes -- it carries a
     storage key -- so the cascade removes the row and leaves the file. A
     child's PDF would outlive every record of it.
  2. It touches ONLY its targets. Another child's assignment, attempt,
     answers and upload in the same school must be untouched.

Run on Postgres as well as SQLite where possible: A-027 showed the default
suite does not enforce foreign keys, so cascades do not fire under SQLite and
a delete can look like it worked when the database did nothing.
"""

import io

import pytest
from reportlab.pdfgen import canvas

from app.models import (
    AnswerAttachment,
    Assignment,
    AssignmentTarget,
    Attempt,
    AttemptAnswer,
    StoredFile,
)
from app.services import attachment_service, learning_service
from scripts.delete_test_data import collect
from tests.test_learning import _CHAPTER_NUM
from tests.test_practice_tracker import _CH

# Each world needs its own chapter number AND its own board-course code, or a
# second one in the same database trips the UNIQUE constraint on
# (board_id, class_level_id, code). The fixture hands out a fresh suffix per
# test rather than sharing one.
_SUFFIXES = [f"DEL{n}" for n in range(1, 9)]
for _n, _s in enumerate(_SUFFIXES, start=231):
    _CHAPTER_NUM[_s] = _n
    _CH[_s] = _n
_next_suffix = iter(_SUFFIXES)


def _pdf() -> bytes:
    out = io.BytesIO()
    pdf = canvas.Canvas(out)
    pdf.drawString(72, 720, "A child's working")
    pdf.showPage()
    pdf.save()
    return out.getvalue()


@pytest.fixture
def world(db_session):
    """Two children in one school, each with their own assignment, attempt,
    answers and uploaded PDF. One is the target; the other must survive."""
    from tests import test_class_analytics as ca

    db = db_session
    w = ca._world(db, next(_next_suffix))
    students = w["students"]
    assert len(students) >= 2, "need two children to prove the blast radius"

    targets = (
        db.query(AssignmentTarget)
        .filter(AssignmentTarget.assignment_id == w["assignment"].id)
        .all()
    )
    by_student = {t.student_id: t for t in targets}

    # The reviewer's choice wins over the wording, so set it rather than
    # hoping a generated stem happens to ask for working.
    written = next(q for q in w["qs"] if not q.auto_gradable)
    written.upload_rule = "OPTIONAL"
    db.commit()

    made = {}
    for label, student in (("target", students[0]), ("bystander", students[1])):
        target = by_student[student.id]
        attempt = learning_service.start_attempt(db, student, target.id)
        learning_service.save_answer(db, student, attempt.id, written.id, "Because.")
        attachment = attachment_service.attach_to_attempt(
            db, student, _user_of(db, student),
            attempt.id, written.id, "working.pdf", _pdf(),
        )
        made[label] = {
            "student": student,
            "target": target,
            "attempt": attempt,
            "attachment": attachment,
            "key": attachment.storage_key,
        }
    db.commit()
    return {"w": w, "made": made, "db": db}


def _user_of(db, student):
    from app.models import User

    return db.get(User, student.user_id)


def test_the_dry_run_reads_everything_and_writes_nothing(world):
    db = world["db"]
    assignment_id = world["w"]["assignment"].id

    plan = collect(db, [assignment_id])

    assert plan["counts"]["assignments"] == 1
    assert plan["counts"]["attempts"] >= 2
    assert plan["counts"]["attachments"] >= 2

    # The PDF bytes are IN the record, not just its metadata. Without them the
    # audit file is a receipt, not a way back.
    blobs = [
        answer["attachment"]["base64"]
        for a in plan["assignments"]
        for t in a["targets"]
        for att in t["attempts"]
        for answer in att["answers"]
        if answer["attachment"]
    ]
    assert blobs and all(b for b in blobs), "the audit record must hold the bytes"

    # Nothing was written.
    assert db.get(Assignment, assignment_id) is not None
    for made in world["made"].values():
        assert db.get(Attempt, made["attempt"].id) is not None
        assert db.get(StoredFile, made["key"]) is not None


def test_deleting_takes_the_stored_bytes_too(world):
    """The defect this guards: the row cascades, the file stays."""
    db = world["db"]
    target = world["made"]["target"]
    key = target["key"]

    assert db.get(StoredFile, key) is not None, "seeded file should exist"

    attachment = db.get(AnswerAttachment, target["attachment"].id)
    attachment_service._drop(db, attachment)
    db.flush()

    assert db.get(AnswerAttachment, target["attachment"].id) is None
    assert db.get(StoredFile, key) is None, (
        "the bytes must go with the row -- otherwise a child's PDF outlives "
        "every record of it"
    )


def test_the_shared_storage_key_guard_fires_on_a_row_outside_the_scope(world):
    """The guard protects a DIFFERENT child: if an attachment outside the
    delete's scope points at the same stored file, deleting those bytes would
    leave that row pointing at nothing.

    An earlier version of this test asserted the guard returned [] both before
    and after, so it never saw it fire and the name was a lie. This one builds
    a row genuinely outside the scope and watches it refuse.
    """
    from scripts.delete_test_data import _shared_storage_keys
    from tests import test_class_analytics as ca

    db = world["db"]
    assignment_id = world["w"]["assignment"].id
    plan = collect(db, [assignment_id])

    # Normal case: nothing shared, nothing refused.
    assert _shared_storage_keys(db, plan, [assignment_id]) == []

    # Now a second assignment, outside the scope, whose attachment points at
    # the same stored file. (Built directly: the product cannot produce it,
    # one file per answer being the rule.)
    other = ca._world(db, next(_next_suffix))
    other_student = other["students"][0]
    other_targets = (
        db.query(AssignmentTarget)
        .filter(AssignmentTarget.assignment_id == other["assignment"].id)
        .all()
    )
    written = next(q for q in other["qs"] if not q.auto_gradable)
    written.upload_rule = "OPTIONAL"
    db.commit()
    other_attempt = learning_service.start_attempt(db, other_student, other_targets[0].id)
    learning_service.save_answer(db, other_student, other_attempt.id, written.id, "Theirs.")
    outside = attachment_service.attach_to_attempt(
        db, other_student, _user_of(db, other_student), other_attempt.id, written.id,
        "theirs.pdf", _pdf(),
    )
    shared_key = world["made"]["target"]["key"]
    outside.storage_key = shared_key
    db.commit()

    refused = _shared_storage_keys(db, collect(db, [assignment_id]), [assignment_id])
    assert shared_key in refused, (
        "the guard must refuse a key another child's attachment still points at"
    )


def test_another_childs_work_in_the_same_school_is_untouched(db_session):
    """The blast radius. A second assignment, for a second child, in the same
    school, must survive the delete entirely -- rows and bytes."""
    from tests import test_class_analytics as ca

    db = db_session
    w = ca._world(db, next(_next_suffix))
    students = w["students"]
    targets = (
        db.query(AssignmentTarget)
        .filter(AssignmentTarget.assignment_id == w["assignment"].id)
        .all()
    )
    by_student = {t.student_id: t for t in targets}

    keep_student = students[1]
    keep_target = by_student[keep_student.id]
    keep_attempt = learning_service.start_attempt(db, keep_student, keep_target.id)
    written = next(q for q in w["qs"] if not q.auto_gradable)
    written.upload_rule = "OPTIONAL"
    db.commit()
    learning_service.save_answer(db, keep_student, keep_attempt.id, written.id, "Mine.")
    keep_attachment = attachment_service.attach_to_attempt(
        db, keep_student, _user_of(db, keep_student), keep_attempt.id, written.id,
        "mine.pdf", _pdf(),
    )
    keep_key = keep_attachment.storage_key
    keep_answer_ids = [
        a.id
        for a in db.query(AttemptAnswer).filter(AttemptAnswer.attempt_id == keep_attempt.id).all()
    ]
    db.commit()

    # A separate assignment for the FIRST child, which is what gets deleted.
    doomed = learning_service.create_assignment(
        db,
        school=w["school"],
        learning_activity=w["remediation"],
        assigned_by_user_id=w["teacher"].user_id,
        class_name="5",
        section="A",
    )
    db.commit()

    plan = collect(db, [doomed.id])
    assert plan["counts"]["assignments"] == 1

    db.delete(db.get(Assignment, doomed.id))
    db.flush()

    assert db.get(Assignment, doomed.id) is None
    # Everything of the other child's is still there.
    assert db.get(Attempt, keep_attempt.id) is not None
    assert db.get(AnswerAttachment, keep_attachment.id) is not None
    assert db.get(StoredFile, keep_key) is not None, "another child's PDF must survive"
    for answer_id in keep_answer_ids:
        assert db.get(AttemptAnswer, answer_id) is not None


def test_the_suggested_apply_command_carries_its_own_scope(world, capsys, monkeypatch):
    """The dry run prints a command to copy. If that line omits
    --assignments, copying it verbatim silently targets DEFAULT_TARGETS
    instead of what was just reported.

    That happened on 25 Nov: the suggested line dropped the scope, the
    operator copied it, and only the --expect guard stopped it -- because the
    defaults were already deleted so the counts came to 0. Had they still
    existed and matched, the wrong assignments would have gone while the
    command looked obedient.
    """
    import sys

    import scripts.delete_test_data as mod

    db = world["db"]
    assignment_id = world["w"]["assignment"].id

    monkeypatch.setattr(mod, "SessionLocal", lambda: db)
    monkeypatch.setattr(db, "close", lambda: None)
    monkeypatch.setattr(
        sys, "argv", ["delete_test_data.py", "--assignments", assignment_id]
    )

    code = mod.main()
    out = capsys.readouterr().out

    assert code == 0
    assert "Dry run" in out
    suggested = [line for line in out.splitlines() if "--apply" in line and "python" in line]
    assert suggested, f"no suggested command printed:\n{out}"
    line = suggested[0]
    assert "--assignments" in line, (
        f"the suggested command must carry its scope, or it targets the "
        f"defaults instead:\n{line}"
    )
    assert assignment_id in line, f"and the scope must be the ids reported:\n{line}"
    assert "--expect-attempts" in line and "--expect-answers" in line
