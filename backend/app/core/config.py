import os

from dotenv import load_dotenv

load_dotenv()

# --- Core --------------------------------------------------------------
# Retained as-is from MathPath's app/core/config.py (Phase 0 audit,
# "Retain as-is" bucket) -- generic auth/session/DB settings, nothing
# Abacus-specific. Stripped: SMTP/email config (deferred per
# ENGINEERING_OPERATING_SYSTEM.md Section 2, not wired to anything yet)
# and the "Phase 8.8 assessment readiness bypass" flags, which were
# MathPath's own in-flight testing scaffolding for a feature School
# Enrichment doesn't have yet.
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./school_enrichment.db")

# A14 fix (30 Sep 2026 review): distinguishes a real deployment from local
# dev/CI so main.py can gate the localhost CORS origin and the SECRET_KEY
# startup guard below to dev-only, without a separate env var for each.
# Render's own environment doesn't set this, so it defaults to "production"
# -- the safe-by-default direction (a forgotten env var means the stricter
# checks stay ON, not OFF). Local dev/CI must set ENVIRONMENT=development
# explicitly (see .env.example / CI workflow).
ENVIRONMENT = os.getenv("ENVIRONMENT", "production")
IS_PRODUCTION = ENVIRONMENT.lower() == "production"

_DEFAULT_SECRET_KEY = "dev-secret-change-me"
SECRET_KEY = os.getenv("SECRET_KEY", _DEFAULT_SECRET_KEY)

# A13 fix: fail closed instead of silently signing every JWT in production
# with a value that's sitting in plain sight in this file's own git history.
# Render always generates a real SECRET_KEY (render.yaml: generateValue:
# true), so this should never actually fire there -- it exists purely so a
# misconfigured deploy (env var missing/blank) refuses to boot instead of
# quietly issuing forgeable tokens.
if IS_PRODUCTION and SECRET_KEY == _DEFAULT_SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY is not set (falling back to the public default). Refusing to start in production -- "
        "set a real SECRET_KEY, or set ENVIRONMENT=development if this really is a local/dev run."
    )

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

# httpOnly session cookies must be Secure in production (Render + Vercel are
# both HTTPS-only). Local dev over plain http://localhost needs this off --
# set COOKIE_SECURE=false in backend/.env for local development only, never
# in a deployed environment.
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "true").lower() == "true"

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
SENTRY_DSN = os.getenv("SENTRY_DSN")

# Permanent operator-only credential for POST /api/platform/schools (see
# routes_platform.py) -- the one endpoint that must work before any admin
# account exists to log in with, since account creation is otherwise
# admin-gated. Not a per-user secret and not one-time: whoever operates the
# platform (Shailesh, or the hosting team later) holds this and calls the
# endpoint each time a new school is onboarded. Unset by default so a
# deployment with no key configured fails closed instead of silently open.
PLATFORM_OPERATOR_KEY = os.getenv("PLATFORM_OPERATOR_KEY")
