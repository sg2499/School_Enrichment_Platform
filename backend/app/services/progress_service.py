"""My Progress (#184, 26 Oct 2026): a student's skill map, and practice
they choose themselves on a weak skill.

Decisions (Shailesh, 26 Oct 2026; PHASE6_MY_PROGRESS_DESIGN.md):

- A skill's score uses each question's latest marked answer, across every
  set the student handed in: marks earned / marks possible.
- Bands: Strong 80%+, Getting There 50-79%, Needs Work below 50%, from 3
  marked questions on the skill; fewer is "Just Started"; none is "Not
  Started".
- Self-practice: the student may open the published Extra Practice or
  Remediation set of a skill that is Needs Work or Getting There. It is an
  ordinary assignment with reason SELF_PRACTICE, and is left out of term
  marks (assessment_service), the tracker's assignment list and per-student
  numbers, and the student's Daily Practice list.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.core.errors import api_error
from app.models import (
    Assignment,
    BoardCourse,
    AssignmentTarget,
    Attempt,
    AttemptAnswer,
    Chapter,
    ClassLevel,
    ConceptLesson,
    LearningActivity,
    LearningActivityQuestion,
    Question,
    SchoolCurriculumMap,
    Student,
)

SELF_PRACTICE = "SELF_PRACTICE"
SELF_PRACTICE_TYPES = ("REMEDIATION", "EXTRA_PRACTICE")
SELF_PRACTICE_MAX_ATTEMPTS = 3
SELF_PRACTICE_DAILY_LIMIT = 10

STRONG_PERCENT = 80
GETTING_THERE_PERCENT = 50
MIN_ANSWERS_FOR_BAND = 3
PRACTISE_NEXT_LIMIT = 3

STRONG, GETTING_THERE, NEEDS_WORK, JUST_STARTED, NOT_STARTED = (
    "STRONG",
    "GETTING_THERE",
    "NEEDS_WORK",
    "JUST_STARTED",
    "NOT_STARTED",
)
WEAK_BANDS = (NEEDS_WORK, GETTING_THERE)

_IST = timezone(timedelta(hours=5, minutes=30), "IST")
UTC_FALLBACK = timezone.utc
_HANDED_IN = ("SUBMITTED", "EVALUATED")


def band_for(percent: float | None, answered: int) -> str:
    if answered == 0 or percent is None:
        return NOT_STARTED
    if answered < MIN_ANSWERS_FOR_BAND:
        return JUST_STARTED
    if percent >= STRONG_PERCENT:
        return STRONG
    if percent >= GETTING_THERE_PERCENT:
        return GETTING_THERE
    return NEEDS_WORK


@dataclass
class SkillScore:
    earned: float = 0.0
    possible: int = 0
    answered: int = 0
    last_at: datetime | None = None

    @property
    def exact_percent(self) -> float | None:
        """Unrounded: bands are judged on this, so 49.96% is not Getting There."""
        if self.possible <= 0:
            return None
        return 100.0 * self.earned / self.possible

    @property
    def percent(self) -> float | None:
        exact = self.exact_percent
        return None if exact is None else round(exact, 1)


@dataclass
class _Latest:
    when: tuple
    score: int
    possible: int
    submitted_at: datetime | None


def _answer_score(manual: int | None, auto: int | None) -> int | None:
    return manual if manual is not None else auto


def skill_scores(db: Session, student: Student, assignment_clause=None) -> dict[str, SkillScore]:
    """concept_lesson_id -> the student's score on it, from each question's
    latest marked answer. `assignment_clause` narrows which assignments'
    answers count (a teacher sees only what they can read)."""
    query = (
        db.query(
            AttemptAnswer.question_id,
            AttemptAnswer.manual_score,
            AttemptAnswer.auto_score,
            AttemptAnswer.max_score,
            Attempt.submitted_at,
            Attempt.attempt_number,
            Attempt.id,
            Question.concept_lesson_id,
        )
        .join(Attempt, Attempt.id == AttemptAnswer.attempt_id)
        .join(AssignmentTarget, AssignmentTarget.id == Attempt.assignment_target_id)
        .join(Assignment, Assignment.id == AssignmentTarget.assignment_id)
        .join(Question, Question.id == AttemptAnswer.question_id)
        .filter(
            AssignmentTarget.student_id == student.id,
            Attempt.status.in_(_HANDED_IN),
            Assignment.status != "CANCELLED",
        )
    )
    if assignment_clause is not None:
        query = query.filter(assignment_clause)

    latest: dict[str, tuple[str, _Latest]] = {}
    for question_id, manual, auto, max_score, submitted_at, number, attempt_id, skill_id in query.all():
        score = _answer_score(manual, auto)
        if score is None or not max_score or max_score <= 0:
            # A written answer still waiting for its mark: the question's
            # earlier marked answer, if any, counts instead.
            continue
        stamp = submitted_at or datetime.min.replace(tzinfo=UTC_FALLBACK)
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=UTC_FALLBACK)
        key = (stamp, number, attempt_id)
        current = latest.get(question_id)
        if current is None or key > current[1].when:
            latest[question_id] = (skill_id, _Latest(key, max(0, min(score, max_score)), max_score, stamp))

    scores: dict[str, SkillScore] = {}
    for skill_id, item in latest.values():
        entry = scores.setdefault(skill_id, SkillScore())
        entry.earned += item.score
        entry.possible += item.possible
        entry.answered += 1
        if entry.last_at is None or item.submitted_at > entry.last_at:
            entry.last_at = item.submitted_at
    return scores



def _mapped_chapters(db: Session, student: Student) -> list[Chapter]:
    """Published chapters mapped to the student's school for their class, in
    the school's order."""
    rows = (
        db.query(SchoolCurriculumMap, Chapter)
        .join(Chapter, Chapter.id == SchoolCurriculumMap.chapter_id)
        .filter(
            SchoolCurriculumMap.school_id == student.school_id,
            Chapter.status == "PUBLISHED",
            # Matched by the exact class, as the school's map screens do; a
            # map row with no class is not "every class" (#184 review).
            SchoolCurriculumMap.class_name == student.class_name,
        )
        .order_by(SchoolCurriculumMap.sequence, Chapter.sequence, Chapter.chapter_no)
        .all()
    )
    seen: set[str] = set()
    chapters: list[Chapter] = []
    for _, chapter in rows:
        if chapter.id not in seen:
            seen.add(chapter.id)
            chapters.append(chapter)
    return chapters


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


@dataclass
class SkillRow:
    skill: ConceptLesson
    chapter: Chapter
    score: SkillScore | None
    band: str = field(init=False)

    def __post_init__(self):
        self.band = band_for(self.score.exact_percent if self.score else None, self.score.answered if self.score else 0)

    @property
    def percent(self) -> float | None:
        return self.score.percent if self.score else None


def skill_rows(db: Session, student: Student, assignment_clause=None) -> list[SkillRow]:
    scores = skill_scores(db, student, assignment_clause)
    chapters = _mapped_chapters(db, student)
    chapter_ids = [c.id for c in chapters]
    skills = (
        db.query(ConceptLesson)
        .filter(ConceptLesson.chapter_id.in_(chapter_ids), ConceptLesson.status == "PUBLISHED")
        .all()
        if chapter_ids
        else []
    )
    listed = {s.id for s in skills}
    # A skill the student has answered stays on the map even if its chapter
    # is no longer mapped or published.
    extra_ids = [sid for sid in scores if sid not in listed]
    if extra_ids:
        extra = db.query(ConceptLesson).filter(ConceptLesson.id.in_(extra_ids)).all()
        skills.extend(extra)
        known = set(chapter_ids)
        for chapter in db.query(Chapter).filter(Chapter.id.in_({s.chapter_id for s in extra} - known)).all():
            chapters.append(chapter)
    order = {c.id: i for i, c in enumerate(chapters)}
    by_chapter = {c.id: c for c in chapters}
    skills.sort(key=lambda s: (order.get(s.chapter_id, 9999), s.sequence, s.code))
    return [SkillRow(s, by_chapter[s.chapter_id], scores.get(s.id)) for s in skills if s.chapter_id in by_chapter]


def _activity_question_counts(db: Session, activity_ids: list[str]) -> dict[str, int]:
    if not activity_ids:
        return {}
    return dict(
        db.query(LearningActivityQuestion.learning_activity_id, func.count(LearningActivityQuestion.id))
        .filter(LearningActivityQuestion.learning_activity_id.in_(activity_ids))
        .group_by(LearningActivityQuestion.learning_activity_id)
        .all()
    )


def _self_practice_sets(db: Session, skill_ids: list[str], chapter_ids: list[str]) -> dict[str, list[LearningActivity]]:
    """The published Extra Practice and Remediation sets of these skills, from
    the student's mapped chapters only: the same rule start_self_practice
    checks, so nothing is offered that would then be refused."""
    if not skill_ids or not chapter_ids:
        return {}
    rows = (
        db.query(LearningActivity)
        .filter(
            LearningActivity.concept_lesson_id.in_(skill_ids),
            LearningActivity.chapter_id.in_(chapter_ids),
            LearningActivity.activity_type.in_(SELF_PRACTICE_TYPES),
            LearningActivity.status == "PUBLISHED",
        )
        .order_by(LearningActivity.sequence, LearningActivity.title)
        .all()
    )
    grouped: dict[str, list[LearningActivity]] = {}
    for activity in rows:
        grouped.setdefault(activity.concept_lesson_id, []).append(activity)
    return grouped


def _attempt_counts(db: Session, target_ids: list[str]) -> dict[str, tuple[int, bool]]:
    """target id -> (attempts made, one in progress)."""
    if not target_ids:
        return {}
    counts: dict[str, tuple[int, bool]] = {tid: (0, False) for tid in target_ids}
    for target_id, status in db.query(Attempt.assignment_target_id, Attempt.status).filter(
        Attempt.assignment_target_id.in_(target_ids)
    ):
        made, open_ = counts[target_id]
        counts[target_id] = (made + 1, open_ or status == "IN_PROGRESS")
    return counts


def _self_practice_targets(db: Session, student: Student) -> list[tuple[AssignmentTarget, Assignment]]:
    return (
        db.query(AssignmentTarget, Assignment)
        .join(Assignment, Assignment.id == AssignmentTarget.assignment_id)
        .options(joinedload(Assignment.learning_activity))
        .filter(
            AssignmentTarget.student_id == student.id,
            Assignment.reason == SELF_PRACTICE,
            Assignment.status != "CANCELLED",
        )
        .order_by(Assignment.created_at.desc(), Assignment.id.desc())
        .all()
    )


def _open_target(
    pairs: list[tuple[AssignmentTarget, Assignment]], counts: dict[str, tuple[int, bool]], activity_id: str
) -> AssignmentTarget | None:
    """The student's self-practice of this set that can still be used: one in
    progress, or with attempts left."""
    for target, assignment in pairs:
        if assignment.learning_activity_id != activity_id or assignment.status != "ACTIVE":
            continue
        made, in_progress = counts.get(target.id, (0, False))
        if in_progress or made < assignment.max_attempts + (target.bonus_attempts or 0):
            return target
    return None


def _open_target_id(pairs, counts, activity_id: str) -> str | None:
    target = _open_target(pairs, counts, activity_id)
    return target.id if target else None


def _open_target_status(pairs, counts, activity_id: str) -> str | None:
    """IN_PROGRESS (carry on), COMPLETED (another attempt) or PENDING."""
    target = _open_target(pairs, counts, activity_id)
    if target is None:
        return None
    return "IN_PROGRESS" if counts.get(target.id, (0, False))[1] else target.status


def _skill_dict(row: SkillRow) -> dict:
    return {
        "id": row.skill.id,
        "code": row.skill.code,
        "title": row.skill.title,
        "percent": row.percent,
        "answered": row.score.answered if row.score else 0,
        "band": row.band,
        "lastPractisedAt": _iso(row.score.last_at) if row.score else None,
    }


def progress_payload(db: Session, student: Student, *, assignment_clause=None, for_student: bool) -> dict:
    rows = skill_rows(db, student, assignment_clause)

    chapters: list[dict] = []
    index: dict[str, dict] = {}
    for row in rows:
        entry = index.get(row.chapter.id)
        if entry is None:
            entry = {
                "id": row.chapter.id,
                "code": row.chapter.code,
                "chapterNo": row.chapter.chapter_no,
                "title": row.chapter.title,
                "skills": [],
            }
            index[row.chapter.id] = entry
            chapters.append(entry)
        entry["skills"].append(_skill_dict(row))

    summary = {STRONG: 0, GETTING_THERE: 0, NEEDS_WORK: 0, JUST_STARTED: 0, NOT_STARTED: 0}
    for row in rows:
        summary[row.band] += 1
    practised = [r for r in rows if r.score and r.score.possible > 0]
    earned = sum(r.score.earned for r in practised)
    possible = sum(r.score.possible for r in practised)

    weak = sorted(
        (r for r in rows if r.band in WEAK_BANDS),
        key=lambda r: (0 if r.band == NEEDS_WORK else 1, r.percent if r.percent is not None else 0, r.skill.code),
    )[:PRACTISE_NEXT_LIMIT]

    sets = _self_practice_sets(db, [r.skill.id for r in weak], [c.id for c in _mapped_chapters(db, student)])
    question_counts = _activity_question_counts(db, [a.id for group in sets.values() for a in group])
    own_pairs = _self_practice_targets(db, student) if for_student else []
    counts = _attempt_counts(db, [t.id for t, _ in own_pairs])

    # The student's open teacher-set work on those skills.
    assigned: dict[str, list[dict]] = {}
    if for_student and weak:
        for target, assignment, activity in (
            db.query(AssignmentTarget, Assignment, LearningActivity)
            .join(Assignment, Assignment.id == AssignmentTarget.assignment_id)
            .join(LearningActivity, LearningActivity.id == Assignment.learning_activity_id)
            .filter(
                AssignmentTarget.student_id == student.id,
                Assignment.reason != SELF_PRACTICE,
                Assignment.status == "ACTIVE",
                AssignmentTarget.status.in_(("PENDING", "IN_PROGRESS")),
                LearningActivity.concept_lesson_id.in_([r.skill.id for r in weak]),
            )
            .order_by(Assignment.created_at.desc())
            .all()
        ):
            assigned.setdefault(activity.concept_lesson_id, []).append(
                {
                    "assignmentTargetId": target.id,
                    "learningActivityId": activity.id,
                    "title": activity.title,
                    "activityType": activity.activity_type,
                    "status": target.status,
                    "dueDate": assignment.due_date,
                }
            )

    practise_next = []
    for row in weak:
        # A set the teacher has already set for this student is done from
        # there, so it counts; it is not offered again as self-practice.
        teacher_set = {item["learningActivityId"] for item in assigned.get(row.skill.id, [])}
        group = [a for a in sets.get(row.skill.id, []) if a.id not in teacher_set]
        if row.band == NEEDS_WORK:
            group.sort(key=lambda a: 0 if a.activity_type == "REMEDIATION" else 1)
        else:
            group.sort(key=lambda a: 0 if a.activity_type == "EXTRA_PRACTICE" else 1)
        practise_next.append(
            {
                "skill": {**_skill_dict(row), "chapterTitle": row.chapter.title},
                "assigned": assigned.get(row.skill.id, []),
                "selfPractice": [
                    {
                        "learningActivityId": a.id,
                        "title": a.title,
                        "activityType": a.activity_type,
                        "questionCount": question_counts.get(a.id, 0),
                        "estimatedMinutes": a.estimated_minutes,
                        "openTargetId": _open_target_id(own_pairs, counts, a.id),
                        "openTargetStatus": _open_target_status(own_pairs, counts, a.id),
                    }
                    for a in group
                ],
            }
        )

    payload = {
        "student": {
            "id": student.id,
            "name": student.user.full_name if getattr(student, "user", None) else None,
            "studentCode": student.student_code,
            "className": student.class_name,
            "section": student.section,
        },
        "thresholds": {
            "strong": STRONG_PERCENT,
            "gettingThere": GETTING_THERE_PERCENT,
            "minAnswers": MIN_ANSWERS_FOR_BAND,
        },
        "summary": {
            "strong": summary[STRONG],
            "gettingThere": summary[GETTING_THERE],
            "needsWork": summary[NEEDS_WORK],
            "justStarted": summary[JUST_STARTED],
            "notStarted": summary[NOT_STARTED],
            "skills": len(rows),
            "overallPercent": round(100.0 * earned / possible, 1) if possible else None,
        },
        "chapters": chapters,
        "practiseNext": practise_next,
    }
    if for_student:
        payload["selfPractice"] = _self_practice_history(db, own_pairs, counts)
    return payload


def _self_practice_history(
    db: Session, pairs: list[tuple[AssignmentTarget, Assignment]], counts: dict[str, tuple[int, bool]]
) -> list[dict]:
    from app.models import Evaluation

    if not pairs:
        return []
    target_ids = [t.id for t, _ in pairs]
    latest: dict[str, tuple[Attempt, Evaluation | None]] = {}
    for attempt, evaluation in (
        db.query(Attempt, Evaluation)
        .outerjoin(Evaluation, Evaluation.attempt_id == Attempt.id)
        .filter(Attempt.assignment_target_id.in_(target_ids))
        .all()
    ):
        current = latest.get(attempt.assignment_target_id)
        if current is None or attempt.attempt_number > current[0].attempt_number:
            latest[attempt.assignment_target_id] = (attempt, evaluation)
    items = []
    for target, assignment in pairs[:20]:
        activity = assignment.learning_activity
        made, in_progress = counts.get(target.id, (0, False))
        last = latest.get(target.id)
        attempt, evaluation = last if last else (None, None)
        items.append(
            {
                "assignmentTargetId": target.id,
                "title": activity.title if activity else None,
                "activityType": activity.activity_type if activity else None,
                "status": target.status,
                "startedAt": _iso(assignment.created_at),
                "attemptsMade": made,
                "maxAttempts": assignment.max_attempts + (target.bonus_attempts or 0),
                "latestAttempt": (
                    {
                        "id": attempt.id,
                        "attemptNumber": attempt.attempt_number,
                        "status": attempt.status,
                        "finalScore": evaluation.final_score if evaluation else None,
                        "maxScore": evaluation.max_score if evaluation else None,
                        "reviewStatus": evaluation.review_status if evaluation else None,
                    }
                    if attempt
                    else None
                ),
            }
        )
    return items


def start_self_practice(db: Session, student: Student, learning_activity_id: str) -> AssignmentTarget:
    """The student's self-practice of a set: an open one is reused, else a
    new one is made. Refused unless the set may be self-practised by this
    student now (see module docstring)."""
    from app.services import learning_service

    activity = db.get(LearningActivity, learning_activity_id)
    if (
        activity is None
        or activity.status != "PUBLISHED"
        or activity.activity_type not in SELF_PRACTICE_TYPES
        or not activity.concept_lesson_id
    ):
        api_error(404, "NOT_FOUND", "That practice set isn't available for you to practise on your own.")
    chapter = db.get(Chapter, activity.chapter_id)
    skill = db.get(ConceptLesson, activity.concept_lesson_id)
    if (
        chapter is None
        or chapter.id not in {c.id for c in _mapped_chapters(db, student)}
        or skill is None
        or skill.status != "PUBLISHED"
    ):
        api_error(404, "NOT_FOUND", "That practice set isn't available for you to practise on your own.")

    # The teacher has set this one: it is done from Daily Practice, where it
    # counts (#184 review), not as a copy that doesn't.
    teacher_set = (
        db.query(AssignmentTarget.id)
        .join(Assignment, Assignment.id == AssignmentTarget.assignment_id)
        .filter(
            AssignmentTarget.student_id == student.id,
            Assignment.learning_activity_id == activity.id,
            Assignment.reason != SELF_PRACTICE,
            Assignment.status == "ACTIVE",
            AssignmentTarget.status.in_(("PENDING", "IN_PROGRESS")),
        )
        .first()
    )
    if teacher_set is not None:
        api_error(409, "SET_BY_TEACHER", "Your teacher has set this practice for you. Open it from Daily Practice.")

    pairs = _self_practice_targets(db, student)
    counts = _attempt_counts(db, [t.id for t, _ in pairs])
    reuse = _open_target(pairs, counts, activity.id)
    if reuse is not None:
        return reuse

    scores = skill_scores(db, student)
    score = scores.get(activity.concept_lesson_id)
    band = band_for(score.exact_percent if score else None, score.answered if score else 0)
    if band not in WEAK_BANDS:
        api_error(
            422,
            "NOT_A_WEAK_SKILL",
            "You can practise a skill on your own once it shows Needs Work or Getting There on My Progress.",
        )

    start_of_day = datetime.now(_IST).replace(hour=0, minute=0, second=0, microsecond=0)
    made_today = (
        db.query(func.count(Assignment.id))
        .join(AssignmentTarget, AssignmentTarget.assignment_id == Assignment.id)
        .filter(
            AssignmentTarget.student_id == student.id,
            Assignment.reason == SELF_PRACTICE,
            Assignment.created_at >= start_of_day.astimezone(timezone.utc),
        )
        .scalar()
        or 0
    )
    if made_today >= SELF_PRACTICE_DAILY_LIMIT:
        api_error(
            429,
            "SELF_PRACTICE_LIMIT",
            f"You've started {SELF_PRACTICE_DAILY_LIMIT} practice sets on your own today. Finish those, and come back tomorrow for more.",
        )

    # Recorded as the student's own section's, so the teacher of that section
    # can read it and mark any written answer in it. Without a whole section
    # (class, section, and the chapter's course for that class) no teacher
    # could, so it is refused (#184 review).
    class_level_id = student.class_level_id
    if class_level_id is None and student.class_name:
        level = db.query(ClassLevel).filter(ClassLevel.code == student.class_name).first()
        class_level_id = level.id if level else None
    section = (student.section or "").strip() or None
    course = db.get(BoardCourse, chapter.board_course_id)
    if not class_level_id or not section or course is None or course.class_level_id != class_level_id:
        api_error(
            422,
            "SECTION_NOT_SET",
            "Practice on your own needs your class and section set up first. Please ask your teacher or school admin.",
        )
    assignment = learning_service.create_assignment(
        db,
        school=student.school,
        learning_activity=activity,
        assigned_by_user_id=student.user_id,
        class_name=student.class_name,
        student_ids=[student.id],
        reason=SELF_PRACTICE,
        max_attempts=SELF_PRACTICE_MAX_ATTEMPTS,
        section_scope=(class_level_id, section, chapter.board_course_id),
    )
    return db.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == assignment.id).one()
