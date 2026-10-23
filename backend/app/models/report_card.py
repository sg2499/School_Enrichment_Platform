"""Report cards the school issues (Phase 4, #188, 23 Oct 2026).

Design: PHASE4_REPORT_CARD_DESIGN.md; Shailesh's four decisions of 23 Oct
2026, all as recommended: a marks card with attendance, co-scholastic grades
and a remark, as a PDF; the school Admin issues a term's cards for a section
and the printed figures are kept as issued; no card while any result is
Provisional; a set given and never done counts 0 once it closes (in
assessment_service).

Built on the Assessment Scheme (app/models/assessment.py): the subjects on a
card are the published schemes of the student's class and year, and their
figures are worked out by assessment_service.results.

Lists and the printed card are kept as JSON text, as Chapter.quality_flags
already is, so SQLite (the tests) and Postgres store them the same way.
"""
from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.orm import relationship

from app.database import Base
from app.models.models import uuid_str

# The terms a teacher records attendance, grades and a remark for.
RECORD_TERMS = ("TERM_1", "TERM_2")
# The cards: Term 1's, and the Year-End card (both terms and the year).
CARD_TERMS = ("TERM_1", "YEAR_END")
ISSUE_STATUSES = ("ISSUED", "WITHDRAWN")


class ReportSettings(Base):
    """A school's co-scholastic areas and their grade scale for one year.
    Until a school saves its own, report_card_service's defaults apply."""

    __tablename__ = "report_settings"
    id = Column(String, primary_key=True, default=uuid_str)
    school_id = Column(String, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True)
    academic_year_id = Column(String, ForeignKey("academic_years.id", ondelete="CASCADE"), nullable=False)
    # ["Work Education", "Art Education", ...]
    areas_json = Column(Text, nullable=False)
    # [{"label": "A", "meaning": "Outstanding"}, ...], best first.
    scale_json = Column(Text, nullable=False)
    updated_by_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint("school_id", "academic_year_id", name="uq_report_settings_year"),)


class StudentTermRecord(Base):
    """What a teacher records for one student for one term: attendance, a
    grade per co-scholastic area, and a remark. Term 2's remark is the one
    printed on the Year-End card."""

    __tablename__ = "student_term_records"
    id = Column(String, primary_key=True, default=uuid_str)
    school_id = Column(String, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True)
    academic_year_id = Column(String, ForeignKey("academic_years.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id = Column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    term = Column(String(10), nullable=False)
    working_days = Column(Integer, nullable=True)
    days_present = Column(Integer, nullable=True)
    # {"Work Education": "A", ...}
    grades_json = Column(Text, nullable=False, default="{}", server_default="{}")
    remark = Column(String(300), nullable=True)
    updated_by_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint("student_id", "academic_year_id", "term", name="uq_student_term_record"),)


class ReportCardIssue(Base):
    """One issue of one term's cards for one section. At most one ISSUED per
    section, year and card term (report_card_service checks it under a lock
    on the year's row); a withdrawn issue stays, with who, when and why."""

    __tablename__ = "report_card_issues"
    id = Column(String, primary_key=True, default=uuid_str)
    school_id = Column(String, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True)
    academic_year_id = Column(String, ForeignKey("academic_years.id", ondelete="RESTRICT"), nullable=False)
    class_level_id = Column(String, ForeignKey("class_levels.id", ondelete="RESTRICT"), nullable=False)
    section = Column(String(50), nullable=False)
    card_term = Column(String(10), nullable=False)
    status = Column(String(10), nullable=False, default="ISSUED", server_default="ISSUED")
    issued_by_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    issued_at = Column(DateTime(timezone=True), server_default=func.now())
    withdrawn_by_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    withdrawn_at = Column(DateTime(timezone=True), nullable=True)
    withdraw_reason = Column(String(300), nullable=True)

    academic_year = relationship("AcademicYear")
    class_level = relationship("ClassLevel")
    cards = relationship("ReportCard", back_populates="issue", cascade="all, delete-orphan", order_by="ReportCard.sequence")

    __table_args__ = (
        Index("ix_report_issue_scope", "school_id", "academic_year_id", "class_level_id", "section", "card_term"),
        # At most one ISSUED per section, year and card term, in the database
        # itself too (the service also checks it under the year's row lock).
        Index(
            "uq_report_issue_issued",
            "school_id", "academic_year_id", "class_level_id", "section", "card_term",
            unique=True,
            postgresql_where=text("status = 'ISSUED'"),
            sqlite_where=text("status = 'ISSUED'"),
        ),
    )


class ReportCard(Base):
    """One student's card in an issue, exactly as printed (card_json), so the
    PDF can be made again identically whatever has changed since."""

    __tablename__ = "report_cards"
    id = Column(String, primary_key=True, default=uuid_str)
    issue_id = Column(String, ForeignKey("report_card_issues.id", ondelete="CASCADE"), nullable=False, index=True)
    school_id = Column(String, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False)
    student_id = Column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    sequence = Column(Integer, nullable=False, default=1, server_default="1")
    card_json = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    issue = relationship("ReportCardIssue", back_populates="cards")

    __table_args__ = (UniqueConstraint("issue_id", "student_id", name="uq_report_card_student"),)
