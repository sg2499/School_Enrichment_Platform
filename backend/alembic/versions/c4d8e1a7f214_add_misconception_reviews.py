"""add misconception reviews

Revision ID: c4d8e1a7f214
Revises: b2e6d9f4a202
Create Date: 2026-10-26 22:30:00.000000

Ashalatha's decision (Q14, 26 Oct 2026): a misconception note is reviewed
before it appears on a teacher's Class Analytics. One new table holding her
review of each skill's note; nothing else changes. Until reviews are loaded
the dashboard shows each misconception only as waiting for review.
Downgrade drops the table.

The same change (Shailesh, 26 Oct 2026) makes the default co-scholastic
scale O, A, B, C, D, E. A school that recorded co-scholastic grades without
saving its own settings read the old default (A Outstanding, B Very Good,
C Fair), so its grades would quietly change meaning (review). For each such
school and year this saves the old scale, with the default areas, as its
settings. Downgrade leaves those rows: they are the school's settings now.
"""
import json
import uuid

import sqlalchemy as sa

from alembic import op

OLD_SCALE = [
    {"label": "A", "meaning": "Outstanding"},
    {"label": "B", "meaning": "Very Good"},
    {"label": "C", "meaning": "Fair"},
]
DEFAULT_AREAS = ["Work Education", "Art Education", "Health and Physical Education", "Discipline"]

revision = "c4d8e1a7f214"
down_revision = "b2e6d9f4a202"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "misconception_reviews",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "concept_lesson_id", sa.String(), sa.ForeignKey("concept_lessons.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("tag_key", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("shown_note", sa.Text(), nullable=True),
        sa.Column("next_step", sa.Text(), nullable=True),
        sa.Column("reviewed_by", sa.String(length=120), nullable=True),
        sa.Column("workbook_sha256", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("concept_lesson_id", "tag_key", name="uq_misconception_review"),
    )
    op.create_index("ix_misconception_reviews_concept_lesson_id", "misconception_reviews", ["concept_lesson_id"])

    bind = op.get_bind()
    years = bind.execute(
        sa.text(
            "SELECT DISTINCT r.school_id, r.academic_year_id FROM student_term_records r "
            "WHERE r.grades_json IS NOT NULL AND r.grades_json NOT IN ('{}', '') "
            "AND NOT EXISTS (SELECT 1 FROM report_settings s "
            "WHERE s.school_id = r.school_id AND s.academic_year_id = r.academic_year_id)"
        )
    ).fetchall()
    for school_id, year_id in years:
        bind.execute(
            sa.text(
                "INSERT INTO report_settings (id, school_id, academic_year_id, areas_json, scale_json) "
                "VALUES (:id, :school, :year, :areas, :scale)"
            ),
            {"id": str(uuid.uuid4()), "school": school_id, "year": year_id,
             "areas": json.dumps(DEFAULT_AREAS), "scale": json.dumps(OLD_SCALE)},
        )


def downgrade() -> None:
    op.drop_index("ix_misconception_reviews_concept_lesson_id", table_name="misconception_reviews")
    op.drop_table("misconception_reviews")
