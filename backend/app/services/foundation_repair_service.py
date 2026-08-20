"""Foundation Repair (blueprint Section 11): "Store prerequisites as
concept-to-concept links, not as a text note. This allows the platform to
identify why a current chapter is failing and assign the correct earlier
skill." Implements the blueprint's own pseudocode almost directly:

    if current_concept_score < secure_threshold:
        gaps = find_unsecured_prerequisites(student_id, concept_id)
        if gaps:
            recommend(rescue_activity_for(gaps[0]))
        else:
            recommend(current_concept_reteach_activity)

A recommendation is just that -- a suggestion for a teacher to review, never
an automatic assignment (Section 11: "Recommendations may be automatic;
assignment to a class or individual remains under teacher control unless the
school enables auto-assignment" -- no school-level auto-assign setting
exists yet, so every recommendation from get_recommendation() below requires
a teacher to call approve_recommendation() before a real Assignment exists).

Known, deliberate limitation, carried over honestly from Phase 2: real
PrerequisiteLink edges are not populated yet (curriculum.py's own module
docstring: "resolving that to an actual concept_lesson_id reliably needs
either cross-chapter human review ... Phase 3 work, not invented here").
This module builds and tests the mechanism against synthetic links
(tests/test_learning.py); it does not itself populate real ones. Until a
human (or reviewed matching pass) adds real PrerequisiteLink rows, every
real concept lesson simply has zero prerequisites recorded, so
get_recommendation() always falls through to the "reteach current concept"
branch for it, never a real cross-chapter rescue -- correct behaviour given
the data, not a bug.

Never infers "carelessness" or a gap from a single wrong answer (Section 11:
"Do not infer 'carelessness' from one wrong answer. Use repeated error
patterns") -- compute_concept_mastery below always averages across a
student's completed attempts for a concept, never looks at one answer.
"""
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.models import (
    Assignment,
    AssignmentTarget,
    Attempt,
    ConceptLesson,
    Evaluation,
    LearningActivity,
    PrerequisiteLink,
    School,
    Student,
    Teacher,
)

# Default "secure" mastery threshold when a PrerequisiteLink doesn't specify
# its own minimum_mastery, and for judging the CURRENT concept's own score
# (the blueprint's pseudocode calls this "secure_threshold" without pinning
# a number -- 70% is a documented, adjustable starting point, not a
# client-confirmed figure).
DEFAULT_SECURE_THRESHOLD_PERCENT = 70

# Preference order when picking which LearningActivity to recommend for a
# concept -- REMEDIATION is the content team's own purpose-built rescue set
# ("auto-assign below the agreed skill threshold", see learning_service.py's
# module docstring) where it exists; CORE_PRACTICE is the fallback for a
# concept that has no dedicated remediation content yet.
_RESCUE_ACTIVITY_TYPE_PREFERENCE = ("REMEDIATION", "CORE_PRACTICE")


@dataclass
class FoundationRepairRecommendation:
    recommendation: str  # "NONE" | "PREREQUISITE_GAP" | "LOW_ACCURACY"
    concept_lesson_id: str
    current_score_percent: float | None
    gap_concept_lesson_id: str | None
    gap_prerequisite_link_id: str | None
    recommended_activity: LearningActivity | None
    explanation: str


def compute_concept_mastery(db: Session, student: Student, concept_lesson_id: str) -> float | None:
    """Average final_score/max_score (%) across this student's EVALUATED
    attempts for CORE_PRACTICE activities of this concept. None if the
    student has no completed attempts yet -- "unknown", not "zero"; a
    concept nobody has tried isn't a demonstrated gap."""
    rows = (
        db.query(Evaluation)
        .join(Attempt, Evaluation.attempt_id == Attempt.id)
        .join(AssignmentTarget, Attempt.assignment_target_id == AssignmentTarget.id)
        .join(Assignment, AssignmentTarget.assignment_id == Assignment.id)
        .join(LearningActivity, Assignment.learning_activity_id == LearningActivity.id)
        .filter(
            AssignmentTarget.student_id == student.id,
            LearningActivity.concept_lesson_id == concept_lesson_id,
            LearningActivity.activity_type == "CORE_PRACTICE",
            Evaluation.max_score > 0,
        )
        .all()
    )
    if not rows:
        return None
    total_final = sum(e.final_score for e in rows)
    total_max = sum(e.max_score for e in rows)
    if total_max == 0:
        return None
    return round(100.0 * total_final / total_max, 1)


def _find_rescue_activity(db: Session, concept_lesson_id: str) -> LearningActivity | None:
    for activity_type in _RESCUE_ACTIVITY_TYPE_PREFERENCE:
        activity = (
            db.query(LearningActivity)
            .filter(
                LearningActivity.concept_lesson_id == concept_lesson_id,
                LearningActivity.activity_type == activity_type,
                LearningActivity.status == "PUBLISHED",
            )
            .first()
        )
        if activity:
            return activity
    return None


def get_recommendation(db: Session, student: Student, concept_lesson: ConceptLesson) -> FoundationRepairRecommendation:
    current_score = compute_concept_mastery(db, student, concept_lesson.id)
    if current_score is None or current_score >= DEFAULT_SECURE_THRESHOLD_PERCENT:
        return FoundationRepairRecommendation(
            recommendation="NONE",
            concept_lesson_id=concept_lesson.id,
            current_score_percent=current_score,
            gap_concept_lesson_id=None,
            gap_prerequisite_link_id=None,
            recommended_activity=None,
            explanation="No intervention needed." if current_score is None else f"Mastery is {current_score}%, at or above the {DEFAULT_SECURE_THRESHOLD_PERCENT}% secure threshold.",
        )

    links = db.query(PrerequisiteLink).filter(PrerequisiteLink.concept_lesson_id == concept_lesson.id).order_by(PrerequisiteLink.created_at).all()
    for link in links:
        threshold = link.minimum_mastery or DEFAULT_SECURE_THRESHOLD_PERCENT
        prereq_score = compute_concept_mastery(db, student, link.prerequisite_concept_lesson_id)
        if prereq_score is not None and prereq_score >= threshold:
            continue  # this prerequisite is secure -- not the gap
        rescue_activity = _find_rescue_activity(db, link.prerequisite_concept_lesson_id)
        return FoundationRepairRecommendation(
            recommendation="PREREQUISITE_GAP",
            concept_lesson_id=concept_lesson.id,
            current_score_percent=current_score,
            gap_concept_lesson_id=link.prerequisite_concept_lesson_id,
            gap_prerequisite_link_id=link.id,
            recommended_activity=rescue_activity,
            explanation=(
                f"{concept_lesson.title} is at {current_score}% and prerequisite "
                f"{link.prerequisite_concept_lesson.title!r} is "
                f"{'untested' if prereq_score is None else f'{prereq_score}%'} "
                f"(below its {threshold}% threshold)."
            ),
        )

    # No unsecured prerequisite found (or none recorded yet) -- reteach the
    # current concept itself.
    rescue_activity = _find_rescue_activity(db, concept_lesson.id)
    return FoundationRepairRecommendation(
        recommendation="LOW_ACCURACY",
        concept_lesson_id=concept_lesson.id,
        current_score_percent=current_score,
        gap_concept_lesson_id=None,
        gap_prerequisite_link_id=None,
        recommended_activity=rescue_activity,
        explanation=f"{concept_lesson.title} is at {current_score}%, below the {DEFAULT_SECURE_THRESHOLD_PERCENT}% secure threshold, with no unsecured prerequisite found.",
    )


def approve_recommendation(
    db: Session,
    *,
    school: School,
    teacher: Teacher,
    student: Student,
    recommendation: FoundationRepairRecommendation,
) -> Assignment:
    """Teacher-in-the-loop step turning a recommendation into a real
    Assignment (Section 11: assignment stays under teacher control)."""
    from app.services.learning_service import create_assignment  # local import avoids a service-to-service circular import

    if recommendation.recommendation == "NONE" or not recommendation.recommended_activity:
        api_error(422, "NO_RECOMMENDATION", "There is no Foundation Repair recommendation to approve for this student/concept.")

    return create_assignment(
        db,
        school=school,
        learning_activity=recommendation.recommended_activity,
        assigned_by_user_id=teacher.user_id,
        class_name=None,
        student_ids=[student.id],
        reason="PREREQUISITE_GAP" if recommendation.recommendation == "PREREQUISITE_GAP" else "LOW_ACCURACY",
        source_prerequisite_link_id=recommendation.gap_prerequisite_link_id,
    )
