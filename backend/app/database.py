from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import DATABASE_URL

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
# hide_parameters (A-038): without it, SQLAlchemy puts the failing row's
# values into the exception message, and that message goes to the hosting
# logs and to Sentry. A duplicate-email insert produced an error carrying a
# person's full name, email and password hash; the double-tap race in A-016
# produced one carrying a child's answer. The Sentry scrubber works on field
# names and cannot see into message text, so the only place to stop it is
# here. Queries still log; their bound values no longer do.
engine_kwargs = {
    "connect_args": connect_args,
    "future": True,
    "pool_pre_ping": True,
    "hide_parameters": True,
}

if not DATABASE_URL.startswith("sqlite"):
    engine_kwargs["pool_size"] = 20
    engine_kwargs["max_overflow"] = 10

engine = create_engine(DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
