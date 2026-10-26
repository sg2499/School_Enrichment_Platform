"""Class Analytics (#186, 26 Oct 2026): GET-only views for a section's
teacher and the school's admin. analytics_service has the rules."""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.rate_limit import limiter
from app.database import get_db
from app.dependencies import require_roles
from app.models import User
from app.services import analytics_service, practice_access_service
from app.services.practice_access_service import Viewer

router = APIRouter(prefix="/api/learning/analytics", tags=["analytics"])


def _viewer(
    user: User = Depends(require_roles("TEACHER", "ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
) -> Viewer:
    return practice_access_service.resolve_viewer(db, user)


@router.get("/sections")
def list_sections(viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    return {"sections": analytics_service.sections(db, viewer)}


@router.get("/sets")
@limiter.limit("60/minute")
def list_sets(request: Request, scope: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    return analytics_service.practice_sets(db, viewer, analytics_service.parse_scope(scope))


@router.get("/sets/{activity_id}")
@limiter.limit("60/minute")
def set_grid(
    request: Request,
    activity_id: str,
    scope: str,
    attempt: str | None = None,
    viewer: Viewer = Depends(_viewer),
    db: Session = Depends(get_db),
):
    return analytics_service.set_grid(
        db, viewer, analytics_service.parse_scope(scope), activity_id, analytics_service.parse_attempt(attempt)
    )


@router.get("/chapters/{chapter_id}/misconceptions")
@limiter.limit("60/minute")
def chapter_misconceptions(
    request: Request,
    chapter_id: str,
    scope: str,
    attempt: str | None = None,
    viewer: Viewer = Depends(_viewer),
    db: Session = Depends(get_db),
):
    return analytics_service.misconceptions(
        db, viewer, analytics_service.parse_scope(scope), chapter_id, analytics_service.parse_attempt(attempt)
    )
