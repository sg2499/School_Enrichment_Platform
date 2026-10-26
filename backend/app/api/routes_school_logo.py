"""A school's logo (#202, 26 Oct 2026): app/services/school_logo_service.py.

  * GET    /api/schools/{school_id}/logo   the image, for anyone signed in at
                                           that school (and the Super Admin)
  * GET    /api/school-settings            the school's admin: name and logo
  * PUT    /api/school-settings/logo       the school's admin uploads it
  * DELETE /api/school-settings/logo       the school's admin removes it

Another school's logo is a 404, as elsewhere.
"""
from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session, undefer

from app.api.routes_auth import _requester_school_id
from app.core.errors import api_error
from app.core.rate_limit import limiter
from app.database import get_db
from app.dependencies import get_current_user, require_roles
from app.models import School, SchoolAdmin, User
from app.services import school_logo_service as service
from app.services.audit_service import log_audit_event
from app.services.auth_service import user_payload

router = APIRouter(prefix="/api", tags=["school-logo"])


@router.get("/schools/{school_id}/logo")
def get_logo(
    school_id: str, v: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    if user.role != "SUPER_ADMIN" and _requester_school_id(db, user) != school_id:
        api_error(404, "NOT_FOUND", "We couldn't find that logo.")
    school = db.get(School, school_id)
    # An address from before the logo was replaced or removed is not served,
    # so nothing keeps showing an old logo (#202 review).
    if school is None or (v is not None and v != service.logo_stamp(school)):
        api_error(404, "NOT_FOUND", "This school hasn't added a logo yet.")
    png = service.logo_bytes(db, school_id)
    if png is None:
        api_error(404, "NOT_FOUND", "This school hasn't added a logo yet.")
    return Response(
        content=png,
        media_type="image/png",
        # The address changes whenever the logo does (?v=); an hour, so a removed one goes soon.
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


def _own_school(db: Session, user: User) -> School:
    link = db.query(SchoolAdmin).filter(SchoolAdmin.user_id == user.id).first()
    school = db.query(School).options(undefer(School.logo_data)).filter(School.id == link.school_id).first() if link else None
    if school is None:
        api_error(403, "FORBIDDEN", "Your admin account isn't linked to a school. Please contact your platform administrator.")
    return school


def _settings(db: Session, school: School, user: User) -> dict:
    return {
        "school": {"id": school.id, "name": school.name, "city": school.city, "logoUrl": service.logo_url(school)},
        "user": user_payload(db, user),
    }


@router.get("/school-settings")
def get_settings(db: Session = Depends(get_db), user: User = Depends(require_roles("ADMIN"))):
    return _settings(db, _own_school(db, user), user)


@router.put("/school-settings/logo")
@limiter.limit("20/hour")
def upload_logo(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("ADMIN")),
):
    school = _own_school(db, user)
    try:
        png = service.clean_logo(file.file.read(service.LOGO_MAX_BYTES + 1))
    except service.LogoError as error:
        api_error(422, "VALIDATION_ERROR", error.message)
    service.save_logo(db, school, png)
    log_audit_event(
        db, "school.logo.updated", user_id=user.id, request=request,
        details={"schoolId": school.id, "bytes": len(png)},
    )
    db.commit()
    db.refresh(school)
    return _settings(db, school, user)


@router.delete("/school-settings/logo")
@limiter.limit("20/hour")
def delete_logo(request: Request, db: Session = Depends(get_db), user: User = Depends(require_roles("ADMIN"))):
    school = _own_school(db, user)
    if school.logo_updated_at is not None:
        service.remove_logo(db, school)
        log_audit_event(db, "school.logo.removed", user_id=user.id, request=request, details={"schoolId": school.id})
        db.commit()
        db.refresh(school)
    return _settings(db, school, user)
