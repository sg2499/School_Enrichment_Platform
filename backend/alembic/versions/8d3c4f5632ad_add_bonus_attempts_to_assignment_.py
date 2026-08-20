"""add bonus_attempts to assignment_targets

Revision ID: 8d3c4f5632ad
Revises: 1c1e826a3e7d
Create Date: 2026-08-20 12:30:00.000000

20 Aug 2026, teacher reattempt-approval surface. start_attempt's own error
message ("Ask your teacher for an additional attempt") already implied this
was coming -- this adds the per-student counter it needs. Deliberately on
AssignmentTarget (one student's row), not Assignment (shared by every
student targeted by it), so a teacher approving one student's re-attempt
never raises the limit for the rest of the class.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '8d3c4f5632ad'
down_revision = '1c1e826a3e7d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('assignment_targets') as batch_op:
        batch_op.add_column(sa.Column('bonus_attempts', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    with op.batch_alter_table('assignment_targets') as batch_op:
        batch_op.drop_column('bonus_attempts')
