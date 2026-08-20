"""add teacher_section_assignments and students.class_level_id

Revision ID: f1a9c3e7b420
Revises: 8d3c4f5632ad
Create Date: 2026-08-20 15:00:00.000000

Phase 0 of the Practice Overview redesign (20 Aug 2026) -- see
app/models/teacher_assignment.py's module docstring for the full "why".

Two independent, purely additive changes:

1. New `teacher_section_assignments` table -- the (school, class_level,
   section, board_course) -> teacher record of who is currently, and who
   has historically been, the designated teacher for a subject in a
   section. `end_date IS NULL` means "currently active"; a transfer ends
   one row and starts a new one, never mutates teacher_id in place (see the
   model docstring for why).

2. `students.class_level_id`, nullable, FK to class_levels.id -- a
   normalized standard alongside the existing free-text `class_name`
   column, which is left completely untouched (still populated, still read
   by every existing query). Backfilled best-effort here by parsing the
   leading digit run out of each student's `class_name` (e.g. "5A" -> "5")
   and matching it against an existing class_levels.code; a class_name that
   doesn't parse, or whose implied standard has no class_levels row yet
   (ClassLevel rows are created on demand by curriculum import, per
   curriculum_import_service.py -- not every standard is guaranteed to
   exist), is simply left with class_level_id = NULL rather than guessed
   at. Nothing currently reads this column, so an incomplete backfill
   changes no existing behaviour; it exists for the teacher-assignment
   scoping work that starts consuming it next.
"""
import re

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f1a9c3e7b420'
down_revision = '8d3c4f5632ad'
branch_labels = None
depends_on = None

_LEADING_DIGITS = re.compile(r"^\s*(\d{1,2})")


def upgrade() -> None:
    op.create_table(
        'teacher_section_assignments',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('school_id', sa.String(), nullable=False),
        sa.Column('teacher_id', sa.String(), nullable=False),
        sa.Column('class_level_id', sa.String(), nullable=False),
        sa.Column('section', sa.String(length=50), nullable=False),
        sa.Column('board_course_id', sa.String(), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('created_by_user_id', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(['school_id'], ['schools.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['teacher_id'], ['teachers.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['class_level_id'], ['class_levels.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['board_course_id'], ['board_courses.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_tsa_school_class_section_course',
        'teacher_section_assignments',
        ['school_id', 'class_level_id', 'section', 'board_course_id'],
    )
    op.create_index(
        'ix_tsa_teacher_current', 'teacher_section_assignments', ['teacher_id', 'end_date']
    )
    op.create_index(
        op.f('ix_teacher_section_assignments_school_id'), 'teacher_section_assignments', ['school_id']
    )
    op.create_index(
        op.f('ix_teacher_section_assignments_teacher_id'), 'teacher_section_assignments', ['teacher_id']
    )
    op.create_index(
        op.f('ix_teacher_section_assignments_class_level_id'), 'teacher_section_assignments', ['class_level_id']
    )
    op.create_index(
        op.f('ix_teacher_section_assignments_board_course_id'), 'teacher_section_assignments', ['board_course_id']
    )

    with op.batch_alter_table('students') as batch_op:
        batch_op.add_column(sa.Column('class_level_id', sa.String(), nullable=True))

    bind = op.get_bind()
    meta = sa.MetaData()
    students = sa.Table('students', meta, autoload_with=bind)
    class_levels = sa.Table('class_levels', meta, autoload_with=bind)

    code_to_id = {
        row.code: row.id for row in bind.execute(sa.select(class_levels.c.id, class_levels.c.code)).fetchall()
    }

    if code_to_id:
        rows_to_backfill = bind.execute(
            sa.select(students.c.id, students.c.class_name).where(
                students.c.class_level_id.is_(None), students.c.class_name.isnot(None)
            )
        ).fetchall()
        for row in rows_to_backfill:
            match = _LEADING_DIGITS.match(row.class_name or "")
            if not match:
                continue
            class_level_id = code_to_id.get(match.group(1))
            if not class_level_id:
                continue
            bind.execute(
                students.update().where(students.c.id == row.id).values(class_level_id=class_level_id)
            )

    with op.batch_alter_table('students') as batch_op:
        batch_op.create_foreign_key(
            'fk_students_class_level_id', 'class_levels', ['class_level_id'], ['id'], ondelete='SET NULL'
        )
        batch_op.create_index('ix_students_class_level_id', ['class_level_id'])


def downgrade() -> None:
    with op.batch_alter_table('students') as batch_op:
        batch_op.drop_index('ix_students_class_level_id')
        batch_op.drop_constraint('fk_students_class_level_id', type_='foreignkey')
        batch_op.drop_column('class_level_id')

    op.drop_index(op.f('ix_teacher_section_assignments_board_course_id'), table_name='teacher_section_assignments')
    op.drop_index(op.f('ix_teacher_section_assignments_class_level_id'), table_name='teacher_section_assignments')
    op.drop_index(op.f('ix_teacher_section_assignments_teacher_id'), table_name='teacher_section_assignments')
    op.drop_index(op.f('ix_teacher_section_assignments_school_id'), table_name='teacher_section_assignments')
    op.drop_index('ix_tsa_teacher_current', table_name='teacher_section_assignments')
    op.drop_index('ix_tsa_school_class_section_course', table_name='teacher_section_assignments')
    op.drop_table('teacher_section_assignments')
