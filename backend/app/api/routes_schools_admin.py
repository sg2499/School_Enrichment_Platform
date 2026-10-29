"""Schools, for the Super Admin (#211, 29 Oct 2026; PHASE8_SCHOOLS_DESIGN.md).

Shailesh, 29 Oct 2026: "the super admin must have total control over all
the schools, which one to add, all the details and everything ... this way
we will never need separate scripts". Until now a school could only be made
through the operator endpoint (routes_platform.py, a shared secret in a
header) and never changed afterwards: the test school went live with no
board, and setting one took SQL.

  * GET   /api/schools-admin                    every school, with its counts
  * POST  /api/schools-admin                    a new school and its first admin
  * GET   /api/schools-admin/{id}               one school: details, counts, admins
  * PATCH /api/schools-admin/{id}               its name, board, city, state
  * POST  /api/schools-admin/{id}/status        suspend it, or restore it
  * PUT   /api/schools-admin/{id}/logo          its logo, as its admin would
  * DELETE /api/schools-admin/{id}/logo

SUPER_ADMIN only. A school's own admin never sees that other schools exist.
A school is never deleted here: it holds children's records, and erasing
them is a separate, deliberate step (DPDP). Suspending stops everyone at it
signing in (services/school_status.py) and is undone by restoring.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, undefer

from app.core.errors import api_error
from app.core.rate_limit import limiter
from app.database import get_db
from app.dependencies import require_roles
from app.models import School, SchoolAdmin, Student, Teacher, User
from app.models.curriculum import Board, BoardCourse
from app.models.teacher_assignment import TeacherSectionAssignment
from app.services import school_logo_service as logo_service
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/api/schools-admin", tags=["schools-admin"])
SUPER = Depends(require_roles("SUPER_ADMIN"))

NAME_MAX, PLACE_MAX = 255, 150


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.isoformat()


def _boards(db: Session) -> list[dict]:
    return [
        {"code": b.code, "name": b.display_name}
        for b in db.query(Board).filter(Board.is_active.is_(True)).order_by(Board.code)
    ]


def _counts(db: Session, school_ids: list[str] | None = None) -> dict[str, dict]:
    """school id -> its people, in a handful of grouped queries (not one per school)."""
    out: dict[str, dict] = {}

    def bucket(sid: str) -> dict:
        return out.setdefault(
            sid,
            {
                "admins": 0,
                "teachers": 0,
                "students": 0,
                "sections": 0,
                "notSignedIn": 0,
                "inactivePeople": 0,
                "lastActiveAt": None,
            },
        )

    def scoped(q, column):
        return q.filter(column.in_(school_ids)) if school_ids is not None else q

    # "Not signed in": still on a first password and never seen. A password
    # reset sets must_change_password again, and someone who has used Krama
    # for months is not "not signed in" (review, 29 Oct).
    never = (User.must_change_password.is_(True) & User.last_active_at.is_(None)).label("never")
    for profile, key in ((SchoolAdmin, "admins"), (Teacher, "teachers"), (Student, "students")):
        rows = scoped(
            db.query(
                profile.school_id,
                User.is_active,
                never,
                func.count(User.id),
                func.max(User.last_active_at),
            )
            .join(User, User.id == profile.user_id)
            .group_by(profile.school_id, User.is_active, never),
            profile.school_id,
        )
        for sid, active, waiting, n, last in rows:
            b = bucket(sid)
            if active:
                b[key] += n
                if waiting:
                    b["notSignedIn"] += n
            else:
                b["inactivePeople"] += n
            if last is not None and (b["lastActiveAt"] is None or _iso(last) > b["lastActiveAt"]):
                b["lastActiveAt"] = _iso(last)
    sections = scoped(
        db.query(Student.school_id, func.trim(Student.class_name), func.upper(func.trim(Student.section)))
        .join(User, User.id == Student.user_id)
        .filter(User.is_active.is_(True), Student.section.isnot(None), Student.class_name.isnot(None))
        .distinct(),
        Student.school_id,
    )
    for sid, class_name, section in sections:
        if class_name and section:
            bucket(sid)["sections"] += 1
    return out


EMPTY_COUNTS = {
    "admins": 0,
    "teachers": 0,
    "students": 0,
    "sections": 0,
    "notSignedIn": 0,
    "inactivePeople": 0,
    "lastActiveAt": None,
}


def _school(school: School, counts: dict | None) -> dict:
    return {
        "id": school.id,
        "name": school.name,
        "board": school.board,
        "city": school.city,
        "state": school.state,
        "isActive": school.is_active,
        "createdAt": _iso(school.created_at),
        "logoUrl": logo_service.logo_url(school),
        "counts": counts or dict(EMPTY_COUNTS),
    }


def _get(db: Session, school_id: str) -> School:
    school = db.get(School, school_id)
    if school is None:
        api_error(404, "NOT_FOUND", "That school couldn't be found.")
    return school


def _clean(text: str | None, label: str, limit: int, *, required: bool = False) -> str | None:
    value = " ".join((text or "").split())
    if required and not value:
        api_error(422, "VALIDATION_ERROR", f"{label} is required.")
    if len(value) > limit:
        api_error(422, "VALIDATION_ERROR", f"{label} can be at most {limit} characters.")
    return value or None


def _board(db: Session, text: str | None) -> str:
    code = (text or "").strip().upper()
    allowed = [b["code"] for b in _boards(db)]
    if code not in allowed:
        api_error(
            422, "VALIDATION_ERROR", f"Choose the school's board: {' or '.join(allowed) or 'none are set up yet'}."
        )
    return code


def same_name(a: str | None, b: str | None) -> bool:
    """Names compared as people read them: case and spacing aside. Schools
    made through the old operator endpoint can have doubled spaces."""
    return " ".join((a or "").split()).casefold() == " ".join((b or "").split()).casefold()


def _same_school(db: Session, name: str, city: str | None, school_id: str | None = None) -> School | None:
    """Another school of this name in this city (case and spacing aside)."""
    for other in db.query(School).filter(School.id != (school_id or "")):
        if same_name(other.name, name) and same_name(other.city, city):
            return other
    return None


def _refuse_same_school(db: Session, name: str, city: str | None, school_id: str | None = None) -> None:
    same = _same_school(db, name, city, school_id)
    if same is not None:
        where = f" in {same.city}" if same.city else ""
        api_error(422, "VALIDATION_ERROR", f"There is already a school called {same.name}{where}.")


def _school_people(db: Session, school_id: str) -> list[User]:
    ids = [
        uid
        for profile in (SchoolAdmin, Teacher, Student)
        for (uid,) in db.query(profile.user_id).filter(profile.school_id == school_id)
    ]
    return db.query(User).filter(User.id.in_(ids)).all() if ids else []


@router.get("", dependencies=[SUPER])
def list_schools(db: Session = Depends(get_db)):
    schools = db.query(School).order_by(School.is_active.desc(), func.lower(School.name)).all()
    counts = _counts(db)
    return {"schools": [_school(s, counts.get(s.id)) for s in schools], "boards": _boards(db)}


class SchoolCreateRequest(BaseModel):
    name: str
    board: str
    city: str | None = None
    state: str | None = None
    adminFullName: str
    adminEmail: str


@router.post("")
@limiter.limit("20/hour")
def create_school(
    request: Request,
    payload: SchoolCreateRequest,
    user: User = SUPER,
    db: Session = Depends(get_db),
):
    """The school and its first admin together: a school nobody can sign in
    to run is no use. The admin's first password is generated and shown
    once; they choose their own at first sign-in."""
    from app.api.routes_roster import EMAIL_NOT_ACCEPTED_MESSAGE, _create_person, _EmailNotAccepted

    _clean(payload.adminFullName, "The admin's full name", 150, required=True)
    _clean(payload.adminEmail, "The admin's email", 150, required=True)
    name = _clean(payload.name, "School name", NAME_MAX, required=True)
    city = _clean(payload.city, "City", PLACE_MAX)
    state = _clean(payload.state, "State", PLACE_MAX)
    board = _board(db, payload.board)
    _refuse_same_school(db, name, city)
    school = School(name=name, board=board, city=city, state=state, is_active=True)
    db.add(school)
    db.flush()
    try:
        admin = _create_person(
            db, creator=user, school=school, role="ADMIN", full_name=payload.adminFullName, email=payload.adminEmail
        )
    except _EmailNotAccepted:
        db.rollback()
        log_audit_event(
            db,
            "roster.person_create_email_rejected",
            user_id=user.id,
            request=request,
            details={"role": "ADMIN", "schoolId": None, "count": 1},
        )
        db.commit()
        api_error(422, "VALIDATION_ERROR", EMAIL_NOT_ACCEPTED_MESSAGE)
    except ValueError as exc:
        db.rollback()
        api_error(422, "VALIDATION_ERROR", str(exc))
    log_audit_event(
        db,
        "platform.school_created",
        user_id=user.id,
        request=request,
        details={"schoolId": school.id, "board": board, "adminUserId": admin["id"]},
    )
    db.commit()
    db.refresh(school)
    return {
        "school": _school(school, {**EMPTY_COUNTS, "admins": 1, "notSignedIn": 1}),
        "admin": {"fullName": admin["fullName"], "email": admin["email"], "initialPassword": admin["initialPassword"]},
    }


@router.get("/{school_id}", dependencies=[SUPER])
def school_detail(school_id: str, db: Session = Depends(get_db)):
    school = _get(db, school_id)
    admins = (
        db.query(User, SchoolAdmin)
        .join(SchoolAdmin, SchoolAdmin.user_id == User.id)
        .filter(SchoolAdmin.school_id == school.id)
        .order_by(User.is_active.desc(), func.lower(User.full_name))
        .all()
    )
    return {
        "school": _school(school, _counts(db, [school.id]).get(school.id)),
        "admins": [
            {
                "id": u.id,
                "fullName": u.full_name,
                "email": u.email,
                "isActive": u.is_active,
                "signedIn": not (u.must_change_password and u.last_active_at is None),
                "twoFactor": bool(u.totp_enabled),
                "lastActiveAt": _iso(u.last_active_at),
            }
            for u, _link in admins
        ],
        "boards": _boards(db),
    }


def _other_board_use(db: Session, school_id: str, board: str) -> list[str]:
    """What at this school is on another board's courses, in words ("2 sections taught")."""
    from app.models.assessment import AssessmentScheme
    from app.models.curriculum import SchoolCurriculumMap
    from app.models.papers import MockPaper

    def other(model, *extra):
        return (
            db.query(model)
            .join(BoardCourse, BoardCourse.id == model.board_course_id)
            .join(Board, Board.id == BoardCourse.board_id)
            .filter(model.school_id == school_id, func.upper(Board.code) != board, *extra)
        )

    taught = {
        (a.class_level_id, (a.section or "").upper())
        for a in other(TeacherSectionAssignment, TeacherSectionAssignment.end_date.is_(None))
    }
    found = [
        (len(taught), "section taught", "sections taught"),
        (other(SchoolCurriculumMap).count(), "curriculum map entry", "curriculum map entries"),
        (other(MockPaper).count(), "mock paper", "mock papers"),
        (other(AssessmentScheme).count(), "assessment scheme", "assessment schemes"),
    ]
    return [f"{n} {one if n == 1 else many}" for n, one, many in found if n]


class SchoolUpdateRequest(BaseModel):
    name: str | None = None
    board: str | None = None
    city: str | None = None
    state: str | None = None


@router.patch("/{school_id}")
@limiter.limit("60/hour")
def update_school(
    request: Request,
    school_id: str,
    payload: SchoolUpdateRequest,
    user: User = SUPER,
    db: Session = Depends(get_db),
):
    school = _get(db, school_id)
    fields = payload.model_fields_set
    changes: dict[str, tuple] = {}
    if "name" in fields:
        changes["name"] = (school.name, _clean(payload.name, "School name", NAME_MAX, required=True))
    if "city" in fields:
        changes["city"] = (school.city, _clean(payload.city, "City", PLACE_MAX))
    if "state" in fields:
        changes["state"] = (school.state, _clean(payload.state, "State", PLACE_MAX))
    if "board" in fields:
        board = _board(db, payload.board)
        if board != (school.board or "").upper():
            # Everything at the school that points at a board's courses:
            # the board can't be changed out from under it (setup, analytics
            # and papers look courses up by the school's board).
            in_use = _other_board_use(db, school.id, board)
            if in_use:
                api_error(
                    422,
                    "VALIDATION_ERROR",
                    f"This school has {', '.join(in_use)} on another board's courses, "
                    f"so its board can't be changed to {board} until those are moved.",
                )
        changes["board"] = (school.board, board)
    name = changes.get("name", (None, school.name))[1]
    city = changes.get("city", (None, school.city))[1]
    if "name" in changes or "city" in changes:
        _refuse_same_school(db, name, city, school.id)
    changed = {k: v for k, (old, v) in changes.items() if old != v}
    for key, value in changed.items():
        setattr(school, key, value)
    if changed:
        log_audit_event(
            db,
            "platform.school_updated",
            user_id=user.id,
            request=request,
            details={"schoolId": school.id, "fields": sorted(changed)},
        )
        db.commit()
        db.refresh(school)
    return school_detail(school.id, db)


class SchoolStatusRequest(BaseModel):
    active: bool
    confirmName: str | None = None


@router.post("/{school_id}/status")
@limiter.limit("30/hour")
def set_status(
    request: Request,
    school_id: str,
    payload: SchoolStatusRequest,
    user: User = SUPER,
    db: Session = Depends(get_db),
):
    """Suspend (nobody at the school can sign in; sessions end at once) or
    restore. Suspending asks for the school's name typed out, as the screen
    does, so it can't happen by a stray click."""
    school = _get(db, school_id)
    if not payload.active and not same_name(payload.confirmName, school.name):
        api_error(422, "VALIDATION_ERROR", "Type the school's name exactly to suspend it.")
    if school.is_active != payload.active:
        school.is_active = payload.active
        if not payload.active:
            # Ended, not paused: restoring the school must not bring back a
            # session left open on a shared computer (review, 29 Oct).
            from app.services.session_service import revoke_all_sessions_for_user

            now = datetime.now(UTC)
            for person in _school_people(db, school.id):
                person.session_invalidated_at = now
                revoke_all_sessions_for_user(db, person.id)
        log_audit_event(
            db,
            "platform.school_restored" if payload.active else "platform.school_suspended",
            user_id=user.id,
            request=request,
            details={"schoolId": school.id},
        )
        db.commit()
        db.refresh(school)
    return school_detail(school.id, db)


@router.put("/{school_id}/logo")
@limiter.limit("20/hour")
def upload_logo(
    request: Request, school_id: str, file: UploadFile = File(...), user: User = SUPER, db: Session = Depends(get_db)
):
    school = db.query(School).options(undefer(School.logo_data)).filter(School.id == school_id).first()
    if school is None:
        api_error(404, "NOT_FOUND", "That school couldn't be found.")
    try:
        png = logo_service.clean_logo(file.file.read(logo_service.LOGO_MAX_BYTES + 1))
    except logo_service.LogoError as error:
        api_error(422, "VALIDATION_ERROR", error.message)
    logo_service.save_logo(db, school, png)
    log_audit_event(
        db, "school.logo.updated", user_id=user.id, request=request, details={"schoolId": school.id, "bytes": len(png)}
    )
    db.commit()
    return school_detail(school.id, db)


@router.delete("/{school_id}/logo")
@limiter.limit("20/hour")
def delete_logo(request: Request, school_id: str, user: User = SUPER, db: Session = Depends(get_db)):
    school = _get(db, school_id)
    if school.logo_updated_at is not None:
        logo_service.remove_logo(db, school)
        log_audit_event(db, "school.logo.removed", user_id=user.id, request=request, details={"schoolId": school.id})
        db.commit()
    return school_detail(school.id, db)
