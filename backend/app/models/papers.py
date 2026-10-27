"""Question patterns and the questions made from them (#166, 27 Oct 2026;
PHASE5_MOCK_PAPER_DESIGN.md).

A QuestionPattern is one question family written once with blanks, for one
skill of one board course (CBSE Class 5 Mathematics is the first "engine").
The mock paper engine fills the blanks within the pattern's limits, works
out the answer itself, checks the result, and stores it as an ordinary
Question (origin GENERATED) so marking, analytics and progress treat it like
any other question. A GeneratedQuestion row records how it was made (pattern
version, seed, values) and its fingerprint, which keeps a school from ever
being given the same generated question twice.

A pattern's spec is JSON (pattern_engine.clean_spec says what it holds); it
is loaded from the files under backend/content/patterns by
scripts/load_patterns.py. A pattern is used in papers only once APPROVED
(Ashalatha's rule of 17 Aug 2026); a DRAFT one can be previewed by the Super
Admin. Changing an approved pattern's spec makes it a DRAFT again, at the
next version.
"""
from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func

from app.database import Base
from app.models.models import uuid_str

PATTERN_STATUSES = ("DRAFT", "APPROVED", "RETIRED")


class QuestionPattern(Base):
    __tablename__ = "question_patterns"
    id = Column(String, primary_key=True, default=uuid_str)
    code = Column(String(60), nullable=False, unique=True)  # "C5-WT1-S09-P1"
    board_course_id = Column(String, ForeignKey("board_courses.id", ondelete="RESTRICT"), nullable=False, index=True)
    chapter_id = Column(String, ForeignKey("chapters.id", ondelete="RESTRICT"), nullable=False, index=True)
    concept_lesson_id = Column(String, ForeignKey("concept_lessons.id", ondelete="RESTRICT"), nullable=False, index=True)
    question_type = Column(String(50), nullable=False)
    marks = Column(Integer, nullable=False)
    difficulty = Column(Integer, nullable=True)  # 1 to 4, as the content's own Difficulty
    competency = Column(String(150), nullable=True)
    spec_json = Column(Text, nullable=False)
    spec_sha256 = Column(String(64), nullable=False)
    version = Column(Integer, nullable=False, default=1)
    status = Column(String(20), nullable=False, default="DRAFT")
    approved_by = Column(String(120), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    source_file = Column(String(200), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class GeneratedQuestion(Base):
    __tablename__ = "generated_questions"
    id = Column(String, primary_key=True, default=uuid_str)
    question_id = Column(String, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, unique=True)
    pattern_id = Column(String, ForeignKey("question_patterns.id", ondelete="RESTRICT"), nullable=False, index=True)
    pattern_version = Column(Integer, nullable=False)
    school_id = Column(String, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True)
    seed = Column(String(40), nullable=False)
    values_json = Column(Text, nullable=False)
    # sha256 of the question as a student reads it (wording, options, key).
    fingerprint = Column(String(64), nullable=False)
    # A case study's parts share a group and a stimulus; 1-based part number.
    group_id = Column(String, nullable=True, index=True)
    part_number = Column(Integer, nullable=True)
    stimulus = Column(Text, nullable=True)
    # Single Select: the mistake behind each wrong option, {"B": "rounded the wrong way", ...}.
    mistakes_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("school_id", "fingerprint", name="uq_generated_question_school_fingerprint"),
        Index("ix_generated_questions_pattern_school", "pattern_id", "school_id"),
    )
