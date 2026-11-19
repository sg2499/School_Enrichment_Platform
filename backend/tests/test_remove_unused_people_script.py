"""scripts/remove_unused_people.py (#242): removes a school's never-used teachers
and students so its setup can be uploaded again, and refuses once anyone has
used Krama."""
import importlib
import sys

from app.models import AuditLog, Student, Teacher, User
from tests.test_school_setup import _post, _world, _xlsx
from tests.test_learning import _login


def _setup(client, db_session, sx):
    school, admin, _course = _world(db_session, sx)
    headers = {**_login(client, admin.email), "x-auth-role": "ADMIN"}
    teachers = [("Neha Ban", "", "", "Mathematics", "5A")]
    students = [("Ananya Roy", 5, "A", 1), ("Kabir Mehta", 5, "A", 2)]
    r = _post(client, headers, "setup/import", _xlsx(teachers, students))
    assert r.status_code == 200, r.text
    # The test database is shared by the whole run: leave no import entry behind
    # for tests (test_school_setup) that count them.
    db_session.query(AuditLog).filter(AuditLog.event_type == "roster.school_setup_import").delete()
    db_session.commit()
    return school, admin


def _run(school_name, monkeypatch, apply=False, answer="YES", even_if_used=False):
    monkeypatch.setattr(
        sys,
        "argv",
        ["remove_unused_people", "--school", school_name] + (["--even-if-used"] if even_if_used else []) + (["--apply"] if apply else []),
    )
    monkeypatch.setattr("builtins.input", lambda _prompt="": answer)
    return importlib.import_module("scripts.remove_unused_people").main()


def test_report_only_then_remove(client, db_session, monkeypatch, capsys):

    school, admin = _setup(client, db_session, "RMV1")
    db = db_session
    assert db.query(Student).filter(Student.school_id == school.id).count() == 2

    from app import database

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
    assert db.query(Student).filter(Student.school_id == school.id).count() == 2

    assert _run(school.name, monkeypatch, apply=True, answer="no") == 0
    assert db.query(Student).filter(Student.school_id == school.id).count() == 2

    assert _run(school.name, monkeypatch, apply=True) == 0
    assert db.query(Student).filter(Student.school_id == school.id).count() == 0
    assert db.query(Teacher).filter(Teacher.school_id == school.id).count() == 0
    assert db.query(User).filter(User.id == admin.id).first() is not None   # admins are never touched
    assert db.query(AuditLog).filter(AuditLog.event_type == "school.unused_people_removed").count() >= 1


def test_nobody_is_removed_once_someone_has_used_krama(client, db_session, monkeypatch, capsys):
    from datetime import datetime, timezone

    from app import database

    school, _admin = _setup(client, db_session, "RMV2")
    db = db_session
    one = db.query(User).join(Student, Student.user_id == User.id).filter(Student.school_id == school.id).first()
    one.last_active_at = datetime.now(timezone.utc)
    db.commit()

    class _Keep:
        def __call__(self):
            return self
        def __getattr__(self, name):
            return getattr(db, name)
        def close(self):
            pass
    monkeypatch.setattr(database, "SessionLocal", _Keep())

    assert _run(school.name, monkeypatch, apply=True) == 1
    assert "have used Krama" in capsys.readouterr().out
    assert db.query(Student).filter(Student.school_id == school.id).count() == 2

    # A test school can be emptied anyway, only on request.
    assert _run(school.name, monkeypatch, apply=True, even_if_used=True) == 0
    assert db.query(Student).filter(Student.school_id == school.id).count() == 0
