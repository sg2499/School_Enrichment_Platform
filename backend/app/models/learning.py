"""Phase 3 (Five-day learning loop) model set: Learning Activity, Assignment,
Attempt, and Evaluation -- the delivery/attempt mechanics that curriculum.py's
own module docstring explicitly deferred ("Delivery/attempt mechanics
(Assignment, Attempt, evaluation) are explicitly NOT built here -- Phase 3/4
per IMPLEMENTATION_ROADMAP.md").

Built against three sources, in this order of authority: the blueprint
(`Docs/School_Enrichment_Standalone_Platform_Developer_Blueprint.docx`,
Section 6.3 "Content, delivery and evaluation tables", Section 8 "Question
and evaluation engine", Section 10 "Learning activity structure", Section 11
"Foundation Repair logic"), the client's 17 Aug clarifications (pacing model,
Section 7 item 2), and -- like Phase 2 before it -- the real, already-loaded
CBSE Class 5 Chapter 1 content (`Content/CBSE_Class_5_Chapter_1.xlsx`,
"Assignment Plan" sheet), inspected directly rather than assumed.

Why `activity_type` doesn't literally say "DPS 1".."DPS 5": the blueprint's
Table 14 describes an abstract five-slot pattern (recall, concept practice,
application, reasoning, timed mastery). The REAL content wasn't authored that
way -- Chapter 1's Assignment Plan groups each skill's core practice into
ONE combined 8-item set per skill ("Guided -> fluency -> application ->
reasoning -> remediation for C5-WT1-S01", delivered as a single "Week 1, Day
1" assignment), not five separate per-skill sheets, plus three real
supplementary pools per skill (adaptive expansion, auto-triggered
remediation, extension/challenge) the blueprint's abstract pattern doesn't
name at all. Forcing the real data into invented "DPS_1".."DPS_5" labels
would be exactly the kind of guessed-at schema Phase 2's own docstring
warned against. Instead `activity_type` names the real, verified content
units directly (see `app.services.learning_service.classify_assignment_code`
for the exact mapping, checked against Chapter 1's Assignment Plan sheet):

  PREREQUISITE_CHECK -- one per skill, from the chapter-wide diagnostic
                        (CH0X-DIAG / -DIAG-B), sliced by skill.
  CORE_PRACTICE       -- one per skill, the single combined guided/fluency/
                        application/reasoning/remediation set (CH0X-P0Y).
  EXTRA_PRACTICE       -- adaptive expansion pools (CH0X-XA-S0Y / -XB-S0Y).
  REMEDIATION          -- auto-assign-below-threshold rescue set
                        (CH0X-REM-S0Y) -- this is the concrete content
                        Foundation Repair recommends into, see
                        foundation_repair_service.py.
  CHALLENGE            -- extension/enrichment (CH0X-ADV-S0Y).
  CASE_STUDY           -- chapter-scoped, where present (CH0X-CASE).
  CHAPTER_MASTERY       -- chapter-scoped capstone (CH0X-MASTERY).
  CONCEPT_SIMPLE        -- kept in the vocabulary for the blueprint's "PDF
                        upload for teacher notes / richer academic content"
                        step (Section 10), but the generation service never
                        creates rows of this type from Question data -- no
                        such content exists in the question bank (it isn't a
                        question at all). A teacher/admin content-authoring
                        flow for this is explicitly out of scope here.

`pacing_day` (1-5) is the DEFAULT slot in the client-confirmed five-day
cadence (Day 1 learn + starting check, Day 2 guided practice, Day 3 apply,
Day 4 extra practice on weak areas, Day 5 short final check) -- see
`learning_service.DEFAULT_PACING_DAY` for the exact, documented mapping and
its honest gaps (no per-skill "day 5 short final check" content exists in
the real data yet). Nullable and never enforced server-side as a hard gate:
per the client's own instruction ("must be configurable per teacher/class,
not hard-coded either way"), a teacher may run the same content on a
stretched 3-week cadence via Assignment.pacing_mode -- pacing_day is
scheduling guidance the frontend/teacher calendar can use, not a constraint
the attempt-lifecycle logic below ever checks.

Evaluation here covers AUTO only (blueprint 8.1's `auto_score`/`final_score`
split, minus `teacher_score`/`rubric_version_id`/override fields -- those are
Phase 4 territory once HYBRID/HANUAL subjective content exists). Every
Class 5 Maths question currently in the bank is `auto_gradable=True`
(496/500 in Chapter 1; the 4 non-auto-gradable Constructed Response items are
graded manually and simply never receive an `auto_score` here -- see
`learning_service.grade_answer`), so AUTO is the only evaluation_mode Phase 3
needs to fully support end to end.
"""
import uuid

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship

from app.database import Base


def uuid_str() -> str:
    return str(uuid.uuid4())


# Kept as plain string columns (matching Chapter/Question's own
# "no enum lock-in yet" convention elsewhere in this codebase), not DB enums
# -- content evolves faster than a migration should be required for it.
ACTIVITY_TYPES = (
    "PREREQUISITE_CHECK",
    "CONCEPT_SIMPLE",
    "CORE_PRACTICE",
    "EXTRA_PRACTICE",
    "REMEDIATION",
    "CHALLENGE",
    "CASE_STUDY",
    "CHAPTER_MASTERY",
)

ASSIGNMENT_REASONS = (
    "SCHEDULED",          # normal teacher/curriculum-calendar assignment
    "PREREQUISITE_GAP",   # Foundation Repair: an earlier concept isn't secure
    "LOW_ACCURACY",       # same-skill remediation (matches the real content's
                           # own "REM" pools -- "auto-assign below the agreed
                           # skill threshold")
    "LOW_FLUENCY",
    "MISSED_PRACTICE",
    "TEACHER_SELECTED",
    "RE_ATTEMPT",
    "ADMIN_APPROVED",
)


class LearningActivity(Base):
    """One deliverable unit (blueprint Section 6.3's `learning_activities`).

    Scoped to a single ConceptLesson (skill) for every activity_type except
    CHAPTER_MASTERY (and CASE_STUDY, where present) -- see module docstring.
    chapter_id is always populated, even for concept-scoped rows, so a
    "build this chapter's whole activity list" query never needs to join
    through concept_lessons first.
    """
    __tablename__ = "learning_activities"
    id = Column(String, primary_key=True, default=uuid_str)
    chapter_id = Column(String, ForeignKey("chapters.id", ondelete="CASCADE"), nullable=False, index=True)
    # Null only for a chapter-scoped activity_type (CHAPTER_MASTERY, CASE_STUDY).
    concept_lesson_id = Column(String, ForeignKey("concept_lessons.id", ondelete="CASCADE"), nullable=True, index=True)
    activity_type = Column(String(30), nullable=False)
    title = Column(String(200), nullable=False)
    sequence = Column(Integer, nullable=False, default=1)
    # 1-5, nullable -- see module docstring's pacing_day paragraph.
    pacing_day = Column(Integer, nullable=True)
    # "AUTO" | "HYBRID" | "MANUAL" -- blueprint Section 7.3 EvaluationMode enum.
    evaluation_mode = Column(String(20), nullable=False, default="AUTO")
    is_required = Column(Boolean, nullable=False, default=True)
    estimated_minutes = Column(Integer, nullable=True)
    # "DRAFT" | "PUBLISHED" | "ARCHIVED" -- matches Chapter/ConceptLesson's
    # own status vocabulary. Only PUBLISHED activities are assignable
    # (enforced in learning_service.create_assignment).
    status = Column(String(20), nullable=False, default="DRAFT")
    source_assignment_code = Column(String(50), nullable=True)  # traceability back to the Question.assignment_code group this was generated from
    created_by = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    chapter = relationship("Chapter")
    concept_lesson = relationship("ConceptLesson")

    __table_args__ = (
        # NOTE: SQL unique constraints treat NULL as distinct from every
        # other NULL, so this does NOT stop two chapter-scoped
        # (concept_lesson_id IS NULL) rows of the same activity_type from
        # both existing for one chapter -- generate_activities_for_chapter()
        # guards that case itself (check-then-create, same pattern
        # routes_roster.py's _next_code already uses for its own
        # can't-express-in-SQL uniqueness rule) rather than relying on a
        # partial index that isn't portable across SQLite and Postgres.
        UniqueConstraint(
            "chapter_id", "concept_lesson_id", "activity_type", "source_assignment_code",
            name="uq_learning_activity_slot",
        ),
    )


class LearningActivityQuestion(Base):
    """Links a LearningActivity to the actual Question rows a student
    answers -- the structured, FK-based replacement for Question's own
    descriptive-only assignment_code/stage columns (see curriculum.py's
    module docstring, "Phase 3 work, not invented here")."""
    __tablename__ = "learning_activity_questions"
    id = Column(String, primary_key=True, default=uuid_str)
    learning_activity_id = Column(String, ForeignKey("learning_activities.id", ondelete="CASCADE"), nullable=False, index=True)
    question_id = Column(String, ForeignKey("questions.id", ondelete="RESTRICT"), nullable=False, index=True)
    sequence = Column(Integer, nullable=False, default=1)

    learning_activity = relationship("LearningActivity")
    question = relationship("Question")

    __table_args__ = (UniqueConstraint("learning_activity_id", "question_id", name="uq_activity_question"),)


class Assignment(Base):
    """A teacher (or, in future, an auto-assign-enabled school) assigning one
    LearningActivity to a class and/or an individual student (blueprint
    Section 6.3's `assignments`). `reason` records why, per Section 11:
    "Record why an activity was recommended: prerequisite gap, low accuracy,
    low fluency, missed practice or teacher selection" -- never inferred
    from one wrong answer (Section 11 again), only ever set by
    foundation_repair_service's recommendation or a teacher's own choice.
    """
    __tablename__ = "assignments"
    id = Column(String, primary_key=True, default=uuid_str)
    school_id = Column(String, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True)
    learning_activity_id = Column(String, ForeignKey("learning_activities.id", ondelete="RESTRICT"), nullable=False, index=True)
    # Null means system-generated (reserved for a future auto-assign school
    # setting -- blueprint Section 11: "assignment to a class or individual
    # remains under teacher control unless the school enables
    # auto-assignment"). Every assignment created through this PR's API
    # always has one -- the teacher/admin who called the endpoint.
    assigned_by_user_id = Column(String, ForeignKey("users.id"), nullable=True)
    # Matches Student.class_name's free-text convention (Phase 1). Null when
    # this assignment targets specific student(s) only (e.g. a Foundation
    # Repair rescue), not a whole class.
    class_name = Column(String(50), nullable=True)
    reason = Column(String(30), nullable=False, default="SCHEDULED")
    # Set only when reason == PREREQUISITE_GAP -- which earlier concept's gap
    # triggered this, for audit/explanation (blueprint Section 11's "Store
    # ... why").
    source_prerequisite_link_id = Column(String, ForeignKey("prerequisite_links.id", ondelete="SET NULL"), nullable=True)
    # "FIVE_DAY" | "EXTENDED" -- client clarification 17 Aug (Section 7 item
    # 2): "pacing must be configurable per teacher/class, not hard-coded
    # either way". Advisory only in this PR (see LearningActivity's
    # pacing_day docstring) -- nothing in the attempt lifecycle below reads
    # or enforces it yet; it exists so the frontend calendar and a future
    # due-date-derivation pass have something real to key off.
    pacing_mode = Column(String(20), nullable=False, default="FIVE_DAY")
    available_from = Column(String(30), nullable=True)
    due_date = Column(String(30), nullable=True)
    # Table 10 (blueprint Section "Re-attempt and official-score policy"):
    # "DPS / formative practice ... Suggested limit: Original + RA1 + RA2;
    # further attempt needs Admin approval." Default 3 = exactly that.
    max_attempts = Column(Integer, nullable=False, default=3)
    status = Column(String(20), nullable=False, default="ACTIVE")  # ACTIVE | CLOSED | CANCELLED
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    school = relationship("School")
    learning_activity = relationship("LearningActivity")
    source_prerequisite_link = relationship("PrerequisiteLink")


class AssignmentTarget(Base):
    """Which individual student(s) an Assignment actually applies to
    (blueprint Section 6.3's `assignment_targets`) -- materialized at
    assignment-creation time from the class roster, or a single row for an
    individual (Foundation Repair) assignment. Every Attempt hangs off this,
    not off Assignment directly, so "has this student started/finished
    their copy of this assignment" is always a single-row lookup."""
    __tablename__ = "assignment_targets"
    id = Column(String, primary_key=True, default=uuid_str)
    assignment_id = Column(String, ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id = Column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="PENDING")  # PENDING | IN_PROGRESS | COMPLETED | SKIPPED
    # Extra attempts a teacher/admin has approved for this one student on
    # this one assignment, on top of Assignment.max_attempts (shared by
    # every other student on the same assignment) -- added 20 Aug 2026 for
    # the teacher reattempt-approval surface. start_attempt's limit check is
    # `attempt_count >= assignment.max_attempts + target.bonus_attempts`, so
    # granting one student a re-attempt never changes the limit for anyone
    # else targeted by the same Assignment row.
    bonus_attempts = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    assignment = relationship("Assignment")
    student = relationship("Student")

    __table_args__ = (UniqueConstraint("assignment_id", "student_id", name="uq_assignment_target"),)


class Attempt(Base):
    """One student's attempt at one AssignmentTarget. attempt_number 1 =
    original, 2 = RA1, 3 = RA2 (Table 10's re-attempt policy) --
    learning_service.start_attempt enforces Assignment.max_attempts and
    that a new attempt can only start once the previous one is
    SUBMITTED/EVALUATED (blueprint 8.1: "Lock an attempt after final
    submission")."""
    __tablename__ = "attempts"
    id = Column(String, primary_key=True, default=uuid_str)
    assignment_target_id = Column(String, ForeignKey("assignment_targets.id", ondelete="CASCADE"), nullable=False, index=True)
    attempt_number = Column(Integer, nullable=False, default=1)
    status = Column(String(20), nullable=False, default="IN_PROGRESS")  # IN_PROGRESS | SUBMITTED | EVALUATED | ABANDONED
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    time_spent_seconds = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    assignment_target = relationship("AssignmentTarget")

    __table_args__ = (UniqueConstraint("assignment_target_id", "attempt_number", name="uq_attempt_number"),)


class AttemptAnswer(Base):
    """One question's response within one Attempt. max_score is snapshotted
    from Question.marks at answer-save time (blueprint 6.4's "immutable
    snapshot on attempted questions" rule) so a later edit to a question's
    marks in Curriculum Studio can never retroactively change an
    already-submitted attempt's score."""
    __tablename__ = "attempt_answers"
    id = Column(String, primary_key=True, default=uuid_str)
    attempt_id = Column(String, ForeignKey("attempts.id", ondelete="CASCADE"), nullable=False, index=True)
    question_id = Column(String, ForeignKey("questions.id", ondelete="RESTRICT"), nullable=False, index=True)
    response_text = Column(Text, nullable=True)
    # Null until graded. Stays null forever for a non-auto-gradable question
    # under AUTO evaluation_mode (see learning_service.grade_answer) --
    # distinct from `is_correct=False`, which means "graded, and wrong".
    is_correct = Column(Boolean, nullable=True)
    auto_score = Column(Integer, nullable=True)
    max_score = Column(Integer, nullable=False, default=1)
    answered_at = Column(DateTime(timezone=True), nullable=True)

    attempt = relationship("Attempt")
    question = relationship("Question")

    __table_args__ = (UniqueConstraint("attempt_id", "question_id", name="uq_attempt_answer"),)


class Evaluation(Base):
    """Attempt-level rollup (blueprint 8.1: "Store automatic and final
    marking separately"). Phase 3 scope is AUTO only -- final_score always
    equals auto_score here; the teacher_score/rubric_version_id/
    evaluated_by/override_reason fields blueprint 8.1 also lists are Phase
    4 additions for once HYBRID/MANUAL subjective content exists, deferred
    the same way curriculum.py deferred rubric tables."""
    __tablename__ = "evaluations"
    id = Column(String, primary_key=True, default=uuid_str)
    attempt_id = Column(String, ForeignKey("attempts.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    auto_score = Column(Integer, nullable=False, default=0)
    max_score = Column(Integer, nullable=False, default=0)
    final_score = Column(Integer, nullable=False, default=0)
    # "AUTO_FINALISED" (every answer was auto-gradable) | "PENDING_REVIEW"
    # (at least one answer needs a human -- Phase 4's review queue; Phase 3
    # simply leaves such attempts in this state) | "FINALISED" (Phase 4).
    review_status = Column(String(20), nullable=False, default="AUTO_FINALISED")
    evaluated_at = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    attempt = relationship("Attempt")
