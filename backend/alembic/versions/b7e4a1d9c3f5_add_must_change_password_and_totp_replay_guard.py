"""add must_change_password and totp_last_used_step columns

Revision ID: b7e4a1d9c3f5
Revises: f1a9c3e7b420
Create Date: 2026-09-30 00:00:00.000000

30 Sep 2026 security/DPDP review (see A6_SECURITY_DPDP_REVIEW.md, findings
A1 and A9):

- A1: admin-issued initial passwords are now random instead of a guessable
  firstname-lastname pattern, and this column is what forces the recipient
  to actually replace it (checked in dependencies.py's get_current_user(),
  currently gated to ADMIN/SUPER_ADMIN only -- see routes_roster.py). Every
  existing account defaults to False (nobody already logged in gets forced
  through this retroactively; only newly created accounts are ever created
  with it True).
- A9: 2FA verification previously had no memory of which TOTP step it last
  accepted, so the exact same 30-second code could be replayed. This column
  records the last step consumed per account.
"""
import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = 'b7e4a1d9c3f5'
down_revision = 'f1a9c3e7b420'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        batch_op.add_column(sa.Column('must_change_password', sa.Boolean(), nullable=False, server_default='false'))
        batch_op.add_column(sa.Column('totp_last_used_step', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        batch_op.drop_column('totp_last_used_step')
        batch_op.drop_column('must_change_password')
