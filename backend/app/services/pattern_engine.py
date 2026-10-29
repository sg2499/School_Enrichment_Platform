"""The mock paper engine's core (#166 step 1, 27 Oct 2026;
PHASE5_MOCK_PAPER_DESIGN.md): question patterns in, checked questions out.

Shailesh, 27 Oct 2026: every paper's questions "need to be unique and
different ... it can never be the same but must follow all the rules,
guidelines and conventions as seen in the practice content". So a pattern
is one question family written once, with blanks: this module fills the
blanks within the pattern's limits, works out the answer itself (never
copied from anywhere), checks the result, and either shows it (preview) or
stores it as an ordinary Question for a student, never repeating one that
student has been given.

A pattern spec (JSON, read by clean_spec) holds:

  code         "C5-WT1-S09-P1"
  chapter      the chapter number; skill: the Skill ID ("C5-WT1-S09")
  questionType Single Select | Numeric Entry | Text Entry | Constructed Response
  marks        the question's marks (a case study: the total of its parts)
  difficulty   1 to 4, as the content's own Difficulty; competency: as the content
  values       the blanks, in order. Each has a name and one of:
                 int: {min, max, step?}   (bounds may be expressions of earlier values)
                 choice: [...]            (text, whole numbers or records {"key": value})
                 list: "names"            (a shared list: see SHARED_LISTS)
                 expr: "..."              (worked out from earlier values)
  require      expressions that must all be true ("n % 100 != 0")
  text         the question, with {expression} or {expression:format} blanks
  answer       an expression, or a list of them for an answer in several boxes
  answerFormat plain (default) | fraction
  options      Single Select only: {correct, wrong: [{expr, mistake} x 3], format?}
  unit, unitRule, responseFormat   as the content's marking columns
  hint, explanation, misconception  text, with blanks
  steps        for 2 marks or more: [{marks, text}], one line per mark step
  stimulus + parts   a case study: one scenario, then parts, each a small
               question of its own (text, answer or options, marks, ...)
  Long Answer  questionType "Long Answer" (#208, 28 Oct 2026): a 3- or
               5-mark question in steps. The stimulus is the problem; each
               part is one step with its own answer box (number, short
               answer or multiple choice, 1 or 2 marks), so the platform
               marks every step and the marks add up to the question's.
               Shailesh, 28 Oct: "we need to figure out a way to remove
               manual work as much as possible"; a mock answer never waits
               for a teacher.
  maxWords     the longest the question may be (default 60)
  notes        the limits in words, for the reviewer; sources: the bank
               questions the pattern was drawn from

Formats for blanks: plain (default), num (8,649), money (Rs 8,649 with the
rupee sign), fraction (3/4), mixed (1 1/2). Expressions follow
pattern_expr: safe, exact (fractions, never floats).
"""
from __future__ import annotations

import hashlib
import json
import random
import re
import uuid
from dataclasses import dataclass, field
from fractions import Fraction

from app.services import pattern_expr
from app.services.pattern_expr import ExprError

QUESTION_TYPES = ("Single Select", "Numeric Entry", "Text Entry", "Constructed Response")
LONG_ANSWER = "Long Answer"
LONG_ANSWER_MARKS = (3, 5)
STEP_TYPES = ("Single Select", "Numeric Entry", "Text Entry")  # a step is marked by the platform
ANSWER_FORMATS = ("plain", "fraction")
BLANK_FORMATS = ("plain", "num", "money", "fraction", "mixed")
DEFAULT_MAX_WORDS = 60
MAX_TRIES = 200  # value draws per question before a pattern is called unworkable
MAX_INT_RANGE = 10**9
_BLANK = re.compile(r"\{([^{}]+?)(?::(\w+))?\}")

# Shared lists a pattern can draw from. Names are balanced across girls and
# boys and across regions and communities (her questionnaire, Q4, may
# replace this list).
SHARED_LISTS = {
    "names": [
        {"name": n, "he": p, "him": o, "his": s}
        for n, (p, o, s) in {
            "Aarav": ("he", "him", "his"), "Ananya": ("she", "her", "her"), "Kabir": ("he", "him", "his"),
            "Meera": ("she", "her", "her"), "Rohan": ("he", "him", "his"), "Fatima": ("she", "her", "her"),
            "Arjun": ("he", "him", "his"), "Priya": ("she", "her", "her"), "Imran": ("he", "him", "his"),
            "Lakshmi": ("she", "her", "her"), "Harpreet": ("she", "her", "her"), "Tenzin": ("he", "him", "his"),
            "Neha": ("she", "her", "her"), "Joseph": ("he", "him", "his"), "Sana": ("she", "her", "her"),
            "Vikram": ("he", "him", "his"), "Divya": ("she", "her", "her"), "Rahul": ("he", "him", "his"),
            "Ayesha": ("she", "her", "her"), "Karthik": ("he", "him", "his"),
        }.items()
    ],
}


class PatternError(Exception):
    """A pattern spec that can't be used, with every problem listed."""

    def __init__(self, problems: list[str]):
        super().__init__("\n".join(problems))
        self.problems = problems


class GenerationError(Exception):
    """A pattern that could not produce a valid question."""


# --- the spec ------------------------------------------------------------------


@dataclass
class Template:
    text: str
    blanks: list  # (start, end, tree, format)


@dataclass
class Part:
    question_type: str
    marks: int
    text: Template
    answer: list | None  # parsed expressions, one per box
    answer_format: str
    options: dict | None  # {"correct": tree, "wrong": [(tree, mistake)], "format": str}
    steps: list  # [(marks, Template)]
    hint: Template | None
    explanation: Template | None
    unit: str | None
    unit_rule: str | None
    response_format: str | None


@dataclass
class Spec:
    code: str
    chapter: int
    skill: str
    question_type: str
    marks: int
    difficulty: int | None
    competency: str | None
    values: list  # (name, kind, data)
    require: list
    parts: list[Part]
    stimulus: Template | None
    misconception: Template | None
    max_words: int
    notes: str | None
    sources: list[str] = field(default_factory=list)
    raw: dict = field(default_factory=dict)

    @property
    def is_group(self) -> bool:
        return self.stimulus is not None


def _template(text, where, problems, known) -> Template | None:
    if text is None:
        return None
    if not isinstance(text, str) or not text.strip():
        problems.append(f"{where}: must be text.")
        return None
    blanks = []
    for match in _BLANK.finditer(text):
        expr, fmt = match.group(1).strip(), (match.group(2) or "plain")
        if fmt not in BLANK_FORMATS:
            problems.append(f"{where}: unknown format {fmt!r} (use {', '.join(BLANK_FORMATS)}).")
            continue
        try:
            tree = pattern_expr.parse(expr)
        except ExprError as exc:
            problems.append(f"{where}: {exc}")
            continue
        missing = pattern_expr.names_used(tree) - known
        if missing:
            problems.append(f"{where}: uses {', '.join(sorted(missing))}, which is not one of the values.")
        blanks.append((match.start(), match.end(), tree, fmt))
    left = _BLANK.sub("", text)
    if "{" in left or "}" in left:
        problems.append(f"{where}: has an unmatched {{ or }}.")
    return Template(text, blanks)


def _expr(text, where, problems, known):
    try:
        tree = pattern_expr.parse(text)
    except ExprError as exc:
        problems.append(f"{where}: {exc}")
        return None
    missing = pattern_expr.names_used(tree) - known
    if missing:
        problems.append(f"{where}: uses {', '.join(sorted(missing))}, which is not one of the values.")
    return tree


def _plain(value) -> bool:
    return isinstance(value, (str, int)) and not isinstance(value, bool)


def _part(data, where, problems, known, *, top_type=None) -> Part | None:
    qtype = data.get("questionType", top_type)
    if qtype not in QUESTION_TYPES:
        problems.append(f"{where}: questionType must be one of {', '.join(QUESTION_TYPES)}.")
        return None
    marks = data.get("marks")
    if not isinstance(marks, int) or isinstance(marks, bool) or not 1 <= marks <= 10:
        problems.append(f"{where}: marks must be a whole number from 1 to 10.")
        return None
    text = _template(data.get("text"), f"{where} text", problems, known)
    if text is None:
        problems.append(f"{where}: has no text.")
    answer = options = None
    answer_format = data.get("answerFormat", "plain")
    if answer_format not in ANSWER_FORMATS:
        problems.append(f"{where}: answerFormat must be {' or '.join(ANSWER_FORMATS)}.")
    if qtype == "Single Select":
        o = data.get("options")
        wrong = o.get("wrong") if isinstance(o, dict) else None
        if not isinstance(o, dict) or not isinstance(wrong, list) or len(wrong) != 3:
            problems.append(f"{where}: a Single Select pattern needs options with a correct expression and 3 wrong ones.")
        else:
            fmt = o.get("format", "plain")
            if fmt not in BLANK_FORMATS:
                problems.append(f"{where}: unknown options format {fmt!r}.")
            correct = _expr(o.get("correct", ""), f"{where} options.correct", problems, known)
            parsed = []
            for i, w in enumerate(wrong, 1):
                if not isinstance(w, dict) or not str(w.get("mistake") or "").strip():
                    problems.append(f"{where} wrong option {i}: needs an expr and the mistake behind it.")
                    continue
                parsed.append((
                    _expr(w.get("expr", ""), f"{where} wrong option {i}", problems, known),
                    _template(w["mistake"].strip(), f"{where} wrong option {i} mistake", problems, known),
                ))
            options = {"correct": correct, "wrong": parsed, "format": fmt}
    elif qtype in ("Numeric Entry", "Text Entry"):
        raw = data.get("answer")
        raw = [raw] if isinstance(raw, str) else raw
        if not isinstance(raw, list) or not raw or not all(isinstance(a, str) for a in raw):
            problems.append(f"{where}: needs an answer expression (or a list of them).")
        else:
            answer = [_expr(a, f"{where} answer", problems, known) for a in raw]
    elif qtype == "Constructed Response":
        raw = data.get("answer")  # the model answer, as text with blanks
        if not isinstance(raw, str):
            problems.append(f"{where}: a written question needs a model answer (text with blanks).")
        else:
            answer = [_template(raw, f"{where} answer", problems, known)]
    steps = []
    raw_steps = data.get("steps") or []
    if marks >= 2 and not raw_steps:
        problems.append(f"{where}: a question worth {marks} marks needs marking steps.")
    for i, s in enumerate(raw_steps, 1):
        if not isinstance(s, dict) or not isinstance(s.get("marks"), int) or s["marks"] < 1:
            problems.append(f"{where} step {i}: needs marks (a whole number) and text.")
            continue
        if not str(s.get("text") or "").strip():
            problems.append(f"{where} step {i}: needs its text.")
            continue
        steps.append((s["marks"], _template(s.get("text"), f"{where} step {i}", problems, known)))
    if steps and sum(m for m, _t in steps) != marks:
        problems.append(f"{where}: the marking steps add up to {sum(m for m, _t in steps)}, not {marks}.")
    unit_rule = data.get("unitRule")
    if unit_rule is not None and unit_rule not in ("NONE", "STATED", "REQUIRED"):
        problems.append(f"{where}: unitRule must be NONE, STATED or REQUIRED.")
    unit = data.get("unit")
    if unit is not None:
        from app.services import units

        if not isinstance(unit, str) or len(unit) > 20 or units.unit_code(unit) is None:
            problems.append(f"{where}: unit {unit!r} is not one the platform marks.")
        elif answer_format == "fraction":
            problems.append(f"{where}: a fraction answer can't also carry a unit (the platform can't mark both yet).")
    response_format = data.get("responseFormat")
    if response_format is not None and (not isinstance(response_format, str) or len(response_format) > 255):
        problems.append(f"{where}: responseFormat must be text of at most 255 characters.")
    return Part(
        question_type=qtype, marks=marks, text=text, answer=answer, answer_format=answer_format, options=options,
        steps=steps,
        hint=_template(data.get("hint"), f"{where} hint", problems, known),
        explanation=_template(data.get("explanation"), f"{where} explanation", problems, known),
        unit=data.get("unit"), unit_rule=unit_rule, response_format=data.get("responseFormat"),
    )


def clean_spec(raw: dict) -> Spec:
    """A checked spec, or PatternError listing every problem."""
    problems: list[str] = []
    if not isinstance(raw, dict):
        raise PatternError(["A pattern must be a JSON object."])
    code = str(raw.get("code") or "").strip()
    where = code or "A pattern"
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{2,59}", code):
        problems.append(f"{where}: code must be 3 to 60 letters, digits and hyphens.")
    chapter = raw.get("chapter")
    if not isinstance(chapter, int) or isinstance(chapter, bool) or chapter < 1:
        problems.append(f"{where}: chapter must be the chapter number.")
    skill = str(raw.get("skill") or "").strip()
    if not skill:
        problems.append(f"{where}: needs the Skill ID.")
    difficulty = raw.get("difficulty")
    if difficulty is not None and difficulty not in (1, 2, 3, 4):
        problems.append(f"{where}: difficulty must be 1, 2, 3 or 4.")

    known: set[str] = set()
    values = []
    for i, v in enumerate(raw.get("values") or [], 1):
        vw = f"{where} value {i}"
        name = v.get("name") if isinstance(v, dict) else None
        if not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,30}", name) or name in pattern_expr.FUNCTIONS:
            problems.append(f"{vw}: needs a name of lower-case letters, digits and _.")
            continue
        if name in known:
            problems.append(f"{vw}: {name} is named twice.")
        kinds = [k for k in ("int", "choice", "list", "expr") if k in v]
        if len(kinds) != 1:
            problems.append(f"{vw} ({name}): needs exactly one of int, choice, list or expr.")
            continue
        kind = kinds[0]
        data = v[kind]
        if kind == "int":
            if not isinstance(data, dict) or "min" not in data or "max" not in data:
                problems.append(f"{vw} ({name}): int needs min and max.")
                continue
            data = {
                k: _expr(str(data[k]), f"{vw} ({name}) {k}", problems, known)
                for k in ("min", "max", "step") if k in data
            }
        elif kind == "choice":
            ok = isinstance(data, list) and data and all(
                _plain(c) or (isinstance(c, dict) and c and all(isinstance(k, str) and _plain(x) for k, x in c.items()))
                for c in data
            )
            if not ok:
                problems.append(f"{vw} ({name}): choice must be a list of text, whole numbers or simple records.")
                continue
        elif kind == "list":
            if data not in SHARED_LISTS:
                problems.append(f"{vw} ({name}): there is no shared list {data!r} (lists: {', '.join(SHARED_LISTS)}).")
                continue
        else:
            data = _expr(str(data), f"{vw} ({name})", problems, known)
        values.append((name, kind, data))
        known.add(name)
    require = [_expr(str(r), f"{where} require {i}", problems, known) for i, r in enumerate(raw.get("require") or [], 1)]

    question_type = raw.get("questionType")
    stimulus = None
    parts: list[Part] = []
    if question_type == LONG_ANSWER:
        stimulus = _template(raw.get("stimulus"), f"{where} stimulus", problems, known)
        if stimulus is None:
            problems.append(f"{where}: a Long Answer needs its problem (the stimulus).")
        if raw.get("marks") not in LONG_ANSWER_MARKS:
            problems.append(f"{where}: a Long Answer is worth 3 or 5 marks.")
        for key in ("text", "answer", "steps", "hint", "options", "explanation"):
            if key in raw:
                # Each step carries its own; a top-level one would never be shown (review).
                problems.append(f"{where}: a Long Answer's {key} belongs on its steps, not on the question.")
        raw_parts = raw.get("parts")
        if not isinstance(raw_parts, list) or not 2 <= len(raw_parts) <= 6:
            problems.append(f"{where}: a Long Answer needs 2 to 6 steps (parts).")
        else:
            for i, p in enumerate(raw_parts, 1):
                p = p if isinstance(p, dict) else {}
                if not str(p.get("text") or "").startswith(f"({chr(96 + i)}) "):
                    # The paper letters the steps by their own text (review).
                    problems.append(f"{where} step {i}: its text must start with \"({chr(96 + i)}) \".")
                if p.get("questionType") not in STEP_TYPES:
                    problems.append(f"{where} step {i}: must be marked by the platform ({', '.join(STEP_TYPES)}).")
                    continue
                if p.get("marks") not in (1, 2):
                    problems.append(f"{where} step {i}: a step is worth 1 or 2 marks.")
                    continue
                part = _part(p, f"{where} step {i}", problems, known)
                if part:
                    parts.append(part)
            total = sum(p.marks for p in parts)
            if len(parts) == len(raw_parts) and raw.get("marks") != total:
                problems.append(f"{where}: marks must be the total of its steps ({total}).")
    elif "parts" in raw:
        stimulus = _template(raw.get("stimulus"), f"{where} stimulus", problems, known)
        if stimulus is None:
            problems.append(f"{where}: a case study needs its stimulus (the scenario).")
        raw_parts = raw.get("parts")
        if not isinstance(raw_parts, list) or not 2 <= len(raw_parts) <= 6:
            problems.append(f"{where}: a case study needs 2 to 6 parts.")
        else:
            for i, p in enumerate(raw_parts, 1):
                part = _part(p if isinstance(p, dict) else {}, f"{where} part {i}", problems, known)
                if part:
                    parts.append(part)
        total = sum(p.marks for p in parts)
        if raw.get("marks") != total:
            problems.append(f"{where}: marks must be the total of its parts ({total}).")
    else:
        part = _part(raw, where, problems, known)
        if part:
            parts.append(part)
    misconception = _template(raw.get("misconception"), f"{where} misconception", problems, known)
    competency = raw.get("competency")
    if competency is not None and (not isinstance(competency, str) or len(competency) > 150):
        problems.append(f"{where}: competency must be text of at most 150 characters.")
    max_words = raw.get("maxWords", DEFAULT_MAX_WORDS)
    if not isinstance(max_words, int) or not 10 <= max_words <= 250:
        problems.append(f"{where}: maxWords must be from 10 to 250.")
    if problems:
        raise PatternError(problems)
    return Spec(
        code=code, chapter=chapter, skill=skill,
        question_type=(
            LONG_ANSWER if question_type == LONG_ANSWER
            else "Case Study" if stimulus is not None else (question_type or parts[0].question_type)
        ),
        marks=raw.get("marks"), difficulty=difficulty, competency=raw.get("competency"),
        values=values, require=[r for r in require if r is not None], parts=parts, stimulus=stimulus,
        misconception=misconception,
        max_words=max_words, notes=raw.get("notes"), sources=list(raw.get("sources") or []), raw=raw,
    )


def spec_sha256(raw: dict) -> str:
    return hashlib.sha256(json.dumps(raw, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


# --- filling the blanks -----------------------------------------------------------


def _draw(spec: Spec, rng: random.Random) -> dict:
    env: dict = {}
    for name, kind, data in spec.values:
        if kind == "int":
            lo = pattern_expr.evaluate(data["min"], env)
            hi = pattern_expr.evaluate(data["max"], env)
            step = pattern_expr.evaluate(data["step"], env) if "step" in data else 1
            for bound in (lo, hi, step):
                if not isinstance(bound, int) or isinstance(bound, bool):
                    raise ExprError(f"{name}: its bounds must be whole numbers.")
            if step < 1 or hi < lo or (hi - lo) > MAX_INT_RANGE:
                raise ExprError(f"{name}: no whole number fits between {lo} and {hi}.")
            env[name] = lo + step * rng.randrange((hi - lo) // step + 1)
        elif kind == "choice":
            env[name] = rng.choice(data)
        elif kind == "list":
            env[name] = rng.choice(SHARED_LISTS[data])
        else:
            env[name] = pattern_expr.evaluate(data, env)
    return env


def _comma(n: int) -> str:
    return f"{n:,}"


def format_value(value, fmt: str = "plain") -> str:
    if isinstance(value, bool):
        raise ExprError("True/False can't be written into a question.")
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        raise ExprError("A record can't be written into a question; use one of its keys.")
    value = Fraction(value)
    if value.denominator == 1:
        n = int(value)
        if fmt == "num":
            return _comma(n)
        if fmt == "money":
            return f"₹{_comma(n)}"
        return str(n)
    if fmt == "mixed" and abs(value) > 1:
        whole = int(value)  # toward zero
        rest = abs(value - whole)
        return f"{whole} {rest.numerator}/{rest.denominator}"
    if fmt in ("fraction", "mixed", "plain"):
        return f"{value.numerator}/{value.denominator}"
    raise ExprError(f"{value} is not a whole number, so it can't be written as {fmt}.")


def _render(template: Template | None, env: dict) -> str | None:
    if template is None:
        return None
    out, last = [], 0
    for start, end, tree, fmt in template.blanks:
        out.append(template.text[last:start])
        out.append(format_value(pattern_expr.evaluate(tree, env), fmt))
        last = end
    out.append(template.text[last:])
    return "".join(out)


def _answer_text(value, answer_format: str) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, bool) or isinstance(value, dict):
        raise ExprError("An answer must be a number or text.")
    value = Fraction(value)
    if value.denominator != 1 and answer_format != "fraction":
        raise ExprError(f"The answer {value} is not a whole number.")
    return format_value(value, "fraction" if value.denominator != 1 else "plain")


def _fraction_variants(key: str) -> str | None:
    """Other right ways to write a fraction answer: its decimal when that
    ends within 3 places (3/4 -> 0.75) and, above 1, the mixed number
    (7/2 -> 3 1/2). Marking accepts listed variants (review)."""
    value = Fraction(key)
    out = []
    if value.denominator in (2, 4, 5, 8, 10, 20, 25, 40, 50, 100, 125, 200, 250, 500, 1000):
        out.append(_decimal(value))
    if abs(value) > 1:
        out.append(format_value(value, "mixed"))
    return "|".join(o for o in out if o) or None


def _decimal(value: Fraction) -> str | None:
    for places in range(1, 4):
        scaled = value * 10**places
        if scaled.denominator == 1:
            whole, rest = divmod(abs(int(scaled)), 10**places)
            sign = "-" if value < 0 else ""
            return f"{sign}{whole}.{str(rest).rjust(places, '0')}"
    return None


def _words(text: str) -> int:
    return len(re.findall(r"\S+", text))


def _build_part(spec: Spec, part: Part, env: dict, rng: random.Random, stimulus: str | None) -> dict:
    text = _render(part.text, env)
    stem = f"{stimulus}\n\n{text}" if stimulus else text
    if _words(text) > spec.max_words:
        raise GenerationError(f"The question runs to {_words(text)} words, over the limit of {spec.max_words}.")
    question = {
        "question_type": part.question_type, "stem": stem, "marks": part.marks,
        "option_a": None, "option_b": None, "option_c": None, "option_d": None,
        "hint": _render(part.hint, env), "explanation": _render(part.explanation, env),
        "answer_unit": part.unit, "unit_rule": part.unit_rule, "response_format": part.response_format,
        "auto_gradable": part.question_type != "Constructed Response",
        "teacher_note": "\n".join(
            f"{m} mark{'s' if m > 1 else ''}: {_render(t, env)}" for m, t in part.steps
        ) or None,
        "mistakes": None,
        "accepted_variants": None,
    }
    if part.question_type == "Single Select":
        fmt = part.options["format"]
        correct_value = pattern_expr.evaluate(part.options["correct"], env)
        correct = format_value(correct_value, fmt)
        # The mistake notes may use blanks too ("picks a factor of {r.n}"), so fill them in.
        wrong = [(format_value(pattern_expr.evaluate(t, env), fmt), _render(m, env)) for t, m in part.options["wrong"]]
        shown = [correct] + [w for w, _m in wrong]
        if len(set(shown)) != 4:
            raise GenerationError("Two options would read the same.")
        order = list(range(4))
        rng.shuffle(order)
        letters = "ABCD"
        for slot, index in zip(letters, order):
            question[f"option_{slot.lower()}"] = shown[index]
        question["correct_answer"] = letters[order.index(0)]
        question["mistakes"] = {letters[order.index(i + 1)]: m for i, (_w, m) in enumerate(wrong)}
    elif part.question_type in ("Numeric Entry", "Text Entry"):
        boxes = [_answer_text(pattern_expr.evaluate(t, env), part.answer_format) for t in part.answer]
        if part.question_type == "Numeric Entry":
            for box in boxes:
                if box.startswith("-"):
                    raise GenerationError("The answer would be negative.")
        if any(not b for b in boxes):
            raise GenerationError("An answer box would be empty.")
        question["correct_answer"] = ";".join(boxes)
        if len(boxes) == 1 and "/" in boxes[0]:
            question["accepted_variants"] = _fraction_variants(boxes[0])
    else:
        question["correct_answer"] = _render(part.answer[0], env)
    for key in ("stem", "hint", "explanation", "teacher_note", "correct_answer"):
        if question[key] and ("{" in question[key] or "}" in question[key]):
            raise GenerationError("A blank was left unfilled.")
    return question


@dataclass
class Made:
    """One generated question (or, for a case study, its parts)."""
    seed: str
    values: dict
    questions: list[dict]
    stimulus: str | None
    misconception: str | None

    def fingerprints(self) -> list[str]:
        return [fingerprint(q) for q in self.questions]


def fingerprint(question: dict) -> str:
    """The question as a student reads it: the wording, the options in any
    order, and the right answer's text. Shuffling the options does not make
    a different question (review)."""
    norm = lambda s: " ".join(s.split()).casefold() if isinstance(s, str) else s  # noqa: E731
    options = [question.get(f"option_{x}") for x in "abcd"]
    if question["question_type"] == "Single Select":
        answer = question.get(f"option_{question['correct_answer'].lower()}")
    else:
        answer = question["correct_answer"]
    seen = [norm(question["stem"]), sorted(norm(o) for o in options if o), norm(answer)]
    normal = json.dumps(seen, ensure_ascii=False)
    return hashlib.sha256(normal.encode()).hexdigest()


def _jsonable(env: dict) -> dict:
    out = {}
    for k, v in env.items():
        out[k] = str(v) if isinstance(v, Fraction) else v
    return out


def make(spec: Spec, seed: str, *, version: int = 1) -> Made:
    """One question from a pattern, the same every time for the same seed.
    Draws values until every requirement and check passes (MAX_TRIES)."""
    rng = random.Random(f"{spec.code}:{version}:{seed}")
    last = "no values were tried"
    for _try in range(MAX_TRIES):
        try:
            env = _draw(spec, rng)
            if not all(pattern_expr.evaluate(r, env) for r in spec.require):
                last = "the requirements were not met"
                continue
            stimulus = _render(spec.stimulus, env)
            questions = [_build_part(spec, part, env, rng, stimulus) for part in spec.parts]
        except (ExprError, GenerationError, ArithmeticError) as exc:
            last = str(exc)
            continue
        return Made(seed=seed, values=_jsonable(env), questions=questions, stimulus=stimulus,
                    misconception=_render(spec.misconception, env))
    raise GenerationError(f"{spec.code}: no valid question after {MAX_TRIES} tries ({last}).")


def trial(spec: Spec, count: int = 200) -> dict:
    """Generates `count` copies to see whether a pattern works and how many
    different questions it can make. Used when a pattern is loaded."""
    failures, prints = 0, set()
    for i in range(count):
        try:
            made = make(spec, f"trial-{i}")
        except GenerationError:
            failures += 1
            continue
        prints.add(tuple(made.fingerprints()))
    return {"tried": count, "failed": failures, "distinct": len(prints)}


def preview(spec: Spec, count: int, seed: str = "preview", *, version: int = 1) -> list[dict]:
    """`count` copies for a reviewer, not stored; the same seed always shows
    the same copies."""
    out = []
    for i in range(count):
        made = make(spec, f"{seed}-{i}", version=version)
        out.append({
            "seed": made.seed, "values": made.values, "stimulus": made.stimulus,
            "misconception": made.misconception,
            "questions": [{k: v for k, v in q.items() if v is not None} for q in made.questions],
        })
    return out


# --- storing for a school ---------------------------------------------------------------


def build_rows(pattern, made: Made, *, school_id: str, student_id: str | None) -> list[tuple]:
    """The Question and GeneratedQuestion rows for one generated question
    (a case study: one pair per part), not yet added to a session."""
    from app.models import Question
    from app.models.papers import GeneratedQuestion

    group_id = str(uuid.uuid4()) if made.stimulus is not None else None
    rows = []
    for number, (data, print_) in enumerate(zip(made.questions, made.fingerprints()), start=1):
        question = Question(
            id=str(uuid.uuid4()),
            concept_lesson_id=pattern.concept_lesson_id,
            code=f"GEN-{uuid.uuid4().hex[:16].upper()}",
            origin="GENERATED",
            question_type=data["question_type"], stem=data["stem"],
            option_a=data["option_a"], option_b=data["option_b"],
            option_c=data["option_c"], option_d=data["option_d"],
            correct_answer=data["correct_answer"], accepted_variants=data["accepted_variants"],
            hint=data["hint"], explanation=data["explanation"],
            misconception_tag=made.misconception, marks=data["marks"],
            auto_gradable=data["auto_gradable"], difficulty=pattern.difficulty,
            competency=pattern.competency, response_format=data["response_format"],
            teacher_note=data["teacher_note"], answer_unit=data["answer_unit"],
            unit_rule=data["unit_rule"], status="APPROVED", quality_status="VERIFIED",
        )
        record = GeneratedQuestion(
            question_id=question.id, pattern_id=pattern.id, pattern_version=pattern.version,
            school_id=school_id, student_id=student_id, seed=made.seed,
            values_json=json.dumps(made.values, ensure_ascii=False),
            fingerprint=print_, group_id=group_id, part_number=number if group_id else None,
            stimulus=made.stimulus if group_id else None,
            mistakes_json=json.dumps(data["mistakes"], ensure_ascii=False) if data["mistakes"] else None,
        )
        rows.append((question, record))
    return rows


def student_fingerprints(db, student_ids) -> dict[str, set[str]]:
    """Every generated question each student has been given, by fingerprint."""
    from app.models.papers import GeneratedQuestion

    out: dict[str, set[str]] = {sid: set() for sid in student_ids}
    if out:
        for sid, print_ in db.query(GeneratedQuestion.student_id, GeneratedQuestion.fingerprint).filter(
            GeneratedQuestion.student_id.in_(list(out))
        ):
            out[sid].add(print_)
    return out


def make_new(spec: Spec, pattern, seen: set[str], avoid: set[str] = frozenset(), attempts: int = 20) -> Made:
    """A question from the pattern the student has never had (`seen`),
    preferably one nobody else on this paper has (`avoid`). Shailesh, 27
    Oct 2026: a student never gets the same question twice; each student's
    version differs wherever the pattern allows."""
    fallback = None
    # The more a student has had, the harder an unseen one is to find by
    # chance, so the tries grow with it (review).
    tries = attempts + min(len(seen), 400)
    for i in range(tries):
        try:
            made = make(spec, uuid.uuid4().hex[:16], version=pattern.version)
        except GenerationError:
            continue
        prints = made.fingerprints()
        if any(p in seen for p in prints):
            continue
        if not any(p in avoid for p in prints):
            return made
        fallback = fallback or made
    if fallback is not None:
        return fallback
    raise GenerationError(f"{pattern.code} is used up for this student: no question they haven't had after {tries} tries.")


def generate_for_student(db, pattern, *, school_id: str, student_id: str, attempts: int = 20) -> list:
    """Makes and stores one question (or one case study's parts) from an
    APPROVED pattern for a student who has never had it. Returns the
    Question rows; the caller commits."""
    if pattern.status != "APPROVED":
        raise GenerationError(f"{pattern.code} is not approved, so it can't be used in a paper yet.")
    spec = clean_spec(json.loads(pattern.spec_json))
    seen = student_fingerprints(db, [student_id])[student_id]
    made = make_new(spec, pattern, seen, attempts=attempts)
    rows = build_rows(pattern, made, school_id=school_id, student_id=student_id)
    for question, record in rows:
        db.add(question)
    db.flush()
    for _question, record in rows:
        db.add(record)
    db.flush()
    return [q for q, _r in rows]
