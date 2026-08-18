"""Phase 2 (Curriculum Studio) model set: the master curriculum hierarchy,
concept-level prerequisites, per-school curriculum mapping, and the question
bank.

New for School Enrichment -- MathPath's Module/Level/Lesson/DPS hierarchy has
no equivalent here (Phase 0 audit, Replace bucket). Built directly against
two sources: the blueprint (`Docs/School_Enrichment_Standalone_Platform_
Developer_Blueprint.docx`, Section 5 "Curriculum hierarchy" and Section 6.2
"Curriculum tables"), and the real CBSE Class 5 Maths content already
delivered by the client (`Content/CBSE_Class_5_Chapter_*.xlsx`), whose
"Portal Schema" sheet is itself a field-level import spec the content team
wrote for exactly this purpose. Verified the 32-column Question Bank layout
is identical (same column order, minor label wording only) across all 15
chapter files before designing Question below -- this is not a guessed
schema.

Scope discipline, matching Phase 1's own approach:
- Board -> Curriculum Version -> Class Level -> Subject Group -> Board
  Course -> Discipline -> Term -> Chapter -> Concept Lesson is the full
  blueprint hierarchy (Section 5). All of it is master/global content
  (school_id is deliberately absent from every table below except
  SchoolCurriculumMap) -- blueprint Section 6.4: "platform master content
  may keep school_id null only with an explicit GLOBAL scope."
- "Concept Lesson" in the blueprint maps to what the real content calls a
  "Skill" (each chapter's Skill Map sheet lists ~15 skills, each with a
  Skill ID, learning outcome, and priority misconception -- exactly the
  granularity Question Bank rows are tagged against via Skill ID). Using
  the content's own grain rather than inventing a separate concept-lesson
  breakdown keeps the schema honest to what will actually be imported.
- PrerequisiteLink exists as a real table (blueprint Section 11, Foundation
  Repair needs concept-to-concept edges, not free text) but is NOT
  auto-populated by the Phase 2 import below. Each Skill Map row has a
  "Prerequisite / Gap Check" column, but it's free text describing a prior
  skill in prose (e.g. "Skip counting in 10s, 100s and 1,000s"), not a
  Skill ID -- resolving that to an actual concept_lesson_id reliably needs
  either cross-chapter human review or fuzzy text matching too unreliable
  to trust for a feature that drives automatic remediation. The prose is
  preserved as ConceptLesson.prerequisite_note so nothing is lost; real
  PrerequisiteLink edges get populated once more chapters are in and a
  human (or a dedicated, reviewed matching pass) can verify them -- Phase 3
  work, not invented here.
- Delivery/attempt mechanics (Assignment, Attempt, evaluation) are
  explicitly NOT built here -- Phase 3/4 per IMPLEMENTATION_ROADMAP.md.
  Question below stores `assignment_code` and `stage` (e.g. "CH01-DIAG",
  "Diagnostic") only as descriptive metadata carried over from the source
  content's Assignment Plan sheet, not as a foreign key into a real
  Assignment table that doesn't exist yet.
- Question intentionally mirrors the source content's flat Portal Schema
  shape (options inline as option_a..option_d, no separate rubric/
  question_options tables) rather than the blueprint's more general Section
  6.3 shape (questions/question_options/rubrics as separate tables) --
  that richer shape is for Phase 4/5's subjective/rubric-based marking
  engine, which doesn't apply to this auto-gradable objective content.
  Revisit when subjective Science content (rubrics, partial marks) is
  imported.
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


class Board(Base):
    __tablename__ = "boards"
    id = Column(String, primary_key=True, default=uuid_str)
    code = Column(String(20), unique=True, nullable=False)  # "CBSE" | "ICSE"
    display_name = Column(String(100), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class CurriculumVersion(Base):
    __tablename__ = "curriculum_versions"
    id = Column(String, primary_key=True, default=uuid_str)
    board_id = Column(String, ForeignKey("boards.id", ondelete="RESTRICT"), nullable=False, index=True)
    code = Column(String(50), nullable=False)
    label = Column(String(150), nullable=False)
    # "DRAFT" | "REVIEW" | "PUBLISHED" | "ARCHIVED" -- blueprint Section 6.2.
    status = Column(String(20), nullable=False, default="DRAFT")
    effective_from = Column(String(30), nullable=True)
    effective_to = Column(String(30), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    board = relationship("Board")

    __table_args__ = (UniqueConstraint("board_id", "code", name="uq_curriculum_version_board_code"),)


class ClassLevel(Base):
    __tablename__ = "class_levels"
    id = Column(String, primary_key=True, default=uuid_str)
    code = Column(String(10), unique=True, nullable=False)  # "5".."10"
    display_name = Column(String(50), nullable=False)
    display_order = Column(Integer, nullable=False)


class SubjectGroup(Base):
    __tablename__ = "subject_groups"
    id = Column(String, primary_key=True, default=uuid_str)
    code = Column(String(20), unique=True, nullable=False)  # SCIENCE | LANGUAGE | OTHER
    display_name = Column(String(100), nullable=False)


class Discipline(Base):
    __tablename__ = "disciplines"
    id = Column(String, primary_key=True, default=uuid_str)
    code = Column(String(30), unique=True, nullable=False)  # MATHEMATICS | PHYSICS | ...
    display_name = Column(String(100), nullable=False)
    subject_group_id = Column(String, ForeignKey("subject_groups.id", ondelete="RESTRICT"), nullable=False, index=True)

    subject_group = relationship("SubjectGroup")


class BoardCourse(Base):
    """The board-facing subject a student sees (blueprint Section 5.2) --
    deliberately separate from Discipline so e.g. CBSE's single "Science"
    course can map to three disciplines (Physics/Chemistry/Biology) without
    forcing the visible subject name to match the internal classification.
    """
    __tablename__ = "board_courses"
    id = Column(String, primary_key=True, default=uuid_str)
    board_id = Column(String, ForeignKey("boards.id", ondelete="RESTRICT"), nullable=False, index=True)
    class_level_id = Column(String, ForeignKey("class_levels.id", ondelete="RESTRICT"), nullable=False, index=True)
    code = Column(String(50), nullable=False)
    display_name = Column(String(100), nullable=False)
    status = Column(String(20), nullable=False, default="DRAFT")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    board = relationship("Board")
    class_level = relationship("ClassLevel")

    __table_args__ = (UniqueConstraint("board_id", "class_level_id", "code", name="uq_board_course"),)


class CourseDisciplineMap(Base):
    __tablename__ = "course_discipline_maps"
    id = Column(String, primary_key=True, default=uuid_str)
    board_course_id = Column(String, ForeignKey("board_courses.id", ondelete="CASCADE"), nullable=False, index=True)
    discipline_id = Column(String, ForeignKey("disciplines.id", ondelete="RESTRICT"), nullable=False, index=True)
    sequence = Column(Integer, nullable=False, default=1)
    weight = Column(Integer, nullable=True)  # optional relative weighting, e.g. exam split across strands

    board_course = relationship("BoardCourse")
    discipline = relationship("Discipline")

    __table_args__ = (UniqueConstraint("board_course_id", "discipline_id", name="uq_course_discipline"),)


class Term(Base):
    __tablename__ = "terms"
    id = Column(String, primary_key=True, default=uuid_str)
    curriculum_version_id = Column(String, ForeignKey("curriculum_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    code = Column(String(30), nullable=False)
    name = Column(String(100), nullable=False)
    sequence = Column(Integer, nullable=False, default=1)

    curriculum_version = relationship("CurriculumVersion")

    __table_args__ = (UniqueConstraint("curriculum_version_id", "code", name="uq_term_version_code"),)


class Chapter(Base):
    __tablename__ = "chapters"
    id = Column(String, primary_key=True, default=uuid_str)
    discipline_id = Column(String, ForeignKey("disciplines.id", ondelete="RESTRICT"), nullable=False, index=True)
    # Nullable: a term/curriculum-calendar assignment is a real part of the
    # blueprint hierarchy, but chapters can be drafted and reviewed before a
    # school calendar exists to place them in -- content authoring shouldn't
    # be blocked on academic-calendar setup.
    term_id = Column(String, ForeignKey("terms.id", ondelete="SET NULL"), nullable=True, index=True)
    code = Column(String(30), nullable=False)  # e.g. "CH01"
    chapter_no = Column(Integer, nullable=False)
    title = Column(String(200), nullable=False)
    sequence = Column(Integer, nullable=False, default=1)
    # "DRAFT" | "REVIEW" | "PUBLISHED" | "ARCHIVED" -- the exact states the
    # Phase 2 exit gate ("Admin can draft, review, publish... a chapter")
    # walks a chapter through.
    status = Column(String(20), nullable=False, default="DRAFT")
    source_reference = Column(Text, nullable=True)
    created_by = Column(String, ForeignKey("users.id"), nullable=True)
    updated_by = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    discipline = relationship("Discipline")
    term = relationship("Term")

    __table_args__ = (UniqueConstraint("discipline_id", "code", name="uq_chapter_discipline_code"),)


class ConceptLesson(Base):
    """Maps 1:1 to a "Skill" row in the source content's Skill Map sheet --
    see module docstring for why this grain was chosen over inventing a
    separate concept-lesson breakdown.
    """
    __tablename__ = "concept_lessons"
    id = Column(String, primary_key=True, default=uuid_str)
    chapter_id = Column(String, ForeignKey("chapters.id", ondelete="CASCADE"), nullable=False, index=True)
    code = Column(String(50), nullable=False)  # Skill ID, e.g. "C5-WT1-S01"
    title = Column(String(200), nullable=False)  # Skill name
    learning_outcome = Column(Text, nullable=True)
    prerequisite_note = Column(Text, nullable=True)  # raw "Prerequisite / Gap Check" text, see docstring
    priority_misconception = Column(Text, nullable=True)
    sequence = Column(Integer, nullable=False, default=1)
    estimated_minutes = Column(Integer, nullable=True)
    status = Column(String(20), nullable=False, default="DRAFT")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    chapter = relationship("Chapter")

    __table_args__ = (UniqueConstraint("chapter_id", "code", name="uq_concept_lesson_chapter_code"),)


class PrerequisiteLink(Base):
    """Concept-to-concept prerequisite edge (blueprint Section 11, Foundation
    Repair). Deliberately empty after the Phase 2 import -- see module
    docstring for why auto-populating this from free-text prerequisite notes
    isn't trustworthy yet.
    """
    __tablename__ = "prerequisite_links"
    id = Column(String, primary_key=True, default=uuid_str)
    concept_lesson_id = Column(String, ForeignKey("concept_lessons.id", ondelete="CASCADE"), nullable=False, index=True)
    prerequisite_concept_lesson_id = Column(String, ForeignKey("concept_lessons.id", ondelete="CASCADE"), nullable=False, index=True)
    minimum_mastery = Column(Integer, nullable=True)  # percent threshold, e.g. 75
    rescue_activity_note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    concept_lesson = relationship("ConceptLesson", foreign_keys=[concept_lesson_id])
    prerequisite_concept_lesson = relationship("ConceptLesson", foreign_keys=[prerequisite_concept_lesson_id])

    __table_args__ = (
        UniqueConstraint("concept_lesson_id", "prerequisite_concept_lesson_id", name="uq_prerequisite_edge"),
    )


class SchoolCurriculumMap(Base):
    """The only school-scoped table in this file -- maps published master
    content into one school's own calendar (blueprint Section 5: "support a
    school-specific chapter sequence without duplicating the master
    curriculum").
    """
    __tablename__ = "school_curriculum_maps"
    id = Column(String, primary_key=True, default=uuid_str)
    school_id = Column(String, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True)
    board_course_id = Column(String, ForeignKey("board_courses.id", ondelete="RESTRICT"), nullable=False, index=True)
    chapter_id = Column(String, ForeignKey("chapters.id", ondelete="RESTRICT"), nullable=False, index=True)
    class_name = Column(String(50), nullable=True)  # matches Student.class_name's free-text convention (Phase 1)
    section = Column(String(50), nullable=True)
    teacher_id = Column(String, ForeignKey("teachers.id", ondelete="SET NULL"), nullable=True, index=True)
    planned_start_date = Column(String(30), nullable=True)
    planned_end_date = Column(String(30), nullable=True)
    textbook_reference = Column(Text, nullable=True)
    sequence = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    school = relationship("School")
    board_course = relationship("BoardCourse")
    chapter = relationship("Chapter")
    teacher = relationship("Teacher")

    __table_args__ = (
        UniqueConstraint("school_id", "chapter_id", "class_name", "section", name="uq_school_curriculum_map_slot"),
    )


class Question(Base):
    """Mirrors the source content's own Portal Schema field-for-field (see
    module docstring) -- 32 columns in the real workbooks, all carried over
    except Board/Class/Subject/Chapter No/Chapter/Skill, which are already
    fully determined by concept_lesson_id's chain up to Chapter/Discipline/
    BoardCourse and would be redundant, drift-prone duplication if stored
    again here.
    """
    __tablename__ = "questions"
    id = Column(String, primary_key=True, default=uuid_str)
    concept_lesson_id = Column(String, ForeignKey("concept_lessons.id", ondelete="CASCADE"), nullable=False, index=True)
    code = Column(String(50), nullable=False)  # Question ID, e.g. "CBSE-C5-CH01-Q001"
    assignment_code = Column(String(50), nullable=True)  # e.g. "CH01-DIAG" -- descriptive only, see docstring
    stage = Column(String(50), nullable=True)  # e.g. "Diagnostic", "Core Practice"
    difficulty = Column(Integer, nullable=True)  # 1-4 per source content
    competency = Column(String(150), nullable=True)
    question_type = Column(String(50), nullable=False)  # Single Select | Multi Select | Numeric Entry | ...
    stem = Column(Text, nullable=False)
    option_a = Column(Text, nullable=True)
    option_b = Column(Text, nullable=True)
    option_c = Column(Text, nullable=True)
    option_d = Column(Text, nullable=True)
    correct_answer = Column(Text, nullable=False)
    accepted_variants = Column(Text, nullable=True)
    hint = Column(Text, nullable=True)
    explanation = Column(Text, nullable=True)
    misconception_tag = Column(Text, nullable=True)
    marks = Column(Integer, nullable=False, default=1)
    time_seconds = Column(Integer, nullable=True)
    auto_gradable = Column(Boolean, nullable=False, default=True)
    shuffle_options = Column(Boolean, nullable=False, default=False)
    # Widened from 50 -> 255 (18 Aug 2026): the real Class 5 Maths content
    # load hit a genuine StringDataRightTruncation on Postgres the moment a
    # real chapter (5) was imported into production -- SQLite (used in
    # local dev/tests) silently ignores VARCHAR length limits, so this
    # never surfaced until the first real Postgres write. Longest real
    # value seen across all 15 chapters is 67 chars (e.g. "Mixed-unit
    # length, ordered list, comparison sign or short statement"); 255
    # gives real headroom rather than the bare minimum. See migration
    # widen_question_response_format.
    response_format = Column(String(255), nullable=True)
    media_required = Column(String(100), nullable=True)
    teacher_note = Column(Text, nullable=True)
    # "DRAFT" | "SME_REVIEW" | "APPROVED" | "PUBLISHED" -- matches the
    # source content's own Status column vocabulary (normalized to our
    # upper-snake-case convention).
    status = Column(String(20), nullable=False, default="DRAFT")
    source_alignment = Column(Text, nullable=True)
    # Free, automated quality-check result (app/services/question_quality_service.py,
    # added 18 Aug 2026) -- "UNCHECKED" | "FLAGGED" | "VERIFIED" | "UNVERIFIED".
    # Deliberately a separate axis from `status` above: this records whether
    # a question's CONTENT looks right (structural + computed-answer checks),
    # not where it is in the draft/review/publish workflow. See the service
    # module's docstring for why "UNVERIFIED" is never treated as "safe to
    # bulk-approve" the way "VERIFIED" is.
    quality_status = Column(String(20), nullable=False, default="UNCHECKED")
    quality_flags = Column(Text, nullable=True)  # JSON list of human-readable reasons, only set when FLAGGED
    quality_checked_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    concept_lesson = relationship("ConceptLesson")

    __table_args__ = (UniqueConstraint("code", name="uq_question_code"),)
