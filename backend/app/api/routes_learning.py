"""Phase 3 (Five-day learning loop) endpoints: turning Phase 2 curriculum
content into deliverable activities, teachers assigning them, and the
student attempt -> auto-mark -> result lifecycle (blueprint Section 12's
suggested API surface, adapted to this repo's `/api/{noun}` convention --
see routes_roster.py/routes_curriculum_admin.py for the existing pattern
this file follows).

Scope note: this is the backend half of Phase 3's first vertical slice.
Frontend pages (student "Today's Practice", teacher "Assign"/"Review") are
deliberately NOT built in this pass -- see the Phase 3 kickoff changelog
entry in PROJECT_REFERENCE.md for why (stable backend contract first,
matching the roadmap's own backend-architect-then-frontend-architect
sequencing for this phase).

Authorization model:
- Activity generation/publishing is SUPER_ADMIN-only, matching Curriculum
  Studio's own "chapter/concept/question status transitions are
  SUPER_ADMIN-only" precedent (routes_curriculum_admin.py) -- a
  LearningActivity is master content derived from master content.
- Assignment creation is TEACHER or ADMIN/SUPER_ADMIN. A TEACHER is always
  scoped to their own school (Teacher.school_id) and, since 30 Sep 2026, to
  a section + course they currently own per TeacherSectionAssignment (see
  create_assignment); ADMIN the same way routes_roster.py's _resolve_school
  works, SUPER_ADMIN must pass schoolId.
- The attempt lifecycle (start/save/submit/result) is STUDENT-only, always
  scoped to attempts the authenticated student's own AssignmentTarget rows
  own -- see learning_service._get_owned_target/_get_owned_attempt, which
  return 404 (never 403) for anything outside that scope, matching this
  codebase's "don't disclose another student's resource exists" rule.
- Foundation Repair is TEACHER/ADMIN-only (Section 11: recommendations stay
  under teacher control). Since 1 Oct 2026 (A11 completeness pass) a
  TEACHER must also be the CURRENT teacher of the student's own section for
  the concept's course, on both the recommendation read and the approve
  write -- see _require_teacher_currently_teaches_student.
- Reading an existing assignment's results (targets, attempt results) and
  granting an extra attempt go through practice_access_service (1 Oct
  2026): a TEACHER reads what they created or what was set for a section
  they teach/taught inside their own window, and may only change it while
  they are that section's current teacher. The Practice Tracker's paginated
  views and manual grading live in routes_practice_tracker.py.
"""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.core.rate_limit import limiter
from app.database import get_db
from app.dependencies import get_current_student, get_current_teacher, require_roles
from app.models import (
    ASSIGNMENT_REASONS,
    Assignment,
    AssignmentTarget,
    Attempt,
    AttemptAnswer,
    Chapter,
    ClassLevel,
    ConceptLesson,
    Evaluation,
    LearningActivity,
    LearningActivityQuestion,
    Question,
    School,
    SchoolAdmin,
    Student,
    Teacher,
    User,
)
from app.services import (
    foundation_repair_service,
    learning_service,
    practice_access_service,
    teacher_assignment_service,
)
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/api/learning", tags=["learning"])


# --- shared helpers (self-contained per this codebase's existing convention
# of not cross-importing between route files, see routes_roster.py) --------


def _resolve_school(db: Session, user: User, requested_school_id: str | None) -> School:
    if user.role == "SUPER_ADMIN":
        if not requested_school_id:
            api_error(422, "VALIDATION_ERROR", "schoolId is required for SUPER_ADMIN.")
        school = db.get(School, requested_school_id)
        if not school:
            api_error(404, "NOT_FOUND", "School not found.")
        return school

    school_admin = db.query(SchoolAdmin).filter(SchoolAdmin.user_id == user.id).first()
    if not school_admin:
        api_error(403, "FORBIDDEN", "No school is associated with this admin account.")
    if requested_school_id and requested_school_id != school_admin.school_id:
        api_error(403, "FORBIDDEN", "You can only manage your own school.")
    return db.get(School, school_admin.school_id)


def _question_public_dict(question: Question) -> dict:
    """Question fields safe to send to a student mid-attempt -- never
    correct_answer, accepted_variants, explanation, hint or
    misconception_tag while an attempt is IN_PROGRESS."""
    return {
        "id": question.id,
        "code": question.code,
        "questionType": question.question_type,
        "stem": question.stem,
        "optionA": question.option_a,
        "optionB": question.option_b,
        "optionC": question.option_c,
        "optionD": question.option_d,
        "marks": question.marks,
        "timeSeconds": question.time_seconds,
        "responseFormat": question.response_format,
    }


def _activity_dict(activity: LearningActivity) -> dict:
    return {
        "id": activity.id,
        "chapterId": activity.chapter_id,
        "conceptLessonId": activity.concept_lesson_id,
        "activityType": activity.activity_type,
        "title": activity.title,
        "sequence": activity.sequence,
        "pacingDay": activity.pacing_day,
        "evaluationMode": activity.evaluation_mode,
        "isRequired": activity.is_required,
        "estimatedMinutes": activity.estimated_minutes,
        "status": activity.status,
        "sourceAssignmentCode": activity.source_assignment_code,
    }


# --- activity generation / publishing (SUPER_ADMIN) ------------------------


class GenerateActivitiesRequest(BaseModel):
    chapterId: str


@router.post("/activities/generate")
@limiter.limit("10/minute")
def generate_activities(
    request: Request,
    payload: GenerateActivitiesRequest,
    user: User = Depends(require_roles("SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    chapter = db.get(Chapter, payload.chapterId)
    if not chapter:
        api_error(404, "NOT_FOUND", "Chapter not found.")
    created = learning_service.generate_activities_for_chapter(db, chapter, user.id)
    return {"chapterId": chapter.id, "createdCount": len(created), "activities": [_activity_dict(a) for a in created]}


@router.get("/activities")
def list_activities(
    chapterId: str,
    conceptLessonId: str | None = None,
    _: User = Depends(require_roles("ADMIN", "SUPER_ADMIN", "TEACHER")),
    db: Session = Depends(get_db),
):
    q = db.query(LearningActivity).filter(LearningActivity.chapter_id == chapterId)
    if conceptLessonId:
        q = q.filter(LearningActivity.concept_lesson_id == conceptLessonId)
    activities = q.order_by(LearningActivity.sequence).all()
    return {"activities": [_activity_dict(a) for a in activities]}


@router.post("/activities/{activity_id}/publish")
@limiter.limit("30/minute")
def publish_activity(
    request: Request,
    activity_id: str,
    _: User = Depends(require_roles("SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    activity = db.get(LearningActivity, activity_id)
    if not activity:
        api_error(404, "NOT_FOUND", "Learning activity not found.")
    if not db.query(LearningActivityQuestion).filter(LearningActivityQuestion.learning_activity_id == activity.id).first():
        api_error(422, "VALIDATION_ERROR", "This activity has no questions linked yet.")
    activity.status = "PUBLISHED"
    db.commit()
    return _activity_dict(activity)


# --- assignments (TEACHER / ADMIN / SUPER_ADMIN) ---------------------------


class CreateAssignmentRequest(BaseModel):
    learningActivityId: str
    schoolId: str | None = None  # required for SUPER_ADMIN, ignored for TEACHER/ADMIN
    className: str | None = None
    # Optional (30 Sep 2026): narrows a className target to one section,
    # matched against Student.section. Omit it to target every section of
    # the class, exactly as before -- see learning_service.create_assignment.
    # Required for a TEACHER (30 Sep 2026, section-ownership check in
    # create_assignment below); still optional for ADMIN/SUPER_ADMIN.
    section: str | None = None
    studentIds: list[str] | None = None
    reason: str = "SCHEDULED"
    pacingMode: str = "FIVE_DAY"
    dueDate: str | None = None
    availableFrom: str | None = None
    maxAttempts: int = 3


def _assignment_dict(assignment: Assignment, target_count: int) -> dict:
    return {
        "id": assignment.id,
        "schoolId": assignment.school_id,
        "learningActivityId": assignment.learning_activity_id,
        # Added 20 Aug 2026 for the teacher "My Assignments" list -- avoids a
        # second round-trip per row just to show what was actually assigned.
        "learningActivityTitle": assignment.learning_activity.title if assignment.learning_activity else None,
        "learningActivityType": assignment.learning_activity.activity_type if assignment.learning_activity else None,
        "className": assignment.class_name,
        # 1 Oct 2026: the section scope now stored on the row (None for a
        # whole-class or single-student assignment) -- see Assignment.section.
        "section": assignment.section,
        "classLevelId": assignment.class_level_id,
        "boardCourseId": assignment.board_course_id,
        "reason": assignment.reason,
        "pacingMode": assignment.pacing_mode,
        "dueDate": assignment.due_date,
        "availableFrom": assignment.available_from,
        "maxAttempts": assignment.max_attempts,
        "status": assignment.status,
        "targetCount": target_count,
        "createdAt": assignment.created_at.isoformat() if assignment.created_at else None,
    }


@router.post("/assignments")
@limiter.limit("30/minute")
def create_assignment(
    request: Request,
    payload: CreateAssignmentRequest,
    user: User = Depends(require_roles("TEACHER", "ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    if payload.reason not in ASSIGNMENT_REASONS:
        api_error(422, "VALIDATION_ERROR", "Invalid reason.")

    if user.role == "TEACHER":
        teacher = db.query(Teacher).filter(Teacher.user_id == user.id).first()
        if not teacher or not teacher.is_active:
            api_error(403, "FORBIDDEN", "Teacher profile not found or inactive.")
        school = db.get(School, teacher.school_id)
        assigned_by = user.id
    else:
        school = _resolve_school(db, user, payload.schoolId)
        assigned_by = user.id

    activity = db.get(LearningActivity, payload.learningActivityId)
    if not activity:
        api_error(404, "NOT_FOUND", "Learning activity not found.")

    if user.role == "TEACHER":
        # 30 Sep 2026: studentIds bypasses class_name/section entirely
        # (learning_service.create_assignment only reads class_name/section
        # when student_ids is empty), so a TEACHER naming one of their own
        # owned sections below while also sending studentIds would pass the
        # section-ownership check just added and still land on whichever
        # students they named -- any active student at the school, not just
        # their own section. No frontend page ever sends studentIds (grep),
        # so closing it here costs nothing real today. ADMIN/SUPER_ADMIN are
        # untouched -- targeted-student assignment stays available to them.
        if payload.studentIds:
            api_error(422, "VALIDATION_ERROR", "Assign by class and section, not by naming students directly.")
        # Section ownership (30 Sep 2026). Until now a TEACHER could POST any
        # className/section at their school -- the only check above is
        # Teacher.school_id -- and the "only your own sections" rule lived
        # entirely in the frontend picker (teacher/assignments/page.tsx only
        # ever offers GET /teacher-assignments/my-sections rows). The server
        # side check has existed since 20 Aug 2026 as
        # teacher_assignment_service.teacher_may_currently_act_on, whose own
        # module docstring says it "gates WRITE actions (assign practice,
        # ...)" -- but nothing ever called it (grep: its only callers were
        # test_teacher_assignments.py). This is that call.
        #
        # A section is mandatory for a TEACHER: TeacherSectionAssignment rows
        # are per (class_level, section, board_course), so "every section of
        # Class 5" is not something any single teacher is ever recorded as
        # owning, and the picker always sends exactly one section anyway.
        # Stripped the same way assign_teacher_to_section stores
        # TeacherSectionAssignment.section and learning_service.create_assignment
        # matches Student.section, so " A" can't slip past the lookup.
        # ADMIN/SUPER_ADMIN are deliberately untouched (no section required,
        # no ownership check) -- see teacher_assignment_service's module
        # docstring: they bypass both of its access checks at the route layer.
        section = (payload.section or "").strip()
        if not section:
            api_error(422, "VALIDATION_ERROR", "Choose a section to assign to.")
        # className is the ClassLevel code ("5"), which is what the picker
        # sends (TeacherSection.classLevelCode, see routes_teacher_assignments
        # _assignment_dict) and what routes_roster.py stores in
        # Student.class_name.
        class_level = db.query(ClassLevel).filter(ClassLevel.code == payload.className).first()
        if not class_level:
            api_error(422, "VALIDATION_ERROR", "Unknown class.")
        # The subject being assigned comes from the activity's own chapter
        # (Chapter.board_course_id, never nullable -- curriculum.py), not
        # from anything the client sends, so a teacher can't claim a course
        # they own to push another course's content into the same section.
        chapter = db.get(Chapter, activity.chapter_id)
        if not chapter or not teacher_assignment_service.teacher_may_currently_act_on(
            db,
            teacher_id=teacher.id,
            class_level_id=class_level.id,
            section=section,
            board_course_id=chapter.board_course_id,
        ):
            api_error(403, "FORBIDDEN", "You are not currently assigned to teach this class, section and course.")

    assignment = learning_service.create_assignment(
        db,
        school=school,
        learning_activity=activity,
        assigned_by_user_id=assigned_by,
        class_name=payload.className,
        section=payload.section,
        student_ids=payload.studentIds,
        reason=payload.reason,
        pacing_mode=payload.pacingMode,
        due_date=payload.dueDate,
        available_from=payload.availableFrom,
        max_attempts=payload.maxAttempts,
    )
    target_count = db.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).count()
    return _assignment_dict(assignment, target_count)


def _latest_attempt_summary(db: Session, assignment_target_id: str) -> dict | None:
    """Small addition for the Phase 3 frontend (20 Aug 2026): the student
    "Today's Practice" list needs to know, per assignment, whether to show
    Start / Continue / View Result without a second round-trip per row --
    this mirrors start_attempt's own "most recent attempt wins" ordering."""
    attempt = (
        db.query(Attempt)
        .filter(Attempt.assignment_target_id == assignment_target_id)
        .order_by(Attempt.attempt_number.desc())
        .first()
    )
    if not attempt:
        return None
    evaluation = db.query(Evaluation).filter(Evaluation.attempt_id == attempt.id).first()
    return {
        "id": attempt.id,
        "attemptNumber": attempt.attempt_number,
        "status": attempt.status,
        "evaluation": _evaluation_dict(evaluation) if evaluation else None,
    }


def _attempt_history(db: Session, assignment_target_id: str) -> list[dict]:
    """Every attempt on this target, oldest first -- the teacher review
    surface (20 Aug 2026) needs the full history, not just the latest one,
    so a teacher deciding whether to approve a re-attempt can see how the
    earlier ones went too."""
    attempts = (
        db.query(Attempt)
        .filter(Attempt.assignment_target_id == assignment_target_id)
        .order_by(Attempt.attempt_number.asc())
        .all()
    )
    rows = []
    for attempt in attempts:
        evaluation = db.query(Evaluation).filter(Evaluation.attempt_id == attempt.id).first()
        rows.append(
            {
                "id": attempt.id,
                "attemptNumber": attempt.attempt_number,
                "status": attempt.status,
                "evaluation": _evaluation_dict(evaluation) if evaluation else None,
            }
        )
    return rows


@router.get("/assignments")
def list_assignments(
    user: User = Depends(require_roles("TEACHER", "STUDENT", "ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    if user.role == "STUDENT":
        student_row = db.query(Student).filter(Student.user_id == user.id).first()
        if not student_row:
            api_error(404, "NOT_FOUND", "Student profile not found.")
        targets = db.query(AssignmentTarget).filter(AssignmentTarget.student_id == student_row.id).all()
        results = []
        for target in targets:
            assignment = target.assignment
            # 30 Sep 2026, defensive: a CANCELLED assignment is withdrawn, not
            # merely finished, so it must never appear on a student's list at
            # all. Unreachable today -- learning_service.create_assignment is
            # the only place an Assignment row is ever built, it never sets
            # status, and no route or service assigns Assignment.status
            # anywhere (grep), so every row is still the model's ACTIVE
            # default -- but closed here before a cancel/close route exists
            # rather than after. CLOSED stays visible on purpose: reviewing
            # past work is fine, and start_attempt already refuses a fresh
            # attempt on any non-ACTIVE assignment (ASSIGNMENT_CLOSED).
            if assignment.status == "CANCELLED":
                continue
            activity = assignment.learning_activity
            results.append(
                {
                    "assignmentTargetId": target.id,
                    "assignmentId": assignment.id,
                    "status": target.status,
                    "learningActivity": _activity_dict(activity),
                    "dueDate": assignment.due_date,
                    "reason": assignment.reason,
                    "maxAttempts": assignment.max_attempts,
                    # 30 Sep 2026: this student's own teacher-granted extra
                    # attempts (grant_extra_attempt). Without it the student
                    # UI computed "Attempt X of Y" and whether to offer Try
                    # Again against max_attempts alone -- a lower ceiling
                    # than start_attempt actually enforces
                    # (max_attempts + bonus_attempts), so a granted retry
                    # stayed invisible. The teacher-facing
                    # list_assignment_targets rows have carried this since
                    # 20 Aug 2026.
                    "bonusAttempts": target.bonus_attempts,
                    "latestAttempt": _latest_attempt_summary(db, target.id),
                }
            )
        return {"assignments": results}

    if user.role == "TEACHER":
        assignments = db.query(Assignment).filter(Assignment.assigned_by_user_id == user.id).all()
    else:
        school = _resolve_school(db, user, None) if user.role == "ADMIN" else None
        q = db.query(Assignment)
        if school is not None:
            q = q.filter(Assignment.school_id == school.id)
        assignments = q.all()

    return {
        "assignments": [
            _assignment_dict(a, db.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == a.id).count())
            for a in assignments
        ]
    }


def _check_assignment_scope(db: Session, user: User, assignment: Assignment) -> None:
    """Raises 404 (never 403) if `user` (TEACHER/ADMIN/SUPER_ADMIN) may not
    read `assignment`. Matches this file's existing "don't disclose another
    school's/teacher's resource exists" rule (see module docstring).
    Factored out 20 Aug 2026 so get_attempt_result could reuse
    list_assignment_targets' scoping check -- get_attempt_result had none
    before that pass.

    1 Oct 2026: delegates to practice_access_service.can_read_assignment, so
    these endpoints and the Practice Tracker agree on exactly who sees what.
    For a TEACHER that is still "assignments they created", plus -- new --
    assignments set for a section/course they teach or taught, created
    inside their own window for it (teacher_may_read_record, the 20 Aug
    handover policy). ADMIN (own school) and SUPER_ADMIN (all) unchanged."""
    viewer = practice_access_service.resolve_viewer(db, user)
    practice_access_service.require_readable_assignment(db, viewer, assignment)


def _get_scoped_assignment(db: Session, user: User, assignment_id: str) -> Assignment:
    assignment = db.get(Assignment, assignment_id)
    if not assignment:
        api_error(404, "NOT_FOUND", "Assignment not found.")
    _check_assignment_scope(db, user, assignment)
    return assignment


@router.get("/assignments/{assignment_id}/targets")
def list_assignment_targets(
    assignment_id: str,
    user: User = Depends(require_roles("TEACHER", "ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    """Per-student results for one assignment -- the teacher "results" view
    (20 Aug 2026, Phase 3 frontend; extended the same day with attempt
    history + attempts-remaining fields for the review/reattempt-approval
    surface)."""
    assignment = _get_scoped_assignment(db, user, assignment_id)

    targets = db.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).all()
    rows = []
    for target in targets:
        student = target.student
        attempts = _attempt_history(db, target.id)
        rows.append(
            {
                "assignmentTargetId": target.id,
                "studentId": student.id,
                "studentName": student.user.full_name if student.user else None,
                "studentCode": student.student_code,
                "className": student.class_name,
                "status": target.status,
                "maxAttempts": assignment.max_attempts,
                "bonusAttempts": target.bonus_attempts,
                "attemptsUsed": len(attempts),
                "attempts": attempts,
                "latestAttempt": attempts[-1] if attempts else None,
            }
        )
    rows.sort(key=lambda r: (r["studentName"] or "").lower())
    return {"assignmentId": assignment.id, "targets": rows}


@router.post("/assignments/{assignment_id}/targets/{target_id}/grant-attempt")
@limiter.limit("30/minute")
def grant_extra_attempt(
    request: Request,
    assignment_id: str,
    target_id: str,
    user: User = Depends(require_roles("TEACHER", "ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    """Reattempt approval (20 Aug 2026): a teacher/admin grants one specific
    student one more attempt on one specific assignment, without touching
    Assignment.max_attempts (shared by every other student targeted by the
    same assignment) -- see learning_service.grant_extra_attempt and
    start_attempt's own ATTEMPT_LIMIT_REACHED message, which has pointed
    students at their teacher for exactly this since Phase 3 kicked off."""
    assignment = _get_scoped_assignment(db, user, assignment_id)
    target = db.get(AssignmentTarget, target_id)
    if not target or target.assignment_id != assignment.id:
        api_error(404, "NOT_FOUND", "Assignment target not found.")
    # 1 Oct 2026: granting is a WRITE, so a TEACHER must also be the
    # section's CURRENT teacher (teacher_may_currently_act_on, whose own
    # docstring has always listed "grant an extra attempt" among the writes
    # it gates -- it just was never called here). A teacher who can still
    # read a handed-over assignment gets a 403 explaining why. Assignments
    # with no recorded section keep the old creator-only rule; see
    # practice_access_service.
    practice_access_service.require_actionable_assignment(
        db, practice_access_service.resolve_viewer(db, user), assignment
    )

    target = learning_service.grant_extra_attempt(db, target)
    log_audit_event(
        db,
        "learning.attempt.extra_granted",
        user_id=user.id,
        request=request,
        details={"assignmentId": assignment.id, "assignmentTargetId": target.id, "studentId": target.student_id, "bonusAttempts": target.bonus_attempts},
    )
    db.commit()

    attempts = _attempt_history(db, target.id)
    return {
        "assignmentTargetId": target.id,
        "maxAttempts": assignment.max_attempts,
        "bonusAttempts": target.bonus_attempts,
        "attemptsUsed": len(attempts),
    }


# --- attempt lifecycle (STUDENT) -------------------------------------------


class StartAttemptRequest(BaseModel):
    assignmentTargetId: str


def _attempt_dict(attempt: Attempt, db: Session) -> dict:
    activity = attempt.assignment_target.assignment.learning_activity
    questions = (
        db.query(Question)
        .join(LearningActivityQuestion, LearningActivityQuestion.question_id == Question.id)
        .filter(LearningActivityQuestion.learning_activity_id == activity.id)
        .order_by(LearningActivityQuestion.sequence)
        .all()
    )
    # 30 Sep 2026: resume used to come back blank. start_attempt returns the
    # existing IN_PROGRESS attempt on resume (learning_service.start_attempt,
    # "Resume an already-open attempt"), and every answer the student already
    # typed IS persisted server-side (PUT /attempts/{id}/answers ->
    # learning_service.save_answer -> AttemptAnswer.response_text) -- but
    # this response never included any of it, so a refresh or coming back
    # later showed empty inputs over answers that were still saved and would
    # still be graded on submit. Echoing the student's OWN response back is
    # safe mid-attempt; _question_public_dict's answer-key exclusions are
    # untouched (it stays unchanged -- this is its only caller, so the extra
    # field is added here rather than widening its shape). A fresh attempt
    # has no AttemptAnswer rows, so every responseText is None.
    saved = {
        answer.question_id: answer.response_text
        for answer in db.query(AttemptAnswer).filter(AttemptAnswer.attempt_id == attempt.id).all()
    }
    return {
        "id": attempt.id,
        "assignmentTargetId": attempt.assignment_target_id,
        "attemptNumber": attempt.attempt_number,
        "status": attempt.status,
        "startedAt": attempt.started_at.isoformat() if attempt.started_at else None,
        "activity": _activity_dict(activity),
        "questions": [{**_question_public_dict(q), "responseText": saved.get(q.id)} for q in questions],
    }


@router.post("/attempts")
@limiter.limit("30/minute")
def start_attempt(
    request: Request,
    payload: StartAttemptRequest,
    student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    attempt = learning_service.start_attempt(db, student, payload.assignmentTargetId)
    return _attempt_dict(attempt, db)


class SaveAnswerRequest(BaseModel):
    questionId: str
    responseText: str | None = None


@router.put("/attempts/{attempt_id}/answers")
@limiter.limit("120/minute")
def save_answer(
    request: Request,
    attempt_id: str,
    payload: SaveAnswerRequest,
    student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    answer = learning_service.save_answer(db, student, attempt_id, payload.questionId, payload.responseText)
    return {"questionId": answer.question_id, "savedAt": answer.answered_at.isoformat() if answer.answered_at else None}


def _evaluation_dict(evaluation) -> dict:
    return {
        "attemptId": evaluation.attempt_id,
        "autoScore": evaluation.auto_score,
        # 1 Oct 2026, manual grading: marks a teacher has awarded (None until
        # they award any); finalScore = autoScore + teacherScore.
        "teacherScore": evaluation.teacher_score,
        "maxScore": evaluation.max_score,
        "finalScore": evaluation.final_score,
        "reviewStatus": evaluation.review_status,
        "evaluatedAt": evaluation.evaluated_at.isoformat() if evaluation.evaluated_at else None,
    }


@router.post("/attempts/{attempt_id}/submit")
@limiter.limit("30/minute")
def submit_attempt(
    request: Request,
    attempt_id: str,
    student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    evaluation = learning_service.submit_attempt(db, student, attempt_id)
    return _evaluation_dict(evaluation)


@router.get("/attempts/{attempt_id}/result")
def get_attempt_result(
    attempt_id: str,
    user: User = Depends(require_roles("STUDENT", "TEACHER", "ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    attempt = db.get(Attempt, attempt_id)
    if not attempt:
        api_error(404, "NOT_FOUND", "Attempt not found.")

    if user.role == "STUDENT":
        student_row = db.query(Student).filter(Student.user_id == user.id).first()
        if not student_row or attempt.assignment_target.student_id != student_row.id:
            api_error(404, "NOT_FOUND", "Attempt not found.")
    else:
        # TEACHER/ADMIN/SUPER_ADMIN: scoped the same way as the results view
        # (list_assignment_targets) -- a TEACHER can only see attempts on
        # assignments they created, an ADMIN only within their own school.
        # 20 Aug 2026: this scoping used to be entirely missing here (any
        # TEACHER/ADMIN could fetch any attempt_id's full result, including
        # the answer key, by guessing or enumerating it) -- closed while
        # building the teacher review surface, which is the first thing to
        # actually call this endpoint from a TEACHER session.
        _check_assignment_scope(db, user, attempt.assignment_target.assignment)

    evaluation = learning_service.get_result(db, attempt_id)
    if not evaluation:
        api_error(422, "NOT_SUBMITTED", "This attempt has not been submitted yet.")

    answer_rows = db.query(AttemptAnswer).filter(AttemptAnswer.attempt_id == attempt.id).all()
    breakdown = []
    for answer in answer_rows:
        question = answer.question
        breakdown.append(
            {
                "questionId": question.id,
                "stem": question.stem,
                "responseText": answer.response_text,
                "isCorrect": answer.is_correct,
                "autoScore": answer.auto_score,
                # 1 Oct 2026: a teacher's mark for an answer auto-marking left
                # unscored (routes_practice_tracker's grading endpoint).
                "manualScore": answer.manual_score,
                "maxScore": answer.max_score,
                "correctAnswer": question.correct_answer,
                "explanation": question.explanation,
            }
        )

    result = _evaluation_dict(evaluation)
    result["attemptNumber"] = attempt.attempt_number
    # 30 Sep 2026: the result page decides whether to offer "Try Again" and
    # shows "attempt X of Y", but had nothing to compute that from except
    # attemptNumber -- so it guessed against max_attempts alone, ignoring
    # any teacher-granted bonus_attempts. These are the same three fields
    # (and the same _attempt_history count) that grant_extra_attempt and
    # list_assignment_targets already return, so every surface agrees with
    # start_attempt's real limit: attemptsUsed < maxAttempts + bonusAttempts.
    target = attempt.assignment_target
    result["maxAttempts"] = target.assignment.max_attempts
    result["bonusAttempts"] = target.bonus_attempts
    result["attemptsUsed"] = len(_attempt_history(db, target.id))
    result["answers"] = breakdown
    return result


# --- Foundation Repair (TEACHER / ADMIN) ------------------------------------


def _require_student_in_scope(db: Session, user: User, student: Student) -> None:
    """A3 fix (30 Sep 2026 security/DPDP review): GET /foundation-repair had
    no school-scope check at all -- proven by test, a TEACHER at school B
    could request a school-A student's id and get their real mastery score
    back. Applies the exact same boundary the sibling POST
    /foundation-repair/approve endpoint already enforces (via
    teacher.school_id), generalized to also cover ADMIN. SUPER_ADMIN is
    platform-wide and exempt, matching every other scope check in this
    codebase."""
    if user.role == "SUPER_ADMIN":
        return
    if user.role == "TEACHER":
        teacher = db.query(Teacher).filter(Teacher.user_id == user.id).first()
        if not teacher or teacher.school_id != student.school_id:
            api_error(403, "FORBIDDEN", "You can only view students in your own school.")
        return
    if user.role == "ADMIN":
        school_admin = db.query(SchoolAdmin).filter(SchoolAdmin.user_id == user.id).first()
        if not school_admin or school_admin.school_id != student.school_id:
            api_error(403, "FORBIDDEN", "You can only view students in your own school.")
        return
    api_error(403, "FORBIDDEN", "You do not have permission for this action.")


def _require_teacher_currently_teaches_student(
    db: Session, teacher: Teacher | None, student: Student, concept_lesson: ConceptLesson
) -> None:
    """A11 completeness pass (1 Oct 2026): both Foundation Repair endpoints
    were only school-scoped for a TEACHER -- any teacher could pull any
    same-school student's concept mastery (computed from that student's
    attempts/evaluations across EVERY teacher's assignments) and, worse,
    approve a rescue Assignment for them: a practice WRITE with no section
    ownership check at all, which teacher_assignment_service's own module
    docstring lists as exactly what teacher_may_currently_act_on gates.

    The triple checked is the student's OWN (class level, section) plus the
    course of the concept being repaired -- the concept the teacher is
    looking at in their own class. Deliberately not the recommended rescue
    activity's course: a PREREQUISITE_GAP rescue can come from an earlier
    class's BoardCourse (BoardCourse is per class level), which no teacher
    of the student's current section is ever recorded as owning.

    The class level is resolved as ClassLevel.code == Student.class_name,
    the same pairing practice_access_service.current_roster_clause and
    create_assignment above already use. A student with no section, or a
    class_name that isn't a ClassLevel code, can't be tied to any
    TeacherSectionAssignment, so no TEACHER may act on them here (an ADMIN
    still can through the ordinary admin paths).

    Used for the GET recommendation too, not just the approve write: the
    mastery figure is a live aggregate over all of the student's attempts
    with no single creation date, so teacher_may_read_record's "record
    created inside one of your windows" test can't be applied to it --
    letting a since-transferred teacher keep reading it would show them
    attempts made after their end_date, which is exactly what the 20 Aug
    2026 handover policy rules out. Only today's teacher of that section
    sees it."""
    if not teacher or not teacher.is_active:
        api_error(403, "FORBIDDEN", "Teacher profile not found or inactive.")
    class_level = (
        db.query(ClassLevel).filter(ClassLevel.code == student.class_name).first() if student.class_name else None
    )
    section = (student.section or "").strip()
    chapter = db.get(Chapter, concept_lesson.chapter_id)
    if (
        class_level is None
        or not section
        or chapter is None
        or not teacher_assignment_service.teacher_may_currently_act_on(
            db,
            teacher_id=teacher.id,
            class_level_id=class_level.id,
            section=section,
            board_course_id=chapter.board_course_id,
        )
    ):
        api_error(
            403,
            "FORBIDDEN",
            "You are not currently assigned to teach this student's class, section and course.",
        )


def _recommendation_dict(rec) -> dict:
    return {
        "recommendation": rec.recommendation,
        "conceptLessonId": rec.concept_lesson_id,
        "currentScorePercent": rec.current_score_percent,
        "gapConceptLessonId": rec.gap_concept_lesson_id,
        "gapPrerequisiteLinkId": rec.gap_prerequisite_link_id,
        "recommendedActivity": _activity_dict(rec.recommended_activity) if rec.recommended_activity else None,
        "explanation": rec.explanation,
    }


@router.get("/foundation-repair")
def get_foundation_repair_recommendation(
    studentId: str,
    conceptLessonId: str,
    user: User = Depends(require_roles("TEACHER", "ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    student = db.get(Student, studentId)
    if not student:
        api_error(404, "NOT_FOUND", "Student not found.")
    _require_student_in_scope(db, user, student)
    concept_lesson = db.get(ConceptLesson, conceptLessonId)
    if not concept_lesson:
        api_error(404, "NOT_FOUND", "Concept lesson not found.")
    if user.role == "TEACHER":
        teacher = db.query(Teacher).filter(Teacher.user_id == user.id).first()
        _require_teacher_currently_teaches_student(db, teacher, student, concept_lesson)
    recommendation = foundation_repair_service.get_recommendation(db, student, concept_lesson)
    return _recommendation_dict(recommendation)


class ApproveFoundationRepairRequest(BaseModel):
    studentId: str
    conceptLessonId: str


@router.post("/foundation-repair/approve")
@limiter.limit("30/minute")
def approve_foundation_repair_recommendation(
    request: Request,
    payload: ApproveFoundationRepairRequest,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    student = db.get(Student, payload.studentId)
    if not student:
        api_error(404, "NOT_FOUND", "Student not found.")
    concept_lesson = db.get(ConceptLesson, payload.conceptLessonId)
    if not concept_lesson:
        api_error(404, "NOT_FOUND", "Concept lesson not found.")
    if student.school_id != teacher.school_id:
        api_error(403, "FORBIDDEN", "You can only manage students in your own school.")
    # A11 (1 Oct 2026): approving creates a real Assignment -- a WRITE -- so
    # the teacher must currently own the student's section for this course.
    _require_teacher_currently_teaches_student(db, teacher, student, concept_lesson)

    recommendation = foundation_repair_service.get_recommendation(db, student, concept_lesson)
    school = db.get(School, teacher.school_id)
    assignment = foundation_repair_service.approve_recommendation(
        db, school=school, teacher=teacher, student=student, recommendation=recommendation
    )
    target_count = db.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).count()
    return _assignment_dict(assignment, target_count)
