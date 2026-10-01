"""Practice Tracker + manual grading endpoints (1 Oct 2026).

The teacher's results workspace, rebuilt around three things the old
single-page view couldn't do:

1. Scale. Every list here pages in the database (app/core/pagination.py)
   and computes its per-row numbers with grouped aggregate queries over
   just that page's ids -- never "load every target/attempt, then count in
   Python", which is what GET /learning/assignments/{id}/targets (kept for
   compatibility, unpaginated) still does.

2. Section ownership. Every endpoint resolves the caller through
   practice_access_service, which applies teacher_assignment_service's
   current-vs-historical section windows (teacher_may_read_record /
   teacher_may_currently_act_on) to practice records. See that module's
   docstring for the exact READ / ACT rule.

3. Marking. Constructed Response (and any other non-auto-gradable) answers
   have sat in PENDING_REVIEW with no way to award them marks since Phase 3.
   GET /attempts/{id} is the review payload for one submitted attempt and
   POST /attempts/{id}/grades records a teacher's marks
   (learning_service.apply_manual_grades), audit-logged.

Relationship to routes_learning.py: that file keeps the assignment-create
and student attempt lifecycle, plus the original per-assignment
`/targets`, `/attempts/{id}/result` and `/grant-attempt` endpoints (now
scoped through the same access service). The tracker UI reads from here and
still posts re-attempt grants to routes_learning's grant endpoint, which is
the one place that action is implemented.

URL shape: everything is under /api/learning/tracker, because these are
teacher-workspace read models (summaries, progress, queues) layered over
the learning tables, not new resources of their own.
"""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, distinct, func, or_
from sqlalchemy.orm import Session, joinedload

from app.core.errors import api_error
from app.core.pagination import PageParams, like_pattern, page_envelope, page_params, paginate
from app.core.rate_limit import limiter
from app.database import get_db
from app.dependencies import require_roles
from app.models import (
    Assignment,
    AssignmentTarget,
    Attempt,
    AttemptAnswer,
    ClassLevel,
    Evaluation,
    LearningActivity,
    LearningActivityQuestion,
    Question,
    Student,
    TeacherSectionAssignment,
    User,
)
from app.services import learning_service, practice_access_service
from app.services.audit_service import log_audit_event
from app.services.practice_access_service import Viewer

router = APIRouter(prefix="/api/learning/tracker", tags=["practice-tracker"])

_FINAL_REVIEW_STATUSES = ("AUTO_FINALISED", "FINALISED")
_TARGET_STATUS_FILTERS = {
    "NOT_STARTED": "PENDING",
    "IN_PROGRESS": "IN_PROGRESS",
    "COMPLETED": "COMPLETED",
}
_ASSIGNMENT_STATUSES = ("ACTIVE", "CLOSED", "CANCELLED")


def _viewer(
    user: User = Depends(require_roles("TEACHER", "ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
) -> Viewer:
    return practice_access_service.resolve_viewer(db, user)


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def _percent(earned: int | None, possible: int | None) -> int | None:
    if not possible:
        return None
    return round(100 * (earned or 0) / possible)


# --- shared aggregate helpers (bounded by one page of ids) -------------------


def _pending_review_target_ids_query(db: Session, target_id_clause):
    """AssignmentTarget ids with at least one attempt awaiting a teacher's
    marks -- any attempt, not only the latest: an RA1 submitted after an
    unmarked original still leaves the original to mark."""
    return (
        db.query(Attempt.assignment_target_id)
        .join(Evaluation, Evaluation.attempt_id == Attempt.id)
        .filter(Evaluation.review_status == "PENDING_REVIEW", target_id_clause)
    )


def _latest_attempt_subquery(db: Session, target_id_clause):
    return (
        db.query(Attempt.assignment_target_id.label("target_id"), func.max(Attempt.attempt_number).label("n"))
        .filter(target_id_clause)
        .group_by(Attempt.assignment_target_id)
        .subquery()
    )


def _assignment_progress(db: Session, assignment_ids: list[str]) -> dict[str, dict]:
    """Per-assignment progress for one page of assignments, in four grouped
    queries total (not per row). averagePercent pools marks earned over
    marks possible across each target's LATEST attempt, counting only
    attempts whose score is final -- a PENDING_REVIEW attempt's score is
    provisional and would drag the average down until it is marked."""
    progress = {
        aid: {"targeted": 0, "notStarted": 0, "inProgress": 0, "completed": 0, "needsReview": 0, "averagePercent": None}
        for aid in assignment_ids
    }
    if not assignment_ids:
        return progress

    status_key = {"PENDING": "notStarted", "IN_PROGRESS": "inProgress", "COMPLETED": "completed"}
    for assignment_id, status, count in (
        db.query(AssignmentTarget.assignment_id, AssignmentTarget.status, func.count(AssignmentTarget.id))
        .filter(AssignmentTarget.assignment_id.in_(assignment_ids))
        .group_by(AssignmentTarget.assignment_id, AssignmentTarget.status)
        .all()
    ):
        progress[assignment_id]["targeted"] += count
        if status in status_key:
            progress[assignment_id][status_key[status]] += count

    target_in_page = AssignmentTarget.assignment_id.in_(assignment_ids)
    for assignment_id, count in (
        db.query(AssignmentTarget.assignment_id, func.count(distinct(AssignmentTarget.id)))
        .join(Attempt, Attempt.assignment_target_id == AssignmentTarget.id)
        .join(Evaluation, Evaluation.attempt_id == Attempt.id)
        .filter(target_in_page, Evaluation.review_status == "PENDING_REVIEW")
        .group_by(AssignmentTarget.assignment_id)
        .all()
    ):
        progress[assignment_id]["needsReview"] = count

    page_targets = db.query(AssignmentTarget.id).filter(target_in_page)
    latest = _latest_attempt_subquery(db, Attempt.assignment_target_id.in_(page_targets))
    for assignment_id, earned, possible in (
        db.query(AssignmentTarget.assignment_id, func.sum(Evaluation.final_score), func.sum(Evaluation.max_score))
        .join(latest, latest.c.target_id == AssignmentTarget.id)
        .join(Attempt, and_(Attempt.assignment_target_id == latest.c.target_id, Attempt.attempt_number == latest.c.n))
        .join(Evaluation, Evaluation.attempt_id == Attempt.id)
        .filter(Evaluation.review_status.in_(_FINAL_REVIEW_STATUSES), Evaluation.max_score > 0)
        .group_by(AssignmentTarget.assignment_id)
        .all()
    ):
        progress[assignment_id]["averagePercent"] = _percent(earned, possible)
    return progress


def _section_label_parts(assignment: Assignment) -> dict:
    return {
        "classLevelId": assignment.class_level_id,
        "classLevelCode": assignment.class_level.code if assignment.class_level else None,
        "section": assignment.section,
        "boardCourseId": assignment.board_course_id,
        "boardCourseName": assignment.board_course.display_name if assignment.board_course else None,
        "className": assignment.class_name,
    }


def _assignment_row(viewer: Viewer, assignment: Assignment, progress: dict, can_act: bool) -> dict:
    activity = assignment.learning_activity
    return {
        "id": assignment.id,
        "title": activity.title if activity else None,
        "activityType": activity.activity_type if activity else None,
        **_section_label_parts(assignment),
        "reason": assignment.reason,
        "dueDate": assignment.due_date,
        "createdAt": _iso(assignment.created_at),
        "status": assignment.status,
        "maxAttempts": assignment.max_attempts,
        "assignedByName": assignment.assigned_by.full_name if assignment.assigned_by else None,
        "isMine": assignment.assigned_by_user_id == viewer.user.id,
        "canAct": can_act,
        "progress": progress,
    }


def _assignment_load_options():
    return (
        joinedload(Assignment.learning_activity),
        joinedload(Assignment.class_level),
        joinedload(Assignment.board_course),
        joinedload(Assignment.assigned_by),
    )


def _apply_scope_filters(query, classLevelId, section, boardCourseId):
    return query.filter(
        practice_access_service.scope_filter_clause(
            class_level_id=classLevelId, section=section, board_course_id=boardCourseId
        )
    )


def _evaluation_dict(evaluation: Evaluation | None) -> dict | None:
    if evaluation is None:
        return None
    return {
        "attemptId": evaluation.attempt_id,
        "autoScore": evaluation.auto_score,
        "teacherScore": evaluation.teacher_score,
        "maxScore": evaluation.max_score,
        "finalScore": evaluation.final_score,
        "reviewStatus": evaluation.review_status,
        "evaluatedAt": _iso(evaluation.evaluated_at),
        "finalisedAt": _iso(evaluation.finalised_at),
    }


def _attempts_by_target(db: Session, target_ids: list[str]) -> dict[str, list[dict]]:
    """Every attempt (oldest first) with its evaluation, for a page of
    targets, in two queries. Attempts per target are bounded by
    max_attempts + bonus_attempts, so this stays small."""
    result: dict[str, list[dict]] = {tid: [] for tid in target_ids}
    if not target_ids:
        return result
    attempts = (
        db.query(Attempt)
        .filter(Attempt.assignment_target_id.in_(target_ids))
        .order_by(Attempt.assignment_target_id, Attempt.attempt_number)
        .all()
    )
    evaluations = {
        e.attempt_id: e
        for e in db.query(Evaluation).filter(Evaluation.attempt_id.in_([a.id for a in attempts])).all()
    } if attempts else {}
    for attempt in attempts:
        result[attempt.assignment_target_id].append(
            {
                "id": attempt.id,
                "attemptNumber": attempt.attempt_number,
                "status": attempt.status,
                "startedAt": _iso(attempt.started_at),
                "submittedAt": _iso(attempt.submitted_at),
                "evaluation": _evaluation_dict(evaluations.get(attempt.id)),
            }
        )
    return result


def _target_summary(target: AssignmentTarget, assignment: Assignment, attempts: list[dict], can_act: bool) -> dict:
    allowed = assignment.max_attempts + target.bonus_attempts
    has_open = any(a["status"] == "IN_PROGRESS" for a in attempts)
    needs_review = sum(
        1 for a in attempts if a["evaluation"] and a["evaluation"]["reviewStatus"] == "PENDING_REVIEW"
    )
    return {
        "assignmentTargetId": target.id,
        "status": target.status,
        "maxAttempts": assignment.max_attempts,
        "bonusAttempts": target.bonus_attempts,
        "attemptsUsed": len(attempts),
        "attemptsAllowed": allowed,
        "hasOpenAttempt": has_open,
        "needsReviewCount": needs_review,
        "attempts": attempts,
        "latestAttempt": attempts[-1] if attempts else None,
        "canGrantAttempt": can_act and len(attempts) >= allowed and not has_open,
    }


def _student_basics(student: Student) -> dict:
    return {
        "studentId": student.id,
        "studentName": student.user.full_name if student.user else None,
        "studentCode": student.student_code,
        "className": student.class_name,
        "section": student.section,
        "isActive": student.is_active,
    }


# --- overview -----------------------------------------------------------------


@router.get("/overview")
def tracker_overview(viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    """The tracker's header: every section/course the teacher holds or has
    held (for the section picker -- past ones included, since an outgoing
    teacher can still review what they set), plus headline counts. For an
    admin, `sections` is empty and the counts cover their school."""
    sections: list[dict] = []
    if viewer.is_teacher:
        rows = (
            db.query(TeacherSectionAssignment)
            .options(
                joinedload(TeacherSectionAssignment.class_level),
                joinedload(TeacherSectionAssignment.board_course),
            )
            .filter(TeacherSectionAssignment.teacher_id == viewer.teacher.id)
            .all()
        )
        grouped: dict[tuple, dict] = {}
        for row in rows:
            key = (row.class_level_id, row.section, row.board_course_id)
            entry = grouped.setdefault(
                key,
                {
                    "key": "|".join(key),
                    "classLevelId": row.class_level_id,
                    "classLevelCode": row.class_level.code if row.class_level else None,
                    "section": row.section,
                    "boardCourseId": row.board_course_id,
                    "boardCourseName": row.board_course.display_name if row.board_course else None,
                    "isCurrent": False,
                },
            )
            entry["isCurrent"] = entry["isCurrent"] or row.end_date is None

        def sort_key(entry):
            code = entry["classLevelCode"] or ""
            return (not entry["isCurrent"], int(code) if code.isdigit() else 999, entry["section"], entry["boardCourseName"] or "")

        sections = sorted(grouped.values(), key=sort_key)

    readable = practice_access_service.readable_assignments_clause(viewer)
    assignment_count = db.query(func.count(Assignment.id)).filter(readable).scalar() or 0
    active_count = (
        db.query(func.count(Assignment.id)).filter(readable, Assignment.status == "ACTIVE").scalar() or 0
    )
    needs_review = (
        db.query(func.count(Attempt.id))
        .join(Evaluation, Evaluation.attempt_id == Attempt.id)
        .join(AssignmentTarget, AssignmentTarget.id == Attempt.assignment_target_id)
        .join(Assignment, Assignment.id == AssignmentTarget.assignment_id)
        .filter(Evaluation.review_status == "PENDING_REVIEW", practice_access_service.actionable_assignments_clause(viewer))
        .scalar()
        or 0
    )
    roster = None
    if viewer.is_teacher:
        roster = (
            db.query(func.count(Student.id))
            .filter(Student.is_active.is_(True), practice_access_service.current_roster_clause(viewer))
            .scalar()
            or 0
        )
    return {
        "sections": sections,
        "counts": {
            "assignments": assignment_count,
            "activeAssignments": active_count,
            "needsReview": needs_review,
            "studentsOnRoster": roster,
        },
    }


# --- assignments ------------------------------------------------------------------


@router.get("/assignments")
def list_tracker_assignments(
    classLevelId: str | None = None,
    section: str | None = None,
    boardCourseId: str | None = None,
    status: str | None = None,
    q: str | None = None,
    params: PageParams = Depends(page_params),
    viewer: Viewer = Depends(_viewer),
    db: Session = Depends(get_db),
):
    query = (
        db.query(Assignment)
        .join(LearningActivity, LearningActivity.id == Assignment.learning_activity_id)
        .options(*_assignment_load_options())
        .filter(practice_access_service.readable_assignments_clause(viewer))
    )
    query = _apply_scope_filters(query, classLevelId, section, boardCourseId)
    if status:
        if status not in _ASSIGNMENT_STATUSES:
            api_error(422, "VALIDATION_ERROR", "Unknown assignment status filter.")
        query = query.filter(Assignment.status == status)
    if q and q.strip():
        query = query.filter(LearningActivity.title.ilike(like_pattern(q.strip()), escape="\\"))
    query = query.order_by(Assignment.created_at.desc(), Assignment.id.desc())

    assignments, total = paginate(query, params)
    progress = _assignment_progress(db, [a.id for a in assignments])
    can_act = practice_access_service.bulk_act_checker(db, viewer)
    items = [_assignment_row(viewer, a, progress[a.id], can_act(a)) for a in assignments]
    return page_envelope(items, total, params)


def _load_readable_assignment(db: Session, viewer: Viewer, assignment_id: str) -> Assignment:
    assignment = (
        db.query(Assignment).options(*_assignment_load_options()).filter(Assignment.id == assignment_id).first()
    )
    return practice_access_service.require_readable_assignment(db, viewer, assignment)


@router.get("/assignments/{assignment_id}")
def get_tracker_assignment(assignment_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    assignment = _load_readable_assignment(db, viewer, assignment_id)
    progress = _assignment_progress(db, [assignment.id])[assignment.id]
    row = _assignment_row(
        viewer, assignment, progress, practice_access_service.can_act_on_assignment(db, viewer, assignment)
    )
    activity = assignment.learning_activity
    row["questionCount"] = (
        db.query(func.count(LearningActivityQuestion.id))
        .filter(LearningActivityQuestion.learning_activity_id == activity.id)
        .scalar()
        if activity
        else 0
    )
    row["availableFrom"] = assignment.available_from
    row["pacingMode"] = assignment.pacing_mode
    return row


@router.get("/assignments/{assignment_id}/students")
def list_assignment_students(
    assignment_id: str,
    status: str | None = None,
    q: str | None = None,
    params: PageParams = Depends(page_params),
    viewer: Viewer = Depends(_viewer),
    db: Session = Depends(get_db),
):
    """One assignment's students, paged -- the paginated successor to
    routes_learning's GET /assignments/{id}/targets. `status` is one of
    NOT_STARTED / IN_PROGRESS / COMPLETED / NEEDS_REVIEW; `counts` (for the
    filter chips) always covers the whole assignment, not just this page."""
    assignment = _load_readable_assignment(db, viewer, assignment_id)
    can_act = practice_access_service.can_act_on_assignment(db, viewer, assignment)

    in_assignment = AssignmentTarget.assignment_id == assignment.id
    pending_targets = _pending_review_target_ids_query(
        db, Attempt.assignment_target_id.in_(db.query(AssignmentTarget.id).filter(in_assignment))
    )

    query = (
        db.query(AssignmentTarget, Student, User)
        .join(Student, Student.id == AssignmentTarget.student_id)
        .join(User, User.id == Student.user_id)
        .filter(in_assignment)
    )
    if status:
        if status == "NEEDS_REVIEW":
            query = query.filter(AssignmentTarget.id.in_(pending_targets))
        elif status in _TARGET_STATUS_FILTERS:
            query = query.filter(AssignmentTarget.status == _TARGET_STATUS_FILTERS[status])
        else:
            api_error(422, "VALIDATION_ERROR", "Unknown student status filter.")
    if q and q.strip():
        pattern = like_pattern(q.strip())
        query = query.filter(
            or_(User.full_name.ilike(pattern, escape="\\"), Student.student_code.ilike(pattern, escape="\\"))
        )
    query = query.order_by(func.lower(User.full_name), Student.student_code, AssignmentTarget.id)

    rows, total = paginate(query, params)
    attempts = _attempts_by_target(db, [target.id for target, _, _ in rows])
    items = [
        {**_student_basics(student), **_target_summary(target, assignment, attempts[target.id], can_act)}
        for target, student, _ in rows
    ]

    by_status = dict(
        db.query(AssignmentTarget.status, func.count(AssignmentTarget.id))
        .filter(in_assignment)
        .group_by(AssignmentTarget.status)
        .all()
    )
    counts = {
        "all": sum(by_status.values()),
        "notStarted": by_status.get("PENDING", 0),
        "inProgress": by_status.get("IN_PROGRESS", 0),
        "completed": by_status.get("COMPLETED", 0),
        "needsReview": db.query(func.count(distinct(Attempt.assignment_target_id)))
        .join(Evaluation, Evaluation.attempt_id == Attempt.id)
        .join(AssignmentTarget, AssignmentTarget.id == Attempt.assignment_target_id)
        .filter(in_assignment, Evaluation.review_status == "PENDING_REVIEW")
        .scalar()
        or 0,
    }
    return page_envelope(items, total, params, counts=counts, canAct=can_act)


# --- students -------------------------------------------------------------------


def _student_stats(db: Session, viewer: Viewer, student_ids: list[str], scope_clause) -> dict[str, dict]:
    """Per-student practice numbers over the assignments this viewer can
    read (and, if the tracker is narrowed to one section, only that
    section's) -- so an outgoing teacher's view of a student is limited to
    what was set on their watch, exactly like the assignment list."""
    stats = {
        sid: {"assigned": 0, "completed": 0, "needsReview": 0, "averagePercent": None, "lastSubmittedAt": None}
        for sid in student_ids
    }
    if not student_ids:
        return stats
    visible_targets = (
        db.query(AssignmentTarget.id)
        .join(Assignment, Assignment.id == AssignmentTarget.assignment_id)
        .filter(
            AssignmentTarget.student_id.in_(student_ids),
            practice_access_service.readable_assignments_clause(viewer),
            scope_clause,
        )
    )
    target_in_scope = AssignmentTarget.id.in_(visible_targets)

    for student_id, assigned, completed in (
        db.query(
            AssignmentTarget.student_id,
            func.count(AssignmentTarget.id),
            func.sum(case((AssignmentTarget.status == "COMPLETED", 1), else_=0)),
        )
        .filter(target_in_scope)
        .group_by(AssignmentTarget.student_id)
        .all()
    ):
        stats[student_id]["assigned"] = assigned
        stats[student_id]["completed"] = int(completed or 0)

    for student_id, count, last_submitted in (
        db.query(
            AssignmentTarget.student_id,
            func.count(distinct(case((Evaluation.review_status == "PENDING_REVIEW", AssignmentTarget.id)))),
            func.max(Attempt.submitted_at),
        )
        .join(Attempt, Attempt.assignment_target_id == AssignmentTarget.id)
        .outerjoin(Evaluation, Evaluation.attempt_id == Attempt.id)
        .filter(target_in_scope)
        .group_by(AssignmentTarget.student_id)
        .all()
    ):
        stats[student_id]["needsReview"] = count or 0
        # func.max keeps the column's DateTime type, so this is normally a
        # datetime; tolerate a raw string from a driver that doesn't coerce.
        stats[student_id]["lastSubmittedAt"] = _iso(last_submitted) if hasattr(last_submitted, "isoformat") else last_submitted

    latest = _latest_attempt_subquery(db, Attempt.assignment_target_id.in_(visible_targets))
    for student_id, earned, possible in (
        db.query(AssignmentTarget.student_id, func.sum(Evaluation.final_score), func.sum(Evaluation.max_score))
        .join(latest, latest.c.target_id == AssignmentTarget.id)
        .join(Attempt, and_(Attempt.assignment_target_id == latest.c.target_id, Attempt.attempt_number == latest.c.n))
        .join(Evaluation, Evaluation.attempt_id == Attempt.id)
        .filter(Evaluation.review_status.in_(_FINAL_REVIEW_STATUSES), Evaluation.max_score > 0)
        .group_by(AssignmentTarget.student_id)
        .all()
    ):
        stats[student_id]["averagePercent"] = _percent(earned, possible)
    return stats


def _assignment_scope_clause(classLevelId, section, boardCourseId):
    return practice_access_service.scope_filter_clause(
        class_level_id=classLevelId, section=section, board_course_id=boardCourseId
    )


@router.get("/students")
def list_tracker_students(
    classLevelId: str | None = None,
    section: str | None = None,
    boardCourseId: str | None = None,
    q: str | None = None,
    params: PageParams = Depends(page_params),
    viewer: Viewer = Depends(_viewer),
    db: Session = Depends(get_db),
):
    """Students, paged, with their practice numbers. Narrowed to one
    section when classLevelId + section are given: a student counts as "in"
    a section if they sit in it today (class + section on their roster
    row), or if an assignment set for that section that this viewer can
    read targeted them -- the second half is how a teacher still finds a
    student who has since moved section, or (after a handover) the
    students they taught, without seeing anyone newer."""
    scope_clause = _assignment_scope_clause(classLevelId, section, boardCourseId)
    query = (
        db.query(Student, User)
        .join(User, User.id == Student.user_id)
        .filter(practice_access_service.visible_students_clause(viewer))
    )
    if classLevelId and section:
        class_level = db.get(ClassLevel, classLevelId)
        on_roster = and_(
            Student.class_name == (class_level.code if class_level else None),
            Student.section == section.strip(),
        )
        targeted_in_scope = Student.id.in_(
            db.query(AssignmentTarget.student_id)
            .join(Assignment, Assignment.id == AssignmentTarget.assignment_id)
            .filter(practice_access_service.readable_assignments_clause(viewer), scope_clause)
        )
        query = query.filter(or_(on_roster, targeted_in_scope))
    if q and q.strip():
        pattern = like_pattern(q.strip())
        query = query.filter(
            or_(User.full_name.ilike(pattern, escape="\\"), Student.student_code.ilike(pattern, escape="\\"))
        )
    query = query.order_by(func.lower(User.full_name), Student.student_code, Student.id)

    rows, total = paginate(query, params)
    stats = _student_stats(db, viewer, [student.id for student, _ in rows], scope_clause)
    items = [{**_student_basics(student), "stats": stats[student.id]} for student, _ in rows]
    return page_envelope(items, total, params)


@router.get("/students/{student_id}")
def get_tracker_student(
    student_id: str,
    classLevelId: str | None = None,
    section: str | None = None,
    boardCourseId: str | None = None,
    params: PageParams = Depends(page_params),
    viewer: Viewer = Depends(_viewer),
    db: Session = Depends(get_db),
):
    """One student's practice history, newest assignment first, paged --
    every assignment this viewer can read that targeted them, each with its
    full attempt history. 404 for a student the viewer has no business
    seeing (see practice_access_service.visible_students_clause)."""
    student = practice_access_service.require_visible_student(db, viewer, student_id)
    scope_clause = _assignment_scope_clause(classLevelId, section, boardCourseId)

    query = (
        db.query(AssignmentTarget, Assignment)
        .join(Assignment, Assignment.id == AssignmentTarget.assignment_id)
        .options(*_assignment_load_options())
        .filter(
            AssignmentTarget.student_id == student.id,
            practice_access_service.readable_assignments_clause(viewer),
            scope_clause,
        )
        .order_by(Assignment.created_at.desc(), Assignment.id.desc())
    )
    rows, total = paginate(query, params)
    attempts = _attempts_by_target(db, [target.id for target, _ in rows])
    act_checker = practice_access_service.bulk_act_checker(db, viewer)
    items = []
    for target, assignment in rows:
        can_act = act_checker(assignment)
        activity = assignment.learning_activity
        items.append(
            {
                "assignment": {
                    "id": assignment.id,
                    "title": activity.title if activity else None,
                    "activityType": activity.activity_type if activity else None,
                    **_section_label_parts(assignment),
                    "dueDate": assignment.due_date,
                    "createdAt": _iso(assignment.created_at),
                    "status": assignment.status,
                    "canAct": can_act,
                },
                **_target_summary(target, assignment, attempts[target.id], can_act),
            }
        )
    stats = _student_stats(db, viewer, [student.id], scope_clause)[student.id]
    return page_envelope(items, total, params, student={**_student_basics(student), "stats": stats})


# --- review queue -----------------------------------------------------------------


def _answers_to_mark_counts(db: Session, attempt_ids: list[str]) -> dict[str, tuple[int, int]]:
    """attempt id -> (answers still needing a mark, answers already marked
    by hand), for a page of attempts, in one grouped query."""
    counts = {aid: (0, 0) for aid in attempt_ids}
    if not attempt_ids:
        return counts
    for attempt_id, unmarked, marked in (
        db.query(
            AttemptAnswer.attempt_id,
            func.sum(case((AttemptAnswer.manual_score.is_(None), 1), else_=0)),
            func.sum(case((AttemptAnswer.manual_score.isnot(None), 1), else_=0)),
        )
        .filter(AttemptAnswer.attempt_id.in_(attempt_ids), AttemptAnswer.auto_score.is_(None))
        .group_by(AttemptAnswer.attempt_id)
        .all()
    ):
        counts[attempt_id] = (int(unmarked or 0), int(marked or 0))
    return counts


@router.get("/review-queue")
def list_review_queue(
    classLevelId: str | None = None,
    section: str | None = None,
    boardCourseId: str | None = None,
    params: PageParams = Depends(page_params),
    viewer: Viewer = Depends(_viewer),
    db: Session = Depends(get_db),
):
    """Submitted attempts waiting for a teacher's marks, oldest submission
    first (first in, first marked). Lists only attempts this viewer can
    actually mark -- for a teacher, those on assignments for sections they
    currently teach (practice_access_service.actionable_assignments_clause);
    read-only, handed-over ones stay visible on their assignment's page."""
    query = (
        db.query(Attempt, Evaluation, AssignmentTarget, Assignment, Student, User)
        .join(Evaluation, Evaluation.attempt_id == Attempt.id)
        .join(AssignmentTarget, AssignmentTarget.id == Attempt.assignment_target_id)
        .join(Assignment, Assignment.id == AssignmentTarget.assignment_id)
        .join(Student, Student.id == AssignmentTarget.student_id)
        .join(User, User.id == Student.user_id)
        .options(*_assignment_load_options())
        .filter(
            Evaluation.review_status == "PENDING_REVIEW",
            practice_access_service.actionable_assignments_clause(viewer),
            _assignment_scope_clause(classLevelId, section, boardCourseId),
        )
        .order_by(Attempt.submitted_at.asc(), Attempt.id.asc())
    )
    rows, total = paginate(query, params)
    marking = _answers_to_mark_counts(db, [attempt.id for attempt, *_ in rows])
    items = []
    for attempt, evaluation, target, assignment, student, _ in rows:
        unmarked, marked = marking[attempt.id]
        activity = assignment.learning_activity
        items.append(
            {
                "attemptId": attempt.id,
                "attemptNumber": attempt.attempt_number,
                "submittedAt": _iso(attempt.submitted_at),
                "answersToMark": unmarked,
                "answersMarked": marked,
                "evaluation": _evaluation_dict(evaluation),
                "assignment": {
                    "id": assignment.id,
                    "title": activity.title if activity else None,
                    "activityType": activity.activity_type if activity else None,
                    **_section_label_parts(assignment),
                },
                **_student_basics(student),
            }
        )
    return page_envelope(items, total, params)


# --- one attempt: review + manual grading -----------------------------------------


def _load_attempt_for_viewer(db: Session, viewer: Viewer, attempt_id: str) -> tuple[Attempt, Assignment]:
    attempt = db.get(Attempt, attempt_id)
    if not attempt:
        api_error(404, "NOT_FOUND", "Attempt not found.")
    assignment = attempt.assignment_target.assignment
    if not practice_access_service.can_read_assignment(db, viewer, assignment):
        api_error(404, "NOT_FOUND", "Attempt not found.")
    return attempt, assignment


def _attempt_review_payload(db: Session, viewer: Viewer, attempt: Attempt, assignment: Assignment) -> dict:
    evaluation = db.query(Evaluation).filter(Evaluation.attempt_id == attempt.id).first()
    if not evaluation:
        api_error(422, "NOT_SUBMITTED", "This attempt has not been submitted yet.")
    target = attempt.assignment_target
    student = target.student
    activity = assignment.learning_activity
    can_grade = practice_access_service.can_act_on_assignment(db, viewer, assignment)

    sequence = {
        question_id: seq
        for question_id, seq in db.query(LearningActivityQuestion.question_id, LearningActivityQuestion.sequence)
        .filter(LearningActivityQuestion.learning_activity_id == assignment.learning_activity_id)
        .all()
    }
    answer_rows = (
        db.query(AttemptAnswer, Question)
        .join(Question, Question.id == AttemptAnswer.question_id)
        .options(joinedload(AttemptAnswer.graded_by))
        .filter(AttemptAnswer.attempt_id == attempt.id)
        .all()
    )
    answer_rows.sort(key=lambda row: (sequence.get(row[1].id, 10_000), row[1].code))
    answers = [
        {
            "questionId": question.id,
            "questionCode": question.code,
            "questionType": question.question_type,
            "stem": question.stem,
            "options": {
                letter: text
                for letter, text in (
                    ("A", question.option_a),
                    ("B", question.option_b),
                    ("C", question.option_c),
                    ("D", question.option_d),
                )
                if text
            },
            "responseText": answer.response_text,
            "isCorrect": answer.is_correct,
            "autoScore": answer.auto_score,
            "manualScore": answer.manual_score,
            "maxScore": answer.max_score,
            "needsManualGrade": learning_service.needs_manual_grade(answer),
            "correctAnswer": question.correct_answer,
            "explanation": question.explanation,
            "teacherNote": question.teacher_note,
            "gradedByName": answer.graded_by.full_name if answer.graded_by else None,
            "gradedAt": _iso(answer.graded_at),
        }
        for answer, question in answer_rows
    ]
    history = _attempts_by_target(db, [target.id])[target.id]
    return {
        "attempt": {
            "id": attempt.id,
            "attemptNumber": attempt.attempt_number,
            "status": attempt.status,
            "startedAt": _iso(attempt.started_at),
            "submittedAt": _iso(attempt.submitted_at),
            "timeSpentSeconds": attempt.time_spent_seconds,
        },
        "evaluation": {
            **_evaluation_dict(evaluation),
            "finalisedByName": evaluation.finalised_by.full_name if evaluation.finalised_by else None,
        },
        "student": _student_basics(student),
        "assignment": {
            "id": assignment.id,
            "title": activity.title if activity else None,
            "activityType": activity.activity_type if activity else None,
            **_section_label_parts(assignment),
            "status": assignment.status,
        },
        "target": _target_summary(target, assignment, history, can_grade),
        "canGrade": can_grade,
        "answers": answers,
    }


@router.get("/attempts/{attempt_id}")
def get_attempt_review(attempt_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    attempt, assignment = _load_attempt_for_viewer(db, viewer, attempt_id)
    return _attempt_review_payload(db, viewer, attempt, assignment)


class ManualGrade(BaseModel):
    questionId: str
    score: int


class SubmitGradesRequest(BaseModel):
    grades: list[ManualGrade] = Field(min_length=1, max_length=200)


@router.post("/attempts/{attempt_id}/grades")
@limiter.limit("60/minute")
def submit_manual_grades(
    request: Request,
    attempt_id: str,
    payload: SubmitGradesRequest,
    viewer: Viewer = Depends(_viewer),
    db: Session = Depends(get_db),
):
    """Award marks to the answers auto-marking couldn't score. Only the
    section's current teacher (or an admin) may mark -- a since-transferred
    teacher gets 403 even though they can still read the attempt. Partial
    marking is allowed; the attempt is FINALISED once its last unmarked
    answer has a mark. See learning_service.apply_manual_grades for the
    validation and rollup rules."""
    attempt, assignment = _load_attempt_for_viewer(db, viewer, attempt_id)
    practice_access_service.require_actionable_assignment(db, viewer, assignment)

    grades: dict[str, int] = {}
    for grade in payload.grades:
        if grade.questionId in grades:
            api_error(422, "VALIDATION_ERROR", "Each question can only be marked once per request.")
        grades[grade.questionId] = grade.score

    previous_status = (
        db.query(Evaluation.review_status).filter(Evaluation.attempt_id == attempt.id).scalar()
    )
    evaluation, changes = learning_service.apply_manual_grades(
        db, attempt=attempt, grades=grades, grader_user_id=viewer.user.id
    )
    log_audit_event(
        db,
        "learning.attempt.manually_graded",
        user_id=viewer.user.id,
        request=request,
        details={
            "attemptId": attempt.id,
            "assignmentId": assignment.id,
            "assignmentTargetId": attempt.assignment_target_id,
            "studentId": attempt.assignment_target.student_id,
            "grades": changes,
            "autoScore": evaluation.auto_score,
            "teacherScore": evaluation.teacher_score,
            "finalScore": evaluation.final_score,
            "maxScore": evaluation.max_score,
            "reviewStatusBefore": previous_status,
            "reviewStatusAfter": evaluation.review_status,
        },
    )
    db.commit()
    db.refresh(attempt)
    return _attempt_review_payload(db, viewer, attempt, assignment)
