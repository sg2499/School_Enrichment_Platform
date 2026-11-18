"""Repeated questions (#234, 18 Nov 2026).

The ICSE and Class 7 content repeats itself: the same wording, options and
answer appear more than once in a chapter (1,897 in ICSE Class 7, 1,729 in
CBSE Class 7, once the names are ignored). A repeat is kept in the bank, so
nothing is lost and the reviewer can see it, but it is left out of practice
sets and of bulk approval, so a child never meets the same question twice in
one chapter.

Rule: within one chapter, two BANK questions are the same when their wording,
four options and correct answer match after lower-casing and collapsing
spaces. The first by code is kept; the others carry repeat_of_id pointing at
it. Wording alone is not enough: "Which number is greatest?" is a normal
stem with different options and answers. Generated paper questions are never
touched.

`scan` only reads. `apply` writes repeat_of_id (and clears it where a question
no longer repeats), so it is safe to run again after content changes.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.models import Chapter, ConceptLesson, Question


def _norm(text: str | None) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _key(q: Question) -> tuple:
    return (
        _norm(q.stem),
        _norm(q.option_a), _norm(q.option_b), _norm(q.option_c), _norm(q.option_d),
        _norm(q.correct_answer),
    )


def find_repeats(questions: list[Question]) -> dict[str, str]:
    """{repeat question id: kept question id} for one chapter's questions."""
    groups: dict[tuple, list[Question]] = defaultdict(list)
    for q in questions:
        if q.origin != "BANK" or not _norm(q.stem):
            continue
        groups[_key(q)].append(q)
    out: dict[str, str] = {}
    for group in groups.values():
        if len(group) > 1:
            group.sort(key=lambda q: q.code)
            kept = group[0]
            for q in group[1:]:
                out[q.id] = kept.id
    return out


@dataclass
class ChapterRepeats:
    chapter_id: str
    chapter_code: str
    chapter_title: str
    questions: int = 0
    repeats: int = 0
    newly_flagged: int = 0
    cleared: int = 0
    pairs: list[tuple[str, str]] = field(default_factory=list)  # (repeat code, kept code)


def _chapter_questions(db: Session, chapter: Chapter) -> list[Question]:
    return (
        db.query(Question)
        .join(ConceptLesson, Question.concept_lesson_id == ConceptLesson.id)
        .filter(ConceptLesson.chapter_id == chapter.id, Question.origin == "BANK")
        .order_by(Question.code)
        .all()
    )


def process_chapter(db: Session, chapter: Chapter, *, apply: bool) -> ChapterRepeats:
    questions = _chapter_questions(db, chapter)
    found = find_repeats(questions)
    by_id = {q.id: q for q in questions}
    report = ChapterRepeats(chapter.id, chapter.code, chapter.title, questions=len(questions), repeats=len(found))
    for q in questions:
        want = found.get(q.id)
        if want:
            report.pairs.append((q.code, by_id[want].code))
        if q.repeat_of_id == want:
            continue
        if want:
            report.newly_flagged += 1
        else:
            report.cleared += 1
        if apply:
            q.repeat_of_id = want
    if apply:
        db.flush()
    return report


def process(db: Session, chapters: list[Chapter], *, apply: bool) -> list[ChapterRepeats]:
    return [process_chapter(db, c, apply=apply) for c in chapters]
