"""add report cards

Revision ID: e4f7b2c9d013
Revises: d9a4b7c2e815
Create Date: 2026-10-23 17:00:00.000000

Phase 4 (#188, 23 Oct 2026): report cards the school issues, as designed in
PHASE4_REPORT_CARD_DESIGN.md with Shailesh's four decisions. Four new
tables, nothing existing changed:

  report_settings        a school's co-scholastic areas and grade scale
                         for a year
  student_term_records   a student's attendance, co-scholastic grades and
                         remark for a term
  report_card_issues     one issue of a term's cards for one section
  report_cards           each student's card in an issue, as printed

All start empty. Downgrade drops them.
"""
import sqlalchemy as sa

from alembic import op

revision = "e4f7b2c9d013"
down_revision = "d9a4b7c2e815"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "report_settings",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("school_id", sa.String(), sa.ForeignKey("schools.id", ondelete="CASCADE"), nullable=False),
        sa.Column("academic_year_id", sa.String(), sa.ForeignKey("academic_years.id", ondelete="CASCADE"), nullable=False),
        sa.Column("areas_json", sa.Text(), nullable=False),
        sa.Column("scale_json", sa.Text(), nullable=False),
        sa.Column("updated_by_user_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("school_id", "academic_year_id", name="uq_report_settings_year"),
    )
    op.create_index("ix_report_settings_school_id", "report_settings", ["school_id"])

    op.create_table(
        "student_term_records",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("school_id", sa.String(), sa.ForeignKey("schools.id", ondelete="CASCADE"), nullable=False),
        sa.Column("academic_year_id", sa.String(), sa.ForeignKey("academic_years.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", sa.String(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("term", sa.String(length=10), nullable=False),
        sa.Column("working_days", sa.Integer(), nullable=True),
        sa.Column("days_present", sa.Integer(), nullable=True),
        sa.Column("grades_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("remark", sa.String(length=300), nullable=True),
        sa.Column("updated_by_user_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("student_id", "academic_year_id", "term", name="uq_student_term_record"),
    )
    op.create_index("ix_student_term_records_school_id", "student_term_records", ["school_id"])
    op.create_index("ix_student_term_records_academic_year_id", "student_term_records", ["academic_year_id"])
    op.create_index("ix_student_term_records_student_id", "student_term_records", ["student_id"])

    op.create_table(
        "report_card_issues",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("school_id", sa.String(), sa.ForeignKey("schools.id", ondelete="CASCADE"), nullable=False),
        sa.Column("academic_year_id", sa.String(), sa.ForeignKey("academic_years.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("class_level_id", sa.String(), sa.ForeignKey("class_levels.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("section", sa.String(length=50), nullable=False),
        sa.Column("card_term", sa.String(length=10), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="ISSUED"),
        sa.Column("issued_by_user_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("issued_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("withdrawn_by_user_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("withdraw_reason", sa.String(length=300), nullable=True),
    )
    op.create_index("ix_report_card_issues_school_id", "report_card_issues", ["school_id"])
    op.create_index(
        "ix_report_issue_scope", "report_card_issues",
        ["school_id", "academic_year_id", "class_level_id", "section", "card_term"],
    )
    op.create_index(
        "uq_report_issue_issued", "report_card_issues",
        ["school_id", "academic_year_id", "class_level_id", "section", "card_term"],
        unique=True,
        postgresql_where=sa.text("status = 'ISSUED'"),
        sqlite_where=sa.text("status = 'ISSUED'"),
    )

    op.create_table(
        "report_cards",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("issue_id", sa.String(), sa.ForeignKey("report_card_issues.id", ondelete="CASCADE"), nullable=False),
        sa.Column("school_id", sa.String(), sa.ForeignKey("schools.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", sa.String(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("card_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("issue_id", "student_id", name="uq_report_card_student"),
    )
    op.create_index("ix_report_cards_issue_id", "report_cards", ["issue_id"])
    op.create_index("ix_report_cards_student_id", "report_cards", ["student_id"])


def downgrade() -> None:
    op.drop_table("report_cards")
    op.drop_table("report_card_issues")
    op.drop_table("student_term_records")
    op.drop_table("report_settings")
