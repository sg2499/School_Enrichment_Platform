"""The two upload workbooks a school fills in (13 Nov 2026).

Shailesh, 12 Nov 2026: the teacher and student upload templates were "shitty
and very basic". There are two, and both are built here so they look and
behave alike:

* the School Setup workbook (Classes & Sections): Teachers and Students in
  one file, checked whole and imported all or nothing;
* the People templates (People > Bulk Import): one workbook for teachers or
  one for students, imported row by row.

What a school sees, in the order it needs it: a Start Here sheet (the steps,
what each column wants, a colour key), the sheet to fill in (dropdowns for
class, section and subject taken from the school's own board; a prompt on
each column; a Row Check column that says, as you type, what is wrong with a
row; repeated emails, mobiles and roll numbers marked in red), and a Your
School sheet listing the sections already on Krama, so nobody adds a class
that is already there.

Nothing here changes what an upload accepts. The readers look at the first
row of the Teachers and Students sheets for the headings they know and ignore
everything else, so the extra "Row Check" column, the extra sheets and the
styling are invisible to them; a row whose name starts "Example:" is skipped.
"""

from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.drawing.image import Image as XlImage
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from sqlalchemy import func
from sqlalchemy.orm import Session

IST = timezone(timedelta(hours=5, minutes=30))
FONT = "Calibri"

# Colours. Text on every fill below is at least 4.5:1.
INK = "1F2A5C"  # deep indigo: titles, required headings (white on it 14:1)
MID = "4B5BA8"  # optional headings (white on it 6.4:1)
GREY = "5B6475"  # computed column (white on it 5.9:1)
SAFFRON = "F59E0B"
PALE = "EEF0FA"  # band behind notes
STRIPE = "F7F8FC"
LINE = "D9DCEA"
GOOD = "1B7F4B"
BAD_FILL = "FDE2E2"
BAD_TEXT = "9B1C1C"
WARN_TEXT = "8A5A00"

LAST_ROW = 2000  # the readers' own row limit; formatting and validation run this far
CHECK_ROWS = LAST_ROW - 1  # rows that carry a Row Check formula and an outline
SECTION_LETTERS = list("ABCDEFGH")


def _font(**kw) -> Font:
    return Font(name=FONT, **kw)


_THIN = Side(style="thin", color=LINE)
_BOX = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)


def _fill(hex_colour: str) -> PatternFill:
    return PatternFill("solid", fgColor="FF" + hex_colour)


# --- what the school's board offers -----------------------------------------------------------


def _offered(db: Session | None, school) -> tuple[list[str], list[str]]:
    """(class codes, subject names) the school's board teaches, in teaching
    order. Falls back to Class 5 to 10 and Mathematics for a school with no
    board yet, so the dropdowns are never empty."""
    classes: list[str] = []
    subjects: list[str] = []
    if db is not None and getattr(school, "board", None):
        from app.models.curriculum import Board, BoardCourse, ClassLevel

        rows = (
            db.query(ClassLevel.code, ClassLevel.display_order, BoardCourse.display_name)
            .join(BoardCourse, BoardCourse.class_level_id == ClassLevel.id)
            .join(Board, Board.id == BoardCourse.board_id)
            .filter(func.upper(Board.code) == school.board.strip().upper(), BoardCourse.status != "ARCHIVED")
            .order_by(ClassLevel.display_order)
            .all()
        )
        for code, _order, name in rows:
            if code not in classes:
                classes.append(code)
            if name not in subjects:
                subjects.append(name)
    return classes or [str(n) for n in range(5, 11)], subjects or ["Mathematics"]


def _existing_sections(db: Session | None, school) -> list[tuple[str, str, int, str]]:
    """(class, section, students, teachers) already on Krama for this school."""
    if db is None or school is None or not getattr(school, "id", None):
        return []
    from app.models import Student, Teacher, User
    from app.models.curriculum import BoardCourse, ClassLevel
    from app.models.teacher_assignment import TeacherSectionAssignment

    counts = (
        db.query(Student.class_name, Student.section, func.count(Student.id))
        .filter(Student.school_id == school.id, Student.is_active.is_(True))
        .group_by(Student.class_name, Student.section)
        .all()
    )
    teachers: dict[tuple[str, str], list[str]] = {}
    rows = (
        db.query(ClassLevel.code, TeacherSectionAssignment.section, User.full_name, BoardCourse.display_name)
        .join(ClassLevel, ClassLevel.id == TeacherSectionAssignment.class_level_id)
        .join(BoardCourse, BoardCourse.id == TeacherSectionAssignment.board_course_id)
        .join(Teacher, Teacher.id == TeacherSectionAssignment.teacher_id)
        .join(User, User.id == Teacher.user_id)
        .filter(TeacherSectionAssignment.school_id == school.id, TeacherSectionAssignment.end_date.is_(None))
        .all()
    )
    for code, section, name, subject in rows:
        teachers.setdefault((str(code), str(section).upper()), []).append(f"{name} ({subject})")
    keys = {(str(c or ""), str(s or "").upper()) for c, s, _n in counts} | set(teachers)
    students = {(str(c or ""), str(s or "").upper()): n for c, s, n in counts}

    def order(key):
        code, section = key
        return (int(code) if code.isdigit() else 99, code, section)

    return [(c, s, students.get((c, s), 0), "; ".join(teachers.get((c, s), []))) for c, s in sorted(keys, key=order) if c or s]


# --- small building blocks --------------------------------------------------------------------


def _logo(ws, db: Session | None, school, anchor: str) -> bool:
    if db is None or not getattr(school, "id", None):
        return False
    try:
        from app.services.school_logo_service import logo_bytes

        png = logo_bytes(db, school.id)
        if not png:
            return False
        image = XlImage(io.BytesIO(png))
        scale = 64 / max(image.height, 1)
        image.height, image.width = 64, max(1, int(image.width * scale))
        ws.add_image(image, anchor)
        return True
    except Exception:  # noqa: BLE001 -- a logo that will not draw must never stop the template
        return False


def openpyxl_column(letter: str) -> int:
    from openpyxl.utils import column_index_from_string

    return column_index_from_string(letter)


def _heading_cell(ws, column: int, text: str, *, required: bool, note: str, width: float, computed: bool = False):
    cell = ws.cell(row=1, column=column, value=text)
    cell.font = _font(bold=True, color="FFFFFFFF", size=11)
    cell.fill = _fill(GREY if computed else INK if required else MID)
    cell.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True, indent=1)
    cell.border = Border(bottom=Side(style="medium", color="FF" + SAFFRON))
    ws.column_dimensions[get_column_letter(column)].width = width
    if note:
        comment = Comment(note, "Krama")
        comment.width, comment.height = 280, 110
        cell.comment = comment


def _example_row(ws, values: list, *, check_col: int | None = None):
    for i, value in enumerate(values, start=1):
        cell = ws.cell(row=2, column=i, value=value)
        cell.font = _font(italic=True, color="FF6B7280")
        cell.number_format = "@"
        cell.alignment = Alignment(vertical="center", indent=1)


def _list_validation(ws, formula: str, column: str, *, title: str, prompt: str, error: str, strict: bool):
    dv = DataValidation(type="list", formula1=formula, allow_blank=True)
    dv.showErrorMessage = True
    dv.errorStyle = "stop" if strict else "warning"
    dv.errorTitle = title
    dv.error = error
    dv.showInputMessage = True
    dv.promptTitle = title
    dv.prompt = prompt
    ws.add_data_validation(dv)
    dv.add(f"{column}2:{column}{LAST_ROW}")


def _prompt_only(ws, column: str, *, title: str, prompt: str):
    dv = DataValidation(type="custom", formula1="TRUE", allow_blank=True)
    dv.showInputMessage = True
    dv.showErrorMessage = False
    dv.promptTitle = title
    dv.prompt = prompt
    ws.add_data_validation(dv)
    dv.add(f"{column}2:{column}{LAST_ROW}")


def _stripes_and_checks(ws, last_col: str, check_col: str, bad_formulas: dict[str, str]):
    """Alternate-row shading; the Row Check colours; red fill on cells a
    formula marks as wrong (`bad_formulas`: column letter -> formula)."""
    span = f"A2:{last_col}{LAST_ROW}"
    for column, formula in bad_formulas.items():
        ws.conditional_formatting.add(
            f"{column}2:{column}{LAST_ROW}",
            FormulaRule(formula=[f'AND(LEFT($A2,8)<>"Example:",{formula})'], fill=_fill(BAD_FILL), font=Font(color="FF" + BAD_TEXT), stopIfTrue=False),
        )
    rng = f"{check_col}2:{check_col}{LAST_ROW}"
    ws.conditional_formatting.add(rng, FormulaRule(formula=[f'LEFT({check_col}2,5)="Looks"'], font=Font(color="FF" + GOOD, bold=True)))
    ws.conditional_formatting.add(rng, FormulaRule(formula=[f'LEFT({check_col}2,7)="Example"'], font=Font(color="FF6B7280", italic=True)))
    ws.conditional_formatting.add(
        rng, FormulaRule(formula=[f'AND({check_col}2<>"",LEFT({check_col}2,5)<>"Looks",LEFT({check_col}2,7)<>"Example")'], font=Font(color="FF" + BAD_TEXT, bold=True))
    )
    # Banding goes last so it never hides the red marks (earlier rules win).
    ws.conditional_formatting.add(span, FormulaRule(formula=["MOD(ROW(),2)=1"], fill=_fill(STRIPE), stopIfTrue=False))


def _sheet_finish(ws, *, title: str, tab: str, last_col: str, school_name: str):
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{last_col}{CHECK_ROWS + 1}"
    ws.row_dimensions[1].height = 32
    end = openpyxl_column(last_col)
    _grid(ws, 2, 1, CHECK_ROWS + 1, end)
    for r in range(2, CHECK_ROWS + 2):
        ws.row_dimensions[r].height = 21
        for c in range(1, end + 1):
            cell = ws.cell(row=r, column=c)
            cell.alignment = Alignment(vertical="center", indent=1, wrap_text=False)
    ws.sheet_properties.tabColor = tab
    ws.sheet_view.zoomScale = 110
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = "1:1"
    ws.print_area = f"A1:{last_col}60"
    ws.oddFooter.left.text = f"Krama · {title} · {school_name}"
    ws.oddFooter.right.text = "Page &P of &N"


def _text_column(ws, column: str):
    for row in range(2, CHECK_ROWS + 2):
        ws[f"{column}{row}"].number_format = "@"


def _lists_sheet(wb: Workbook, classes: list[str], subjects: list[str], designations: list[str] | None = None) -> None:
    ws = wb.create_sheet("Lists")
    ws.append(["Classes", "Subjects", "Sections"] + (["Designations"] if designations else []))
    for i in range(max(len(classes), len(subjects), len(SECTION_LETTERS), len(designations or []))):
        row = [
            classes[i] if i < len(classes) else None,
            subjects[i] if i < len(subjects) else None,
            SECTION_LETTERS[i] if i < len(SECTION_LETTERS) else None,
        ]
        if designations:
            row.append(designations[i] if i < len(designations) else None)
        ws.append(row)
    ws.sheet_state = "hidden"


def _side(style="thin", colour=LINE) -> Side:
    return Side(style=style, color="FF" + colour)


def _grid(ws, r1: int, c1: int, r2: int, c2: int, colour: str = LINE) -> None:
    """A hairline border round every cell of the range (a table)."""
    box = Border(left=_side(colour=colour), right=_side(colour=colour), top=_side(colour=colour), bottom=_side(colour=colour))
    for r in range(r1, r2 + 1):
        for c in range(c1, c2 + 1):
            ws.cell(row=r, column=c).border = box


def _frame(ws, r1: int, c1: int, r2: int, c2: int, colour: str = LINE, style: str = "thin") -> None:
    """A border round the outside of the range only (a merged block, a card)."""
    for r in range(r1, r2 + 1):
        for c in range(c1, c2 + 1):
            ws.cell(row=r, column=c).border = Border(
                left=_side(style, colour) if c == c1 else None,
                right=_side(style, colour) if c == c2 else None,
                top=_side(style, colour) if r == r1 else None,
                bottom=_side(style, colour) if r == r2 else None,
            )


def _merged(ws, row: int, c1: int, c2: int, value, *, font=None, fill=None, align=None, height=None):
    cell = ws.cell(row=row, column=c1, value=value)
    ws.merge_cells(start_row=row, start_column=c1, end_row=row, end_column=c2)
    if font:
        cell.font = font
    if align:
        cell.alignment = align
    if fill:
        for c in range(c1, c2 + 1):
            ws.cell(row=row, column=c).fill = fill
    if height:
        ws.row_dimensions[row].height = height
    return cell


def _start_here(
    ws,
    db: Session | None,
    school,
    *,
    title: str,
    intro: str,
    steps: list[tuple[str, str]],
    columns: list[tuple[str, str, str, str]],
    after: list[str],
    sheet_names: str,
) -> None:
    ws.title = "Start Here"
    ws.sheet_view.showGridLines = False
    ws.sheet_view.zoomScale = 110
    ws.sheet_properties.tabColor = SAFFRON
    ws.column_dimensions["A"].width = 2.5
    for letter, width in (("B", 24), ("C", 15), ("D", 58), ("E", 30), ("F", 2.5)):
        ws.column_dimensions[letter].width = width
    left = Alignment(horizontal="left", vertical="center", indent=1, wrap_text=True)
    mid = Alignment(horizontal="center", vertical="center", wrap_text=True)

    # Banner: title block on indigo, the school's logo (or the Krama name) in a white tile.
    for r in (2, 3, 4):
        for c in (2, 3, 4):
            ws.cell(row=r, column=c).fill = _fill(INK)
    ws.merge_cells("B2:D2")
    ws.merge_cells("B3:D3")
    ws.merge_cells("B4:D4")
    ws["B2"] = title
    ws["B2"].font = _font(bold=True, size=24, color="FFFFFFFF")
    ws["B2"].alignment = Alignment(vertical="bottom", indent=1)
    ws["B3"] = school.name
    ws["B3"].font = _font(bold=True, size=13, color="FFFFD27A")
    ws["B3"].alignment = Alignment(vertical="center", indent=1)
    ws["B4"] = f"Prepared {datetime.now(IST).strftime('%d %B %Y')}  ·  Krama"
    ws["B4"].font = _font(size=10.5, color="FFC9CEE8")
    ws["B4"].alignment = Alignment(vertical="top", indent=1)
    ws.row_dimensions[2].height = 40
    ws.row_dimensions[3].height = 22
    ws.row_dimensions[4].height = 22
    ws.merge_cells("E2:E4")
    tile = ws["E2"]
    tile.fill = _fill("FFFFFF")
    tile.alignment = mid
    if not _logo(ws, db, school, "E2"):
        tile.value = "KRAMA"
        tile.font = _font(bold=True, size=20, color="FF" + INK)
    for r in (2, 3, 4):
        ws.cell(row=r, column=5).fill = _fill("FFFFFF")
    _frame(ws, 2, 2, 4, 5, INK, "medium")
    for c in range(2, 6):
        ws.cell(row=5, column=c).border = Border(top=_side("thick", SAFFRON))
    ws.row_dimensions[5].height = 5

    row = 6

    def heading(label: str) -> None:
        nonlocal row
        row += 1
        _merged(ws, row, 2, 5, label, font=_font(bold=True, size=12.5, color="FF" + INK), fill=_fill(PALE), align=left, height=26)
        for c in range(2, 6):
            ws.cell(row=row, column=c).border = Border(
                top=_side(), bottom=_side(), left=_side("thick", SAFFRON) if c == 2 else None, right=_side() if c == 5 else None
            )
        row += 1

    row += 1
    _merged(ws, row, 2, 5, intro, font=_font(size=11), align=left, height=50)
    _frame(ws, row, 2, row, 5)
    row += 1

    heading("How it works")
    for number, (head, body) in enumerate(steps, start=1):
        badge = ws.cell(row=row, column=2, value=f"{number}   {head}")
        badge.font = _font(bold=True, size=11.5, color="FFFFFFFF")
        badge.fill = _fill(MID)
        badge.alignment = Alignment(vertical="center", indent=1)
        _merged(ws, row, 3, 5, body, font=_font(size=10.5), align=left, height=34 if len(body) < 118 else 48)
        _grid(ws, row, 2, row, 5)
        row += 1

    heading(f"The {sheet_names} sheet{'s' if ' and ' in sheet_names else ''}, column by column")
    for col, head in enumerate(("Column", "Needed?", "What to type", "Example"), start=2):
        c = ws.cell(row=row, column=col, value=head)
        c.font = _font(bold=True, size=10.5, color="FFFFFFFF")
        c.fill = _fill(INK)
        c.alignment = Alignment(vertical="center", horizontal="center" if col == 3 else "left", indent=0 if col == 3 else 1)
    ws.row_dimensions[row].height = 24
    _grid(ws, row, 2, row, 5, INK)
    row += 1
    first = row
    for n, (name, needed, what, example) in enumerate(columns):
        values = (name, needed, what, example)
        for col, value in enumerate(values, start=2):
            c = ws.cell(row=row, column=col, value=value)
            c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center" if col == 3 else "left", indent=0 if col == 3 else 1)
            c.font = _font(bold=col == 2, size=10.5, color="FF" + (INK if col == 2 else "262B3A"))
            if n % 2:
                c.fill = _fill(STRIPE)
        need = ws.cell(row=row, column=3)
        need.font = _font(bold=True, size=10, color="FF" + (BAD_TEXT if needed == "Required" else WARN_TEXT if needed == "Recommended" else GREY))
        if needed == "Required":
            need.fill = _fill(BAD_FILL)
        elif needed == "Recommended":
            need.fill = _fill("FFF3D6")
        ws.row_dimensions[row].height = 32 if len(what) < 62 else 46
        row += 1
    _grid(ws, first, 2, row - 1, 5)
    _frame(ws, first - 1, 2, row - 1, 5, INK)

    heading("What the colours mean")
    key = (
        ("Full Name", INK, "FFFFFFFF", "A dark heading: you must fill this column in."),
        ("Email", MID, "FFFFFFFF", "A lighter heading: optional."),
        ("Row Check", GREY, "FFFFFFFF", "A grey heading: Krama fills this one in as you type. Leave it alone."),
        ("anita@x.in", BAD_FILL, "FF" + BAD_TEXT, "A red cell: this value is repeated or wrong. Fix it before you upload."),
    )
    first = row
    for sample, fill, text_colour, meaning in key:
        swatch = ws.cell(row=row, column=2, value=sample)
        swatch.fill = _fill(fill)
        swatch.font = _font(bold=True, size=10.5, color=text_colour if text_colour.startswith("FF") else "FF" + text_colour)
        swatch.alignment = Alignment(vertical="center", horizontal="left", indent=1)
        _merged(ws, row, 3, 5, meaning, font=_font(size=10.5), align=left, height=24)
        row += 1
    _grid(ws, first, 2, row - 1, 5)
    _frame(ws, first, 2, row - 1, 5, INK)

    heading("After you upload")
    first = row
    for line in after:
        bullet = ws.cell(row=row, column=2, value="✓")
        bullet.font = _font(bold=True, size=12, color="FF" + GOOD)
        bullet.alignment = mid
        _merged(ws, row, 3, 5, line, font=_font(size=10.5), align=left, height=32 if len(line) > 92 else 22)
        row += 1
    _grid(ws, first, 2, row - 1, 5)
    _frame(ws, first, 2, row - 1, 5, INK)

    row += 1
    for c in range(2, 6):
        ws.cell(row=row, column=c).border = Border(top=_side("thick", SAFFRON))
    _merged(
        ws,
        row + 1,
        2,
        5,
        "Krama  ·  a product of Zetta Metrics Technologies Private Limited",
        font=_font(size=9, color="FF" + GREY),
        align=Alignment(horizontal="center", vertical="center"),
        height=20,
    )
    ws.page_setup.orientation = "portrait"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_area = f"A1:F{row + 2}"


def _your_school(wb: Workbook, db: Session | None, school) -> None:
    ws = wb.create_sheet("Your School")
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.tabColor = "8D96B8"
    for i, width in enumerate((2.5, 12, 13, 22, 84, 2.5), start=1):
        ws.column_dimensions[get_column_letter(i)].width = width
    _merged(ws, 2, 2, 5, "Already on Krama", font=_font(bold=True, size=18, color="FFFFFFFF"), fill=_fill(INK), align=Alignment(vertical="center", indent=1), height=36)
    _frame(ws, 2, 2, 2, 5, INK, "medium")
    _merged(
        ws,
        3,
        2,
        5,
        f"The sections {school.name} already has on Krama, with how many students and which teachers. For reference only: nothing you change on this sheet is uploaded.",
        font=_font(size=10.5, color="FF262B3A"),
        fill=_fill(PALE),
        align=Alignment(wrap_text=True, vertical="center", indent=1),
        height=36,
    )
    _frame(ws, 3, 2, 3, 5)
    for col, head in enumerate(("Class", "Section", "Students", "Teachers and what they teach"), start=2):
        c = ws.cell(row=5, column=col, value=head)
        c.font = _font(bold=True, color="FFFFFFFF")
        c.fill = _fill(GREY)
        c.alignment = Alignment(vertical="center", horizontal="center" if col < 5 else "left", indent=0 if col < 5 else 1)
    ws.row_dimensions[5].height = 26
    rows = _existing_sections(db, school)
    if not rows:
        _merged(
            ws,
            6,
            2,
            5,
            "Nothing is on Krama for this school yet, so everyone in your file will be new.",
            font=_font(italic=True, color="FF" + GREY),
            align=Alignment(vertical="center", indent=1),
            height=30,
        )
        _grid(ws, 5, 2, 6, 5)
    for r, (cls, section, students, teachers) in enumerate(rows, start=6):
        for col, value in enumerate((cls, section, students, teachers or "No teacher yet"), start=2):
            c = ws.cell(row=r, column=col, value=value)
            c.font = _font(size=10.5, color="FF" + (GREY if col == 5 and not teachers else "262B3A"))
            c.alignment = Alignment(vertical="center", horizontal="center" if col < 5 else "left", indent=0 if col < 5 else 1, wrap_text=col == 5)
            if (r - 6) % 2:
                c.fill = _fill(STRIPE)
        ws.row_dimensions[r].height = 24
    if rows:
        _grid(ws, 5, 2, 5 + len(rows), 5)
    ws.freeze_panes = "A6"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True


def _props(wb: Workbook, school, title: str) -> None:
    wb.properties.title = f"{title} · {school.name}"
    wb.properties.creator = "Krama"
    wb.properties.company = "Zetta Metrics Technologies Private Limited"


# --- the School Setup workbook ----------------------------------------------------------------


def setup_template_bytes(db: Session | None, school, *, default_subject: str = "Mathematics") -> bytes:
    classes, subjects = _offered(db, school)
    wb = Workbook()
    _start_here(
        wb.active,
        db,
        school,
        title="Krama School Setup",
        intro=(
            "One file for your teachers and your students. Fill in the Teachers and Students sheets, save it, and upload it on "
            "Classes & Sections. Krama checks the whole file first and lists anything to fix; nothing is created until every row is right."
        ),
        steps=[
            ("Fill in", "Type over the grey example rows on the Teachers and Students sheets (delete the examples, or leave them: they are skipped). Use the dropdowns; the Row Check column tells you if a row needs attention."),
            ("Save", "Save this file as it is (.xlsx). Do not rename the sheets or the headings in the first row."),
            ("Check", "On Classes & Sections choose this file. Krama reads every row and lists problems by sheet and row, or tells you what it would create. It writes nothing yet."),
            ("Import", "When the check is clean, press Import. Everyone gets a sign-in code and a first password, shown once, with sign-in slips to print."),
        ],
        columns=[
            ("Teachers: Full Name", "Required", "As it should appear to students and parents.", "Anita Rao"),
            ("Teachers: Email", "Optional", "Each email belongs to one teacher alone.", "anita.rao@yourschool.in"),
            ("Teachers: Mobile", "Optional", "A 10-digit Indian mobile number. Each belongs to one teacher alone.", "9876543210"),
            ("Teachers: Subject", "Optional", f"Pick from the list. Blank means {default_subject}. A teacher who teaches two subjects takes one row for each.", default_subject),
            ("Teachers: Sections", "Required", "Every section this teacher teaches that subject in: class and section together, separated by commas.", "5A, 5B"),
            ("Students: Full Name", "Required", "As it should appear on the report card.", "Aarav Sharma"),
            ("Students: Class", "Required", "The class number, picked from the list.", "5"),
            ("Students: Section", "Required", "The section letter, picked from the list.", "A"),
            ("Students: Roll Number", "Recommended", "Unique in the section. 01 and 1 count as the same number.", "12"),
        ],
        after=[
            "Each new teacher and student gets a code and a first password, shown once. Print the sign-in slips straight away.",
            "People already on Krama are recognised and left as they are, so a corrected file can be uploaded again.",
            "A section that already has a teacher for that subject is not changed here; moving a class to another teacher is a transfer.",
            "Mobile numbers and emails already used elsewhere on Krama are refused when you press Import, never at the check.",
        ],
        sheet_names="Teachers and Students",
    )

    # Teachers
    t = wb.create_sheet("Teachers")
    spec = [
        ("Full Name", True, "Required. As it should appear to students and parents.", 34),
        ("Email", False, "Optional. One teacher's alone; the teacher can sign in with it.", 32),
        ("Mobile", False, "Optional. 10-digit Indian mobile number, one teacher's alone.", 18),
        ("Subject", False, f"Optional. Pick from the list; blank means {default_subject}.", 22),
        ("Sections", True, "Required. The sections this teacher teaches this subject in, class and section together: 5A, 5B.", 28),
    ]
    for i, (name, req, note, width) in enumerate(spec, start=1):
        _heading_cell(t, i, name, required=req, note=note, width=width)
    _heading_cell(t, 6, "Row Check", required=False, note="Filled in for you as you type. Leave this column alone.", width=34, computed=True)
    _example_row(t, ["Example: Anita Rao (delete this row)", "anita.rao@yourschool.in", "9876543210", default_subject, "5A, 5B"])
    for r in range(2, CHECK_ROWS + 2):
        t[f"F{r}"] = (
            f'=IF(COUNTA(A{r}:E{r})=0,"",IF(LEFT(A{r},8)="Example:","Example row: skipped",'
            f'IF(TRIM(A{r})="","Add the full name",'
            f'IF(AND(B{r}<>"",ISERROR(FIND("@",B{r}))),"Check the email address",'
            f'IF(AND(B{r}<>"",COUNTIFS($B$2:$B${LAST_ROW},B{r},$A$2:$A${LAST_ROW},"<>"&A{r})>0),"Email used by another teacher",'
            f'IF(AND(C{r}<>"",COUNTIFS($C$2:$C${LAST_ROW},C{r},$A$2:$A${LAST_ROW},"<>"&A{r})>0),"Mobile used by another teacher",'
            f'IF(AND(C{r}<>"",LEN(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(C{r}," ",""),"-",""),"+91",""))<10),"Mobile needs 10 digits",'
            f'IF(TRIM(E{r})="","Add the sections taught","Looks good"))))))))'
        )
        t[f"F{r}"].font = _font(size=10)
        t[f"F{r}"].alignment = Alignment(indent=1)
        t[f"A{r}"].alignment = Alignment(indent=1)
    for column in "BCDE":
        for r in range(2, CHECK_ROWS + 2):
            t[f"{column}{r}"].alignment = Alignment(indent=1)
    for column in "BCDE":
        _text_column(t, column)
    _list_validation(t, f"=Lists!$B$2:$B${len(subjects) + 1}", "D", title="Subject", prompt="Pick a subject. Blank means " + default_subject + ".", error="Choose a subject from the list, or leave it blank.", strict=True)
    _prompt_only(t, "E", title="Sections taught", prompt="Class and section together, separated by commas, like 5A, 5B.")
    _prompt_only(t, "C", title="Mobile", prompt="A 10-digit Indian mobile number. +91 and spaces are fine.")
    _stripes_and_checks(
        t,
        "F",
        "F",
        {
            "A": 'AND(COUNTA($B2:$E2)>0,TRIM($A2)="",LEFT($A2,8)<>"Example:")',
            "B": f'AND($B2<>"",COUNTIFS($B$2:$B${LAST_ROW},$B2,$A$2:$A${LAST_ROW},"<>"&$A2)>0)',
            "C": f'AND($C2<>"",COUNTIFS($C$2:$C${LAST_ROW},$C2,$A$2:$A${LAST_ROW},"<>"&$A2)>0)',
        },
    )
    _sheet_finish(t, title="Teachers", tab=INK, last_col="F", school_name=school.name)

    # Students
    s = wb.create_sheet("Students")
    spec = [
        ("Full Name", True, "Required. As it should appear on the report card.", 34),
        ("Class", True, "Required. The class number, picked from the list.", 10),
        ("Section", True, "Required. The section letter, picked from the list.", 12),
        ("Roll Number", False, "Recommended. Unique in the section. 01 and 1 are the same number.", 16),
    ]
    for i, (name, req, note, width) in enumerate(spec, start=1):
        _heading_cell(s, i, name, required=req, note=note, width=width)
    _heading_cell(s, 5, "Row Check", required=False, note="Filled in for you as you type. Leave this column alone.", width=36, computed=True)
    _example_row(s, ["Example: Aarav Sharma (delete this row)", classes[0], "A", "1"])
    for r in range(2, CHECK_ROWS + 2):
        s[f"E{r}"] = (
            f'=IF(COUNTA(A{r}:D{r})=0,"",IF(LEFT(A{r},8)="Example:","Example row: skipped",'
            f'IF(TRIM(A{r})="","Add the full name",'
            f'IF(ISNA(MATCH(TRIM(B{r}&""),Lists!$A$2:$A${len(classes) + 1},0)),"Choose a class from the list",'
            f'IF(TRIM(C{r})="","Add the section",'
            f'IF(AND(D{r}<>"",COUNTIFS($B$2:$B${LAST_ROW},B{r},$C$2:$C${LAST_ROW},C{r},$D$2:$D${LAST_ROW},D{r})>1),"Roll number repeated in this section",'
            f'IF(D{r}="","Looks good (add a roll number if you have one)","Looks good")))))))'
        )
        s[f"E{r}"].font = _font(size=10)
        s[f"E{r}"].alignment = Alignment(indent=1)
        for column in "ABCD":
            s[f"{column}{r}"].alignment = Alignment(indent=1)
    for column in "ABCD":
        _text_column(s, column)
    _list_validation(s, f"=Lists!$A$2:$A${len(classes) + 1}", "B", title="Class", prompt=f"Pick the class: {', '.join(classes)}.", error=f"Choose one of {', '.join(classes)}.", strict=True)
    _list_validation(s, f"=Lists!$C$2:$C${len(SECTION_LETTERS) + 1}", "C", title="Section", prompt="Pick the section letter. Type another letter if you need one.", error="Sections are letters, like A or B. Keep it?", strict=False)
    _prompt_only(s, "D", title="Roll number", prompt="Unique within the section. Leave blank if the school has none yet.")
    _stripes_and_checks(
        s,
        "E",
        "E",
        {
            "A": 'AND(COUNTA($B2:$D2)>0,TRIM($A2)="",LEFT($A2,8)<>"Example:")',
            "D": f'AND($D2<>"",COUNTIFS($B$2:$B${LAST_ROW},$B2,$C$2:$C${LAST_ROW},$C2,$D$2:$D${LAST_ROW},$D2)>1)',
        },
    )
    _sheet_finish(s, title="Students", tab=MID, last_col="E", school_name=school.name)

    _your_school(wb, db, school)
    _lists_sheet(wb, classes, subjects)
    wb.active = 0
    _props(wb, school, "School Setup")
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


# --- the People templates ---------------------------------------------------------------------

DESIGNATIONS = ["PRT", "TGT", "PGT", "Head of Department", "Coordinator", "Vice Principal", "Principal"]


def people_template_bytes(db: Session | None, school, role: str) -> bytes:
    """The bulk-import workbook for one role on People. Its first sheet is the
    one to fill in (the reader takes the sheet named for the role, else the
    first), so older readers of "the active sheet" still work."""
    role = role.upper()
    classes, subjects = _offered(db, school)
    wb = Workbook()
    is_student = role == "STUDENT"
    sheet = wb.active
    sheet.title = "Students" if is_student else "Teachers"
    if is_student:
        spec = [
            ("Full Name", True, "Required. As it should appear on the report card.", 34),
            ("Email", False, "Optional. A student can sign in with their code instead.", 30),
            ("Class Name", False, "The class number, picked from the list.", 12),
            ("Section", False, "The section letter, picked from the list.", 12),
            ("Password", False, "Optional first password: at least 8 characters, with a letter and a number. Blank means Krama makes a random one.", 24),
        ]
        example = ["Example: Ananya Rao (delete this row)", "", classes[0], "A", ""]
    else:
        spec = [
            ("Full Name", True, "Required. As it should appear to students and parents.", 34),
            ("Email", False, "Optional. A teacher can sign in with their code instead.", 30),
            ("Designation", False, "Pick from the list, or type your own.", 22),
            ("Subject Specialization", False, "Pick from the list.", 26),
            ("Qualification", False, "For example B.Ed, M.Sc.", 18),
            ("Password", False, "Optional first password: at least 8 characters, with a letter and a number. Blank means Krama makes a random one.", 24),
        ]
        example = ["Example: Ravi Kumar (delete this row)", "ravi.kumar@yourschool.in", "TGT", subjects[0], "B.Ed", ""]
    for i, (name, req, note, width) in enumerate(spec, start=1):
        _heading_cell(sheet, i, name, required=req, note=note, width=width)
    check_col = len(spec) + 1
    last = get_column_letter(check_col)
    _heading_cell(sheet, check_col, "Row Check", required=False, note="Filled in for you as you type. Leave this column alone.", width=36, computed=True)
    _example_row(sheet, example)
    letters = {name: get_column_letter(i) for i, (name, *_rest) in enumerate(spec, start=1)}
    A, E, P = letters["Full Name"], letters["Email"], letters["Password"]
    for r in range(2, CHECK_ROWS + 2):
        tail = f'IF(AND({P}{r}<>"",LEN({P}{r})<8),"Password needs 8 or more characters","Looks good")'
        if is_student:
            C = letters["Class Name"]
            tail = f'IF(AND({C}{r}<>"",ISNA(MATCH(TRIM({C}{r}&""),Lists!$A$2:$A${len(classes) + 1},0))),"Choose a class from the list",{tail})'
        sheet[f"{last}{r}"] = (
            f'=IF(COUNTA({A}{r}:{get_column_letter(len(spec))}{r})=0,"",IF(LEFT({A}{r},8)="Example:","Example row: skipped",'
            f'IF(TRIM({A}{r})="","Add the full name",'
            f'IF(AND({E}{r}<>"",ISERROR(FIND("@",{E}{r}))),"Check the email address",'
            f'IF(AND({E}{r}<>"",COUNTIF(${E}$2:${E}${LAST_ROW},{E}{r})>1),"Email repeated in this file",{tail})))))'
        )
        sheet[f"{last}{r}"].font = _font(size=10)
        for i in range(1, len(spec) + 2):
            sheet.cell(row=r, column=i).alignment = Alignment(indent=1)
    for i in range(2, len(spec) + 1):
        _text_column(sheet, get_column_letter(i))
    if is_student:
        _list_validation(sheet, f"=Lists!$A$2:$A${len(classes) + 1}", letters["Class Name"], title="Class", prompt=f"Pick the class: {', '.join(classes)}.", error=f"Choose one of {', '.join(classes)}.", strict=True)
        _list_validation(sheet, f"=Lists!$C$2:$C${len(SECTION_LETTERS) + 1}", letters["Section"], title="Section", prompt="Pick the section letter.", error="Sections are letters, like A or B. Keep it?", strict=False)
    else:
        _list_validation(sheet, f"=Lists!$D$2:$D${len(DESIGNATIONS) + 1}", letters["Designation"], title="Designation", prompt="Pick one, or type your own.", error="Keep this designation?", strict=False)
        _list_validation(sheet, f"=Lists!$B$2:$B${len(subjects) + 1}", letters["Subject Specialization"], title="Subject", prompt="Pick a subject.", error="Keep this subject?", strict=False)
    _prompt_only(sheet, P, title="First password", prompt="Optional. At least 8 characters with a letter and a number; not a common word or the person's own name. Blank means a random one.")
    _stripes_and_checks(
        sheet,
        last,
        last,
        {
            A: f'AND(COUNTA($A2:${get_column_letter(len(spec))}2)>0,TRIM(${A}2)="",LEFT(${A}2,8)<>"Example:")',
            E: f'AND(${E}2<>"",COUNTIF(${E}$2:${E}${LAST_ROW},${E}2)>1)',
        },
    )
    _sheet_finish(sheet, title="Students" if is_student else "Teachers", tab=INK, last_col=last, school_name=school.name)

    word = "students" if is_student else "teachers"
    cols = []
    for (name, req, note, _w), sample in zip(spec, example):
        sample = sample.replace("Example: ", "").replace(" (delete this row)", "")
        cols.append((name, "Required" if req else "Optional", note.replace("Required. ", "").replace("Optional. ", ""), sample))
    _start_here(
        wb.create_sheet("Start Here"),
        db,
        school,
        title=f"Add {word} to Krama",
        intro=f"Fill in the {sheet.title} sheet, save the file and upload it on People, under Bulk Import. Only Full Name is required. Rows Krama can accept are imported even if others in the file are refused, and each refusal says why.",
        steps=[
            ("Fill in", f"One {word[:-1]} per row on the {sheet.title} sheet. Use the dropdowns; Row Check tells you if a row needs attention."),
            ("Save", "Save as .xlsx (or .csv). Keep the headings in the first row as they are."),
            ("Import", "On People choose Bulk Import, pick the file and press Import. You can fix any refused rows and upload just those again."),
        ],
        columns=cols,
        after=[
            "Each new person gets a sign-in code and a first password, shown once. Download Sign-In Details (.csv) straight away.",
            "Everyone chooses their own password the first time they sign in, whether you set the first one or Krama did.",
            "Passwords typed into the Password column are visible to anyone who sees this file. Delete the file when you are done.",
        ],
        sheet_names=sheet.title,
    )
    wb.active = 0
    _lists_sheet(wb, classes, subjects, DESIGNATIONS)
    _props(wb, school, "Add Students" if is_student else "Add Teachers")
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
