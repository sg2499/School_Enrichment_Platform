"""Files a child attaches to an answer (#237, 17 Nov 2026): a PDF of working,
a drawing or a longer explanation, under a question that asks for one.

An AnswerAttachment is the record (who, which answer, how big, how many
pages); the bytes live behind app/services/file_storage.py, so where they are
kept can change without touching this table. StoredFile is the bytes for the
default "database" storage, which needs no disk (Render's disk is not kept
between deploys). The hosting team can switch the storage with one setting.
"""
from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, LargeBinary, String, func
from sqlalchemy.orm import deferred

from app.database import Base
from app.models.models import uuid_str


class StoredFile(Base):
    __tablename__ = "stored_files"
    key = Column(String(120), primary_key=True)
    data = deferred(Column(LargeBinary, nullable=False))
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AnswerAttachment(Base):
    """One PDF on one answer: a practice answer (attempt_answer_id) or a mock
    paper answer (mock_answer_id), never both. One file per answer; a new
    upload replaces the old one."""

    __tablename__ = "answer_attachments"
    id = Column(String, primary_key=True, default=uuid_str)
    student_id = Column(String, ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    question_id = Column(String, ForeignKey("questions.id", ondelete="RESTRICT"), nullable=False)
    attempt_answer_id = Column(
        String, ForeignKey("attempt_answers.id", ondelete="CASCADE"), nullable=True, unique=True
    )
    mock_answer_id = Column(
        String, ForeignKey("mock_paper_answers.id", ondelete="CASCADE"), nullable=True, unique=True
    )
    filename = Column(String(200), nullable=False)
    content_type = Column(String(50), nullable=False, default="application/pdf")
    size_bytes = Column(Integer, nullable=False)
    page_count = Column(Integer, nullable=False)
    sha256 = Column(String(64), nullable=False)
    storage_backend = Column(String(20), nullable=False)
    storage_key = Column(String(120), nullable=False)
    uploaded_by_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "(attempt_answer_id IS NOT NULL AND mock_answer_id IS NULL) OR "
            "(attempt_answer_id IS NULL AND mock_answer_id IS NOT NULL)",
            name="ck_answer_attachment_one_owner",
        ),
    )
