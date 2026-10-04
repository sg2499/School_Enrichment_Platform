"""Login, session-payload shaping, and force-logout.

Refactor of MathPath's app/services/auth_service.py (Phase 0 audit) --
mechanics unchanged, user_payload()'s student block swapped from
currentModuleId/currentLevelId (DPS curriculum pointers, no equivalent
here) to schoolId (this platform's multi-tenant anchor).
"""
from datetime import datetime, timedelta, timezone

from fastapi import Request
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.core.errors import WAY_IN_FOR_ROLE, api_error, who_can_help, wrong_way_in_message
from app.core.security import (
    create_access_token,
    create_two_factor_challenge_token,
    verify_dummy_password,
    verify_password,
)
from app.models import School, SchoolAdmin, Student, Teacher, User
from app.services.audit_service import log_audit_event
from app.services.session_service import revoke_all_sessions_for_user, start_session

# Per-account login lockout (2026-08-19 security hardening). The existing
# slowapi rate limit on POST /auth/login (5/minute) is per-IP -- it does
# nothing against a credential-stuffing attempt spread across many source
# IPs, or one aimed at a single high-value account from a shared school
# network where blocking the IP would also lock out legitimate users. This
# is a second, independent layer keyed to the account itself.
MAX_FAILED_LOGIN_ATTEMPTS = 5
LOCKOUT_DURATION_MINUTES = 15


def _aware_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _is_locked(user: User) -> bool:
    return bool(user.locked_until) and _aware_utc(user.locked_until) > datetime.now(timezone.utc)


# Public alias -- routes_auth.py's two_factor_verify_login (A9 fix) needs the
# same lockout check login() uses below, so this one is exported rather than
# duplicated.
is_account_locked = _is_locked


def record_failed_attempt(db: Session, user: User, request: Request | None, event_type: str) -> bool:
    """Increment the shared per-account lockout counter and lock the account
    if it crosses the threshold. Returns True if this call just locked the
    account.

    A9 fix (30 Sep 2026 review): previously only used by login() below for a
    wrong password -- routes_auth.py's two_factor_verify_login now calls this
    too for a wrong 2FA code, so an attacker who already has the password but
    not the second factor trips the same lockout as one guessing the
    password itself, instead of being able to brute-force TOTP/backup codes
    with only a shared 10/minute IP limit standing in the way.
    """
    user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
    if user.failed_login_attempts >= MAX_FAILED_LOGIN_ATTEMPTS:
        user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=LOCKOUT_DURATION_MINUTES)
        log_audit_event(
            db,
            f"{event_type}.locked",
            user_id=user.id,
            request=request,
            details={"failedAttempts": user.failed_login_attempts},
        )
        db.commit()
        return True
    log_audit_event(
        db,
        event_type,
        user_id=user.id,
        request=request,
        details={"failedAttempts": user.failed_login_attempts},
    )
    db.commit()
    return False


def reset_lockout(user: User) -> None:
    if user.failed_login_attempts or user.locked_until:
        user.failed_login_attempts = 0
        user.locked_until = None


def _school_name(db: Session, school_id: str | None) -> str | None:
    """Human-readable school name for display only (the workspace footer,
    and a school admin's own label, "<School> Admin" -- see frontend
    lib/pageTitle.ts's roleLabel()). Never used for authorization; schoolId
    remains the real tenant anchor everywhere else."""
    if not school_id:
        return None
    school = db.query(School).filter(School.id == school_id).first()
    return school.name if school else None


def public_profile_photo_url(user: User, stored_photo: str | None) -> str | None:
    if not stored_photo:
        return None
    if isinstance(stored_photo, str) and stored_photo.startswith("data:"):
        return f"/api/auth/profile-photo/{user.id}"
    return stored_photo


def user_login_id(user: User, student: Student | None = None, teacher: Teacher | None = None) -> str | None:
    if user.email:
        return user.email
    if user.phone:
        return user.phone
    if student and student.student_code:
        return student.student_code
    if teacher and teacher.teacher_code:
        return teacher.teacher_code
    return None


def user_payload(db: Session, user: User) -> dict:
    # Speed: joinedload(...School) folds the "what's this school called"
    # lookup into the SAME query as the role-profile row (one round trip to
    # Postgres instead of two sequential ones) -- shaves a full network hop
    # off every login response. Login latency is otherwise dominated by
    # bcrypt's deliberately-slow hash check (unavoidable, security-required)
    # and network RTT, so trimming avoidable extra round trips like this one
    # is where real speed is actually won at the application layer.
    student = None
    teacher = None

    if user.role == "STUDENT":
        student = (
            db.query(Student)
            .options(joinedload(Student.school))
            .filter(Student.user_id == user.id)
            .first()
        )

    if user.role == "TEACHER":
        teacher = (
            db.query(Teacher)
            .options(joinedload(Teacher.school))
            .filter(Teacher.user_id == user.id)
            .first()
        )

    school_admin = None
    if user.role == "ADMIN":
        # SUPER_ADMIN deliberately excluded: platform-wide, not tied to one
        # school, so it has no SchoolAdmin row to look up.
        school_admin = (
            db.query(SchoolAdmin)
            .options(joinedload(SchoolAdmin.school))
            .filter(SchoolAdmin.user_id == user.id)
            .first()
        )

    data = {
        "id": user.id,
        "fullName": user.full_name,
        "role": user.role,
        "email": user.email,
        "phone": user.phone,
        "loginId": user_login_id(user, student, teacher),
        "isActive": user.is_active,
        "profilePhotoUrl": public_profile_photo_url(user, user.photo_url),
        "twoFactorEnabled": bool(user.totp_enabled),
        # A1 fix: lets the frontend redirect straight to the change-password
        # flow instead of surfacing a raw 403 from the first blocked API
        # call. See dependencies.py's MUST_CHANGE_PASSWORD_ROLES for the
        # server-side enforcement this mirrors.
        "mustChangePassword": bool(user.must_change_password),
    }

    if student:
        data["profilePhotoUrl"] = public_profile_photo_url(user, student.photo_url or user.photo_url)
        data["student"] = {
            "id": student.id,
            "schoolId": student.school_id,
            "schoolName": student.school.name if student.school else None,
            "studentCode": student.student_code,
            "customId": student.custom_id,
            "photoUrl": public_profile_photo_url(user, student.photo_url),
            "signatureUrl": student.signature_url,
            "className": student.class_name,
            "section": student.section,
        }

    if teacher:
        data["profilePhotoUrl"] = public_profile_photo_url(user, teacher.photo_url or user.photo_url)
        data["teacher"] = {
            "id": teacher.id,
            "schoolId": teacher.school_id,
            "schoolName": teacher.school.name if teacher.school else None,
            "teacherCode": teacher.teacher_code,
            "photoUrl": public_profile_photo_url(user, teacher.photo_url),
            "signatureUrl": teacher.signature_url,
            "designation": teacher.designation,
            "subjectSpecialization": teacher.subject_specialization,
        }

    if school_admin:
        data["admin"] = {
            "id": school_admin.id,
            "schoolId": school_admin.school_id,
            "schoolName": school_admin.school.name if school_admin.school else None,
        }

    return data


def login(
    db: Session,
    identifier: str,
    password: str,
    request: Request | None = None,
    sign_in_as: str | None = None,
) -> dict:
    """Sign someone in.

    `sign_in_as` is the way in chosen on the sign-in page ("STUDENT",
    "TEACHER" or "ADMIN"). When it is given, only that kind of account is
    let in through it: see the check after the password below. None means
    the caller did not say (a page loaded before this existed, mid-deploy),
    and the account's own role decides, as it always did. What was chosen is
    written beside every accepted password in the audit trail, so the day
    nothing arrives without it is visible, and the field can then be
    required.
    """
    chosen_way_in = {"signInAs": sign_in_as} if sign_in_as is not None else None
    cleaned_identifier = identifier.strip() if identifier else ""
    # Case-insensitive but exact -- deliberately not ilike(). ilike() treats
    # a raw, unescaped identifier as a SQL LIKE pattern, so a login attempt
    # containing "%" or "_" would be interpreted as a wildcard against every
    # email/code in the table instead of matched literally.
    lowered_identifier = cleaned_identifier.lower()
    user = db.query(User).filter(
        (func.lower(User.email) == lowered_identifier) | (User.phone == cleaned_identifier)
    ).first()

    if not user:
        student = db.query(Student).filter(func.lower(Student.student_code) == lowered_identifier).first()
        user = student.user if student else None

    if not user:
        teacher = db.query(Teacher).filter(func.lower(Teacher.teacher_code) == lowered_identifier).first()
        user = teacher.user if teacher else None

    if not user:
        # A7 fix (30 Sep 2026 review): a nonexistent identifier used to
        # return immediately here, skipping bcrypt entirely, while a real
        # account always ran a bcrypt verify first (a deliberately slow,
        # ~100ms+ operation) -- proven by test, the two cases were
        # trivially distinguishable by response time alone, letting an
        # attacker enumerate valid identifiers without needing a different
        # status code or message. Running the same dummy bcrypt verify here
        # equalizes the timing of both code paths.
        verify_dummy_password()
        api_error(401, "INVALID_CREDENTIALS", "Those sign-in details don't match. Please check them and try again.")

    if _is_locked(user):
        log_audit_event(db, "auth.login.blocked_locked", user_id=user.id, request=request)
        db.commit()
        api_error(
            423,
            "ACCOUNT_LOCKED",
            "Too many incorrect sign-in attempts. This account is locked for a short while. "
            "Please try again in a few minutes.",
        )

    # The hash this sign-in is proven against, kept as its own value. Every
    # commit below expires `user`, and its next attribute read reloads the
    # row -- so reading user.password_hash again at the bottom would bind the
    # new session to whatever password the account has BY THEN. If the
    # owner replaced the password while this request was busy hashing, that
    # would be a session under the new password for someone who only ever
    # knew the old one. The token is issued under the hash that was checked.
    verified_hash = user.password_hash
    if not verify_password(password, verified_hash):
        locked = record_failed_attempt(db, user, request, "auth.login.failed")
        if locked:
            api_error(
                423,
                "ACCOUNT_LOCKED",
                f"Too many incorrect sign-in attempts. This account is locked for {LOCKOUT_DURATION_MINUTES} minutes. "
                "Please try again after that.",
            )
        api_error(401, "INVALID_CREDENTIALS", "Those sign-in details don't match. Please check them and try again.")

    # Correct password -- clear any accumulated lockout state so a
    # legitimate sign-in isn't held against a later, unrelated attempt.
    if user.failed_login_attempts or user.locked_until:
        reset_lockout(user)
        db.commit()

    if not user.is_active:
        # The password was right, so this is the account's owner: say who
        # can reactivate it for someone in their role, not "the admin" --
        # which, for an admin, is nobody.
        api_error(
            403,
            "ACCOUNT_INACTIVE",
            f"This account is inactive. Please ask {who_can_help(user.role)} to reactivate it.",
        )

    # Right details, wrong way in (4 Oct 2026). Until now the choice on the
    # sign-in page only changed its wording: an admin's details under
    # "Teacher" went on to the two-factor step and into the admin workspace.
    # Each way in now takes only its own kind of account. This sits AFTER the
    # password check on purpose: a wrong password gets the one sentence it
    # always got, whatever was chosen, so the page cannot be used to learn
    # what kind of account an address belongs to. And it sits BEFORE the
    # second factor and the session: nothing is issued, not even a challenge.
    #
    # One thing to know when reading the audit trail: this event means the
    # PASSWORD WAS RIGHT. Someone who holds a password but not its second
    # factor can produce it without ever producing a success.
    expected_way_in = WAY_IN_FOR_ROLE.get(user.role)
    if sign_in_as is not None and sign_in_as != expected_way_in:
        log_audit_event(
            db,
            "auth.login.wrong_way_in",
            user_id=user.id,
            request=request,
            details={"chosen": sign_in_as, "accountUses": expected_way_in},
        )
        db.commit()
        api_error(403, "WRONG_SIGN_IN_TAB", wrong_way_in_message(user.role), {"signInAs": expected_way_in})

    if user.totp_enabled:
        # Password was correct, but a second factor is required before a
        # real access token is issued -- logged as its own event, distinct
        # from auth.login.success below, so an audit trail can show a
        # password-correct-but-2FA-pending step separately from a fully
        # completed sign-in (see two_factor_verify_login in routes_auth.py
        # for the event logged once the second factor actually clears).
        log_audit_event(db, "auth.login.password_ok_awaiting_2fa", user_id=user.id, request=request, details=chosen_way_in)
        db.commit()
        return {
            "twoFactorRequired": True,
            "challengeToken": create_two_factor_challenge_token(user.id, password_hash=verified_hash),
            "tokenType": "Bearer",
        }

    session_id = start_session(db, user, request=request)
    log_audit_event(db, "auth.login.success", user_id=user.id, request=request, details=chosen_way_in)
    db.commit()
    token = create_access_token(user.id, user.role, session_id=session_id, password_hash=verified_hash)
    return {
        "accessToken": token,
        "tokenType": "Bearer",
        "user": user_payload(db, user),
    }


def export_user_data(db: Session, user: User) -> dict:
    """Everything the platform holds that's actually *about* this one user --
    the "download my data" self-service export (2026-08-19 security
    hardening, data protection Task #61). Deliberately excludes secrets that
    exist in the schema but aren't meaningfully "the user's data" to hand
    back to them: password_hash, totp_secret/totp_pending_secret, and
    hashed backup codes are all one-way hashes the user already knows the
    plaintext of (or, for backup codes, already saw once at generation
    time) -- returning the hash itself would expose nothing useful and
    would be a strange thing to put in a downloadable file.

    Scoped strictly to this user's own rows -- a student's export never
    includes another student's data, and an ADMIN's export is their own
    account only, not their whole school's roster (that's a different,
    not-yet-built bulk-export feature with a different authorization
    story, same reasoning as session_service.py's revoke_session
    docstring)."""
    from app.models import AuditLog, UserSession

    student = db.query(Student).filter(Student.user_id == user.id).first() if user.role == "STUDENT" else None
    teacher = db.query(Teacher).filter(Teacher.user_id == user.id).first() if user.role == "TEACHER" else None
    school_admin = (
        db.query(SchoolAdmin).filter(SchoolAdmin.user_id == user.id).first() if user.role == "ADMIN" else None
    )

    data: dict = {
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "account": {
            "id": user.id,
            "fullName": user.full_name,
            "email": user.email,
            "phone": user.phone,
            "role": user.role,
            "isActive": user.is_active,
            "twoFactorEnabled": bool(user.totp_enabled),
            "createdAt": user.created_at.isoformat() if user.created_at else None,
            "lastActiveAt": user.last_active_at.isoformat() if user.last_active_at else None,
        },
    }

    if student:
        data["studentProfile"] = {
            "schoolId": student.school_id,
            "schoolName": _school_name(db, student.school_id),
            "studentCode": student.student_code,
            "customId": student.custom_id,
            "className": student.class_name,
            "section": student.section,
            "admissionDate": student.admission_date,
            "dob": student.dob,
            "gender": student.gender,
            "bloodGroup": student.blood_group,
            "presentAddress": student.present_address,
            "permanentAddress": student.permanent_address,
            "fatherName": student.father_name,
            "fatherOccupation": student.father_occupation,
            "fatherMobile": student.father_mobile,
            "fatherEmail": student.father_email,
            "fatherWhatsapp": student.father_whatsapp,
            "motherName": student.mother_name,
            "motherOccupation": student.mother_occupation,
            "motherMobile": student.mother_mobile,
            "motherEmail": student.mother_email,
            "motherWhatsapp": student.mother_whatsapp,
        }

    if teacher:
        data["teacherProfile"] = {
            "schoolId": teacher.school_id,
            "schoolName": _school_name(db, teacher.school_id),
            "teacherCode": teacher.teacher_code,
            "designation": teacher.designation,
            "subjectSpecialization": teacher.subject_specialization,
            "qualification": teacher.qualification,
            "joiningDate": teacher.joining_date,
            "address": teacher.address,
            "notes": teacher.notes,
        }

    if school_admin:
        data["adminProfile"] = {
            "schoolId": school_admin.school_id,
            "schoolName": _school_name(db, school_admin.school_id),
        }

    # Capped at the 200 most recent rows each -- a genuinely complete export
    # for a long-lived account could otherwise be unbounded; this is a
    # "your recent activity and access history" export, not a full
    # unbounded database dump, matching the surface already visible to the
    # user themselves via GET /auth/sessions.
    sessions = (
        db.query(UserSession)
        .filter(UserSession.user_id == user.id)
        .order_by(UserSession.created_at.desc())
        .limit(200)
        .all()
    )
    data["loginSessions"] = [
        {
            "ipAddress": s.ip_address,
            "userAgent": s.user_agent,
            "createdAt": s.created_at.isoformat() if s.created_at else None,
            "lastSeenAt": s.last_seen_at.isoformat() if s.last_seen_at else None,
            "revokedAt": s.revoked_at.isoformat() if s.revoked_at else None,
        }
        for s in sessions
    ]

    audit_rows = (
        db.query(AuditLog)
        .filter(AuditLog.user_id == user.id)
        .order_by(AuditLog.created_at.desc())
        .limit(200)
        .all()
    )
    data["accountActivity"] = [
        {
            "eventType": row.event_type,
            "ipAddress": row.ip_address,
            "createdAt": row.created_at.isoformat() if row.created_at else None,
        }
        for row in audit_rows
    ]

    return data


def force_logout_user(db: Session, user: User, request: Request | None = None) -> None:
    """Invalidate every access token already issued to this user."""
    user.session_invalidated_at = datetime.now(timezone.utc)
    revoke_all_sessions_for_user(db, user.id)
    log_audit_event(db, "auth.logout_all_sessions", user_id=user.id, request=request)
    db.commit()
