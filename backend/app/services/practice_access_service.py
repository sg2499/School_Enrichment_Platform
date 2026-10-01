"""Who may see, and who may change, practice data -- assignments, their
per-student targets and attempts, and a student's practice history
(1 Oct 2026, Practice Tracker redesign + manual grading).

Before this module, a TEACHER's read access to an assignment was simply
"I created it" (routes_learning._check_assignment_scope), and write access
(grant an extra attempt) was the same check. That ignored the admin-managed
teacher <-> section model entirely: the teacher who took over 5A Maths
mid-year could not see 5A's practice, and a teacher transferred off 5A
could still grant re-attempts there. This module applies
teacher_assignment_service's two existing checks to practice records, and
every tracker/grading endpoint goes through it rather than re-deriving the
rule (which is what that service's own docstring asks for).

The rule, for a TEACHER and one Assignment:

  READ  -- they created it, OR the assignment is section-scoped
           (class_level, section and board_course all recorded -- see the
           Assignment model) and teacher_may_read_record says its creation
           falls inside one of their windows for that exact triple. This is
           Shailesh's 20 Aug 2026 handover policy applied to practice: an
           outgoing teacher keeps read access to what was set on their
           watch; an incoming teacher sees what is set from their own start
           date forward, including practice an admin set for their section.
           "Created it" is kept as its own grant so nothing a teacher could
           see before this change disappears (e.g. assignments made before
           an admin recorded their section ownership, whose created_at
           precedes their window's start_date).

  ACT   -- (grade an answer, grant an extra attempt) READ, plus
           teacher_may_currently_act_on for the assignment's triple: only
           today's designated teacher may change anything, never a
           since-transferred one, even on records they can still read. An
           assignment that is NOT section-scoped (a pre-1-Oct whole-class
           row the migration couldn't pin to one section, or a
           single-student Foundation Repair assignment) has no triple to
           check, so it falls back to the old rule: its creator may act.

Outside READ, callers return 404 (this codebase's "don't disclose that
another teacher's/school's record exists" convention). READ but not ACT is
a 403 with a message saying why -- the teacher can already see the record,
so there is nothing left to hide.

ADMIN: everything in their own school. SUPER_ADMIN: everything. Neither is
filtered by section windows -- same split as teacher_assignment_service.
"""
from dataclasses import dataclass

from sqlalchemy import and_, exists, false, not_, or_, true
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.models import (
    Assignment,
    AssignmentTarget,
    ClassLevel,
    SchoolAdmin,
    Student,
    Teacher,
    TeacherSectionAssignment,
    User,
)
from app.services import teacher_assignment_service


@dataclass(frozen=True)
class Viewer:
    user: User
    teacher: Teacher | None
    # None = every school (SUPER_ADMIN only).
    school_id: str | None

    @property
    def role(self) -> str:
        return self.user.role

    @property
    def is_teacher(self) -> bool:
        return self.user.role == "TEACHER"


def resolve_viewer(db: Session, user: User) -> Viewer:
    if user.role == "TEACHER":
        teacher = db.query(Teacher).filter(Teacher.user_id == user.id).first()
        if not teacher or not teacher.is_active:
            api_error(403, "FORBIDDEN", "Teacher profile not found or inactive.")
        return Viewer(user=user, teacher=teacher, school_id=teacher.school_id)
    if user.role == "ADMIN":
        school_admin = db.query(SchoolAdmin).filter(SchoolAdmin.user_id == user.id).first()
        if not school_admin:
            api_error(403, "FORBIDDEN", "No school is associated with this admin account.")
        return Viewer(user=user, teacher=None, school_id=school_admin.school_id)
    if user.role == "SUPER_ADMIN":
        return Viewer(user=user, teacher=None, school_id=None)
    api_error(403, "FORBIDDEN", "You do not have permission for this action.")


def assignment_scope(assignment: Assignment) -> tuple[str, str, str] | None:
    """(class_level_id, section, board_course_id), or None when the
    assignment isn't pinned to one section of one course."""
    if assignment.class_level_id and assignment.section and assignment.board_course_id:
        return assignment.class_level_id, assignment.section, assignment.board_course_id
    return None


# --- one record --------------------------------------------------------------


def can_read_assignment(db: Session, viewer: Viewer, assignment: Assignment) -> bool:
    if viewer.school_id is not None and assignment.school_id != viewer.school_id:
        return False
    if not viewer.is_teacher:
        return True
    if assignment.assigned_by_user_id == viewer.user.id:
        return True
    scope = assignment_scope(assignment)
    if scope is None or assignment.created_at is None:
        return False
    class_level_id, section, board_course_id = scope
    return teacher_assignment_service.teacher_may_read_record(
        db,
        teacher_id=viewer.teacher.id,
        class_level_id=class_level_id,
        section=section,
        board_course_id=board_course_id,
        record_created_at=assignment.created_at,
    )


def can_act_on_assignment(db: Session, viewer: Viewer, assignment: Assignment) -> bool:
    if not can_read_assignment(db, viewer, assignment):
        return False
    if not viewer.is_teacher:
        return True
    scope = assignment_scope(assignment)
    if scope is None:
        return assignment.assigned_by_user_id == viewer.user.id
    class_level_id, section, board_course_id = scope
    return teacher_assignment_service.teacher_may_currently_act_on(
        db,
        teacher_id=viewer.teacher.id,
        class_level_id=class_level_id,
        section=section,
        board_course_id=board_course_id,
    )


def bulk_act_checker(db: Session, viewer: Viewer):
    """can_act_on_assignment for a whole page of rows that are ALREADY
    known to be readable (they came out of readable_assignments_clause):
    loads the teacher's current (class_level, section, board_course)
    triples once instead of two lookups per row. Equivalent to
    can_act_on_assignment under that precondition -- see
    test_practice_tracker.py, which checks list rows' canAct against the
    single-record endpoints."""
    if not viewer.is_teacher:
        return lambda assignment: True
    current = {
        (row.class_level_id, row.section, row.board_course_id)
        for row in teacher_assignment_service.get_current_sections_for_teacher(db, viewer.teacher.id)
    }

    def check(assignment: Assignment) -> bool:
        scope = assignment_scope(assignment)
        if scope is None:
            return assignment.assigned_by_user_id == viewer.user.id
        return scope in current

    return check


def require_readable_assignment(db: Session, viewer: Viewer, assignment: Assignment | None) -> Assignment:
    if assignment is None or not can_read_assignment(db, viewer, assignment):
        api_error(404, "NOT_FOUND", "Assignment not found.")
    return assignment


def require_actionable_assignment(db: Session, viewer: Viewer, assignment: Assignment | None) -> Assignment:
    assignment = require_readable_assignment(db, viewer, assignment)
    if not can_act_on_assignment(db, viewer, assignment):
        api_error(
            403,
            "READ_ONLY_HANDOVER",
            "You can view this practice, but only the current teacher of this section can change it.",
        )
    return assignment


# --- many records (SQL filters for paginated lists) ---------------------------


def readable_assignments_clause(viewer: Viewer):
    """WHERE clause selecting exactly the Assignment rows can_read_assignment
    would allow -- the SQL form, for paginated list queries."""
    if viewer.school_id is None:
        return true()
    school_clause = Assignment.school_id == viewer.school_id
    if not viewer.is_teacher:
        return school_clause
    window = teacher_assignment_service.readable_record_window_clause(
        teacher_id=viewer.teacher.id,
        class_level_id_col=Assignment.class_level_id,
        section_col=Assignment.section,
        board_course_id_col=Assignment.board_course_id,
        created_at_col=Assignment.created_at,
    )
    return and_(school_clause, or_(Assignment.assigned_by_user_id == viewer.user.id, window))


def actionable_assignments_clause(viewer: Viewer):
    """SQL form of can_act_on_assignment -- used by the Needs Review queue,
    which lists only what this viewer can actually mark. A teacher's
    read-only (handed-over) assignments stay visible everywhere else, just
    not as work waiting for them."""
    readable = readable_assignments_clause(viewer)
    if not viewer.is_teacher:
        return readable
    tsa = TeacherSectionAssignment
    owns_now = exists().where(
        tsa.teacher_id == viewer.teacher.id,
        tsa.end_date.is_(None),
        tsa.class_level_id == Assignment.class_level_id,
        tsa.section == Assignment.section,
        tsa.board_course_id == Assignment.board_course_id,
    )
    scoped = and_(
        Assignment.class_level_id.isnot(None),
        Assignment.section.isnot(None),
        Assignment.board_course_id.isnot(None),
    )
    return and_(
        readable,
        or_(and_(scoped, owns_now), and_(not_(scoped), Assignment.assigned_by_user_id == viewer.user.id)),
    )


def scope_filter_clause(*, class_level_id: str | None, section: str | None, board_course_id: str | None):
    """Optional narrowing to one section/course, for the tracker's section
    picker. Each part is independent so "all my Class 5 sections" works."""
    clauses = []
    if class_level_id:
        clauses.append(Assignment.class_level_id == class_level_id)
    if section:
        clauses.append(Assignment.section == section.strip())
    if board_course_id:
        clauses.append(Assignment.board_course_id == board_course_id)
    return and_(*clauses) if clauses else true()


def current_roster_clause(viewer: Viewer):
    """Students currently sitting in one of this teacher's CURRENT sections
    (class_name matches the section's ClassLevel.code and section matches --
    the same pairing learning_service.create_assignment targets by). Not
    used for ADMIN/SUPER_ADMIN, who see the whole school anyway."""
    if not viewer.is_teacher:
        return false()
    tsa = TeacherSectionAssignment
    return exists().where(
        tsa.teacher_id == viewer.teacher.id,
        tsa.end_date.is_(None),
        tsa.school_id == Student.school_id,
        tsa.section == Student.section,
        tsa.class_level_id == ClassLevel.id,
        ClassLevel.code == Student.class_name,
    )


def visible_students_clause(viewer: Viewer):
    """Students this viewer may see a practice history for: a teacher sees
    a student who is on one of their current sections' rosters, or who was
    targeted by any assignment the teacher can read (which is how an
    outgoing teacher still reaches the students they taught -- and only
    those). Admins see their school."""
    if viewer.school_id is None:
        return true()
    school_clause = Student.school_id == viewer.school_id
    if not viewer.is_teacher:
        return school_clause
    targeted = exists().where(
        AssignmentTarget.student_id == Student.id,
        AssignmentTarget.assignment_id == Assignment.id,
        readable_assignments_clause(viewer),
    )
    return and_(school_clause, or_(current_roster_clause(viewer), targeted))


def require_visible_student(db: Session, viewer: Viewer, student_id: str) -> Student:
    student = (
        db.query(Student).filter(Student.id == student_id, visible_students_clause(viewer)).first()
    )
    if not student:
        api_error(404, "NOT_FOUND", "Student not found.")
    return student
