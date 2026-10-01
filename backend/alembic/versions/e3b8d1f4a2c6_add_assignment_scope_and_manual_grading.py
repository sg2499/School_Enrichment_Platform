"""add assignment section scope and manual grading columns

Revision ID: e3b8d1f4a2c6
Revises: b7e4a1d9c3f5
Create Date: 2026-10-01 00:00:00.000000

Practice Tracker redesign + manual grading (1 Oct 2026). Three groups of
purely additive, nullable columns -- nothing existing is renamed, dropped or
re-typed, and every existing query keeps working unchanged.

1. assignments.section / class_level_id / board_course_id -- the
   (class_level, section, board_course) an assignment was set for. See
   Assignment's model comment for why: the section a teacher picked was
   never stored, so neither teacher_assignment_service.teacher_may_read_record
   (keyed on exactly that triple) nor a paginated, section-filtered tracker
   query could be answered from the row itself.

   Backfill, best-effort and conservative -- a value is only written when
   the existing data pins it down unambiguously, otherwise it stays NULL
   (NULL = "not section-scoped", which practice_access_service treats as
   "visible to its creator and to admins only", i.e. exactly today's
   behaviour):
     - board_course_id: always derivable, from the activity's chapter
       (chapters.board_course_id is NOT NULL).
     - class_level_id: class_name's leading digit run matched against an
       existing class_levels.code -- the same rule f1a9c3e7b420 used to
       backfill students.class_level_id.
     - section: only for a class-wide assignment (class_name set) whose
       target students ALL share one non-blank section. Every teacher
       assignment created since the 30 Sep 2026 section picker targets
       exactly one section, so this recovers those precisely; an older
       whole-class assignment that reached several sections stays NULL.
       Single-student assignments (class_name NULL, Foundation Repair) are
       never given a section here.

2. attempt_answers.manual_score / graded_by_user_id / graded_at -- a
   teacher's mark for an answer auto-marking left unscored.

3. evaluations.teacher_score / finalised_by_user_id / finalised_at, plus an
   index on review_status for the Needs Review queue.
"""
import re

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = 'e3b8d1f4a2c6'
down_revision = 'b7e4a1d9c3f5'
branch_labels = None
depends_on = None

_LEADING_DIGITS = re.compile(r"^\s*(\d{1,2})")


def _backfill_assignment_scope(bind) -> None:
    meta = sa.MetaData()
    assignments = sa.Table('assignments', meta, autoload_with=bind)
    activities = sa.Table('learning_activities', meta, autoload_with=bind)
    chapters = sa.Table('chapters', meta, autoload_with=bind)
    class_levels = sa.Table('class_levels', meta, autoload_with=bind)
    targets = sa.Table('assignment_targets', meta, autoload_with=bind)
    students = sa.Table('students', meta, autoload_with=bind)

    code_to_class_level_id = {
        row.code: row.id for row in bind.execute(sa.select(class_levels.c.id, class_levels.c.code)).fetchall()
    }

    rows = bind.execute(
        sa.select(assignments.c.id, assignments.c.class_name, chapters.c.board_course_id)
        .select_from(
            assignments.join(activities, assignments.c.learning_activity_id == activities.c.id).join(
                chapters, activities.c.chapter_id == chapters.c.id
            )
        )
    ).fetchall()

    for row in rows:
        values = {'board_course_id': row.board_course_id}
        if row.class_name:
            match = _LEADING_DIGITS.match(row.class_name)
            if match and match.group(1) in code_to_class_level_id:
                values['class_level_id'] = code_to_class_level_id[match.group(1)]
            sections = {
                (r.section or '').strip()
                for r in bind.execute(
                    sa.select(students.c.section)
                    .select_from(targets.join(students, targets.c.student_id == students.c.id))
                    .where(targets.c.assignment_id == row.id)
                ).fetchall()
            }
            if len(sections) == 1:
                (only_section,) = sections
                if only_section:
                    values['section'] = only_section
        bind.execute(assignments.update().where(assignments.c.id == row.id).values(**values))


def upgrade() -> None:
    with op.batch_alter_table('assignments') as batch_op:
        batch_op.add_column(sa.Column('section', sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column('class_level_id', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('board_course_id', sa.String(), nullable=True))

    _backfill_assignment_scope(op.get_bind())

    with op.batch_alter_table('assignments') as batch_op:
        batch_op.create_foreign_key(
            'fk_assignments_class_level_id', 'class_levels', ['class_level_id'], ['id'], ondelete='SET NULL'
        )
        batch_op.create_foreign_key(
            'fk_assignments_board_course_id', 'board_courses', ['board_course_id'], ['id'], ondelete='SET NULL'
        )
        batch_op.create_index('ix_assignments_scope', ['school_id', 'class_level_id', 'section', 'board_course_id'])
        batch_op.create_index('ix_assignments_school_created', ['school_id', 'created_at'])

    with op.batch_alter_table('attempt_answers') as batch_op:
        batch_op.add_column(sa.Column('manual_score', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('graded_by_user_id', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('graded_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.create_foreign_key(
            'fk_attempt_answers_graded_by_user_id', 'users', ['graded_by_user_id'], ['id'], ondelete='SET NULL'
        )

    with op.batch_alter_table('evaluations') as batch_op:
        batch_op.add_column(sa.Column('teacher_score', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('finalised_by_user_id', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('finalised_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.create_foreign_key(
            'fk_evaluations_finalised_by_user_id', 'users', ['finalised_by_user_id'], ['id'], ondelete='SET NULL'
        )
        batch_op.create_index('ix_evaluations_review_status', ['review_status'])


def downgrade() -> None:
    with op.batch_alter_table('evaluations') as batch_op:
        batch_op.drop_index('ix_evaluations_review_status')
        batch_op.drop_constraint('fk_evaluations_finalised_by_user_id', type_='foreignkey')
        batch_op.drop_column('finalised_at')
        batch_op.drop_column('finalised_by_user_id')
        batch_op.drop_column('teacher_score')

    with op.batch_alter_table('attempt_answers') as batch_op:
        batch_op.drop_constraint('fk_attempt_answers_graded_by_user_id', type_='foreignkey')
        batch_op.drop_column('graded_at')
        batch_op.drop_column('graded_by_user_id')
        batch_op.drop_column('manual_score')

    with op.batch_alter_table('assignments') as batch_op:
        batch_op.drop_index('ix_assignments_school_created')
        batch_op.drop_index('ix_assignments_scope')
        batch_op.drop_constraint('fk_assignments_board_course_id', type_='foreignkey')
        batch_op.drop_constraint('fk_assignments_class_level_id', type_='foreignkey')
        batch_op.drop_column('board_course_id')
        batch_op.drop_column('class_level_id')
        batch_op.drop_column('section')
