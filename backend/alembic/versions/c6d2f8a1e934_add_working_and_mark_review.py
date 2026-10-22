"""add the child's working and a teacher's mark review to attempt answers

Revision ID: c6d2f8a1e934
Revises: b5e1c8d3f207
Create Date: 2026-10-22 14:00:00.000000

Phase 4 (#163, 22 Oct 2026): part and method marks on auto-marked
questions. Shailesh chose "working box + teacher review": on a question
worth 2 or more marks the child may type their working under the answer;
marking stays automatic, and a teacher may then review any such answer
that fell short of full marks and award part marks, with a reason.

attempt_answers.working_text: the child's working (null when none).
attempt_answers.review_reason: why a teacher changed, or kept, the
automatic mark (null for answers no teacher reviewed, and for Constructed
Response marks, which have never needed one).

Both are empty on every existing row, which reads as "no working, not
reviewed": nothing already marked changes. Downgrade drops them.
"""
import sqlalchemy as sa

from alembic import op

revision = "c6d2f8a1e934"
down_revision = "b5e1c8d3f207"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("attempt_answers") as batch:
        batch.add_column(sa.Column("working_text", sa.Text(), nullable=True))
        batch.add_column(sa.Column("review_reason", sa.String(length=200), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("attempt_answers") as batch:
        batch.drop_column("review_reason")
        batch.drop_column("working_text")
