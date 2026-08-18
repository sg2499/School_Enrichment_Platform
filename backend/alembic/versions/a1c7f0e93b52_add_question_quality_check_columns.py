"""add question quality-check columns

Revision ID: a1c7f0e93b52
Revises: cef118ee4f2f
Create Date: 2026-08-18 00:00:00.000000

Adds the free, automated quality-check result columns (18 Aug 2026,
app/services/question_quality_service.py): quality_status (UNCHECKED |
FLAGGED | VERIFIED | UNVERIFIED), quality_flags (JSON list of reasons,
only set when FLAGGED), quality_checked_at. Deliberately a separate axis
from the existing `status` column -- see the model's own comment.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a1c7f0e93b52'
down_revision = 'cef118ee4f2f'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('questions') as batch_op:
        batch_op.add_column(sa.Column('quality_status', sa.String(length=20), nullable=False, server_default='UNCHECKED'))
        batch_op.add_column(sa.Column('quality_flags', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('quality_checked_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('questions') as batch_op:
        batch_op.drop_column('quality_checked_at')
        batch_op.drop_column('quality_flags')
        batch_op.drop_column('quality_status')
