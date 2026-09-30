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
must_change_password=True (enforced in dependencies.py's get_current_user(),
currently gated to ADMIN/SUPER_ADMIN only -- see that flag's own comment on
the User model for why TEACHER/STUDENT aren't gated yet). Still
deliberately NOT checked against strong_password_issue() -- that check is
about a *person* picking a memorable-but-weak password, which doesn't apply
to a random, never-reused, must-be-replaced-immediately value.
"""
import csv
import io
import re
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.core.rate_limit import limiter
from app.core.security import hash_password
from app.database import get_db
from app.dependencies import require_roles
from app.models import School, SchoolAdmin, Student, Teacher, User
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/api/roster", tags=["roster"])

CREATABLE_ROLES = {"ADMIN", "TEACHER", "STUDENT"}
BULK_ROLES = {"TEACHER", "STUDENT"}  # bulk ADMIN creation isn't a real onboarding pattern -- one at a time is fine

# A14 fix (30 Sep 2026 review): bulk import had no row cap at all -- an
# arbitrarily large file would hash a password (bcrypt, deliberately slow)
# per row on a single worker (render.yaml: -w 1), able to stall the whole
# service for every school, not just the one importing. 2000 rows is well
# above any real school's roster size in one file.
MAX_BULK_IMPORT_ROWS = 2000

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
    api_error(500, "CODE_GENERATION_FAILED", "Could not generate a unique account code. Try again.")


def _resolve_school(db: Session, user: User, requested_school_id: str | None) -> School:
    """Same rule as Curriculum Studio's _resolve_school_id (routes_curriculum_admin.py):
    ADMIN always acts on their own school, looked up server-side; SUPER_ADMIN
    must say which school they mean. Kept as a local copy rather than a
    cross-module import so this file stays self-contained."""
    if user.role == "SUPER_ADMIN":
        if not requested_school_id:
            api_error(422, "VALIDATION_ERROR", "schoolId is required for SUPER_ADMIN.")
        school = db.get(School, requested_school_id)
        if not school:
            api_error(404, "NOT_FOUND", "School not found.")
        return school

    school_admin = db.query(SchoolAdmin).filter(SchoolAdmin.user_id == user.id).first()
    if not school_admin:
        api_error(403, "FORBIDDEN", "No school is associated with this admin account.")
    if requested_school_id and requested_school_id != school_admin.school_id:
        api_error(403, "FORBIDDEN", "You can only manage your own school's roster.")
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
    full_name = (full_name or "").strip()
    if not full_name:
        raise ValueError("fullName is required.")
    cleaned_email = email.strip().lower() if email else None
    if cleaned_email and ("@" not in cleaned_email or cleaned_email.startswith("@") or cleaned_email.endswith("@")):
        raise ValueError("email must be a valid email address.")
    if role == "ADMIN" and not cleaned_email:
        raise ValueError("email is required for an ADMIN account (no fallback login code exists for admins).")
    if cleaned_email and db.query(User).filter(User.email == cleaned_email).first():
        raise ValueError(f"A user with email {cleaned_email} already exists.")

    initial_password = _generate_initial_password(full_name)
    new_user = User(
        full_name=full_name,
        email=cleaned_email,
        password_hash=hash_password(initial_password),
        role=role,
        is_active=True,
        # A1 fix: set for every new account regardless of role -- see the
        # User model's must_change_password comment for why enforcement is
        # currently scoped to ADMIN/SUPER_ADMIN only.
        must_change_password=True,
    )
    db.add(new_user)
    db.flush()  # populate new_user.id

    code = None
    if role == "ADMIN":
        db.add(SchoolAdmin(user_id=new_user.id, school_id=school.id))
    elif role == "TEACHER":
        code = _next_code(db, Teacher, Teacher.teacher_code, "TCH", school.name)
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
        code = _next_code(db, Student, Student.student_code, "STU", school.name)
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
        api_error(422, "VALIDATION_ERROR", "role must be one of ADMIN, TEACHER, STUDENT.")
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
        api_error(422, "VALIDATION_ERROR", "role must be one of ADMIN, TEACHER, STUDENT.")

    # ADMIN is always pinned to their own school. SUPER_ADMIN without a
    # schoolId sees only the platform-wide ADMIN roster (there's no single
    # "their own school" to default to); passing schoolId scopes further
    # into that school's Admin/Teacher/Student list, same as Curriculum Studio.
    school = None
    if user.role == "SUPER_ADMIN" and not schoolId and role_filter != "ADMIN" and role_filter is not None:
        api_error(422, "VALIDATION_ERROR", "schoolId is required to list Teacher or Student accounts.")
    if not (user.role == "SUPER_ADMIN" and not schoolId):
        school = _resolve_school(db, user, schoolId)

    search_term = f"%{search.strip().lower()}%" if search and search.strip() else None
    people: list[dict] = []

    def _matches(*values: str | None) -> bool:
        if not search_term:
            return True
        return any(v and search_term.strip("%") in v.lower() for v in values)

    if role_filter in (None, "ADMIN"):
        q = db.query(SchoolAdmin).join(User, SchoolAdmin.user_id == User.id)
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
        q = db.query(Teacher).join(User, Teacher.user_id == User.id).filter(Teacher.school_id == school.id)
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
        q = db.query(Student).join(User, Student.user_id == User.id).filter(Student.school_id == school.id)
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
    target = db.get(User, person_user_id)
    if not target:
        api_error(404, "NOT_FOUND", "Account not found.")
    if target.id == user.id:
        api_error(422, "VALIDATION_ERROR", "You cannot change your own account's status here.")

    if target.role == "SUPER_ADMIN":
        api_error(403, "FORBIDDEN", "Super Admin accounts cannot be managed here.")
    elif target.role == "ADMIN":
        if user.role != "SUPER_ADMIN":
            api_error(403, "FORBIDDEN", "Only a Super Admin can change an Admin account's status.")
        profile = db.query(SchoolAdmin).filter(SchoolAdmin.user_id == target.id).first()
    elif target.role == "TEACHER":
        profile = db.query(Teacher).filter(Teacher.user_id == target.id).first()
        if user.role == "ADMIN" and (not profile or profile.school_id != _resolve_school(db, user, None).id):
            api_error(403, "FORBIDDEN", "You can only manage your own school's roster.")
    elif target.role == "STUDENT":
        profile = db.query(Student).filter(Student.user_id == target.id).first()
        if user.role == "ADMIN" and (not profile or profile.school_id != _resolve_school(db, user, None).id):
            api_error(403, "FORBIDDEN", "You can only manage your own school's roster.")
    else:
        api_error(422, "VALIDATION_ERROR", "This account type cannot be managed here.")

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


_BULK_COLUMNS = ["fullName", "email", "className", "section", "designation", "subjectSpecialization", "qualification"]


def _parse_bulk_rows(filename: str, raw: bytes) -> list[dict]:
    lower = filename.lower()
    if lower.endswith(".xlsx"):
        from openpyxl import load_workbook

        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        ws = wb.active
        rows_iter = ws.iter_rows(values_only=True)
        header = [str(h).strip() if h else "" for h in next(rows_iter, [])]
        rows = []
        for raw_row in rows_iter:
            if raw_row is None or all(v is None for v in raw_row):
                continue
            rows.append({header[i]: raw_row[i] for i in range(min(len(header), len(raw_row)))})
        return rows

    text = raw.decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


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
    """CSV or .xlsx with a header row from _BULK_COLUMNS (fullName and
    email required by name; the rest are role-dependent and optional).
    One admin action, many accounts -- both this and the single-entry
    endpoint above exist from day one (Shailesh, 19 Aug 2026: "both options
    should be there, you never know which one would be required when")."""
    role = role.strip().upper()
    if role not in BULK_ROLES:
        api_error(422, "VALIDATION_ERROR", "role must be TEACHER or STUDENT for bulk import.")
    if not file.filename or not (file.filename.lower().endswith(".csv") or file.filename.lower().endswith(".xlsx")):
        api_error(422, "VALIDATION_ERROR", "Upload a .csv or .xlsx file.")

    school = _resolve_school(db, user, schoolId)
    raw = file.file.read()
    try:
        rows = _parse_bulk_rows(file.filename, raw)
    except Exception:
        api_error(422, "VALIDATION_ERROR", "Could not parse the uploaded file. Check it has a header row.")

    if not rows:
        api_error(422, "VALIDATION_ERROR", "The uploaded file has no data rows.")
    if len(rows) > MAX_BULK_IMPORT_ROWS:
        api_error(
            422,
            "VALIDATION_ERROR",
            f"This file has {len(rows)} rows, over the {MAX_BULK_IMPORT_ROWS}-row limit per import. "
            "Split it into smaller files.",
        )

    results = []
    created_count = 0
    for idx, row in enumerate(rows, start=2):  # row 1 is the header
        full_name = str(row.get("fullName") or "").strip()
        try:
            person = _create_person(
                db,
                creator=user,
                school=school,
                role=role,
                full_name=full_name,
                email=(str(row.get("email")).strip() if row.get("email") else None),
                class_name=(str(row.get("className")).strip() if row.get("className") else None),
                section=(str(row.get("section")).strip() if row.get("section") else None),
                designation=(str(row.get("designation")).strip() if row.get("designation") else None),
                subject_specialization=(
                    str(row.get("subjectSpecialization")).strip() if row.get("subjectSpecialization") else None
                ),
                qualification=(str(row.get("qualification")).strip() if row.get("qualification") else None),
            )
            db.flush()
            created_count += 1
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
                }
            )
        except ValueError as exc:
            results.append({"row": idx, "fullName": full_name, "status": "skipped", "error": str(exc)})

    log_audit_event(
        db,
        "roster.bulk_import",
        user_id=user.id,
        request=request,
        details={"role": role, "schoolId": school.id, "created": created_count, "attempted": len(rows)},
    )
    db.commit()
    return {"created": created_count, "attempted": len(rows), "results": results}
