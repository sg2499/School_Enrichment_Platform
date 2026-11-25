"""A-016 on a real database: two requests at once must not give a child a
500 for pressing a button twice.

These run only against Postgres (TEST_DATABASE_URL), because SQLite
serialises writes and ignores row locks, so the race cannot happen there --
which is precisely why the suite never saw it (A-027). They skip otherwise,
so an ordinary run is unchanged.
"""
import os
import threading

import pytest

from app.database import Base
from app.models import Attempt, AttemptAnswer, Evaluation
from app.services import learning_service
from tests import test_learning
from tests.test_class_analytics import _world

test_learning._CHAPTER_NUM.update({"RACEA": 181, "RACEB": 182, "RACEC": 183})

pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL", "").startswith("postgresql"),
    reason="a race needs a real database; SQLite serialises writes and ignores row locks",
)


def _both(session_factory, fn):
    """Run fn in two sessions that start at the same moment."""
    results, barrier = [None, None], threading.Barrier(2)

    def run(i):
        db = session_factory()
        try:
            barrier.wait()
            results[i] = ("ok", fn(db))
        except Exception as e:  # noqa: BLE001 -- the whole point is what it is
            results[i] = ("error", f"{type(e).__name__}: {e}")
        finally:
            db.close()

    threads = [threading.Thread(target=run, args=(i,)) for i in (0, 1)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


@pytest.fixture()
def sessions(db_session):
    from tests.conftest import TestingSessionLocal

    Base.metadata.create_all(bind=db_session.get_bind())
    return TestingSessionLocal


def test_two_starts_at_once_give_one_attempt_and_no_error(db_session, sessions):
    w = _world(db_session, "RACEA")
    student = w["students"][0]
    target = w["targets"][0] if "targets" in w else None
    if target is None:
        from app.models import AssignmentTarget

        target = (
            db_session.query(AssignmentTarget)
            .filter_by(assignment_id=w["assignment"].id, student_id=student.id)
            .one()
        )
    db_session.commit()

    results = _both(sessions, lambda db: learning_service.start_attempt(db, db.get(type(student), student.id), target.id).id)

    assert [r[0] for r in results] == ["ok", "ok"], results
    assert results[0][1] == results[1][1], "both requests must land on the same attempt"
    assert db_session.query(Attempt).filter_by(assignment_target_id=target.id).count() == 1


def test_two_saves_of_one_question_keep_this_requests_answer(db_session, sessions):
    """The conflict branch in save_answer. Returning the winner's row would
    drop what this child just typed while the screen said saved, so the
    loser applies its own answer to the row the winner made."""
    from app.models import AssignmentTarget

    w = _world(db_session, "RACEB")
    student = w["students"][0]
    target = (
        db_session.query(AssignmentTarget)
        .filter_by(assignment_id=w["assignment"].id, student_id=student.id)
        .one()
    )
    attempt = learning_service.start_attempt(db_session, student, target.id)
    question_id = w["qs"][0].id
    db_session.commit()

    texts = iter(["first text", "second text"])
    results = _both(
        sessions,
        lambda db: learning_service.save_answer(
            db, db.get(type(student), student.id), attempt.id, question_id, next(texts)
        ).id,
    )

    assert [r[0] for r in results] == ["ok", "ok"], results
    db_session.expire_all()
    rows = (
        db_session.query(AttemptAnswer)
        .filter_by(attempt_id=attempt.id, question_id=question_id)
        .all()
    )
    assert len(rows) == 1, "the unique constraint must still hold"
    assert rows[0].response_text in {"first text", "second text"}


def test_two_submits_at_once_make_one_evaluation(db_session, sessions):
    """The lock in submit_attempt. Both requests must come back with the
    same evaluation, and there must be exactly one."""
    from app.models import AssignmentTarget

    w = _world(db_session, "RACEC")
    student = w["students"][1]
    target = (
        db_session.query(AssignmentTarget)
        .filter_by(assignment_id=w["assignment"].id, student_id=student.id)
        .one()
    )
    attempt = learning_service.start_attempt(db_session, student, target.id)
    learning_service.save_answer(db_session, student, attempt.id, w["qs"][0].id, "1")
    db_session.commit()

    results = _both(
        sessions,
        lambda db: learning_service.submit_attempt(db, db.get(type(student), student.id), attempt.id).id,
    )

    assert [r[0] for r in results] == ["ok", "ok"], results
    assert results[0][1] == results[1][1], "both requests must land on the same evaluation"
    assert db_session.query(Evaluation).filter_by(attempt_id=attempt.id).count() == 1
