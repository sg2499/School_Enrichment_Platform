"""add per-account login lockout columns

Revision ID: 9e2c4a7b1d3f
Revises: 7b3d4c9a1f06
Create Date: 2026-08-19 00:00:00.000000

2026-08-19 security hardening. The existing slowapi rate limit on
POST /auth/login is per-IP (5/minute) -- it does nothing against a
credential-stuffing attempt spread across many source IPs, or one aimed at
a single high-value account from a shared school network where blocking
the IP would also lock out legitimate users. This adds a per-account
counter and lockout window, checked/updated in auth_service.py's login().
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '9e2c4a7b1d3f'
down_revision = '7b3d4c9a1f06'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        batch_op.add_column(sa.Column('failed_login_attempts', sa.Integer(), nullable=False, server_default='0'))
        batch_op.add_column(sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        batch_op.drop_column('locked_until')
        batch_op.drop_column('failed_login_attempts')
