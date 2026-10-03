"""Every failure this API can produce leaves in one envelope, written for a
person, with a reference they can quote (app/core/error_handling.py).

Two kinds of test here. The ones taking `client` run against the real app,
so they prove the handlers are actually installed and survive the real
middleware stack. The ones using `mini` build a throwaway app with the same
handlers and a 2-per-minute default limit: the shapes worth pinning (a query
bound, a rate limit answered by SlowAPIMiddleware rather than by a route
decorator) sit behind authentication or a 200-request budget on the real
app, and a test should not need 201 requests to say one thing.
"""
import inspect
import logging
import re

import pytest
from fastapi import FastAPI, HTTPException, Query
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from app.core.error_handling import (
    REQUEST_ID_HEADER,
    SECURITY_HEADERS,
    RequestIdMiddleware,
    _field_label,
    _spoken_wait,
    install_error_handling,
    rate_limit_exceeded_handler,
)
from app.core.errors import api_error
from app.main import app

REFERENCE = re.compile(r"^SE-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$")


def _assert_envelope(response, status_code: int, code: str) -> dict:
    """The contract every error response keeps: api_error()'s shape, plus a
    reference that matches the one on the response header."""
    assert response.status_code == status_code, response.text
    body = response.json()
    detail = body["detail"]
    assert isinstance(detail, dict), body
    assert detail["code"] == code
    assert isinstance(detail["message"], str) and detail["message"]
    assert isinstance(detail["details"], dict)
    assert REFERENCE.match(detail["requestId"]), detail["requestId"]
    assert response.headers[REQUEST_ID_HEADER] == detail["requestId"]
    return detail


# --- the real app --------------------------------------------------------------


def test_every_response_carries_its_own_reference(client):
    first = client.get("/api/health")
    second = client.get("/api/health")
    assert first.status_code == 200
    assert REFERENCE.match(first.headers[REQUEST_ID_HEADER])
    assert REFERENCE.match(second.headers[REQUEST_ID_HEADER])
    assert first.headers[REQUEST_ID_HEADER] != second.headers[REQUEST_ID_HEADER]


def test_a_reference_sent_by_the_client_is_never_adopted(client):
    # It would be written into the log line and the Sentry tag verbatim.
    response = client.get("/api/health", headers={REQUEST_ID_HEADER: "SE-AAAA-AAAA"})
    assert response.headers[REQUEST_ID_HEADER] != "SE-AAAA-AAAA"
    assert REFERENCE.match(response.headers[REQUEST_ID_HEADER])


def test_api_error_keeps_its_shape_and_gains_a_reference(client):
    response = client.get("/api/auth/me")
    detail = _assert_envelope(response, 401, "UNAUTHORIZED")
    # Nothing api_error() put there has moved or been renamed: the frontend
    # that is live today reads exactly these keys.
    assert set(detail) == {"code", "message", "details", "requestId"}


def test_an_unknown_route_is_not_a_bare_not_found(client):
    response = client.get("/api/there-is-no-such-route")
    detail = _assert_envelope(response, 404, "NOT_FOUND")
    assert detail["message"] == "We couldn't find what you were looking for."
    assert response.json()["detail"] != "Not Found"


def test_a_wrong_method_keeps_its_allow_header(client):
    response = client.delete("/api/auth/login")
    _assert_envelope(response, 405, "METHOD_NOT_ALLOWED")
    assert response.headers["allow"] == "POST"


@pytest.mark.parametrize(
    "body",
    [
        ["someone@school.edu", "MySecretPassw0rd!"],  # the whole body is the wrong JSON type
        {"identifier": "someone@school.edu", "password": ["MySecretPassw0rd!"]},  # one field is
    ],
)
def test_a_rejected_sign_in_body_is_never_echoed_back(client, body):
    # FastAPI's default 422 returns each rejected value under "input" --
    # measured before this change, both of these came back with the password
    # in the response body.
    response = client.post("/api/auth/login", json=body)
    _assert_envelope(response, 422, "VALIDATION_ERROR")
    assert "MySecretPassw0rd!" not in response.text
    assert "someone@school.edu" not in response.text
    assert "input" not in response.text


def test_an_unreadable_body_says_so_plainly(client):
    response = client.post("/api/auth/login", content="{not json", headers={"content-type": "application/json"})
    detail = _assert_envelope(response, 422, "VALIDATION_ERROR")
    assert detail["message"] == "We couldn't read that request. Please refresh the page and try again."
    assert detail["details"] == {"fields": [], "unreadableBody": True}
    # pydantic's own wording ("JSON decode error", "Expecting property name
    # enclosed in double quotes") is for developers.
    assert "JSON" not in response.text and "Expecting" not in response.text


def test_a_missing_field_is_named_in_words(client):
    response = client.post("/api/auth/login", json={"identifier": "someone@school.edu"})
    detail = _assert_envelope(response, 422, "VALIDATION_ERROR")
    assert detail["message"] == "Password is required."
    assert detail["details"]["fields"] == [{"field": "password", "in": "body", "issue": "Password is required."}]


def test_a_route_level_rate_limit_is_readable_and_says_how_long(client):
    # School provisioning allows 10 an hour. The limit is counted when the
    # route runs, so each request has to get past the operator-key check and
    # the body model first; a blank school name then stops it (422) before
    # anything is created.
    payload = {"schoolName": " ", "adminFullName": "A", "adminEmail": "a@example.com", "adminPassword": "x"}
    headers = {"X-Platform-Key": "test-platform-operator-key"}
    for _ in range(10):
        assert client.post("/api/platform/schools", json=payload, headers=headers).status_code == 422
    response = client.post("/api/platform/schools", json=payload, headers=headers)

    detail = _assert_envelope(response, 429, "RATE_LIMITED")
    retry_after = detail["details"]["retryAfterSeconds"]
    assert 3500 < retry_after <= 3600
    assert response.headers["retry-after"] == str(retry_after)
    assert detail["message"] == "Too many attempts in a short time. Please wait about an hour and try again."
    assert "Rate limit exceeded" not in response.text and "per 1 hour" not in response.text


def test_a_crash_tells_the_client_nothing_and_the_log_everything(db_session, caplog):
    secret = "SELECT password_hash FROM users WHERE email = 'head@school.edu'"

    def boom():
        raise RuntimeError(secret)

    app.add_api_route("/api/_test_boom", boom, methods=["GET"])
    try:
        with (
            caplog.at_level(logging.ERROR, logger="school_enrichment"),
            TestClient(app, raise_server_exceptions=False) as raw_client,
        ):
            response = raw_client.get("/api/_test_boom")
    finally:
        app.router.routes[:] = [r for r in app.router.routes if getattr(r, "path", None) != "/api/_test_boom"]

    detail = _assert_envelope(response, 500, "INTERNAL_SERVER_ERROR")
    assert detail["message"] == "Something went wrong on our side. Please try again in a moment."
    assert secret not in response.text and "RuntimeError" not in response.text
    # The legacy key the live frontend reads, kept beside the envelope.
    assert response.json()["error"] == detail
    # Starlette answers a crash from outside this app's middleware, so these
    # were missing from the one response most worth hardening.
    for header, value in SECURITY_HEADERS.items():
        assert response.headers[header] == value
    # The same reference is on the log line, with the real exception.
    crash_logs = [record for record in caplog.records if "Unhandled exception" in record.getMessage()]
    assert len(crash_logs) == 1
    assert detail["requestId"] in crash_logs[0].getMessage()
    assert crash_logs[0].exc_info and secret in str(crash_logs[0].exc_info[1])


# --- a throwaway app with the same handlers ------------------------------------


class _Marks(BaseModel):
    studentName: str = Field(min_length=2, max_length=5)
    marks: int = Field(ge=0, le=10)
    grade: str = Field(pattern="^[A-E]$")
    tags: list[str] = Field(default_factory=list, max_length=2)


@pytest.fixture()
def mini():
    mini_app = FastAPI()
    mini_app.state.limiter = Limiter(key_func=get_remote_address, default_limits=["2/minute"])
    install_error_handling(mini_app)
    mini_app.add_middleware(SlowAPIMiddleware)
    mini_app.add_middleware(RequestIdMiddleware)

    @mini_app.get("/list")
    def list_things(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100, alias="pageSize")):
        return {"page": page, "pageSize": page_size}

    @mini_app.post("/marks")
    def save_marks(payload: _Marks):
        return {"ok": True}

    @mini_app.get("/plain/{status_code}")
    def plain(status_code: int):
        raise HTTPException(status_code=status_code)

    @mini_app.get("/domain")
    def domain():
        api_error(409, "ALREADY_MAPPED", "This chapter is already in your calendar.", {"chapterId": "c1"})

    with TestClient(mini_app) as mini_client:
        mini_client.limiter = mini_app.state.limiter
        yield mini_client


def test_query_bounds_are_explained_with_the_bound(mini):
    response = mini.get("/list", params={"page": 0, "pageSize": 500})
    detail = _assert_envelope(response, 422, "VALIDATION_ERROR")
    assert detail["message"] == "Page must be at least 1. Page size must be at most 100."
    assert detail["details"]["fields"] == [
        {"field": "page", "in": "query", "issue": "Page must be at least 1."},
        {"field": "pageSize", "in": "query", "issue": "Page size must be at most 100."},
    ]


def test_a_value_of_the_wrong_kind_is_not_described_in_parser_terms(mini):
    response = mini.get("/list", params={"page": "two"})
    detail = _assert_envelope(response, 422, "VALIDATION_ERROR")
    assert detail["message"] == "Page isn't in the expected format."
    assert "unable to parse" not in response.text and "two" not in response.text


def test_many_problems_are_capped_at_three_sentences(mini):
    mini.limiter.reset()
    response = mini.post("/marks", json={"studentName": "A", "marks": 11, "grade": "Z", "tags": ["a", "b", "c"]})
    detail = _assert_envelope(response, 422, "VALIDATION_ERROR")
    assert detail["message"] == (
        "Student name must be at least 2 characters long. Marks must be at most 10. "
        "Grade isn't in the expected format. And 1 more."
    )
    assert [field["field"] for field in detail["details"]["fields"]] == ["studentName", "marks", "grade", "tags"]
    assert detail["details"]["fields"][3]["issue"] == "Tags can have at most 2 items."


def test_singular_bounds_read_as_singular(mini):
    class _One(BaseModel):
        initials: str = Field(min_length=1)

    @mini.app.post("/one")
    def one(payload: _One):
        return {"ok": True}

    response = mini.post("/one", json={"initials": ""})
    assert response.json()["detail"]["message"] == "Initials must be at least 1 character long."


@pytest.mark.parametrize(
    ("status_code", "code", "message"),
    [
        (400, "BAD_REQUEST", "That request couldn't be understood. Please try again."),
        (403, "FORBIDDEN", "You don't have permission to do that."),
        (413, "PAYLOAD_TOO_LARGE", "That's too large to upload. Please try a smaller file."),
        (409, "CONFLICT", "That request couldn't be completed. Please try again."),
        (503, "SERVICE_UNAVAILABLE", "Something went wrong on our side. Please try again in a moment."),
    ],
)
def test_a_bare_http_exception_never_reaches_a_person_as_a_status_phrase(mini, status_code, code, message):
    mini.limiter.reset()
    response = mini.get(f"/plain/{status_code}")
    detail = _assert_envelope(response, status_code, code)
    assert detail["message"] == message


def test_domain_details_pass_through_untouched(mini):
    response = mini.get("/domain")
    detail = _assert_envelope(response, 409, "ALREADY_MAPPED")
    assert detail["message"] == "This chapter is already in your calendar."
    assert detail["details"] == {"chapterId": "c1"}


def test_the_default_limit_answers_in_the_same_envelope(mini):
    # This is the path SlowAPIMiddleware answers itself, before any route
    # runs. It calls the handler synchronously; if the handler were a
    # coroutine function it would silently fall back to slowapi's own
    # {"error": "Rate limit exceeded: 2 per 1 minute"}.
    mini.limiter.reset()
    assert mini.get("/list").status_code == 200
    assert mini.get("/list").status_code == 200
    response = mini.get("/list")
    detail = _assert_envelope(response, 429, "RATE_LIMITED")
    assert detail["message"] == "Too many attempts in a short time. Please wait about a minute and try again."
    assert response.headers["retry-after"] == str(detail["details"]["retryAfterSeconds"])
    assert "error" not in response.json()


def test_the_rate_limit_handler_stays_synchronous():
    assert not inspect.iscoroutinefunction(rate_limit_exceeded_handler)


@pytest.mark.parametrize(
    ("seconds", "spoken"),
    [
        (1, "a few seconds"),
        (5, "a few seconds"),
        (6, "about 10 seconds"),
        (44, "about 50 seconds"),
        (50, "about 50 seconds"),
        (51, "about a minute"),
        (90, "about a minute"),
        (91, "about 2 minutes"),
        (3540, "about 59 minutes"),
        (3600, "about an hour"),
        (7201, "about 3 hours"),
    ],
)
def test_waits_are_rounded_up_and_spoken(seconds, spoken):
    assert _spoken_wait(seconds) == spoken


@pytest.mark.parametrize(
    ("name", "label"),
    [
        ("pageSize", "Page size"),
        ("page_size", "Page size"),
        ("newPassword", "New password"),
        ("X-Platform-Key", "X platform key"),
        ("classId", "Class"),
        ("school_id", "School"),
        ("id", "Id"),
        ("section", "Section"),
        ("", "This value"),
    ],
)
def test_field_names_become_words(name, label):
    assert _field_label(name) == label
