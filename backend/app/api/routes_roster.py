"""Account creation and roster management ("People") -- the endpoints
routes_platform.py's own file comment flagged as "not built yet."

Scope (19 Aug 2026, Shailesh, before Phase 3): SUPER_ADMIN creates ADMIN
accounts for an existing school; ADMIN creates TEACHER/STUDENT accounts for
their own school (SUPER_ADMIN can do the same for any school by passing
schoolId, mirroring Curriculum Studio's own SUPER_ADMIN-picks-a-school
pattern). This is deliberately separate from routes_platform.py's
POST /platform/schools, which stays as the rare, operator-key-gated "onboard
a brand new school" event -- these are the everyday, session-authenticated,
in-product endpoints a signed-in admin uses afterwards to build out their
roster.

Initial password -- **changed 30 Sep 2026, security/DPDP review, finding
A1** (superseding the 19 Aug 2026 decision this docstring used to describe):
the first-last-name pattern was proven exploitable end to end -- anyone who
knows a child's (or a freshly created ADMIN's) name and school can compute
their password, and since neither 2FA setup nor /change-password was gated
on actually replacing it, whoever logged in first could permanently take
the account over. _generate_initial_password() below now returns a random,
unguessable password instead, and every new account is created with
must_change_password=True, which dependencies.py's get_current_user()
enforces for every role (teachers and students since 3 Oct 2026): the
account can do nothing until its owner has replaced the issued password.
A generated password is deliberately NOT checked against
strong_password_issue() -- that check is about a *person* picking a
memorable-but-weak password, which doesn't apply to a random value.

A password chosen by the school (a `password` column in a bulk sheet, 3 Oct 2026) was
removed on 19 Nov 2026 with the People bulk upload: teachers and students now
come in only through the School Setup workbook, whose first passwords are
always generated.
"""
import re
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, contains_eager, joinedload

from app.core.errors import api_error
from app.core.rate_limit import limiter
from app.core.security import hash_password
from app.database import get_db
from app.dependencies import require_roles
from app.models import School, SchoolAdmin, Student, Teacher, User
from app.services.audit_service import log_audit_event
from app.services.auth_service import reset_lockout
from app.services.session_service import revoke_all_sessions_for_user

router = APIRouter(prefix="/api/roster", tags=["roster"])

CREATABLE_ROLES = {"ADMIN", "TEACHER", "STUDENT"}

# A14 remainder (1 Oct 2026, email enumeration): User.email is unique across
# the WHOLE platform, and this used to answer "A user with email
# x@y.com already exists." -- so any school ADMIN (the everyday caller here)
# could confirm whether an arbitrary address was registered anywhere on the
# platform: another school's teacher, a student, another school's admin, the
# super admin. The rejection is now one fixed message, identical whoever
# the address belongs to (this school, another school, any role), that
# never echoes the address and never says it exists -- while still telling a
# legitimate admin what to do next. Nothing logs the address either: the
# audit row for a rejection (roster.person_create_email_rejected) records
# only role/school/count -- audit rows reach a user through their own
# /me/export, so the address must not be in them.
#
# What this deliberately can't hide: with platform-wide unique emails and
# synchronous creation, "created" vs "not created" is itself an answer.
# The rejection no longer says WHY or for WHOM, and each "free" probe leaves
# a real account in the school's roster plus an audit row, so it is noisy;
# closing it entirely would need a design change (per-school email
# uniqueness, or invite-and-verify account creation).
EMAIL_NOT_ACCEPTED_MESSAGE = (
    "This account could not be created with that email address. Check that it is typed correctly; "
    "if it is, use a different email address, or for a teacher or student leave the email blank "
    "(they can sign in with their login code instead)."
)


class _EmailNotAccepted(ValueError):
    """The email is already taken somewhere on the platform. A ValueError
    like every other _create_person rejection (same 422 shape to the
    client); a separate class only so the audit trail can count these."""

# A1 fix: a short, easy-to-transcribe-by-hand random password -- unambiguous
# character set (no 0/O/1/l/I) since this is read off a screen and typed by
# an adult on behalf of a student/teacher, or handed to a new admin
# verbally/in writing. 12 characters from a ~29-character alphabet is far
# outside guessing range while still being something a person can type
# without a password manager.
_INITIAL_PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"


def _generate_initial_password(full_name: str) -> str:
    # full_name is unused now (kept as a parameter so call sites don't need
    # to change) -- the password is fully random and no longer derived from
    # the name at all, closing the "computable from a public name" gap A1
    # found.
    return "".join(secrets.choice(_INITIAL_PASSWORD_ALPHABET) for _ in range(12))


def _school_prefix(school_name: str) -> str:
    letters = re.sub(r"[^A-Za-z]", "", school_name).upper()
    return letters[:4] or "SCH"


def _next_code(db: Session, model, code_column, tag: str, school_name: str) -> str:
    """STU-DPS-0001 style codes, scoped by a readable prefix derived from
    the school name. Not a DB sequence (codes are globally unique, not
    per-school), so this counts existing matches under the same prefix and
    retries forward on the rare collision -- fine at onboarding volume."""
    stub = f"{tag}-{_school_prefix(school_name)}-"
    seq = db.query(model).filter(code_column.like(f"{stub}%")).count() + 1
    for _ in range(200):
        candidate = f"{stub}{seq:04d}"
        if not db.query(model).filter(code_column == candidate).first():
            return candidate
        seq += 1
    api_error(500, "CODE_GENERATION_FAILED", "We couldn't generate an account code just now. Please try again.")


def _resolve_school(db: Session, user: User, requested_school_id: str | None) -> School:
    """Same rule as Curriculum Studio's _resolve_school_id (routes_curriculum_admin.py):
    ADMIN always acts on their own school, looked up server-side; SUPER_ADMIN
    must say which school they mean. Kept as a local copy rather than a
    cross-module import so this file stays self-contained."""
    if user.role == "SUPER_ADMIN":
        if not requested_school_id:
            api_error(422, "VALIDATION_ERROR", "Choose a school first.")
        school = db.get(School, requested_school_id)
        if not school:
            api_error(404, "NOT_FOUND", "That school couldn't be found.")
        return school

    school_admin = db.query(SchoolAdmin).filter(SchoolAdmin.user_id == user.id).first()
    if not school_admin:
        api_error(403, "FORBIDDEN", "Your admin account isn't linked to a school. Please contact your platform administrator.")
    if requested_school_id and requested_school_id != school_admin.school_id:
        api_error(403, "FORBIDDEN", "You can only manage people in your own school.")
    school = db.get(School, school_admin.school_id)
    return school


def _create_person(
    db: Session,
    *,
    creator: User,
    school: School,
    role: str,
    full_name: str,
    email: str | None,
    class_name: str | None = None,
    section: str | None = None,
    designation: str | None = None,
    subject_specialization: str | None = None,
    qualification: str | None = None,
) -> dict:
    """One new account with a generated first password (returned once)."""
    full_name = (full_name or "").strip()
    if not full_name:
        raise ValueError("Full name is required.")
    cleaned_email = email.strip().lower() if email else None
    if cleaned_email and ("@" not in cleaned_email or cleaned_email.startswith("@") or cleaned_email.endswith("@")):
        raise ValueError("Enter a valid email address.")
    if role == "ADMIN" and not cleaned_email:
        raise ValueError("An email address is required for an admin account. Admins sign in with their email.")
    if cleaned_email and db.query(User).filter(User.email == cleaned_email).first():
        # Never echo the address or say it exists -- see EMAIL_NOT_ACCEPTED_MESSAGE.
        raise _EmailNotAccepted(EMAIL_NOT_ACCEPTED_MESSAGE)

    # Worked out before anything is written (it only reads), so a chosen
    # password can be checked against it and a refused row creates nothing.
    code = None
    if role == "TEACHER":
        code = _next_code(db, Teacher, Teacher.teacher_code, "TCH", school.name)
    elif role == "STUDENT":
        code = _next_code(db, Student, Student.student_code, "STU", school.name)

    initial_password = _generate_initial_password(full_name)
    new_user = User(
        full_name=full_name,
        email=cleaned_email,
        password_hash=hash_password(initial_password),
        role=role,
        is_active=True,
        # A1 fix: set for every new account, whichever role and whoever
        # chose the password. Its owner replaces it at first sign-in, and
        # can do nothing else until they have (dependencies.py).
        must_change_password=True,
    )
    db.add(new_user)
    db.flush()  # populate new_user.id

    if role == "ADMIN":
        db.add(SchoolAdmin(user_id=new_user.id, school_id=school.id))
    elif role == "TEACHER":
        db.add(
            Teacher(
                user_id=new_user.id,
                school_id=school.id,
                teacher_code=code,
                designation=designation,
                subject_specialization=subject_specialization,
                qualification=qualification,
            )
        )
    elif role == "STUDENT":
        db.add(
            Student(
                user_id=new_user.id,
                school_id=school.id,
                student_code=code,
                class_name=class_name,
                section=section,
            )
        )

    log_audit_event(
        db,
        "roster.person_created",
        user_id=creator.id,
        details={"createdUserId": new_user.id, "role": role, "schoolId": school.id, "code": code},
    )

    return {
        "id": new_user.id,
        "role": role,
        "fullName": new_user.full_name,
        "email": new_user.email,
        "code": code,
        "schoolId": school.id,
        "schoolName": school.name,
        "initialPassword": initial_password,
        "isActive": True,
    }


class PersonCreateRequest(BaseModel):
    role: str
    fullName: str
    email: str | None = None
    schoolId: str | None = None
    className: str | None = None
    section: str | None = None
    designation: str | None = None
    subjectSpecialization: str | None = None
    qualification: str | None = None


@router.post("/people")
@limiter.limit("30/minute")
def create_person(
    request: Request,
    payload: PersonCreateRequest,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    role = payload.role.strip().upper()
    if role not in CREATABLE_ROLES:
        api_error(422, "VALIDATION_ERROR", "Choose whether this account is for an admin, a teacher or a student.")
    if role == "ADMIN" and user.role != "SUPER_ADMIN":
        api_error(403, "FORBIDDEN", "Only a Super Admin can create Admin accounts.")

    school = _resolve_school(db, user, payload.schoolId)
    try:
        result = _create_person(
            db,
            creator=user,
            school=school,
            role=role,
            full_name=payload.fullName,
            email=payload.email,
            class_name=payload.className,
            section=payload.section,
            designation=payload.designation,
            subject_specialization=payload.subjectSpecialization,
            qualification=payload.qualification,
        )
    except _EmailNotAccepted:
        db.rollback()
        # Recorded (without the address) so repeated rejections from one
        # account -- the signature of someone probing for registered
        # emails -- are visible to the platform operator afterwards.
        log_audit_event(
            db,
            "roster.person_create_email_rejected",
            user_id=user.id,
            request=request,
            details={"role": role, "schoolId": school.id, "count": 1},
        )
        db.commit()
        api_error(422, "VALIDATION_ERROR", EMAIL_NOT_ACCEPTED_MESSAGE)
    except ValueError as exc:
        db.rollback()
        api_error(422, "VALIDATION_ERROR", str(exc))

    db.commit()
    return result


@router.get("/people")
def list_people(
    schoolId: str | None = None,
    role: str | None = None,
    search: str | None = None,
    includeInactive: bool = False,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    role_filter = role.strip().upper() if role else None
    if role_filter and role_filter not in CREATABLE_ROLES:
        api_error(422, "VALIDATION_ERROR", "Choose whether this account is for an admin, a teacher or a student.")

    # ADMIN is always pinned to their own school. SUPER_ADMIN without a
    # schoolId sees only the platform-wide ADMIN roster (there's no single
    # "their own school" to default to); passing schoolId scopes further
    # into that school's Admin/Teacher/Student list, same as Curriculum Studio.
    school = None
    if user.role == "SUPER_ADMIN" and not schoolId and role_filter != "ADMIN" and role_filter is not None:
        api_error(422, "VALIDATION_ERROR", "Choose a school to see its teachers and students.")
    if not (user.role == "SUPER_ADMIN" and not schoolId):
        school = _resolve_school(db, user, schoolId)

    search_term = f"%{search.strip().lower()}%" if search and search.strip() else None
    people: list[dict] = []

    def _matches(*values: str | None) -> bool:
        if not search_term:
            return True
        return any(v and search_term.strip("%") in v.lower() for v in values)

    if role_filter in (None, "ADMIN"):
        # The account row is read in the same query (contains_eager), and
        # the school with it. Each used to be fetched on its own, one more
        # query per person -- about 1,500 for a school of 1,500, on a list
        # the dashboard now reads too (3 Oct 2026).
        q = (
            db.query(SchoolAdmin)
            .join(User, SchoolAdmin.user_id == User.id)
            .options(contains_eager(SchoolAdmin.user), joinedload(SchoolAdmin.school))
        )
        if school is not None:
            q = q.filter(SchoolAdmin.school_id == school.id)
        if not includeInactive:
            q = q.filter(SchoolAdmin.is_active.is_(True))
        for admin in q.all():
            if _matches(admin.user.full_name, admin.user.email):
                people.append(
                    {
                        "id": admin.user.id,
                        "role": "ADMIN",
                        "fullName": admin.user.full_name,
                        "email": admin.user.email,
                        "code": None,
                        "schoolId": admin.school_id,
                        "schoolName": admin.school.name if admin.school else None,
                        "isActive": admin.is_active and admin.user.is_active,
                        "createdAt": admin.created_at.isoformat() if admin.created_at else None,
                    }
                )

    if school is not None and role_filter in (None, "TEACHER"):
        q = (
            db.query(Teacher)
            .join(User, Teacher.user_id == User.id)
            .options(contains_eager(Teacher.user))
            .filter(Teacher.school_id == school.id)
        )
        if not includeInactive:
            q = q.filter(Teacher.is_active.is_(True))
        for teacher in q.all():
            if _matches(teacher.user.full_name, teacher.user.email, teacher.teacher_code):
                people.append(
                    {
                        "id": teacher.user.id,
                        "role": "TEACHER",
                        "fullName": teacher.user.full_name,
                        "email": teacher.user.email,
                        "code": teacher.teacher_code,
                        "designation": teacher.designation,
                        "schoolId": teacher.school_id,
                        "schoolName": school.name,
                        "isActive": teacher.is_active and teacher.user.is_active,
                    }
                )

    if school is not None and role_filter in (None, "STUDENT"):
        q = (
            db.query(Student)
            .join(User, Student.user_id == User.id)
            .options(contains_eager(Student.user))
            .filter(Student.school_id == school.id)
        )
        if not includeInactive:
            q = q.filter(Student.is_active.is_(True))
        for student in q.all():
            if _matches(student.user.full_name, student.user.email, student.student_code):
                people.append(
                    {
                        "id": student.user.id,
                        "role": "STUDENT",
                        "fullName": student.user.full_name,
                        "email": student.user.email,
                        "code": student.student_code,
                        "className": student.class_name,
                        "section": student.section,
                        "schoolId": student.school_id,
                        "schoolName": school.name,
                        "isActive": student.is_active and student.user.is_active,
                    }
                )

    people.sort(key=lambda p: (p["role"], p["fullName"].lower()))
    return {"people": people}


def _manageable_account(
    db: Session,
    user: User,
    person_user_id: str,
    *,
    own_account_message: str,
    admin_account_message: str,
) -> tuple[User, SchoolAdmin | Teacher | Student | None]:
    """The account `user` is asking to manage, and its role profile -- or an
    error if it isn't theirs to manage.

    One rule for every action an admin can take on someone else's account
    (activate/deactivate, reset password), so the two can never drift apart:
      * never your own account -- each action has a self-service equivalent
        or none at all, and its message says which;
      * never a Super Admin's;
      * an Admin's only by a Super Admin;
      * a Teacher's or Student's by a Super Admin, or by an Admin of the
        SAME school. The school comes from the admin's own SchoolAdmin row,
        looked up server-side (_resolve_school), never from the request.

    This is the block update_person_status carried inline until 3 Oct 2026,
    moved here unchanged when reset_person_password needed the same answer.
    """
    target = db.get(User, person_user_id)
    if not target:
        api_error(404, "NOT_FOUND", "That account couldn't be found.")
    if target.id == user.id:
        api_error(422, "VALIDATION_ERROR", own_account_message)

    if target.role == "SUPER_ADMIN":
        api_error(403, "FORBIDDEN", "Super Admin accounts can't be managed from this page.")
    elif target.role == "ADMIN":
        if user.role != "SUPER_ADMIN":
            api_error(403, "FORBIDDEN", admin_account_message)
        profile = db.query(SchoolAdmin).filter(SchoolAdmin.user_id == target.id).first()
    elif target.role == "TEACHER":
        profile = db.query(Teacher).filter(Teacher.user_id == target.id).first()
        if user.role == "ADMIN" and (not profile or profile.school_id != _resolve_school(db, user, None).id):
            api_error(403, "FORBIDDEN", "You can only manage people in your own school.")
    elif target.role == "STUDENT":
        profile = db.query(Student).filter(Student.user_id == target.id).first()
        if user.role == "ADMIN" and (not profile or profile.school_id != _resolve_school(db, user, None).id):
            api_error(403, "FORBIDDEN", "You can only manage people in your own school.")
    else:
        api_error(422, "VALIDATION_ERROR", "This type of account can't be managed from this page.")
    return target, profile


class StatusUpdateRequest(BaseModel):
    isActive: bool


@router.patch("/people/{person_user_id}/status")
def update_person_status(
    person_user_id: str,
    payload: StatusUpdateRequest,
    request: Request,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    target, profile = _manageable_account(
        db,
        user,
        person_user_id,
        own_account_message="You can't deactivate or reactivate your own account.",
        admin_account_message="Only a Super Admin can change an Admin account's status.",
    )

    target.is_active = payload.isActive
    if profile is not None:
        profile.is_active = payload.isActive
    if not payload.isActive:
        # Force-logout any active session immediately, same mechanism the
        # User model already documents for admin-triggered logout.
        target.session_invalidated_at = datetime.now(timezone.utc)

    log_audit_event(
        db,
        "roster.person_status_changed",
        user_id=user.id,
        request=request,
        details={"targetUserId": target.id, "role": target.role, "isActive": payload.isActive},
    )
    db.commit()
    return {"id": target.id, "isActive": target.is_active}


@router.post("/people/{person_user_id}/reset-password")
@limiter.limit("30/minute")
def reset_person_password(
    person_user_id: str,
    request: Request,
    response: Response,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    """An admin resets someone else's forgotten password (3 Oct 2026).

    The gap this closes. A signed-in person can change their own password
    (POST /auth/change-password), but someone who has FORGOTTEN it cannot
    sign in to do that, and until now nothing in the product could help
    them: the only reset was scripts/reset_test_account_password.py, run by
    the platform operator against the database. Meanwhile the sign-in page
    told them "Your school coordinator can reset it for you" -- a promise
    with nothing behind it.

    The intended flow, in Shailesh's words: teachers and students change
    their own password day to day, "and fall back to admin in cases of any
    issues". This is that fallback. Self-service "forgot password" by email
    is not possible yet -- the platform sends no email (config.py: SMTP was
    deliberately left out), and a teacher or student account does not need
    an email address at all.

    What it does:
      * Sets a new random password, the same kind account creation issues
        (_generate_initial_password): unguessable, and typeable by hand.
        The admin does not choose it: for a reset there is nothing to gain
        from a chosen one, and a random one cannot be guessed or reused.
      * Returns it ONCE, in this response. It is stored only as a hash;
        nothing can show it again. If it is lost before it is handed over,
        reset again.
      * Sets must_change_password, so the temporary password is replaced by
        one only its owner knows. Enforced server-side for every role
        (dependencies.py, MUST_CHANGE_PASSWORD_ROLES): until they choose
        their own, the account can do nothing else.
      * Signs the person out everywhere. password_changed_at rejects every
        token issued before this second (dependencies.py compares in whole
        seconds), and revoking their session rows catches one issued within
        it -- and keeps the "signed-in devices" list true. If the reset was
        needed because someone else knew the old password, that someone is
        out too.
      * Clears a sign-in lockout. Forgetting a password and getting locked
        out for guessing are the same afternoon; the new password should
        work the moment it is handed over.

    What it deliberately leaves alone: two-factor. A Super Admin resetting
    an Admin's password does not touch that admin's authenticator or backup
    codes -- the second factor is not something this action has any reason
    to weaken. A lost authenticator stays a separate, operator-level
    recovery.

    Who may call it is _manageable_account's rule, the same one
    activate/deactivate uses.
    """
    target, profile = _manageable_account(
        db,
        user,
        person_user_id,
        own_account_message="You can't reset your own password here. Use Change Password in your profile menu.",
        admin_account_message="Only a Super Admin can reset an Admin's password.",
    )
    if not target.is_active:
        # A temporary password for an account that cannot sign in would be
        # handed over, tried, and fail with a message about something else.
        api_error(409, "ACCOUNT_INACTIVE", "This account is inactive. Reactivate it before resetting its password.")

    temporary_password = _generate_initial_password(target.full_name)
    target.password_hash = hash_password(temporary_password)
    target.must_change_password = True
    target.password_changed_at = datetime.now(timezone.utc)
    reset_lockout(target)
    revoke_all_sessions_for_user(db, target.id)

    # Two rows, neither containing the password. One on the admin's trail
    # (who did it, to whom); one on the account owner's, because a reset is
    # a security event on THEIR account and audit rows are what a person
    # sees in their own data export -- it names the role that did it, not
    # the individual.
    log_audit_event(
        db,
        "roster.person_password_reset",
        user_id=user.id,
        request=request,
        details={"targetUserId": target.id, "role": target.role},
    )
    log_audit_event(
        db,
        "auth.password_reset_by_admin",
        user_id=target.id,
        details={"byRole": user.role},
    )
    db.commit()

    # The identifier the person signs in with, so the admin can hand over
    # both halves together: a code for students and teachers (who may have
    # no email), the email for admins (who have no code).
    sign_in_with = target.email
    if target.role == "STUDENT" and profile is not None:
        sign_in_with = profile.student_code
    elif target.role == "TEACHER" and profile is not None:
        sign_in_with = profile.teacher_code

    # A response that carries a password must not be written to any cache.
    response.headers["Cache-Control"] = "no-store"
    return {
        "id": target.id,
        "fullName": target.full_name,
        "role": target.role,
        "signInWith": sign_in_with,
        "temporaryPassword": temporary_password,
        "mustChangePassword": True,
    }


# --- School setup in one workbook, and sign-in slips (#210, 29 Oct 2026) -----------------------
# PHASE8_SCHOOL_SETUP_DESIGN.md. The workbook (Teachers, Students) is checked
# whole and imported all or nothing; teachers get the sections they teach.
# First passwords are returned once, for printing as sign-in slips.

MAX_SETUP_FILE_BYTES = 5 * 1024 * 1024


def _read_setup_upload(file: UploadFile) -> bytes:
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        api_error(422, "VALIDATION_ERROR", "Upload the School Setup workbook (.xlsx).")
    raw = file.file.read(MAX_SETUP_FILE_BYTES + 1)
    if len(raw) > MAX_SETUP_FILE_BYTES:
        api_error(422, "VALIDATION_ERROR", "That file is over 5 MB. The setup workbook needs only names, sections and roll numbers.")
    return raw


def _setup_plan(db: Session, school: School, raw: bytes, *, final: bool = False):
    from app.services import school_setup_service as setup

    try:
        teachers, students = setup.read_workbook(raw)
    except setup.SetupFileError as exc:
        api_error(422, "VALIDATION_ERROR", str(exc))
    return setup.make_plan(db, school, teachers, students, final=final)


@router.get("/setup-template")
def setup_template(
    schoolId: str | None = None,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    from app.services import roster_templates

    school = _resolve_school(db, user, schoolId)
    return Response(
        content=roster_templates.setup_template_bytes(db, school),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="Krama_School_Setup.xlsx"'},
    )


@router.post("/setup/check")
@limiter.limit("20/minute")
def setup_check(
    request: Request,
    schoolId: str | None = Form(default=None),
    file: UploadFile = File(...),
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    """What importing the workbook would do, or every problem in it. Writes nothing."""
    school = _resolve_school(db, user, schoolId)
    plan = _setup_plan(db, school, _read_setup_upload(file))
    db.rollback()
    return plan.summary()


@router.post("/setup/import")
@limiter.limit("10/minute")
def setup_import(
    request: Request,
    response: Response,
    schoolId: str | None = Form(default=None),
    file: UploadFile = File(...),
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    """Checks the workbook again and, if every row is right, creates its new
    teachers, students and sections taught in one transaction. Returns the
    new accounts' first passwords, once."""
    from app.services import school_setup_service as setup

    school = _resolve_school(db, user, schoolId)
    raw = _read_setup_upload(file)
    # One import per school at a time: two at once (two tabs, two admins)
    # would both plan against the same roster and both create everyone.
    # A second import waits here, then plans against what the first made.
    db.query(School.id).filter(School.id == school.id).with_for_update().one()
    plan = _setup_plan(db, school, raw, final=True)
    if plan.problems:
        summary = plan.summary()
        db.rollback()
        # A refused import is recorded (counts only, never the rows), so
        # importing can't be used quietly to test who is on Krama (A14).
        log_audit_event(
            db,
            "roster.school_setup_import_refused",
            user_id=user.id,
            request=request,
            details={"schoolId": school.id, "problems": len(summary["problems"])},
        )
        db.commit()
        api_error(422, "SETUP_HAS_PROBLEMS", "The workbook has rows to fix, so nothing was imported.", details=summary)
    try:
        created = setup.apply_plan(db, plan, school=school, creator=user)
    except ValueError as exc:
        db.rollback()
        api_error(422, "VALIDATION_ERROR", str(exc))
    summary = plan.summary()
    log_audit_event(
        db,
        "roster.school_setup_import",
        user_id=user.id,
        request=request,
        details={
            "schoolId": school.id, "newTeachers": summary["newTeachers"], "newStudents": summary["newStudents"],
            "newSectionsTaught": summary["newSectionsTaught"],
        },
    )
    db.commit()
    response.headers["Cache-Control"] = "no-store"
    return {**summary, "schoolName": school.name, "created": created}


def _section_students(db: Session, school: School, class_name: str, section: str):
    return (
        db.query(Student, User)
        .join(User, User.id == Student.user_id)
        .filter(
            Student.school_id == school.id,
            func.trim(Student.class_name) == class_name,
            func.upper(func.trim(Student.section)) == section,
        )
        .all()
    )


@router.get("/sections")
def list_sections(
    schoolId: str | None = None,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    """Each section of the school: its students, how many have not chosen
    their own password yet, and who teaches it what."""
    from app.models.curriculum import BoardCourse, ClassLevel
    from app.models.teacher_assignment import TeacherSectionAssignment

    school = _resolve_school(db, user, schoolId)
    sections: dict[tuple[str, str], dict] = {}

    def entry(class_name: str, section: str) -> dict:
        return sections.setdefault((class_name, section), {
            "className": class_name, "section": section, "students": 0, "awaitingFirstSignIn": 0, "teachers": [],
        })

    for student, person in (
        db.query(Student, User).join(User, User.id == Student.user_id)
        .filter(Student.school_id == school.id, Student.is_active.is_(True), User.is_active.is_(True))
    ):
        if not (student.class_name or "").strip() or not (student.section or "").strip():
            continue
        e = entry(student.class_name.strip(), student.section.strip().upper())
        e["students"] += 1
        if person.must_change_password:
            e["awaitingFirstSignIn"] += 1
    for assignment, level, course, teacher_user in (
        db.query(TeacherSectionAssignment, ClassLevel, BoardCourse, User)
        .join(ClassLevel, ClassLevel.id == TeacherSectionAssignment.class_level_id)
        .join(BoardCourse, BoardCourse.id == TeacherSectionAssignment.board_course_id)
        .join(Teacher, Teacher.id == TeacherSectionAssignment.teacher_id)
        .join(User, User.id == Teacher.user_id)
        .filter(TeacherSectionAssignment.school_id == school.id, TeacherSectionAssignment.end_date.is_(None))
    ):
        entry(level.code, assignment.section.strip().upper())["teachers"].append(
            {"fullName": teacher_user.full_name, "subject": course.display_name}
        )

    def order(e):
        return (int(e["className"]) if e["className"].isdigit() else 99, e["className"], e["section"])

    return {"schoolName": school.name, "sections": sorted(sections.values(), key=order)}


class SectionSlipsRequest(BaseModel):
    className: str
    section: str
    schoolId: str | None = None


@router.post("/sections/slips")
@limiter.limit("10/minute")
def section_slips(
    payload: SectionSlipsRequest,
    request: Request,
    response: Response,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    """New first passwords and slips for a section's students who have not
    chosen their own password yet (a printed slip lost before the first
    day can't be shown again: passwords are kept only as hashes). Anyone
    who has chosen their own is left alone; reset them one by one on People."""
    from app.services import school_setup_service as setup

    school = _resolve_school(db, user, payload.schoolId)
    class_name, section = payload.className.strip(), payload.section.strip().upper()
    if not class_name or not section:
        api_error(422, "VALIDATION_ERROR", "Choose a section.")
    slips, skipped = [], 0
    now = datetime.now(timezone.utc)
    for student, person in _section_students(db, school, class_name, section):
        if not student.is_active or not person.is_active:
            continue
        if not person.must_change_password:
            skipped += 1
            continue
        password = _generate_initial_password(person.full_name)
        person.password_hash = hash_password(password)
        person.password_changed_at = now
        reset_lockout(person)
        revoke_all_sessions_for_user(db, person.id)
        # On the student's own trail too, as a one-by-one reset on People is.
        log_audit_event(db, "auth.password_reset_by_admin", user_id=person.id, details={"byRole": user.role})
        slips.append({
            "role": "STUDENT", "fullName": person.full_name, "code": student.student_code, "initialPassword": password,
            "className": class_name, "section": section, "rollNumber": student.roll_number, "teaches": [],
        })
    if not slips and not skipped:
        api_error(404, "NOT_FOUND", "That section has no students.")
    slips.sort(key=setup.slip_order)  # before the commit: nothing after it can fail
    log_audit_event(
        db,
        "roster.section_slips_reissued",
        user_id=user.id,
        request=request,
        details={"schoolId": school.id, "className": class_name, "section": section, "reissued": len(slips), "alreadySignedIn": skipped},
    )
    db.commit()
    response.headers["Cache-Control"] = "no-store"
    return {"schoolName": school.name, "slips": slips, "alreadySignedIn": skipped}
