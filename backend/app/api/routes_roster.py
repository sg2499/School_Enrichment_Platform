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

A password chosen by the school -- 3 Oct 2026 (Shailesh's decision: "admin
issues first password, optionally a default in the bulk-upload sheet"). A
bulk sheet may carry an optional `password` column. A row that fills it in
gets that password instead of a generated one; a row that leaves it blank
gets a generated one as before. Because a person DID choose it, it IS
checked against strong_password_issue(), and the account is flagged
must_change_password like any other, so it lasts only until first sign-in.
What that does not undo, and the upload screen says so: one password typed
down a whole column is known to everyone it was handed to, so until each
person signs in, anyone holding it and a classmate's code can get in first.
Leaving the column blank is the safer choice and stays the default.
"""
import csv
import io
import re
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session, contains_eager, joinedload

from app.core.errors import api_error
from app.core.rate_limit import limiter
from app.core.security import hash_password, strong_password_issue
from app.database import get_db
from app.dependencies import require_roles
from app.models import School, SchoolAdmin, Student, Teacher, User
from app.services.audit_service import log_audit_event
from app.services.auth_service import reset_lockout
from app.services.session_service import revoke_all_sessions_for_user

router = APIRouter(prefix="/api/roster", tags=["roster"])

CREATABLE_ROLES = {"ADMIN", "TEACHER", "STUDENT"}
BULK_ROLES = {"TEACHER", "STUDENT"}  # bulk ADMIN creation isn't a real onboarding pattern -- one at a time is fine

# A14 fix (30 Sep 2026 review): bulk import had no row cap at all -- an
# arbitrarily large file would hash a password (bcrypt, deliberately slow)
# per row on a single worker (render.yaml: -w 1), able to stall the whole
# service for every school, not just the one importing. 2000 rows is well
# above any real school's roster size in one file.
MAX_BULK_IMPORT_ROWS = 2000

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
    chosen_password: str | None = None,
) -> dict:
    """`chosen_password` is a first password the school picked itself (the
    bulk sheet's optional `password` column). None -- the single-entry form,
    and any sheet row that leaves the column blank -- means generate one."""
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

    if chosen_password is not None:
        # Somebody picked this one, so it is held to the same rules as a
        # password a person picks for themselves...
        password_issue = strong_password_issue(chosen_password)
        if password_issue:
            raise ValueError(f"The password in this row can't be used. {password_issue}")
        # ...and to one more that only applies when someone else picks it:
        # it must not be the thing printed next to it. A sheet that fills
        # the password column with each person's own code or name has given
        # every account a password anyone can read off the roster.
        guessable = {value.casefold() for value in (code, cleaned_email, full_name, full_name.replace(" ", "")) if value}
        if chosen_password.casefold() in guessable:
            raise ValueError(
                "The password in this row can't be used. It is the same as this person's code, name or email."
            )
        initial_password = chosen_password
    else:
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


_BULK_COLUMNS = [
    "fullName",
    "email",
    "className",
    "section",
    "designation",
    "subjectSpecialization",
    "qualification",
    # Optional. A first password the school has chosen for this person;
    # blank means "generate one". See the module docstring.
    "password",
]


def _cell_text(value) -> str | None:
    """A sheet cell as trimmed text, or None when it is empty. A spreadsheet
    hands back numbers for cells that look like numbers (a password of
    20261234 arrives as an int, and as 20261234.0 from some exports), so the
    value is put back the way it was typed rather than str()'d blindly."""
    if value is None:
        return None
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    text = str(value).strip()
    return text or None


def _header_key(header) -> str:
    """A column heading reduced to its letters and digits, lower-cased:
    "Full Name", "fullName", " FULLNAME " and "full_name" are all
    "fullname". Digits are kept, so "Email 2" is "email2" -- a different
    column, not a second spelling of "email"."""
    return re.sub(r"[^a-z0-9]", "", str(header or "").lower())


_BULK_COLUMN_FOR_HEADER = {_header_key(column): column for column in _BULK_COLUMNS}


def _parse_bulk_rows(filename: str, raw: bytes) -> tuple[list[dict], list[str], list[str]]:
    """The sheet's rows, keyed by the column names in _BULK_COLUMNS; the
    headings that were not used (in sheet order, as typed); and the columns
    that were found.

    Headings are matched by their letters alone (3 Oct 2026). They used to
    be matched exactly, so a heading typed "Password", or "password" after a
    comma and a space, was a column the import silently never read -- and
    with the password column that meant a school handing out the passwords
    in its sheet to a roster that had been given random ones instead. The
    headings that were not used are returned so the screen can say which,
    rather than leaving that to be discovered at first sign-in.
    """
    lower = filename.lower()
    if lower.endswith(".xlsx"):
        from openpyxl import load_workbook

        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        ws = wb.active
        rows_iter = ws.iter_rows(values_only=True)
        header = [str(h).strip() if h is not None else "" for h in next(rows_iter, [])]
        raw_rows = []
        for raw_row in rows_iter:
            if raw_row is None or all(v is None for v in raw_row):
                continue
            raw_rows.append({header[i]: raw_row[i] for i in range(min(len(header), len(raw_row)))})
    else:
        text = raw.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        header = [str(h).strip() if h is not None else "" for h in (reader.fieldnames or [])]
        raw_rows = [{str(key).strip(): value for key, value in row.items() if key is not None} for row in reader]

    # Each column this import reads is taken from the FIRST heading that
    # names it. A later heading that names the same column ("Password" and
    # then "Pass Word") is not used and is reported as such -- it must never
    # quietly replace the first, least of all with a blank.
    heading_for_column: dict[str, str] = {}
    unused: list[str] = []
    for heading in header:
        if not heading:
            continue
        column = _BULK_COLUMN_FOR_HEADER.get(_header_key(heading))
        if column is None or column in heading_for_column:
            unused.append(heading)
        else:
            heading_for_column[column] = heading
    rows = [
        {column: raw_row.get(heading) for column, heading in heading_for_column.items()}
        for raw_row in raw_rows
    ]
    return rows, unused, sorted(heading_for_column)


@router.post("/people/bulk")
@limiter.limit("10/minute")
def bulk_create_people(
    request: Request,
    role: str = Form(...),
    schoolId: str | None = Form(default=None),
    file: UploadFile = File(...),
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    """CSV or .xlsx with a header row from _BULK_COLUMNS (only fullName is
    required; the rest are role-dependent and optional, including a first
    `password` the school has chosen for that row).
    One admin action, many accounts -- both this and the single-entry
    endpoint above exist from day one (Shailesh, 19 Aug 2026: "both options
    should be there, you never know which one would be required when")."""
    role = role.strip().upper()
    if role not in BULK_ROLES:
        api_error(422, "VALIDATION_ERROR", "Bulk upload is for teachers or students. Please choose one.")
    if not file.filename or not (file.filename.lower().endswith(".csv") or file.filename.lower().endswith(".xlsx")):
        api_error(422, "VALIDATION_ERROR", "Upload a .csv or .xlsx file.")

    school = _resolve_school(db, user, schoolId)
    raw = file.file.read()
    try:
        rows, unrecognised_columns, columns_found = _parse_bulk_rows(file.filename, raw)
    except Exception:
        api_error(422, "VALIDATION_ERROR", "We couldn't read that file. Check that it's a .csv or .xlsx file with a header row.")

    if not rows:
        api_error(422, "VALIDATION_ERROR", "That file has no rows to import.")
    if "fullName" not in columns_found:
        # Said once, about the file, instead of "Full name is required" on
        # every one of its rows: the names are there, under a heading this
        # import does not read ("Name"), or the file is separated by
        # semicolons, or it has no heading row at all.
        api_error(
            422,
            "VALIDATION_ERROR",
            "We couldn't find a Full Name column in that file. Its first row must be the column headings, "
            "and one of them must be Full Name. Download the template to see them all.",
        )
    if len(rows) > MAX_BULK_IMPORT_ROWS:
        api_error(
            422,
            "VALIDATION_ERROR",
            f"This file has {len(rows)} rows, over the {MAX_BULK_IMPORT_ROWS}-row limit per import. "
            "Split it into smaller files.",
        )

    results = []
    created_count = 0
    email_rejected_count = 0
    chosen_password_count = 0
    # Email (normalised the way _create_person normalises it) -> the first
    # row of THIS file that used it. A repeat within the upload is reported
    # as exactly that: it tells the admin nothing about the rest of the
    # platform -- they typed both rows -- and is far more useful than the
    # generic message would be.
    first_row_for_email: dict[str, int] = {}
    for idx, row in enumerate(rows, start=2):  # row 1 is the header
        full_name = str(row.get("fullName") or "").strip()
        email = str(row.get("email")).strip() if row.get("email") else None
        email_key = email.lower() if email else None
        if email_key and email_key in first_row_for_email:
            results.append(
                {
                    "row": idx,
                    "fullName": full_name,
                    "status": "skipped",
                    "error": f"This email address is already used on row {first_row_for_email[email_key]} of this file.",
                }
            )
            continue
        chosen_password = _cell_text(row.get("password"))
        try:
            person = _create_person(
                db,
                creator=user,
                school=school,
                role=role,
                full_name=full_name,
                email=email,
                class_name=(str(row.get("className")).strip() if row.get("className") else None),
                section=(str(row.get("section")).strip() if row.get("section") else None),
                designation=(str(row.get("designation")).strip() if row.get("designation") else None),
                subject_specialization=(
                    str(row.get("subjectSpecialization")).strip() if row.get("subjectSpecialization") else None
                ),
                qualification=(str(row.get("qualification")).strip() if row.get("qualification") else None),
                chosen_password=chosen_password,
            )
            db.flush()
            created_count += 1
            # Only a row that made an account holds its email against the
            # rows after it. A row refused for another reason (its password,
            # say) used nothing, and the next row with that address is not a
            # duplicate of anything.
            if email_key:
                first_row_for_email[email_key] = idx
            if chosen_password is not None:
                chosen_password_count += 1
            # initialPassword/email are returned here the same way the
            # single-entry endpoint returns them -- without them a
            # bulk-created account has no deliverable password (the A1 fix
            # made passwords random, and nothing else can reveal or reset
            # one afterwards), so the student/teacher could never sign in.
            results.append(
                {
                    "row": idx,
                    "fullName": full_name,
                    "status": "created",
                    "code": person["code"],
                    "email": person["email"],
                    "initialPassword": person["initialPassword"],
                    # Where the password came from, so the screen can say
                    # "from your sheet" rather than present a password the
                    # admin typed as though the system had made it up.
                    "passwordSource": "sheet" if chosen_password is not None else "generated",
                }
            )
        except ValueError as exc:
            # _EmailNotAccepted's message is the fixed generic one -- the
            # address is never echoed back per row either.
            if isinstance(exc, _EmailNotAccepted):
                email_rejected_count += 1
            results.append({"row": idx, "fullName": full_name, "status": "skipped", "error": str(exc)})

    log_audit_event(
        db,
        "roster.bulk_import",
        user_id=user.id,
        request=request,
        details={
            "role": role,
            "schoolId": school.id,
            "created": created_count,
            "attempted": len(rows),
            # Count only, never the addresses -- see EMAIL_NOT_ACCEPTED_MESSAGE.
            "emailRejected": email_rejected_count,
            # How many accounts started on a password the school chose.
            # A count, never the passwords.
            "chosenPasswords": chosen_password_count,
        },
    )
    db.commit()
    return {
        "created": created_count,
        "attempted": len(rows),
        "results": results,
        # Headings in the file that are not one of the columns this import
        # reads, so the screen can say they were not used.
        "unrecognisedColumns": unrecognised_columns,
    }
