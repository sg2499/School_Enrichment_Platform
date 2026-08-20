"""Phase 3 (Five-day learning loop) service layer: turning Phase 2's
Question bank into deliverable LearningActivity units, and the
Assignment -> AssignmentTarget -> Attempt -> AttemptAnswer -> Evaluation
lifecycle blueprint Section 8 describes.

Three responsibilities live here, matching the module's three main entry
points:

1. `generate_activities_for_chapter` -- one-time (per chapter) ingestion:
   groups a chapter's already-imported Questions by their existing
   assignment_code (Phase 2's descriptive-only field, see
   app.models.curriculum's module docstring) into real, FK-linked
   LearningActivity + LearningActivityQuestion rows. See
   `classify_assignment_code`'s docstring for exactly how each real
   assignment_code (verified against Chapter 1's real Assignment Plan
   sheet) maps to an activity_type.

2. `create_assignment` -- a teacher assigns a PUBLISHED LearningActivity to
   a class and/or specific student(s), materializing one AssignmentTarget
   per student (blueprint Section 6.3).

3. `start_attempt` / `save_answer` / `submit_attempt` -- the actual student
   attempt lifecycle, ending in `grade_answer`-based auto-marking and an
   Evaluation rollup (blueprint Section 8.1).

Auto-marking (`grade_answer`) covers exactly the response shapes Chapter 1's
real content actually uses (verified via
`Content/CBSE_Class_5_Chapter_1.xlsx`'s Question Bank sheet: 348 Numeric
Entry, 125 Single Select, 17 Text Entry, 5 Ordering, 4 Constructed Response,
1 Multi Select out of 500) -- Single/Multi Select (option-letter matching),
Numeric Entry/Text Entry (normalized value matching against correct_answer
or any `|`-separated accepted_variants, mirroring
question_quality_service.py's own `_normalize_answer_numbers` convention),
and Ordering (semicolon-separated sequence matching). This is deliberately
NOT the client's full measurement/unit-tolerance rule set (Section 7 item 5
of PROJECT_REFERENCE.md's clarifications: separate number/unit scoring,
accepted unit-name variants, round-half-up, per-question tolerance) --
that precise a numeric/unit evaluation engine is real, further Phase 3/4
work of its own, tracked separately, not silently assumed done here.
Anything grade_answer can't confidently score (auto_gradable=False, or a
question_type it doesn't recognise, e.g. Constructed Response) returns
(None, None) rather than guessing -- the same "don't guess" discipline
question_quality_service.py's math verifiers already established.
"""
import re
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.models import (
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
    Student,
    Teacher,
)

# --- Phase 3 ingestion: Question.assignment_code -> LearningActivity -------

# Verified against Chapter 1's real Assignment Plan sheet (see
# learning.py's module docstring for the full reasoning). Order matters:
# first match wins, and patterns are deliberately specific (fullmatch, not
# search) so an unrecognised future code is skipped rather than
# mis-classified -- see classify_assignment_code's own docstring.
_CODE_PATTERNS: tuple[tuple[re.Pattern, str, bool], ...] = (
    (re.compile(r"^CH\d+-DIAG(-B)?$"), "PREREQUISITE_CHECK", False),
    (re.compile(r"^CH\d+-P\d+$"), "CORE_PRACTICE", False),
    (re.compile(r"^CH\d+-X[AB]-S\d+$"), "EXTRA_PRACTICE", False),
    (re.compile(r"^CH\d+-REM-S\d+$"), "REMEDIATION", False),
    (re.compile(r"^CH\d+-ADV-S\d+$"), "CHALLENGE", False),
    (re.compile(r"^CH\d+-MASTERY$"), "CHAPTER_MASTERY", True),
    (re.compile(r"^CH\d+-CASE$"), "CASE_STUDY", True),
)

# See learning.py's module docstring paragraph on pacing_day for the full
# rationale, including the honest gap (no per-skill "Day 5 short final
# check" content exists in the real data yet -- CHALLENGE is the closest
# real fit for an optional Day 5 slot, not a claim that it IS one).
DEFAULT_PACING_DAY = {
    "PREREQUISITE_CHECK": 1,
    "CONCEPT_SIMPLE": 1,
    "CORE_PRACTICE": 2,
    "CASE_STUDY": 3,
    "REMEDIATION": 4,
    "EXTRA_PRACTICE": 4,
    "CHALLENGE": 5,
    "CHAPTER_MASTERY": None,
}

_TITLE_SUFFIX = {
    "PREREQUISITE_CHECK": "Prerequisite Check",
    "CORE_PRACTICE": "Core Practice",
    "EXTRA_PRACTICE": "Extra Practice",
    "REMEDIATION": "Remediation",
    "CHALLENGE": "Challenge",
    "CASE_STUDY": "Case Study",
    "CHAPTER_MASTERY": "Chapter Mastery",
}


def classify_assignment_code(code: str) -> tuple[str | None, bool]:
    """Returns (activity_type, is_chapter_scoped) for a real
    Question.assignment_code, or (None, False) for a code that doesn't match
    any recognised real pattern -- callers must skip those, not guess."""
    if not code:
        return None, False
    for pattern, activity_type, chapter_scoped in _CODE_PATTERNS:
        if pattern.match(code.strip()):
            return activity_type, chapter_scoped
    return None, False


def generate_activities_for_chapter(db: Session, chapter: Chapter, created_by_user_id: str | None) -> list[LearningActivity]:
    """Idempotent: re-running this after new questions are added to a
    chapter only creates activities for (assignment_code, concept_lesson)
    combinations that don't already have one -- existing activities and
    their question links are left untouched, mirroring
    curriculum_import_service.py's own idempotent-seed convention.

    Chapter-scoped activity_types (CHAPTER_MASTERY, CASE_STUDY) collapse
    every matching question -- regardless of which skill it's tagged
    against -- into ONE activity for the whole chapter (see learning.py's
    module docstring for why: the real MASTERY code is structurally
    identical to DIAG, one item per skill, but plays the opposite role).
    Every other activity_type groups by (assignment_code, concept_lesson_id)
    pair, which for the real data naturally reproduces one activity per
    skill per code (Chapter 1's own per-skill P0X/XA/XB/REM/ADV sets are
    each already entirely one skill).
    """
    questions = (
        db.query(Question)
        .join(ConceptLesson, Question.concept_lesson_id == ConceptLesson.id)
        .filter(ConceptLesson.chapter_id == chapter.id)
        .all()
    )

    groups: dict[tuple[str, str | None], list[Question]] = {}
    activity_types: dict[tuple[str, str | None], str] = {}
    for question in questions:
        activity_type, chapter_scoped = classify_assignment_code(question.assignment_code)
        if not activity_type:
            continue
        key = (question.assignment_code, None if chapter_scoped else question.concept_lesson_id)
        groups.setdefault(key, []).append(question)
        activity_types[key] = activity_type

    created: list[LearningActivity] = []
    for (assignment_code, concept_lesson_id), group_questions in groups.items():
        activity_type = activity_types[(assignment_code, concept_lesson_id)]
        existing = (
            db.query(LearningActivity)
            .filter(
                LearningActivity.chapter_id == chapter.id,
                LearningActivity.concept_lesson_id == concept_lesson_id,
                LearningActivity.source_assignment_code == assignment_code,
            )
            .first()
        )
        if existing:
            continue

        concept_lesson = group_questions[0].concept_lesson
        if concept_lesson_id:
            title = f"{concept_lesson.title} — {_TITLE_SUFFIX[activity_type]}"
            sequence = concept_lesson.sequence
        else:
            title = f"{chapter.title} — {_TITLE_SUFFIX[activity_type]}"
            sequence = 9999  # chapter-scoped capstones sort after every skill's own activities

        activity = LearningActivity(
            chapter_id=chapter.id,
            concept_lesson_id=concept_lesson_id,
            activity_type=activity_type,
            title=title,
            sequence=sequence,
            pacing_day=DEFAULT_PACING_DAY.get(activity_type),
            evaluation_mode="AUTO",
            estimated_minutes=max(len(group_questions) * 2, 5),
            status="DRAFT",
            source_assignment_code=assignment_code,
            created_by=created_by_user_id,
        )
        db.add(activity)
        db.flush()
        for i, question in enumerate(sorted(group_questions, key=lambda q: q.code), start=1):
            db.add(LearningActivityQuestion(learning_activity_id=activity.id, question_id=question.id, sequence=i))
        created.append(activity)

    db.commit()
    for activity in created:
        db.refresh(activity)
    return created


# --- Assignment creation -----------------------------------------------


def create_assignment(
    db: Session,
    *,
    school: School,
    learning_activity: LearningActivity,
    assigned_by_user_id: str,
    class_name: str | None = None,
    student_ids: list[str] | None = None,
    reason: str = "SCHEDULED",
    source_prerequisite_link_id: str | None = None,
    pacing_mode: str = "FIVE_DAY",
    due_date: str | None = None,
    available_from: str | None = None,
    max_attempts: int = 3,
) -> Assignment:
    if learning_activity.status != "PUBLISHED":
        api_error(422, "VALIDATION_ERROR", "Only a published learning activity can be assigned.")
    if not class_name and not student_ids:
        api_error(422, "VALIDATION_ERROR", "Either classId or studentIds is required.")

    targets_query = db.query(Student).filter(Student.school_id == school.id, Student.is_active.is_(True))
    if student_ids:
        students = targets_query.filter(Student.id.in_(student_ids)).all()
        found_ids = {s.id for s in students}
        missing = set(student_ids) - found_ids
        if missing:
            api_error(404, "NOT_FOUND", f"Student(s) not found in this school: {', '.join(sorted(missing))}.")
    else:
        students = targets_query.filter(Student.class_name == class_name).all()
        if not students:
            api_error(422, "VALIDATION_ERROR", f"No active students found in class {class_name!r}.")

    assignment = Assignment(
        school_id=school.id,
        learning_activity_id=learning_activity.id,
        assigned_by_user_id=assigned_by_user_id,
        class_name=class_name,
        reason=reason,
        source_prerequisite_link_id=source_prerequisite_link_id,
        pacing_mode=pacing_mode,
        due_date=due_date,
        available_from=available_from,
        max_attempts=max_attempts,
    )
    db.add(assignment)
    db.flush()
    for student in students:
        db.add(AssignmentTarget(assignment_id=assignment.id, student_id=student.id))
    db.commit()
    db.refresh(assignment)
    return assignment


# --- Attempt lifecycle ---------------------------------------------------


def _get_owned_target(db: Session, student: Student, assignment_target_id: str) -> AssignmentTarget:
    target = db.get(AssignmentTarget, assignment_target_id)
    if not target or target.student_id != student.id:
        api_error(404, "NOT_FOUND", "Assignment not found.")
    return target


def start_attempt(db: Session, student: Student, assignment_target_id: str) -> Attempt:
    target = _get_owned_target(db, student, assignment_target_id)
    assignment = target.assignment
    if assignment.status != "ACTIVE":
        api_error(422, "ASSIGNMENT_CLOSED", "This assignment is no longer active.")

    # Resume an already-open attempt rather than starting a duplicate --
    # this is what makes a page-refresh mid-attempt safe, and half of
    # blueprint 8.1's idempotent-submit requirement (the other half is
    # submit_attempt's own re-submit guard below).
    in_progress = (
        db.query(Attempt)
        .filter(Attempt.assignment_target_id == target.id, Attempt.status == "IN_PROGRESS")
        .order_by(Attempt.attempt_number.desc())
        .first()
    )
    if in_progress:
        return in_progress

    attempt_count = db.query(func.count(Attempt.id)).filter(Attempt.assignment_target_id == target.id).scalar() or 0
    if attempt_count >= assignment.max_attempts:
        api_error(422, "ATTEMPT_LIMIT_REACHED", "No re-attempts remaining for this assignment. Ask your teacher for an additional attempt.")
    if attempt_count > 0:
        latest = (
            db.query(Attempt)
            .filter(Attempt.assignment_target_id == target.id)
            .order_by(Attempt.attempt_number.desc())
            .first()
        )
        if latest.status not in ("SUBMITTED", "EVALUATED"):
            api_error(409, "ATTEMPT_IN_PROGRESS", "The previous attempt must be submitted before starting a new one.")

    attempt = Attempt(assignment_target_id=target.id, attempt_number=attempt_count + 1, status="IN_PROGRESS")
    db.add(attempt)
    target.status = "IN_PROGRESS"
    db.commit()
    db.refresh(attempt)
    return attempt


def _get_owned_attempt(db: Session, student: Student, attempt_id: str) -> Attempt:
    attempt = db.get(Attempt, attempt_id)
    if not attempt or attempt.assignment_target.student_id != student.id:
        api_error(404, "NOT_FOUND", "Attempt not found.")
    return attempt


def _activity_question_ids(db: Session, learning_activity_id: str) -> set[str]:
    rows = db.query(LearningActivityQuestion.question_id).filter(LearningActivityQuestion.learning_activity_id == learning_activity_id).all()
    return {r[0] for r in rows}


def save_answer(db: Session, student: Student, attempt_id: str, question_id: str, response_text: str | None) -> AttemptAnswer:
    attempt = _get_owned_attempt(db, student, attempt_id)
    if attempt.status != "IN_PROGRESS":
        api_error(409, "ATTEMPT_LOCKED", "This attempt has already been submitted and can no longer be changed.")

    activity = attempt.assignment_target.assignment.learning_activity
    if question_id not in _activity_question_ids(db, activity.id):
        api_error(422, "VALIDATION_ERROR", "This question is not part of the assigned activity.")

    question = db.get(Question, question_id)
    answer = (
        db.query(AttemptAnswer)
        .filter(AttemptAnswer.attempt_id == attempt.id, AttemptAnswer.question_id == question_id)
        .first()
    )
    now = datetime.now(timezone.utc)
    if answer:
        answer.response_text = response_text
        answer.answered_at = now
    else:
        answer = AttemptAnswer(
            attempt_id=attempt.id,
            question_id=question_id,
            response_text=response_text,
            max_score=question.marks,
            answered_at=now,
        )
        db.add(answer)
    db.commit()
    db.refresh(answer)
    return answer


# --- Auto-marking ---------------------------------------------------------


def _normalize_value(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace(",", "")).strip().lower()


def _candidate_answers(question: Question) -> list[str]:
    candidates = [question.correct_answer or ""]
    if question.accepted_variants:
        candidates.extend(question.accepted_variants.split("|"))
    return [c for c in candidates if c and c.strip()]


def grade_answer(question: Question, response_text: str | None) -> tuple[bool | None, int | None]:
    """Returns (is_correct, auto_score). (None, None) means "not auto-graded
    here" -- either the question isn't auto_gradable, or its question_type
    isn't one of the response shapes this function recognises (see module
    docstring). An unattempted (blank) response to an auto-gradable question
    is graded wrong, not skipped -- blueprint 8.2: "Unattempted answers
    receive zero.\""""
    if not question.auto_gradable:
        return None, None

    question_type = (question.question_type or "").strip()
    response = (response_text or "").strip()

    if question_type == "Single Select":
        is_correct = bool(response) and response.strip().upper() == (question.correct_answer or "").strip().upper()
    elif question_type == "Multi Select":
        given = {p.strip().upper() for p in response.split(",") if p.strip()}
        expected = {p.strip().upper() for p in (question.correct_answer or "").split(",") if p.strip()}
        is_correct = bool(given) and given == expected
    elif question_type in ("Numeric Entry", "Text Entry"):
        if not response:
            is_correct = False
        else:
            normalized_response = [_normalize_value(p) for p in response.split(";") if p.strip()]
            is_correct = any(
                normalized_response == [_normalize_value(p) for p in candidate.split(";") if p.strip()]
                for candidate in _candidate_answers(question)
            )
    elif question_type == "Ordering":
        if not response:
            is_correct = False
        else:
            normalized_response = _normalize_value(response)
            is_correct = any(_normalize_value(candidate) == normalized_response for candidate in _candidate_answers(question))
    else:
        # Constructed Response and any other subjective/unrecognised type --
        # not auto-graded, don't guess.
        return None, None

    return is_correct, (question.marks if is_correct else 0)


def submit_attempt(db: Session, student: Student, attempt_id: str) -> Evaluation:
    attempt = _get_owned_attempt(db, student, attempt_id)

    # Idempotent submit (blueprint 8.1): a second call for an
    # already-submitted attempt just returns the existing evaluation rather
    # than re-grading or erroring, so a double-click or a retried request
    # never creates a duplicate.
    existing_evaluation = db.query(Evaluation).filter(Evaluation.attempt_id == attempt.id).first()
    if existing_evaluation:
        return existing_evaluation
    if attempt.status != "IN_PROGRESS":
        api_error(409, "ATTEMPT_LOCKED", "This attempt is not in progress.")

    activity = attempt.assignment_target.assignment.learning_activity
    question_ids = _activity_question_ids(db, activity.id)
    questions_by_id = {q.id: q for q in db.query(Question).filter(Question.id.in_(question_ids)).all()}

    existing_answers = {a.question_id: a for a in db.query(AttemptAnswer).filter(AttemptAnswer.attempt_id == attempt.id).all()}

    auto_score = 0
    max_score = 0
    any_unscored = False
    for question_id, question in questions_by_id.items():
        answer = existing_answers.get(question_id)
        if not answer:
            # Never-touched question -- treat as an unattempted (blank) response
            # so it's still scored, matching blueprint 8.2's "unattempted
            # answers receive zero" rather than silently excluding it from
            # max_score.
            answer = AttemptAnswer(attempt_id=attempt.id, question_id=question_id, response_text=None, max_score=question.marks)
            db.add(answer)

        is_correct, score = grade_answer(question, answer.response_text)
        answer.is_correct = is_correct
        answer.auto_score = score
        max_score += question.marks
        if score is None:
            any_unscored = True
        else:
            auto_score += score

    now = datetime.now(timezone.utc)
    attempt.status = "EVALUATED" if not any_unscored else "SUBMITTED"
    attempt.submitted_at = now
    attempt.assignment_target.status = "COMPLETED"

    evaluation = Evaluation(
        attempt_id=attempt.id,
        auto_score=auto_score,
        max_score=max_score,
        final_score=auto_score,
        review_status="AUTO_FINALISED" if not any_unscored else "PENDING_REVIEW",
        evaluated_at=now,
    )
    db.add(evaluation)
    db.commit()
    db.refresh(evaluation)
    return evaluation


def get_result(db: Session, attempt_id: str) -> Evaluation | None:
    return db.query(Evaluation).filter(Evaluation.attempt_id == attempt_id).first()


def resolve_teacher_school_and_assignable_check(db: Session, teacher: Teacher) -> School:
    school = db.get(School, teacher.school_id)
    if not school:
        api_error(404, "NOT_FOUND", "School not found.")
    return school
