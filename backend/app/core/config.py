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
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

# httpOnly session cookies must be Secure in production (Render + Vercel are
# both HTTPS-only). Local dev over plain http://localhost needs this off --
# set COOKIE_SECURE=false in backend/.env for local development only, never
# in a deployed environment.
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "true").lower() == "true"

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
SENTRY_DSN = os.getenv("SENTRY_DSN")
