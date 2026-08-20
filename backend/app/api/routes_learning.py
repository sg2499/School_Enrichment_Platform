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
  scoped to their own school (Teacher.school_id); ADMIN the same way
  routes_roster.py's _resolve_school works, SUPER_ADMIN must pass schoolId.
- The attempt lifecycle (start/save/submit/result) is STUDENT-only, always
  scoped to attempts the authenticated student's own AssignmentTarget rows
  own -- see learning_service._get_owned_target/_get_owned_attempt, which
  return 404 (never 403) for anything outside that scope, matching this
  codebase's "don't disclose another student's resource exists" rule.
- Foundation Repair is TEACHER/ADMIN-only (Section 11: recommendations stay
  under teacher control).
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
from app.services import foundation_repair_service, learning_service

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

    assignment = learning_service.create_assignment(
        db,
        school=school,
        learning_activity=activity,
        assigned_by_user_id=assigned_by,
        class_name=payload.className,
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


@router.get("/assignments/{assignment_id}/targets")
def list_assignment_targets(
    assignment_id: str,
    user: User = Depends(require_roles("TEACHER", "ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    """Per-student results for one assignment -- the teacher "results" view
    (20 Aug 2026, Phase 3 frontend). Returns 404 rather than 403 for an
    assignment outside the caller's scope, matching this file's existing
    "don't disclose another school's/teacher's resource exists" rule (see
    module docstring)."""
    assignment = db.get(Assignment, assignment_id)
    if not assignment:
        api_error(404, "NOT_FOUND", "Assignment not found.")
    if user.role == "TEACHER" and assignment.assigned_by_user_id != user.id:
        api_error(404, "NOT_FOUND", "Assignment not found.")
    if user.role == "ADMIN":
        school = _resolve_school(db, user, None)
        if assignment.school_id != school.id:
            api_error(404, "NOT_FOUND", "Assignment not found.")

    targets = db.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).all()
    rows = []
    for target in targets:
        student = target.student
        rows.append(
            {
                "assignmentTargetId": target.id,
                "studentId": student.id,
                "studentName": student.user.full_name if student.user else None,
                "studentCode": student.student_code,
                "className": student.class_name,
                "status": target.status,
                "latestAttempt": _latest_attempt_summary(db, target.id),
            }
        )
    rows.sort(key=lambda r: (r["studentName"] or "").lower())
    return {"assignmentId": assignment.id, "targets": rows}


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
    return {
        "id": attempt.id,
        "assignmentTargetId": attempt.assignment_target_id,
        "attemptNumber": attempt.attempt_number,
        "status": attempt.status,
        "startedAt": attempt.started_at.isoformat() if attempt.started_at else None,
        "activity": _activity_dict(activity),
        "questions": [_question_public_dict(q) for q in questions],
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
                "maxScore": answer.max_score,
                "correctAnswer": question.correct_answer,
                "explanation": question.explanation,
            }
        )

    result = _evaluation_dict(evaluation)
    result["attemptNumber"] = attempt.attempt_number
    result["answers"] = breakdown
    return result


# --- Foundation Repair (TEACHER / ADMIN) ------------------------------------


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
    _: User = Depends(require_roles("TEACHER", "ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    student = db.get(Student, studentId)
    if not student:
        api_error(404, "NOT_FOUND", "Student not found.")
    concept_lesson = db.get(ConceptLesson, conceptLessonId)
    if not concept_lesson:
        api_error(404, "NOT_FOUND", "Concept lesson not found.")
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

    recommendation = foundation_repair_service.get_recommendation(db, student, concept_lesson)
    school = db.get(School, teacher.school_id)
    assignment = foundation_repair_service.approve_recommendation(
        db, school=school, teacher=teacher, student=student, recommendation=recommendation
    )
    target_count = db.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).count()
    return _assignment_dict(assignment, target_count)
