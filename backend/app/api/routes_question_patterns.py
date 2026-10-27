"""Question patterns for the Super Admin (#166 step 1, 27 Oct 2026).

Read-only, plus a preview: the patterns loaded for an engine, one pattern's
spec and how it fared in its trial, and fresh sample copies made on demand
(never stored), so a pattern can be looked at before Ashalatha approves it.
Loading and approving are done by scripts/load_patterns.py and
scripts/approve_patterns.py, which keep an audit trail.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.core.rate_limit import limiter
from app.database import get_db
from app.dependencies import require_roles
from app.models import Chapter, ConceptLesson
from app.models.papers import PATTERN_STATUSES, QuestionPattern
from app.services import pattern_engine

router = APIRouter(prefix="/api/question-patterns", tags=["question-patterns"])
_super_admin = Depends(require_roles("SUPER_ADMIN"))


def _summary(pattern: QuestionPattern, chapter: Chapter, skill: ConceptLesson) -> dict:
    return {
        "id": pattern.id, "code": pattern.code, "status": pattern.status, "version": pattern.version,
        "questionType": pattern.question_type, "marks": pattern.marks, "difficulty": pattern.difficulty,
        "competency": pattern.competency,
        "chapter": {"id": chapter.id, "chapterNo": chapter.chapter_no, "title": chapter.title},
        "skill": {"id": skill.id, "code": skill.code, "title": skill.title},
        "approvedBy": pattern.approved_by,
        "approvedAt": pattern.approved_at.isoformat() if pattern.approved_at else None,
    }


@router.get("")
def list_patterns(
    boardCourseId: str | None = None,
    chapterId: str | None = None,
    status: str | None = Query(None, pattern="^(DRAFT|APPROVED|RETIRED)$"),
    _user=_super_admin,
    db: Session = Depends(get_db),
):
    query = (
        db.query(QuestionPattern, Chapter, ConceptLesson)
        .join(Chapter, Chapter.id == QuestionPattern.chapter_id)
        .join(ConceptLesson, ConceptLesson.id == QuestionPattern.concept_lesson_id)
    )
    if boardCourseId:
        query = query.filter(QuestionPattern.board_course_id == boardCourseId)
    if chapterId:
        query = query.filter(QuestionPattern.chapter_id == chapterId)
    if status:
        query = query.filter(QuestionPattern.status == status)
    rows = query.order_by(Chapter.chapter_no, ConceptLesson.sequence, QuestionPattern.code).all()
    counts = {s: 0 for s in PATTERN_STATUSES}
    for pattern, _c, _s in rows:
        counts[pattern.status] = counts.get(pattern.status, 0) + 1
    return {"patterns": [_summary(*row) for row in rows], "counts": counts}


def _load(db: Session, pattern_id: str):
    row = (
        db.query(QuestionPattern, Chapter, ConceptLesson)
        .join(Chapter, Chapter.id == QuestionPattern.chapter_id)
        .join(ConceptLesson, ConceptLesson.id == QuestionPattern.concept_lesson_id)
        .filter(QuestionPattern.id == pattern_id)
        .first()
    )
    if row is None:
        api_error(404, "NOT_FOUND", "That question pattern couldn't be found.")
    return row


@router.get("/{pattern_id}")
def get_pattern(pattern_id: str, _user=_super_admin, db: Session = Depends(get_db)):
    pattern, chapter, skill = _load(db, pattern_id)
    raw = json.loads(pattern.spec_json)
    return {**_summary(pattern, chapter, skill), "notes": raw.get("notes"), "sources": raw.get("sources") or [], "spec": raw}


class PreviewRequest(BaseModel):
    count: int = Field(5, ge=1, le=20)
    seed: str | None = Field(None, max_length=40, pattern=r"^[A-Za-z0-9-]*$")


@router.post("/{pattern_id}/preview")
@limiter.limit("30/minute")
def preview_pattern(
    request: Request, pattern_id: str, payload: PreviewRequest, _user=_super_admin, db: Session = Depends(get_db)
):
    pattern, chapter, skill = _load(db, pattern_id)
    try:
        spec = pattern_engine.clean_spec(json.loads(pattern.spec_json))
        copies = pattern_engine.preview(spec, payload.count, payload.seed or "preview", version=pattern.version)
    except (pattern_engine.PatternError, pattern_engine.GenerationError):
        api_error(422, "PATTERN_UNWORKABLE", "This pattern can't make a valid question at the moment. It needs revising.")
    return {"pattern": _summary(pattern, chapter, skill), "copies": copies}
