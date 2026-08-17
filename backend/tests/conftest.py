"""Shared pytest fixtures: an isolated in-memory SQLite DB per test session,
with app.database.get_db overridden so the FastAPI app under test never
touches a real DATABASE_URL. Mirrors the pattern CI's backend-tests job
expects (see .github/workflows/ci.yml).
"""
import os

# Must be set before app.core.config is imported (it reads env vars at
# module load time) -- TestClient talks to the app over plain http://, and
# a Secure-flagged cookie is silently dropped by the client on an insecure
# origin, which would otherwise break every cookie-authenticated test here.
os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("PLATFORM_OPERATOR_KEY", "test-platform-operator-key")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app

TEST_DATABASE_URL = "sqlite:///:memory:"

# StaticPool is required for an in-memory SQLite DB in tests: without it,
# every new connection opens its own separate, empty in-memory database
# (SQLite's :memory: is per-connection by default), so the schema created
# in the _create_schema fixture below would be invisible to the connection
# the app itself uses. StaticPool forces every checkout to reuse the same
# single underlying connection.
engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


@pytest.fixture(scope="session", autouse=True)
def _create_schema():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db_session():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db_session):
    def _override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
