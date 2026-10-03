"""store a calendar entry's class as the class level's code

Revision ID: a4d7e2c9b130
Revises: f7c2a9d4e1b8
Create Date: 2026-10-03 12:00:00.000000

Data-only migration (3 Oct 2026): no schema change.

school_curriculum_maps.class_name is meant to hold what a student's class
holds -- the class level's CODE ("5"). The map form in Curriculum Studio
sent the class level's display name instead ("Class 5"), so an entry made
from that screen could be stored that way. Stored like that it:

  - read "Class Class 5" wherever a screen puts "Class" in front of it;
  - matched none of a teacher's sections on the Assign screen, which
    compares it with the section's class code;
  - did not count as the same slot as an entry for the same chapter and
    class stored as "5", so the two could sit side by side.

From this release the form sends the code and the server stores the code
whatever it is sent (routes_curriculum_admin.py, _class_code_for_map). This
brings the rows already there into line, so the duplicate check and the
teacher's screen are right for old entries as well as new ones.

What it does, for each entry whose class_name is a class level's display
name (compared without regard to capitals or surrounding spaces) and is not
already that level's code:

  - if the same school already has the same chapter under the code, the
    entry is a duplicate of that one and is removed (the code-stored entry
    is the one teachers' screens have been matching, so it is the one kept);
  - otherwise class_name is rewritten to the code.

Anything else is left exactly as it is: a NULL class, a class already
stored as a code, and a label that is no class level's name (a school's own
wording). Idempotent: a second run finds nothing to change.

Downgrade does nothing. The code is a value the previous release reads
correctly too -- it is what that release's own non-form callers stored --
and the display name it replaced cannot be told apart from a code after
the fact.
"""
import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "a4d7e2c9b130"
down_revision = "f7c2a9d4e1b8"
branch_labels = None
depends_on = None


def _key(text: str | None) -> str:
    return (text or "").strip().casefold()


def upgrade() -> None:
    connection = op.get_bind()

    # display name -> code, for every level whose name is not simply its code.
    # Ordered, so that if two levels ever shared a display name the same one
    # would win on every run.
    code_for_name: dict[str, str] = {}
    levels = connection.execute(
        sa.text("SELECT code, display_name FROM class_levels ORDER BY display_order, code")
    ).all()
    for code, display_name in levels:
        if code and _key(display_name) and _key(display_name) != _key(code):
            code_for_name.setdefault(_key(display_name), code)
    if not code_for_name:
        return

    rows = connection.execute(
        sa.text("SELECT id, school_id, chapter_id, class_name FROM school_curriculum_maps WHERE class_name IS NOT NULL")
    ).all()
    taken = {(school_id, chapter_id, class_name) for _id, school_id, chapter_id, class_name in rows}

    rewritten = removed = 0
    for map_id, school_id, chapter_id, class_name in rows:
        code = code_for_name.get(_key(class_name))
        if code is None or code == class_name:
            continue
        if (school_id, chapter_id, code) in taken:
            connection.execute(sa.text("DELETE FROM school_curriculum_maps WHERE id = :id"), {"id": map_id})
            removed += 1
        else:
            connection.execute(
                sa.text("UPDATE school_curriculum_maps SET class_name = :code WHERE id = :id"),
                {"code": code, "id": map_id},
            )
            taken.add((school_id, chapter_id, code))
            rewritten += 1
        taken.discard((school_id, chapter_id, class_name))

    # Counts only: which school mapped what is nobody's business in a build log.
    print(f"calendar classes stored as codes: {rewritten} rewritten, {removed} duplicate(s) removed")


def downgrade() -> None:
    pass
