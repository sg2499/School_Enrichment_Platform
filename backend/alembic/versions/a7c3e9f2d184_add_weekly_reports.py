"""add weekly parent reports

Revision ID: a7c3e9f2d184
Revises: e4f7b2c9d013
Create Date: 2026-10-26 18:30:00.000000

Phase 6 (#187, 26 Oct 2026): the weekly parent report, as designed in
PHASE6_WEEKLY_REPORT_DESIGN.md with Shailesh's decisions. Three new
tables, nothing existing changed:

  weekly_report_notes    a teacher's draft notes for a section's week
                         (one for the section, one per child)
  weekly_report_issues   one issue of a section's week
  weekly_reports         each child's page in an issue, as issued

All start empty. Downgrade drops them.
"""
import sqlalchemy as sa

from alembic import op

revision = "a7c3e9f2d184"
down_revision = "e4f7b2c9d013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "weekly_report_notes",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("school_id", sa.String(), sa.ForeignKey("schools.id", ondelete="CASCADE"), nullable=False),
        sa.Column("class_level_id", sa.String(), sa.ForeignKey("class_levels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("section", sa.String(length=50), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("student_id", sa.String(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=True),
        sa.Column("note", sa.String(length=300), nullable=False),
        sa.Column("updated_by_user_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_weekly_report_notes_school_id", "weekly_report_notes", ["school_id"])
    op.create_index("ix_weekly_note_scope", "weekly_report_notes", ["school_id", "class_level_id", "section", "week_start"])
    op.create_index(
        "uq_weekly_note_child", "weekly_report_notes",
        ["school_id", "class_level_id", "section", "week_start", "student_id"],
        unique=True,
        postgresql_where=sa.text("student_id IS NOT NULL"),
        sqlite_where=sa.text("student_id IS NOT NULL"),
    )
    op.create_index(
        "uq_weekly_note_section", "weekly_report_notes",
        ["school_id", "class_level_id", "section", "week_start"],
        unique=True,
        postgresql_where=sa.text("student_id IS NULL"),
        sqlite_where=sa.text("student_id IS NULL"),
    )

    op.create_table(
        "weekly_report_issues",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("school_id", sa.String(), sa.ForeignKey("schools.id", ondelete="CASCADE"), nullable=False),
        sa.Column("class_level_id", sa.String(), sa.ForeignKey("class_levels.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("section", sa.String(length=50), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="ISSUED"),
        sa.Column("issued_by_user_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("issued_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("withdrawn_by_user_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("withdraw_reason", sa.String(length=300), nullable=True),
    )
    op.create_index("ix_weekly_report_issues_school_id", "weekly_report_issues", ["school_id"])
    op.create_index("ix_weekly_issue_scope", "weekly_report_issues", ["school_id", "class_level_id", "section", "week_start"])
    op.create_index(
        "uq_weekly_issue_issued", "weekly_report_issues",
        ["school_id", "class_level_id", "section", "week_start"],
        unique=True,
        postgresql_where=sa.text("status = 'ISSUED'"),
        sqlite_where=sa.text("status = 'ISSUED'"),
    )

    op.create_table(
        "weekly_reports",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("issue_id", sa.String(), sa.ForeignKey("weekly_report_issues.id", ondelete="CASCADE"), nullable=False),
        sa.Column("school_id", sa.String(), sa.ForeignKey("schools.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", sa.String(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("report_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("issue_id", "student_id", name="uq_weekly_report_student"),
    )
    op.create_index("ix_weekly_reports_issue_id", "weekly_reports", ["issue_id"])
    op.create_index("ix_weekly_reports_student_id", "weekly_reports", ["student_id"])


def downgrade() -> None:
    op.drop_table("weekly_reports")
    op.drop_table("weekly_report_issues")
    op.drop_table("weekly_report_notes")
