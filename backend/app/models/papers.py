"""Question patterns and the questions made from them (#166, 27 Oct 2026;
PHASE5_MOCK_PAPER_DESIGN.md).

A QuestionPattern is one question family written once with blanks, for one
skill of one board course (CBSE Class 5 Mathematics is the first "engine").
The mock paper engine fills the blanks within the pattern's limits, works
out the answer itself, checks the result, and stores it as an ordinary
Question (origin GENERATED) so marking, analytics and progress treat it like
any other question. A GeneratedQuestion row records how it was made (pattern
version, seed, values) and its fingerprint, which keeps
a student from ever being given the same generated question twice.

A pattern's spec is JSON (pattern_engine.clean_spec says what it holds); it
is loaded from the files under backend/content/patterns by
scripts/load_patterns.py. A pattern is used in papers only once APPROVED
(Ashalatha's rule of 17 Aug 2026); a DRAFT one can be previewed by the Super
Admin. Changing an approved pattern's spec makes it a DRAFT again, at the
next version.
"""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func

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
    # Whose question it is: a student never gets the same one twice (#166
    # step 3; was "never the same within a school", which a school of a
    # few hundred students would use up).
    student_id = Column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=True, index=True)
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
        UniqueConstraint("student_id", "fingerprint", name="uq_generated_question_student_fingerprint"),
        Index("ix_generated_questions_school_fingerprint", "school_id", "fingerprint"),
        Index("ix_generated_questions_pattern_school", "pattern_id", "school_id"),
    )


# --- mock papers (#166 step 3) ---------------------------------------------------------
#
# Shailesh, 27 Oct 2026: the teacher builds any test the school needs (not
# three fixed sizes); the teacher approves every paper; every student gets
# their own version, all made at once; mock papers are practice only.

PAPER_STATUSES = ("DRAFT", "APPROVED", "WITHDRAWN")


class PaperFormat(Base):
    """A saved test format: its sections, time and mix (spec_json, as
    paper_formats.clean_format reads it). school-wide when owner_user_id is
    empty (made by the school's admin), else one teacher's own. The three
    starting points (full paper, unit test, class test) live in code."""

    __tablename__ = "paper_formats"
    id = Column(String, primary_key=True, default=uuid_str)
    school_id = Column(String, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String(80), nullable=False)
    spec_json = Column(Text, nullable=False)
    created_by_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MockPaper(Base):
    """One test for one section, from DRAFT (slots chosen, previewed with
    sample numbers, nothing stored for students) to APPROVED (frozen; every
    student's version made) or WITHDRAWN (taken back before it opened)."""

    __tablename__ = "mock_papers"
    id = Column(String, primary_key=True, default=uuid_str)
    school_id = Column(String, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True)
    class_level_id = Column(String, ForeignKey("class_levels.id", ondelete="RESTRICT"), nullable=False)
    section = Column(String(50), nullable=False)
    board_course_id = Column(String, ForeignKey("board_courses.id", ondelete="RESTRICT"), nullable=False)
    title = Column(String(120), nullable=False)
    status = Column(String(20), nullable=False, default="DRAFT")
    format_json = Column(Text, nullable=False)  # the format as chosen, frozen with the paper
    chapter_ids_json = Column(Text, nullable=False)
    opens_at = Column(DateTime(timezone=True), nullable=False)
    closes_at = Column(DateTime(timezone=True), nullable=False)
    created_by_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_by_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    withdrawn_at = Column(DateTime(timezone=True), nullable=True)
    withdraw_reason = Column(String(300), nullable=True)
    # Step 4: students see their marks and the solutions only once the
    # teacher releases the results, after marking the written answers.
    results_released_at = Column(DateTime(timezone=True), nullable=True)
    results_released_by_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL", name="fk_mock_papers_results_released_by"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (Index("ix_mock_papers_scope", "school_id", "class_level_id", "section", "board_course_id"),)


class MockPaperSlot(Base):
    """One place on the paper: its section, marks and the pattern that fills
    it. An either/or pair shares a choice_group; `alternative` marks the
    second of the pair (left out of the paper's totals). sample_seed makes
    the teacher's preview copy, never given to a student."""

    __tablename__ = "mock_paper_slots"
    id = Column(String, primary_key=True, default=uuid_str)
    paper_id = Column(String, ForeignKey("mock_papers.id", ondelete="CASCADE"), nullable=False, index=True)
    section_index = Column(Integer, nullable=False)
    position = Column(Integer, nullable=False)
    marks = Column(Integer, nullable=False)
    kind = Column(String(20), nullable=False)
    choice_group = Column(Integer, nullable=True)
    alternative = Column(Boolean, nullable=False, default=False)
    pattern_id = Column(String, ForeignKey("question_patterns.id", ondelete="RESTRICT"), nullable=True)
    pattern_version = Column(Integer, nullable=True)
    sample_seed = Column(String(40), nullable=True)
    # The pattern's spec as approved with the paper, so the paper (and a
    # student who joins later) never follows a later edit of the pattern.
    approved_spec_json = Column(Text, nullable=True)


class MockPaperVersion(Base):
    """One student's own copy of an approved paper."""

    __tablename__ = "mock_paper_versions"
    id = Column(String, primary_key=True, default=uuid_str)
    paper_id = Column(String, ForeignKey("mock_papers.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id = Column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("paper_id", "student_id", name="uq_mock_paper_version_student"),)


class MockPaperVersionItem(Base):
    """A question of a student's version: the slot it fills (a case study:
    one row per part)."""

    __tablename__ = "mock_paper_version_items"
    id = Column(String, primary_key=True, default=uuid_str)
    version_id = Column(String, ForeignKey("mock_paper_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    slot_id = Column(String, ForeignKey("mock_paper_slots.id", ondelete="CASCADE"), nullable=False, index=True)
    question_id = Column(String, ForeignKey("questions.id", ondelete="RESTRICT"), nullable=False)
    part_number = Column(Integer, nullable=True)

    __table_args__ = (UniqueConstraint("version_id", "question_id", name="uq_mock_paper_item_question"),)


# --- sitting a paper (#166 step 4) ----------------------------------------------------


class MockPaperSitting(Base):
    """A student sitting their version of a paper: one sitting, timed by
    the server. Reading time first (questions shown, answers locked), then
    the writing time; the paper is handed in by the student, or when the
    time is up or the paper closes (submitted_how STUDENT, TIME, CLOSED).
    choices_json: for each either/or pair, the slot the student chose."""

    __tablename__ = "mock_paper_sittings"
    id = Column(String, primary_key=True, default=uuid_str)
    version_id = Column(String, ForeignKey("mock_paper_versions.id", ondelete="CASCADE"), nullable=False, unique=True)
    paper_id = Column(String, ForeignKey("mock_papers.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id = Column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="IN_PROGRESS")  # IN_PROGRESS | SUBMITTED
    started_at = Column(DateTime(timezone=True), nullable=False)
    writing_starts_at = Column(DateTime(timezone=True), nullable=False)
    deadline_at = Column(DateTime(timezone=True), nullable=False)
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    submitted_how = Column(String(20), nullable=True)
    section_index = Column(Integer, nullable=False, default=0, server_default="0")  # where a one-way paper has reached
    choices_json = Column(Text, nullable=False, default="{}", server_default="{}")
    auto_score = Column(Integer, nullable=True)
    final_score = Column(Integer, nullable=True)
    max_score = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class MockPaperAnswer(Base):
    """One question's answer in a sitting. auto_score is the machine's mark
    (none for a written answer); manual_score the teacher's, who marks
    written answers step by step (the question's marking steps). counted:
    False for the half of an either/or pair the student didn't choose."""

    __tablename__ = "mock_paper_answers"
    id = Column(String, primary_key=True, default=uuid_str)
    sitting_id = Column(String, ForeignKey("mock_paper_sittings.id", ondelete="CASCADE"), nullable=False, index=True)
    question_id = Column(String, ForeignKey("questions.id", ondelete="RESTRICT"), nullable=False)
    slot_id = Column(String, ForeignKey("mock_paper_slots.id", ondelete="CASCADE"), nullable=False)
    response_text = Column(Text, nullable=True)
    working_text = Column(Text, nullable=True)
    answered_at = Column(DateTime(timezone=True), nullable=True)
    counted = Column(Boolean, nullable=True)
    is_correct = Column(Boolean, nullable=True)
    auto_score = Column(Integer, nullable=True)
    grading_note = Column(String(30), nullable=True)
    max_score = Column(Integer, nullable=False, default=1)
    manual_score = Column(Integer, nullable=True)
    graded_by_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    graded_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (UniqueConstraint("sitting_id", "question_id", name="uq_mock_paper_answer_question"),)
