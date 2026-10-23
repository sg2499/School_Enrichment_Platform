"""Report cards' API (Phase 4, #188, 23 Oct 2026).

Design: PHASE4_REPORT_CARD_DESIGN.md. The rules live in
app/services/report_card_service.py; this file decides who may do what:

  * School Admin (ADMIN): their own school: the co-scholastic areas and
    scale; every section's attendance, grades and remarks; issuing and
    withdrawing a section's cards; every card.
  * Super Admin: the same for any school, naming it.
  * Teacher: records attendance, grades and remarks for the sections they
    teach now (any subject); reads the records and cards of every section
    they taught during the year; cannot issue.
  * Student: their own issued cards (not withdrawn ones).

Anything outside a caller's reach is a 404, as elsewhere.
"""
import json
import re
from datetime import datetime

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
from app.models import (
    AcademicYear,
    ClassLevel,
    ReportCard,
    ReportCardIssue,
    School,
    Student,
    TeacherSectionAssignment,
    User,
)
from app.services import practice_access_service, report_card_pdf
from app.services import report_card_service as service
from app.services.assessment_service import SCHOOL_TIMEZONE, SchemeError
from app.services.audit_service import log_audit_event
from app.services.practice_access_service import Viewer
from app.services.report_card_service import IssueBlocked

router = APIRouter(prefix="/api/report-cards", tags=["report-cards"])


def _viewer(
    user: User = Depends(require_roles("TEACHER", "ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
) -> Viewer:
    return practice_access_service.resolve_viewer(db, user)


def _refuse(problems: list[str]):
    api_error(422, "VALIDATION_ERROR", problems[0], {"problems": problems})


def _not_found(what: str):
    api_error(404, "NOT_FOUND", f"We couldn't find that {what}.")


def _school(db: Session, viewer: Viewer, requested: str | None) -> School:
    """A teacher's or Admin's own school; a Super Admin names one."""
    if viewer.role == "SUPER_ADMIN":
        if not requested:
            api_error(422, "VALIDATION_ERROR", "Choose a school first.")
        school = db.get(School, requested)
    else:
        if requested and requested != viewer.school_id:
            _not_found("school")
        school = db.get(School, viewer.school_id)
    if school is None:
        _not_found("school")
    return school


def _year(db: Session, school: School, year_id: str) -> AcademicYear:
    year = db.get(AcademicYear, year_id)
    if year is None or year.school_id != school.id:
        _not_found("year")
    return year


def _class_level(db: Session, class_level_id: str) -> ClassLevel:
    level = db.get(ClassLevel, class_level_id)
    if level is None:
        _not_found("class")
    return level


def _teacher_sections(db: Session, viewer: Viewer, year: AcademicYear) -> dict[tuple[str, str], bool]:
    """(class level, section) -> whether the teacher teaches it now, for
    every section they taught during the year (any subject)."""
    windows = (
        db.query(TeacherSectionAssignment)
        .filter(
            TeacherSectionAssignment.teacher_id == viewer.teacher.id,
            TeacherSectionAssignment.school_id == year.school_id,
            TeacherSectionAssignment.start_date <= year.end_date,
        )
        .all()
    )
    out: dict[tuple[str, str], bool] = {}
    today = datetime.now(SCHOOL_TIMEZONE).date()
    for w in windows:
        if w.end_date is not None and w.end_date <= year.start_date:
            continue
        key = (w.class_level_id, w.section)
        # Teaching it now: an open window that has started (review).
        out[key] = out.get(key, False) or (w.end_date is None and w.start_date <= today)
    return out


def _may(db: Session, viewer: Viewer, year: AcademicYear, class_level_id: str, section: str, *, record: bool) -> None:
    """Refuses a teacher outside the section (404), or one who no longer
    teaches it trying to change it (403). Admins pass (their school is
    already checked)."""
    if not viewer.is_teacher:
        return
    sections = _teacher_sections(db, viewer, year)
    if (class_level_id, section) not in sections:
        _not_found("section")
    if record and not sections[(class_level_id, section)]:
        api_error(403, "FORBIDDEN", "You no longer teach this section, so you can see its records but not change them.")


def _manage_only(viewer: Viewer) -> None:
    if viewer.is_teacher:
        api_error(403, "FORBIDDEN", "Only a school admin can do that.")


def _card_count(db: Session, issue: ReportCardIssue) -> int:
    return db.query(func.count(ReportCard.id)).filter(ReportCard.issue_id == issue.id).scalar() or 0


def _issue_dict(issue: ReportCardIssue | None, db: Session | None = None) -> dict | None:
    if issue is None:
        return None
    return {
        "id": issue.id,
        "cardTerm": issue.card_term,
        "status": issue.status,
        "section": issue.section,
        "classLevel": {"id": issue.class_level.id, "displayName": issue.class_level.display_name},
        "yearLabel": issue.academic_year.label if issue.academic_year else None,
        "issuedAt": issue.issued_at.isoformat() if issue.issued_at else None,
        "withdrawnAt": issue.withdrawn_at.isoformat() if issue.withdrawn_at else None,
        "withdrawReason": issue.withdraw_reason,
        # Counted, not loaded: each card carries its whole printed copy (review).
        "cardCount": _card_count(db, issue) if db is not None else len(issue.cards),
    }


def _settings_dict(settings: service.Settings) -> dict:
    return {"areas": settings.areas, "scale": settings.scale, "saved": settings.saved}


# --- the overview ------------------------------------------------------------------------


@router.get("/overview")
def overview(
    yearId: str,
    schoolId: str | None = None,
    viewer: Viewer = Depends(_viewer),
    db: Session = Depends(get_db),
):
    school = _school(db, viewer, schoolId)
    year = _year(db, school, yearId)
    sections = service.class_sections(db, school.id)
    taught: dict[tuple[str, str], bool] = {}
    if viewer.is_teacher:
        taught = _teacher_sections(db, viewer, year)
        sections = [(level, sec) for level, sec in sections if (level.id, sec) in taught]
    issues = (
        db.query(ReportCardIssue)
        .filter(
            ReportCardIssue.school_id == school.id,
            ReportCardIssue.academic_year_id == year.id,
            ReportCardIssue.status == "ISSUED",
        )
        .all()
    )
    by_scope = {(i.class_level_id, i.section, i.card_term): i for i in issues}
    return {
        "school": {"id": school.id, "name": school.name},
        "year": {"id": year.id, "label": year.label, "isCurrent": year.is_current},
        "settings": _settings_dict(service.get_settings(db, school.id, year.id)),
        "canManage": not viewer.is_teacher,
        "sections": [
            {
                "classLevel": {"id": level.id, "displayName": level.display_name},
                "section": sec,
                "canRecord": (not viewer.is_teacher) or taught[(level.id, sec)],
                "issues": {term: _issue_dict(by_scope.get((level.id, sec, term)), db) for term in ("TERM_1", "YEAR_END")},
            }
            for level, sec in sections
        ],
    }


# --- settings ---------------------------------------------------------------------------


class ScaleBody(BaseModel):
    label: str = Field(default="", max_length=20)
    meaning: str = Field(default="", max_length=80)


class SettingsBody(BaseModel):
    schoolId: str | None = None
    yearId: str
    areas: list[str] = Field(default_factory=list, max_length=20)
    scale: list[ScaleBody] = Field(default_factory=list, max_length=12)


@router.put("/settings")
@limiter.limit("30/minute")
def save_settings(request: Request, body: SettingsBody, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    _manage_only(viewer)
    school = _school(db, viewer, body.schoolId)
    year = _year(db, school, body.yearId)
    try:
        areas, scale = service.clean_settings(body.areas, [s.model_dump() for s in body.scale])
    except SchemeError as error:
        _refuse(error.problems)
    service.save_settings(db, school.id, year.id, areas, scale, viewer.user.id)
    log_audit_event(
        db, "report.settings.saved", user_id=viewer.user.id, request=request,
        details={"schoolId": school.id, "yearId": year.id, "areas": areas, "scale": scale},
    )
    db.commit()
    return _settings_dict(service.get_settings(db, school.id, year.id))


# --- what teachers record ------------------------------------------------------------------


@router.get("/records")
def get_records(
    yearId: str,
    classLevelId: str,
    section: str = Query(min_length=1, max_length=50),
    term: str = Query(pattern="^(TERM_1|TERM_2)$"),
    schoolId: str | None = None,
    viewer: Viewer = Depends(_viewer),
    db: Session = Depends(get_db),
):
    school = _school(db, viewer, schoolId)
    year = _year(db, school, yearId)
    level = _class_level(db, classLevelId)
    _may(db, viewer, year, level.id, section, record=False)
    students = service.section_students(db, school.id, level, section)
    records = service.records_for(db, year.id, term, [s.id for s in students])
    can_record = True
    if viewer.is_teacher:
        can_record = _teacher_sections(db, viewer, year).get((level.id, section), False)
    return {
        "settings": _settings_dict(service.get_settings(db, school.id, year.id)),
        "canRecord": can_record,
        "rows": [
            {
                "studentId": s.id,
                "studentCode": s.student_code,
                "studentName": s.user.full_name if s.user else None,
                "workingDays": records[s.id].working_days if s.id in records else None,
                "daysPresent": records[s.id].days_present if s.id in records else None,
                "grades": json.loads(records[s.id].grades_json) if s.id in records else {},
                "remark": records[s.id].remark if s.id in records else None,
                "updatedAt": (
                    records[s.id].updated_at.isoformat() if s.id in records and records[s.id].updated_at else None
                ),
            }
            for s in students
        ],
    }


class RecordBody(BaseModel):
    studentId: str
    workingDays: int | str | None = None
    daysPresent: int | str | None = None
    grades: dict[str, str] = Field(default_factory=dict)
    remark: str | None = Field(default=None, max_length=600)


class SaveRecordsBody(BaseModel):
    schoolId: str | None = None
    yearId: str
    classLevelId: str
    section: str = Field(min_length=1, max_length=50)
    term: str = Field(pattern="^(TERM_1|TERM_2)$")
    entries: list[RecordBody] = Field(min_length=1, max_length=200)


@router.put("/records")
@limiter.limit("60/minute")
def save_records(request: Request, body: SaveRecordsBody, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    school = _school(db, viewer, body.schoolId)
    year = _year(db, school, body.yearId)
    level = _class_level(db, body.classLevelId)
    _may(db, viewer, year, level.id, body.section, record=True)
    allowed = {s.id for s in service.section_students(db, school.id, level, body.section)}
    try:
        changed = service.save_records(
            db,
            school_id=school.id,
            year_id=year.id,
            term=body.term,
            entries=[e.model_dump() for e in body.entries],
            allowed_student_ids=allowed,
            settings=service.get_settings(db, school.id, year.id),
            user_id=viewer.user.id,
        )
    except SchemeError as error:
        db.rollback()
        _refuse(error.problems)
    except IntegrityError:
        db.rollback()
        api_error(409, "CONFLICT", "Someone saved these records at the same moment. Reload and try again.")
    if changed:
        log_audit_event(
            db, "report.records.saved", user_id=viewer.user.id, request=request,
            details={
                "schoolId": school.id, "yearId": year.id, "classLevelId": level.id, "section": body.section,
                "term": body.term, "changed": changed,
            },
        )
    db.commit()
    return {"saved": changed}


# --- readiness, issuing, withdrawing -------------------------------------------------------


@router.get("/readiness")
def readiness(
    yearId: str,
    classLevelId: str,
    section: str = Query(min_length=1, max_length=50),
    cardTerm: str = Query(pattern="^(TERM_1|YEAR_END)$"),
    schoolId: str | None = None,
    viewer: Viewer = Depends(_viewer),
    db: Session = Depends(get_db),
):
    school = _school(db, viewer, schoolId)
    year = _year(db, school, yearId)
    level = _class_level(db, classLevelId)
    _may(db, viewer, year, level.id, section, record=False)
    built = service.build_cards(db, school=school, year=year, class_level=level, section=section, card_term=cardTerm)
    current = service.current_issue(
        db, school_id=school.id, year_id=year.id, class_level_id=level.id, section=section, card_term=cardTerm
    )
    return {
        "problems": built.problems,
        "warnings": built.warnings,
        "students": len(built.cards),
        "subjects": [s["subject"] for s in built.cards[0]["subjects"]] if built.cards else [],
        "issue": _issue_dict(current, db),
        "canIssue": not viewer.is_teacher,
    }


class IssueBody(BaseModel):
    schoolId: str | None = None
    yearId: str
    classLevelId: str
    section: str = Field(min_length=1, max_length=50)
    cardTerm: str = Field(pattern="^(TERM_1|YEAR_END)$")


@router.post("/issues")
@limiter.limit("20/minute")
def issue_cards(request: Request, body: IssueBody, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    _manage_only(viewer)
    school = _school(db, viewer, body.schoolId)
    year = _year(db, school, body.yearId)
    level = _class_level(db, body.classLevelId)
    try:
        issued = service.issue(
            db, school=school, year=year, class_level=level, section=body.section, card_term=body.cardTerm,
            user_id=viewer.user.id,
        )
    except (IssueBlocked, SchemeError) as error:
        db.rollback()
        _refuse(error.problems)
    except IntegrityError:
        db.rollback()
        api_error(409, "CONFLICT", "These cards were issued at the same moment by someone else. Reload to see them.")
    log_audit_event(
        db, "report.cards.issued", user_id=viewer.user.id, request=request,
        details={
            "schoolId": school.id, "yearId": year.id, "classLevelId": level.id, "section": body.section,
            "cardTerm": body.cardTerm, "issueId": issued.id, "cards": len(issued.cards),
        },
    )
    db.commit()
    db.refresh(issued)
    return _issue_dict(issued)


class WithdrawBody(BaseModel):
    reason: str = Field(default="", max_length=600)


def _load_issue(db: Session, viewer: Viewer, issue_id: str) -> ReportCardIssue:
    issued = db.get(ReportCardIssue, issue_id)
    if issued is None:
        _not_found("issue")
    if viewer.role != "SUPER_ADMIN" and issued.school_id != viewer.school_id:
        _not_found("issue")
    if viewer.is_teacher and (issued.class_level_id, issued.section) not in _teacher_sections(db, viewer, issued.academic_year):
        _not_found("issue")
    return issued


@router.post("/issues/{issue_id}/withdraw")
@limiter.limit("20/minute")
def withdraw_cards(
    request: Request, issue_id: str, body: WithdrawBody, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)
):
    _manage_only(viewer)
    issued = _load_issue(db, viewer, issue_id)
    try:
        service.withdraw(db, issued, body.reason, viewer.user.id)
    except SchemeError as error:
        db.rollback()
        _refuse(error.problems)
    log_audit_event(
        db, "report.cards.withdrawn", user_id=viewer.user.id, request=request,
        details={"issueId": issued.id, "reason": issued.withdraw_reason},
    )
    db.commit()
    return _issue_dict(issued)


@router.get("/issues")
def list_issues(
    yearId: str,
    classLevelId: str,
    section: str = Query(min_length=1, max_length=50),
    schoolId: str | None = None,
    viewer: Viewer = Depends(_viewer),
    db: Session = Depends(get_db),
):
    school = _school(db, viewer, schoolId)
    year = _year(db, school, yearId)
    _may(db, viewer, year, classLevelId, section, record=False)
    issues = (
        db.query(ReportCardIssue)
        .filter(
            ReportCardIssue.school_id == school.id,
            ReportCardIssue.academic_year_id == year.id,
            ReportCardIssue.class_level_id == classLevelId,
            ReportCardIssue.section == section,
        )
        .order_by(ReportCardIssue.issued_at.desc())
        .all()
    )
    return {"issues": [_issue_dict(i, db) for i in issues]}


def _card_summary(card: ReportCard) -> dict:
    data = service.card_data(card)
    return {
        "id": card.id,
        "studentId": card.student_id,
        "studentCode": data["student"]["code"],
        "studentName": data["student"]["name"],
        "subjects": [
            {"subject": s["subject"], "result": s["result"], "grade": s["grade"], "outcomeLabel": s["outcomeLabel"]}
            for s in data["subjects"]
        ],
    }


@router.get("/issues/{issue_id}")
def get_issue(issue_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    issued = _load_issue(db, viewer, issue_id)
    return {**_issue_dict(issued), "cards": [_card_summary(c) for c in issued.cards]}


def _file_name(*parts: str) -> str:
    text = "-".join(p for p in parts if p)
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-")[:90] or "Report-Card"


def _pdf(content: bytes, name: str) -> Response:
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{name}.pdf"', "Cache-Control": "no-store"},
    )


@router.get("/issues/{issue_id}/pdf")
def issue_pdf(issue_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    issued = _load_issue(db, viewer, issue_id)
    cards = [service.card_data(c) for c in issued.cards]
    name = _file_name(
        issued.class_level.display_name, issued.section, service.TERM_LABEL[issued.card_term], "Report-Cards",
        issued.academic_year.label if issued.academic_year else "",
    )
    return _pdf(report_card_pdf.render(cards), name)


def _load_card_for_staff(db: Session, viewer: Viewer, card_id: str) -> ReportCard:
    card = db.get(ReportCard, card_id)
    if card is None:
        _not_found("report card")
    _load_issue(db, viewer, card.issue_id)
    return card


@router.get("/cards/{card_id}")
def get_card(card_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    card = _load_card_for_staff(db, viewer, card_id)
    return {"id": card.id, "issueStatus": card.issue.status, "card": service.card_data(card)}


@router.get("/cards/{card_id}/pdf")
def card_pdf(card_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    card = _load_card_for_staff(db, viewer, card_id)
    data = service.card_data(card)
    return _pdf(report_card_pdf.render([data]), _file_name(data["student"]["code"], data["title"], data["year"]))


# --- the student's own -------------------------------------------------------------------


def _student_card(db: Session, student: Student, card_id: str) -> ReportCard:
    card = db.get(ReportCard, card_id)
    if card is None or card.student_id != student.id or card.issue.status != "ISSUED":
        _not_found("report card")
    return card


@router.get("/mine")
def my_cards(student: Student = Depends(get_current_student), db: Session = Depends(get_db)):
    cards = (
        db.query(ReportCard)
        .join(ReportCardIssue, ReportCardIssue.id == ReportCard.issue_id)
        .filter(ReportCard.student_id == student.id, ReportCardIssue.status == "ISSUED")
        .order_by(ReportCardIssue.issued_at.desc())
        .all()
    )
    out = []
    for card in cards:
        data = service.card_data(card)
        out.append({"id": card.id, "title": data["title"], "year": data["year"], "issuedAt": data.get("issuedAt")})
    return {"cards": out}


@router.get("/mine/{card_id}")
def my_card(card_id: str, student: Student = Depends(get_current_student), db: Session = Depends(get_db)):
    card = _student_card(db, student, card_id)
    return {"id": card.id, "issueStatus": card.issue.status, "card": service.card_data(card)}


@router.get("/mine/{card_id}/pdf")
def my_card_pdf(card_id: str, student: Student = Depends(get_current_student), db: Session = Depends(get_db)):
    card = _student_card(db, student, card_id)
    data = service.card_data(card)
    return _pdf(report_card_pdf.render([data]), _file_name(data["student"]["code"], data["title"], data["year"]))
