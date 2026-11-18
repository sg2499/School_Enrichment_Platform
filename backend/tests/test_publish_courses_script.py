"""scripts/publish_courses.py and flag_repeats.py (#234): a read-only run changes
nothing, --apply flags repeats, approves what the gate allows, publishes the
chapter and makes its sets, and a second run changes nothing more."""
import importlib
import sys

import pytest

from app.models import Board, BoardCourse, Chapter, ClassLevel, LearningActivity, Question
from tests.test_learning import _make_chapter_with_skills
from tests.test_repeats_and_day_sets import _q


@pytest.fixture
def script_db(db_session, monkeypatch):
    # The scripts open their own session; hand them the test one.
    from app import database

    class _Keep:
        def __call__(self):
            return self
        def __getattr__(self, name):
            return getattr(db_session, name)
        def close(self):
            pass
    monkeypatch.setattr(database, "SessionLocal", _Keep())
    return db_session


def _course(db, board_code, class_code, suffix):
    chapter, lessons = _make_chapter_with_skills(db, suffix)
    board = db.query(Board).filter(Board.code == board_code).first()
    if not board:
        board = Board(code=board_code, display_name=board_code)
        db.add(board)
    level = db.query(ClassLevel).filter(ClassLevel.code == class_code).first()
    if not level:
        level = ClassLevel(code=class_code, display_name=f"Class {class_code}", display_order=int(class_code))
        db.add(level)
    db.flush()
    course = db.get(BoardCourse, chapter.board_course_id)
    course.board_id, course.class_level_id = board.id, level.id
    chapter.status = "DRAFT"
    for lesson in lessons:
        lesson.status = "DRAFT"
    db.commit()
    return chapter, lessons


def _run(module, argv, monkeypatch):
    monkeypatch.setattr(sys, "argv", [module] + argv)
    mod = importlib.import_module(f"scripts.{module}")
    return mod.main()


def test_read_only_then_apply(script_db, monkeypatch, capsys):
    db = script_db
    chapter, (s1, s2) = _course(db, "CISCE", "7", "pub1")
    _q(db, s1, "P1-001", "What is 2 + 2?", assignment="L01-D1A")
    _q(db, s2, "P1-002", "What is 2 + 2?", assignment="L01-D1A")      # a repeat
    _q(db, s2, "P1-003", "What is 8 + 8?", answer="16", assignment="L01-D1A")
    db.commit()

    assert _run("publish_courses", ["--board", "CISCE", "--class-level", "7"], monkeypatch) == 0
    out = capsys.readouterr().out
    assert "READ ONLY" in out and "would approve" in out
    db.expire_all()
    assert db.query(Question).filter(Question.code.like("P1-%"), Question.status != "DRAFT").count() == 0
    assert db.query(Question).filter(Question.code.like("P1-%"), Question.repeat_of_id.isnot(None)).count() == 0
    assert db.get(Chapter, chapter.id).status == "DRAFT"

    assert _run("publish_courses", ["--board", "CISCE", "--class-level", "7", "--min-set-size", "0", "--apply", "--yes"], monkeypatch) == 0
    db.expire_all()
    by_code = {q.code: q for q in db.query(Question).filter(Question.code.like("P1-%")).all()}
    assert by_code["P1-002"].repeat_of_id == by_code["P1-001"].id and by_code["P1-002"].status == "DRAFT"
    assert by_code["P1-001"].status == "APPROVED" and by_code["P1-003"].status == "APPROVED"
    assert db.get(Chapter, chapter.id).status == "PUBLISHED"
    sets = db.query(LearningActivity).filter(LearningActivity.chapter_id == chapter.id).all()
    assert [(a.source_assignment_code, a.status) for a in sets] == [("L01-D1A", "PUBLISHED")]

    # Run again: nothing more is made. With the default minimum a 2-question set is kept as a draft.
    assert _run("publish_courses", ["--board", "CISCE", "--class-level", "7", "--apply", "--yes"], monkeypatch) == 0
    db.expire_all()
    sets = db.query(LearningActivity).filter(LearningActivity.chapter_id == chapter.id).all()
    assert [(a.source_assignment_code, a.status) for a in sets] == [("L01-D1A", "DRAFT")]


def test_other_boards_are_left_alone(script_db, monkeypatch):
    db = script_db
    chapter, (s1, _s2) = _course(db, "CBSE", "5", "pub2")
    _q(db, s1, "P2-001", "What is 1 + 1?", answer="2", assignment="CH01-P01")
    db.commit()
    assert _run("publish_courses", ["--apply", "--yes"], monkeypatch) == 0  # CBSE 5 is not in the default list
    db.expire_all()
    assert db.get(Chapter, chapter.id).status == "DRAFT"
    assert db.query(Question).filter(Question.code == "P2-001").one().status == "DRAFT"


def test_flag_repeats_script(script_db, monkeypatch, capsys):
    db = script_db
    chapter, (s1, _s2) = _course(db, "CISCE", "5", "pub3")
    _q(db, s1, "P3-001", "What is 2 + 2?")
    _q(db, s1, "P3-002", "What is 2 + 2?")
    db.commit()
    def mine():
        return db.query(Question).filter(Question.code.like("P3-%"), Question.repeat_of_id.isnot(None)).count()

    assert _run("flag_repeats", ["--board", "CISCE", "--class-level", "5"], monkeypatch) == 0
    assert "Nothing written" in capsys.readouterr().out
    db.expire_all()
    assert mine() == 0
    assert _run("flag_repeats", ["--board", "CISCE", "--class-level", "5", "--apply", "--yes"], monkeypatch) == 0
    db.expire_all()
    assert mine() == 1


def test_small_set_is_demoted_on_the_first_run_too(script_db, monkeypatch):
    # Production sessions have autoflush off. A set published a moment earlier in the
    # same run was invisible to the size check, so 161 small sets went live (18 Nov 2026).
    db = script_db
    db.autoflush = False
    try:
        chapter, (s1, s2) = _course(db, "CISCE", "7", "pub4")
        _q(db, s1, "P4-001", "What is 3 + 3?", answer="6", assignment="L01-D1A")
        _q(db, s2, "P4-003", "What is 5 + 5?", answer="10", assignment="L01-D1A")
        _q(db, s1, "P4-002", "What is 4 + 4?", answer="8", assignment="L01-D1A")
        db.commit()
        assert _run("publish_courses", ["--board", "CISCE", "--class-level", "7", "--apply", "--yes"], monkeypatch) == 0
        db.expire_all()
        sets = db.query(LearningActivity).filter(LearningActivity.chapter_id == chapter.id).all()
        assert [(a.source_assignment_code, a.status) for a in sets] == [("L01-D1A", "DRAFT")]
    finally:
        db.autoflush = True
