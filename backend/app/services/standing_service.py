"""Class standing (#185, 26 Oct 2026): where a student stands in their class
at their school, per chapter and overall, said only as "Top 10%", "Top
25%" or "Top Half".

Decisions (Shailesh, 26 Oct 2026; PHASE6_MY_PROGRESS_DESIGN.md, "Class
standing"):

- Compared with every active student of the same class at the same school,
  all sections together (a section is too small to be steady, and too easy
  to work out who is where).
- Per chapter, and overall across the class's chapters.
- Only the top half is told where they stand; below it nothing is said, and
  My Progress shows the student's own progress and what to practise next.
  Minors: never a named leaderboard, a rank, an exact percentile or the
  class's size (Section 11 of the blueprint; DPDP).
- A standing exists only when at least 10 students in the class each have
  at least 3 marked answers in it.

From the independent review (26 Oct 2026):

- "Top 10%" needs a class of at least 30. In a class of 10 it would mean
  "first", which is a rank in all but name; below 30 the top is told "Top
  25%".
- Only practice the teacher set counts. A student's own practice
  (SELF_PRACTICE) and Foundation Repair sets are easier sets given to some
  students only, so they would let a ranking be climbed rather than earned.
- The overall standing averages the student's chapter percentages (chapters
  with 3+ marked answers) and needs 10+ marked answers in all, so three lucky
  answers can't top the class.
- Worked out in the database (the latest marked answer per question, then
  totals per student and chapter), once per class, and kept for 10 minutes.

Scores use the same rule as My Progress (progress_service): each question's
latest marked answer, marks earned over marks possible.
"""
from __future__ import annotations

import threading
import time

from sqlalchemy import and_, case, func, literal_column, select
from sqlalchemy.orm import Session

from app.models import (
    FOUNDATION_REPAIR_REASONS,
    Assignment,
    AssignmentTarget,
    Attempt,
    AttemptAnswer,
    ConceptLesson,
    Question,
    Student,
    User,
)

MIN_STUDENTS = 10
MIN_ANSWERS = 3
MIN_OVERALL_ANSWERS = 10
TOP_10_MIN_STUDENTS = 30
CACHE_SECONDS = 600

TOP_10, TOP_25, TOP_HALF = "TOP_10", "TOP_25", "TOP_HALF"

_HANDED_IN = ("SUBMITTED", "EVALUATED")
_NOT_COUNTED = ("SELF_PRACTICE", *FOUNDATION_REPAIR_REASONS)

_cache: dict[tuple, tuple[float, dict]] = {}
_cache_lock = threading.Lock()


def band_from_position(above: int, group: int) -> str | None:
    """The band for a student with `above` classmates strictly ahead of them,
    in a group of `group`. Students level on score share the better place.
    None in the lower half. Top 10% only in a group of 30 or more."""
    if group <= 0:
        return None
    share = above / group
    if share < 0.10 and group >= TOP_10_MIN_STUDENTS:
        return TOP_10
    if share < 0.25:
        return TOP_25
    if share < 0.50:
        return TOP_HALF
    return None


def _class_key(student: Student) -> str | None:
    name = (student.class_name or "").strip()
    return name or None


def class_label(student: Student) -> str | None:
    name = _class_key(student)
    if not name:
        return None
    return name if name.lower().startswith("class") else f"Class {name}"


def _classmates(db: Session, school_id: str, class_key: str) -> list[str]:
    """Active students (and active sign-ins) of this class at this school."""
    return [
        sid
        for (sid,) in db.query(Student.id)
        .join(User, User.id == Student.user_id)
        .filter(
            Student.school_id == school_id,
            func.trim(Student.class_name) == class_key,
            Student.is_active.is_(True),
            User.is_active.is_(True),
        )
    ]


def _totals(db: Session, student_ids: list[str], chapter_ids: list[str]) -> dict[str, dict[str, tuple[float, int, int]]]:
    """student id -> chapter id -> (earned, possible, answered), from each
    question's latest marked answer on practice the teacher set. The latest
    answer is picked in the database (ROW_NUMBER), so only one row per
    student and chapter comes back."""
    if not student_ids or not chapter_ids:
        return {}
    score = func.coalesce(AttemptAnswer.manual_score, AttemptAnswer.auto_score)
    ranked = (
        select(
            AssignmentTarget.student_id.label("student_id"),
            ConceptLesson.chapter_id.label("chapter_id"),
            score.label("score"),
            AttemptAnswer.max_score.label("possible"),
            func.row_number()
            .over(
                partition_by=(AssignmentTarget.student_id, AttemptAnswer.question_id),
                order_by=(Attempt.submitted_at.desc(), Attempt.attempt_number.desc(), Attempt.id.desc()),
            )
            .label("n"),
        )
        .select_from(AttemptAnswer)
        .join(Attempt, Attempt.id == AttemptAnswer.attempt_id)
        .join(AssignmentTarget, AssignmentTarget.id == Attempt.assignment_target_id)
        .join(Assignment, Assignment.id == AssignmentTarget.assignment_id)
        .join(Question, Question.id == AttemptAnswer.question_id)
        .join(ConceptLesson, ConceptLesson.id == Question.concept_lesson_id)
        .where(
            AssignmentTarget.student_id.in_(student_ids),
            ConceptLesson.chapter_id.in_(chapter_ids),
            Attempt.status.in_(_HANDED_IN),
            Assignment.status != "CANCELLED",
            Assignment.reason.notin_(_NOT_COUNTED),
            # A written answer still waiting for its mark: the question's
            # earlier marked answer counts instead.
            score.isnot(None),
            AttemptAnswer.max_score > 0,
        )
        .subquery()
    )
    clipped = case(
        (ranked.c.score < 0, literal_column("0")),
        (ranked.c.score > ranked.c.possible, ranked.c.possible),
        else_=ranked.c.score,
    )
    rows = db.execute(
        select(
            ranked.c.student_id,
            ranked.c.chapter_id,
            func.sum(clipped),
            func.sum(ranked.c.possible),
            func.count(),
        )
        .where(ranked.c.n == 1)
        .group_by(ranked.c.student_id, ranked.c.chapter_id)
    ).all()
    out: dict[str, dict[str, tuple[float, int, int]]] = {}
    for student_id, chapter_id, earned, possible, answered in rows:
        out.setdefault(student_id, {})[chapter_id] = (float(earned or 0), int(possible or 0), int(answered or 0))
    return out


def _bands(values: dict[str, float]) -> dict[str, str]:
    """Each eligible student's band from their score, among those given.
    Nothing when fewer than MIN_STUDENTS."""
    if len(values) < MIN_STUDENTS:
        return {}
    ordered = sorted(values.values(), reverse=True)
    bands: dict[str, str] = {}
    for sid, value in values.items():
        # Students level on score (within a tiny tolerance, for fractions
        # reached by different sums) share the better place.
        above = sum(1 for other in ordered if other > value + 1e-9)
        band = band_from_position(above, len(values))
        if band:
            bands[sid] = band
    return bands


def _class_bands(db: Session, school_id: str, class_key: str, chapter_ids: list[str]) -> dict:
    classmates = _classmates(db, school_id, class_key)
    if len(classmates) < MIN_STUDENTS:
        return {"overall": {}, "chapters": {}}
    totals = _totals(db, classmates, chapter_ids)
    chapters: dict[str, dict[str, str]] = {}
    for chapter_id in chapter_ids:
        values = {
            sid: per[chapter_id][0] / per[chapter_id][1]
            for sid, per in totals.items()
            if chapter_id in per and per[chapter_id][2] >= MIN_ANSWERS and per[chapter_id][1] > 0
        }
        chapters[chapter_id] = _bands(values)
    overall_values: dict[str, float] = {}
    for sid, per in totals.items():
        if sum(t[2] for t in per.values()) < MIN_OVERALL_ANSWERS:
            continue
        qualifying = [t[0] / t[1] for t in per.values() if t[2] >= MIN_ANSWERS and t[1] > 0]
        if qualifying:
            overall_values[sid] = sum(qualifying) / len(qualifying)
    return {"overall": _bands(overall_values), "chapters": chapters}


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def class_standing(db: Session, student: Student, chapter_ids: list[str]) -> dict:
    """{"overall": band | None, "chapters": {chapter id: band}} for the
    student, among their class at their school, over the class's chapters.
    Chapters with no standing are left out; nothing but the band is
    returned. The class's bands are worked out once and kept for
    CACHE_SECONDS."""
    class_key = _class_key(student)
    if not class_key or not chapter_ids:
        return {"overall": None, "chapters": {}}
    key = (student.school_id, class_key, tuple(sorted(chapter_ids)))
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
    if hit and now - hit[0] < CACHE_SECONDS:
        bands = hit[1]
    else:
        bands = _class_bands(db, student.school_id, class_key, list(chapter_ids))
        with _cache_lock:
            if len(_cache) > 500:
                _cache.clear()
            _cache[key] = (now, bands)
    return {
        "overall": bands["overall"].get(student.id),
        "chapters": {cid: b[student.id] for cid, b in bands["chapters"].items() if student.id in b},
    }
