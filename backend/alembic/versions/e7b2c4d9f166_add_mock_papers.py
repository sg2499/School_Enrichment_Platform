"""add mock papers and per-student generated questions

Revision ID: e7b2c4d9f166
Revises: d6a1f3c8e166
Create Date: 2026-10-27 18:00:00.000000

#166 step 3 (27 Oct 2026; PHASE5_MOCK_PAPER_DESIGN.md): the test builder.

generated_questions gains student_id, and "never the same question within a
school" becomes "never the same question for a student" (a school of a few
hundred students would use a small pattern up). Production has no generated
questions yet (step 1 stored none), so nothing is rewritten.

New tables: paper_formats (a school's or a teacher's saved test formats),
mock_papers, mock_paper_slots, mock_paper_versions (one per student) and
mock_paper_version_items. Downgrade drops them and restores the school rule
(it refuses if per-student rows would break it).
"""
import sqlalchemy as sa

from alembic import op

revision = "e7b2c4d9f166"
down_revision = "d6a1f3c8e166"
branch_labels = None
depends_on = None


def _ts(name):
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.func.now())


def upgrade() -> None:
    with op.batch_alter_table("generated_questions") as batch:
        batch.add_column(sa.Column("student_id", sa.String(), nullable=True))
        batch.create_foreign_key("fk_generated_questions_student_id", "students", ["student_id"], ["id"], ondelete="CASCADE")
        batch.drop_constraint("uq_generated_question_school_fingerprint", type_="unique")
        batch.create_unique_constraint("uq_generated_question_student_fingerprint", ["student_id", "fingerprint"])
        batch.create_index("ix_generated_questions_student_id", ["student_id"])
        batch.create_index("ix_generated_questions_school_fingerprint", ["school_id", "fingerprint"])

    op.create_table(
        "paper_formats",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("school_id", sa.String(), sa.ForeignKey("schools.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("spec_json", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        _ts("created_at"), _ts("updated_at"),
    )
    op.create_index("ix_paper_formats_school_id", "paper_formats", ["school_id"])
    op.create_index("ix_paper_formats_owner_user_id", "paper_formats", ["owner_user_id"])

    op.create_table(
        "mock_papers",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("school_id", sa.String(), sa.ForeignKey("schools.id", ondelete="CASCADE"), nullable=False),
        sa.Column("class_level_id", sa.String(), sa.ForeignKey("class_levels.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("section", sa.String(length=50), nullable=False),
        sa.Column("board_course_id", sa.String(), sa.ForeignKey("board_courses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("format_json", sa.Text(), nullable=False),
        sa.Column("chapter_ids_json", sa.Text(), nullable=False),
        sa.Column("opens_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closes_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("approved_by_user_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("withdraw_reason", sa.String(length=300), nullable=True),
        _ts("created_at"), _ts("updated_at"),
    )
    op.create_index("ix_mock_papers_school_id", "mock_papers", ["school_id"])
    op.create_index("ix_mock_papers_scope", "mock_papers", ["school_id", "class_level_id", "section", "board_course_id"])

    op.create_table(
        "mock_paper_slots",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("paper_id", sa.String(), sa.ForeignKey("mock_papers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("section_index", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("marks", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("choice_group", sa.Integer(), nullable=True),
        sa.Column("alternative", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("pattern_id", sa.String(), sa.ForeignKey("question_patterns.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("pattern_version", sa.Integer(), nullable=True),
        sa.Column("sample_seed", sa.String(length=40), nullable=True),
        sa.Column("approved_spec_json", sa.Text(), nullable=True),
    )
    op.create_index("ix_mock_paper_slots_paper_id", "mock_paper_slots", ["paper_id"])

    op.create_table(
        "mock_paper_versions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("paper_id", sa.String(), sa.ForeignKey("mock_papers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", sa.String(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        _ts("created_at"),
        sa.UniqueConstraint("paper_id", "student_id", name="uq_mock_paper_version_student"),
    )
    op.create_index("ix_mock_paper_versions_paper_id", "mock_paper_versions", ["paper_id"])
    op.create_index("ix_mock_paper_versions_student_id", "mock_paper_versions", ["student_id"])

    op.create_table(
        "mock_paper_version_items",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("version_id", sa.String(), sa.ForeignKey("mock_paper_versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("slot_id", sa.String(), sa.ForeignKey("mock_paper_slots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", sa.String(), sa.ForeignKey("questions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("part_number", sa.Integer(), nullable=True),
        sa.UniqueConstraint("version_id", "question_id", name="uq_mock_paper_item_question"),
    )
    op.create_index("ix_mock_paper_version_items_version_id", "mock_paper_version_items", ["version_id"])
    op.create_index("ix_mock_paper_version_items_slot_id", "mock_paper_version_items", ["slot_id"])


def downgrade() -> None:
    op.drop_table("mock_paper_version_items")
    op.drop_table("mock_paper_versions")
    op.drop_table("mock_paper_slots")
    op.drop_table("mock_papers")
    op.drop_table("paper_formats")
    with op.batch_alter_table("generated_questions") as batch:
        batch.drop_index("ix_generated_questions_school_fingerprint")
        batch.drop_index("ix_generated_questions_student_id")
        batch.drop_constraint("uq_generated_question_student_fingerprint", type_="unique")
        batch.create_unique_constraint("uq_generated_question_school_fingerprint", ["school_id", "fingerprint"])
        batch.drop_constraint("fk_generated_questions_student_id", type_="foreignkey")
        batch.drop_column("student_id")
