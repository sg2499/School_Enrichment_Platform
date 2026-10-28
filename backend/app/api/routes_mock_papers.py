"""Mock papers (#166 step 3, 27 Oct 2026): the test builder, test formats,
and a paper's preview, approval and withdrawal. A section's teacher builds
and approves; the school's admin looks. mock_paper_service has the rules."""
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.core.rate_limit import limiter
from app.database import get_db
from app.dependencies import require_roles
from app.models import User
from app.services import analytics_service, paper_formats, practice_access_service
from app.services import mock_paper_service as service
from app.services import mock_sitting_service as sitting_service
from app.services.audit_service import log_audit_event
from app.services.paper_formats import FormatError
from app.services.practice_access_service import Viewer

router = APIRouter(prefix="/api/mock-papers", tags=["mock-papers"])


def _viewer(
    user: User = Depends(require_roles("TEACHER", "ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
) -> Viewer:
    return practice_access_service.resolve_viewer(db, user)


class SupplyBody(BaseModel):
    scope: str = Field(max_length=200)
    format: dict[str, Any]
    chapterIds: list[str] = Field(default_factory=list, max_length=40)


class CreateBody(SupplyBody):
    title: str = Field(max_length=200)
    formatId: str | None = Field(default=None, max_length=60)
    format: dict[str, Any] | None = None
    opensAt: datetime
    closesAt: datetime


class PatchBody(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    opensAt: datetime | None = None
    closesAt: datetime | None = None


class RegenerateBody(BaseModel):
    mode: Literal["numbers", "question"]


class WithdrawBody(BaseModel):
    reason: str = Field(max_length=400)


class FormatBody(BaseModel):
    format: dict[str, Any]


@router.get("/sections")
def list_sections(viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    return {"sections": service.section_options(db, viewer)}


@router.get("/formats")
def list_formats(viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    return {
        "formats": service.formats(db, viewer),
        "kinds": [{"value": k, "label": paper_formats.KIND_LABEL[k]} for k in paper_formats.KINDS],
    }


@router.post("/formats")
@limiter.limit("30/minute")
def create_format(request: Request, body: FormatBody, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    row = service.save_format(db, viewer, body.format)
    log_audit_event(db, "mock_paper.format.saved", user_id=viewer.user.id, request=request, details={"formatId": row.id, "name": row.name})
    db.commit()
    return {"id": row.id}


@router.put("/formats/{format_id}")
@limiter.limit("30/minute")
def update_format(request: Request, format_id: str, body: FormatBody, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    row = service.save_format(db, viewer, body.format, format_id)
    log_audit_event(db, "mock_paper.format.saved", user_id=viewer.user.id, request=request, details={"formatId": row.id, "name": row.name})
    db.commit()
    return {"id": row.id}


@router.delete("/formats/{format_id}")
@limiter.limit("30/minute")
def delete_format(request: Request, format_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    service.delete_format(db, viewer, format_id)
    log_audit_event(db, "mock_paper.format.deleted", user_id=viewer.user.id, request=request, details={"formatId": format_id})
    db.commit()
    return {"ok": True}


@router.get("/chapters")
def list_chapters(scope: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    parsed = analytics_service.parse_scope(scope)
    service._scope_entry(db, viewer, parsed)
    return {"chapters": service.chapters_for(db, parsed.board_course_id)}


@router.post("/supply")
@limiter.limit("120/minute")
def check_supply(request: Request, body: SupplyBody, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    """As the teacher builds: is there enough for each section? Also checks the format."""
    parsed = analytics_service.parse_scope(body.scope)
    service._scope_entry(db, viewer, parsed)
    try:
        fmt = paper_formats.clean_format(body.format)
    except FormatError as exc:
        return {"problems": exc.problems, "sections": [], "totalMarks": None}
    patterns = service.approved_patterns(db, parsed.board_course_id, body.chapterIds)
    return {"problems": [], "sections": service.supply(patterns, fmt, body.chapterIds), "totalMarks": fmt["totalMarks"]}


@router.get("")
def list_papers(viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    return {"papers": service.list_papers(db, viewer)}


@router.post("")
@limiter.limit("20/minute")
def create_paper(request: Request, body: CreateBody, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    if body.format is None and not body.formatId:
        api_error(422, "VALIDATION_ERROR", "Choose a test format.")
    paper = service.create_draft(
        db, viewer, analytics_service.parse_scope(body.scope), title=body.title, raw_format=body.format,
        format_id=body.formatId, chapter_ids=body.chapterIds, opens_at=body.opensAt, closes_at=body.closesAt,
    )
    log_audit_event(db, "mock_paper.drafted", user_id=viewer.user.id, request=request, details={"paperId": paper.id})
    db.commit()
    return {"id": paper.id}


@router.get("/{paper_id}")
def paper_detail(paper_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    return service.detail(db, viewer, paper_id)


@router.patch("/{paper_id}")
@limiter.limit("60/minute")
def update_paper(request: Request, paper_id: str, body: PatchBody, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    service.update_draft(db, viewer, paper_id, title=body.title, opens_at=body.opensAt, closes_at=body.closesAt)
    db.commit()
    return service.detail(db, viewer, paper_id)


@router.post("/{paper_id}/slots/{slot_id}/regenerate")
@limiter.limit("120/minute")
def regenerate_slot(
    request: Request, paper_id: str, slot_id: str, body: RegenerateBody,
    viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db),
):
    service.regenerate(db, viewer, paper_id, slot_id, body.mode)
    db.commit()
    return service.detail(db, viewer, paper_id)


@router.post("/{paper_id}/approve")
@limiter.limit("10/minute")
def approve_paper(request: Request, paper_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    result = service.approve(db, viewer, paper_id)
    log_audit_event(db, "mock_paper.approved", user_id=viewer.user.id, request=request,
                    details={"paperId": paper_id, "versions": result["versions"]})
    db.commit()
    return service.detail(db, viewer, paper_id)


@router.post("/{paper_id}/withdraw")
@limiter.limit("10/minute")
def withdraw_paper(request: Request, paper_id: str, body: WithdrawBody, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    paper = service.withdraw(db, viewer, paper_id, body.reason)
    log_audit_event(db, "mock_paper.withdrawn", user_id=viewer.user.id, request=request,
                    details={"paperId": paper_id, "reason": paper.withdraw_reason})
    db.commit()
    return service.detail(db, viewer, paper_id)


@router.delete("/{paper_id}")
@limiter.limit("20/minute")
def discard_paper(request: Request, paper_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    service.discard(db, viewer, paper_id)
    log_audit_event(db, "mock_paper.discarded", user_id=viewer.user.id, request=request, details={"paperId": paper_id})
    db.commit()
    return {"ok": True}


# --- step 4: marking and results (teacher and admin) ------------------------------------------


class MarkBody(BaseModel):
    answerId: str = Field(max_length=60)
    score: int | None = None


class MarksBody(BaseModel):
    marks: list[MarkBody] = Field(min_length=1, max_length=500)


@router.get("/{paper_id}/marking")
def paper_marking(paper_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    return sitting_service.marking(db, viewer, paper_id)


@router.post("/{paper_id}/marks")
@limiter.limit("120/minute")
def save_marks(request: Request, paper_id: str, body: MarksBody, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    count = sitting_service.save_marks(db, viewer, paper_id, [m.model_dump() for m in body.marks])
    log_audit_event(db, "mock_paper.marked", user_id=viewer.user.id, request=request, details={"paperId": paper_id, "answers": count})
    db.commit()
    return sitting_service.marking(db, viewer, paper_id)


@router.get("/{paper_id}/results")
def paper_results(paper_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    return sitting_service.results(db, viewer, paper_id)


# --- step 4: sitting the paper (student) ------------------------------------------------------

student_router = APIRouter(prefix="/api/my-papers", tags=["mock-papers"])


def _student(user: User = Depends(require_roles("STUDENT")), db: Session = Depends(get_db)):
    return sitting_service.student_of(db, user)


class AnswerBody(BaseModel):
    questionId: str = Field(max_length=60)
    response: str | None = Field(default=None, max_length=4000)
    working: str | None = Field(default=None, max_length=4000)
    workingSent: bool = False


class ChooseBody(BaseModel):
    slotId: str = Field(max_length=60)


@student_router.get("")
def my_papers(student=Depends(_student), db: Session = Depends(get_db)):
    return {"papers": sitting_service.student_papers(db, student)}


@student_router.get("/{paper_id}")
def my_paper(paper_id: str, student=Depends(_student), db: Session = Depends(get_db)):
    return sitting_service.view(db, student, paper_id)


@student_router.post("/{paper_id}/start")
@limiter.limit("20/minute")
def start_paper(request: Request, paper_id: str, student=Depends(_student), db: Session = Depends(get_db)):
    return sitting_service.start(db, student, paper_id)


@student_router.put("/{paper_id}/answers")
@limiter.limit("240/minute")
def save_paper_answer(request: Request, paper_id: str, body: AnswerBody, student=Depends(_student), db: Session = Depends(get_db)):
    return sitting_service.save_answer(db, student, paper_id, body.questionId, body.response, body.working,
                                       working_sent=body.workingSent)


@student_router.post("/{paper_id}/choose")
@limiter.limit("120/minute")
def choose_question(request: Request, paper_id: str, body: ChooseBody, student=Depends(_student), db: Session = Depends(get_db)):
    return sitting_service.choose(db, student, paper_id, body.slotId)


@student_router.post("/{paper_id}/next-section")
@limiter.limit("60/minute")
def next_section(request: Request, paper_id: str, student=Depends(_student), db: Session = Depends(get_db)):
    return sitting_service.next_section(db, student, paper_id)


@student_router.post("/{paper_id}/submit")
@limiter.limit("20/minute")
def submit_paper(request: Request, paper_id: str, student=Depends(_student), db: Session = Depends(get_db)):
    return sitting_service.submit(db, student, paper_id)
