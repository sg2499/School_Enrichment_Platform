"""Pictures in questions (#218, 11 Nov 2026).

Ashalatha's review of 10 Nov asked for fixed drawings where words or a
device's font could change what a child sees: mirror lines on a simple
grid (in place of coordinate rules such as y = x), block letters drawn the
same everywhere, and map symbols that cannot change with the font. Shailesh
chose to add pictures to questions (11 Nov).

A question's ``figure`` is a small JSON description, never an image or SVG
from outside: this module checks it and draws it as SVG from numbers and a
few short labels only, so nothing a person types can become markup.

Kinds:
  grid     {"type": "grid", "rows": 5, "cols": 10, "shaded": [[r, c], ...],
            "labels": [[r, c, "A"], ...],
            "mirror": {"orientation": "vertical"|"horizontal", "after": k}}
           (rows and columns count from 0 at the top left; a vertical mirror
           line is drawn after column k, a horizontal one after row k)
  shape    {"type": "shape", "shape": "square"|"rectangle"|"rhombus"|"kite"|
            "parallelogram", "lines": ["diagonal1", "diagonal2"]}
  letters  {"type": "letters", "text": "STORY"}   (plain block capitals drawn
           with strokes, so no font is involved; B, K and Q are not offered)
  symbols  {"type": "symbols", "items": [{"symbol": "star", "label": "Temple"}, ...]}  (a map key)
  symbolrow {"type": "symbolrow", "text": "diamond star star circle"}  (symbols in a line, as on a map)
  row      {"type": "row", "items": [{"caption": "P", "figure": {...}}, ...]}
"""
from __future__ import annotations

import json
from html import escape

MAX_CELLS = 16
MAX_LABEL = 24
CELL = 28
INK = "#1f2937"
GRID = "#9ca3af"
SHADE = "#4b5563"
MIRROR = "#c2410c"
PAPER = "#ffffff"

SHAPES = ("square", "rectangle", "rhombus", "kite", "parallelogram")
SYMBOLS = ("star", "triangle", "circle", "square", "diamond", "cross")

# Block capitals on a 4 x 6 box, as strokes (lists of points). E's middle
# bar sits at the centre (y = 3), as Ashalatha asked. B, K and Q are left
# out because their symmetry depends on how they are drawn.
LETTERS: dict[str, list[list[tuple[float, float]]]] = {
    "A": [[(0, 6), (2, 0), (4, 6)], [(1, 3), (3, 3)]],
    "C": [[(4, 0), (0, 0), (0, 6), (4, 6)]],
    "D": [[(0, 0), (3, 0), (4, 1), (4, 5), (3, 6), (0, 6), (0, 0)]],
    "E": [[(4, 0), (0, 0), (0, 6), (4, 6)], [(0, 3), (3, 3)]],
    "F": [[(4, 0), (0, 0), (0, 6)], [(0, 3), (3, 3)]],
    "G": [[(4, 0), (0, 0), (0, 6), (4, 6), (4, 3), (2, 3)]],
    "H": [[(0, 0), (0, 6)], [(4, 0), (4, 6)], [(0, 3), (4, 3)]],
    "I": [[(0, 0), (4, 0)], [(2, 0), (2, 6)], [(0, 6), (4, 6)]],
    "J": [[(0, 0), (4, 0)], [(3, 0), (3, 6), (0, 6), (0, 4)]],
    "L": [[(0, 0), (0, 6), (4, 6)]],
    "M": [[(0, 6), (0, 0), (2, 3), (4, 0), (4, 6)]],
    "N": [[(0, 6), (0, 0), (4, 6), (4, 0)]],
    "O": [[(0, 0), (4, 0), (4, 6), (0, 6), (0, 0)]],
    "P": [[(0, 6), (0, 0), (4, 0), (4, 3), (0, 3)]],
    "R": [[(0, 6), (0, 0), (4, 0), (4, 3), (0, 3), (4, 6)]],
    "S": [[(4, 0), (0, 0), (0, 3), (4, 3), (4, 6), (0, 6)]],
    "T": [[(0, 0), (4, 0)], [(2, 0), (2, 6)]],
    "U": [[(0, 0), (0, 6), (4, 6), (4, 0)]],
    "V": [[(0, 0), (2, 6), (4, 0)]],
    "W": [[(0, 0), (1, 6), (2, 3), (3, 6), (4, 0)]],
    "X": [[(0, 0), (4, 6)], [(4, 0), (0, 6)]],
    "Y": [[(0, 0), (2, 3), (4, 0)], [(2, 3), (2, 6)]],
    "Z": [[(0, 0), (4, 0), (0, 6), (4, 6)]],
}


class FigureError(ValueError):
    """A figure description that cannot be drawn, with the reason in words."""


def _int(value, low: int, high: int, what: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise FigureError(f"{what} must be a whole number from {low} to {high}.")
    return value


def _label(value, what: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > MAX_LABEL:
        raise FigureError(f"{what} must be text of 1 to {MAX_LABEL} characters.")
    return value.strip()


def check(spec) -> dict:
    """The figure as it will be drawn, or FigureError. Accepts a dict or
    its JSON text."""
    if isinstance(spec, str):
        try:
            spec = json.loads(spec)
        except ValueError as exc:
            raise FigureError("The figure is not valid JSON.") from exc
    if not isinstance(spec, dict):
        raise FigureError("The figure must be a JSON object.")
    kind = spec.get("type")
    if kind == "grid":
        rows = _int(spec.get("rows"), 1, MAX_CELLS, "rows")
        cols = _int(spec.get("cols"), 1, MAX_CELLS, "cols")
        out = {"type": "grid", "rows": rows, "cols": cols, "shaded": [], "labels": []}
        for cell in spec.get("shaded") or []:
            if not isinstance(cell, list) or len(cell) != 2:
                raise FigureError("Each shaded square is [row, column].")
            out["shaded"].append([_int(cell[0], 0, rows - 1, "A shaded row"), _int(cell[1], 0, cols - 1, "A shaded column")])
        for cell in spec.get("labels") or []:
            if not isinstance(cell, list) or len(cell) != 3:
                raise FigureError("Each label is [row, column, text].")
            text = _label(cell[2], "A grid label")
            if len(text) > 3:
                raise FigureError("A grid label is at most 3 characters.")
            out["labels"].append([_int(cell[0], 0, rows - 1, "A label row"), _int(cell[1], 0, cols - 1, "A label column"), text])
        mirror = spec.get("mirror")
        if mirror is not None:
            orientation = mirror.get("orientation") if isinstance(mirror, dict) else None
            if orientation not in ("vertical", "horizontal"):
                raise FigureError("A mirror line is vertical or horizontal.")
            limit = cols - 2 if orientation == "vertical" else rows - 2
            out["mirror"] = {"orientation": orientation, "after": _int(mirror.get("after"), 0, max(limit, 0), "The mirror line's position")}
        return out
    if kind == "shape":
        shape = spec.get("shape")
        if shape not in SHAPES:
            raise FigureError(f"A shape is one of: {', '.join(SHAPES)}.")
        lines = spec.get("lines") or []
        if not isinstance(lines, list) or any(line not in ("diagonal1", "diagonal2") for line in lines):
            raise FigureError("A shape's lines are diagonal1 and diagonal2.")
        return {"type": "shape", "shape": shape, "lines": list(dict.fromkeys(lines))}
    if kind == "letters":
        text = spec.get("text")
        if not isinstance(text, str) or not 1 <= len(text) <= 12:
            raise FigureError("Letters are 1 to 12 capitals.")
        missing = sorted({ch for ch in text if ch not in LETTERS and ch != " "})
        if missing:
            raise FigureError(f"These letters cannot be drawn: {', '.join(missing)}.")
        return {"type": "letters", "text": text}
    if kind == "symbols":
        items = spec.get("items")
        if not isinstance(items, list) or not 1 <= len(items) <= 8:
            raise FigureError("A symbol key has 1 to 8 symbols.")
        out_items = []
        for item in items:
            if not isinstance(item, dict) or item.get("symbol") not in SYMBOLS:
                raise FigureError(f"A symbol is one of: {', '.join(SYMBOLS)}.")
            out_items.append({"symbol": item["symbol"], "label": _label(item.get("label"), "A symbol's label")})
        return {"type": "symbols", "items": out_items}
    if kind == "symbolrow":
        names = str(spec.get("text") or "").split()
        if not 1 <= len(names) <= 16 or any(n not in SYMBOLS for n in names):
            raise FigureError(f"A symbol row is 1 to 16 of: {', '.join(SYMBOLS)}.")
        return {"type": "symbolrow", "text": " ".join(names)}
    if kind == "row":
        items = spec.get("items")
        if not isinstance(items, list) or not 1 <= len(items) <= 4:
            raise FigureError("A row holds 1 to 4 figures.")
        out_items = []
        for item in items:
            if not isinstance(item, dict):
                raise FigureError("Each figure in a row is an object.")
            inner = check(item.get("figure"))
            if inner["type"] == "row":
                raise FigureError("A row cannot hold another row.")
            out_items.append({"caption": _label(item.get("caption"), "A caption") if item.get("caption") else None, "figure": inner})
        return {"type": "row", "items": out_items}
    raise FigureError("A figure's type is grid, shape, letters, symbols, symbolrow or row.")


# --- drawing --------------------------------------------------------------


def _grid(spec: dict) -> tuple[str, int, int]:
    rows, cols = spec["rows"], spec["cols"]
    width, height = cols * CELL, rows * CELL
    parts = [f'<rect x="0" y="0" width="{width}" height="{height}" fill="{PAPER}"/>']
    for r, c in spec["shaded"]:
        parts.append(f'<rect x="{c * CELL}" y="{r * CELL}" width="{CELL}" height="{CELL}" fill="{SHADE}"/>')
    for i in range(cols + 1):
        parts.append(f'<line x1="{i * CELL}" y1="0" x2="{i * CELL}" y2="{height}" stroke="{GRID}" stroke-width="1"/>')
    for i in range(rows + 1):
        parts.append(f'<line x1="0" y1="{i * CELL}" x2="{width}" y2="{i * CELL}" stroke="{GRID}" stroke-width="1"/>')
    for r, c, text in spec["labels"]:
        parts.append(
            f'<text x="{c * CELL + CELL / 2}" y="{r * CELL + CELL / 2}" text-anchor="middle" dominant-baseline="central" '
            f'font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700" fill="{INK}">{escape(text)}</text>'
        )
    mirror = spec.get("mirror")
    if mirror:
        at = (mirror["after"] + 1) * CELL
        if mirror["orientation"] == "vertical":
            parts.append(f'<line x1="{at}" y1="-6" x2="{at}" y2="{height + 6}" stroke="{MIRROR}" stroke-width="4"/>')
        else:
            parts.append(f'<line x1="-6" y1="{at}" x2="{width + 6}" y2="{at}" stroke="{MIRROR}" stroke-width="4"/>')
    return "".join(parts), width, height


def _shape(spec: dict) -> tuple[str, int, int]:
    points = {
        "square": [(20, 20), (160, 20), (160, 160), (20, 160)],
        "rectangle": [(20, 40), (220, 40), (220, 140), (20, 140)],
        "rhombus": [(110, 10), (190, 90), (110, 170), (30, 90)],
        "kite": [(110, 10), (170, 70), (110, 190), (50, 70)],
        "parallelogram": [(60, 40), (230, 40), (190, 140), (20, 140)],
    }[spec["shape"]]
    width = max(x for x, _ in points) + 20
    height = max(y for _, y in points) + 20
    path = " ".join(f"{x},{y}" for x, y in points)
    parts = [f'<rect x="0" y="0" width="{width}" height="{height}" fill="{PAPER}"/>',
             f'<polygon points="{path}" fill="none" stroke="{INK}" stroke-width="3"/>']
    if "diagonal1" in spec["lines"]:
        (x1, y1), (x2, y2) = points[0], points[2]
        parts.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{MIRROR}" stroke-width="3" stroke-dasharray="8 6"/>')
    if "diagonal2" in spec["lines"]:
        (x1, y1), (x2, y2) = points[1], points[3]
        parts.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{MIRROR}" stroke-width="3" stroke-dasharray="8 6"/>')
    return "".join(parts), width, height


def _letters(spec: dict) -> tuple[str, int, int]:
    scale, gap, pad = 12, 24, 16
    parts, x = [], pad
    for ch in spec["text"]:
        if ch != " ":
            for stroke in LETTERS[ch]:
                pts = " ".join(f"{x + px * scale},{pad + py * scale}" for px, py in stroke)
                parts.append(f'<polyline points="{pts}" fill="none" stroke="{INK}" stroke-width="7" stroke-linecap="square" stroke-linejoin="miter"/>')
        x += 4 * scale + gap
    width, height = x - gap + pad, 6 * scale + 2 * pad
    return f'<rect x="0" y="0" width="{width}" height="{height}" fill="{PAPER}"/>' + "".join(parts), width, height


def _symbol(kind: str, cx: float, cy: float, r: float = 11) -> str:
    if kind == "circle":
        return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{INK}"/>'
    if kind == "square":
        return f'<rect x="{cx - r}" y="{cy - r}" width="{2 * r}" height="{2 * r}" fill="{INK}"/>'
    if kind == "triangle":
        return f'<polygon points="{cx},{cy - r} {cx + r},{cy + r} {cx - r},{cy + r}" fill="{INK}"/>'
    if kind == "diamond":
        return f'<polygon points="{cx},{cy - r} {cx + r},{cy} {cx},{cy + r} {cx - r},{cy}" fill="{INK}"/>'
    if kind == "cross":
        w = r / 2.6
        return (f'<rect x="{cx - w}" y="{cy - r}" width="{2 * w}" height="{2 * r}" fill="{INK}"/>'
                f'<rect x="{cx - r}" y="{cy - w}" width="{2 * r}" height="{2 * w}" fill="{INK}"/>')
    # star: five points
    import math
    pts = []
    for i in range(10):
        radius = r if i % 2 == 0 else r * 0.45
        angle = -math.pi / 2 + i * math.pi / 5
        pts.append(f"{cx + radius * math.cos(angle):.1f},{cy + radius * math.sin(angle):.1f}")
    return f'<polygon points="{" ".join(pts)}" fill="{INK}"/>'


def _symbols(spec: dict) -> tuple[str, int, int]:
    line, width = 32, 260
    height = len(spec["items"]) * line + 12
    parts = [f'<rect x="0" y="0" width="{width}" height="{height}" fill="{PAPER}"/>']
    for i, item in enumerate(spec["items"]):
        cy = 6 + line * i + line / 2
        parts.append(_symbol(item["symbol"], 24, cy))
        parts.append(f'<text x="48" y="{cy}" dominant-baseline="central" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="{INK}">{escape(item["label"])}</text>')
    return "".join(parts), width, height


def _symbolrow(spec: dict) -> tuple[str, int, int]:
    names = spec["text"].split()
    step, height = 34, 40
    width = step * len(names) + 6
    parts = [f'<rect x="0" y="0" width="{width}" height="{height}" fill="{PAPER}"/>']
    parts += [_symbol(name, 20 + step * i, height / 2) for i, name in enumerate(names)]
    return "".join(parts), width, height


def _draw(spec: dict) -> tuple[str, int, int]:
    return {"grid": _grid, "shape": _shape, "letters": _letters, "symbols": _symbols, "symbolrow": _symbolrow}[spec["type"]](spec)


def render_svg(spec) -> str:
    """The figure as one self-contained SVG element. Raises FigureError for
    a description that does not pass check()."""
    spec = check(spec)
    if spec["type"] == "row":
        pieces, x, height = [], 0, 0
        for item in spec["items"]:
            body, w, h = _draw(item["figure"])
            top = 26 if item["caption"] else 0
            if item["caption"]:
                pieces.append(f'<text x="{x + w / 2}" y="16" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" fill="{INK}">{escape(item["caption"])}</text>')
            pieces.append(f'<g transform="translate({x},{top})">{body}</g>')
            x += w + 32
            height = max(height, h + top)
        width, body = x - 32, "".join(pieces)
    else:
        body, width, height = _draw(spec)
    pad = 8
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" role="img" viewBox="{-pad} {-pad} {width + 2 * pad} {height + 2 * pad}" '
        f'width="{width + 2 * pad}" height="{height + 2 * pad}" style="max-width:100%;height:auto">{body}</svg>'
    )


def svg_for(question) -> str | None:
    """A question's figure as SVG, or None (no figure, or one that cannot be
    drawn: a broken figure must never stop a child answering)."""
    raw = getattr(question, "figure", None)
    if not raw:
        return None
    try:
        return render_svg(raw)
    except FigureError:
        return None
