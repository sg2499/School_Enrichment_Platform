"""add school logo

Revision ID: b2e6d9f4a202
Revises: a7c3e9f2d184
Create Date: 2026-10-26 20:00:00.000000

#202 (26 Oct 2026): a school's admin uploads the school's logo, shown to
the school's people in the app and printed on its weekly reports and report
cards. Two new nullable columns on schools; nothing else changes.
Downgrade drops them.
"""
import sqlalchemy as sa

from alembic import op

revision = "b2e6d9f4a202"
down_revision = "a7c3e9f2d184"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("schools", sa.Column("logo_data", sa.Text(), nullable=True))
    op.add_column("schools", sa.Column("logo_updated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("schools", "logo_updated_at")
    op.drop_column("schools", "logo_data")
