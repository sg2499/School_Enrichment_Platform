"""give practice sets distinct names

Revision ID: d2e9a4c7b631
Revises: c8d3f1a5e218
Create Date: 2026-11-11 20:30:00.000000

#223 (11 Nov 2026): a skill has two Extra Practice sets and two Prerequisite
Checks that carried the same name, so a teacher choosing one in Assign
Practice, or a student on My Progress, could not tell them apart. They now
end in A or B. Only a name the generator made is changed (a set someone
renamed by hand is left alone). Downgrade takes the letter off again.
"""

import re

import sqlalchemy as sa

from alembic import op

revision = "d2e9a4c7b631"
down_revision = "c8d3f1a5e218"
branch_labels = None
depends_on = None

_SUFFIX = {"EXTRA_PRACTICE": "Extra Practice", "PREREQUISITE_CHECK": "Prerequisite Check"}


def _letter(activity_type: str, code: str) -> str | None:
    code = (code or "").strip()
    if activity_type == "EXTRA_PRACTICE":
        match = re.search(r"-X([AB])-", code)
        return match.group(1) if match else None
    if activity_type == "PREREQUISITE_CHECK":
        return "B" if code.endswith("-B") else "A"
    return None


def _rows(connection):
    return connection.execute(
        sa.text(
            "SELECT a.id, a.title, a.activity_type, a.source_assignment_code, l.title AS skill, c.title AS chapter "
            "FROM learning_activities a "
            "LEFT JOIN concept_lessons l ON l.id = a.concept_lesson_id "
            "JOIN chapters c ON c.id = a.chapter_id "
            "WHERE a.activity_type IN ('EXTRA_PRACTICE', 'PREREQUISITE_CHECK')"
        )
    ).fetchall()


def _rename(connection, to_new: bool) -> None:
    for row in _rows(connection):
        letter = _letter(row.activity_type, row.source_assignment_code)
        if not letter:
            continue
        subject = row.skill or row.chapter
        old = f"{subject} — {_SUFFIX[row.activity_type]}"
        new = f"{old} {letter}"
        current, target = (old, new) if to_new else (new, old)
        if row.title == current:
            connection.execute(
                sa.text("UPDATE learning_activities SET title = :t WHERE id = :i"), {"t": target, "i": row.id}
            )


def upgrade() -> None:
    _rename(op.get_bind(), True)


def downgrade() -> None:
    _rename(op.get_bind(), False)
