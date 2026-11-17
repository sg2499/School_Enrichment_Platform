"""A child's PDF on an answer (#237, 17 Nov 2026): working, a drawing, a
longer explanation, attached under a question that asks for one.

The rules, from his call of the same day:
  * PDF only, up to 20 MB and 15 pages (one setting each, below);
  * one file per answer; a new upload replaces the old one, until the practice
    is submitted or the paper handed in, after which the file is locked;
  * seen by the child, their teacher and the school's admin; never by another
    school, and not by the Super Admin;
  * a file is only ever served through the app (sign-in and role checks),
    never by a public link.

Where the bytes are kept is app/services/file_storage.py's business.
"""
import hashlib
import io
import re
import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.models import AnswerAttachment, Question, Student, User
from app.models.learning import AttemptAnswer
from app.services import file_storage, learning_service, upload_rule_service

MAX_BYTES = 20 * 1024 * 1024
MAX_PAGES = 15
MAX_FILENAME = 120

# A phone or scanner-app PDF has none of these; a PDF that runs a script or
# launches something has no place on a school platform.
_ACTIVE_CONTENT = (b"/JavaScript", b"/JS ", b"/Launch", b"/EmbeddedFile", b"/OpenAction", b"/RichMedia")


def check_pdf(data: bytes) -> int:
    """The page count of a good PDF; a 422 in plain words otherwise."""
    if not data:
        api_error(422, "VALIDATION_ERROR", "That file is empty.")
    if len(data) > MAX_BYTES:
        api_error(422, "FILE_TOO_LARGE", f"That file is too big. A PDF can be up to {MAX_BYTES // (1024 * 1024)} MB.")
    if data.lstrip()[:5] != b"%PDF-":
        api_error(422, "NOT_A_PDF", "Please attach a PDF. A photo can be turned into a PDF with a scanner app.")
    if any(token in data for token in _ACTIVE_CONTENT):
        api_error(422, "UNSAFE_PDF", "That PDF can't be accepted. Please make a plain PDF with a scanner app.")
    try:
        from pypdf import PdfReader
        from pypdf.errors import PyPdfError

        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            api_error(422, "NOT_A_PDF", "That PDF is locked with a password. Please attach one without a password.")
        pages = len(reader.pages)
    except (PyPdfError, ValueError, KeyError, OSError, RecursionError):
        api_error(422, "NOT_A_PDF", "We couldn't read that PDF. Please make it again with a scanner app.")
    if pages < 1:
        api_error(422, "NOT_A_PDF", "That PDF has no pages.")
    if pages > MAX_PAGES:
        api_error(422, "TOO_MANY_PAGES", f"That PDF has {pages} pages. Please keep it to {MAX_PAGES} pages or fewer.")
    return pages


def clean_filename(name: str | None) -> str:
    base = re.split(r"[\\/]", name or "")[-1]
    base = re.sub(r"[^A-Za-z0-9._ ()-]", "_", base).strip(" .") or "working.pdf"
    if not base.lower().endswith(".pdf"):
        base += ".pdf"
    if len(base) > MAX_FILENAME:
        base = base[: MAX_FILENAME - 4] + ".pdf"
    return base


def info(attachment: AnswerAttachment | None) -> dict | None:
    if attachment is None:
        return None
    return {
        "id": attachment.id,
        "filename": attachment.filename,
        "sizeBytes": attachment.size_bytes,
        "pageCount": attachment.page_count,
        "uploadedAt": attachment.created_at.isoformat() if attachment.created_at else None,
    }


def question_rule(question: Question) -> str:
    return upload_rule_service.rule_of(question)


def require_takes_upload(question: Question) -> None:
    if question_rule(question) == "NONE":
        api_error(422, "NO_UPLOAD_HERE", "This question doesn't take a PDF.")


def _store(db: Session, student: Student, user: User, question: Question, data: bytes, filename: str, pages: int,
           *, attempt_answer_id: str | None = None, mock_answer_id: str | None = None) -> AnswerAttachment:
    """Saves the bytes and the record, replacing what the answer had."""
    column = AnswerAttachment.attempt_answer_id if attempt_answer_id else AnswerAttachment.mock_answer_id
    existing = db.query(AnswerAttachment).filter(column == (attempt_answer_id or mock_answer_id)).first()
    storage = file_storage.get_storage()
    key = f"answers/{student.id}/{uuid.uuid4().hex}.pdf"
    storage.save(db, key, data)
    if existing is not None:
        file_storage.get_storage(existing.storage_backend).delete(db, existing.storage_key)
        db.delete(existing)
        db.flush()
    record = AnswerAttachment(
        student_id=student.id,
        question_id=question.id,
        attempt_answer_id=attempt_answer_id,
        mock_answer_id=mock_answer_id,
        filename=clean_filename(filename),
        content_type="application/pdf",
        size_bytes=len(data),
        page_count=pages,
        sha256=hashlib.sha256(data).hexdigest(),
        storage_backend=storage.name,
        storage_key=key,
        uploaded_by_user_id=user.id,
    )
    db.add(record)
    db.flush()
    return record


def _drop(db: Session, attachment: AnswerAttachment) -> None:
    file_storage.get_storage(attachment.storage_backend).delete(db, attachment.storage_key)
    db.delete(attachment)
    db.flush()


def read_bytes(db: Session, attachment: AnswerAttachment) -> bytes | None:
    return file_storage.get_storage(attachment.storage_backend).read(db, attachment.storage_key)


# --- practice --------------------------------------------------------------------------------


def _practice_answer(db: Session, student: Student, attempt_id: str, question_id: str) -> tuple[AttemptAnswer, Question]:
    attempt = learning_service._get_owned_attempt(db, student, attempt_id)
    if attempt.status != "IN_PROGRESS":
        api_error(409, "ATTEMPT_LOCKED", "This attempt has already been submitted and can no longer be changed.")
    activity = attempt.assignment_target.assignment.learning_activity
    if question_id not in learning_service._activity_question_ids(db, activity.id):
        api_error(422, "VALIDATION_ERROR", "That question isn't part of this practice.")
    question = db.get(Question, question_id)
    answer = (
        db.query(AttemptAnswer)
        .filter(AttemptAnswer.attempt_id == attempt.id, AttemptAnswer.question_id == question_id)
        .first()
    )
    if answer is None:
        answer = AttemptAnswer(
            attempt_id=attempt.id, question_id=question_id, max_score=question.marks, answered_at=datetime.now(UTC)
        )
        db.add(answer)
        db.flush()
    return answer, question


def attach_to_attempt(db: Session, student: Student, user: User, attempt_id: str, question_id: str,
                      filename: str | None, data: bytes) -> AnswerAttachment:
    answer, question = _practice_answer(db, student, attempt_id, question_id)
    require_takes_upload(question)
    pages = check_pdf(data)
    record = _store(db, student, user, question, data, filename or "", pages, attempt_answer_id=answer.id)
    db.commit()
    return record


def remove_from_attempt(db: Session, student: Student, attempt_id: str, question_id: str) -> None:
    answer, _question = _practice_answer(db, student, attempt_id, question_id)
    existing = db.query(AnswerAttachment).filter(AnswerAttachment.attempt_answer_id == answer.id).first()
    if existing is not None:
        _drop(db, existing)
    db.commit()


def for_attempt_answers(db: Session, answer_ids: list[str]) -> dict[str, AnswerAttachment]:
    if not answer_ids:
        return {}
    rows = db.query(AnswerAttachment).filter(AnswerAttachment.attempt_answer_id.in_(answer_ids)).all()
    return {row.attempt_answer_id: row for row in rows}


def for_mock_answers(db: Session, answer_ids: list[str]) -> dict[str, AnswerAttachment]:
    if not answer_ids:
        return {}
    rows = db.query(AnswerAttachment).filter(AnswerAttachment.mock_answer_id.in_(answer_ids)).all()
    return {row.mock_answer_id: row for row in rows}


# --- mock papers -----------------------------------------------------------------------------


def attach_to_mock(db: Session, student: Student, user: User, paper_id: str, question_id: str,
                   filename: str | None, data: bytes) -> AnswerAttachment:
    from app.services import mock_sitting_service

    answer, question = mock_sitting_service.answer_for_upload(db, student, paper_id, question_id)
    require_takes_upload(question)
    pages = check_pdf(data)
    record = _store(db, student, user, question, data, filename or "", pages, mock_answer_id=answer.id)
    answer.answered_at = datetime.now(UTC)
    db.commit()
    return record


def remove_from_mock(db: Session, student: Student, paper_id: str, question_id: str) -> None:
    from app.services import mock_sitting_service

    answer, _question = mock_sitting_service.answer_for_upload(db, student, paper_id, question_id)
    existing = db.query(AnswerAttachment).filter(AnswerAttachment.mock_answer_id == answer.id).first()
    if existing is not None:
        _drop(db, existing)
    db.commit()
