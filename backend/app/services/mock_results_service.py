"""Mock paper results outside the paper's own pages (#207, 28 Oct 2026;
PHASE6_MOCK_RESULTS_DESIGN.md).

A paper's results count from the moment each student hands in (#208, his
call: "the results should be out instantly as soon as the students
submit"): My Progress (its Mock Papers card and the skill map), the weekly
parent report and Class Analytics' misconceptions. An answer counts when it
is the half of an either/or the student chose (counted) and has a mark (a
written answer still waiting for one doesn't, until it is marked); each is
dated by the hand-in, so a view "as of" a date sees it from then on.
Class standing (#185) leaves mocks out: a paper is set for one section, and
standing compares the whole class across sections.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import and_, or_, true
from sqlalchemy.orm import Session

from app.models import Question
from app.models.papers import MockPaper, MockPaperAnswer, MockPaperSitting
from app.services import teacher_assignment_service
from app.services.assessment_service import SCHOOL_TIMEZONE
from app.services.practice_access_service import Viewer

_EARLIEST = datetime.min.replace(tzinfo=timezone.utc)


def _aware(value: datetime | None) -> datetime:
    if value is None:
        return _EARLIEST
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def section_clause(class_level_id: str, section: str, board_course_id: str):
    return and_(
        MockPaper.class_level_id == class_level_id,
        MockPaper.section == section,
        MockPaper.board_course_id == board_course_id,
    )


def handed_in_clause():
    """Papers whose results count: approved ones (a withdrawn paper never
    opened). The sitting itself must be handed in."""
    return and_(MockPaper.status == "APPROVED", MockPaperSitting.status == "SUBMITTED")


def readable_papers_clause(viewer: Viewer):
    """The papers whose results this viewer may read: the school's, and for
    a teacher only those of a section (and course) they taught when the
    paper was made -- the same rule as practice (readable_assignments_clause)."""
    if viewer.school_id is None:
        return true()
    school = MockPaper.school_id == viewer.school_id
    if not viewer.is_teacher:
        return school
    window = teacher_assignment_service.readable_record_window_clause(
        teacher_id=viewer.teacher.id,
        class_level_id_col=MockPaper.class_level_id,
        section_col=MockPaper.section,
        board_course_id_col=MockPaper.board_course_id,
        created_at_col=MockPaper.created_at,
    )
    return and_(school, or_(MockPaper.created_by_user_id == viewer.user.id, window))


@dataclass
class MockAnswer:
    student_id: str
    question_id: str
    score: int
    max_score: int
    handed_in_at: datetime
    sitting_id: str
    skill_id: str | None
    slot_id: str


def answers(
    db: Session,
    student_ids: list[str] | None,
    *,
    before: datetime | None = None,
    paper_clause=None,
    chapter_id: str | None = None,
    paper_filter=None,
) -> list[MockAnswer]:
    """Every counted, marked answer of these students (None: any student) in
    papers they have handed in."""
    if student_ids is not None and not student_ids:
        return []
    query = (
        db.query(
            MockPaperSitting.student_id,
            MockPaperAnswer.question_id,
            MockPaperAnswer.manual_score,
            MockPaperAnswer.auto_score,
            MockPaperAnswer.max_score,
            MockPaperSitting.submitted_at,
            MockPaperSitting.id,
            Question.concept_lesson_id,
            MockPaperAnswer.slot_id,
        )
        .join(MockPaperSitting, MockPaperSitting.id == MockPaperAnswer.sitting_id)
        .join(MockPaper, MockPaper.id == MockPaperSitting.paper_id)
        .join(Question, Question.id == MockPaperAnswer.question_id)
        .filter(
            MockPaperAnswer.counted.is_(True),
            MockPaperAnswer.max_score > 0,
            handed_in_clause(),
        )
    )
    if student_ids is not None:
        query = query.filter(MockPaperSitting.student_id.in_(student_ids))
    if before is not None:
        query = query.filter(MockPaperSitting.submitted_at < before)
    if paper_clause is not None:
        query = query.filter(paper_clause)
    if paper_filter is not None:
        query = query.filter(paper_filter)
    if chapter_id is not None:
        from app.models import ConceptLesson

        query = query.join(ConceptLesson, ConceptLesson.id == Question.concept_lesson_id).filter(
            ConceptLesson.chapter_id == chapter_id
        )
    out = []
    for student_id, question_id, manual, auto, max_score, handed_in, sitting_id, skill_id, slot_id in query.all():
        score = manual if manual is not None else auto
        if score is None:
            continue  # a written answer waiting for its mark counts once it has one
        out.append(
            MockAnswer(student_id, question_id, max(0, min(score, max_score)), max_score, _aware(handed_in), sitting_id, skill_id, slot_id)
        )
    return out


def handed_in_chapter_ids(db: Session, paper_clause) -> set[str]:
    """The chapters of papers (matching the clause) someone has handed in."""
    out: set[str] = set()
    query = (
        db.query(MockPaper.chapter_ids_json)
        .join(MockPaperSitting, MockPaperSitting.paper_id == MockPaper.id)
        .filter(handed_in_clause(), paper_clause)
        .distinct()
    )
    for (raw,) in query:
        try:
            out.update(str(c) for c in json.loads(raw or "[]"))
        except ValueError:
            continue
    return out


def _percent(score, max_score) -> float | None:
    if score is None or not max_score:
        return None
    return round(100.0 * score / max_score, 1)


def papers_for(
    db: Session,
    student_id: str,
    *,
    paper_clause=None,
    handed_from: datetime | None = None,
    handed_before: datetime | None = None,
) -> list[dict]:
    """The papers the student has handed in, newest first: what My Progress
    and the weekly report list. A written answer still to be marked leaves
    the total "so far" (`waiting`)."""
    query = (
        db.query(MockPaper, MockPaperSitting)
        .join(MockPaperSitting, MockPaperSitting.paper_id == MockPaper.id)
        .filter(MockPaperSitting.student_id == student_id, handed_in_clause())
    )
    if paper_clause is not None:
        query = query.filter(paper_clause)
    if handed_from is not None:
        query = query.filter(MockPaperSitting.submitted_at >= handed_from)
    if handed_before is not None:
        query = query.filter(MockPaperSitting.submitted_at < handed_before)
    rows = query.order_by(MockPaperSitting.submitted_at.desc(), MockPaper.title).all()
    sitting_ids = [sitting.id for _, sitting in rows]
    marks: dict[str, list[int]] = {sid: [0, 0] for sid in sitting_ids}  # earned, waiting
    if sitting_ids:
        for sid, manual, auto in db.query(MockPaperAnswer.sitting_id, MockPaperAnswer.manual_score, MockPaperAnswer.auto_score).filter(
            MockPaperAnswer.sitting_id.in_(sitting_ids), MockPaperAnswer.counted.is_(True)
        ):
            score = manual if manual is not None else auto
            if score is None:
                marks[sid][1] += 1
            else:
                marks[sid][0] += score
    out = []
    for paper, sitting in rows:
        fmt = json.loads(paper.format_json)
        max_score = sitting.max_score or fmt.get("totalMarks")
        earned, waiting = marks[sitting.id]
        out.append(
            {
                "paperId": paper.id,
                "title": paper.title,
                # In India time, so the day shown is the school's day.
                "handedInAt": _aware(sitting.submitted_at).astimezone(SCHOOL_TIMEZONE).isoformat(),
                "score": earned,
                "maxScore": max_score,
                "percent": _percent(earned, max_score),
                "waiting": waiting,
            }
        )
    return out
