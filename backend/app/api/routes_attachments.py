"""PDFs on answers (#237, 17 Nov 2026): app/services/attachment_service.py.

  * PUT    /api/learning/attempts/{attempt_id}/answers/{question_id}/attachment   a student attaches (practice)
  * DELETE the same                                                      removes it before submitting
  * PUT    /api/my-papers/{paper_id}/answers/{question_id}/attachment    a student attaches (mock paper)
  * DELETE the same
  * GET    /api/attachments/{attachment_id}   the PDF: the child, their teacher, their school's admin

The Super Admin and other schools get a 404, as elsewhere.
"""
import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.core.rate_limit import limiter
from app.database import get_db
from app.dependencies import get_current_student, get_current_user, require_roles
from app.models import AnswerAttachment, Student, User
from app.models.learning import Attempt, AttemptAnswer
from app.models.papers import MockPaperAnswer, MockPaperSitting
from app.services import attachment_service as service
from app.services import mock_paper_service, practice_access_service
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/api", tags=["attachments"])

_NOT_FOUND = "We couldn't find that file."


def _read_upload(file: UploadFile) -> bytes:
    return file.file.read(service.MAX_BYTES + 1)


@router.put("/learning/attempts/{attempt_id}/answers/{question_id}/attachment")
@limiter.limit("60/hour")
def attach_practice(
    request: Request,
    attempt_id: str,
    question_id: str,
    file: UploadFile = File(...),
    student: Student = Depends(get_current_student),
    user: User = Depends(require_roles("STUDENT")),
    db: Session = Depends(get_db),
):
    record = service.attach_to_attempt(db, student, user, attempt_id, question_id, file.filename, _read_upload(file))
    log_audit_event(db, "attachment.uploaded", user_id=user.id, request=request,
                    details={"attachmentId": record.id, "where": "practice", "bytes": record.size_bytes, "pages": record.page_count})
    db.commit()
    return {"attachment": service.info(record)}


@router.delete("/learning/attempts/{attempt_id}/answers/{question_id}/attachment")
@limiter.limit("60/hour")
def remove_practice(
    request: Request,
    attempt_id: str,
    question_id: str,
    student: Student = Depends(get_current_student),
    user: User = Depends(require_roles("STUDENT")),
    db: Session = Depends(get_db),
):
    service.remove_from_attempt(db, student, attempt_id, question_id)
    log_audit_event(db, "attachment.removed", user_id=user.id, request=request,
                    details={"where": "practice", "attemptId": attempt_id, "questionId": question_id})
    db.commit()
    return {"attachment": None}


student_papers_router = APIRouter(prefix="/api/my-papers", tags=["attachments"])


@student_papers_router.put("/{paper_id}/answers/{question_id}/attachment")
@limiter.limit("60/hour")
def attach_paper(
    request: Request,
    paper_id: str,
    question_id: str,
    file: UploadFile = File(...),
    student: Student = Depends(get_current_student),
    user: User = Depends(require_roles("STUDENT")),
    db: Session = Depends(get_db),
):
    record = service.attach_to_mock(db, student, user, paper_id, question_id, file.filename, _read_upload(file))
    log_audit_event(db, "attachment.uploaded", user_id=user.id, request=request,
                    details={"attachmentId": record.id, "where": "mock_paper", "bytes": record.size_bytes, "pages": record.page_count})
    db.commit()
    return {"attachment": service.info(record)}


@student_papers_router.delete("/{paper_id}/answers/{question_id}/attachment")
@limiter.limit("60/hour")
def remove_paper(
    request: Request,
    paper_id: str,
    question_id: str,
    student: Student = Depends(get_current_student),
    user: User = Depends(require_roles("STUDENT")),
    db: Session = Depends(get_db),
):
    service.remove_from_mock(db, student, paper_id, question_id)
    log_audit_event(db, "attachment.removed", user_id=user.id, request=request,
                    details={"where": "mock_paper", "paperId": paper_id, "questionId": question_id})
    db.commit()
    return {"attachment": None}


def _may_read(db: Session, user: User, attachment: AnswerAttachment) -> None:
    """404 unless this person may open the file: the child who attached it,
    that child's teacher (the same scope as the answer itself) or their
    school's admin. Never the Super Admin."""
    if user.role == "STUDENT":
        student = db.query(Student).filter(Student.user_id == user.id).first()
        if student is None or student.id != attachment.student_id:
            api_error(404, "NOT_FOUND", _NOT_FOUND)
        return
    if user.role not in ("TEACHER", "ADMIN"):
        api_error(404, "NOT_FOUND", _NOT_FOUND)
    viewer = practice_access_service.resolve_viewer(db, user)
    if attachment.attempt_answer_id:
        answer = db.get(AttemptAnswer, attachment.attempt_answer_id)
        attempt = db.get(Attempt, answer.attempt_id) if answer else None
        if attempt is None:
            api_error(404, "NOT_FOUND", _NOT_FOUND)
        practice_access_service.require_readable_assignment(db, viewer, attempt.assignment_target.assignment)
        return
    answer = db.get(MockPaperAnswer, attachment.mock_answer_id)
    sitting = db.get(MockPaperSitting, answer.sitting_id) if answer else None
    if sitting is None:
        api_error(404, "NOT_FOUND", _NOT_FOUND)
    mock_paper_service.load_paper(db, viewer, sitting.paper_id)


@router.get("/attachments/{attachment_id}")
def download(
    request: Request,
    attachment_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Any signed-in role reaches _may_read, which answers 404 to everyone not
    # entitled (including the Super Admin), so a file's existence is not revealed.
    attachment = db.get(AnswerAttachment, attachment_id)
    if attachment is None:
        api_error(404, "NOT_FOUND", _NOT_FOUND)
    _may_read(db, user, attachment)
    data = service.read_bytes(db, attachment)
    if data is None:
        api_error(404, "NOT_FOUND", _NOT_FOUND)
    if user.role != "STUDENT":
        log_audit_event(db, "attachment.opened", user_id=user.id, request=request, details={"attachmentId": attachment.id})
        db.commit()
    name = re.sub(r'["\r\n]', "", attachment.filename)
    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"inline; filename=\"{name.encode('ascii', 'ignore').decode() or 'working.pdf'}\"; filename*=UTF-8''{quote(name)}",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
        },
    )
