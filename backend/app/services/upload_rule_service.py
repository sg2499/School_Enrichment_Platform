"""Which questions take a PDF of the child's working or drawing (#237).

The box is shown only where it matters, so it is decided from the question
itself, once, in plain rules that a reviewer can read and change:

  * REQUIRED: the question asks the child to draw, construct, sketch, plot or
    trace something, or to attach their work, and a teacher marks it. Full marks
    are not possible without the file.
  * OPTIONAL: a teacher-marked question that asks for working, an explanation,
    a reason or a proof. A typed answer is enough; the child may attach their
    handwritten working too.
  * NONE: everything else. A question the platform marks by itself (a number,
    a word, a choice) never gets the box unless a reviewer sets one.

A reviewer's choice, stored in questions.upload_rule, always wins over these
rules. Reading wording is not perfect, which is why a person approves the list
in Curriculum Studio before content is released.
"""
import re

from app.models import Question

RULES = ("REQUIRED", "OPTIONAL", "NONE")

# An instruction to the child: "Draw ...", "Construct ...", at the start of a
# sentence. Not the word anywhere ("In an SSS construction, after drawing the
# base, what locates ..." is a question to answer in words, not a drawing).
_REQUIRED_DO = re.compile(
    r"(?:^|[.?!:]\s+)(?:then\s+|now\s+|first\s+)?(draw|construct|sketch|plot|trace|tessellate)\b",
    re.IGNORECASE,
)
_REQUIRED_ATTACH = re.compile(r"\b(upload|attach)\b", re.IGNORECASE)
_OPTIONAL = re.compile(
    r"\b(show (?:all |your |the )?(?:working|steps|work)|explain|justify|prove|give a reason|"
    r"give reasons|write the steps|in detail|describe how)\b",
    re.IGNORECASE,
)


def teacher_marked(question: Question) -> bool:
    return (not question.auto_gradable) or (question.question_type or "").strip() == "Constructed Response"


def detect(question: Question) -> tuple[str, str]:
    """The rule the question's own wording gives, with the reason in words."""
    if not teacher_marked(question):
        return "NONE", "The platform marks this answer by itself."
    text = f"{question.stem or ''} {question.response_format or ''}"
    found = _REQUIRED_DO.search(text) or _REQUIRED_ATTACH.search(text)
    if found:
        word = (found.group(1) if found.groups() else found.group(0)).lower()
        return "REQUIRED", f'The question asks the child to "{word}".'
    found = _OPTIONAL.search(text)
    if found:
        return "OPTIONAL", f'The question asks for "{found.group(0).lower()}", marked by a teacher.'
    return "NONE", "A teacher marks it, but it does not ask for working or a drawing."


def effective(question: Question) -> tuple[str, str]:
    """(rule, reason): the reviewer's choice if one was made, otherwise what
    the wording says."""
    chosen = (question.upload_rule or "").strip().upper()
    if chosen in RULES:
        return chosen, "Set by a reviewer."
    return detect(question)


def rule_of(question: Question) -> str:
    return effective(question)[0]
