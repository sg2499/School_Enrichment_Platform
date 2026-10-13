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
question_quality_service.py's own `_normalize_answer_numbers` convention --
plus, since 20 Aug 2026, a numeric-equivalence fallback via `_numeric_value`
so thousands-separator commas, a stray currency symbol or common unit label,
a leading '+', or decimal-precision differences on an otherwise-correct
numeric blank can never flip a right answer to wrong), and Ordering
(semicolon-separated sequence matching, same per-blank tolerance). This is
deliberately NOT the client's full measurement/unit-tolerance rule set
(Section 7 item 5 of PROJECT_REFERENCE.md's clarifications: separate
number/unit scoring, accepted unit-name variants, unit conversion, per-
question rounding/tolerance, and partial credit for a missing required
unit) -- that precise a numeric/unit evaluation engine, with real per-
question tolerance/rounding config and partial-credit rules, is real,
further Phase 3/4 work of its own, tracked separately, not silently
assumed done here. `_numeric_value`'s unit stripping is a small, curated,
best-effort vocabulary meant only to stop legitimate formatting variants
from being marked wrong -- not a substitute for that spec.
Anything grade_answer can't confidently score (auto_gradable=False, or a
question_type it doesn't recognise, e.g. Constructed Response) returns
(None, None) rather than guessing -- the same "don't guess" discipline
question_quality_service.py's math verifiers already established.
"""
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.models import (
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
    Student,
    Teacher,
)
from app.services import units

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
    section: str | None = None,
    student_ids: list[str] | None = None,
    reason: str = "SCHEDULED",
    source_prerequisite_link_id: str | None = None,
    pacing_mode: str = "FIVE_DAY",
    due_date: str | None = None,
    available_from: str | None = None,
    max_attempts: int = 3,
    section_scope: tuple[str, str, str] | None = None,
) -> Assignment:
    if learning_activity.status != "PUBLISHED":
        api_error(422, "VALIDATION_ERROR", "Only a published activity can be assigned.")
    if not class_name and not student_ids:
        api_error(422, "VALIDATION_ERROR", "Choose a class to assign to.")

    targets_query = db.query(Student).filter(Student.school_id == school.id, Student.is_active.is_(True))
    if student_ids:
        students = targets_query.filter(Student.id.in_(student_ids)).all()
        found_ids = {s.id for s in students}
        missing = set(student_ids) - found_ids
        if missing:
            # The ids used to be listed in the sentence itself. They are
            # for a program, not a person, so they travel in `details`.
            api_error(
                404,
                "NOT_FOUND",
                "Some of those students couldn't be found in this school.",
                {"missingStudentIds": sorted(missing)},
            )
    else:
        # `section` (30 Sep 2026) narrows a class-wide assignment to one
        # section. Students store class and section as two separate fields
        # (routes_roster.py: class_name="5", section="A"), so a class_name
        # alone can only ever mean "every section of Class 5" -- there was
        # no way for a teacher to target 5A on its own, and typing "5A"
        # (the old form's own hint) matched nobody. Omitting it (None) keeps
        # the original whole-class behaviour exactly, for every existing
        # caller. Blank/whitespace is treated the same as omitted, and a real
        # value is stripped the same way teacher_assignment_service stores
        # TeacherSectionAssignment.section, which is where the teacher UI
        # reads the value from. Ignored when student_ids is given, like
        # class_name itself.
        section = (section or "").strip() or None
        class_query = targets_query.filter(Student.class_name == class_name)
        if section is not None:
            class_query = class_query.filter(Student.section == section)
        students = class_query.all()
        if not students:
            where = f"Class {class_name}, Section {section}" if section is not None else f"Class {class_name}"
            api_error(422, "VALIDATION_ERROR", f"There are no active students in {where}.")

    # Section scope (1 Oct 2026, Practice Tracker): record which
    # (class_level, section, board_course) this assignment was set for, so
    # read access and the tracker's section filters can be answered from
    # the row itself -- see the Assignment model's comment. Purely
    # descriptive: nothing above (who gets targeted) depends on it. Only a
    # class-wide assignment gets a class level/section; a student_ids
    # assignment is not section-scoped (section stays None, matching the
    # targeting rule above, which ignores section in that case too).
    #
    # `section_scope` (13 Oct 2026) is the exception: a caller that has
    # already verified which (class_level_id, section, board_course_id) a
    # student_ids assignment belongs to passes it, and it is recorded as is.
    # Only Foundation Repair does this today (foundation_repair_service.
    # approve_recommendation); who is targeted is unchanged by it.
    class_level = None
    if class_name and not student_ids:
        class_level = db.query(ClassLevel).filter(ClassLevel.code == class_name).first()
    chapter = db.get(Chapter, learning_activity.chapter_id)
    if section_scope is not None:
        scope_class_level_id, scope_section, scope_board_course_id = section_scope
    else:
        scope_class_level_id = class_level.id if class_level else None
        scope_section = None if student_ids else section
        scope_board_course_id = chapter.board_course_id if chapter else None

    assignment = Assignment(
        school_id=school.id,
        learning_activity_id=learning_activity.id,
        assigned_by_user_id=assigned_by_user_id,
        class_name=class_name,
        section=scope_section,
        class_level_id=scope_class_level_id,
        board_course_id=scope_board_course_id,
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
        api_error(404, "NOT_FOUND", "That practice couldn't be found. It may have been removed by your teacher.")
    return target


def start_attempt(db: Session, student: Student, assignment_target_id: str) -> Attempt:
    target = _get_owned_target(db, student, assignment_target_id)
    assignment = target.assignment
    if assignment.status != "ACTIVE":
        api_error(422, "ASSIGNMENT_CLOSED", "This practice has been closed, so it can't be started.")

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
    # target.bonus_attempts (20 Aug 2026, teacher reattempt-approval surface)
    # is this one student's own extra allowance on top of the assignment's
    # shared max_attempts -- see grant_extra_attempt below.
    if attempt_count >= assignment.max_attempts + target.bonus_attempts:
        api_error(422, "ATTEMPT_LIMIT_REACHED", "You've used all your attempts for this practice. Ask your teacher if you need another one.")
    if attempt_count > 0:
        latest = (
            db.query(Attempt)
            .filter(Attempt.assignment_target_id == target.id)
            .order_by(Attempt.attempt_number.desc())
            .first()
        )
        if latest.status not in ("SUBMITTED", "EVALUATED"):
            api_error(409, "ATTEMPT_IN_PROGRESS", "Submit your current attempt before starting a new one.")

    attempt = Attempt(assignment_target_id=target.id, attempt_number=attempt_count + 1, status="IN_PROGRESS")
    db.add(attempt)
    target.status = "IN_PROGRESS"
    db.commit()
    db.refresh(attempt)
    return attempt


# --- Teacher/Admin: reattempt approval (20 Aug 2026) -----------------------


def grant_extra_attempt(db: Session, target: AssignmentTarget) -> AssignmentTarget:
    """One more attempt for this one student on this one assignment,
    approved by their teacher (or an admin) -- see start_attempt's own
    ATTEMPT_LIMIT_REACHED message, which has said "ask your teacher" since
    Phase 3 kicked off. Increments AssignmentTarget.bonus_attempts, which is
    per-target, not per-Assignment, so it never changes the limit for any
    other student sharing the same Assignment row. Authorization (does this
    caller own/have scope over the assignment) is the route layer's job,
    same as every other teacher-facing endpoint in this module -- this
    function trusts its caller already checked.

    Deliberately does NOT commit -- audit_service.py's own convention is
    that a sensitive action's audit-log row is added right next to (and
    committed atomically with) the action it records, so the route handler
    logs the audit event and commits both together in one transaction."""
    target.bonus_attempts += 1
    return target


def _get_owned_attempt(db: Session, student: Student, attempt_id: str) -> Attempt:
    attempt = db.get(Attempt, attempt_id)
    if not attempt or attempt.assignment_target.student_id != student.id:
        api_error(404, "NOT_FOUND", "That attempt couldn't be found.")
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
        api_error(422, "VALIDATION_ERROR", "That question isn't part of this practice.")

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


# Currency/unit noise _numeric_value strips before parsing a blank as a
# number. Deliberately a small, curated vocabulary -- NOT a general "eat any
# trailing word" pattern -- so a wrong free-text answer that merely happens
# to contain the right number (e.g. "subtract 500 each time" when the
# correct answer is "add 500 each time") can never numeric-match: after
# stripping, anything other than a bare currency-prefixed/unit-suffixed
# number still fails float() and falls back to plain string comparison.
_LEADING_CURRENCY_RE = re.compile(r"^(rs\.?|inr|usd)\s*|^[₹$]\s*", re.IGNORECASE)
_TRAILING_UNIT_RE = re.compile(
    r"\s*(kmph|km/h|km|kg|gm|mg|g|cm|mm|ml|l|litres?|liters?|metres?|meters?|m|"
    r"rupees?|rs\.?|"
    r"hours?|hrs?|minutes?|mins?|seconds?|secs?|"
    r"days?|weeks?|months?|years?|degrees?|percent|%)\.?$",
    re.IGNORECASE,
)


def _numeric_value(text: str) -> float | None:
    """Best-effort extraction of the number a free-text numeric answer
    represents, so formatting that doesn't change the underlying value --
    thousands-separator commas, a leading currency symbol, a trailing unit
    label, a leading '+', or trailing zeros/decimal precision -- never
    causes a mathematically correct answer to be marked wrong (found via the
    20 Aug 2026 pilot scan: "19,250 km" was marked incorrect against a
    correct_answer of "19250"). Returns None when the text isn't -- once
    that noise is stripped -- a single clean number, so callers fall back to
    exact string comparison for genuine free text; this only ever makes
    grading MORE lenient toward equivalent values, never lenient toward
    wrong ones.
    """
    cleaned = re.sub(r"\s+", " ", text.replace(",", "")).strip()
    cleaned = _LEADING_CURRENCY_RE.sub("", cleaned)
    cleaned = _TRAILING_UNIT_RE.sub("", cleaned).strip()
    cleaned = cleaned.lstrip("+")
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _blank_matches(response_blank: str, candidate_blank: str) -> bool:
    if _normalize_value(response_blank) == _normalize_value(candidate_blank):
        return True
    response_value = _numeric_value(response_blank)
    candidate_value = _numeric_value(candidate_blank)
    return response_value is not None and candidate_value is not None and response_value == candidate_value


def _blanks_match(response_blanks: list[str], candidate_blanks: list[str]) -> bool:
    return len(response_blanks) == len(candidate_blanks) and all(
        _blank_matches(r, c) for r, c in zip(response_blanks, candidate_blanks)
    )


def _candidate_answers(question: Question) -> list[str]:
    candidates = [question.correct_answer or ""]
    if question.accepted_variants:
        candidates.extend(question.accepted_variants.split("|"))
    return [c for c in candidates if c and c.strip()]


# --- Measured answers: units, tolerance, rounding (Phase 4, #164) -----------
#
# Ashalatha's clarification note, item 5, as designed in
# PHASE4_UNITS_DESIGN.md (approved 13 Oct 2026). Applies to a Numeric Entry
# question with one blank, and only once its marking fields say so (see
# _uses_measured_marking); every other question is marked by the code after
# this block exactly as before.

UNIT_RULES = ("NONE", "STATED", "REQUIRED")

# Grading notes recorded on AttemptAnswer.grading_note.
WRONG_UNIT = "WRONG_UNIT"
UNIT_MISSING = "UNIT_MISSING"


@dataclass(frozen=True)
class MarkingRule:
    unit_rule: str  # one of UNIT_RULES, after the Response Format default
    answer_unit: str | None  # a units.UNITS code
    allow_conversion: bool
    tolerance: Decimal | None
    decimal_places: int | None
    unit_mark: int


@dataclass(frozen=True)
class GradeResult:
    is_correct: bool | None
    score: int | None
    note: str | None = None


def default_unit_rule(response_format: str | None) -> str:
    """The rule a question follows when none is recorded: STATED when its
    Response Format says the unit is stated in the question (1,270 Class 5
    questions), NONE otherwise."""
    return "STATED" if "unit stated" in (response_format or "").lower() else "NONE"


def parse_tolerance(text: str | None) -> Decimal | None:
    """A stored tolerance as a Decimal, or None when empty or unreadable.
    Writes are checked (routes_curriculum_admin, the importer), so an
    unreadable one can only be old or hand-made data; it is ignored rather
    than allowed to stop marking."""
    if text is None or not str(text).strip():
        return None
    try:
        value = Decimal(str(text).strip())
    except InvalidOperation:
        return None
    if not value.is_finite() or value < 0:
        return None
    return value


def marking_rule(question: Question) -> MarkingRule:
    rule = (question.unit_rule or "").strip().upper()
    if rule not in UNIT_RULES:
        rule = default_unit_rule(question.response_format)
    unit = units.unit_code(question.answer_unit) if question.answer_unit else None
    unit_mark = question.unit_mark if question.unit_mark is not None and question.unit_mark >= 0 else 1
    places = question.decimal_places if question.decimal_places is not None and question.decimal_places >= 0 else None
    return MarkingRule(
        unit_rule=rule,
        answer_unit=unit,
        allow_conversion=bool(question.allow_unit_conversion),
        tolerance=parse_tolerance(question.numeric_tolerance),
        decimal_places=places,
        unit_mark=unit_mark,
    )


# The six fields as people name them (workbook headers, the Curriculum
# Studio form) -> the Question attribute each is stored in.
MARKING_FIELD_LABELS = {
    "answer_unit": "Answer Unit",
    "unit_rule": "Unit Rule",
    "allow_unit_conversion": "Allow Conversion",
    "numeric_tolerance": "Tolerance",
    "decimal_places": "Decimal Places",
    "unit_mark": "Unit Mark",
}
MAX_DECIMAL_PLACES = 6


def _blank(value) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


MAX_UNIT_MARK = 100
MAX_TOLERANCE_PLACES = 10


def _whole_number(value) -> int | None:
    """An int from 2, 2.0, "2" or " 2 "; None for anything else (2.5, "two",
    True, and anything with more than six digits, so "1e100000000" is never
    expanded)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if abs(value) < 10**6 else None
    try:
        number = Decimal(str(value).strip())
    except InvalidOperation:
        return None
    if not number.is_finite() or number.adjusted() >= 6 or number != number.to_integral_value():
        return None
    return int(number)


def clean_marking_fields(raw: dict) -> tuple[dict, list[tuple[str, str]]]:
    """Checks the marking fields given (keys are Question attribute names,
    only those present are looked at) and returns (values to store,
    problems as (field, sentence) pairs). A blank value clears the field. Used by the workbook import
    and the Curriculum Studio edit, so both accept exactly the same things."""
    values: dict = {}
    problems: list[tuple[str, str]] = []
    for key, value in raw.items():
        label = MARKING_FIELD_LABELS[key]
        if key == "allow_unit_conversion":
            word = "" if _blank(value) or isinstance(value, bool) else str(value).strip().lower()
            # 1 and 0 too: a spreadsheet often holds them for Yes and No.
            if value is True or word in ("yes", "y", "true", "1", "1.0"):
                values[key] = True
            elif _blank(value) or value is False or word in ("no", "n", "false", "0", "0.0"):
                values[key] = False
            else:
                problems.append((key, f"{label} must be Yes or No."))
            continue
        if _blank(value):
            values[key] = None
            continue
        if key == "answer_unit":
            code = units.unit_code(str(value))
            if code is None:
                problems.append((key, f"{label} \"{str(value).strip()[:30]}\" is not one of the units marking knows."))
            else:
                values[key] = code
        elif key == "unit_rule":
            rule = str(value).strip().upper()
            if rule not in UNIT_RULES:
                problems.append((key, f"{label} must be None, Stated or Required."))
            else:
                values[key] = rule
        elif key == "numeric_tolerance":
            tolerance = parse_tolerance(str(value))
            if tolerance is None:
                problems.append((key, f"{label} must be a number of 0 or more."))
            elif -tolerance.normalize().as_tuple().exponent > MAX_TOLERANCE_PLACES:
                problems.append((key, f"{label} can have at most {MAX_TOLERANCE_PLACES} decimal places."))
            else:
                text = format(tolerance.normalize(), "f")
                if len(text) > 20:
                    problems.append((key, f"{label} must be less than 1,000,000."))
                else:
                    values[key] = text
        elif key == "decimal_places":
            places = _whole_number(value)
            if places is None or not 0 <= places <= MAX_DECIMAL_PLACES:
                problems.append((key, f"{label} must be a whole number from 0 to {MAX_DECIMAL_PLACES}."))
            else:
                values[key] = places
        elif key == "unit_mark":
            mark = _whole_number(value)
            if mark is None or not 0 <= mark <= MAX_UNIT_MARK:
                problems.append((key, f"{label} must be a whole number from 0 to {MAX_UNIT_MARK}."))
            else:
                values[key] = mark
    return values, problems


def marking_notes(question: Question) -> list[str]:
    """What a content reviewer should know about how this question is
    marked. Advice, never a quality flag: a flag would stop bulk approval,
    and a question with no unit recorded is still marked correctly (as
    before)."""
    if (question.question_type or "").strip() != "Numeric Entry":
        return []
    rule = marking_rule(question)
    notes = []
    if rule.unit_rule in ("STATED", "REQUIRED") and not rule.answer_unit:
        if rule.unit_rule == "STATED":
            notes.append("Unit stated in the question, but the answer unit is not recorded.")
        else:
            notes.append("Unit required, but the answer unit is not recorded, so the unit is not checked yet.")
    if rule.unit_rule == "REQUIRED" and rule.answer_unit and question.marks and question.marks > 1 and rule.unit_mark >= question.marks:
        notes.append("The unit mark is the whole question's marks, so a missing unit gives 0.")
    return notes


def answer_instruction(question: Question) -> str | None:
    """The line shown under a student's answer box, or None. Stated names
    the unit ("Answer in grams."); Required does not, because naming it
    would answer half the question."""
    if (question.question_type or "").strip() != "Numeric Entry":
        return None
    rule = marking_rule(question)
    if not _uses_measured_marking(question, rule) or not rule.answer_unit:
        return None
    if rule.unit_rule == "STATED":
        return f"Answer in {units.unit_label(rule.answer_unit)}."
    if rule.unit_rule == "REQUIRED":
        return "Write the number and the unit."
    return None


def answer_needs_unit(question: Question) -> bool:
    """True when the child must write the unit (a REQUIRED unit that is
    recorded), so the answer box should offer letters, not a number pad."""
    rule = marking_rule(question)
    return rule.unit_rule == "REQUIRED" and bool(rule.answer_unit) and _uses_measured_marking(question, rule)


def answer_unit_label(question: Question) -> str | None:
    """The unit the correct answer is in, in words, for showing the answer
    key ("500 grams"); None when the unit plays no part in marking."""
    rule = marking_rule(question)
    if rule.unit_rule == "NONE" or not rule.answer_unit or not _uses_measured_marking(question, rule):
        return None
    key = units.parse_measurement(question.correct_answer)
    one = key is not None and key.unit is None and key.number == 1
    return units.unit_label(rule.answer_unit, plural=not one)  # "1 kilogram", "2 kilograms"


def grading_note_words(note: str | None, *, marks_lost: int | None = None) -> str | None:
    """A grading note as a sentence a student or teacher can read."""
    if note == WRONG_UNIT:
        return "Correct number, but in the wrong unit."
    if note == UNIT_MISSING:
        if marks_lost:
            word = "mark was" if marks_lost == 1 else "marks were"
            return f"Correct number, but the unit was missing, so {marks_lost} {word} taken off."
        return "Correct number, but the unit was missing."
    return None


def _uses_measured_marking(question: Question, rule: MarkingRule) -> bool:
    if (question.question_type or "").strip() != "Numeric Entry":
        return False
    if len([p for p in (question.correct_answer or "").split(";") if p.strip()]) != 1:
        return False  # several blanks: not in this PR (#160)
    if rule.unit_rule in ("STATED", "REQUIRED") and rule.answer_unit:
        return True
    return (rule.tolerance is not None and rule.tolerance > 0) or rule.decimal_places is not None


def _mark_against(given: units.Measurement, expected: units.Measurement, rule: MarkingRule, marks: int) -> GradeResult:
    """One answer against one correct value."""
    # Rule NONE: the number alone is marked, even when the key itself
    # carries a unit.
    expected_unit = None if rule.unit_rule == "NONE" else (expected.unit or rule.answer_unit)
    given = units.Measurement(given.number, units.reads_as(given.written, given.unit, expected_unit), given.written)

    def same(number: Decimal) -> bool:
        return units.numbers_match(number, expected.number, tolerance=rule.tolerance, decimal_places=rule.decimal_places)

    if given.unit is None or expected_unit is None:
        # No unit written, or none to check against (rule NONE, or the
        # answer unit not yet recorded): the number decides, and a written
        # unit is ignored, as marking always has.
        if not same(given.number):
            return GradeResult(False, 0)
        if given.unit is None and expected_unit is not None and rule.unit_rule == "REQUIRED":
            # Item 5: on a one-mark answer a missing required unit makes it
            # wrong; on a longer answer only the unit mark is lost.
            kept = 0 if marks <= 1 else max(marks - rule.unit_mark, 0)
            if kept >= marks:  # a unit mark of 0: nothing is lost
                return GradeResult(True, marks)
            return GradeResult(False, kept, UNIT_MISSING)
        return GradeResult(True, marks)

    if given.unit == expected_unit:
        return GradeResult(True, marks) if same(given.number) else GradeResult(False, 0)

    converted = units.convert(given.number, given.unit, expected_unit)
    if rule.allow_conversion and converted is not None:
        return GradeResult(True, marks) if same(converted) else GradeResult(False, 0)
    # Another unit, not allowed (or of another kind). Say why only when the
    # number itself was right ("250 kg" for 250 g), so the note never
    # suggests a wrong number was nearly right.
    return GradeResult(False, 0, WRONG_UNIT if same(given.number) else None)


def _grade_measured(question: Question, response: str, rule: MarkingRule) -> GradeResult:
    marks = question.marks
    if not response:
        return GradeResult(False, 0)
    # Accepted Variants always win: a listed variant written out exactly is
    # right, whatever the rules below would say ("2 kg 50 g"). Only the
    # variants: the key itself goes through the rules, or "12" would pass
    # as the key "12" where the unit is Required.
    variants = [v for v in (question.accepted_variants or "").split("|") if v.strip()]
    if any(_normalize_value(response) == _normalize_value(v) for v in variants):
        return GradeResult(True, marks)
    candidates = _candidate_answers(question)
    given = units.parse_measurement(response)
    checks_unit = rule.unit_rule != "NONE" and bool(rule.answer_unit)
    if given is None and not checks_unit:
        # Not one number with a known unit, and no unit to check: marked the
        # way it always was (found in review: "60 km/h", "1/2", "$250").
        is_correct, score = _grade_answer_text(question, response)
        return GradeResult(is_correct, score)
    best = GradeResult(False, 0)
    for candidate in candidates:
        expected = units.parse_measurement(candidate)
        if expected is None:
            # A key these rules cannot read ("60 km/h", "1/2") is compared
            # the old way, so it can never make a question impossible.
            if _blank_matches(response, candidate):
                return GradeResult(True, marks)
            continue
        if given is None:
            continue
        result = _mark_against(given, expected, rule, marks)
        if result.is_correct:
            return result
        # Keep the best of the wrong results: more marks first, then one
        # that can say why (a note) over one that cannot.
        if (result.score, result.note is not None) > (best.score, best.note is not None):
            best = result
    return best


def grade_answer_detail(question: Question, response_text: str | None) -> GradeResult:
    """grade_answer, with the reason for a unit mark lost or a wrong unit
    (GradeResult.note). submit_attempt records the note."""
    if question.auto_gradable:
        rule = marking_rule(question)
        if _uses_measured_marking(question, rule):
            return _grade_measured(question, (response_text or "").strip(), rule)
    is_correct, score = _grade_answer_text(question, response_text)
    return GradeResult(is_correct, score)


def grade_answer(question: Question, response_text: str | None) -> tuple[bool | None, int | None]:
    """(is_correct, auto_score). See _grade_answer_text, and
    grade_answer_detail for measured answers. A unit mark lost on a
    REQUIRED unit gives is_correct False with a score above 0."""
    result = grade_answer_detail(question, response_text)
    return result.is_correct, result.score


def _grade_answer_text(question: Question, response_text: str | None) -> tuple[bool | None, int | None]:
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
    elif question_type in ("Numeric Entry", "Text Entry", "Ordering"):
        # Numeric/Text Entry's semicolon-joined blanks and Ordering's
        # semicolon-joined sequence share identical per-blank/per-position
        # matching (both order-sensitive, both tolerant of the same
        # formatting noise via _blank_matches) -- one branch, not two
        # copy-pasted ones.
        if not response:
            is_correct = False
        else:
            response_blanks = [p for p in response.split(";") if p.strip()]
            is_correct = any(
                _blanks_match(response_blanks, [p for p in candidate.split(";") if p.strip()])
                for candidate in _candidate_answers(question)
            )
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
        api_error(409, "ATTEMPT_LOCKED", "This attempt is no longer in progress.")

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

        result = grade_answer_detail(question, answer.response_text)
        is_correct, score = result.is_correct, result.score
        answer.is_correct = is_correct
        answer.auto_score = score
        answer.grading_note = result.note
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


# --- Manual grading (1 Oct 2026) -------------------------------------------


def needs_manual_grade(answer: AttemptAnswer) -> bool:
    """True for an answer grade_answer left unscored on submit (auto_score
    IS NULL -- Constructed Response and any other non-auto-gradable type).
    These, and only these, are what a teacher marks; an auto-scored answer
    is never re-marked by hand (see AttemptAnswer.manual_score's comment)."""
    return answer.auto_score is None


def apply_manual_grades(
    db: Session,
    *,
    attempt: Attempt,
    grades: dict[str, int],
    grader_user_id: str,
) -> tuple[Evaluation, list[dict]]:
    """Records a teacher's marks for some or all of an attempt's unscored
    answers, then recomputes the attempt's Evaluation.

    `grades` maps question_id -> marks awarded. Partial submissions are
    fine (mark three answers now, the fourth later); re-marking an answer
    that already has a manual_score is a correction and simply replaces it
    -- including after the attempt is FINALISED, since a teacher who typed
    the wrong number must be able to fix it. Every change is returned as
    {questionId, previousScore, score, maxScore} so the route can write one
    audit row describing exactly what moved.

    Validation, all-or-nothing (nothing is written if any entry is bad):
      - the attempt must have been submitted (it has an Evaluation);
      - every question_id must be an answer on this attempt that needs a
        manual grade -- 422 for an auto-scored answer, 404-style 422 for a
        question that isn't on the attempt at all;
      - each score must be an integer in 0..that answer's own max_score
        (the snapshot taken at answer time, not today's Question.marks).

    Rollup: teacher_score = sum of manual_score over marked answers;
    final_score = auto_score + teacher_score. Once every answer that needs a
    manual grade has one, review_status flips PENDING_REVIEW -> FINALISED,
    the attempt moves SUBMITTED -> EVALUATED (the same status a fully
    auto-marked attempt gets on submit), and finalised_by/at are stamped.
    is_correct is set to "full marks or not" for a marked answer, so the
    existing correct/incorrect tallies (student result view, tracker) count
    it rather than leaving it permanently "pending".

    Does not commit -- the route logs its audit event and commits both in
    one transaction, audit_service.py's convention.
    """
    evaluation = db.query(Evaluation).filter(Evaluation.attempt_id == attempt.id).first()
    if not evaluation:
        api_error(422, "NOT_SUBMITTED", "This attempt hasn't been submitted yet.")
    if not grades:
        api_error(422, "VALIDATION_ERROR", "Enter at least one mark.")

    answers = {a.question_id: a for a in db.query(AttemptAnswer).filter(AttemptAnswer.attempt_id == attempt.id).all()}
    for question_id, score in grades.items():
        answer = answers.get(question_id)
        if answer is None:
            api_error(422, "VALIDATION_ERROR", "One of these questions isn't part of this attempt.")
        if not needs_manual_grade(answer):
            api_error(422, "NOT_MANUALLY_GRADABLE", "This answer was marked automatically and can't be re-marked by hand.")
        if isinstance(score, bool) or not isinstance(score, int):
            api_error(422, "VALIDATION_ERROR", "Marks must be a whole number.")
        if score < 0 or score > answer.max_score:
            api_error(
                422,
                "SCORE_OUT_OF_RANGE",
                f"Marks for this question must be between 0 and {answer.max_score}.",
            )

    now = datetime.now(timezone.utc)
    changes: list[dict] = []
    for question_id, score in grades.items():
        answer = answers[question_id]
        previous = answer.manual_score
        answer.manual_score = score
        answer.is_correct = score == answer.max_score
        answer.graded_by_user_id = grader_user_id
        answer.graded_at = now
        changes.append({"questionId": question_id, "previousScore": previous, "score": score, "maxScore": answer.max_score})

    manual_answers = [a for a in answers.values() if needs_manual_grade(a)]
    teacher_score = sum(a.manual_score for a in manual_answers if a.manual_score is not None)
    evaluation.teacher_score = teacher_score
    evaluation.final_score = evaluation.auto_score + teacher_score
    if all(a.manual_score is not None for a in manual_answers):
        if evaluation.review_status != "FINALISED":
            evaluation.review_status = "FINALISED"
            evaluation.finalised_by_user_id = grader_user_id
            evaluation.finalised_at = now
        attempt.status = "EVALUATED"
    return evaluation, changes


def get_result(db: Session, attempt_id: str) -> Evaluation | None:
    return db.query(Evaluation).filter(Evaluation.attempt_id == attempt_id).first()


def resolve_teacher_school_and_assignable_check(db: Session, teacher: Teacher) -> School:
    school = db.get(School, teacher.school_id)
    if not school:
        api_error(404, "NOT_FOUND", "That school couldn't be found.")
    return school
