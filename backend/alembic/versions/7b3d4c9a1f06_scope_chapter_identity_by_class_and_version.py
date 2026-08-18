"""scope chapter identity by class (board_course) and curriculum version

Revision ID: 7b3d4c9a1f06
Revises: a1c7f0e93b52
Create Date: 2026-08-18 00:00:00.000000

Fixes a real latent bug found while designing year-to-year syllabus
versioning (Shailesh, 18 Aug 2026): Chapter was only unique on
(discipline_id, code), where discipline_id is subject-only ("Mathematics")
with no class in it at all. Real chapter numbering restarts at "CH01" every
class, so importing a second class's content (e.g. Class 6 Maths) would
have silently collided with Class 5 Maths' own "CH01" the moment it landed.

Adds two required columns to `chapters`:
  - board_course_id -- which class's offering of a board course (Board +
    ClassLevel + subject) a chapter belongs to. Backfills each existing
    chapter's board_course_id from course_discipline_maps, which must
    resolve to EXACTLY ONE board course per discipline to auto-backfill
    safely -- if a discipline is (or becomes, before this runs) linked to
    more than one board course, this migration refuses to guess and raises
    instead of silently picking one.
  - curriculum_version_id -- which syllabus edition/year a chapter belongs
    to (see CurriculumVersion, which existed in the schema since Phase 2
    but was never actually populated by the import pipeline). Backfills a
    single default PUBLISHED version per board ("2026-27") and assigns
    every existing chapter to it -- this is a reasonable placeholder label
    for "whatever was already live before versioning existed", not an
    authoritative claim about the real academic year; rename it in-place
    later if a different label is wanted, nothing depends on the code
    string itself.

New unique constraint uq_chapter_identity replaces uq_chapter_discipline_code:
(board_course_id, discipline_id, curriculum_version_id, code) -- the same
human-facing code can now safely coexist across different classes, subjects,
and syllabus editions, because each is a genuinely different row (with its
own permanent UUID) rather than a collision.

Existing SchoolCurriculumMap rows are untouched -- they reference chapter_id
(the permanent UUID), which never changes here.
"""
import uuid

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7b3d4c9a1f06'
down_revision = 'a1c7f0e93b52'
branch_labels = None
depends_on = None

_DEFAULT_VERSION_CODE = "2026-27"
_DEFAULT_VERSION_LABEL = "2026-27 (backfilled -- pre-existing content, rename freely)"
_DEFAULT_EFFECTIVE_FROM = "2026-04-01"


def upgrade() -> None:
    bind = op.get_bind()

    with op.batch_alter_table('chapters') as batch_op:
        batch_op.add_column(sa.Column('board_course_id', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('curriculum_version_id', sa.String(), nullable=True))

    meta = sa.MetaData()
    chapters = sa.Table('chapters', meta, autoload_with=bind)
    board_courses = sa.Table('board_courses', meta, autoload_with=bind)
    course_discipline_maps = sa.Table('course_discipline_maps', meta, autoload_with=bind)
    curriculum_versions = sa.Table('curriculum_versions', meta, autoload_with=bind)

    rows_to_backfill = bind.execute(
        sa.select(chapters.c.id, chapters.c.discipline_id).where(chapters.c.board_course_id.is_(None))
    ).fetchall()

    if rows_to_backfill:
        discipline_ids = {row.discipline_id for row in rows_to_backfill}
        discipline_to_board_course: dict[str, str] = {}
        for discipline_id in discipline_ids:
            candidates = bind.execute(
                sa.select(course_discipline_maps.c.board_course_id)
                .where(course_discipline_maps.c.discipline_id == discipline_id)
                .distinct()
            ).fetchall()
            if len(candidates) != 1:
                raise RuntimeError(
                    f"Cannot auto-backfill Chapter.board_course_id for discipline_id={discipline_id!r}: "
                    f"found {len(candidates)} candidate board course(s) via course_discipline_maps, need "
                    "exactly 1 to backfill safely. Resolve the ambiguity (or the missing mapping) and "
                    "backfill manually before re-running this migration."
                )
            discipline_to_board_course[discipline_id] = candidates[0].board_course_id

        board_course_to_board: dict[str, str] = {}
        for board_course_id in set(discipline_to_board_course.values()):
            board_row = bind.execute(
                sa.select(board_courses.c.board_id).where(board_courses.c.id == board_course_id)
            ).first()
            board_course_to_board[board_course_id] = board_row.board_id

        board_to_version: dict[str, str] = {}
        for board_id in set(board_course_to_board.values()):
            existing = bind.execute(
                sa.select(curriculum_versions.c.id).where(
                    curriculum_versions.c.board_id == board_id,
                    curriculum_versions.c.code == _DEFAULT_VERSION_CODE,
                )
            ).first()
            if existing:
                board_to_version[board_id] = existing.id
                continue
            new_id = str(uuid.uuid4())
            bind.execute(
                curriculum_versions.insert().values(
                    id=new_id,
                    board_id=board_id,
                    code=_DEFAULT_VERSION_CODE,
                    label=_DEFAULT_VERSION_LABEL,
                    status="PUBLISHED",
                    effective_from=_DEFAULT_EFFECTIVE_FROM,
                )
            )
            board_to_version[board_id] = new_id

        for row in rows_to_backfill:
            board_course_id = discipline_to_board_course[row.discipline_id]
            board_id = board_course_to_board[board_course_id]
            version_id = board_to_version[board_id]
            bind.execute(
                chapters.update()
                .where(chapters.c.id == row.id)
                .values(board_course_id=board_course_id, curriculum_version_id=version_id)
            )

    with op.batch_alter_table('chapters') as batch_op:
        batch_op.alter_column('board_course_id', existing_type=sa.String(), nullable=False)
        batch_op.alter_column('curriculum_version_id', existing_type=sa.String(), nullable=False)
        batch_op.drop_constraint('uq_chapter_discipline_code', type_='unique')
        batch_op.create_foreign_key(
            'fk_chapters_board_course_id', 'board_courses', ['board_course_id'], ['id'], ondelete='RESTRICT'
        )
        batch_op.create_foreign_key(
            'fk_chapters_curriculum_version_id', 'curriculum_versions', ['curriculum_version_id'], ['id'], ondelete='RESTRICT'
        )
        batch_op.create_unique_constraint(
            'uq_chapter_identity', ['board_course_id', 'discipline_id', 'curriculum_version_id', 'code']
        )
        batch_op.create_index('ix_chapters_board_course_id', ['board_course_id'])
        batch_op.create_index('ix_chapters_curriculum_version_id', ['curriculum_version_id'])


def downgrade() -> None:
    with op.batch_alter_table('chapters') as batch_op:
        batch_op.drop_index('ix_chapters_curriculum_version_id')
        batch_op.drop_index('ix_chapters_board_course_id')
        batch_op.drop_constraint('uq_chapter_identity', type_='unique')
        batch_op.drop_constraint('fk_chapters_curriculum_version_id', type_='foreignkey')
        batch_op.drop_constraint('fk_chapters_board_course_id', type_='foreignkey')
        batch_op.create_unique_constraint('uq_chapter_discipline_code', ['discipline_id', 'code'])
        batch_op.drop_column('curriculum_version_id')
        batch_op.drop_column('board_course_id')
