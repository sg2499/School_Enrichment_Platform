"""One error envelope for every failure this API can produce (3 Oct 2026).

Before this, five different shapes could come back when a request failed,
and the frontend's one error reader understood only the first and the last:

  api_error(...)            {"detail": {"code", "message", "details"}}
  an unknown route / verb   {"detail": "Not Found"}            (Starlette's)
  a malformed request       {"detail": [{"type", "loc", "msg", "input"}]}
                                                               (FastAPI's)
  a rate limit              {"error": "Rate limit exceeded: 5 per 1 minute"}
                                                               (slowapi's)
  an unhandled exception    {"error": {"code", "message", "details"}}

That reader (lib/api.ts, apiErrorMessage) looks for `detail.message` or
`error.message`. The second shape gave it a bare "Not Found"; the third and
fourth gave it nothing, so it fell back to the HTTP library's own text and
the person saw "Request failed with status code 422" -- Shailesh, 3 Oct
2026: an error "should never be a raw error but one that the user should
see ... just like it is shown in every top notch world class platform".

The third shape had a second problem that is not cosmetic. FastAPI's default
validation response echoes each rejected value back under "input". Measured
against POST /api/auth/login before this change: a body sent as a JSON list
came back whole -- {"input": ["someone@school.edu", "MySecretPassw0rd!"]} --
and a password sent as the wrong JSON type came back as {"input": 12345678}.
The app's own pages always send the right types, so this is not something a
teacher trips over; it is a submitted password in a response body, and in
anything that logs response bodies, for whoever does send the wrong type.

So every failure now leaves as the first shape, with one addition:

  {"detail": {"code": "...", "message": "...", "details": {...},
              "requestId": "SE-7K3F-9QXM"}}

`requestId` is a reference a person can read out to whoever is helping them,
and the same value is in the server log line, on the Sentry event (as the
`request_id` tag) and in the X-Request-ID response header -- so "it broke"
becomes one exact request rather than a guess from a timestamp. It is on
every error, not just 500s, because a 403 someone is confused by is as worth
tracing as a crash.

What did NOT change, on purpose: status codes, `code` values, and the
position of `code`/`message`/`details` inside `detail`. The frontend that is
live today keeps working against this without a matching deploy, which
matters because there is no staging environment and the backend (Render) and
frontend (Vercel) ship separately. The unhandled-exception response also
keeps its legacy top-level "error" key beside the new "detail" for the same
reason.
"""
import logging
import math
import secrets
import time
from http import HTTPStatus

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("school_enrichment")

REQUEST_ID_HEADER = "X-Request-ID"

# Same headers main.py's add_security_headers() sets. That middleware cannot
# reach the unhandled-exception response -- Starlette answers a crash from
# ServerErrorMiddleware, which sits outside every middleware this app adds --
# so until now the one response most likely to be looked at by someone
# probing the API was also the only one without them.
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
}

# No 0/O, 1/I/L: the reference is read off a screen and said aloud or typed
# into a message by a teacher or a parent, not copied by a developer.
_REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


def new_request_id() -> str:
    """SE-XXXX-XXXX. 31^8 (~850 billion) values: not a secret and not a
    database key, only unique enough to find one request in a day's logs."""
    chars = "".join(secrets.choice(_REFERENCE_ALPHABET) for _ in range(8))
    return f"SE-{chars[:4]}-{chars[4:]}"


def request_id_of(request: Request) -> str:
    """The reference for this request. Falls back to a fresh one rather than
    None so an error body always has something to quote, even for a request
    that somehow never passed through RequestIdMiddleware."""
    existing = getattr(request.state, "request_id", None)
    if existing:
        return existing
    created = new_request_id()
    request.state.request_id = created
    return created


class RequestIdMiddleware:
    """Gives every request a reference and puts it on the response.

    Always generated here, never read from an incoming X-Request-ID: a
    client-supplied value would be written into the log line and the Sentry
    tag verbatim, which is a log-forging hole for no benefit -- nothing
    upstream of this service (Vercel's rewrite, Render's front door) sends a
    reference this app could use.

    Plain ASGI rather than BaseHTTPMiddleware: all it does is set one value
    and add one header, and it should not put a second task and stream
    between the app and the server to do it.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = new_request_id()
        # scope["state"] is what Request.state reads and writes, so every
        # Request built from this scope -- the route's, slowapi's, and the
        # one Starlette builds for the unhandled-exception handler -- sees
        # the same value.
        scope.setdefault("state", {})["request_id"] = request_id
        # No-op when Sentry isn't configured. The SDK's own ASGI wrapper has
        # already opened this request's isolation scope by the time any app
        # middleware runs, so the tag lands on this request's events only.
        sentry_sdk.set_tag("request_id", request_id)

        async def send_with_reference(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        await self.app(scope, receive, send_with_reference)


def _error_body(request: Request, code: str, message: str, details: dict | None = None) -> dict:
    return {
        "detail": {
            "code": code,
            "message": message,
            "details": details or {},
            "requestId": request_id_of(request),
        }
    }


# --- anything raised as an HTTPException ---------------------------------------

# For HTTPExceptions that arrive with a bare string instead of api_error()'s
# dict. In this codebase that is only ever Starlette's own routing answers
# (a URL or method the API doesn't have) -- every deliberate error goes
# through api_error -- but the mapping covers the rest so a future
# `raise HTTPException(403)` can't reintroduce "Forbidden" as user copy.
_PLAIN_HTTP_ERRORS: dict[int, tuple[str, str]] = {
    400: ("BAD_REQUEST", "That request couldn't be understood. Please try again."),
    401: ("UNAUTHORIZED", "Please sign in to continue."),
    403: ("FORBIDDEN", "You don't have permission to do that."),
    404: ("NOT_FOUND", "We couldn't find what you were looking for."),
    405: ("METHOD_NOT_ALLOWED", "That action isn't available here."),
    408: ("REQUEST_TIMEOUT", "That took too long to send. Please try again."),
    413: ("PAYLOAD_TOO_LARGE", "That's too large to upload. Please try a smaller file."),
    415: ("UNSUPPORTED_MEDIA_TYPE", "That type of file isn't supported here."),
}


def _plain_http_error(status_code: int) -> tuple[str, str]:
    known = _PLAIN_HTTP_ERRORS.get(status_code)
    if known:
        return known
    try:
        code = HTTPStatus(status_code).name
    except ValueError:
        code = "REQUEST_FAILED"
    if status_code >= 500:
        return code, "Something went wrong on our side. Please try again in a moment."
    return code, "That request couldn't be completed. Please try again."


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict) and "code" in detail and "message" in detail:
        # api_error()'s own shape: passed through untouched, plus the
        # reference.
        body = {"detail": {**detail, "requestId": request_id_of(request)}}
    else:
        code, message = _plain_http_error(exc.status_code)
        body = _error_body(request, code, message)
    # exc.headers carries e.g. Allow on a 405; dropping it would make this
    # handler less correct than the default it replaces.
    return JSONResponse(status_code=exc.status_code, content=body, headers=getattr(exc, "headers", None))


# --- a request that doesn't fit the endpoint's signature -------------------------

_PARAMETER_SOURCES = {"body", "query", "path", "header", "cookie"}


def _field_label(name: str) -> str:
    """pageSize / page_size -> "Page size"; classId -> "Class"."""
    spaced = []
    for index, char in enumerate(name):
        if char in "_-":
            spaced.append(" ")
        elif char.isupper() and index > 0 and (name[index - 1].islower() or name[index - 1].isdigit()):
            spaced.append(" " + char)
        else:
            spaced.append(char)
    words = "".join(spaced).split()
    # classId / school_id: the person chose a class or a school, not an id.
    if len(words) > 1 and words[-1].lower() == "id":
        words = words[:-1]
    if not words:
        return "This value"
    label = " ".join(words).lower()
    return label[0].upper() + label[1:]


def _plural(count: object, noun: str) -> str:
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"


def _field_issue(error: dict, label: str) -> str:
    """One pydantic error as one sentence. Keyed on pydantic's stable `type`
    (never its `msg`, which is written for developers: "Input should be a
    valid integer, unable to parse string as an integer")."""
    kind = str(error.get("type", ""))
    ctx = error.get("ctx") or {}

    if kind == "missing":
        return f"{label} is required."
    if kind in {"greater_than_equal", "greater_than", "less_than_equal", "less_than"}:
        bound = {
            "greater_than_equal": ("ge", "at least"),
            "greater_than": ("gt", "more than"),
            "less_than_equal": ("le", "at most"),
            "less_than": ("lt", "less than"),
        }[kind]
        if bound[0] in ctx:
            return f"{label} must be {bound[1]} {ctx[bound[0]]}."
    if kind == "string_too_short" and "min_length" in ctx:
        return f"{label} must be at least {_plural(ctx['min_length'], 'character')} long."
    if kind == "string_too_long" and "max_length" in ctx:
        return f"{label} must be at most {_plural(ctx['max_length'], 'character')} long."
    if kind == "too_short" and "min_length" in ctx:
        return f"{label} needs at least {_plural(ctx['min_length'], 'item')}."
    if kind == "too_long" and "max_length" in ctx:
        return f"{label} can have at most {_plural(ctx['max_length'], 'item')}."
    if kind in {"enum", "literal_error"}:
        return f"{label} has a value that isn't one of the options."
    if kind == "value_error":
        # Raised by this codebase's own validators, so the text after
        # pydantic's prefix was written by us, for the person.
        message = str(error.get("msg", ""))
        prefix = "Value error, "
        if message.startswith(prefix) and len(message) > len(prefix):
            return message[len(prefix):]
    if kind.endswith(("_parsing", "_type", "_from_int", "_pattern_mismatch")) or kind.startswith(
        ("int_", "float_", "bool_", "date", "time_", "uuid_", "decimal_", "url_")
    ):
        return f"{label} isn't in the expected format."
    return f"{label} isn't valid."


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    fields: list[dict] = []
    issues: list[str] = []
    unreadable = False

    for error in exc.errors():
        loc = [part for part in error.get("loc", ()) if isinstance(part, str)]
        source = loc[0] if loc and loc[0] in _PARAMETER_SOURCES else None
        names = loc[1:] if source else loc
        kind = str(error.get("type", ""))

        if kind == "json_invalid" or not names:
            # The body as a whole: not JSON, missing, or the wrong JSON type.
            # There is no field to name, and one sentence covers all three.
            unreadable = True
            continue

        issue = _field_issue(error, _field_label(names[-1]))
        if issue not in issues:
            issues.append(issue)
            # Deliberately no "input": see the module docstring.
            fields.append({"field": ".".join(names), "in": source or "body", "issue": issue})

    if not issues:
        message = "We couldn't read that request. Please refresh the page and try again."
    elif len(issues) <= 3:
        message = " ".join(issues)
    else:
        message = " ".join(issues[:3]) + f" And {len(issues) - 3} more."

    details: dict = {"fields": fields}
    if unreadable:
        details["unreadableBody"] = True
    return JSONResponse(status_code=422, content=_error_body(request, "VALIDATION_ERROR", message, details))


# --- a rate limit ----------------------------------------------------------------


def _retry_after_seconds(request: Request, exc: RateLimitExceeded) -> int:
    """Seconds until the limit that was hit lets this caller through again.

    Asks the limiter's own storage when the current window resets (the same
    call slowapi makes for its optional X-RateLimit headers). If that isn't
    available for any reason, the length of the whole window is the honest
    upper bound -- waiting that long always works.
    """
    get_expiry = getattr(getattr(getattr(exc, "limit", None), "limit", None), "get_expiry", None)
    window = max(1, int(get_expiry())) if callable(get_expiry) else 60
    try:
        item, key_args = request.state.view_rate_limit
        reset_at = request.app.state.limiter.limiter.get_window_stats(item, *key_args)[0]
        remaining = math.ceil(reset_at - time.time())
        if 0 < remaining <= window:
            return remaining
    except Exception:
        # Deliberately broad: a handler for one error must not raise another.
        # Whatever went wrong reading the window (a storage backend that is
        # down, a slowapi internal that moved), the answer below is still
        # correct, just less precise.
        logger.debug("Could not read rate-limit window stats; using the full window", exc_info=True)
    return window


def _spoken_wait(seconds: int) -> str:
    """Rounded up, and never more exact than is useful: the Retry-After
    header and details.retryAfterSeconds carry the precise figure."""
    if seconds <= 5:
        return "a few seconds"
    if seconds <= 50:
        return f"about {math.ceil(seconds / 10) * 10} seconds"
    if seconds <= 90:
        return "about a minute"
    minutes = math.ceil(seconds / 60)
    if minutes < 60:
        return f"about {minutes} minutes"
    hours = math.ceil(minutes / 60)
    return "about an hour" if hours == 1 else f"about {hours} hours"


def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """MUST stay a plain `def`. SlowAPIMiddleware (the one enforcing the
    default 200/minute on every route without its own decorator) calls this
    handler synchronously and, finding a coroutine function, silently swaps
    in slowapi's default handler instead -- which would bring back the raw
    "Rate limit exceeded: 200 per 1 minute" for exactly those routes.
    tests/test_error_envelope.py pins this.
    """
    retry_after = _retry_after_seconds(request, exc)
    body = _error_body(
        request,
        "RATE_LIMITED",
        f"Too many attempts in a short time. Please wait {_spoken_wait(retry_after)} and try again.",
        {"retryAfterSeconds": retry_after},
    )
    return JSONResponse(status_code=429, content=body, headers={"Retry-After": str(retry_after)})


# --- anything nobody handled -----------------------------------------------------


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = request_id_of(request)
    # The real exception goes to the log (and to Sentry, tagged with the
    # same reference) and never to the client: str(exc) on a database error
    # can carry a query, a column name or a value.
    logger.exception("Unhandled exception [%s] on %s %s", request_id, request.method, request.url.path)
    error = {
        "code": "INTERNAL_SERVER_ERROR",
        "message": "Something went wrong on our side. Please try again in a moment.",
        "details": {},
        "requestId": request_id,
    }
    return JSONResponse(
        status_code=500,
        # "error" is the key this response has always used and the one the
        # frontend live today reads; "detail" is the envelope every other
        # error uses. Both, so neither side has to deploy first.
        content={"detail": error, "error": error},
        headers={REQUEST_ID_HEADER: request_id, **SECURITY_HEADERS},
    )


def install_error_handling(app: FastAPI) -> None:
    """Registers the four handlers. RequestIdMiddleware is added separately,
    last, in main.py -- see the note there on why order matters."""
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
