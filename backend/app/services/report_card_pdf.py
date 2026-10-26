"""Report cards as PDF (#188, 23 Oct 2026).

Draws cards exactly as issued (ReportCard.card_json, built by
report_card_service.build_cards), so the same card prints the same way
whenever it is downloaded. One card per page; the Term 1 card on A4
portrait, the Year-End card on A4 landscape (it carries both terms).

ReportLab's built-in Helvetica covers Latin script only; a name in another
script would print as boxes. Rosters are in English today; a Unicode font
can be added here when a school needs one.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Image as PdfImage
from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.core.brand import PRODUCT_NAME
from app.services.assessment_service import SCHOOL_TIMEZONE

INK = colors.HexColor("#1c1b29")
MUTED = colors.HexColor("#5b5a6b")
LINE = colors.HexColor("#c9c7d6")
HEAD = colors.HexColor("#eeedf5")
BRAND = colors.HexColor("#2b2370")

_BASE = ParagraphStyle("base", fontName="Helvetica", fontSize=9, leading=11.5, textColor=INK)
_SMALL = ParagraphStyle("small", parent=_BASE, fontSize=7.5, leading=9.5, textColor=MUTED)
_CELL = ParagraphStyle("cell", parent=_BASE, fontSize=8.5, leading=10.5)
_CELL_HEAD = ParagraphStyle("cellhead", parent=_CELL, fontName="Helvetica-Bold", fontSize=7.5, leading=9.5)
# Headings for a subject with many components (a CBSE-style year has eight).
_CELL_HEAD_TIGHT = ParagraphStyle("cellheadtight", parent=_CELL_HEAD, fontSize=6.6, leading=8.2)
_SCHOOL = ParagraphStyle("school", parent=_BASE, fontName="Helvetica-Bold", fontSize=16, leading=19, alignment=TA_CENTER, textColor=BRAND)
_CENTER = ParagraphStyle("center", parent=_BASE, alignment=TA_CENTER)
_TITLE = ParagraphStyle("title", parent=_BASE, fontName="Helvetica-Bold", fontSize=12, leading=15, alignment=TA_CENTER)
_SECTION = ParagraphStyle("section", parent=_BASE, fontName="Helvetica-Bold", fontSize=10, leading=13, spaceBefore=6, spaceAfter=3, textColor=BRAND)

_STATUS = {"ABSENT": "AB", "EXEMPT": "EX", "MISSING": "-"}


def _p(text, style=_CELL) -> Paragraph:
    return Paragraph(escape(str(text if text is not None else "")), style)


def _grid(rows, widths, *, header_rows=1) -> Table:
    table = Table(rows, colWidths=widths, repeatRows=header_rows)
    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                ("BACKGROUND", (0, 0), (-1, header_rows - 1), HEAD),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return table


def _day(iso: str | None) -> str:
    if not iso:
        return ""
    try:
        moment = datetime.fromisoformat(iso).astimezone(SCHOOL_TIMEZONE)
    except ValueError:
        return ""
    return moment.strftime("%d %b %Y").lstrip("0")


def _short(text, limit: int) -> str:
    """Very long names are cut on the PDF, so one row always fits a page."""
    text = str(text or "")
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _mark(cell: dict) -> str:
    if cell["status"] == "MARKS":
        return cell["marks"] or ""
    return _STATUS.get(cell["status"], "")


def _bands_text(bands: list[dict]) -> str:
    ordered = sorted(bands, key=lambda b: Decimal(b["minPercent"]), reverse=True)
    parts = []
    top = None
    for band in ordered:
        low = band["minPercent"]
        parts.append(f"{band['label']} {low}" + (f" to below {top}" if top is not None else " and above"))
        top = low
    return "; ".join(parts)


def _subject_block(subject: dict, width: float, year_end: bool) -> list:
    components = subject["components"]
    head_style = _CELL_HEAD_TIGHT if len(components) > 5 else _CELL_HEAD
    head = [_p("Subject", _CELL_HEAD)] + [_p(f"{_short(c['name'], 40)} ({c['maxMarks']})", head_style) for c in components]
    row = [_p(_short(subject["subject"], 80))] + [_p(_mark(c)) for c in components]
    # The figures after the components take fixed widths; the components
    # share what is left, so their names wrap between words, not inside one.
    tail_widths = []
    if year_end:
        for term, label in (("TERM_1", "Term 1 %"), ("TERM_2", "Term 2 %")):
            if term in subject.get("terms", {}):
                head.append(_p(label, _CELL_HEAD))
                row.append(_p(subject["terms"][term]["result"] or "-"))
                tail_widths.append(15 * mm)
    head += [_p("Year %" if year_end else "Result %", _CELL_HEAD), _p("Grade", _CELL_HEAD), _p("Outcome", _CELL_HEAD)]
    row += [_p(subject["result"] or "-"), _p(subject["grade"] or "-"), _p(subject["outcomeLabel"] or "-")]
    tail_widths += [15 * mm, 12 * mm, 25 * mm]
    first = 30 * mm
    each = (width - first - sum(tail_widths)) / max(len(components), 1)
    block = [_grid([head, row], [first] + [each] * len(components) + tail_widths)]
    if subject.get("notes"):
        block.append(_p("; ".join(subject["notes"]), _SMALL))
    block.append(Spacer(1, 3 * mm))
    return [KeepTogether(block)]


def _logo_flowable(logo: bytes | None):
    """The school's logo (#202), centred above its name: 16 mm tall, at most
    55 mm wide. None when there is no logo or it can't be read."""
    from app.services.school_logo_service import readable_logo  # decoded in full: a damaged logo is left out

    logo = readable_logo(logo)
    if not logo:
        return None
    try:
        width, height = ImageReader(BytesIO(logo)).getSize()
    except Exception:  # noqa: BLE001 - a bad logo must not stop the card
        return None
    h = 16 * mm
    w = h * width / height if height else h
    if w > 55 * mm:
        w, h = 55 * mm, 55 * mm * height / width
    image = PdfImage(BytesIO(logo), width=w, height=h, mask="auto")
    image.hAlign = "CENTER"
    return image


def _card_story(card: dict, width: float, logo: bytes | None = None) -> list:
    year_end = card["cardTerm"] == "YEAR_END"
    student = card["student"]
    school = card["school"]
    mark = _logo_flowable(logo)
    story: list = ([mark, Spacer(1, 2.5 * mm)] if mark else []) + [
        Paragraph(escape(school["name"]), _SCHOOL),
        _p(school.get("city") or "", _CENTER),
        Spacer(1, 2 * mm),
        Paragraph(escape(f"{card['title']}, {card['year']}"), _TITLE),
        Spacer(1, 4 * mm),
    ]
    facts = [
        [_p("Student", _CELL_HEAD), _p(student["name"]), _p("Student Code", _CELL_HEAD), _p(student["code"])],
        [
            _p("Class", _CELL_HEAD),
            _p(f"{student['classLevel']}, Section {student['section']}"),
            _p("Date of Birth", _CELL_HEAD),
            _p(student.get("dob") or "-"),
        ],
    ]
    quarter = width / 4
    facts_table = _grid(facts, [quarter * 0.7, quarter * 1.3, quarter * 0.7, quarter * 1.3], header_rows=0)
    facts_table.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, -1), HEAD), ("BACKGROUND", (2, 0), (2, -1), HEAD)]))
    story += [facts_table, Paragraph("Scholastic Areas", _SECTION)]
    for subject in card["subjects"]:
        story += _subject_block(subject, width, year_end)

    terms = ["TERM_1", "TERM_2"] if year_end else ["TERM_1"]
    labels = {"TERM_1": "Term 1", "TERM_2": "Term 2"}
    co = card["coScholastic"]
    co_rows = [[_p("Co-Scholastic Area", _CELL_HEAD)] + [_p(labels[t], _CELL_HEAD) for t in terms]]
    for area in co["areas"]:
        co_rows.append([_p(area)] + [_p(co["grades"].get(t, {}).get(area) or "-") for t in terms])
    attendance_rows = [[_p("Attendance", _CELL_HEAD)] + [_p(labels[t], _CELL_HEAD) for t in terms]]
    present_row = [_p("Days present / working days")]
    for t in terms:
        a = card["attendance"].get(t, {})
        present_row.append(
            _p(f"{a['daysPresent']} / {a['workingDays']}" if a.get("workingDays") is not None and a.get("daysPresent") is not None else "-")
        )
    attendance_rows.append(present_row)
    half = (width - 6 * mm) / 2
    first_col = half * 0.55
    other = (half - first_col) / len(terms)
    side_by_side = Table(
        [[_grid(co_rows, [first_col] + [other] * len(terms)), _grid(attendance_rows, [first_col] + [other] * len(terms))]],
        colWidths=[half + 3 * mm, half + 3 * mm],
    )
    side_by_side.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    story += [Paragraph("Co-Scholastic Areas and Attendance", _SECTION), side_by_side]
    scale = "; ".join(f"{s['label']} {s['meaning']}".strip() for s in co["scale"])
    story.append(_p(f"Co-scholastic grades: {scale}.", _SMALL))

    story += [Paragraph("Class Teacher's Remark", _SECTION), _p(card.get("remark") or "-", _BASE)]

    bands = [tuple((b["label"], b["minPercent"]) for b in s["gradeBands"]) for s in card["subjects"]]
    if card["subjects"]:
        if len(set(bands)) == 1:
            story.append(Spacer(1, 3 * mm))
            story.append(_p(f"Grades (%): {_bands_text(card['subjects'][0]['gradeBands'])}.", _SMALL))
        else:
            for s in card["subjects"]:
                story.append(_p(f"Grades for {s['subject']} (%): {_bands_text(s['gradeBands'])}.", _SMALL))
    story.append(_p("AB: Absent (counts as 0). EX: Exempt (left out; the other parts count in proportion).", _SMALL))
    story.append(Spacer(1, 14 * mm))
    gap = 12 * mm
    sign = (width - 2 * gap) / 3
    signatures = Table(
        [[_p("Class Teacher", _CENTER), "", _p("Principal", _CENTER), "", _p("Parent or Guardian", _CENTER)]],
        colWidths=[sign, gap, sign, gap, sign],
    )
    signatures.setStyle(
        TableStyle([("LINEABOVE", (0, 0), (0, 0), 0.5, INK), ("LINEABOVE", (2, 0), (2, 0), 0.5, INK), ("LINEABOVE", (4, 0), (4, 0), 0.5, INK)])
    )
    story.append(signatures)
    story.append(Spacer(1, 4 * mm))
    story.append(_p(f"Issued on {_day(card.get('issuedAt'))}. Prepared with {PRODUCT_NAME}.", _SMALL))
    return story


def render(cards: list[dict], logo: bytes | None = None) -> bytes:
    """One PDF holding the given cards, one per page (all the same term)."""
    year_end = bool(cards) and cards[0]["cardTerm"] == "YEAR_END"
    page = landscape(A4) if year_end else A4
    buffer = BytesIO()
    margin = 14 * mm
    doc = SimpleDocTemplate(
        buffer,
        pagesize=page,
        leftMargin=margin,
        rightMargin=margin,
        topMargin=margin,
        bottomMargin=margin,
        title=cards[0]["title"] if cards else "Report Card",
        author=PRODUCT_NAME,
    )
    width = page[0] - 2 * margin
    story: list = []
    for index, card in enumerate(cards):
        if index:
            story.append(PageBreak())
        story += _card_story(card, width, logo)
    if not story:
        story.append(_p("No cards."))
    doc.build(story)
    return buffer.getvalue()
