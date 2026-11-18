"""questions.repeat_of_id: a repeated question is flagged, not deleted (#234)

Revision ID: b4d8f1a6c293
Revises: a7c3e9d5b241
Create Date: 2026-11-18 16:00:00.000000

Adds one nullable column. Nothing existing changes: every question starts with
it empty, and nothing is flagged until the repeat scan is run. Downgrade
drops the column.
"""

import sqlalchemy as sa

from alembic import op

revision = "b4d8f1a6c293"
down_revision = "a7c3e9d5b241"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("questions", sa.Column("repeat_of_id", sa.String(), nullable=True))
    op.create_index("ix_questions_repeat_of_id", "questions", ["repeat_of_id"])


def downgrade() -> None:
    op.drop_index("ix_questions_repeat_of_id", table_name="questions")
    op.drop_column("questions", "repeat_of_id")
