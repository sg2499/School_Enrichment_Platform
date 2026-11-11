"""add questions.figure

Revision ID: c8d3f1a5e218
Revises: b4c7e2a9d214
Create Date: 2026-11-11 12:00:00.000000

#218 (11 Nov 2026): pictures in questions. Ashalatha's review of 10 Nov
asked for fixed drawings (mirror lines on a simple grid, block letters,
map symbols) where words or a device's font could change what a child
sees; Shailesh chose to add them. A question's figure is a small JSON
description that app/services/figures.py checks and draws as SVG. One
nullable column; nothing existing changes. Downgrade drops it.
"""

import sqlalchemy as sa

from alembic import op

revision = "c8d3f1a5e218"
down_revision = "b4c7e2a9d214"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("questions") as batch:
        batch.add_column(sa.Column("figure", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("questions") as batch:
        batch.drop_column("figure")
