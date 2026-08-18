"""Admin curriculum-studio endpoints: draft -> review -> publish workflow for
master content (Chapter/ConceptLesson/Question), plus mapping a published
chapter into a school's own calendar (SchoolCurriculumMap).

New for Phase 2 (18 Aug 2026) -- this is the API layer behind the exit
gate's "Admin UI to draft, review, publish, and map a chapter"
(IMPLEMENTATION_ROADMAP.md, Phase 2). Task #25's admin UI is the client of
everything in this file.

Authorization split, straight from the blueprint (Section 6.4: "Within
ADMIN, use capability scopes such as PLATFORM_ADMIN and SCHOOL_ADMIN so a
school coordinator cannot publish global curriculum or view another
school"):
  - Chapter/ConceptLesson/Question status transitions touch master content
    shared by every school -- SUPER_ADMIN only. A school's own ADMIN never
    gets to change what "published" means platform-wide.
  - SchoolCurriculumMap is the one school-scoped table here (see
    app/models/curriculum.py's own docstring). A school's ADMIN manages
    only their own school_id, resolved server-side from their SchoolAdmin
    row -- never trusted from client input. SUPER_ADMIN may act on any
    school by supplying schoolId explicitly (e.g. onboarding support).

Status transitions are explicit allow-lists (_CHAPTER_TRANSITIONS etc.)
rather than free-form status writes, so an admin can't skip straight from
DRAFT to PUBLISHED by PATCHing the field directly. Publishing a chapter
additionally re-checks blueprint Section 15.1's "publishing requires
validation and approval": import always lands in DRAFT (see
curriculum_import_service.py), so a chapter can only reach PUBLISHED from
REVIEW, must have at least one concept lesson, and every concept lesson
must have at least one question that has itself cleared APPROVED/PUBLISHED
review -- otherwise a chapter with no real question coverage could go live
for students.
"""
from sqlalchemy.orm import Session

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.errors import api_error
from app.database import get_db
from app.dependencies import require_roles
from app.models import BoardCourse, Chapter, ConceptLesson, Question, SchoolAdmin, SchoolCurriculumMap, User

router = APIRouter(prefix="/api/curriculum-admin", tags=["curriculum-admin"])

# --- status state machines ------------------------------------------------
# Deliberately explicit rather than "any status is a valid target" -- see
# module docstring. REVIEW -> DRAFT ("send back") and APPROVED -> SME_REVIEW
# / PUBLISHED -> SME_REVIEW ("pull back for rework") are the two allowed
# backward moves; nothing skips a step forward.

_CHAPTER_TRANSITIONS: dict[str, set[str]] = {
    "DRAFT": {"REVIEW"},
    "REVIEW": {"PUBLISHED", "DRAFT"},
    "PUBLISHED": {"ARCHIVED"},
    "ARCHIVED": {"DRAFT"},
}

_CONCEPT_LESSON_TRANSITIONS: dict[str, set[str]] = {
    "DRAFT": {"REVIEW"},
    "REVIEW": {"PUBLISHED", "DRAFT"},
    "PUBLISHED": {"ARCHIVED"},
    "ARCHIVED": {"DRAFT"},
}

_QUESTION_TRANSITIONS: dict[str, set[str]] = {
    "DRAFT": {"SME_REVIEW"},
    "SME_REVIEW": {"APPROVED", "DRAFT"},
    "APPROVED": {"PUBLISHED", "SME_REVIEW"},
    "PUBLISHED": {"SME_REVIEW"},
}

_READY_QUESTION_STATUSES = {"APPROVED", "PUBLISHED"}


class StatusChangeRequest(BaseModel):
    status: str


class SchoolCurriculumMapRequest(BaseModel):
    schoolId: str | None = None  # SUPER_ADMIN only -- ADMIN's own school is always used instead
    boardCourseId: str
    chapterId: str
    className: str | None = None
    section: str | None = None
    teacherId: str | None = None
    plannedStartDate: str | None = None
    plannedEndDate: str | None = None
    textbookReference: str | None = None
    sequence: int = 1


def _resolve_school_id(db: Session, user: User, requested_school_id: str | None) -> str:
    """ADMIN always acts on their own school, looked up server-side from
    their SchoolAdmin row -- a requested_school_id that disagrees with it is
    rejected rather than silently ignored, so a crafted request can't map
    curriculum into a school the caller doesn't belong to. SUPER_ADMIN has
    no school of their own and must say which one they mean."""
    if user.role == "SUPER_ADMIN":
        if not requested_school_id:
            api_error(422, "VALIDATION_ERROR", "schoolId is required for SUPER_ADMIN.")
        return requested_school_id

    school_admin = db.query(SchoolAdmin).filter(SchoolAdmin.user_id == user.id).first()
    if not school_admin:
        api_error(403, "FORBIDDEN", "No school is associated with this admin account.")
    if requested_school_id and requested_school_id != school_admin.school_id:
        api_error(403, "FORBIDDEN", "You can only manage curriculum mapping for your own school.")
    return school_admin.school_id


def _apply_transition(current_status: str, requested_status: str, transitions: dict[str, set[str]], label: str) -> None:
    allowed = transitions.get(current_status, set())
    if requested_status not in allowed:
        api_error(
            409,
            "INVALID_STATUS_TRANSITION",
            f"{label} cannot move from {current_status} to {requested_status}.",
            {"from": current_status, "to": requested_status, "allowed": sorted(allowed)},
        )


def _chapter_counts(db: Session, chapter_id: str) -> tuple[int, int]:
    lesson_count = db.query(ConceptLesson).filter(ConceptLesson.chapter_id == chapter_id).count()
    question_count = (
        db.query(Question)
        .join(ConceptLesson, Question.concept_lesson_id == ConceptLesson.id)
        .filter(ConceptLesson.chapter_id == chapter_id)
        .count()
    )
    return lesson_count, question_count


def _chapter_summary(chapter: Chapter, lesson_count: int, question_count: int) -> dict:
    return {
        "id": chapter.id,
        "code": chapter.code,
        "chapterNo": chapter.chapter_no,
        "title": chapter.title,
        "status": chapter.status,
        "disciplineId": chapter.discipline_id,
        "termId": chapter.term_id,
        "sequence": chapter.sequence,
        "conceptLessonCount": lesson_count,
        "questionCount": question_count,
        "createdAt": chapter.created_at.isoformat() if chapter.created_at else None,
        "updatedAt": chapter.updated_at.isoformat() if chapter.updated_at else None,
    }


def _map_summary(mapping: SchoolCurriculumMap) -> dict:
    return {
        "id": mapping.id,
        "schoolId": mapping.school_id,
        "boardCourseId": mapping.board_course_id,
        "chapterId": mapping.chapter_id,
        "className": mapping.class_name,
        "section": mapping.section,
        "teacherId": mapping.teacher_id,
        "plannedStartDate": mapping.planned_start_date,
        "plannedEndDate": mapping.planned_end_date,
        "textbookReference": mapping.textbook_reference,
        "sequence": mapping.sequence,
    }


# --- Chapter -----------------------------------------------------------


@router.get("/chapters", dependencies=[Depends(require_roles("SUPER_ADMIN"))])
def list_chapters(status: str | None = None, discipline_id: str | None = None, db: Session = Depends(get_db)):
    query = db.query(Chapter)
    if status:
        query = query.filter(Chapter.status == status.strip().upper())
    if discipline_id:
        query = query.filter(Chapter.discipline_id == discipline_id)
    chapters = query.order_by(Chapter.chapter_no).all()

    payload = []
    for chapter in chapters:
        lesson_count, question_count = _chapter_counts(db, chapter.id)
        payload.append(_chapter_summary(chapter, lesson_count, question_count))
    return {"chapters": payload}


@router.get("/chapters/{chapter_id}", dependencies=[Depends(require_roles("SUPER_ADMIN"))])
def get_chapter(chapter_id: str, db: Session = Depends(get_db)):
    chapter = db.get(Chapter, chapter_id)
    if not chapter:
        api_error(404, "NOT_FOUND", "Chapter not found.")

    lessons = (
        db.query(ConceptLesson)
        .filter(ConceptLesson.chapter_id == chapter.id)
        .order_by(ConceptLesson.sequence)
        .all()
    )
    lesson_payload = []
    total_questions = 0
    for lesson in lessons:
        question_count = db.query(Question).filter(Question.concept_lesson_id == lesson.id).count()
        total_questions += question_count
        lesson_payload.append(
            {
                "id": lesson.id,
                "code": lesson.code,
                "title": lesson.title,
                "status": lesson.status,
                "sequence": lesson.sequence,
                "questionCount": question_count,
            }
        )

    result = _chapter_summary(chapter, len(lessons), total_questions)
    result["conceptLessons"] = lesson_payload
    return result


@router.patch("/chapters/{chapter_id}/status", dependencies=[Depends(require_roles("SUPER_ADMIN"))])
def update_chapter_status(chapter_id: str, payload: StatusChangeRequest, db: Session = Depends(get_db)):
    chapter = db.get(Chapter, chapter_id)
    if not chapter:
        api_error(404, "NOT_FOUND", "Chapter not found.")

    requested_status = payload.status.strip().upper()
    _apply_transition(chapter.status, requested_status, _CHAPTER_TRANSITIONS, "Chapter")

    if requested_status == "PUBLISHED":
        lessons = db.query(ConceptLesson).filter(ConceptLesson.chapter_id == chapter.id).all()
        if not lessons:
            api_error(409, "CHAPTER_NOT_READY", "Chapter has no concept lessons to publish.")
        lessons_missing_questions = [
            lesson.code
            for lesson in lessons
            if not db.query(Question)
            .filter(Question.concept_lesson_id == lesson.id, Question.status.in_(_READY_QUESTION_STATUSES))
            .first()
        ]
        if lessons_missing_questions:
            api_error(
                409,
                "CHAPTER_NOT_READY",
                "Every concept lesson needs at least one approved question before the chapter can publish.",
                {"conceptLessonsMissingQuestions": lessons_missing_questions},
            )

    chapter.status = requested_status
    db.commit()
    db.refresh(chapter)
    lesson_count, question_count = _chapter_counts(db, chapter.id)
    return _chapter_summary(chapter, lesson_count, question_count)


# --- ConceptLesson -------------------------------------------------------


@router.patch("/concept-lessons/{concept_lesson_id}/status", dependencies=[Depends(require_roles("SUPER_ADMIN"))])
def update_concept_lesson_status(concept_lesson_id: str, payload: StatusChangeRequest, db: Session = Depends(get_db)):
    lesson = db.get(ConceptLesson, concept_lesson_id)
    if not lesson:
        api_error(404, "NOT_FOUND", "Concept lesson not found.")

    requested_status = payload.status.strip().upper()
    _apply_transition(lesson.status, requested_status, _CONCEPT_LESSON_TRANSITIONS, "Concept lesson")

    lesson.status = requested_status
    db.commit()
    db.refresh(lesson)
    return {"id": lesson.id, "code": lesson.code, "status": lesson.status}


# --- Question ------------------------------------------------------------


@router.patch("/questions/{question_id}/status", dependencies=[Depends(require_roles("SUPER_ADMIN"))])
def update_question_status(question_id: str, payload: StatusChangeRequest, db: Session = Depends(get_db)):
    question = db.get(Question, question_id)
    if not question:
        api_error(404, "NOT_FOUND", "Question not found.")

    requested_status = payload.status.strip().upper()
    _apply_transition(question.status, requested_status, _QUESTION_TRANSITIONS, "Question")

    question.status = requested_status
    db.commit()
    db.refresh(question)
    return {"id": question.id, "code": question.code, "status": question.status}


# --- SchoolCurriculumMap ---------------------------------------------------


@router.post("/school-curriculum-maps")
def create_school_curriculum_map(
    payload: SchoolCurriculumMapRequest,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    school_id = _resolve_school_id(db, user, payload.schoolId)

    chapter = db.get(Chapter, payload.chapterId)
    if not chapter:
        api_error(404, "NOT_FOUND", "Chapter not found.")
    if chapter.status != "PUBLISHED":
        api_error(409, "CHAPTER_NOT_PUBLISHED", "Only a published chapter can be mapped into a school's calendar.")

    board_course = db.get(BoardCourse, payload.boardCourseId)
    if not board_course:
        api_error(404, "NOT_FOUND", "Board course not found.")

    existing = (
        db.query(SchoolCurriculumMap)
        .filter(
            SchoolCurriculumMap.school_id == school_id,
            SchoolCurriculumMap.chapter_id == chapter.id,
            SchoolCurriculumMap.class_name == payload.className,
            SchoolCurriculumMap.section == payload.section,
        )
        .first()
    )
    if existing:
        api_error(409, "ALREADY_MAPPED", "This chapter is already mapped for this class/section at this school.")

    mapping = SchoolCurriculumMap(
        school_id=school_id,
        board_course_id=board_course.id,
        chapter_id=chapter.id,
        class_name=payload.className,
        section=payload.section,
        teacher_id=payload.teacherId,
        planned_start_date=payload.plannedStartDate,
        planned_end_date=payload.plannedEndDate,
        textbook_reference=payload.textbookReference,
        sequence=payload.sequence,
    )
    db.add(mapping)
    db.commit()
    db.refresh(mapping)
    return _map_summary(mapping)


@router.get("/school-curriculum-maps")
def list_school_curriculum_maps(
    schoolId: str | None = None,
    className: str | None = None,
    section: str | None = None,
    boardCourseId: str | None = None,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    school_id = _resolve_school_id(db, user, schoolId)
    query = db.query(SchoolCurriculumMap).filter(SchoolCurriculumMap.school_id == school_id)
    if className:
        query = query.filter(SchoolCurriculumMap.class_name == className)
    if section:
        query = query.filter(SchoolCurriculumMap.section == section)
    if boardCourseId:
        query = query.filter(SchoolCurriculumMap.board_course_id == boardCourseId)
    mappings = query.order_by(SchoolCurriculumMap.sequence).all()
    return {"schoolCurriculumMaps": [_map_summary(m) for m in mappings]}


@router.delete("/school-curriculum-maps/{map_id}")
def delete_school_curriculum_map(
    map_id: str,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    mapping = db.get(SchoolCurriculumMap, map_id)
    if not mapping:
        api_error(404, "NOT_FOUND", "Mapping not found.")
    # Raises 403 if this isn't (or isn't within) the caller's own school --
    # see _resolve_school_id's docstring.
    _resolve_school_id(db, user, mapping.school_id)
    db.delete(mapping)
    db.commit()
    return {"deleted": True}
