"""add question patterns and generated questions

Revision ID: d6a1f3c8e166
Revises: c4d8e1a7f214
Create Date: 2026-10-27 12:00:00.000000

#166 step 1 (27 Oct 2026; PHASE5_MOCK_PAPER_DESIGN.md): the mock paper
engine's core. Two new tables (question_patterns, generated_questions) and
one new column, questions.origin, BANK for every existing question
(server default), GENERATED for questions made from a pattern. Nothing
existing changes. Downgrade drops them.
"""
import sqlalchemy as sa

from alembic import op

revision = "d6a1f3c8e166"
down_revision = "c4d8e1a7f214"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("questions", sa.Column("origin", sa.String(length=20), nullable=False, server_default="BANK"))
    op.create_table(
        "question_patterns",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("code", sa.String(length=60), nullable=False),
        sa.Column("board_course_id", sa.String(), sa.ForeignKey("board_courses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("chapter_id", sa.String(), sa.ForeignKey("chapters.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("concept_lesson_id", sa.String(), sa.ForeignKey("concept_lessons.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("question_type", sa.String(length=50), nullable=False),
        sa.Column("marks", sa.Integer(), nullable=False),
        sa.Column("difficulty", sa.Integer(), nullable=True),
        sa.Column("competency", sa.String(length=150), nullable=True),
        sa.Column("spec_json", sa.Text(), nullable=False),
        sa.Column("spec_sha256", sa.String(length=64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("approved_by", sa.String(length=120), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_file", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("code"),
    )
    for column in ("board_course_id", "chapter_id", "concept_lesson_id"):
        op.create_index(f"ix_question_patterns_{column}", "question_patterns", [column])
    op.create_table(
        "generated_questions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("question_id", sa.String(), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pattern_id", sa.String(), sa.ForeignKey("question_patterns.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("pattern_version", sa.Integer(), nullable=False),
        sa.Column("school_id", sa.String(), sa.ForeignKey("schools.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seed", sa.String(length=40), nullable=False),
        sa.Column("values_json", sa.Text(), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("group_id", sa.String(), nullable=True),
        sa.Column("part_number", sa.Integer(), nullable=True),
        sa.Column("stimulus", sa.Text(), nullable=True),
        sa.Column("mistakes_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("question_id"),
        sa.UniqueConstraint("school_id", "fingerprint", name="uq_generated_question_school_fingerprint"),
    )
    op.create_index("ix_generated_questions_pattern_id", "generated_questions", ["pattern_id"])
    op.create_index("ix_generated_questions_school_id", "generated_questions", ["school_id"])
    op.create_index("ix_generated_questions_group_id", "generated_questions", ["group_id"])
    op.create_index("ix_generated_questions_pattern_school", "generated_questions", ["pattern_id", "school_id"])


def downgrade() -> None:
    op.drop_table("generated_questions")
    op.drop_table("question_patterns")
    op.drop_column("questions", "origin")
