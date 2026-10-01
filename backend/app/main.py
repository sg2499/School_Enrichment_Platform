"""School Enrichment backend entrypoint.

Retained from MathPath's app/main.py (Phase 0 audit, "Retain as-is"
bucket): CORS setup, the security-headers middleware, the global exception
handler that never leaks stack traces, and slowapi rate limiting -- all
framework-level hardening, none of it Abacus-specific.

Deliberately NOT carried over: the ~15 `ensure_*` ad-hoc schema-patching
calls and the six unconditional Abacus curriculum seed calls (YLM/MM/IM/
PM/PM-L2/PM-L3/PM-L4/BM) that used to run on every startup. Schema changes
here go through Alembic migrations (see backend/alembic/, and render.yaml's
build command) instead of runtime ALTER-TABLE patching -- a deliberate
process improvement, not an oversight: ad-hoc patching is exactly the kind
of shortcut ENGINEERING_OPERATING_SYSTEM.md's branch-protection rule
("no admin-bypass") exists to prevent elsewhere in the pipeline, so it
doesn't belong in the schema layer either.
"""
import logging

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api.routes_auth import router as auth_router
from app.api.routes_curriculum_admin import router as curriculum_admin_router
from app.api.routes_health import router as health_router
from app.api.routes_learning import router as learning_router
from app.api.routes_platform import router as platform_router
from app.api.routes_practice_tracker import router as practice_tracker_router
from app.api.routes_roster import router as roster_router
from app.api.routes_teacher_assignments import router as teacher_assignments_router
from app.core.config import FRONTEND_URL, IS_PRODUCTION, SENTRY_DSN
from app.core.rate_limit import limiter

logger = logging.getLogger("school_enrichment")

# A5 fix (30 Sep 2026 security/DPDP review): verified against the pinned SDK
# (sentry-sdk 2.68.0) that the Starlette integration attaches the raw
# request body to events regardless of send_default_pii, and the default
# scrubber only matches exact key names -- currentPassword/newPassword/
# challengeToken/the TOTP code all passed through unscrubbed, and the
# X-Platform-Key operator secret wasn't covered by the header filter either.
_SENTRY_DENYLIST_FIELDS = [
    "password", "currentpassword", "newpassword", "challengetoken", "code",
    "secret", "totp_secret", "totp_pending_secret", "totp_backup_codes_json",
    "authorization", "x-platform-key", "csrf",
]


def _sentry_before_send(event, hint):
    """Belt-and-suspenders on top of max_request_body_size='never' and
    EventScrubber below: strip any request body/headers/cookies that made it
    onto the event anyway, so a future SDK change or an unanticipated event
    shape can't reintroduce a leak silently."""
    request_data = event.get("request")
    if isinstance(request_data, dict):
        request_data.pop("data", None)
        request_data.pop("cookies", None)
        headers = request_data.get("headers")
        if isinstance(headers, dict):
            for key in list(headers):
                if key.lower() in {"authorization", "cookie", "x-platform-key"}:
                    headers.pop(key, None)
    return event


if SENTRY_DSN:
    from sentry_sdk.scrubber import DEFAULT_DENYLIST, EventScrubber

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        # Never attach the raw request body -- the Starlette integration
        # otherwise does this regardless of send_default_pii.
        max_request_body_size="never",
        send_default_pii=False,
        before_send=_sentry_before_send,
        event_scrubber=EventScrubber(denylist=DEFAULT_DENYLIST + _SENTRY_DENYLIST_FIELDS, recursive=True),
        # Lowered from 1.0 (100% of requests traced/profiled) -- that default
        # was never a deliberate choice for this app's volume, and a lower
        # sample rate is standard practice once a project is not just being
        # bootstrapped. Errors are always captured regardless of this rate;
        # this only affects performance-tracing/profiling volume.
        traces_sample_rate=0.1,
        profiles_sample_rate=0.1,
    )

app = FastAPI(title="School Enrichment Backend", version="0.1.0")

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
# A8 fix (30 Sep 2026 review): rate_limit.py's default_limits ("200/minute")
# never actually applied to anything -- slowapi only enforces limits on
# routes that install this middleware; without it, only the handful of
# routes carrying an explicit @limiter.limit(...) decorator were ever
# limited at all, and everything else (notably
# /2fa/backup-codes/regenerate, since fixed with its own decorator -- see
# routes_auth.py) had no limit whatsoever.
app.add_middleware(SlowAPIMiddleware)

# A14 fix: localhost:3000 stayed in the production CORS allow-list
# unconditionally. Harmless in the sense that allow_origins is a fixed,
# server-side list (not reflected from the request), but there is no reason
# for a deployed backend to trust a local dev origin at all -- dev-only.
_cors_origins = [FRONTEND_URL] if IS_PRODUCTION else [FRONTEND_URL, "http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # A10 fix (30 Sep 2026 review): X-New-Access-Token used to be exposed
    # here so browser JS could read the sliding-session renewal off the
    # response -- but the browser frontend is entirely cookie-authenticated
    # (see dependencies.py's get_current_user(), which now only ever sets
    # this header for Bearer-token requests, never cookie-auth ones). A
    # Bearer-token caller is a script, not a browser page, so it isn't
    # subject to CORS's header-visibility restriction in the first place --
    # nothing legitimate needs this exposed, and leaving it exposed meant
    # any XSS could read an indefinitely-renewable raw token straight off
    # the response.
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """Baseline security headers on every response.

    This is a JSON API backend with no server-rendered HTML pages of its
    own, so a locked-down CSP and framing policy carry no functional risk
    here -- they just close off classes of attack (clickjacking, MIME
    sniffing, cross-origin framing) that an absent policy would leave open.
    """
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
    response.headers.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
    return response


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    from fastapi import HTTPException
    if isinstance(exc, HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})
    # Log the real exception server-side (Sentry captures it too when
    # SENTRY_DSN is configured) but never leak str(exc) to the client.
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_SERVER_ERROR", "message": "Something went wrong. Please try again.", "details": {}}},
    )


app.include_router(health_router)
app.include_router(auth_router)
app.include_router(platform_router)
app.include_router(curriculum_admin_router)
app.include_router(roster_router)
app.include_router(learning_router)
app.include_router(practice_tracker_router)
app.include_router(teacher_assignments_router)
