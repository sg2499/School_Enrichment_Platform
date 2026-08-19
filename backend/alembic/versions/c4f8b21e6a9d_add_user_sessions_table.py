"""add user_sessions table

Revision ID: c4f8b21e6a9d
Revises: 9e2c4a7b1d3f
Create Date: 2026-08-19 00:00:00.000000

2026-08-19 security hardening, session hygiene. Backs the new "where am I
logged in" / per-device sign-out feature on the Security Settings page --
one row per login, keyed by the JWT's new "sid" claim (see
core/security.py's create_access_token and dependencies.py's
get_current_user). See app/models/models.py's UserSession docstring for the
full rationale.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c4f8b21e6a9d'
down_revision = '9e2c4a7b1d3f'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'user_sessions',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('ip_address', sa.String(length=100), nullable=True),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('user_sessions') as batch_op:
        batch_op.create_index('ix_user_sessions_user_id', ['user_id'])


def downgrade() -> None:
    with op.batch_alter_table('user_sessions') as batch_op:
        batch_op.drop_index('ix_user_sessions_user_id')
    op.drop_table('user_sessions')
