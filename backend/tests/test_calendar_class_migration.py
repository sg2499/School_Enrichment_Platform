"""The data migration that stores a calendar entry's class as its code
(alembic a4d7e2c9b130, 3 Oct 2026).

Run against a real SQLite file migrated with the real Alembic scripts, the
way test_totp_encryption.py tests its own data migration: the rows are put
in as the old map form stored them, at the revision before, and the
migration is then applied.
"""
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from alembic import command
from app.core import config
from app.models import (
    Board,
    BoardCourse,
    Chapter,
    ClassLevel,
    CurriculumVersion,
    Discipline,
    School,
    SchoolCurriculumMap,
    SubjectGroup,
)

BACKEND_DIR = Path(__file__).resolve().parents[1]
BEFORE = "f7c2a9d4e1b8"
AFTER = "a4d7e2c9b130"


@pytest.fixture()
def migrated_db(tmp_path, monkeypatch):
    db_url = f"sqlite:///{tmp_path / 'calendar_class_migration.db'}"
    monkeypatch.setattr(config, "DATABASE_URL", db_url)
    alembic_cfg = Config()
    alembic_cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    engine = create_engine(db_url)
    try:
        yield alembic_cfg, engine
    finally:
        engine.dispose()


def _seed(engine) -> dict[str, str]:
    """Two schools and three chapters, with calendar entries stored every way
    the old code could have left them. Returns each entry's id by a label."""
    Session = sessionmaker(bind=engine)
    with Session() as db:
        board = Board(code="CBSE", display_name="CBSE")
        level5 = ClassLevel(code="5", display_name="Class 5", display_order=5)
        level6 = ClassLevel(code="6", display_name="Class 6", display_order=6)
        group = SubjectGroup(code="SCIENCE", display_name="Science Group")
        db.add_all([board, level5, level6, group])
        db.flush()
        discipline = Discipline(code="MATHEMATICS", display_name="Mathematics", subject_group_id=group.id)
        course = BoardCourse(board_id=board.id, class_level_id=level5.id, code="CBSE-5-MATH", display_name="Mathematics", status="PUBLISHED")
        version = CurriculumVersion(board_id=board.id, code="CV1", label="2026-27", status="PUBLISHED")
        db.add_all([discipline, course, version])
        db.flush()
        chapters = []
        for n in (1, 2, 3):
            chapter = Chapter(
                discipline_id=discipline.id, board_course_id=course.id, curriculum_version_id=version.id,
                code=f"CH0{n}", chapter_no=n, title=f"Chapter {n}", status="PUBLISHED",
            )
            db.add(chapter)
            chapters.append(chapter)
        school_a = School(name="School A", board="CBSE", city="Bengaluru")
        school_b = School(name="School B", board="CBSE", city="Pune")
        db.add_all([school_a, school_b])
        db.flush()

        def entry(school, chapter, class_name, start=None):
            row = SchoolCurriculumMap(
                school_id=school.id, board_course_id=course.id, chapter_id=chapter.id,
                class_name=class_name, planned_start_date=start,
            )
            db.add(row)
            db.flush()
            return row.id

        ids = {
            # Saved from the form: the display name.
            "a_ch1_name": entry(school_a, chapters[0], "Class 5", start="2026-09-01"),
            # The same slot saved both ways: the two the old check let sit side by side.
            "a_ch2_name": entry(school_a, chapters[1], "class 5 "),
            "a_ch2_code": entry(school_a, chapters[1], "5", start="2026-10-01"),
            # Already right, a school's own label, and no class at all.
            "a_ch3_code": entry(school_a, chapters[2], "5"),
            "a_ch3_own": entry(school_a, chapters[2], "5 Bridge"),
            "b_ch1_none": entry(school_b, chapters[0], None),
            # Another school, another level's name.
            "b_ch2_name6": entry(school_b, chapters[1], "Class 6"),
        }
        db.commit()
    return ids


def _classes(engine) -> dict[str, str | None]:
    with engine.connect() as conn:
        return {row[0]: row[1] for row in conn.execute(text("SELECT id, class_name FROM school_curriculum_maps")).all()}


def test_entries_saved_as_a_display_name_become_the_code(migrated_db, capsys):
    alembic_cfg, engine = migrated_db
    command.upgrade(alembic_cfg, BEFORE)
    ids = _seed(engine)

    command.upgrade(alembic_cfg, AFTER)
    after = _classes(engine)

    # Rewritten to the code, nothing else about the entry touched.
    assert after[ids["a_ch1_name"]] == "5"
    assert after[ids["b_ch2_name6"]] == "6"
    with engine.connect() as conn:
        kept_start = conn.execute(
            text("SELECT planned_start_date FROM school_curriculum_maps WHERE id = :id"), {"id": ids["a_ch1_name"]}
        ).scalar_one()
    assert kept_start == "2026-09-01"

    # The pair that was one slot stored two ways is one entry again: the
    # code-stored one, which is the one teachers' screens were matching.
    assert ids["a_ch2_name"] not in after
    assert after[ids["a_ch2_code"]] == "5"

    # Left exactly as they were.
    assert after[ids["a_ch3_code"]] == "5"
    assert after[ids["a_ch3_own"]] == "5 Bridge"
    assert after[ids["b_ch1_none"]] is None

    # The build log gets counts, never names.
    printed = capsys.readouterr().out
    assert "2 rewritten, 1 duplicate(s) removed" in printed
    assert "School A" not in printed and "Chapter" not in printed


def test_running_it_again_changes_nothing(migrated_db):
    alembic_cfg, engine = migrated_db
    command.upgrade(alembic_cfg, BEFORE)
    _seed(engine)
    command.upgrade(alembic_cfg, AFTER)
    first = _classes(engine)

    command.downgrade(alembic_cfg, BEFORE)
    assert _classes(engine) == first  # downgrade leaves the codes in place
    command.upgrade(alembic_cfg, AFTER)
    assert _classes(engine) == first


def test_a_database_with_nothing_to_fix_migrates_cleanly(migrated_db):
    alembic_cfg, engine = migrated_db
    command.upgrade(alembic_cfg, AFTER)
    assert _classes(engine) == {}
