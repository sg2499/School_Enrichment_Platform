"""Admin-managed teacher <-> section/subject assignment endpoints (Phase 0
of the Practice Overview redesign, 20 Aug 2026).

See app/models/teacher_assignment.py's module docstring for the full "why".
In short: which teacher owns which (class_level, section, board_course) is
entirely an admin decision -- a teacher never self-assigns -- and this file
is the API surface for that decision plus the read-only "what are my
current sections" lookup a teacher's own UI needs.

Authorization mirrors routes_curriculum_admin.py's own split: writes are
ADMIN/SUPER_ADMIN only, scoped to the caller's own school the same way
(_resolve_school_id below is a deliberate near-duplicate of that file's
private helper of the same name -- not extracted into a shared module in
this pass, to avoid touching a file with no other reason to change here).
"""
from datetime import date

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.database import get_db
from app.dependencies import get_current_teacher, require_roles
from app.models import SchoolAdmin, Teacher, TeacherSectionAssignment, User
from app.services import teacher_assignment_service
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/api/teacher-assignments", tags=["teacher-assignments"])


def _resolve_school_id(db: Session, user: User, requested_school_id: str | None) -> str:
    """See routes_curriculum_admin.py's _resolve_school_id docstring -- same
    behaviour: ADMIN always acts on their own school (looked up server-side,
    never trusted from client input); SUPER_ADMIN must say which school."""
    if user.role == "SUPER_ADMIN":
        if not requested_school_id:
            api_error(422, "VALIDATION_ERROR", "schoolId is required for SUPER_ADMIN.")
        return requested_school_id

    school_admin = db.query(SchoolAdmin).filter(SchoolAdmin.user_id == user.id).first()
    if not school_admin:
        api_error(403, "FORBIDDEN", "No school is associated with this admin account.")
    if requested_school_id and requested_school_id != school_admin.school_id:
        api_error(403, "FORBIDDEN", "You can only manage teacher assignments for your own school.")
    return school_admin.school_id


def _parse_date(value: str, field_name: str) -> date:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        api_error(422, "VALIDATION_ERROR", f"{field_name} must be an ISO date (YYYY-MM-DD).")


def _assignment_dict(assignment: TeacherSectionAssignment) -> dict:
    return {
        "id": assignment.id,
        "schoolId": assignment.school_id,
        "teacherId": assignment.teacher_id,
        "teacherName": assignment.teacher.user.full_name if assignment.teacher and assignment.teacher.user else None,
        "classLevelId": assignment.class_level_id,
        "classLevelCode": assignment.class_level.code if assignment.class_level else None,
        "section": assignment.section,
        "boardCourseId": assignment.board_course_id,
        "boardCourseName": assignment.board_course.display_name if assignment.board_course else None,
        "startDate": assignment.start_date.isoformat() if assignment.start_date else None,
        "endDate": assignment.end_date.isoformat() if assignment.end_date else None,
        "isCurrent": assignment.end_date is None,
    }


class AssignTeacherRequest(BaseModel):
    schoolId: str | None = None  # SUPER_ADMIN only -- ADMIN's own school is always used instead
    teacherId: str
    classLevelId: str
    section: str
    boardCourseId: str
    startDate: str


class TransferTeacherRequest(BaseModel):
    newTeacherId: str
    transferDate: str


@router.post("")
def assign_teacher(
    payload: AssignTeacherRequest,
    request: Request,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    school_id = _resolve_school_id(db, user, payload.schoolId)
    start_date = _parse_date(payload.startDate, "startDate")

    assignment = teacher_assignment_service.assign_teacher_to_section(
        db,
        school_id=school_id,
        teacher_id=payload.teacherId,
        class_level_id=payload.classLevelId,
        section=payload.section,
        board_course_id=payload.boardCourseId,
        start_date=start_date,
        admin_user_id=user.id,
    )
    db.flush()
    log_audit_event(
        db,
        "teacher_assignment.created",
        user_id=user.id,
        request=request,
        details={
            "assignmentId": assignment.id,
            "schoolId": school_id,
            "teacherId": assignment.teacher_id,
            "classLevelId": assignment.class_level_id,
            "section": assignment.section,
            "boardCourseId": assignment.board_course_id,
            "startDate": payload.startDate,
        },
    )
    db.commit()
    db.refresh(assignment)
    return _assignment_dict(assignment)


@router.post("/{assignment_id}/transfer")
def transfer_teacher(
    assignment_id: str,
    payload: TransferTeacherRequest,
    request: Request,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    assignment = db.get(TeacherSectionAssignment, assignment_id)
    if not assignment:
        api_error(404, "NOT_FOUND", "Assignment not found.")
    # See _resolve_school_id's docstring -- an ADMIN may only touch their
    # own school's assignments; passing the assignment's own school_id as
    # "requested" makes that check reject a cross-school ADMIN outright.
    _resolve_school_id(db, user, assignment.school_id)

    transfer_date = _parse_date(payload.transferDate, "transferDate")
    old_teacher_id = assignment.teacher_id
    old_assignment, new_assignment = teacher_assignment_service.transfer_teacher(
        db,
        assignment=assignment,
        new_teacher_id=payload.newTeacherId,
        transfer_date=transfer_date,
        admin_user_id=user.id,
    )
    db.flush()
    log_audit_event(
        db,
        "teacher_assignment.transferred",
        user_id=user.id,
        request=request,
        details={
            "endedAssignmentId": old_assignment.id,
            "newAssignmentId": new_assignment.id,
            "schoolId": assignment.school_id,
            "classLevelId": assignment.class_level_id,
            "section": assignment.section,
            "boardCourseId": assignment.board_course_id,
            "fromTeacherId": old_teacher_id,
            "toTeacherId": payload.newTeacherId,
            "transferDate": payload.transferDate,
        },
    )
    db.commit()
    db.refresh(old_assignment)
    db.refresh(new_assignment)
    return {"endedAssignment": _assignment_dict(old_assignment), "newAssignment": _assignment_dict(new_assignment)}


@router.get("")
def list_teacher_assignments(
    schoolId: str | None = None,
    teacherId: str | None = None,
    classLevelId: str | None = None,
    section: str | None = None,
    boardCourseId: str | None = None,
    includeEnded: bool = False,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    school_id = _resolve_school_id(db, user, schoolId)
    query = db.query(TeacherSectionAssignment).filter(TeacherSectionAssignment.school_id == school_id)
    if teacherId:
        query = query.filter(TeacherSectionAssignment.teacher_id == teacherId)
    if classLevelId:
        query = query.filter(TeacherSectionAssignment.class_level_id == classLevelId)
    if section:
        query = query.filter(TeacherSectionAssignment.section == section.strip())
    if boardCourseId:
        query = query.filter(TeacherSectionAssignment.board_course_id == boardCourseId)
    if not includeEnded:
        query = query.filter(TeacherSectionAssignment.end_date.is_(None))
    rows = query.order_by(TeacherSectionAssignment.start_date.desc()).all()
    return {"assignments": [_assignment_dict(row) for row in rows]}


@router.get("/my-sections")
def list_my_sections(
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """A teacher's own currently-active sections -- the foundation the
    Practice Tracker/Assign Practice redesign (Phase 1) scopes its class
    picker and default views against, instead of the whole school."""
    rows = teacher_assignment_service.get_current_sections_for_teacher(db, teacher.id)
    return {"sections": [_assignment_dict(row) for row in rows]}
