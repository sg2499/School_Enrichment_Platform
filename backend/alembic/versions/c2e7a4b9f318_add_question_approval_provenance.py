"""questions: who approved it, when, by what route, and whether a person sent it back (A-012)

Revision ID: c2e7a4b9f318
Revises: b4d8f1a6c293
Create Date: 2026-11-26 15:30:00.000000

A-012: a question recorded only its status, so "approved by the platform's
checks" could not be told apart from "signed off by the academic owner" for
any of the 28,430 approved questions. Four nullable columns answer it.

The three approval columns stay EMPTY on every existing row. That is
deliberate and is the honest answer: the bulk approval audit rows carry
counts and not question ids, and the publish script's rows carry no user at
all, so there is nothing to backfill them from. Empty reads "not recorded",
which is true. Nothing is lost -- the audit log keeps what history there is.

sent_back_at is the one column this migration writes. It is stamped on every
question sitting at SME_REVIEW at upgrade, because a question a person sent
back for rework and a question an import put into SME_REVIEW look identical
once the moment has passed, and the safe reading of an unknown is "do not
approve this again without a person". Stamping holds content back; not
stamping would let the next publish run re-approve work somebody rejected
(see question_approval_service). A question stamped here that was never
really sent back is approved again by one click in Curriculum Studio, which
clears the stamp.

Count the rows this will stamp before applying:
    SELECT count(*) FROM questions WHERE status = 'SME_REVIEW';

Downgrade drops all four columns.
"""

import sqlalchemy as sa

from alembic import op

revision = "c2e7a4b9f318"
down_revision = "b4d8f1a6c293"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # No foreign key on the user, for the reason repeat_of_id has none
    # (b4d8f1a6c293): removing a person must never be blocked by, or cascade
    # into, curriculum content. An id that no longer resolves still answers
    # "not the academic owner".
    op.add_column("questions", sa.Column("approved_by_user_id", sa.String(), nullable=True))
    op.add_column("questions", sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("questions", sa.Column("approval_source", sa.String(length=20), nullable=True))
    op.add_column("questions", sa.Column("sent_back_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_questions_approved_by_user_id", "questions", ["approved_by_user_id"])
    op.execute(
        "UPDATE questions SET sent_back_at = CURRENT_TIMESTAMP WHERE status = 'SME_REVIEW'"
    )


def downgrade() -> None:
    op.drop_index("ix_questions_approved_by_user_id", table_name="questions")
    op.drop_column("questions", "sent_back_at")
    op.drop_column("questions", "approval_source")
    op.drop_column("questions", "approved_at")
    op.drop_column("questions", "approved_by_user_id")
