"""widen question response_format

Revision ID: cef118ee4f2f
Revises: 79da5c54ff2a
Create Date: 2026-08-19 00:00:00.000000

Found while loading the real Class 5 Maths content into production (18 Aug
2026, task #26 follow-up): the first real Postgres write hit
StringDataRightTruncation on questions.response_format -- VARCHAR(50) was
too tight for real content (longest real value seen is 67 chars, e.g.
"Mixed-unit length, ordered list, comparison sign or short statement").
SQLite (local dev/tests) silently ignores VARCHAR length limits, which is
why this never surfaced until the first real write against a real
Postgres instance. Widened to 255 for real headroom rather than the bare
minimum.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'cef118ee4f2f'
down_revision = '79da5c54ff2a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # batch_alter_table (not a bare op.alter_column) is required for this to
    # work on both dialects: SQLite has no ALTER COLUMN ... TYPE support at
    # all (it errors with a syntax error), so Alembic's batch mode
    # transparently does the create-new-table-copy-data-swap dance for it;
    # on Postgres (production) batch mode is equivalent to a plain ALTER
    # COLUMN. Verified against a from-scratch `alembic upgrade head` run on
    # SQLite before shipping this.
    with op.batch_alter_table('questions') as batch_op:
        batch_op.alter_column(
            'response_format',
            existing_type=sa.String(length=50),
            type_=sa.String(length=255),
            existing_nullable=True,
        )


def downgrade() -> None:
    with op.batch_alter_table('questions') as batch_op:
        batch_op.alter_column(
            'response_format',
            existing_type=sa.String(length=255),
            type_=sa.String(length=50),
            existing_nullable=True,
        )
