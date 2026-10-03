import logging
import secrets
from datetime import datetime, timezone

from cachetools import TTLCache
from fastapi import BackgroundTasks, Depends, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.config import ACCESS_TOKEN_EXPIRE_MINUTES
from app.core.cookies import (
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME,
    read_session_token,
    set_session_cookie,
    touch_csrf_cookie,
)
from app.core.errors import api_error, who_can_help
from app.core.security import create_access_token, decode_token, expire_minutes_for_role
from app.database import SessionLocal, get_db
from app.models import Student, Teacher, User
from app.services.session_service import is_session_valid, touch_session

logger = logging.getLogger("school_enrichment")

bearer_scheme = HTTPBearer(auto_error=False)

active_users_cache = TTLCache(maxsize=10000, ttl=120)

# Debounces UserSession.last_seen_at writes the same way active_users_cache
# debounces last_active_at above -- one DB write per session per TTL window,
# not one per request.
active_sessions_cache = TTLCache(maxsize=10000, ttl=120)

# Mandatory 2FA (2026-08-19 security hardening, Shailesh: "Yes, mandatory for
# both" for SUPER_ADMIN and ADMIN) -- these are the highest-value accounts
# (platform-wide or whole-school data access), so unlike TEACHER/STUDENT,
# they may not use the product at all until a second factor is enrolled.
MANDATORY_2FA_ROLES = {"ADMIN", "SUPER_ADMIN"}

# Paths a MANDATORY_2FA_ROLES user must still be able to reach even before
# they've enrolled -- otherwise there is no way for them (or the frontend) to
# ever get them into 2FA setup in the first place. Every other endpoint stays
# blocked for them until totp_enabled is true. Kept as an explicit allowlist
# (not a prefix check) so a new admin-only endpoint added later is blocked by
# default and has to be deliberately exempted, rather than accidentally
# reachable pre-setup.
TWO_FACTOR_SETUP_EXEMPT_PATHS = {
    "/api/auth/me",
    "/api/auth/logout",
    "/api/auth/logout-all-sessions",
    "/api/auth/2fa/setup",
    "/api/auth/2fa/enable",
    "/api/auth/change-password",
    "/api/auth/ping",
}

# A1 fix (30 Sep 2026 security/DPDP review): an admin-issued initial
# password is guessable-by-design no longer (see routes_roster.py), but that
# only matters if the recipient is actually forced to replace it before
# doing anything else -- otherwise a first-to-log-in race (including against
# a freshly created ADMIN) can still permanently take the account over.
# Scoped to ADMIN/SUPER_ADMIN only for now: TEACHER/STUDENT have no
# change-password UI anywhere in the frontend yet (grepped -- only
# frontend/app/admin/security/page.tsx has one), so gating them here today
# would lock every one of them out with no way to comply. Every new account
# still gets a random initial password and must_change_password=True
# regardless of role -- this is a UI gap, not a data-model gap, and the
# remaining rollout to TEACHER/STUDENT is flagged as a follow-up.
MUST_CHANGE_PASSWORD_ROLES = {"ADMIN", "SUPER_ADMIN"}

# Same allowlist shape as TWO_FACTOR_SETUP_EXEMPT_PATHS, checked first (see
# below): a user who must change their password still needs to reach the
# endpoint that lets them do it, plus the same baseline set (me/logout/
# ping) the 2FA gate already exempts.
MUST_CHANGE_PASSWORD_EXEMPT_PATHS = {
    "/api/auth/me",
    "/api/auth/logout",
    "/api/auth/logout-all-sessions",
    "/api/auth/change-password",
    "/api/auth/ping",
}


def _as_aware_utc(value: datetime) -> datetime:
    """Normalize a DB-read timestamp to timezone-aware UTC, floored to whole
    seconds, before comparing it against a JWT's `iat`.

    Two independent precision mismatches were found and fixed here while
    testing the 2026-07-21 security audit Phase 2 force-logout feature:

    1. SQLite (used locally/in CI) silently drops tzinfo on read-back even
       for a DateTime(timezone=True) column populated with an aware UTC
       value -- every value this app ever writes to password_changed_at/
       session_invalidated_at is UTC, so a naive value read back is always
       implicitly UTC too. Comparing it against the always-aware
       `iat`-derived datetime without this normalization raises
       "can't compare offset-naive and offset-aware datetimes". Postgres
       (production) preserves tzinfo correctly, so this half of the fix is a
       no-op there, but it's applied unconditionally so correctness never
       depends on which database is running underneath it.
    2. A JWT's `iat` claim is a whole-number Unix timestamp (sub-second
       precision is truncated at encode time), but session_invalidated_at/
       password_changed_at are stored with microsecond precision. A user who
       force-logs-out and immediately re-authenticates in the same wall-clock
       second could get a brand new token whose truncated `iat` still
       compares as "before" the microsecond-precise revocation timestamp,
       incorrectly rejecting a token that was issued after the revocation in
       real time. Flooring to whole seconds here matches the JWT's own
       precision and removes the race entirely.
    """
    Aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return Aware.replace(microsecond=0)

def _update_user_activity(user_id: str):
    db = SessionLocal()
    try:
        db.execute(
            update(User).where(User.id == user_id).values(last_active_at=datetime.now(timezone.utc))
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("Failed to update last_active_at for user %s", user_id, exc_info=True)
    finally:
        db.close()


def _touch_session_activity(session_id: str):
    db = SessionLocal()
    try:
        touch_session(db, session_id)
    except Exception:
        db.rollback()
        logger.warning("Failed to touch session %s", session_id, exc_info=True)
    finally:
        db.close()

def get_current_user(
    background_tasks: BackgroundTasks,
    request: Request,
    response: Response,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    # Two supported credential sources, checked in this order:
    #  1. Authorization: Bearer <token> -- unchanged from before. Kept alive
    #     deliberately for scripts/admin tooling/potential future non-browser
    #     clients that explicitly obtain and hold a token; it is not exposed
    #     to any web page's JS execution context, so it isn't the thing the
    #     2026-07-22 cookie migration is defending against.
    #  2. The httpOnly session cookie (see app/core/cookies.py) -- what the
    #     browser frontend uses as of this round. A request authenticated
    #     this way is subject to the CSRF check below, since the cookie is
    #     sent automatically by the browser and a bearer header is not.
    token = None
    used_cookie_auth = False
    if credentials is not None and credentials.scheme.lower() == "bearer":
        token = credentials.credentials
    if not token:
        token = read_session_token(request)
        used_cookie_auth = token is not None

    if not token:
        api_error(401, "UNAUTHORIZED", "Please sign in to continue.")

    payload = decode_token(token)
    if not payload:
        api_error(401, "UNAUTHORIZED", "Your session has expired. Please sign in again.")

    # Special-purpose tokens (e.g. the short-lived 2FA login-challenge token
    # issued mid-login, before the second factor is verified) carry a
    # "purpose" claim and must never be usable as a normal bearer token --
    # otherwise a leaked challenge token would grant full account access
    # without ever passing the second factor, defeating the point of 2FA.
    if payload.get("purpose"):
        api_error(401, "UNAUTHORIZED", "Your session has expired. Please sign in again.")

    # Slide the CSRF cookie's Max-Age forward on every cookie-authenticated
    # request (GET included), not just mutating ones -- otherwise it dies on
    # its own fixed schedule even while the session cookie below keeps
    # renewing indefinitely for an active user. See touch_csrf_cookie()'s
    # docstring for the full incident writeup.
    if used_cookie_auth:
        touch_csrf_cookie(request, response)

    # CSRF check (double-submit cookie pattern): only applies when the
    # cookie is doing the authenticating, and only for methods that change
    # state. A forged cross-site request can make the browser attach the
    # session cookie automatically, but the attacker's page cannot read
    # the separate, non-httpOnly CSRF cookie (blocked by same-origin
    # policy) to also produce a matching header -- so the two won't match.
    if used_cookie_auth and request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME)
        csrf_header = request.headers.get(CSRF_HEADER_NAME)
        if not csrf_cookie or not csrf_header or not secrets.compare_digest(csrf_cookie, csrf_header):
            api_error(403, "CSRF_VALIDATION_FAILED", "We couldn't verify that request. Please refresh the page and try again.")

    user = db.get(User, payload.get("sub"))
    if not user:
        api_error(401, "UNAUTHORIZED", "Your session is no longer valid. Please sign in again.")
    if not user.is_active:
        # The caller holds a validly signed session for this exact account,
        # so saying it was deactivated tells them nothing they could not
        # already see by being signed out -- and tells the real owner who
        # can put it right.
        api_error(
            401,
            "UNAUTHORIZED",
            f"Your account has been deactivated. Please ask {who_can_help(user.role)} if you need it back.",
        )

    # NOTE: api_error() raises HTTPException, which is itself an Exception --
    # it must never be called from inside a `try/except Exception` block that
    # is meant to guard against malformed timestamp data, or the raised 401
    # gets silently swallowed and the check becomes dead code. This bit both
    # checks below during this Phase 2 round: the comparison is computed
    # inside try/except (protecting against bad data), but api_error() is
    # only ever called after the try block has already completed.
    iat = payload.get("iat")
    if iat and user.password_changed_at:
        IsStaleAfterPasswordChange = False
        try:
            IsStaleAfterPasswordChange = datetime.fromtimestamp(iat, tz=timezone.utc) < _as_aware_utc(user.password_changed_at)
        except Exception:
            IsStaleAfterPasswordChange = False
        if IsStaleAfterPasswordChange:
            api_error(401, "UNAUTHORIZED", "Your password was changed, so this session has ended. Please sign in with your new password.")

    # Lightweight session-revocation check (2026-07-21 security audit, Phase
    # 2): any token issued before a force-logout timestamp is rejected, the
    # same mechanism as the password-change check above. Lets an admin (or
    # the user themselves, via /api/auth/logout-all-sessions) kill every
    # active session on demand without requiring a password reset.
    if iat and user.session_invalidated_at:
        IsRevoked = False
        try:
            IsRevoked = datetime.fromtimestamp(iat, tz=timezone.utc) < _as_aware_utc(user.session_invalidated_at)
        except Exception:
            IsRevoked = False
        if IsRevoked:
            api_error(401, "UNAUTHORIZED", "You've been signed out of all devices. Please sign in again.")

    # Per-device session tracking (2026-08-19 security hardening, session
    # hygiene). "sid" is only present on tokens issued after this feature
    # shipped -- an older token with no sid simply skips this check and
    # falls back on the coarser session_invalidated_at mechanism above,
    # rather than being rejected outright. See session_service.py's module
    # docstring for the full rationale, including the per-role absolute
    # lifetime cap this also enforces.
    session_id = payload.get("sid")
    if session_id:
        if not is_session_valid(db, session_id, user.role):
            api_error(401, "UNAUTHORIZED", "This session has ended. Please sign in again.")
        request.state.session_id = session_id
        if session_id not in active_sessions_cache:
            active_sessions_cache[session_id] = True
            background_tasks.add_task(_touch_session_activity, session_id)

    # Sliding session: a token more than halfway through its lifetime gets
    # transparently renewed via a response header. This is the permanent fix
    # for "student gets logged out mid-exam because their token happened to
    # expire while they were actively answering questions" -- every answer
    # save, every timer poll, every API call during an active session is a
    # chance to renew, so a genuinely active student can never hit a hard
    # expiry wall. A truly idle session (no requests at all for the back half
    # of the token's lifetime) still expires on schedule, same as before.
    # The frontend's axios response interceptor reads this header and swaps
    # the stored token automatically -- nothing changes for the student.
    exp = payload.get("exp")
    if exp:
        try:
            expires_at = datetime.fromtimestamp(exp, tz=timezone.utc)
            remaining_seconds = (expires_at - datetime.now(timezone.utc)).total_seconds()
            half_lifetime_seconds = (expire_minutes_for_role(user.role) * 60) / 2
            if 0 < remaining_seconds < half_lifetime_seconds:
                new_token = create_access_token(user.id, user.role, session_id=session_id)
                # A10 fix (30 Sep 2026 review): this header used to be set
                # unconditionally, even for cookie-authenticated requests --
                # meaning an indefinitely-renewable raw token was handed to
                # page JS (and exposed cross-origin via CORS) for every
                # browser session, defeating the entire point of the
                # 2026-07-22 httpOnly cookie migration (any XSS could have
                # read it straight off the response). Bearer-header callers
                # (scripts, not browsers, so not subject to this risk) still
                # read it exactly as before. Cookie-authenticated browser
                # requests get ONLY a fresh Set-Cookie -- the browser applies
                # it to its cookie jar with no JS involved, so nothing is
                # lost by not also exposing it as a header.
                if used_cookie_auth:
                    set_session_cookie(response, user.role, new_token)
                else:
                    response.headers["X-New-Access-Token"] = new_token
        except Exception:
            # Best-effort sliding-session refresh: a failure here just means
            # this one request doesn't get a renewed token, not a security or
            # correctness issue (the existing token is still valid until its
            # own expiry). Logged so a *repeated* failure is actually visible
            # instead of silently invisible forever.
            logger.warning("Sliding-session token refresh failed for user %s", user.id, exc_info=True)

    # MAANG-Tier Live Tracking: Debounce via LRU memory cache, update DB in background
    if user.id not in active_users_cache:
        active_users_cache[user.id] = True
        background_tasks.add_task(_update_user_activity, user.id)

    # Forced password change (A1 fix, 30 Sep 2026 review). Checked before the
    # mandatory-2FA gate below -- a brand-new admin should replace their
    # default password first, then go on to set up 2FA, not the other way
    # around (setting up 2FA on a still-default password would let whoever
    # logs in first permanently lock out the real owner). Server-side, same
    # reasoning as the 2FA gate: a frontend-only redirect wouldn't stop a
    # direct API call.
    if (
        user.role in MUST_CHANGE_PASSWORD_ROLES
        and user.must_change_password
        and request.url.path not in MUST_CHANGE_PASSWORD_EXEMPT_PATHS
    ):
        api_error(
            403,
            "PASSWORD_CHANGE_REQUIRED",
            "Choose a new password to continue.",
        )

    # Mandatory 2FA enforcement (2026-08-19 security hardening). Checked last
    # -- everything above (token validity, revocation, password-change
    # staleness) still applies first -- so a request that's actually
    # unauthenticated or already invalid gets the correct 401 rather than
    # this more specific error masking it. Server-side, not just a frontend
    # redirect: relying on the UI alone would only stop a browser that
    # cooperates, not a direct API call.
    if (
        user.role in MANDATORY_2FA_ROLES
        and not user.totp_enabled
        and request.url.path not in TWO_FACTOR_SETUP_EXEMPT_PATHS
    ):
        api_error(
            403,
            "TWO_FACTOR_SETUP_REQUIRED",
            "Set up two-factor authentication to continue.",
        )

    return user


def get_current_session_id(request: Request, _: User = Depends(get_current_user)) -> str | None:
    """The current request's session id (JWT "sid" claim), stashed onto
    request.state by get_current_user above. None for a pre-feature token
    that never had one -- callers (the sessions list/revoke endpoints) treat
    that as "can't identify which row is this device," not an error."""
    return getattr(request.state, "session_id", None)


def require_roles(*roles: str):
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            api_error(403, "FORBIDDEN", "You don't have permission to do that.")
        return user
    return dependency


def get_current_student(
    user: User = Depends(require_roles("STUDENT")),
    db: Session = Depends(get_db),
) -> Student:
    student = db.query(Student).filter(Student.user_id == user.id).first()
    if not student:
        api_error(404, "NOT_FOUND", "Your student profile isn't set up yet. Please ask your teacher or school admin.")
    # Defensive second check, mirroring get_current_teacher() below. student.is_active
    # and the underlying user.is_active are kept in sync by every admin endpoint that
    # currently deactivates a student, so this doesn't fire under normal operation --
    # it exists so a future code path (bulk import, a data-repair script, a new admin
    # feature) can never silently desync the two and leave a "deactivated" student with
    # working login access with nobody the wiser.
    if not student.is_active:
        api_error(403, "ACCOUNT_INACTIVE", "Your account is inactive. Please ask your teacher or school admin to reactivate it.")
    return student


def get_current_teacher(
    user: User = Depends(require_roles("TEACHER")),
    db: Session = Depends(get_db),
) -> Teacher:
    teacher = db.query(Teacher).filter(Teacher.user_id == user.id).first()
    if not teacher:
        api_error(404, "NOT_FOUND", "Your teacher profile isn't set up yet. Please ask your school admin.")
    if not teacher.is_active:
        api_error(403, "ACCOUNT_INACTIVE", "Your account is inactive. Please ask your school admin to reactivate it.")
    return teacher
