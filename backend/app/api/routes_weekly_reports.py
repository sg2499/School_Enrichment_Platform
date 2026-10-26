"""The weekly parent report's API (Phase 6, #187, 26 Oct 2026).

Design: PHASE6_WEEKLY_REPORT_DESIGN.md. The rules live in
app/services/weekly_report_service.py; this file decides who may do what:

  * School Admin: every section of their school: notes, issue, withdraw,
    every page.
  * Teacher: the sections they teach now (notes, issue, withdraw) and the
    weeks of sections they taught (read and download).
  * Super Admin: refused (a section is only meaningful within one school).
  * Student: their own issued pages (not withdrawn ones).

Anything outside a caller's reach is a 404, as elsewhere.
"""
import re

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.core.rate_limit import limiter
from app.database import get_db
from app.dependencies import get_current_student, require_roles
from app.models import School, Student, User, WeeklyReport, WeeklyReportIssue
from app.services import practice_access_service, report_card_service, weekly_report_pdf
from app.services import weekly_report_service as service
from app.services.audit_service import log_audit_event
from app.services.practice_access_service import Viewer
from app.services.weekly_report_service import WeeklyError

router = APIRouter(prefix="/api/weekly-reports", tags=["weekly-reports"])


def _viewer(
    user: User = Depends(require_roles("TEACHER", "ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
) -> Viewer:
    return practice_access_service.resolve_viewer(db, user)


def _refuse(message: str):
    api_error(422, "VALIDATION_ERROR", message)


def _not_found(what: str):
    api_error(404, "NOT_FOUND", f"We couldn't find that {what}.")


def _user_name(user: User | None) -> str | None:
    return user.full_name if user else None


def _issue_dict(issue: WeeklyReportIssue | None, db: Session) -> dict | None:
    if issue is None:
        return None
    # Counted, not loaded: each page carries its whole printed copy.
    count = db.query(func.count(WeeklyReport.id)).filter(WeeklyReport.issue_id == issue.id).scalar() or 0
    return {
        "id": issue.id,
        "status": issue.status,
        "weekStart": issue.week_start.isoformat(),
        "weekLabel": service.week_label(issue.week_start),
        "classLevelId": issue.class_level_id,
        "classLevel": issue.class_level.display_name if issue.class_level else None,
        "section": issue.section,
        "issuedAt": issue.issued_at.isoformat() if issue.issued_at else None,
        "issuedBy": _user_name(issue.issued_by),
        "withdrawnAt": issue.withdrawn_at.isoformat() if issue.withdrawn_at else None,
        "withdrawReason": issue.withdraw_reason,
        "reportCount": count,
    }


def _summary(page: dict) -> dict:
    return {
        "studentId": page["student"]["id"],
        "studentName": page["student"]["name"],
        "studentCode": page["student"]["code"],
        "totals": page["totals"],
        "weekNumbers": page["weekNumbers"],
        "note": page["notes"]["child"],
    }


@router.get("/sections")
def sections(viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    return {"sections": service.sections(db, viewer), "weeks": service.recent_weeks(), "defaultWeek": service.default_week().isoformat()}


@router.get("/week")
def week(
    classLevelId: str,
    section: str = Query(min_length=1, max_length=50),
    weekStart: str | None = None,
    viewer: Viewer = Depends(_viewer),
    db: Session = Depends(get_db),
):
    """A section's week: the issue if there is one (its pages as issued),
    else the drafts as they stand now, with the notes."""
    start = service.parse_week(weekStart)
    acc = service.access(db, viewer, classLevelId, section, start)
    school = db.get(School, viewer.school_id)
    current = service.current_issue(
        db, school_id=school.id, class_level_id=acc.class_level.id, section=acc.section, week_start=start
    )
    withdrawn = (
        db.query(WeeklyReportIssue)
        .filter(
            WeeklyReportIssue.school_id == school.id,
            WeeklyReportIssue.class_level_id == acc.class_level.id,
            WeeklyReportIssue.section == acc.section,
            WeeklyReportIssue.week_start == start,
            WeeklyReportIssue.status == "WITHDRAWN",
        )
        .order_by(WeeklyReportIssue.withdrawn_at.desc())
        .all()
    )
    if current is not None:
        pages = [service.page_data(r) for r in current.reports]
        rows = [{**_summary(p), "reportId": r.id} for p, r in zip(pages, current.reports)]
        section_note = pages[0]["notes"]["section"] if pages else None
    elif not acc.can_change:
        # A former teacher reads issued pages only, never today's drafts.
        rows, section_note = [], None
    else:
        students = report_card_service.section_students(db, school.id, acc.class_level, acc.section)
        pages = service.build(
            db, school=school, class_level=acc.class_level, section=acc.section, week_start=start,
            students=students, with_skills=False,
        )
        rows = [{**_summary(p), "reportId": None} for p in pages]
        section_note, _ = service.notes_for(db, school.id, acc.class_level.id, acc.section, start)
    return {
        "scope": f"{acc.class_level.id}|{acc.section}|{start.isoformat()}",
        "classLevel": {"id": acc.class_level.id, "displayName": acc.class_level.display_name},
        "section": acc.section,
        "week": {"start": start.isoformat(), "label": service.week_label(start), "isCurrent": start == service.monday_of(service.today())},
        "canChange": acc.can_change,
        # False for a former teacher with nothing issued that week: no drafts shown.
        "live": acc.can_change or current is not None,
        "issue": _issue_dict(current, db),
        "withdrawn": [_issue_dict(i, db) for i in withdrawn],
        "sectionNote": section_note,
        "maxNote": service.MAX_NOTE,
        "students": rows,
    }


class ChildNote(BaseModel):
    studentId: str
    note: str | None = Field(default=None, max_length=600)


class NotesBody(BaseModel):
    classLevelId: str
    section: str = Field(min_length=1, max_length=50)
    weekStart: str
    sectionNote: str | None = Field(default=None, max_length=600)
    updateSection: bool = True
    notes: list[ChildNote] = Field(default_factory=list, max_length=200)


@router.put("/notes")
@limiter.limit("60/minute")
def save_notes(request: Request, body: NotesBody, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    start = service.parse_week(body.weekStart)
    acc = service.access(db, viewer, body.classLevelId, body.section, start)
    service.require_change(acc)
    school_id = viewer.school_id
    allowed = {s.id for s in report_card_service.section_students(db, school_id, acc.class_level, acc.section)}
    try:
        changed = service.save_notes(
            db, school_id=school_id, class_level_id=acc.class_level.id, section=acc.section, week_start=start,
            section_note=body.sectionNote, child_notes={n.studentId: n.note for n in body.notes},
            allowed_student_ids=allowed, user_id=viewer.user.id, update_section=body.updateSection,
        )
    except WeeklyError as error:
        db.rollback()
        _refuse(error.message)
    except IntegrityError:
        db.rollback()
        api_error(409, "CONFLICT", "Someone saved these notes at the same moment. Reload and try again.")
    if changed:
        log_audit_event(
            db, "weekly_report.notes.saved", user_id=viewer.user.id, request=request,
            details={
                "schoolId": school_id, "classLevelId": acc.class_level.id, "section": acc.section,
                "weekStart": start.isoformat(), "changed": changed,
            },
        )
    db.commit()
    return {"saved": changed}


@router.get("/preview")
def preview(
    classLevelId: str,
    studentId: str,
    section: str = Query(min_length=1, max_length=50),
    weekStart: str | None = None,
    viewer: Viewer = Depends(_viewer),
    db: Session = Depends(get_db),
):
    """One child's page as it would be issued now."""
    start = service.parse_week(weekStart)
    acc = service.access(db, viewer, classLevelId, section, start)
    service.require_live(acc)
    school = db.get(School, viewer.school_id)
    students = [s for s in report_card_service.section_students(db, school.id, acc.class_level, acc.section) if s.id == studentId]
    if not students:
        _not_found("student")
    page = service.build(db, school=school, class_level=acc.class_level, section=acc.section, week_start=start, students=students)[0]
    return {"report": page}


class IssueBody(BaseModel):
    classLevelId: str
    section: str = Field(min_length=1, max_length=50)
    weekStart: str


@router.post("/issues")
@limiter.limit("20/minute")
def issue(request: Request, body: IssueBody, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    start = service.parse_week(body.weekStart)
    acc = service.access(db, viewer, body.classLevelId, body.section, start)
    service.require_change(acc)
    school = db.get(School, viewer.school_id)
    try:
        issued = service.issue(
            db, school=school, class_level=acc.class_level, section=acc.section, week_start=start,
            user_id=viewer.user.id, issuer_name=viewer.user.full_name,
        )
    except WeeklyError as error:
        db.rollback()
        _refuse(error.message)
    except IntegrityError:
        db.rollback()
        api_error(409, "CONFLICT", "This week was issued at the same moment by someone else. Reload to see it.")
    log_audit_event(
        db, "weekly_report.issued", user_id=viewer.user.id, request=request,
        details={
            "schoolId": school.id, "classLevelId": acc.class_level.id, "section": acc.section,
            "weekStart": start.isoformat(), "issueId": issued.id, "reports": len(issued.reports),
        },
    )
    db.commit()
    db.refresh(issued)
    return _issue_dict(issued, db)


def _load_issue(db: Session, viewer: Viewer, issue_id: str) -> tuple[WeeklyReportIssue, service.SectionAccess]:
    issued = db.get(WeeklyReportIssue, issue_id)
    if issued is None or issued.school_id != service.require_school(viewer):
        _not_found("week")
    acc = service.access(db, viewer, issued.class_level_id, issued.section, issued.week_start)
    return issued, acc


def _require_issued(issued: WeeklyReportIssue) -> None:
    """A withdrawn week's pages can't be opened or downloaded: a copy of one
    must never reach a parent as if it stood (#187 review)."""
    if issued.status != "ISSUED":
        api_error(404, "NOT_FOUND", "These reports were withdrawn, so they can't be opened or downloaded.")


class WithdrawBody(BaseModel):
    reason: str = Field(default="", max_length=600)


@router.post("/issues/{issue_id}/withdraw")
@limiter.limit("20/minute")
def withdraw(request: Request, issue_id: str, body: WithdrawBody, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    issued, acc = _load_issue(db, viewer, issue_id)
    service.require_change(acc)
    try:
        service.withdraw(db, issued, body.reason, viewer.user.id)
    except WeeklyError as error:
        db.rollback()
        _refuse(error.message)
    log_audit_event(
        db, "weekly_report.withdrawn", user_id=viewer.user.id, request=request,
        details={"issueId": issued.id, "reason": issued.withdraw_reason},
    )
    db.commit()
    return _issue_dict(issued, db)


def _file_name(*parts: str) -> str:
    text = "-".join(p for p in parts if p)
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-")[:90] or "Weekly-Report"


def _pdf(content: bytes, name: str) -> Response:
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{name}.pdf"', "Cache-Control": "no-store"},
    )


@router.get("/issues/{issue_id}/pdf")
def issue_pdf(issue_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    issued, _ = _load_issue(db, viewer, issue_id)
    _require_issued(issued)
    pages = [service.page_data(r) for r in issued.reports]
    name = _file_name(
        issued.class_level.display_name if issued.class_level else "", issued.section, "Weekly-Reports",
        issued.week_start.isoformat(),
    )
    return _pdf(weekly_report_pdf.render(pages), name)


def _staff_report(db: Session, viewer: Viewer, report_id: str) -> WeeklyReport:
    report = db.get(WeeklyReport, report_id)
    if report is None:
        _not_found("report")
    issued, _ = _load_issue(db, viewer, report.issue_id)
    _require_issued(issued)
    return report


@router.get("/reports/{report_id}")
def get_report(report_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    report = _staff_report(db, viewer, report_id)
    return {"id": report.id, "issueStatus": report.issue.status, "report": service.page_data(report)}


@router.get("/reports/{report_id}/pdf")
def report_pdf(report_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    report = _staff_report(db, viewer, report_id)
    page = service.page_data(report)
    return _pdf(weekly_report_pdf.render([page]), _file_name(page["student"]["code"], "Weekly-Report", page["week"]["start"]))


# --- the student's own -------------------------------------------------------------------


def _student_report(db: Session, student: Student, report_id: str) -> WeeklyReport:
    report = db.get(WeeklyReport, report_id)
    if report is None or report.student_id != student.id or report.issue.status != "ISSUED":
        _not_found("report")
    return report


@router.get("/mine")
def mine(student: Student = Depends(get_current_student), db: Session = Depends(get_db)):
    rows = (
        db.query(WeeklyReport, WeeklyReportIssue)
        .join(WeeklyReportIssue, WeeklyReportIssue.id == WeeklyReport.issue_id)
        .filter(WeeklyReport.student_id == student.id, WeeklyReportIssue.status == "ISSUED")
        .order_by(WeeklyReportIssue.week_start.desc(), WeeklyReportIssue.issued_at.desc())
        .limit(60)
        .all()
    )
    return {
        "reports": [
            {
                "id": report.id,
                "weekStart": issued.week_start.isoformat(),
                "weekLabel": service.week_label(issued.week_start),
                "issuedAt": issued.issued_at.isoformat() if issued.issued_at else None,
            }
            for report, issued in rows
        ]
    }


@router.get("/mine/{report_id}")
def my_report(report_id: str, student: Student = Depends(get_current_student), db: Session = Depends(get_db)):
    report = _student_report(db, student, report_id)
    return {"id": report.id, "report": service.page_data(report)}


@router.get("/mine/{report_id}/pdf")
def my_report_pdf(report_id: str, student: Student = Depends(get_current_student), db: Session = Depends(get_db)):
    report = _student_report(db, student, report_id)
    page = service.page_data(report)
    return _pdf(weekly_report_pdf.render([page]), _file_name(page["student"]["code"], "Weekly-Report", page["week"]["start"]))
