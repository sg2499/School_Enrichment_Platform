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

from app.api.routes_auth import router as auth_router
from app.api.routes_health import router as health_router
from app.core.config import FRONTEND_URL, SENTRY_DSN
from app.core.rate_limit import limiter

logger = logging.getLogger("school_enrichment")

if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        traces_sample_rate=1.0,
        profiles_sample_rate=1.0,
    )

app = FastAPI(title="School Enrichment Backend", version="0.1.0")

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # X-New-Access-Token carries the sliding-session refresh (see
    # get_current_user() in dependencies.py) -- without explicitly exposing
    # it here, CORS hides all custom response headers from frontend JS by
    # default, so the refreshed token would be sent but invisible to axios.
    expose_headers=["X-New-Access-Token"],
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
