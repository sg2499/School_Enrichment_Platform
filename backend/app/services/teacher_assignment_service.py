"""Service layer for TeacherSectionAssignment: assigning/transferring a
teacher's ownership of a (class_level, section, board_course) and computing
what a teacher may currently act on vs. historically read.

See app/models/teacher_assignment.py's module docstring for the full "why"
this table exists. Two access checks live here, and every future endpoint
that scopes a teacher's practice/results data should call one of them
rather than re-deriving the logic:

  teacher_may_currently_act_on -- gates WRITE actions (assign practice,
    grant an extra attempt, ...). Only today's designated teacher for a
    section/subject may act on it -- never a since-transferred one.

  teacher_may_read_record -- gates READ access to one historical record
    (an Assignment/AssignmentTarget/Attempt) tied to a section/subject.
    True if the record's creation time falls inside ANY window -- current
    or already-ended -- the teacher ever held for that exact
    (class_level, section, board_course). Implements Shailesh's 20 Aug 2026
    answer verbatim: an outgoing teacher keeps read access to what happened
    on their watch, and gains no visibility into anything created after
    their end_date.

ADMIN/SUPER_ADMIN bypass both checks entirely at the route layer -- they
are not filtered by this module at all, matching every other
admin-vs-teacher scoping split already in this codebase (see
routes_curriculum_admin.py's _resolve_school_id docstring).
"""
from datetime import date, datetime

from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.models import BoardCourse, ClassLevel, Teacher, TeacherSectionAssignment


def _active_assignment(
    db: Session, *, school_id: str, class_level_id: str, section: str, board_course_id: str
) -> TeacherSectionAssignment | None:
    return (
        db.query(TeacherSectionAssignment)
        .filter(
            TeacherSectionAssignment.school_id == school_id,
            TeacherSectionAssignment.class_level_id == class_level_id,
            TeacherSectionAssignment.section == section,
            TeacherSectionAssignment.board_course_id == board_course_id,
            TeacherSectionAssignment.end_date.is_(None),
        )
        .first()
    )


def assign_teacher_to_section(
    db: Session,
    *,
    school_id: str,
    teacher_id: str,
    class_level_id: str,
    section: str,
    board_course_id: str,
    start_date: date,
    admin_user_id: str | None,
) -> TeacherSectionAssignment:
    section = (section or "").strip()
    if not section:
        api_error(422, "VALIDATION_ERROR", "Section is required.")

    teacher = db.get(Teacher, teacher_id)
    if not teacher or teacher.school_id != school_id:
        api_error(404, "NOT_FOUND", "Teacher not found in this school.")
    if not teacher.is_active:
        api_error(400, "TEACHER_INACTIVE", "Cannot assign an inactive teacher.")
    if not db.get(ClassLevel, class_level_id):
        api_error(404, "NOT_FOUND", "Class level not found.")
    if not db.get(BoardCourse, board_course_id):
        api_error(404, "NOT_FOUND", "Board course not found.")

    existing = _active_assignment(
        db,
        school_id=school_id,
        class_level_id=class_level_id,
        section=section,
        board_course_id=board_course_id,
    )
    if existing:
        api_error(
            409,
            "SECTION_ALREADY_ASSIGNED",
            "This section/subject already has an active teacher assignment. Use transfer instead of "
            "creating a second one.",
        )

    assignment = TeacherSectionAssignment(
        school_id=school_id,
        teacher_id=teacher_id,
        class_level_id=class_level_id,
        section=section,
        board_course_id=board_course_id,
        start_date=start_date,
        created_by_user_id=admin_user_id,
    )
    db.add(assignment)
    return assignment


def transfer_teacher(
    db: Session,
    *,
    assignment: TeacherSectionAssignment,
    new_teacher_id: str,
    transfer_date: date,
    admin_user_id: str | None,
) -> tuple[TeacherSectionAssignment, TeacherSectionAssignment]:
    """Ends `assignment` on transfer_date and starts a brand new row for the
    incoming teacher on the same date -- never mutates teacher_id in place
    (see the model's module docstring for why that matters for historical
    read access). Both rows are added/updated on `db` but not committed
    here, matching this codebase's atomic-commit-at-the-route convention
    (see audit_service.py's own docstring) -- the caller commits once,
    alongside its own audit log entry.

    Deliberately does not support scheduling a transfer for a future date --
    "transfer_date" always takes effect immediately (today or backdated to
    correct a mistake), never ahead of time. A future-dated handover is a
    real scenario schools have, but nothing in the current admin UI plan
    schedules one yet, so this stays a simple deliberate v1 limitation
    rather than half-built support for it.
    """
    if assignment.end_date is not None:
        api_error(
            409, "ASSIGNMENT_ALREADY_ENDED", "This assignment has already ended and cannot be transferred again."
        )
    if transfer_date < assignment.start_date:
        api_error(422, "INVALID_TRANSFER_DATE", "Transfer date cannot be before the current assignment started.")
    if transfer_date > date.today():
        api_error(
            422,
            "INVALID_TRANSFER_DATE",
            "Transfer date cannot be in the future; scheduling a transfer ahead of time isn't supported yet.",
        )

    new_teacher = db.get(Teacher, new_teacher_id)
    if not new_teacher or new_teacher.school_id != assignment.school_id:
        api_error(404, "NOT_FOUND", "Teacher not found in this school.")
    if not new_teacher.is_active:
        api_error(400, "TEACHER_INACTIVE", "Cannot transfer to an inactive teacher.")
    if new_teacher.id == assignment.teacher_id:
        api_error(400, "SAME_TEACHER", "This teacher already holds this assignment.")

    assignment.end_date = transfer_date
    new_assignment = TeacherSectionAssignment(
        school_id=assignment.school_id,
        teacher_id=new_teacher_id,
        class_level_id=assignment.class_level_id,
        section=assignment.section,
        board_course_id=assignment.board_course_id,
        start_date=transfer_date,
        created_by_user_id=admin_user_id,
    )
    db.add(new_assignment)
    return assignment, new_assignment


def get_current_sections_for_teacher(db: Session, teacher_id: str) -> list[TeacherSectionAssignment]:
    return (
        db.query(TeacherSectionAssignment)
        .filter(TeacherSectionAssignment.teacher_id == teacher_id, TeacherSectionAssignment.end_date.is_(None))
        .all()
    )


def get_all_assignments_for_teacher(db: Session, teacher_id: str) -> list[TeacherSectionAssignment]:
    return (
        db.query(TeacherSectionAssignment)
        .filter(TeacherSectionAssignment.teacher_id == teacher_id)
        .order_by(TeacherSectionAssignment.start_date.desc())
        .all()
    )


def teacher_may_currently_act_on(
    db: Session, *, teacher_id: str, class_level_id: str, section: str, board_course_id: str
) -> bool:
    return (
        db.query(TeacherSectionAssignment.id)
        .filter(
            TeacherSectionAssignment.teacher_id == teacher_id,
            TeacherSectionAssignment.class_level_id == class_level_id,
            TeacherSectionAssignment.section == section,
            TeacherSectionAssignment.board_course_id == board_course_id,
            TeacherSectionAssignment.end_date.is_(None),
        )
        .first()
        is not None
    )


def teacher_may_read_record(
    db: Session,
    *,
    teacher_id: str,
    class_level_id: str,
    section: str,
    board_course_id: str,
    record_created_at: datetime | date,
) -> bool:
    windows = (
        db.query(TeacherSectionAssignment.start_date, TeacherSectionAssignment.end_date)
        .filter(
            TeacherSectionAssignment.teacher_id == teacher_id,
            TeacherSectionAssignment.class_level_id == class_level_id,
            TeacherSectionAssignment.section == section,
            TeacherSectionAssignment.board_course_id == board_course_id,
        )
        .all()
    )
    record_date = record_created_at.date() if isinstance(record_created_at, datetime) else record_created_at
    return any(
        record_date >= start_date and (end_date is None or record_date < end_date)
        for start_date, end_date in windows
    )
