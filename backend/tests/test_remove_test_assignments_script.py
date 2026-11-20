"""scripts/remove_test_assignments.py (#247): removes the practice given to one
section of a test school with every attempt on it, and nothing else."""
import importlib
import sys

from app import database
from app.models import Assignment, AssignmentTarget, Attempt, AttemptAnswer, AuditLog, Evaluation, Question, Student
from app.services import learning_service
from tests import test_learning
from tests.test_learning import (
    _ac,
    _add_question,
    _make_chapter_with_skills,
    _make_school,
    _make_sectioned_student,
    _publish,
)

test_learning._CHAPTER_NUM.setdefault("RTA1", 35)


def _run(school_name, monkeypatch, apply=False, answer="YES"):
    monkeypatch.setattr(sys, "argv", ["remove_test_assignments", "--school", school_name, "--section", "A"] + (["--apply"] if apply else []))
    monkeypatch.setattr("builtins.input", lambda _prompt="": answer)
    return importlib.import_module("scripts.remove_test_assignments").main()


def test_report_only_then_remove_with_attempts(db_session, monkeypatch, capsys):
    db = db_session
    chapter, (skill1,) = _make_chapter_with_skills(db, "RTA1", n_skills=1)
    _add_question(db, skill1, "RTA1-P01-01", assignment_code=_ac("RTA1", "P01"))
    db.commit()
    [activity] = learning_service.generate_activities_for_chapter(db, chapter, created_by_user_id=None)
    _publish(db, activity)
    school = _make_school(db, "RTA1")
    student = _make_sectioned_student(db, school, "RTA1a", class_name="7", section="A")
    other = _make_sectioned_student(db, school, "RTA1b", class_name="7", section="B")
    db.commit()
    mine = learning_service.create_assignment(db, school=school, learning_activity=activity, assigned_by_user_id=None, class_name="7", section="A")
    theirs = learning_service.create_assignment(db, school=school, learning_activity=activity, assigned_by_user_id=None, class_name="7", section="B")
    db.commit()
    target = db.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == mine.id).one()
    attempt = learning_service.start_attempt(db, student, target.id)
    q = db.query(Question).filter(Question.code == "RTA1-P01-01").one()
    learning_service.save_answer(db, student, attempt.id, q.id, "A")
    learning_service.submit_attempt(db, student, attempt.id)
    db.commit()
    mine_id, theirs_id, attempt_id = mine.id, theirs.id, attempt.id
    student_id, other_id, question_id = student.id, other.id, q.id
    assert db.query(Attempt).filter(Attempt.id == attempt_id).count() == 1

    class _Keep:
        def __call__(self):
            return self
        def __getattr__(self, name):
            return getattr(db, name)
        def close(self):
            pass
    monkeypatch.setattr(database, "SessionLocal", _Keep())

    assert _run(school.name, monkeypatch) == 0
    assert "READ ONLY" in capsys.readouterr().out
    assert db.query(Assignment).filter(Assignment.id == mine_id).count() == 1

    assert _run(school.name, monkeypatch, apply=True, answer="no") == 0
    assert db.query(Assignment).filter(Assignment.id == mine_id).count() == 1

    assert _run(school.name, monkeypatch, apply=True) == 0
    assert "removed 1 assignments" in capsys.readouterr().out
    assert db.query(Assignment).filter(Assignment.id == mine_id).count() == 0
    assert db.query(Attempt).filter(Attempt.id == attempt_id).count() == 0
    assert db.query(AttemptAnswer).filter(AttemptAnswer.attempt_id == attempt_id).count() == 0
    assert db.query(Evaluation).filter(Evaluation.attempt_id == attempt_id).count() == 0
    # section B's practice, both students, the questions and the activity stay
    assert db.query(Assignment).filter(Assignment.id == theirs_id).count() == 1
    assert db.query(Student).filter(Student.id.in_([student_id, other_id])).count() == 2
    assert db.query(Question).filter(Question.id == question_id).count() == 1
    audit = db.query(AuditLog).filter(AuditLog.event_type == "school.test_assignments_removed").all()
    assert len(audit) == 1
    db.query(AuditLog).filter(AuditLog.event_type == "school.test_assignments_removed").delete()
    db.commit()
