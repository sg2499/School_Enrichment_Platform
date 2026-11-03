"""add mock_paper_answers.review_note

Revision ID: b4c7e2a9d214
Revises: a2d5e8c1f210
Create Date: 2026-11-03 14:00:00.000000

#214 (3 Nov 2026): a teacher may now change a mark the platform gave on a
mock (Ashalatha: a teacher override "where a correct method is rejected
solely because an earlier value carried forward", and "for valid equivalent
work or a system exception"). The teacher says why, in a sentence the
student reads beside the mark. One nullable column; nothing existing
changes. Downgrade drops it.
"""

import sqlalchemy as sa

from alembic import op

revision = "b4c7e2a9d214"
down_revision = "a2d5e8c1f210"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("mock_paper_answers") as batch:
        batch.add_column(sa.Column("review_note", sa.String(length=300), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("mock_paper_answers") as batch:
        batch.drop_column("review_note")
