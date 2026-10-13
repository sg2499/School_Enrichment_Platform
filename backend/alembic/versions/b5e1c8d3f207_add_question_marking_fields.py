"""add marking fields for measured answers

Revision ID: b5e1c8d3f207
Revises: a4d7e2c9b130
Create Date: 2026-10-13 12:00:00.000000

Phase 4, PR 1 (#164, 13 Oct 2026): units, tolerance and rounding for
Numeric Entry answers (design: PHASE4_UNITS_DESIGN.md).

Adds six optional columns to questions and one to attempt_answers. Every
new questions column is empty (allow_unit_conversion false) on existing
rows, which the marking code reads as "mark exactly as before"; no row's
data is changed. A question's unit rule, when empty, is worked out from its
Response Format at marking time (learning_service.marking_rule), so the
questions already worded "unit stated in question" need no backfill.

Downgrade drops the columns. Nothing outside them reads them.
"""
import sqlalchemy as sa

from alembic import op

revision = "b5e1c8d3f207"
down_revision = "a4d7e2c9b130"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("questions") as batch:
        batch.add_column(sa.Column("answer_unit", sa.String(length=20), nullable=True))
        batch.add_column(sa.Column("unit_rule", sa.String(length=10), nullable=True))
        batch.add_column(
            sa.Column("allow_unit_conversion", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch.add_column(sa.Column("numeric_tolerance", sa.String(length=20), nullable=True))
        batch.add_column(sa.Column("decimal_places", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("unit_mark", sa.Integer(), nullable=True))
    with op.batch_alter_table("attempt_answers") as batch:
        batch.add_column(sa.Column("grading_note", sa.String(length=30), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("attempt_answers") as batch:
        batch.drop_column("grading_note")
    with op.batch_alter_table("questions") as batch:
        batch.drop_column("unit_mark")
        batch.drop_column("decimal_places")
        batch.drop_column("numeric_tolerance")
        batch.drop_column("allow_unit_conversion")
        batch.drop_column("unit_rule")
        batch.drop_column("answer_unit")
