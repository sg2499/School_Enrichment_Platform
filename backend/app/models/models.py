"""Phase 1 model set: identity, roles, and the multi-tenant School anchor.

Scope discipline (deliberate, Phase 1 exit gate is "login, roles, and
deployment work end to end -- no real curriculum yet"): this file
intentionally does NOT include the Board/Curriculum Version/Class/Subject
Group/Board Course/Chapter/Concept Lesson/Learning Activity hierarchy, the
Assignment/Attempt lifecycle, or the assessment engine. Those are Phase 2
(Curriculum Studio) and Phase 3 (five-day learning loop) work, per
IMPLEMENTATION_ROADMAP.md and PHASE_0_CODE_AUDIT.md's Replace bucket --
building them now, before the curriculum shape is actually in use, would
mean guessing at a schema instead of designing it against real content.

Provenance against PHASE_0_CODE_AUDIT.md:
- User: Retain as-is (MathPath's app/models/models.py).
- School: new -- not in MathPath at all. Every table that references a
  student/teacher/class must ultimately scope to a school_id (multi-tenant
  discipline, ENGINEERING_OPERATING_SYSTEM.md Section 5) -- this is the
  root of that scoping, so it has to exist before Student/Teacher do.
- Student / Teacher: Refactor. Dropped current_module_id/current_level_id
  (pointed at MathPath's DPS curriculum, no equivalent here). Added
  school_id. Kept the generic profile/parent-contact fields as-is --
  useful for any school's student records, not Abacus-specific.
- AuditLog: Retain as-is, minus the attempt_id column (no Attempt table
  exists yet in Phase 1 -- re-added in Phase 3 when it does).
- SchoolAdmin: new (17 Aug 2026, Phase 1 exit-gate work) -- ADMIN is the one
  role with no dedicated profile table, so before this there was no way to
  record which school an admin actually administers (Student/Teacher already
  carry school_id on their own rows). Mirrors the Student/Teacher pattern
  exactly rather than bolting a school_id onto User directly, so a future
  "admin manages multiple schools" scenario needs no further schema change --
  just another row. SUPER_ADMIN (platform operator, not tied to one school)
  deliberately has no SchoolAdmin row, same way School itself has no owner
  column.
"""
import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import relationship

from app.database import Base


def uuid_str() -> str:
    return str(uuid.uuid4())


class School(Base):
    __tablename__ = "schools"
    id = Column(String, primary_key=True, default=uuid_str)
    name = Column(String(255), nullable=False)
    board = Column(String(30), nullable=True)  # "CBSE" | "ICSE" -- free text for now, no enum lock-in yet
    city = Column(String(150), nullable=True)
    state = Column(String(150), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, default=uuid_str)
    full_name = Column(String(150), nullable=False)
    email = Column(String(150), unique=True, nullable=True)
    phone = Column(String(20), unique=True, nullable=True)
    photo_url = Column(Text, nullable=True)
    password_hash = Column(Text, nullable=False)
    password_changed_at = Column(DateTime(timezone=True), nullable=True)
    # Lightweight session-revocation mechanism: any access token issued
    # (iat) before this timestamp is rejected in get_current_user(), the
    # same way password_changed_at already invalidates old tokens on a
    # password change. Lets an admin (or the user themselves) force-logout
    # every active session without requiring a password reset first.
    session_invalidated_at = Column(DateTime(timezone=True), nullable=True)
    role = Column(String(30), nullable=False)  # "ADMIN" | "TEACHER" | "STUDENT" (+ "SUPER_ADMIN")
    is_active = Column(Boolean, default=True, nullable=False)
    last_active_at = Column(DateTime(timezone=True), nullable=True)
    # Optional TOTP-based 2FA, gated to ADMIN/SUPER_ADMIN in the API layer.
    # totp_secret is only set once setup is confirmed via a correct code;
    # a pending/unconfirmed secret lives in totp_pending_secret so a user
    # who never finishes setup can't be locked into a half-configured
    # state. Backup codes are stored hashed, never in plaintext.
    totp_secret = Column(Text, nullable=True)
    totp_pending_secret = Column(Text, nullable=True)
    totp_enabled = Column(Boolean, default=False, nullable=False)
    totp_backup_codes_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Student(Base):
    __tablename__ = "students"
    id = Column(String, primary_key=True, default=uuid_str)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    school_id = Column(String, ForeignKey("schools.id", ondelete="RESTRICT"), nullable=False, index=True)

    student_code = Column(String(50), unique=True, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    custom_id = Column(String(80), unique=True, nullable=True)
    teacher_id = Column(String, ForeignKey("teachers.id", ondelete="SET NULL"), nullable=True, index=True)
    admission_date = Column(String(30), nullable=True)
    dob = Column(String(30), nullable=True)
    gender = Column(String(30), nullable=True)
    blood_group = Column(String(30), nullable=True)
    photo_url = Column(Text, nullable=True)
    signature_url = Column(Text, nullable=True)

    present_address = Column(Text, nullable=True)
    permanent_address = Column(Text, nullable=True)
    class_name = Column(String(50), nullable=True)
    section = Column(String(50), nullable=True)

    father_name = Column(String(150), nullable=True)
    father_occupation = Column(String(150), nullable=True)
    father_mobile = Column(String(30), nullable=True)
    father_email = Column(String(150), nullable=True)
    father_whatsapp = Column(String(30), nullable=True)
    mother_name = Column(String(150), nullable=True)
    mother_occupation = Column(String(150), nullable=True)
    mother_mobile = Column(String(30), nullable=True)
    mother_email = Column(String(150), nullable=True)
    mother_whatsapp = Column(String(30), nullable=True)

    school = relationship("School")
    user = relationship("User")
    assigned_teacher = relationship("Teacher", foreign_keys=[teacher_id])


class Teacher(Base):
    __tablename__ = "teachers"
    id = Column(String, primary_key=True, default=uuid_str)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    school_id = Column(String, ForeignKey("schools.id", ondelete="RESTRICT"), nullable=False, index=True)

    teacher_code = Column(String(50), unique=True, nullable=False)
    designation = Column(String(120), nullable=True)
    subject_specialization = Column(String(150), nullable=True)
    qualification = Column(String(150), nullable=True)
    joining_date = Column(String(30), nullable=True)
    address = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    photo_url = Column(Text, nullable=True)
    signature_url = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    school = relationship("School")
    user = relationship("User")


class SchoolAdmin(Base):
    __tablename__ = "school_admins"
    id = Column(String, primary_key=True, default=uuid_str)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    school_id = Column(String, ForeignKey("schools.id", ondelete="RESTRICT"), nullable=False, index=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    school = relationship("School")
    user = relationship("User")


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(String, primary_key=True, default=uuid_str)
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    student_id = Column(String, ForeignKey("students.id"), nullable=True, index=True)
    event_type = Column(String(100), nullable=False)
    event_data_json = Column(Text)
    ip_address = Column(String(100))
    user_agent = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
