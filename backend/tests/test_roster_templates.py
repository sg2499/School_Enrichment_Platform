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

from app.models import Student, Teacher, User
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
    rows = [[c.value for c in row] for row in wb["Your School"].iter_rows(min_row=2)]
    assert ["5", "B", 1] == rows[0][:3]


def test_people_templates_upload_for_both_roles(client, db_session):
    db = db_session
    school, admin, _course = _world(db, "TPL3")
    headers = {**_login(client, admin.email), "x-auth-role": "ADMIN"}

    for role, sheet, filename in (("STUDENT", "Students", "Krama_Add_Students.xlsx"), ("TEACHER", "Teachers", "Krama_Add_Teachers.xlsx")):
        response = client.get("/api/roster/people-template", params={"role": role}, headers=headers)
        assert response.status_code == 200
        assert filename in response.headers["content-disposition"]
        wb = load_workbook(io.BytesIO(response.content))
        assert wb.sheetnames[0] == sheet and "Start Here" in wb.sheetnames
        headings = [c.value for c in wb[sheet][1]]
        assert headings[0] == "Full Name" and headings[-1] == "Row Check"
        rows = (
            [("Nila Rao", "", "5", "A", "")] if role == "STUDENT" else [("Ravi Pal", "ravi.tpl@example.com", "TGT", "Mathematics", "B.Ed", "")]
        )
        data = _fill(response.content, sheet, rows)
        upload = client.post(
            "/api/roster/people/bulk",
            headers=headers,
            data={"role": role},
            files={"file": ("t.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert upload.status_code == 200, upload.text
        body = upload.json()
        assert (body["created"], body["attempted"]) == (1, 1), body  # the example row is skipped, not refused
        # Row Check is a heading the importer does not read, and says so.
        assert "Row Check" in body["unrecognisedColumns"]
    assert db.query(Student).filter(Student.school_id == school.id).count() == 1
    assert db.query(Teacher).filter(Teacher.school_id == school.id).count() >= 1


def test_people_template_refuses_a_role_it_does_not_have(client, db_session):
    _school, admin, _course = _world(db_session, "TPL4")
    headers = {**_login(client, admin.email), "x-auth-role": "ADMIN"}
    assert client.get("/api/roster/people-template", params={"role": "ADMIN"}, headers=headers).status_code == 422
