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
    gets to change what "published" means platform-wide. Reading chapters
    (list/detail) is open to both roles, but a school's ADMIN only ever sees
    PUBLISHED chapters -- draft/in-review content isn't reviewed yet, and
    all a school coordinator needs this list for is picking something to
    map (see list_chapters()/get_chapter() below).
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
import json
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.core.errors import api_error
from app.database import get_db
from app.dependencies import require_roles
from app.models import Board, BoardCourse, Chapter, ClassLevel, ConceptLesson, CurriculumVersion, Question, School, SchoolAdmin, SchoolCurriculumMap, User
from app.services.audit_service import log_audit_event
from app.services.question_quality_service import run_quality_checks

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

_CURRICULUM_VERSION_TRANSITIONS: dict[str, set[str]] = {
    "DRAFT": {"REVIEW"},
    "REVIEW": {"PUBLISHED", "DRAFT"},
    "PUBLISHED": {"ARCHIVED"},
    "ARCHIVED": {"DRAFT"},
}


class StatusChangeRequest(BaseModel):
    status: str


class CurriculumVersionRequest(BaseModel):
    boardId: str
    code: str
    label: str
    status: str = "DRAFT"
    effectiveFrom: str | None = None
    effectiveTo: str | None = None


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
        "boardCourseId": chapter.board_course_id,
        "curriculumVersionId": chapter.curriculum_version_id,
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


@router.get("/chapters")
def list_chapters(
    status: str | None = None,
    discipline_id: str | None = None,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    """SUPER_ADMIN sees every chapter at any status -- content governance
    happens here. A school's own ADMIN only ever sees chapters that are
    BOTH individually PUBLISHED AND belong to a PUBLISHED curriculum
    version/edition (any status filter they pass is overridden) -- a
    chapter can be status=PUBLISHED while its whole syllabus edition is
    still in DRAFT/REVIEW (e.g. next year's edition being prepared ahead of
    time), and a school coordinator must not see or map into that edition
    before the platform owner actually rolls it out. draft/in-review
    content isn't reviewed/approved yet and a school coordinator's only
    real use for this list is picking a chapter to map into their
    calendar -- see SchoolCurriculumMap below, which enforces the same
    rule server-side."""
    query = db.query(Chapter)
    if user.role == "ADMIN":
        query = (
            query.join(CurriculumVersion, Chapter.curriculum_version_id == CurriculumVersion.id)
            .filter(Chapter.status == "PUBLISHED", CurriculumVersion.status == "PUBLISHED")
        )
    elif status:
        query = query.filter(Chapter.status == status.strip().upper())
    if discipline_id:
        query = query.filter(Chapter.discipline_id == discipline_id)
    chapters = query.order_by(Chapter.chapter_no).all()

    payload = []
    for chapter in chapters:
        lesson_count, question_count = _chapter_counts(db, chapter.id)
        payload.append(_chapter_summary(chapter, lesson_count, question_count))
    return {"chapters": payload}


@router.get("/chapters/{chapter_id}")
def get_chapter(
    chapter_id: str,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    chapter = db.get(Chapter, chapter_id)
    if not chapter:
        api_error(404, "NOT_FOUND", "Chapter not found.")
    # Same PUBLISHED-chapter-AND-PUBLISHED-edition boundary as list_chapters
    # above -- 404 rather than 403 so an ADMIN probing chapter ids can't
    # even confirm an unpublished one (or one from an unreleased syllabus
    # edition) exists.
    if user.role == "ADMIN" and (
        chapter.status != "PUBLISHED" or chapter.curriculum_version.status != "PUBLISHED"
    ):
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


@router.patch("/chapters/{chapter_id}/status")
def update_chapter_status(
    chapter_id: str,
    payload: StatusChangeRequest,
    request: Request,
    user: User = Depends(require_roles("SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
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

    previous_status = chapter.status
    chapter.status = requested_status
    log_audit_event(
        db,
        "curriculum.chapter.status_changed",
        user_id=user.id,
        request=request,
        details={"chapterId": chapter.id, "chapterCode": chapter.code, "from": previous_status, "to": requested_status},
    )
    db.commit()
    db.refresh(chapter)
    lesson_count, question_count = _chapter_counts(db, chapter.id)
    return _chapter_summary(chapter, lesson_count, question_count)


class BulkChapterStatusRequest(BaseModel):
    chapterIds: list[str] | None = None  # None = every chapter currently eligible for the transition
    status: str = "REVIEW"


@router.post("/chapters/bulk-status")
def bulk_update_chapter_status(
    payload: BulkChapterStatusRequest,
    request: Request,
    user: User = Depends(require_roles("SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    """Bulk "Send All to Review" (Shailesh, 18 Aug 2026: moving 15 chapters
    into review one click at a time is needless friction). Deliberately
    only wired up for DRAFT -> REVIEW in practice -- REVIEW isn't visible to
    any school (only PUBLISHED is), so batching this move exposes nothing
    unreviewed to a student; it only changes which queue a chapter sits in.
    Publishing itself stays one-at-a-time via the existing single-chapter
    endpoint, since that's the step with a real readiness gate. Skips (does
    not error on) any chapter that isn't a valid DRAFT->REVIEW candidate, so
    one already-published chapter in the list doesn't block the rest."""
    requested_status = payload.status.strip().upper()
    query = db.query(Chapter)
    if payload.chapterIds:
        query = query.filter(Chapter.id.in_(payload.chapterIds))
    chapters = query.all()

    updated: list[str] = []
    skipped: list[str] = []
    for chapter in chapters:
        allowed = _CHAPTER_TRANSITIONS.get(chapter.status, set())
        if requested_status in allowed:
            chapter.status = requested_status
            updated.append(chapter.code)
        else:
            skipped.append(chapter.code)
    log_audit_event(
        db,
        "curriculum.chapter.bulk_status_changed",
        user_id=user.id,
        request=request,
        details={"to": requested_status, "updatedChapters": updated, "skippedChapters": skipped},
    )
    db.commit()
    return {"updatedChapters": updated, "skippedChapters": skipped}


# --- ConceptLesson -------------------------------------------------------


@router.patch("/concept-lessons/{concept_lesson_id}/status")
def update_concept_lesson_status(
    concept_lesson_id: str,
    payload: StatusChangeRequest,
    request: Request,
    user: User = Depends(require_roles("SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    lesson = db.get(ConceptLesson, concept_lesson_id)
    if not lesson:
        api_error(404, "NOT_FOUND", "Concept lesson not found.")

    requested_status = payload.status.strip().upper()
    _apply_transition(lesson.status, requested_status, _CONCEPT_LESSON_TRANSITIONS, "Concept lesson")

    previous_status = lesson.status
    lesson.status = requested_status
    log_audit_event(
        db,
        "curriculum.concept_lesson.status_changed",
        user_id=user.id,
        request=request,
        details={"conceptLessonId": lesson.id, "code": lesson.code, "from": previous_status, "to": requested_status},
    )
    db.commit()
    db.refresh(lesson)
    return {"id": lesson.id, "code": lesson.code, "status": lesson.status}


# --- Question ------------------------------------------------------------


def _question_detail(question: Question) -> dict:
    return {
        "id": question.id,
        "code": question.code,
        "conceptLessonId": question.concept_lesson_id,
        "questionType": question.question_type,
        "difficulty": question.difficulty,
        "competency": question.competency,
        "stem": question.stem,
        "optionA": question.option_a,
        "optionB": question.option_b,
        "optionC": question.option_c,
        "optionD": question.option_d,
        "correctAnswer": question.correct_answer,
        "acceptedVariants": question.accepted_variants,
        "hint": question.hint,
        "explanation": question.explanation,
        "misconceptionTag": question.misconception_tag,
        "marks": question.marks,
        "timeSeconds": question.time_seconds,
        "autoGradable": question.auto_gradable,
        "shuffleOptions": question.shuffle_options,
        "responseFormat": question.response_format,
        "mediaRequired": question.media_required,
        "teacherNote": question.teacher_note,
        "status": question.status,
        "qualityStatus": question.quality_status,
        "qualityFlags": json.loads(question.quality_flags) if question.quality_flags else [],
    }


def _persist_quality_results(db: Session, questions: list[Question]) -> None:
    """Runs the free structural + math-pattern checks (question_quality_service.py)
    over `questions` as one batch (duplicate detection needs sibling
    context) and writes the result onto each row. Caller commits."""
    results = run_quality_checks(questions)
    now = datetime.now(timezone.utc)
    for question in questions:
        result = results[question.id]
        question.quality_status = result.status
        question.quality_flags = json.dumps(result.flags) if result.flags else None
        question.quality_checked_at = now


def _questions_for_lesson(db: Session, concept_lesson_id: str) -> list[Question]:
    return (
        db.query(Question)
        .filter(Question.concept_lesson_id == concept_lesson_id)
        .order_by(Question.code)
        .all()
    )


@router.get("/concept-lessons/{concept_lesson_id}/questions", dependencies=[Depends(require_roles("SUPER_ADMIN"))])
def list_concept_lesson_questions(concept_lesson_id: str, db: Session = Depends(get_db)):
    """The actual content-review surface: full question text, every option,
    the correct answer, and the explanation -- everything a SUPER_ADMIN needs
    to eyeball before moving a question (and therefore, eventually, the
    chapter) toward PUBLISHED. Before this endpoint existed, the studio UI
    only ever showed counts and status badges, so "review" meant clicking
    Approve without ever seeing what was being approved. SUPER_ADMIN only,
    matching every other endpoint in this file that touches unreviewed
    master content.

    Also lazily runs the free quality checks (question_quality_service.py)
    on any question that's never been checked (quality_status UNCHECKED),
    so a reviewer always sees fresh flags without a separate manual step --
    see the recheck endpoint below for forcing a full re-run after a
    verifier improves."""
    lesson = db.get(ConceptLesson, concept_lesson_id)
    if not lesson:
        api_error(404, "NOT_FOUND", "Concept lesson not found.")

    questions = _questions_for_lesson(db, concept_lesson_id)
    unchecked = [q for q in questions if q.quality_status == "UNCHECKED"]
    if unchecked:
        _persist_quality_results(db, unchecked)
        db.commit()
    return {"questions": [_question_detail(q) for q in questions]}


@router.post("/concept-lessons/{concept_lesson_id}/questions/recheck-quality", dependencies=[Depends(require_roles("SUPER_ADMIN"))])
def recheck_lesson_question_quality(concept_lesson_id: str, db: Session = Depends(get_db)):
    """Forces a full re-run of the quality checks for every question in this
    lesson, not just UNCHECKED ones -- for after a verifier is fixed/added
    (see question_quality_service.py's changelog-style docstring) or the
    content itself was corrected and re-imported."""
    lesson = db.get(ConceptLesson, concept_lesson_id)
    if not lesson:
        api_error(404, "NOT_FOUND", "Concept lesson not found.")

    questions = _questions_for_lesson(db, concept_lesson_id)
    _persist_quality_results(db, questions)
    db.commit()
    return {"questions": [_question_detail(q) for q in questions]}


@router.patch("/questions/{question_id}/status")
def update_question_status(
    question_id: str,
    payload: StatusChangeRequest,
    request: Request,
    user: User = Depends(require_roles("SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    question = db.get(Question, question_id)
    if not question:
        api_error(404, "NOT_FOUND", "Question not found.")

    requested_status = payload.status.strip().upper()
    _apply_transition(question.status, requested_status, _QUESTION_TRANSITIONS, "Question")

    previous_status = question.status
    question.status = requested_status
    log_audit_event(
        db,
        "curriculum.question.status_changed",
        user_id=user.id,
        request=request,
        details={"questionId": question.id, "code": question.code, "from": previous_status, "to": requested_status},
    )
    db.commit()
    db.refresh(question)
    return {"id": question.id, "code": question.code, "status": question.status}


class BulkApproveRequest(BaseModel):
    includeUnverified: bool = False


def _bulk_approve_questions(
    db: Session,
    questions: list[Question],
    include_unverified: bool,
    *,
    user: User,
    request: Request,
    scope: dict,
) -> dict:
    """Advances every question whose quality check allows it straight from
    its current status to APPROVED (DRAFT and SME_REVIEW both walk the
    normal _QUESTION_TRANSITIONS chain, just without a human clicking each
    step) -- the quality gate substitutes for the per-question ceremony,
    it doesn't skip it. A FLAGGED question is NEVER touched by this
    regardless of includeUnverified; that flag exists specifically to force
    a human look. Returns transparent counts rather than a single number --
    Shailesh was explicit that nothing should be silently glossed over."""
    unchecked = [q for q in questions if q.quality_status == "UNCHECKED"]
    if unchecked:
        _persist_quality_results(db, unchecked)

    allowed_statuses = {"VERIFIED"} | ({"UNVERIFIED"} if include_unverified else set())

    approved = 0
    skipped_flagged = 0
    skipped_unverified = 0
    skipped_already_done = 0
    for question in questions:
        if question.status in ("APPROVED", "PUBLISHED"):
            skipped_already_done += 1
            continue
        if question.quality_status == "FLAGGED":
            skipped_flagged += 1
            continue
        if question.quality_status not in allowed_statuses:
            skipped_unverified += 1
            continue
        if question.status == "DRAFT":
            question.status = "SME_REVIEW"
        if question.status == "SME_REVIEW":
            question.status = "APPROVED"
            approved += 1
    log_audit_event(
        db,
        "curriculum.question.bulk_approved",
        user_id=user.id,
        request=request,
        details={
            **scope,
            "approvedCount": approved,
            "skippedFlaggedCount": skipped_flagged,
            "skippedUnverifiedCount": skipped_unverified,
            "skippedAlreadyDoneCount": skipped_already_done,
        },
    )
    db.commit()
    return {
        "approvedCount": approved,
        "skippedFlaggedCount": skipped_flagged,
        "skippedUnverifiedCount": skipped_unverified,
        "skippedAlreadyDoneCount": skipped_already_done,
    }


@router.post("/concept-lessons/{concept_lesson_id}/questions/bulk-approve")
def bulk_approve_lesson_questions(
    concept_lesson_id: str,
    payload: BulkApproveRequest,
    request: Request,
    user: User = Depends(require_roles("SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    lesson = db.get(ConceptLesson, concept_lesson_id)
    if not lesson:
        api_error(404, "NOT_FOUND", "Concept lesson not found.")
    questions = _questions_for_lesson(db, concept_lesson_id)
    return _bulk_approve_questions(
        db, questions, payload.includeUnverified,
        user=user, request=request,
        scope={"conceptLessonId": lesson.id, "conceptLessonCode": lesson.code},
    )


@router.post("/chapters/{chapter_id}/questions/bulk-approve")
def bulk_approve_chapter_questions(
    chapter_id: str,
    payload: BulkApproveRequest,
    request: Request,
    user: User = Depends(require_roles("SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    """Same as the per-lesson version, but across every lesson in the
    chapter in one call -- the real answer to "hundreds of questions per
    chapter, reviewing one at a time isn't feasible" (Shailesh, 18 Aug
    2026): the quality gate does the triage, this does the bulk motion."""
    chapter = db.get(Chapter, chapter_id)
    if not chapter:
        api_error(404, "NOT_FOUND", "Chapter not found.")
    questions = (
        db.query(Question)
        .join(ConceptLesson, Question.concept_lesson_id == ConceptLesson.id)
        .filter(ConceptLesson.chapter_id == chapter_id)
        .order_by(Question.code)
        .all()
    )
    return _bulk_approve_questions(
        db, questions, payload.includeUnverified,
        user=user, request=request,
        scope={"chapterId": chapter.id, "chapterCode": chapter.code},
    )


# --- CurriculumVersion (year/edition -- SUPER_ADMIN manages these) --------
# The versatility requirement (Shailesh, 18 Aug 2026: "different boards
# change their syllabus from year to year ... flexibility to add and remove
# stuff ... without any sort of issues") lives here: a new syllabus edition
# is a brand-new CurriculumVersion row, imported alongside the old one
# (Chapter's real identity includes curriculum_version_id -- see the Chapter
# model docstring and 7b3d4c9a1f06's migration), never an in-place edit of
# existing chapters. Nothing forces the old edition to be archived the
# moment a new one is created -- a school can keep teaching last year's
# edition until its own ADMIN/SUPER_ADMIN is ready to remap it forward.


def _curriculum_version_summary(version: CurriculumVersion) -> dict:
    return {
        "id": version.id,
        "boardId": version.board_id,
        "code": version.code,
        "label": version.label,
        "status": version.status,
        "effectiveFrom": version.effective_from,
        "effectiveTo": version.effective_to,
        "createdAt": version.created_at.isoformat() if version.created_at else None,
        "updatedAt": version.updated_at.isoformat() if version.updated_at else None,
    }


@router.get("/curriculum-versions", dependencies=[Depends(require_roles("ADMIN", "SUPER_ADMIN"))])
def list_curriculum_versions(board_id: str | None = None, db: Session = Depends(get_db)):
    """Open to both roles (read-only, mirrors board-courses) -- an ADMIN
    picking a chapter to map benefits from seeing which edition it belongs
    to, same as the BoardCourse lookup above. Status filtering by role is
    NOT needed here the way it is for chapters: a version's status alone
    reveals nothing sensitive, and the real gate (an ADMIN can't see or map
    a chapter from a non-PUBLISHED edition) is already enforced where
    chapters are actually listed/mapped, not here."""
    query = db.query(CurriculumVersion)
    if board_id:
        query = query.filter(CurriculumVersion.board_id == board_id)
    versions = query.order_by(CurriculumVersion.code.desc()).all()
    return {"curriculumVersions": [_curriculum_version_summary(v) for v in versions]}


@router.post("/curriculum-versions")
def create_curriculum_version(
    payload: CurriculumVersionRequest,
    request: Request,
    user: User = Depends(require_roles("SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    board = db.get(Board, payload.boardId)
    if not board:
        api_error(404, "NOT_FOUND", "Board not found.")

    code = payload.code.strip()
    existing = (
        db.query(CurriculumVersion)
        .filter(CurriculumVersion.board_id == board.id, CurriculumVersion.code == code)
        .first()
    )
    if existing:
        api_error(409, "ALREADY_EXISTS", f"A curriculum version with code {code!r} already exists for this board.")

    version = CurriculumVersion(
        board_id=board.id,
        code=code,
        label=payload.label.strip(),
        status=payload.status.strip().upper() if payload.status else "DRAFT",
        effective_from=payload.effectiveFrom,
        effective_to=payload.effectiveTo,
    )
    db.add(version)
    log_audit_event(
        db,
        "curriculum.version.created",
        user_id=user.id,
        request=request,
        details={"boardId": board.id, "code": version.code, "label": version.label, "status": version.status},
    )
    db.commit()
    db.refresh(version)
    return _curriculum_version_summary(version)


@router.patch("/curriculum-versions/{version_id}/status")
def update_curriculum_version_status(
    version_id: str,
    payload: StatusChangeRequest,
    request: Request,
    user: User = Depends(require_roles("SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    version = db.get(CurriculumVersion, version_id)
    if not version:
        api_error(404, "NOT_FOUND", "Curriculum version not found.")

    requested_status = payload.status.strip().upper()
    _apply_transition(version.status, requested_status, _CURRICULUM_VERSION_TRANSITIONS, "Curriculum version")
    previous_status = version.status
    version.status = requested_status
    log_audit_event(
        db,
        "curriculum.version.status_changed",
        user_id=user.id,
        request=request,
        details={"versionId": version.id, "code": version.code, "from": previous_status, "to": requested_status},
    )
    db.commit()
    db.refresh(version)
    return _curriculum_version_summary(version)


# --- BoardCourse (read-only lookup, for the mapping form) -----------------


@router.get("/board-courses")
def list_board_courses(
    _user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    """Just enough to populate a "which course am I mapping into" dropdown --
    no status filtering here, unlike chapters. A board course is a container
    label ("CBSE Class 5 Mathematics"), not itself student-facing content,
    so there's nothing for a school ADMIN to be shielded from."""
    rows = (
        db.query(BoardCourse, Board, ClassLevel)
        .join(Board, BoardCourse.board_id == Board.id)
        .join(ClassLevel, BoardCourse.class_level_id == ClassLevel.id)
        .order_by(ClassLevel.display_order, BoardCourse.display_name)
        .all()
    )
    return {
        "boardCourses": [
            {
                "id": board_course.id,
                "code": board_course.code,
                "displayName": board_course.display_name,
                "boardCode": board.code,
                "classLevelCode": class_level.code,
                "classLevelDisplayName": class_level.display_name,
            }
            for board_course, board, class_level in rows
        ]
    }


# --- School (read-only lookup, SUPER_ADMIN only, for the school picker) ---


@router.get("/schools", dependencies=[Depends(require_roles("SUPER_ADMIN"))])
def list_schools(db: Session = Depends(get_db)):
    """Lets a SUPER_ADMIN pick which school to map a chapter into, from one
    session, without needing a second ADMIN login for that school. Deliberately
    SUPER_ADMIN-only -- a school's own ADMIN must still never be able to see
    another school exists at all, let alone browse it (blueprint Section 6.4:
    "a school coordinator cannot ... view another school")."""
    schools = db.query(School).filter(School.is_active.is_(True)).order_by(School.name).all()
    return {
        "schools": [
            {"id": school.id, "name": school.name, "board": school.board, "city": school.city}
            for school in schools
        ]
    }


# --- SchoolCurriculumMap ---------------------------------------------------


@router.post("/school-curriculum-maps")
def create_school_curriculum_map(
    payload: SchoolCurriculumMapRequest,
    request: Request,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    school_id = _resolve_school_id(db, user, payload.schoolId)

    chapter = db.get(Chapter, payload.chapterId)
    if not chapter:
        api_error(404, "NOT_FOUND", "Chapter not found.")
    if chapter.status != "PUBLISHED":
        api_error(409, "CHAPTER_NOT_PUBLISHED", "Only a published chapter can be mapped into a school's calendar.")
    # Same edition-rollout boundary as list_chapters/get_chapter -- a school
    # ADMIN cannot map into a chapter whose whole syllabus edition hasn't
    # been rolled out yet, even if they somehow already had its id. A
    # SUPER_ADMIN can, deliberately, in case pre-provisioning a school ahead
    # of an edition's public rollout is ever a real need.
    if user.role == "ADMIN" and chapter.curriculum_version.status != "PUBLISHED":
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
    log_audit_event(
        db,
        "curriculum.school_map.created",
        user_id=user.id,
        request=request,
        details={"schoolId": school_id, "chapterId": chapter.id, "className": mapping.class_name, "section": mapping.section},
    )
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
    request: Request,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    mapping = db.get(SchoolCurriculumMap, map_id)
    if not mapping:
        api_error(404, "NOT_FOUND", "Mapping not found.")
    # Raises 403 if this isn't (or isn't within) the caller's own school --
    # see _resolve_school_id's docstring.
    _resolve_school_id(db, user, mapping.school_id)
    log_audit_event(
        db,
        "curriculum.school_map.deleted",
        user_id=user.id,
        request=request,
        details={"mapId": mapping.id, "schoolId": mapping.school_id, "chapterId": mapping.chapter_id},
    )
    db.delete(mapping)
    db.commit()
    return {"deleted": True}
