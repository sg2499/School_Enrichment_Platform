"""The Assessment Scheme (Phase 4, #165, 23 Oct 2026).

Design: PHASE4_ASSESSMENT_SCHEME_DESIGN.md, approved by Shailesh on 23 Oct
2026 with all six decisions as recommended. Source: the client's blueprint,
Section 8.3 ("Create a versioned Assessment Scheme rather than coding one
CBSE or ICSE formula") and Section 8.4 (the school chooses which attempt is
the official record).

A school's scheme says how one subject's marks add up to a result for one
class in one academic year: its components (a periodic test, the
half-yearly, a project, a set of practice on the platform...), each with
maximum marks and a weight; its grade bands; and its pass rule. The result
itself is worked out when asked for (app/services/assessment_service.py),
never stored here: a report card (#188) keeps the figures it printed.

Decimal values -- marks such as 17.5, weights, percentages -- are kept as
exact decimal text and read with Decimal, as Question.numeric_tolerance
already is, so no value is ever a binary float and SQLite (used by the
tests) stores them without loss.

Templates (is_template) are the CBSE-style and ICSE-style starting points a
Super Admin keeps; they belong to no school, year, class or course. A
school copies one into its own draft scheme. Templates are drafted with AI
help, so they stay DRAFT -- not offered to schools -- until Ashalatha has
checked them and a Super Admin publishes them.
"""
from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import relationship

from app.database import Base
from app.models.models import uuid_str

SCHEME_STATUSES = ("DRAFT", "PUBLISHED", "SUPERSEDED")
ATTEMPT_RULES = ("BEST", "FIRST", "LATEST")
COMPONENT_KINDS = (
    "PERIODIC_TEST",
    "HALF_YEARLY",
    "ANNUAL",
    "PRACTICAL",
    "PROJECT",
    "NOTEBOOK",
    "SUBJECT_ENRICHMENT",
    "PLATFORM_PRACTICE",
    "OTHER",
)
COMPONENT_TERMS = ("TERM_1", "TERM_2", "WHOLE_YEAR")
COMPONENT_SOURCES = ("ENTERED", "PLATFORM")
MARK_STATUSES = ("ENTERED", "ABSENT", "EXEMPT")


class AcademicYear(Base):
    """One school year at one school ("2026-27"). Schemes, entered marks and
    results belong to a year, so a new year starts clean and an old year's
    results stay as they were. At most one is_current per school (enforced
    in assessment_service, which is the only writer)."""

    __tablename__ = "academic_years"
    id = Column(String, primary_key=True, default=uuid_str)
    school_id = Column(String, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True)
    label = Column(String(20), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    is_current = Column(Boolean, nullable=False, default=False)
    created_by_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    school = relationship("School")

    __table_args__ = (UniqueConstraint("school_id", "label", name="uq_academic_year_label"),)


class AssessmentScheme(Base):
    __tablename__ = "assessment_schemes"
    id = Column(String, primary_key=True, default=uuid_str)
    # Null only for a template.
    school_id = Column(String, ForeignKey("schools.id", ondelete="CASCADE"), nullable=True, index=True)
    is_template = Column(Boolean, nullable=False, default=False)
    name = Column(String(150), nullable=False)
    # A template's own note on where it applies ("CBSE-style, Classes 6 to 8").
    description = Column(String(300), nullable=True)
    academic_year_id = Column(String, ForeignKey("academic_years.id", ondelete="RESTRICT"), nullable=True, index=True)
    class_level_id = Column(String, ForeignKey("class_levels.id", ondelete="RESTRICT"), nullable=True, index=True)
    board_course_id = Column(String, ForeignKey("board_courses.id", ondelete="RESTRICT"), nullable=True, index=True)
    # Every version of one scheme shares its lineage_id (the first version's
    # id); version counts up from 1.
    lineage_id = Column(String, nullable=False, index=True)
    version = Column(Integer, nullable=False, default=1)
    status = Column(String(20), nullable=False, default="DRAFT")
    # Which attempt at a platform set counts: BEST (Shailesh, 23 Oct 2026),
    # FIRST or LATEST.
    attempt_rule = Column(String(10), nullable=False, default="BEST")
    pass_percent = Column(String(20), nullable=False, default="33")
    pass_label = Column(String(40), nullable=False, default="Pass")
    fail_label = Column(String(40), nullable=False, default="Needs Improvement")
    # Places the result is shown to (0 or 1); a 5 rounds up.
    decimal_places = Column(Integer, nullable=False, default=0)
    created_by_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    published_by_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    published_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    school = relationship("School")
    academic_year = relationship("AcademicYear")
    class_level = relationship("ClassLevel")
    board_course = relationship("BoardCourse")
    components = relationship(
        "AssessmentComponent",
        order_by="AssessmentComponent.sequence",
        cascade="all, delete-orphan",
        back_populates="scheme",
    )
    grade_bands = relationship(
        "GradeBand",
        order_by="GradeBand.sequence",
        cascade="all, delete-orphan",
        back_populates="scheme",
    )

    __table_args__ = (
        UniqueConstraint("lineage_id", "version", name="uq_scheme_lineage_version"),
        Index("ix_scheme_scope", "school_id", "academic_year_id", "class_level_id", "board_course_id", "status"),
    )


class AssessmentComponent(Base):
    __tablename__ = "assessment_components"
    id = Column(String, primary_key=True, default=uuid_str)
    scheme_id = Column(String, ForeignKey("assessment_schemes.id", ondelete="CASCADE"), nullable=False, index=True)
    # The same piece of assessment across versions of a scheme: copied when
    # a new version is made, so marks entered against the old version carry
    # over to the matching component of the new one.
    component_key = Column(String, nullable=False, index=True)
    sequence = Column(Integer, nullable=False, default=1)
    name = Column(String(120), nullable=False)
    kind = Column(String(30), nullable=False, default="OTHER")
    term = Column(String(20), nullable=False, default="WHOLE_YEAR")
    source = Column(String(20), nullable=False, default="ENTERED")
    max_marks = Column(String(20), nullable=False)
    weight_percent = Column(String(20), nullable=False)
    # Optional: a minimum on this component as well as on the subject
    # ("33% of the theory paper").
    min_pass_percent = Column(String(20), nullable=True)

    scheme = relationship("AssessmentScheme", back_populates="components")
    activities = relationship(
        "AssessmentComponentActivity", cascade="all, delete-orphan", back_populates="component"
    )


class AssessmentComponentActivity(Base):
    """A platform component's practice sets. Linked to the set itself (the
    LearningActivity), not to one section's Assignment of it, so one link
    covers every section of the class: each student's marks come from the
    assignment of that set they were given."""

    __tablename__ = "assessment_component_activities"
    id = Column(String, primary_key=True, default=uuid_str)
    component_id = Column(String, ForeignKey("assessment_components.id", ondelete="CASCADE"), nullable=False, index=True)
    learning_activity_id = Column(String, ForeignKey("learning_activities.id", ondelete="RESTRICT"), nullable=False, index=True)

    component = relationship("AssessmentComponent", back_populates="activities")
    learning_activity = relationship("LearningActivity")

    __table_args__ = (UniqueConstraint("component_id", "learning_activity_id", name="uq_component_activity"),)


class GradeBand(Base):
    __tablename__ = "grade_bands"
    id = Column(String, primary_key=True, default=uuid_str)
    scheme_id = Column(String, ForeignKey("assessment_schemes.id", ondelete="CASCADE"), nullable=False, index=True)
    sequence = Column(Integer, nullable=False, default=1)  # 1 = the highest grade
    label = Column(String(20), nullable=False)
    min_percent = Column(String(20), nullable=False)

    scheme = relationship("AssessmentScheme", back_populates="grade_bands")


class ComponentMark(Base):
    """One student's marks on one component: a number (half marks allowed,
    Shailesh 23 Oct 2026), or ABSENT (counts 0) or EXEMPT (left out, its
    weight spread over the others). On a PLATFORM component only ABSENT and
    EXEMPT are recorded here, to override what the platform would count."""

    __tablename__ = "component_marks"
    id = Column(String, primary_key=True, default=uuid_str)
    school_id = Column(String, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True)
    component_id = Column(String, ForeignKey("assessment_components.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id = Column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="ENTERED")
    marks = Column(String(20), nullable=True)  # set only when status is ENTERED
    # Why a saved mark was changed (required then, as for part marks).
    change_reason = Column(String(200), nullable=True)
    entered_by_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    entered_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_by_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    component = relationship("AssessmentComponent")
    student = relationship("Student")

    __table_args__ = (UniqueConstraint("component_id", "student_id", name="uq_component_mark"),)
