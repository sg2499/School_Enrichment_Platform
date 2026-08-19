"""Per-device session tracking (2026-08-19 security hardening, session
hygiene).

Companion to the sliding-renewal JWT mechanics in core/security.py and
dependencies.py's get_current_user -- this is the persistence layer behind
"where am I logged in" and "sign out this one device" on the Security
Settings page. See app/models/models.py's UserSession docstring for why a
session's id is stable across renewals (it's the JWT's "sid" claim) while
its underlying token keeps rotating.

Also owns the one new piece of policy this feature adds: an absolute
session lifetime per role, independent of the existing sliding-renewal
window. Before this, an actively-used token could renew forever -- exactly
the point for a student mid-exam, but a real gap for the highest-value
accounts, where an indefinitely-alive session on a shared or compromised
device is a standing risk. ADMIN/SUPER_ADMIN sessions now hard-expire and
require a fresh login (and, since 2FA is mandatory for those roles, a fresh
second factor) after MAX_SESSION_LIFETIME_MINUTES regardless of activity;
TEACHER/STUDENT keep the existing "stays alive while actively used" model,
matching MANDATORY_2FA_ROLES' own judgment that these are the accounts
worth a stricter ceiling.
"""
from datetime import datetime, timedelta, timezone

from fastapi import Request
from sqlalchemy.orm import Session

from slowapi.util import get_remote_address

from app.models import User, UserSession

# Absolute session lifetime, checked against UserSession.created_at
# regardless of how recently the token was last renewed. Unset roles (via
# .get() below) have no absolute cap -- only the existing sliding-renewal
# idle timeout applies, same behavior as before this feature existed.
MAX_SESSION_LIFETIME_MINUTES_BY_ROLE: dict[str, int] = {
    "SUPER_ADMIN": 12 * 60,   # 12 hours -- platform-wide access, highest value target
    "ADMIN": 12 * 60,         # 12 hours -- whole-school access
}


def _aware_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def start_session(db: Session, user: User, request: Request | None = None) -> str:
    """Create a new UserSession row for a fresh login and return its id,
    which the caller embeds as the JWT's "sid" claim."""
    ip_address = None
    user_agent = None
    if request is not None:
        try:
            ip_address = get_remote_address(request)
        except Exception:
            ip_address = None
        user_agent = request.headers.get("user-agent")
    session = UserSession(user_id=user.id, ip_address=ip_address, user_agent=user_agent)
    db.add(session)
    db.flush()  # populate session.id without committing yet -- caller commits
    return session.id


def touch_session(db: Session, session_id: str) -> None:
    """Bump last_seen_at for an active session. Caller is responsible for
    debouncing this (see dependencies.py's active_sessions_cache) -- calling
    it on every single request would mean a DB write per request for every
    logged-in user, the same reasoning that already applies to
    _update_user_activity()'s last_active_at."""
    session = db.get(UserSession, session_id)
    if session and not session.revoked_at:
        session.last_seen_at = datetime.now(timezone.utc)
        db.commit()


def is_session_valid(db: Session, session_id: str, role: str) -> bool:
    """False if the session was explicitly revoked, has no record at all
    (e.g. a pre-migration token that never had a UserSession row -- treated
    as invalid once this check is live, forcing a clean re-login rather than
    silently trusting an untracked session), or has outlived this role's
    absolute lifetime cap."""
    session = db.get(UserSession, session_id)
    if not session or session.revoked_at:
        return False
    lifetime_minutes = MAX_SESSION_LIFETIME_MINUTES_BY_ROLE.get(role)
    if lifetime_minutes is not None:
        age = datetime.now(timezone.utc) - _aware_utc(session.created_at)
        if age > timedelta(minutes=lifetime_minutes):
            return False
    return True


def revoke_session(db: Session, session_id: str) -> None:
    session = db.get(UserSession, session_id)
    if session and not session.revoked_at:
        session.revoked_at = datetime.now(timezone.utc)
        db.commit()


def revoke_all_sessions_for_user(db: Session, user_id: str) -> None:
    """Marks every one of this user's sessions revoked, for the sessions
    list to reflect reality. This is a bookkeeping companion to
    force_logout_user()'s session_invalidated_at timestamp in
    auth_service.py, which is what actually rejects every outstanding token
    immediately (iat-based, no per-row lookup needed) -- that mechanism is
    left as the primary enforcement path since it doesn't depend on every
    old token having carried a "sid" claim."""
    db.query(UserSession).filter(
        UserSession.user_id == user_id, UserSession.revoked_at.is_(None)
    ).update({"revoked_at": datetime.now(timezone.utc)})


def list_active_sessions(db: Session, user_id: str) -> list[UserSession]:
    return (
        db.query(UserSession)
        .filter(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
        .order_by(UserSession.last_seen_at.desc())
        .all()
    )
