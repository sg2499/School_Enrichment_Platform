"""Pictures in questions (#218, 11 Nov 2026)."""
import json

import pytest

from app.models import Question
from app.services import figures, pattern_engine


def test_a_grid_with_a_mirror_line_is_drawn_from_numbers_only():
    svg = figures.render_svg({"type": "grid", "rows": 5, "cols": 10, "shaded": [[2, 3]],
                              "labels": [[2, 6, "A"]], "mirror": {"orientation": "vertical", "after": 4}})
    assert svg.startswith("<svg") and svg.endswith("</svg>")
    assert svg.count('fill="#4b5563"') == 1  # one shaded square
    assert ">A</text>" in svg
    assert 'x1="140"' in svg  # the mirror line after column 4 (5 x 28)


@pytest.mark.parametrize("bad", [
    {"type": "grid", "rows": 0, "cols": 3},
    {"type": "grid", "rows": 3, "cols": 3, "shaded": [[3, 0]]},
    {"type": "grid", "rows": 3, "cols": 3, "labels": [[0, 0, "ABCD"]]},
    {"type": "grid", "rows": 3, "cols": 3, "mirror": {"orientation": "diagonal", "after": 0}},
    {"type": "letters", "text": "BOOK"},  # B and K are not offered
    {"type": "shape", "shape": "hexagon"},
    {"type": "symbols", "items": [{"symbol": "skull", "label": "x"}]},
    {"type": "image", "src": "https://example.com/x.png"},
    "not json",
])
def test_anything_that_cannot_be_drawn_is_refused_in_words(bad):
    with pytest.raises(figures.FigureError):
        figures.check(bad)


def test_labels_cannot_become_markup():
    svg = figures.render_svg({"type": "symbols", "items": [{"symbol": "star", "label": "<script>x</script>"}]})
    assert "<script>" not in svg and "&lt;script&gt;" in svg


def test_block_letters_are_strokes_not_text_and_es_bar_is_centred():
    svg = figures.render_svg({"type": "letters", "text": "E"})
    assert "<text" not in svg
    assert figures.LETTERS["E"][1] == [(0, 3), (3, 3)]


def test_a_broken_figure_never_stops_a_child_answering():
    assert figures.svg_for(Question(figure='{"type": "grid", "rows": 99, "cols": 1}')) is None
    assert figures.svg_for(Question(figure=None)) is None
    assert figures.svg_for(Question(figure=json.dumps({"type": "shape", "shape": "kite", "lines": ["diagonal1"]}))).startswith("<svg")


def test_a_pattern_can_draw_its_figure_from_its_values():
    raw = {
        "code": "T-FIG-1", "chapter": 10, "skill": "C5-SD-S09", "questionType": "Numeric Entry", "marks": 1, "difficulty": 1,
        "responseFormat": "Integer",
        "values": [{"name": "d", "int": {"min": 1, "max": 4}}, {"name": "r", "int": {"min": 0, "max": 4}}],
        "figure": {"type": "grid", "rows": 5, "cols": 10, "shaded": [["=r", "=5 - d"]], "mirror": {"orientation": "vertical", "after": 4}},
        "text": "How many squares is the shaded square from the mirror line?",
        "answer": "d", "hint": "Count from the line.", "explanation": "It is {d} squares away.",
        "misconception": "Counts from the edge of the grid.",
    }
    spec = pattern_engine.clean_spec(raw)
    made = pattern_engine.make(spec, "s1")
    figure = json.loads(made.questions[0]["figure"])
    d = made.values["d"]
    assert figure["shaded"] == [[made.values["r"], 5 - d]]
    assert made.questions[0]["correct_answer"] == str(d)
    [copy] = pattern_engine.preview(spec, 1)
    assert copy["questions"][0]["figureSvg"].startswith("<svg")


def test_a_12_hour_answer_keeps_its_am_or_pm():
    # Ashalatha, 10 Nov 2026: C5-RS-L5-3 (d) 1:15 p.m., (e) 12:05 p.m.
    assert pattern_engine.clock_12(13 * 60 + 15) == "1:15 p.m."
    assert pattern_engine.clock_12(12 * 60 + 5) == "12:05 p.m."
    assert pattern_engine.clock_12(5) == "12:05 a.m."
    assert pattern_engine.clock_12(9 * 60 + 5) == "9:05 a.m."
    variants = pattern_engine.clock_12_variants("1:15 p.m.").split("|")
    assert "1:15 pm" in variants and "1:15 p.m." not in variants
    from app.services.learning_service import grade_answer

    q = Question(question_type="Text Entry", correct_answer="1:15 p.m.", accepted_variants="|".join(variants), marks=1, auto_gradable=True)
    for right in ("1:15 p.m.", "1:15 PM", "1:15pm"):
        assert grade_answer(q, right)[0] is True, right
    for wrong in ("1:15", "1:15 a.m.", "13:15"):
        assert grade_answer(q, wrong)[0] is False, wrong
