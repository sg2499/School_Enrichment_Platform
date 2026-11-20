"""The upload templates (13 Nov 2026): what a school downloads still uploads.

The templates are styled workbooks with dropdowns, a Row Check column, a Start
Here sheet and a Your School sheet. None of that may change what an upload
reads: the importers look at the first row of the Teachers and Students sheets
for the headings they know, ignore the rest, and skip a row whose name starts
"Example:". These tests download each template, leave its example row in, add a
few people, and upload the same file.
"""

import io

from openpyxl import load_workbook

from app.models import Student, User
from app.models.curriculum import ClassLevel
from tests.test_learning import _login
from tests.test_school_setup import _post, _world


def _fill(content: bytes, sheet: str, rows) -> bytes:
    wb = load_workbook(io.BytesIO(content))
    ws = wb[sheet]
    for r, values in enumerate(rows, start=3):  # row 2 is the example row
        for c, value in enumerate(values, start=1):
            ws.cell(row=r, column=c, value=value)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def test_setup_template_uploads_with_its_example_rows_left_in(client, db_session):
    db = db_session
    school, admin, _course = _world(db, "TPL1")
    headers = {**_login(client, admin.email), "x-auth-role": "ADMIN"}
    template = client.get("/api/roster/setup-template", headers=headers).content
    wb = load_workbook(io.BytesIO(template))
    # Dropdown sources come from the school's own board: Class 5 Mathematics here.
    assert [c.value for c in wb["Lists"]["A"]][1:2] == ["5"]
    assert "Mathematics" in [c.value for c in wb["Lists"]["B"]]
    assert wb["Teachers"]["A2"].value.startswith("Example:") and wb["Students"]["A2"].value.startswith("Example:")
    data = _fill(template, "Teachers", [("Tara Sen", "tara.tpl@example.com", "9876500011", "Mathematics", "5A")])
    data = _fill(data, "Students", [("Ira Bose", "5", "A", "1"), ("Jai Roy", "5", "A", "2")])
    checked = _post(client, headers, "setup/check", data)
    assert checked.status_code == 200, checked.text
    body = checked.json()
    assert body["ok"], body["problems"]
    assert (body["newTeachers"], body["newStudents"]) == (1, 2)  # the example rows are not people
    assert db.query(Student).filter(Student.school_id == school.id).count() == 0  # a check writes nothing


def test_setup_template_lists_the_sections_already_on_krama(client, db_session):
    db = db_session
    school, admin, _course = _world(db, "TPL2")
    headers = {**_login(client, admin.email), "x-auth-role": "ADMIN"}
    from app.models import Student as StudentRow

    level = db.query(ClassLevel).filter(ClassLevel.code == "5").one()
    user = User(full_name="Kia Das", email=None, password_hash="x", role="STUDENT", is_active=True)
    db.add(user)
    db.flush()
    db.add(StudentRow(user_id=user.id, school_id=school.id, student_code="STU-TPL2-1", class_name="5", section="B", roll_number="1", class_level_id=level.id))
    db.commit()
    wb = load_workbook(io.BytesIO(client.get("/api/roster/setup-template", headers=headers).content))
    rows = [[c.value for c in row] for row in wb["Your School"].iter_rows(min_row=6, min_col=2, max_col=5)]
    assert ["5", "B", 1] == rows[0][:3]
