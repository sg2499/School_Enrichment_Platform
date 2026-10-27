"""add mock paper sittings and answers

Revision ID: f3a8c6e2d166
Revises: e7b2c4d9f166
Create Date: 2026-10-27 20:00:00.000000

#166 step 4 (27 Oct 2026; PHASE5_MOCK_PAPER_DESIGN.md): students sit their
version of an approved paper online. Two new tables (mock_paper_sittings,
mock_paper_answers) and two new columns on mock_papers for releasing the
results. Nothing existing changes. Downgrade drops them.
"""
import sqlalchemy as sa

from alembic import op

revision = "f3a8c6e2d166"
down_revision = "e7b2c4d9f166"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("mock_papers") as batch:
        batch.add_column(sa.Column("results_released_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("results_released_by_user_id", sa.String(), nullable=True))
        batch.create_foreign_key(
            "fk_mock_papers_results_released_by", "users", ["results_released_by_user_id"], ["id"], ondelete="SET NULL"
        )
    op.create_table(
        "mock_paper_sittings",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("version_id", sa.String(), sa.ForeignKey("mock_paper_versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("paper_id", sa.String(), sa.ForeignKey("mock_papers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", sa.String(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("writing_starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_how", sa.String(length=20), nullable=True),
        sa.Column("section_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("choices_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("auto_score", sa.Integer(), nullable=True),
        sa.Column("final_score", sa.Integer(), nullable=True),
        sa.Column("max_score", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("version_id"),
    )
    op.create_index("ix_mock_paper_sittings_paper_id", "mock_paper_sittings", ["paper_id"])
    op.create_index("ix_mock_paper_sittings_student_id", "mock_paper_sittings", ["student_id"])
    op.create_table(
        "mock_paper_answers",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("sitting_id", sa.String(), sa.ForeignKey("mock_paper_sittings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", sa.String(), sa.ForeignKey("questions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("slot_id", sa.String(), sa.ForeignKey("mock_paper_slots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("response_text", sa.Text(), nullable=True),
        sa.Column("working_text", sa.Text(), nullable=True),
        sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("counted", sa.Boolean(), nullable=True),
        sa.Column("is_correct", sa.Boolean(), nullable=True),
        sa.Column("auto_score", sa.Integer(), nullable=True),
        sa.Column("grading_note", sa.String(length=30), nullable=True),
        sa.Column("max_score", sa.Integer(), nullable=False),
        sa.Column("manual_score", sa.Integer(), nullable=True),
        sa.Column("graded_by_user_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("graded_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("sitting_id", "question_id", name="uq_mock_paper_answer_question"),
    )
    op.create_index("ix_mock_paper_answers_sitting_id", "mock_paper_answers", ["sitting_id"])


def downgrade() -> None:
    op.drop_table("mock_paper_answers")
    op.drop_table("mock_paper_sittings")
    with op.batch_alter_table("mock_papers") as batch:
        batch.drop_constraint("fk_mock_papers_results_released_by", type_="foreignkey")
        batch.drop_column("results_released_by_user_id")
        batch.drop_column("results_released_at")
