"""The weekly parent report as PDF (#187, 26 Oct 2026).

Draws each child's page exactly as issued (WeeklyReport.report_json, built
by weekly_report_service.build), one child per A4 page, in the product's
own typefaces (Fraunces for headings and figures, Plus Jakarta Sans for
text; both SIL Open Font License, in app/assets/fonts).

The page, top to bottom: the school's band (crest, name, the week); the
child's details; the week at a glance (four figures); this week's practice;
strengths and skills to work on; the teacher's notes; signature lines; and
a footer saying who issued it and when. Shailesh, 26 Oct 2026: "the pdf
needs to be top notch and visually stunning, worthy to be associated with a
school".
"""
from __future__ import annotations

from datetime import date
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from app.core.brand import PRODUCT_NAME
from app.services.report_card_pdf import _day
from app.services.school_logo_service import readable_logo

# --- type ----------------------------------------------------------------------------------

_FONTS = Path(__file__).resolve().parent.parent / "assets" / "fonts"
SERIF, SERIF_ITALIC = "Helvetica-Bold", "Helvetica-Oblique"
SANS, SANS_MEDIUM, SANS_SEMI, SANS_BOLD = "Helvetica", "Helvetica", "Helvetica-Bold", "Helvetica-Bold"


def _register_fonts() -> None:
    """The product's typefaces; Helvetica if a file is missing, so a PDF is
    always made."""
    global SERIF, SERIF_ITALIC, SANS, SANS_MEDIUM, SANS_SEMI, SANS_BOLD
    wanted = {
        "WR-Serif": "Fraunces-SemiBold.ttf",
        "WR-SerifItalic": "Fraunces-Italic.ttf",
        "WR-Sans": "PlusJakartaSans-Regular.ttf",
        "WR-SansMedium": "PlusJakartaSans-Medium.ttf",
        "WR-SansSemi": "PlusJakartaSans-SemiBold.ttf",
        "WR-SansBold": "PlusJakartaSans-Bold.ttf",
    }
    try:
        for name, file in wanted.items():
            if name not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(name, str(_FONTS / file)))
        pdfmetrics.registerFontFamily("WR-Sans", normal="WR-Sans", bold="WR-SansBold", italic="WR-Sans", boldItalic="WR-SansBold")
    except Exception:  # noqa: BLE001 - a missing font must not stop the PDF
        return
    SERIF, SERIF_ITALIC = "WR-Serif", "WR-SerifItalic"
    SANS, SANS_MEDIUM, SANS_SEMI, SANS_BOLD = "WR-Sans", "WR-SansMedium", "WR-SansSemi", "WR-SansBold"


_register_fonts()

# --- colour --------------------------------------------------------------------------------

INK = colors.HexColor("#1b1a2e")
BODY = colors.HexColor("#3a384d")
MUTED = colors.HexColor("#6b6880")
FAINT = colors.HexColor("#9895ab")
LINE = colors.HexColor("#e4e2ee")
TINT = colors.HexColor("#f6f5fb")
BRAND = colors.HexColor("#2b2370")
BRAND_DEEP = colors.HexColor("#1c1650")
BRAND_SOFT = colors.HexColor("#c9c5ea")
GOLD = colors.HexColor("#d9a43a")
WHITE = colors.white

# Status: (text, tint) pairs, each well above 4.5:1 text on its tint.
TONES = {
    "good": (colors.HexColor("#17714b"), colors.HexColor("#e2f2e9")),
    "late": (colors.HexColor("#8a5a06"), colors.HexColor("#fbefd6")),
    "missed": (colors.HexColor("#ad3426"), colors.HexColor("#fbe6e2")),
    "open": (colors.HexColor("#4f4d66"), colors.HexColor("#efeef5")),
}
STATUS_TONE = {
    "DONE_ON_TIME": "good",
    "DONE": "good",
    "DONE_LATE": "late",
    "NOT_DONE": "missed",
    "IN_PROGRESS": "open",
    "NOT_STARTED": "open",
}

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm
BAND_H = 34 * mm
FOOT_BODY = 39 * mm  # the body stops here: signatures and footer below
CONTENT_W = PAGE_W - 2 * MARGIN
PAD = 4.2 * mm


def _style(name: str, **kw) -> ParagraphStyle:
    base = {"fontName": SANS, "fontSize": 9, "leading": 12.5, "textColor": BODY}
    base.update(kw)
    return ParagraphStyle(name, **base)


S_BODY = _style("wr-body", fontSize=9.5, leading=14)
S_SET = _style("wr-set", fontName=SANS_SEMI, fontSize=9, leading=12, textColor=INK)
S_SET_SUB = _style("wr-setsub", fontSize=7.5, leading=10, textColor=MUTED)
S_CELL = _style("wr-cell", fontSize=8.5, leading=11, textColor=BODY)
S_CELL_R = _style("wr-cellr", fontName=SANS_SEMI, fontSize=9, leading=11, textColor=INK, alignment=TA_RIGHT)
S_NAME = _style("wr-name", fontName=SANS_SEMI, fontSize=10, leading=12.5, textColor=INK)
S_NOTE = _style("wr-note", fontName=SERIF_ITALIC, fontSize=10.2, leading=14, textColor=INK)
S_EMPTY = _style("wr-empty", fontSize=8.5, leading=12, textColor=MUTED, alignment=TA_CENTER)
S_SMALL = _style("wr-small", fontSize=7.2, leading=10, textColor=MUTED)
S_SKILL_SUB = _style("wr-skillsub", fontSize=7.4, leading=10, textColor=MUTED)
S_NO_NOTE = _style("wr-nonote", fontSize=9, leading=12, textColor=MUTED)


def _p(text, style: ParagraphStyle) -> Paragraph:
    return Paragraph(escape(str(text if text is not None else "")), style)


def _caps(text: str) -> str:
    return escape(text.upper())


def _fit(text: str, font: str, size: float, width: float, smallest: float) -> float:
    while size > smallest and pdfmetrics.stringWidth(text, font, size) > width:
        size -= 0.5
    return size


def _clip(text: str, font: str, size: float, width: float) -> str:
    if pdfmetrics.stringWidth(text, font, size) <= width:
        return text
    while text and pdfmetrics.stringWidth(text + "…", font, size) > width:
        text = text[:-1]
    return text.rstrip() + "…"


def _spaced(c, x: float, y: float, text: str, font: str, size: float, spacing: float, *, right: bool = False) -> float:
    """Letter-spaced capitals; returns the width drawn."""
    width = pdfmetrics.stringWidth(text, font, size) + spacing * max(len(text) - 1, 0)
    t = c.beginText(x - width if right else x, y)
    t.setFont(font, size)
    t.setCharSpace(spacing)
    t.textOut(text)
    # Character spacing is part of the page's text state: put it back, or
    # every later line on the page is spaced out too.
    t.setCharSpace(0)
    c.drawText(t)
    return width


def _plain_table(table: Table) -> Table:
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return table


# --- pieces -------------------------------------------------------------------------------


class SectionHeading(Flowable):
    """A spaced-capitals heading over a short gold rule, with a hairline
    running to the edge."""

    def __init__(self, text: str, space_before: float = 4.6 * mm, space_after: float = 2.6 * mm):
        super().__init__()
        self.text = text.upper()
        self.space_before = space_before
        self.space_after = space_after

    def wrap(self, aw, ah):
        self.width = aw
        self.height = self.space_before + 10 + self.space_after
        return aw, self.height

    def draw(self):
        c = self.canv
        y = self.space_after + 3
        c.setFillColor(BRAND)
        width = _spaced(c, 0, y, self.text, SANS_BOLD, 7.6, 1.3)
        c.setStrokeColor(LINE)
        c.setLineWidth(0.8)
        c.line(width + 8, y + 2.7, self.width, y + 2.7)
        c.setFillColor(GOLD)
        c.rect(0, y - 4.6, 16, 1.5, stroke=0, fill=1)


class Label(Flowable):
    """Small spaced capitals: the labels across the page."""

    def __init__(self, text: str, *, size: float = 6.4, color=MUTED, spacing: float = 0.8, align: str = "left"):
        super().__init__()
        self.text = text.upper()
        self.size = size
        self.color = color
        self.spacing = spacing
        self.align = align

    def wrap(self, aw, ah):
        self.width = aw
        self.height = self.size + 1.6
        return aw, self.height

    def draw(self):
        self.canv.setFillColor(self.color)
        if self.align == "right":
            _spaced(self.canv, self.width, 1.4, self.text, SANS_BOLD, self.size, self.spacing, right=True)
        else:
            _spaced(self.canv, 0, 1.4, self.text, SANS_BOLD, self.size, self.spacing)


class FitText(Flowable):
    """One line of text that shrinks to fit its box, so a long code never
    breaks mid-way. One too long even at the floor size goes on two lines,
    split after the hyphen nearest the middle (codes are hyphenated)."""

    def __init__(self, text: str, *, font: str, size: float, color=INK, smallest: float = 8.5):
        super().__init__()
        self.text = str(text if text is not None else "")
        self.font = font
        self.size = size
        self.color = color
        self.smallest = smallest

    def wrap(self, aw, ah):
        self.width = aw
        self.lines = [self.text]
        self.font_size = _fit(self.text, self.font, self.size, aw, self.smallest)
        if pdfmetrics.stringWidth(self.text, self.font, self.font_size) > aw and "-" in self.text:
            cuts = [i for i, ch in enumerate(self.text) if ch == "-"]
            cut = min(cuts, key=lambda i: abs(i - len(self.text) / 2))
            self.lines = [self.text[: cut + 1], self.text[cut + 1 :]]
            self.font_size = _fit(max(self.lines, key=len), self.font, self.size, aw, self.smallest)
        self.leading = self.font_size * 1.25
        self.height = self.leading * len(self.lines) + 1
        return aw, self.height

    def draw(self):
        self.canv.setFillColor(self.color)
        self.canv.setFont(self.font, self.font_size)
        for i, line in enumerate(self.lines):
            y = self.height - (i + 1) * self.leading + self.font_size * 0.25 + 1
            self.canv.drawString(0, y, _clip(line, self.font, self.font_size, self.width))


class Card(Flowable):
    """Stacked flowables in a rounded panel, with an optional accent strip
    down the left edge."""

    def __init__(self, items, *, background=WHITE, border=LINE, accent=None, pad=PAD, gap=2.2 * mm, radius=7, min_height=0.0):
        super().__init__()
        self.min_height = min_height
        self.items = items
        self.background = background
        self.border = border
        self.accent = accent
        self.pad = pad
        self.gap = gap
        self.radius = radius

    def _inner_x(self) -> float:
        return self.pad + (3.2 if self.accent is not None else 0)

    def wrap(self, aw, ah):
        self.width = aw
        inner = aw - self._inner_x() - self.pad
        self.sizes = [item.wrap(inner, ah) for item in self.items]
        self.height = max(self.min_height, 2 * self.pad + sum(h for _, h in self.sizes) + self.gap * max(len(self.items) - 1, 0))
        return aw, self.height

    def draw(self):
        c = self.canv
        if self.accent is not None:
            c.saveState()
            path = c.beginPath()
            path.roundRect(0, 0, self.width, self.height, self.radius)
            c.clipPath(path, stroke=0, fill=0)
            c.setFillColor(self.background)
            c.rect(0, 0, self.width, self.height, stroke=0, fill=1)
            c.setFillColor(self.accent)
            c.rect(0, 0, 3.2, self.height, stroke=0, fill=1)
            c.restoreState()
        else:
            c.setFillColor(self.background)
            c.setStrokeColor(self.border or self.background)
            c.setLineWidth(0.8)
            c.roundRect(0, 0, self.width, self.height, self.radius, stroke=1 if self.border else 0, fill=1)
        y = self.height - self.pad
        for item, (_, h) in zip(self.items, self.sizes):
            y -= h
            item.drawOn(c, self._inner_x(), y)
            y -= self.gap


class StatusPill(Flowable):
    def __init__(self, label: str, status: str):
        super().__init__()
        self.label = label
        self.ink, self.tint = TONES[STATUS_TONE.get(status, "open")]

    def wrap(self, aw, ah):
        self.width = min(aw, pdfmetrics.stringWidth(self.label, SANS_SEMI, 7.4) + 19)
        self.height = 14
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.setFillColor(self.tint)
        c.roundRect(0, 0, self.width, self.height, 7, stroke=0, fill=1)
        c.setFillColor(self.ink)
        c.circle(7.2, self.height / 2, 2.1, stroke=0, fill=1)
        c.setFont(SANS_SEMI, 7.4)
        c.drawString(12.5, 4.5, self.label)


class Bar(Flowable):
    """A thin progress bar, 0 to 100."""

    def __init__(self, percent: float | None, ink, track=LINE, height=3.4):
        super().__init__()
        self.percent = max(0.0, min(100.0, percent or 0.0))
        self.ink = ink
        self.track = track
        self.bar_h = height

    def wrap(self, aw, ah):
        self.width = aw
        self.height = self.bar_h
        return aw, self.height

    def draw(self):
        c = self.canv
        r = self.bar_h / 2
        c.setFillColor(self.track)
        c.roundRect(0, 0, self.width, self.bar_h, r, stroke=0, fill=1)
        if self.percent > 0:
            c.setFillColor(self.ink)
            c.roundRect(0, 0, max(self.bar_h, self.width * self.percent / 100), self.bar_h, r, stroke=0, fill=1)


class Tiles(Flowable):
    """The week at a glance: four figures in matching panels."""

    def __init__(self, tiles: list[dict], height: float = 20 * mm, gap: float = 3.4 * mm):
        super().__init__()
        self.tiles = tiles
        self.tile_h = height
        self.gap = gap

    def wrap(self, aw, ah):
        self.width = aw
        self.height = self.tile_h
        return aw, self.height

    def draw(self):
        c = self.canv
        n = len(self.tiles)
        w = (self.width - self.gap * (n - 1)) / n
        pad = 3.6 * mm
        for i, tile in enumerate(self.tiles):
            x = i * (w + self.gap)
            c.setFillColor(WHITE)
            c.setStrokeColor(LINE)
            c.setLineWidth(0.8)
            c.roundRect(x, 0, w, self.tile_h, 7, stroke=1, fill=1)
            label_y = self.tile_h - pad - 5
            c.setFillColor(MUTED)
            _spaced(c, x + pad, label_y, tile["label"].upper(), SANS_BOLD, 6.3, 0.8)
            figure_y = label_y - 21
            c.setFillColor(INK)
            c.setFont(SERIF, 21)
            c.drawString(x + pad, figure_y, tile["value"])
            if tile.get("unit"):
                vw = pdfmetrics.stringWidth(tile["value"], SERIF, 21)
                c.setFillColor(MUTED)
                c.setFont(SANS_MEDIUM, 8.4)
                c.drawString(x + pad + vw + 3, figure_y + 1.5, _clip(tile["unit"], SANS_MEDIUM, 8.4, w - 2 * pad - vw - 3))
            if tile.get("percent") is not None:
                bar = Bar(tile["percent"], tile.get("ink", BRAND))
                bar.wrap(w - 2 * pad, 10)
                bar.drawOn(c, x + pad, pad)
            elif tile.get("note"):
                c.setFillColor(FAINT)
                c.setFont(SANS, 7)
                c.drawString(x + pad, pad - 0.5, _clip(tile["note"], SANS, 7, w - 2 * pad))


class SkillLine(Flowable):
    """One skill: its name, chapter and percentage on one line, a bar below."""

    def __init__(self, skill: dict, ink):
        super().__init__()
        self.skill = skill
        self.ink = ink

    def wrap(self, aw, ah):
        self.width = aw
        self.height = 17
        return aw, self.height

    def draw(self):
        c = self.canv
        s = self.skill
        percent = s.get("percent")
        right = f"{percent}%" if percent is not None else ""
        rw = pdfmetrics.stringWidth(right, SANS_BOLD, 8.6)
        chapter = f"Ch {s['chapterNo']}" if s.get("chapterNo") else ""
        cw = pdfmetrics.stringWidth(chapter, SANS, 7.2) + 6 if chapter else 0
        title = _clip(s["title"], SANS_SEMI, 8.6, self.width - rw - cw - 8)
        c.setFillColor(INK)
        c.setFont(SANS_SEMI, 8.6)
        c.drawString(0, 8, title)
        if chapter:
            c.setFillColor(FAINT)
            c.setFont(SANS, 7.2)
            c.drawString(pdfmetrics.stringWidth(title, SANS_SEMI, 8.6) + 6, 8, chapter)
        c.setFillColor(self.ink)
        c.setFont(SANS_BOLD, 8.6)
        c.drawRightString(self.width, 8, right)
        bar = Bar(percent, self.ink, height=3)
        bar.wrap(self.width, 6)
        bar.drawOn(c, 0, 0)


class Dot(Flowable):
    def __init__(self, ink, size: float = 6):
        super().__init__()
        self.ink = ink
        self.size = size

    def wrap(self, aw, ah):
        return self.size, self.size

    def draw(self):
        self.canv.setFillColor(self.ink)
        self.canv.circle(self.size / 2, self.size / 2, self.size / 2 - 0.4, stroke=0, fill=1)


class Signatures(Flowable):
    def __init__(self, labels: list[str]):
        super().__init__()
        self.labels = labels

    def wrap(self, aw, ah):
        self.width = aw
        self.height = 15 * mm
        return aw, self.height

    def draw(self):
        c = self.canv
        n = len(self.labels)
        gap = 22 * mm
        w = (self.width - gap * (n - 1)) / n
        for i, label in enumerate(self.labels):
            x = i * (w + gap)
            c.setStrokeColor(FAINT)
            c.setLineWidth(0.7)
            c.line(x, 12, x + w, 12)
            c.setFillColor(MUTED)
            _spaced(c, x, 3, label.upper(), SANS_BOLD, 6.4, 0.8)


class PageMark(Flowable):
    """Zero-size: tells the page decorations whose page this is."""

    def __init__(self, page: dict, logo=None):
        super().__init__()
        self.page = page
        self.logo = logo

    def wrap(self, aw, ah):
        return 0, 0

    def draw(self):
        self.canv._wr_page = self.page
        self.canv._wr_logo = self.logo
        self.canv._wr_index = 1


# --- words --------------------------------------------------------------------------------


def _date_text(iso: str | None, *, year: bool = True) -> str:
    if not iso:
        return "—"
    try:
        d = date.fromisoformat(iso[:10])
    except ValueError:
        return "—"
    return f"{d.day} {d.strftime('%b')}" + (f" {d.year}" if year else "")


def _week_text(week: dict) -> str:
    try:
        start, end = date.fromisoformat(week["start"]), date.fromisoformat(week["end"])
    except (KeyError, ValueError):
        return week.get("label", "")
    if start.year != end.year:
        return f"{_date_text(week['start'])} – {_date_text(week['end'])}"
    if start.month != end.month:
        return f"{start.day} {start.strftime('%b')} – {_date_text(week['end'])}"
    return f"{start.day} – {_date_text(week['end'])}"


def _initials(name: str) -> str:
    words = [w for w in name.replace("-", " ").split() if w[:1].isalpha()]
    return "".join(w[0].upper() for w in words[:3]) or "S"


def _first_name(name: str) -> str:
    parts = (name or "").split()
    return parts[0] if parts else "Your Child"


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _score(row: dict) -> str:
    if row.get("score") is None or not row.get("possible"):
        return "Marks to come" if row.get("marksToCome") else "—"
    return f"{row['score']} / {row['possible']}"


# --- the page decorations -----------------------------------------------------------------


def _draw_logo(c, logo: ImageReader, left: float, mid: float) -> float:
    """Draws the school's logo on a white tile with a gold edge, vertically
    centred on `mid`: square for a square or round logo, wider for a wide
    one. Returns the tile's right edge."""
    width, height = logo.getSize()
    aspect = width / height if height else 1
    tile_h = 23 * mm
    pad = 2.4 * mm
    tile_w = min(max(tile_h, (tile_h - 2 * pad) * aspect + 2 * pad), 54 * mm)
    c.saveState()
    c.setFillColor(WHITE)
    c.setStrokeColor(GOLD)
    c.setLineWidth(1.2)
    c.roundRect(left, mid - tile_h / 2, tile_w, tile_h, 8, stroke=1, fill=1)
    box_w, box_h = tile_w - 2 * pad, tile_h - 2 * pad
    if box_w / box_h > aspect:
        box_w = box_h * aspect
    else:
        box_h = box_w / aspect
    c.drawImage(logo, left + (tile_w - box_w) / 2, mid - box_h / 2, box_w, box_h, mask="auto")
    c.restoreState()
    return left + tile_w


def _band(c, page: dict) -> None:
    top = PAGE_H
    y0 = top - BAND_H
    c.saveState()
    c.setFillColor(BRAND_DEEP)
    c.rect(0, y0, PAGE_W, BAND_H, stroke=0, fill=1)
    # Quiet depth: two large soft circles to the right, clipped to the band.
    path = c.beginPath()
    path.rect(0, y0, PAGE_W, BAND_H)
    c.clipPath(path, stroke=0, fill=0)
    c.setFillColor(BRAND)
    c.setFillAlpha(0.55)
    c.circle(PAGE_W - 12 * mm, top + 6 * mm, 40 * mm, stroke=0, fill=1)
    c.setFillAlpha(1)
    c.restoreState()

    c.saveState()
    c.setFillAlpha(1)
    c.setFillColor(GOLD)
    c.rect(0, y0 - 1.6, PAGE_W, 1.6, stroke=0, fill=1)

    school = page["school"]
    mid = y0 + BAND_H / 2 + 0.8
    logo = getattr(c, "_wr_logo", None)
    if logo is not None:
        # The school's own logo (#202) on a white tile: round for a square
        # logo, a rounded panel for a wide one.
        crest_right = _draw_logo(c, logo, MARGIN, mid)
    else:
        # No logo yet: the school's initials in a gold-ringed seal.
        r = 11.5 * mm
        cx = MARGIN + r
        c.setStrokeColor(GOLD)
        c.setLineWidth(1.4)
        c.setFillColor(BRAND)
        c.circle(cx, mid, r, stroke=1, fill=1)
        c.setLineWidth(0.5)
        c.circle(cx, mid, r - 2.4, stroke=1, fill=0)
        initials = _initials(school["name"])
        size = _fit(initials, SERIF, 17, 2 * r - 10, 10)
        c.setFillColor(WHITE)
        c.setFont(SERIF, size)
        c.drawCentredString(cx, mid - size * 0.34, initials)
        crest_right = cx + r

    # Right: what the page is, and the week.
    right = PAGE_W - MARGIN
    c.setFillColor(GOLD)
    label_w = _spaced(c, right, mid + 7.5, "WEEKLY PRACTICE REPORT", SANS_BOLD, 7.2, 1.5, right=True)
    week = _week_text(page["week"])
    c.setFillColor(WHITE)
    c.setFont(SERIF, 15)
    c.drawRightString(right, mid - 8.5, week)
    c.setFillColor(BRAND_SOFT)
    c.setFont(SANS, 7.4)
    c.drawRightString(right, mid - 19, "Monday to Sunday")
    right_w = max(label_w, pdfmetrics.stringWidth(week, SERIF, 15))

    # Left: the school's name and place.
    x = crest_right + 5 * mm
    room = right - right_w - 10 * mm - x
    name = school["name"]
    size = _fit(name, SERIF, 19, room, 13)
    lines = [name]
    if pdfmetrics.stringWidth(name, SERIF, size) > room:
        # A long name goes on two lines, split where the halves are most even.
        words = name.split()
        best = None
        for i in range(1, len(words)):
            a, b = " ".join(words[:i]), " ".join(words[i:])
            widest = max(pdfmetrics.stringWidth(a, SERIF, 15), pdfmetrics.stringWidth(b, SERIF, 15))
            if best is None or widest < best[0]:
                best = (widest, [a, b])
        lines = best[1] if best else [name]
        size = _fit(max(lines, key=lambda s: pdfmetrics.stringWidth(s, SERIF, 15)), SERIF, 15, room, 11)
    leading = size * 1.15
    city = school.get("city")
    block = leading * (len(lines) - 1) + size * 0.7 + (13 if city else 0)
    top_line = mid + block / 2 - size * 0.7
    c.setFillColor(WHITE)
    c.setFont(SERIF, size)
    for i, line in enumerate(lines):
        c.drawString(x, top_line - i * leading, _clip(line, SERIF, size, room))
    if city:
        c.setFillColor(BRAND_SOFT)
        c.setFont(SANS_MEDIUM, 8.4)
        c.drawString(x, top_line - (len(lines) - 1) * leading - 13, _clip(city, SANS_MEDIUM, 8.4, room))
    c.restoreState()


def _footer(c, page: dict, index: int, total: int) -> None:
    c.saveState()
    # Signature lines on the child's last page only.
    if index == total:
        signatures = Signatures(["Class Teacher", "Parent or Guardian"])
        signatures.wrap(CONTENT_W, 20 * mm)
        signatures.drawOn(c, MARGIN, 25 * mm)
    c.setFillColor(FAINT)
    c.setFont(SANS, 6.9)
    c.drawCentredString(
        PAGE_W / 2, 20.5 * mm,
        "These marks come from practice, to help your child learn; they are not exam marks. Statuses and marks are as on the day of issue.",
    )
    c.drawCentredString(PAGE_W / 2, 17.4 * mm, "For any question about this report, please speak to the class teacher.")
    c.setStrokeColor(LINE)
    c.setLineWidth(0.8)
    c.line(MARGIN, 13.5 * mm, PAGE_W - MARGIN, 13.5 * mm)
    if page.get("issuedAt"):
        issued_by = page.get("issuedBy")
        left = f"Issued on {_day(page.get('issuedAt'))}" + (f" by {issued_by}" if issued_by else "")
    else:
        left = "Draft, not issued"
    c.setFillColor(MUTED)
    c.setFont(SANS_MEDIUM, 7.2)
    c.drawString(MARGIN, 9.5 * mm, left)
    c.setFillColor(FAINT)
    c.setFont(SANS, 7.2)
    right = f"Prepared with {PRODUCT_NAME}"
    if total > 1:
        right = f"Page {index} of {total}   ·   {right}"
    c.drawRightString(PAGE_W - MARGIN, 9.5 * mm, right)
    c.restoreState()


def _continued(c, page: dict) -> None:
    """On a child's second page: whose page it is."""
    student = page["student"]
    c.saveState()
    c.setFillColor(MUTED)
    c.setFont(SANS_SEMI, 8)
    c.drawString(MARGIN, PAGE_H - BAND_H - 4.6 * mm, f"{student['name']}   ·   {student['code']}   ·   continued")
    c.restoreState()


def _decorate(c, doc) -> None:
    page = getattr(c, "_wr_page", None)
    if not page:
        return
    index = getattr(c, "_wr_index", 1)
    _band(c, page)
    if index > 1:
        _continued(c, page)
    _footer(c, page, index, page.get("_pages", 1))
    page["_counted"] = index
    c._wr_index = index + 1


# --- the body -----------------------------------------------------------------------------


def _details(page: dict) -> Table:
    student = page["student"]
    cells = [
        ("Student", student["name"]),
        ("Student Code", student["code"]),
        ("Class", f"{student['classLevel']}, Section {student['section']}"),
        ("Issued On", _day(page.get("issuedAt")) if page.get("issuedAt") else "Not yet issued"),
    ]
    widths = [CONTENT_W * f for f in (0.32, 0.21, 0.24, 0.23)]
    # A name wraps between words, never cut short; a code (no spaces) shrinks to fit.
    row = [
        [Label(label), Spacer(1, 3), _p(value, S_NAME) if label == "Student" else FitText(value, font=SANS_SEMI, size=10)]
        for label, value in cells
    ]
    table = Table([row], colWidths=widths, cornerRadii=[7, 7, 7, 7])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), TINT),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), PAD),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
                ("LINEAFTER", (0, 0), (-2, -1), 0.8, LINE),
            ]
        )
    )
    return table


def _glance(page: dict) -> list:
    t, n = page["totals"], page["weekNumbers"]
    given, done = t["given"], t["done"]
    good = TONES["good"][0]
    tiles = [
        {"label": "Sets Done", "value": str(done), "unit": f"of {given}", "percent": 100 * done / given, "ink": good}
        if given
        else {"label": "Sets Done", "value": "—", "note": "No sets this week"},
        {"label": "Done on Time", "value": str(t["onTime"]), "unit": f"of {done}", "percent": 100 * t["onTime"] / done, "ink": good}
        if done
        else {"label": "Done on Time", "value": "—", "note": "Nothing handed in"},
        {"label": "Questions Answered", "value": str(n["answered"]), "note": "Handed in this week"},
        {"label": "Marks Earned", "value": f"{n['percent']}%", "percent": n["percent"], "ink": BRAND}
        if n.get("percent") is not None
        else {"label": "Marks Earned", "value": "—", "note": "No marked answers yet"},
    ]
    out: list = [Tiles(tiles)]
    extra = []
    if t["late"]:
        extra.append(f"{_plural(t['late'], 'set')} done late")
    if t["notDone"]:
        extra.append(f"{_plural(t['notDone'], 'set')} not done")
    if t["open"]:
        extra.append(f"{_plural(t['open'], 'set')} still open")
    if n.get("ownPractice"):
        extra.append(f"also practised on their own: {_plural(n['ownPractice'], 'set')}")
    if extra:
        text = "   ·   ".join(extra)
        out += [Spacer(1, 2.6 * mm), _p(text[0].upper() + text[1:], S_SMALL)]
    return out


def _practice(page: dict) -> list:
    rows = page["sets"]
    if not rows:
        return [Card([_p("No practice was set for this week.", S_EMPTY)], background=TINT, border=None, pad=6 * mm)]
    widths = [CONTENT_W - 82 * mm, 18 * mm, 37 * mm, 27 * mm]
    data = [[Label("Practice Set"), Label("Due"), Label("Status"), Label("Score", align="right")]]
    for r in rows:
        bits = [r.get("subject"), f"Chapter {r['chapterNo']}" if r.get("chapterNo") else None]
        subtitle = "   ·   ".join(b for b in bits if b)
        title_cell = [_p(r["title"], S_SET)] + ([Spacer(1, 1.4), _p(subtitle, S_SET_SUB)] if subtitle else [])
        data.append(
            [
                title_cell,
                _p(_date_text(r.get("dueDate"), year=False), S_CELL),
                StatusPill(r["statusLabel"], r["status"]),
                _p(_score(r), S_CELL_R),
            ]
        )
    table = Table(data, colWidths=widths, repeatRows=1, cornerRadii=[7, 7, 7, 7])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), TINT),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), PAD),
                ("RIGHTPADDING", (0, 0), (-1, -1), PAD),
                ("LEFTPADDING", (1, 0), (-1, -1), 1.5 * mm),
                ("TOPPADDING", (0, 0), (-1, 0), 2.4 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 2.4 * mm),
                ("TOPPADDING", (0, 1), (-1, -1), 2.3 * mm),
                ("BOTTOMPADDING", (0, 1), (-1, -1), 2.3 * mm),
                ("BOX", (0, 0), (-1, -1), 0.8, LINE),
                ("LINEBELOW", (0, 0), (-1, -2), 0.6, LINE),
            ]
        )
    )
    return [table]


def _skills(page: dict) -> list:
    skills = page.get("skills") or {"strong": [], "workOn": []}
    half = (CONTENT_W - 5 * mm) / 2
    inner = half - 2 * 3.8 * mm

    def card(title: str, items: list[dict], tone: str, empty: str) -> Card:
        ink = TONES[tone][0]
        head = _plain_table(Table([[Dot(ink), Label(title, size=7, color=ink, spacing=0.9)]], colWidths=[10, inner - 10]))
        body = [SkillLine(s, ink) for s in items] if items else [_p(empty, S_SKILL_SUB)]
        return Card([head] + body, gap=2.8 * mm, pad=3.8 * mm)

    left = card("Strengths", skills["strong"], "good", "None yet. A skill shows here at 80% or more, from 3 or more answers.")
    right = card("Skills to Work On", skills["workOn"], "late", "Nothing to work on right now.")
    # The two panels stand the same height, side by side.
    tallest = max(left.wrap(half, PAGE_H)[1], right.wrap(half, PAGE_H)[1])
    left.min_height = right.min_height = tallest
    table = Table([[left, "", right]], colWidths=[half, 5 * mm, half])
    _plain_table(table)
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    return [
        table,
        Spacer(1, 2 * mm),
        _p("Judged on the practice handed in up to the end of this week; the most recent answer to each question counts.", S_SMALL),
    ]


def _notes(page: dict) -> list:
    notes = page.get("notes") or {}
    items: list = []
    if notes.get("section"):
        items += [Label("For the Class"), _p(notes["section"], S_NOTE)]
    if notes.get("child"):
        if items:
            items.append(Spacer(1, 1.6 * mm))
        items += [Label(f"For {_first_name(page['student']['name'])}"), _p(notes["child"], S_NOTE)]
    if not items:
        items = [_p("No note this week.", S_NO_NOTE)]
    return [Card(items, background=TINT, border=None, accent=GOLD, gap=1.6 * mm, pad=4.2 * mm)]


def _page_story(page: dict, logo=None) -> list:
    story: list = [PageMark(page, logo), _details(page)]
    story += [SectionHeading("The Week at a Glance")] + _glance(page)
    story += [SectionHeading("This Week's Practice")] + _practice(page)
    story += [KeepTogether([SectionHeading("Skills")] + _skills(page))]
    story += [KeepTogether([SectionHeading("From the Teacher")] + _notes(page))]
    return story


def _pages_needed(page: dict, logo: ImageReader | None = None) -> int:
    """How many sheets one child's page takes (a long week runs over), so
    the signatures go on the last and the footer can say "Page 1 of 2"."""
    probe = {**page, "_pages": 1}
    _build([probe], BytesIO(), logo)
    return max(1, probe.get("_counted", 1))


def _logo_reader(logo: bytes | None) -> ImageReader | None:
    """The logo, fully decoded first: a damaged one is left out, never a
    failed PDF (#202 review)."""
    logo = readable_logo(logo)
    if not logo:
        return None
    try:
        return ImageReader(BytesIO(logo))
    except Exception:  # noqa: BLE001 - a bad logo must not stop the report
        return None


def render(pages: list[dict], logo: bytes | None = None) -> bytes:
    """One PDF holding the given pages, one child per sheet (or more, for a
    long week)."""
    reader = _logo_reader(logo)
    pages = [{**p, "_pages": _pages_needed(p, reader)} for p in pages]
    buffer = BytesIO()
    _build(pages, buffer, reader)
    return buffer.getvalue()


def _build(pages: list[dict], buffer: BytesIO, logo: ImageReader | None = None) -> None:
    doc = BaseDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=BAND_H + 5.5 * mm,
        bottomMargin=FOOT_BODY,
        title=pages[0]["title"] if pages else "Weekly Practice Report",
        author=PRODUCT_NAME,
    )
    frame = Frame(
        doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="body",
        leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
    )
    doc.addPageTemplates([PageTemplate(id="page", frames=[frame], onPageEnd=_decorate)])
    story: list = []
    for index, page in enumerate(pages):
        if index:
            story.append(PageBreak())
        story += _page_story(page, logo)
    if not story:
        story.append(_p("No reports.", S_BODY))
    doc.build(story)
