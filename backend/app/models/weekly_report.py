"""The weekly parent report (Phase 6, #187, 26 Oct 2026).

Design: PHASE6_WEEKLY_REPORT_DESIGN.md. Shailesh's decisions of 26 Oct
2026: the platform drafts every child's page for a week (Monday to Sunday,
India time); a teacher who teaches the section now, or the school admin,
issues the whole section in one step and downloads one PDF for the section
or one per child; the page shows what was set and done with scores, the
week's totals and strong and weak skills, never a class ranking; one note
for the section plus an optional short note per child.

Notes are drafts until the week is issued; issuing copies them into each
child's page (WeeklyReport.report_json), which is kept exactly as issued.
To change an issued week, withdraw it (with a reason) and issue again.
"""
from sqlalchemy import Column, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.orm import relationship

from app.database import Base
from app.models.models import uuid_str

WEEKLY_ISSUE_STATUSES = ("ISSUED", "WITHDRAWN")


class WeeklyReportNote(Base):
    """A teacher's note for one section's week: for the whole section
    (student_id empty) or for one child. Drafts; issuing copies them."""

    __tablename__ = "weekly_report_notes"
    id = Column(String, primary_key=True, default=uuid_str)
    school_id = Column(String, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True)
    class_level_id = Column(String, ForeignKey("class_levels.id", ondelete="CASCADE"), nullable=False)
    section = Column(String(50), nullable=False)
    week_start = Column(Date, nullable=False)
    student_id = Column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=True)
    note = Column(String(300), nullable=False)
    updated_by_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_weekly_note_scope", "school_id", "class_level_id", "section", "week_start"),
        # One section note and one note per child, per week.
        Index(
            "uq_weekly_note_child", "school_id", "class_level_id", "section", "week_start", "student_id",
            unique=True,
            postgresql_where=text("student_id IS NOT NULL"),
            sqlite_where=text("student_id IS NOT NULL"),
        ),
        Index(
            "uq_weekly_note_section", "school_id", "class_level_id", "section", "week_start",
            unique=True,
            postgresql_where=text("student_id IS NULL"),
            sqlite_where=text("student_id IS NULL"),
        ),
    )


class WeeklyReportIssue(Base):
    """One issue of one section's week. At most one ISSUED per section and
    week (a partial unique index, and checked by the service); a withdrawn
    issue stays, with who, when and why."""

    __tablename__ = "weekly_report_issues"
    id = Column(String, primary_key=True, default=uuid_str)
    school_id = Column(String, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True)
    class_level_id = Column(String, ForeignKey("class_levels.id", ondelete="RESTRICT"), nullable=False)
    section = Column(String(50), nullable=False)
    week_start = Column(Date, nullable=False)
    status = Column(String(10), nullable=False, default="ISSUED", server_default="ISSUED")
    issued_by_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    issued_at = Column(DateTime(timezone=True), server_default=func.now())
    withdrawn_by_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    withdrawn_at = Column(DateTime(timezone=True), nullable=True)
    withdraw_reason = Column(String(300), nullable=True)

    class_level = relationship("ClassLevel")
    issued_by = relationship("User", foreign_keys=[issued_by_user_id])
    reports = relationship(
        "WeeklyReport", back_populates="issue", cascade="all, delete-orphan", order_by="WeeklyReport.sequence"
    )

    __table_args__ = (
        Index("ix_weekly_issue_scope", "school_id", "class_level_id", "section", "week_start"),
        Index(
            "uq_weekly_issue_issued",
            "school_id", "class_level_id", "section", "week_start",
            unique=True,
            postgresql_where=text("status = 'ISSUED'"),
            sqlite_where=text("status = 'ISSUED'"),
        ),
    )


class WeeklyReport(Base):
    """One child's page in an issue, exactly as issued (report_json)."""

    __tablename__ = "weekly_reports"
    id = Column(String, primary_key=True, default=uuid_str)
    issue_id = Column(String, ForeignKey("weekly_report_issues.id", ondelete="CASCADE"), nullable=False, index=True)
    school_id = Column(String, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False)
    student_id = Column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    sequence = Column(Integer, nullable=False, default=1, server_default="1")
    report_json = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    issue = relationship("WeeklyReportIssue", back_populates="reports")

    __table_args__ = (UniqueConstraint("issue_id", "student_id", name="uq_weekly_report_student"),)
