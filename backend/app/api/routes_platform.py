"""Platform-operator endpoints -- onboarding new schools.

New for Phase 1 exit-gate work (17 Aug 2026). Not part of MathPath at all;
MathPath is single-tenant and never had a "create a new school" concept.

Why this exists: ADMIN accounts are the only way to create TEACHER/STUDENT
accounts (see the Phase 2+ admin roster endpoints, not built yet), which
means the very first ADMIN for a school can't be created through the normal
in-product flow -- there's nobody logged in yet to do it. Rather than a
throwaway one-time seed script, this is permanent operator tooling: every
time School Enrichment onboards a new school, this is the endpoint that
creates it and its founding admin. Deliberately NOT self-disabling and
deliberately NOT gated on "only if the database is empty" -- a real
multi-school platform needs to keep doing this indefinitely.

Auth model: a single shared operator secret (PLATFORM_OPERATOR_KEY),
compared with secrets.compare_digest to avoid timing side-channels, checked
before anything else runs. This is intentionally not a normal user
account/role -- it represents "whoever operates the platform," which today
is Shailesh and will eventually be a small hosting/ops team, not school
staff. If PLATFORM_OPERATOR_KEY is unset, the endpoint fails closed (503)
rather than silently accepting requests with no real key to check against.
"""
import secrets

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import PLATFORM_OPERATOR_KEY
from app.core.errors import api_error
from app.core.rate_limit import limiter
from app.core.security import hash_password, strong_password_issue
from app.database import get_db
from app.models import School, SchoolAdmin, User
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/api/platform", tags=["platform"])


class SchoolProvisionRequest(BaseModel):
    schoolName: str
    board: str | None = None
    city: str | None = None
    state: str | None = None
    adminFullName: str
    adminEmail: str
    adminPassword: str


def _require_operator_key(x_platform_key: str | None = Header(default=None)) -> None:
    if not PLATFORM_OPERATOR_KEY:
        api_error(503, "PLATFORM_ONBOARDING_DISABLED", "Platform onboarding is not configured on this deployment.")
    if not x_platform_key or not secrets.compare_digest(x_platform_key, PLATFORM_OPERATOR_KEY):
        api_error(401, "UNAUTHORIZED", "Invalid or missing operator key.")


@router.post("/schools", dependencies=[Depends(_require_operator_key)])
@limiter.limit("10/hour")
def provision_school(request: Request, payload: SchoolProvisionRequest, db: Session = Depends(get_db)):
    school_name = payload.schoolName.strip()
    admin_full_name = payload.adminFullName.strip()
    admin_email = payload.adminEmail.strip().lower()

    if not school_name:
        api_error(422, "VALIDATION_ERROR", "schoolName is required.")
    if not admin_full_name:
        api_error(422, "VALIDATION_ERROR", "adminFullName is required.")
    if "@" not in admin_email or admin_email.startswith("@") or admin_email.endswith("@"):
        api_error(422, "VALIDATION_ERROR", "adminEmail must be a valid email address.")

    password_issue = strong_password_issue(payload.adminPassword)
    if password_issue:
        api_error(422, "WEAK_PASSWORD", password_issue)

    existing = db.query(User).filter(User.email == admin_email).first()
    if existing:
        api_error(409, "EMAIL_IN_USE", "A user with this email already exists.")

    school = School(name=school_name, board=payload.board, city=payload.city, state=payload.state)
    db.add(school)
    db.flush()  # populate school.id without committing yet

    admin_user = User(
        full_name=admin_full_name,
        email=admin_email,
        password_hash=hash_password(payload.adminPassword),
        role="ADMIN",
        is_active=True,
    )
    db.add(admin_user)
    db.flush()  # populate admin_user.id

    db.add(SchoolAdmin(user_id=admin_user.id, school_id=school.id))
    log_audit_event(
        db,
        "platform.school_provisioned",
        user_id=admin_user.id,
        request=request,
        details={"schoolId": school.id, "schoolName": school.name, "adminEmail": admin_user.email},
    )
    db.commit()

    return {
        "school": {"id": school.id, "name": school.name},
        "admin": {"id": admin_user.id, "fullName": admin_user.full_name, "email": admin_user.email},
    }
