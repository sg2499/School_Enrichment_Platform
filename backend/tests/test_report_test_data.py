"""The test-data report must survive real rows, not just empty tables.

Twice on 25 Nov a reporting script passed against an empty database and would
have broken on production: once because the Curriculum Studio filters
`Question.origin == "BANK"` and the script did not, and once because the
script read `Student.full_name`, which does not exist -- the child's name is
on the linked `User`, and `Student` carries `student_code`. An empty table
exercises no column access at all, so it cannot catch either.

This seeds a world with students, an assignment and a finished attempt, then
drives the report over it.
"""

import io
from contextlib import redirect_stdout

from scripts.report_test_data import report
from tests import test_class_analytics as ca
from tests import test_learning

# Each world needs its own chapter number, or two worlds collide on a UNIQUE
# constraint (the same lesson registered twice).
test_learning._CHAPTER_NUM.update({"RTD": 221, "RTD2": 222})


def _one_page_pdf() -> bytes:
    import io

    from reportlab.pdfgen import canvas

    out = io.BytesIO()
    pdf = canvas.Canvas(out)
    pdf.drawString(72, 720, "A child's working")
    pdf.showPage()
    pdf.save()
    return out.getvalue()


def test_the_report_runs_over_real_rows(db_session):
    db = db_session
    w = ca._world(db, "RTD")
    student = w["students"][0]
    # The report finds practice attempts by matching ACTIVITY_HINT against the
    # set's title. Without this the generated title does not contain it,
    # section 2 reads nothing, and the loop that touches a child's name --
    # the exact line that would crash on production -- never runs. The first
    # version of this test passed with that bug deliberately reintroduced.
    w["core"].title = "Measurement \u2014 Mastery E"
    db.commit()
    target = next(
        t for t in w["assignment"].targets if t.student_id == student.id
    ) if hasattr(w["assignment"], "targets") else None
    if target is None:
        from app.models import AssignmentTarget

        target = (
            db.query(AssignmentTarget)
            .filter(AssignmentTarget.assignment_id == w["assignment"].id)
            .first()
        )
    assert target is not None, "the world should have targeted a student"

    # A finished attempt, so section 2 has something to read and every column
    # it touches is actually accessed.
    ca._do(db, student, target.id, {w["qs"][0]: "1/2"})
    db.commit()

    # Section 9 walks every attachment and the attempt/assignment chain behind
    # it. Without a real upload that loop never executes and the section
    # proves nothing -- the same empty-data trap that let `Student.full_name`
    # and the shadowed `assignment` through earlier today.
    written = next(q for q in w["qs"] if not q.auto_gradable)
    written.upload_rule = "OPTIONAL"
    db.commit()
    attempt = ca.learning_service.start_attempt(db, student, target.id)
    ca.learning_service.save_answer(db, student, attempt.id, written.id, "Because.")
    from app.models import User
    from app.services import attachment_service

    attachment_service.attach_to_attempt(
        db, student, db.get(User, student.user_id), attempt.id, written.id,
        "working.pdf", _one_page_pdf(),
    )
    db.commit()

    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = report(db)
    out = buffer.getvalue()

    assert code == 0
    # Every section printed, so none of them raised.
    for heading in (
        "1. Assignment",
        "2. Practice attempts",
        "3. Uploaded files",
        "4. Mock paper",
        "5. Derived documents",
        "6. Everything created",
        "7. Stored files",
        "8. Assignments to delete",
        "9. Every attachment still on production",
    ):
        assert heading in out, f"section missing: {heading}\n{out}"
    # Section 9 really walked an attachment, rather than printing "none".
    section9 = out.split("9. Every attachment still on production")[1]
    assert "working.pdf" in section9, (
        f"section 9 found no uploads, so it proves nothing:\n{section9}"
    )
    assert "practice" in section9, "it must name which side the attachment hangs off"
    assert "unplaced" not in section9, "every attachment should be placed"

    assert "Read-only: nothing was written." in out

    # Section 6 must find the attempt by DATE. The old title-matching version
    # returned 18 rows that were all ordinary skill names ("Greatest",
    # "shortest", "verification"), and would have missed an attempt on a set
    # with an unremarkable title -- which is most of them.
    section8 = out.split("8. Assignments to delete")[1]
    assert w["assignment"].id in section8, (
        f"the target list must name the seeded assignment:\n{section8}"
    )

    section6 = out.split("6. Everything created")[1].split("7. Stored files")[0]
    assert "attempts:" in section6
    assert str(student.student_code) in section6, (
        f"the seeded attempt was not found by date:\n{section6}"
    )

    # The child is named via the User/student_code path, never Student.full_name.
    # Section 2 actually found the attempt, so its loop really ran.
    section2 = out.split("2. Practice")[1].split("3. Uploaded")[0]
    assert "Mastery E" in section2, f"section 2 read nothing, so it proves nothing:\n{out}"
    assert student.student_code in section2, "the child is labelled via User/student_code"


def test_the_report_names_a_child_without_a_full_name_column(db_session):
    """`_who` is the single place a child's label is built. Pinned, because
    `Student.full_name` does not exist and reading it crashes only once rows
    are present."""
    from app.models import Student
    from scripts.report_test_data import _who

    db = db_session
    w = ca._world(db, "RTD2")
    student = w["students"][0]

    assert not hasattr(Student, "full_name"), (
        "if Student ever gains full_name, simplify _who -- but do not assume it"
    )
    label = _who(db, student)
    assert student.student_code in label
    assert _who(db, None) == "?"
