"""add students.roll_number

Revision ID: a2d5e8c1f210
Revises: f3a8c6e2d166
Create Date: 2026-10-29 12:30:00.000000

#210 (29 Oct 2026; PHASE8_SCHOOL_SETUP_DESIGN.md): the school setup sheet
carries each student's roll number, so lists and sign-in slips come in the
order a class teacher reads them. One nullable column; nothing existing
changes. Downgrade drops it.
"""

import sqlalchemy as sa

from alembic import op

revision = "a2d5e8c1f210"
down_revision = "f3a8c6e2d166"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("students") as batch:
        batch.add_column(sa.Column("roll_number", sa.String(length=20), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("students") as batch:
        batch.drop_column("roll_number")
