"""answer attachments: a PDF of working or a drawing on an answer (#237)

Revision ID: a7c3e9d5b241
Revises: d2e9a4c7b631
Create Date: 2026-11-17 16:30:00.000000

Adds questions.upload_rule (REQUIRED / OPTIONAL / NONE; empty means the
platform reads the question and decides), stored_files (the bytes, for the
default database storage) and answer_attachments (one PDF per practice or
mock-paper answer). Nothing existing changes; every question starts with the
rule empty. Downgrade drops the three.
"""

import sqlalchemy as sa

from alembic import op

revision = "a7c3e9d5b241"
down_revision = "d2e9a4c7b631"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("questions", sa.Column("upload_rule", sa.String(length=10), nullable=True))
    op.create_table(
        "stored_files",
        sa.Column("key", sa.String(length=120), primary_key=True),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "answer_attachments",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("student_id", sa.String(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", sa.String(), sa.ForeignKey("questions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("attempt_answer_id", sa.String(), sa.ForeignKey("attempt_answers.id", ondelete="CASCADE"), nullable=True),
        sa.Column("mock_answer_id", sa.String(), sa.ForeignKey("mock_paper_answers.id", ondelete="CASCADE"), nullable=True),
        sa.Column("filename", sa.String(length=200), nullable=False),
        sa.Column("content_type", sa.String(length=50), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("storage_backend", sa.String(length=20), nullable=False),
        sa.Column("storage_key", sa.String(length=120), nullable=False),
        sa.Column("uploaded_by_user_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint(
            "(attempt_answer_id IS NOT NULL AND mock_answer_id IS NULL) OR "
            "(attempt_answer_id IS NULL AND mock_answer_id IS NOT NULL)",
            name="ck_answer_attachment_one_owner",
        ),
        sa.UniqueConstraint("attempt_answer_id", name="uq_answer_attachment_attempt_answer"),
        sa.UniqueConstraint("mock_answer_id", name="uq_answer_attachment_mock_answer"),
    )
    op.create_index("ix_answer_attachments_student_id", "answer_attachments", ["student_id"])


def downgrade() -> None:
    op.drop_index("ix_answer_attachments_student_id", table_name="answer_attachments")
    op.drop_table("answer_attachments")
    op.drop_table("stored_files")
    op.drop_column("questions", "upload_rule")
