"""drop section from school_curriculum_maps

Revision ID: d8a3f6c1b2e7
Revises: c4f8b21e6a9d
Create Date: 2026-08-19 00:00:00.000000

19 Aug 2026, Shailesh: "there can be n number of sections for a class in a
school -- all will follow the same syllabus no matter what." Section never
changed which chapter applies, only let the same chapter be mapped multiple
times with different dates/teacher per section -- exactly the kind of
per-section drift that isn't wanted. A mapping is now one schedule per
class, full stop. The real fix for schedules slipping (holidays, elections,
festivals, health closures, etc.) isn't a finer-grained key, it's a proper
edit path -- see the new PATCH /school-curriculum-maps/{id} endpoint
(routes_curriculum_admin.py) added alongside this migration, which lets an
admin push a mapping's dates without deleting and recreating it.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd8a3f6c1b2e7'
down_revision = 'c4f8b21e6a9d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('school_curriculum_maps') as batch_op:
        batch_op.drop_constraint('uq_school_curriculum_map_slot', type_='unique')
        batch_op.drop_column('section')
        batch_op.create_unique_constraint(
            'uq_school_curriculum_map_slot', ['school_id', 'chapter_id', 'class_name']
        )


def downgrade() -> None:
    with op.batch_alter_table('school_curriculum_maps') as batch_op:
        batch_op.drop_constraint('uq_school_curriculum_map_slot', type_='unique')
        batch_op.add_column(sa.Column('section', sa.String(length=50), nullable=True))
        batch_op.create_unique_constraint(
            'uq_school_curriculum_map_slot', ['school_id', 'chapter_id', 'class_name', 'section']
        )
