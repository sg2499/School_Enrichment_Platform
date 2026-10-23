"""add academic years and assessment schemes

Revision ID: d9a4b7c2e815
Revises: c6d2f8a1e934
Create Date: 2026-10-23 13:00:00.000000

Phase 4 (#165, 23 Oct 2026): the Assessment Scheme, as designed in
PHASE4_ASSESSMENT_SCHEME_DESIGN.md and approved by Shailesh. Six new
tables, nothing existing changed:

  academic_years                    a school's year ("2026-27")
  assessment_schemes                a school's scheme for one class level,
                                    board course and year (or a template)
  assessment_components             its components, each with maximum
                                    marks, a weight and a source
  assessment_component_activities   a platform component's practice sets
  grade_bands                       its grades and their lowest percentages
  component_marks                   one student's marks on one component

All start empty, so nothing already marked changes. Downgrade drops them.
"""
import sqlalchemy as sa

from alembic import op

revision = "d9a4b7c2e815"
down_revision = "c6d2f8a1e934"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "academic_years",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("school_id", sa.String(), sa.ForeignKey("schools.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(length=20), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_by_user_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("school_id", "label", name="uq_academic_year_label"),
    )
    op.create_index("ix_academic_years_school_id", "academic_years", ["school_id"])

    op.create_table(
        "assessment_schemes",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("school_id", sa.String(), sa.ForeignKey("schools.id", ondelete="CASCADE"), nullable=True),
        sa.Column("is_template", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("description", sa.String(length=300), nullable=True),
        sa.Column("academic_year_id", sa.String(), sa.ForeignKey("academic_years.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("class_level_id", sa.String(), sa.ForeignKey("class_levels.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("board_course_id", sa.String(), sa.ForeignKey("board_courses.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("lineage_id", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="DRAFT"),
        sa.Column("attempt_rule", sa.String(length=10), nullable=False, server_default="BEST"),
        sa.Column("pass_percent", sa.String(length=20), nullable=False, server_default="33"),
        sa.Column("pass_label", sa.String(length=40), nullable=False, server_default="Pass"),
        sa.Column("fail_label", sa.String(length=40), nullable=False, server_default="Needs Improvement"),
        sa.Column("decimal_places", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by_user_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("published_by_user_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("lineage_id", "version", name="uq_scheme_lineage_version"),
    )
    for column in ("school_id", "academic_year_id", "class_level_id", "board_course_id", "lineage_id"):
        op.create_index(f"ix_assessment_schemes_{column}", "assessment_schemes", [column])
    op.create_index(
        "ix_scheme_scope",
        "assessment_schemes",
        ["school_id", "academic_year_id", "class_level_id", "board_course_id", "status"],
    )

    op.create_table(
        "assessment_components",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("scheme_id", sa.String(), sa.ForeignKey("assessment_schemes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("component_key", sa.String(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False, server_default="OTHER"),
        sa.Column("term", sa.String(length=20), nullable=False, server_default="WHOLE_YEAR"),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="ENTERED"),
        sa.Column("max_marks", sa.String(length=20), nullable=False),
        sa.Column("weight_percent", sa.String(length=20), nullable=False),
        sa.Column("min_pass_percent", sa.String(length=20), nullable=True),
    )
    op.create_index("ix_assessment_components_scheme_id", "assessment_components", ["scheme_id"])
    op.create_index("ix_assessment_components_component_key", "assessment_components", ["component_key"])

    op.create_table(
        "assessment_component_activities",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "component_id", sa.String(), sa.ForeignKey("assessment_components.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "learning_activity_id",
            sa.String(),
            sa.ForeignKey("learning_activities.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.UniqueConstraint("component_id", "learning_activity_id", name="uq_component_activity"),
    )
    op.create_index(
        "ix_assessment_component_activities_component_id", "assessment_component_activities", ["component_id"]
    )
    op.create_index(
        "ix_assessment_component_activities_learning_activity_id",
        "assessment_component_activities",
        ["learning_activity_id"],
    )

    op.create_table(
        "grade_bands",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("scheme_id", sa.String(), sa.ForeignKey("assessment_schemes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("label", sa.String(length=20), nullable=False),
        sa.Column("min_percent", sa.String(length=20), nullable=False),
    )
    op.create_index("ix_grade_bands_scheme_id", "grade_bands", ["scheme_id"])

    op.create_table(
        "component_marks",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("school_id", sa.String(), sa.ForeignKey("schools.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "component_id", sa.String(), sa.ForeignKey("assessment_components.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("student_id", sa.String(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="ENTERED"),
        sa.Column("marks", sa.String(length=20), nullable=True),
        sa.Column("change_reason", sa.String(length=200), nullable=True),
        sa.Column("entered_by_user_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("entered_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_by_user_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("component_id", "student_id", name="uq_component_mark"),
    )
    for column in ("school_id", "component_id", "student_id"):
        op.create_index(f"ix_component_marks_{column}", "component_marks", [column])


def downgrade() -> None:
    op.drop_table("component_marks")
    op.drop_table("grade_bands")
    op.drop_table("assessment_component_activities")
    op.drop_table("assessment_components")
    op.drop_table("assessment_schemes")
    op.drop_table("academic_years")
