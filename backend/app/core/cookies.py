"""httpOnly session cookies + double-submit CSRF token.

Retained from MathPath's app/core/cookies.py (Phase 0 audit, "Retain
as-is" bucket), cookie names renamed from mp_* to se_* only.

Raw JWT access tokens are never put in frontend localStorage (readable by
any XSS payload) -- this only works because the browser treats the cookie
as first-party. Two ways that holds: the app's pages and this API share one
site (krama.zetta-metrics.com and api.krama.zetta-metrics.com, #213, with
COOKIE_DOMAIN set to the parent -- see cookie_domain_for() below), or the
frontend proxies /api/* through its own domain (frontend/next.config.mjs's
rewrites(), the arrangement before #213, still the one in local
development). Never point these cookies at a different site.

Multi-role sessions: a user can be logged into super-admin/admin/teacher/
student simultaneously in different browser tabs. A single shared cookie
name would break that -- one login would silently kick out the others.
Instead each role gets its own cookie name, scoped to Path=/api so all of
them ride along on every API request, and the frontend sends a non-secret
X-Auth-Role header (read_session_token() below) telling the backend which
one applies to a given request. Tampering with that header client-side
gains nothing -- it only *selects* which cookie to check, it never
substitutes for one; the actual authorization is always the cookie's JWT
value.

ADMIN and SUPER_ADMIN used to share "se_admin_sess" (both are, loosely,
"an admin"). That was wrong for the multi-tab case: logging into one
silently overwrote the other's cookie in the same browser, since cookies
aren't tab-scoped -- there's only ever one value for a given cookie name
per browser, no matter how many tabs are open. Split 18 Aug 2026 into
their own cookie names so a platform operator (SUPER_ADMIN) and a school
admin can both stay signed in at once, in separate tabs, for testing.
"""
import secrets

from fastapi import Request, Response

from app.core.config import ACCESS_TOKEN_EXPIRE_MINUTES, COOKIE_DOMAIN, COOKIE_SECURE

SESSION_COOKIE_NAMES = {
    "ADMIN": "se_admin_sess",
    "SUPER_ADMIN": "se_super_admin_sess",
    "TEACHER": "se_teacher_sess",
    "STUDENT": "se_student_sess",
}
CSRF_COOKIE_NAME = "se_csrf"
CSRF_HEADER_NAME = "x-csrf-token"
ROLE_HEADER_NAME = "x-auth-role"
SESSION_COOKIE_PATH = "/api"
_COOKIE_MAX_AGE_SECONDS = ACCESS_TOKEN_EXPIRE_MINUTES * 60


def _cookie_name_for_role(role: str) -> str:
    return SESSION_COOKIE_NAMES.get((role or "").upper(), SESSION_COOKIE_NAMES["STUDENT"])


def _request_host(request: Request) -> str:
    return (request.headers.get("host") or "").split(":")[0].strip().lower().rstrip(".")


def cookie_domain_for(request: Request) -> str | None:
    """The Domain a cookie set in answer to this request carries (#213).

    COOKIE_DOMAIN, when the request came in on an address under it (the
    browser calling api.krama.zetta-metrics.com directly): the cookie is then
    for krama.zetta-metrics.com and everything under it, so the app's own
    pages can read the CSRF cookie and the API receives both. Otherwise None,
    a host-only cookie, exactly as before #213: the onrender.com address that
    Vercel's rewrite calls, and local development. A browser refuses a cookie
    whose Domain does not cover the address that set it, which is why this
    follows the request's address rather than always applying.

    Setting and clearing use the same answer for the same address, so a
    cookie is always cleared with the Domain it was set with.
    """
    if not COOKIE_DOMAIN:
        return None
    host = _request_host(request)
    if host == COOKIE_DOMAIN or host.endswith("." + COOKIE_DOMAIN):
        return COOKIE_DOMAIN
    return None


def set_session_cookie(response: Response, role: str, token: str, *, request: Request) -> None:
    response.set_cookie(
        key=_cookie_name_for_role(role),
        value=token,
        max_age=_COOKIE_MAX_AGE_SECONDS,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path=SESSION_COOKIE_PATH,
        domain=cookie_domain_for(request),
    )


def set_csrf_cookie(response: Response, *, request: Request) -> str:
    """Issue the double-submit CSRF cookie. Deliberately NOT httpOnly -- the
    frontend reads its value and echoes it back as the X-CSRF-Token header
    on every mutating request. A cross-site page can make the browser send
    the session cookie automatically, but it cannot read this cookie's
    value (blocked by same-origin policy) to also produce a matching
    header, so get_current_user() rejects the forged request.
    """
    token = secrets.token_urlsafe(32)
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=token,
        max_age=_COOKIE_MAX_AGE_SECONDS,
        httponly=False,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
        domain=cookie_domain_for(request),
    )
    return token


def touch_csrf_cookie(request: Request, response: Response) -> None:
    """Keep the CSRF cookie alive for as long as the session itself is
    active, re-issuing it (same value, fresh Max-Age) on every
    cookie-authenticated request rather than letting it die on a fixed
    schedule while the session cookie keeps sliding forward indefinitely.

    If the session cookie is there and the CSRF cookie is not, a new one is
    issued (3 Oct 2026). That state is easy to reach: the CSRF cookie is one
    cookie shared by every role signed in on a browser, and signing out of
    any one role deletes it (routes_auth.py, /logout) -- so with a teacher
    and an admin signed in side by side, signing the teacher out left the
    admin tab unable to change anything, with a message telling them to
    refresh that a refresh did not cure: this function returned early when
    the cookie was absent, so nothing but signing in again ever replaced it.
    Now the next authenticated request of any kind does -- the page load a
    refresh makes, or the frontend's own automatic recovery (lib/api.ts).

    This gives a forged cross-site request nothing. The cookie is only ever
    set on a response, which the attacker's page cannot read, and a request
    that arrives without the matching X-CSRF-Token header is still refused
    by the check that follows this call in get_current_user(). (A header
    set on `response` here does not survive that refusal anyway: FastAPI
    drops it when an exception produces the response.)
    """
    existing = request.cookies.get(CSRF_COOKIE_NAME)
    if not existing:
        set_csrf_cookie(response, request=request)
        return
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=existing,
        max_age=_COOKIE_MAX_AGE_SECONDS,
        httponly=False,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
        domain=cookie_domain_for(request),
    )


def clear_session_cookie(response: Response, role: str, *, request: Request) -> None:
    response.delete_cookie(_cookie_name_for_role(role), path=SESSION_COOKIE_PATH, domain=cookie_domain_for(request))


def clear_csrf_cookie(response: Response, *, request: Request) -> None:
    response.delete_cookie(CSRF_COOKIE_NAME, path="/", domain=cookie_domain_for(request))


def clear_all_session_cookies(response: Response, *, request: Request) -> None:
    for cookie_name in set(SESSION_COOKIE_NAMES.values()):
        response.delete_cookie(cookie_name, path=SESSION_COOKIE_PATH, domain=cookie_domain_for(request))
    clear_csrf_cookie(response, request=request)


def read_session_token(request: Request) -> str | None:
    role_hint = (request.headers.get(ROLE_HEADER_NAME) or "").upper()
    hinted_cookie = SESSION_COOKIE_NAMES.get(role_hint)
    if hinted_cookie:
        token = request.cookies.get(hinted_cookie)
        if token:
            return token

    # No/unrecognized hint (or the hinted cookie wasn't present) -- fall
    # back to whichever session cookie does exist, so a single-role session
    # never breaks just because a caller forgot the header.
    for cookie_name in dict.fromkeys(SESSION_COOKIE_NAMES.values()):
        token = request.cookies.get(cookie_name)
        if token:
            return token
    return None
