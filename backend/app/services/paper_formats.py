"""Test formats for mock papers (#166 step 3, 27 Oct 2026).

Shailesh, 27 Oct 2026: "the teacher should have flexible options and can
create whatever test they wanna create according to the needs of their
school". A format is any set of sections; three starting points follow
Ashalatha's Class 5 pattern (26 Oct, Q10), and a school's admin or a teacher
can save their own.

A format (JSON):
  name            "Monday Class Test"
  sections        1 to 10, each {name, marks, count, choices, kind}
                    marks   1, 2, 3, 4 (case study only) or 5
                    count   questions to answer, 1 to 50
                    choices how many of them come as an either/or pair, 0 to count
                    kind    ANY | CHOICE (multiple choice) | NUMBER (number or
                            short answers) | WRITTEN (3- and 5-mark long answers,
                            in steps the platform marks: #208) |
                            CASE_STUDY (4-mark case study, the only kind at 4 marks)
  timeMinutes     5 to 240; readingMinutes 0 to 15
  difficulty      {easy, medium, hard} percentages adding to 100, or null (any mix)
  applicationMin  the least share of marks from application and reasoning, 0 to 100, or null
  shuffle         true: each student's questions in a section come in their own order
  navigation      FREE (move between sections) | FORWARD (one way)
"""
from __future__ import annotations

KINDS = ("ANY", "CHOICE", "NUMBER", "WRITTEN", "CASE_STUDY")
KIND_LABEL = {
    "ANY": "Any kind", "CHOICE": "Multiple choice", "NUMBER": "Number or short answer",
    "WRITTEN": "Long answer in steps", "CASE_STUDY": "Case study",
}
MARKS = (1, 2, 3, 4, 5)
MAX_SECTIONS = 10
MAX_TOTAL = 200
MAX_NAME = 80
DEFAULT_MIX = {"easy": 30, "medium": 50, "hard": 20}


def _section(name, marks, count, choices=0, kind="ANY"):
    return {"name": name, "marks": marks, "count": count, "choices": choices, "kind": kind}


STARTING_POINTS = [
    {
        "id": "builtin-full",
        "name": "Full Paper (60 Marks)",
        "sections": [
            _section("Section A", 1, 15), _section("Section B", 2, 8), _section("Section C", 3, 5, 1),
            _section("Section D", 5, 2, 1), _section("Section E", 4, 1, 0, "CASE_STUDY"),
        ],
        "timeMinutes": 120, "readingMinutes": 10, "difficulty": DEFAULT_MIX, "applicationMin": 50,
        "shuffle": False, "navigation": "FREE",
    },
    {
        "id": "builtin-unit",
        "name": "Unit Test (40 Marks)",
        "sections": [
            _section("Section A", 1, 9), _section("Section B", 2, 5), _section("Section C", 3, 4, 1),
            _section("Section D", 5, 1), _section("Section E", 4, 1, 0, "CASE_STUDY"),
        ],
        "timeMinutes": 90, "readingMinutes": 5, "difficulty": DEFAULT_MIX, "applicationMin": 50,
        "shuffle": False, "navigation": "FREE",
    },
    {
        "id": "builtin-class",
        "name": "Class Test (20 Marks)",
        "sections": [_section("Section A", 1, 6), _section("Section B", 2, 4), _section("Section C", 3, 2)],
        "timeMinutes": 40, "readingMinutes": 0, "difficulty": DEFAULT_MIX, "applicationMin": 50,
        "shuffle": False, "navigation": "FREE",
    },
]


class FormatError(Exception):
    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems))
        self.problems = problems


def _int(value, low, high):
    return isinstance(value, int) and not isinstance(value, bool) and low <= value <= high


def clean_format(raw) -> dict:
    """A checked format, or FormatError listing every problem in words."""
    problems: list[str] = []
    if not isinstance(raw, dict):
        raise FormatError(["The test format is missing."])
    name = " ".join(str(raw.get("name") or "").split())
    if not name:
        problems.append("Give the test format a name.")
    elif len(name) > MAX_NAME:
        problems.append(f"Keep the name to {MAX_NAME} characters.")
    sections = raw.get("sections")
    cleaned = []
    if not isinstance(sections, list) or not sections:
        problems.append("Add at least one section.")
        sections = []
    elif len(sections) > MAX_SECTIONS:
        problems.append(f"A test can have at most {MAX_SECTIONS} sections.")
    for i, s in enumerate(sections[:MAX_SECTIONS], 1):
        where = f"Section {i}"
        if not isinstance(s, dict):
            problems.append(f"{where} is not filled in.")
            continue
        sname = " ".join(str(s.get("name") or "").split()) or f"Section {chr(64 + i)}"
        marks, count, choices, kind = s.get("marks"), s.get("count"), s.get("choices", 0), s.get("kind", "ANY")
        if len(sname) > 60:
            problems.append(f"{where}: keep its name to 60 characters.")
        if marks not in MARKS:
            problems.append(f"{where}: questions can be worth 1, 2, 3, 4 (a case study) or 5 marks.")
        if not _int(count, 1, 50):
            problems.append(f"{where}: choose from 1 to 50 questions.")
        if not _int(choices, 0, 50) or (isinstance(count, int) and isinstance(choices, int) and choices > count):
            problems.append(f"{where}: the either/or choices can't be more than the questions.")
        if kind not in KINDS:
            problems.append(f"{where}: choose the kind of question.")
        elif (marks == 4) != (kind == "CASE_STUDY"):
            problems.append(f"{where}: 4-mark questions are case studies, and case studies are worth 4 marks.")
        elif kind == "CHOICE" and marks not in (1, 2):
            problems.append(f"{where}: multiple-choice questions are worth 1 or 2 marks.")
        elif kind == "WRITTEN" and marks not in (3, 5):
            # Long answers in steps are 3 or 5 marks (#208 review): a 1- or
            # 2-mark one has no question to fill it.
            problems.append(f"{where}: long answers in steps are worth 3 or 5 marks.")
        cleaned.append({"name": sname, "marks": marks, "count": count, "choices": choices, "kind": kind})
    total = sum(s["marks"] * s["count"] for s in cleaned if isinstance(s["marks"], int) and isinstance(s["count"], int))
    if total > MAX_TOTAL:
        problems.append(f"The test comes to {total} marks; keep it to {MAX_TOTAL}.")
    time_minutes, reading = raw.get("timeMinutes"), raw.get("readingMinutes", 0)
    if not _int(time_minutes, 5, 240):
        problems.append("The time allowed must be from 5 minutes to 4 hours.")
    if not _int(reading, 0, 15):
        problems.append("Reading time can be up to 15 minutes.")
    mix = raw.get("difficulty")
    if mix is not None:
        if not isinstance(mix, dict) or not all(_int(mix.get(k), 0, 100) for k in ("easy", "medium", "hard")):
            problems.append("Set the difficulty mix as three percentages, or choose any mix.")
        elif mix["easy"] + mix["medium"] + mix["hard"] != 100:
            problems.append("The difficulty mix must add up to 100%.")
        else:
            mix = {k: mix[k] for k in ("easy", "medium", "hard")}
    application = raw.get("applicationMin")
    if application is not None and not _int(application, 0, 100):
        problems.append("The share of application marks must be from 0 to 100%.")
    navigation = raw.get("navigation", "FREE")
    if navigation not in ("FREE", "FORWARD"):
        problems.append("Choose how students move between sections.")
    if problems:
        raise FormatError(problems)
    return {
        "name": name, "sections": cleaned, "timeMinutes": time_minutes, "readingMinutes": reading,
        "difficulty": mix, "applicationMin": application, "shuffle": bool(raw.get("shuffle")),
        "navigation": navigation, "totalMarks": total,
    }


def total_marks(fmt: dict) -> int:
    return sum(s["marks"] * s["count"] for s in fmt["sections"])
