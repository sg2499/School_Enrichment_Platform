"""Raising an error a person will read.

`message` is user-facing copy: the frontend shows it to the person as
written (frontend/lib/errors.ts, describeError). Only the server knows that it was the
transfer date, or the third attempt, so only the server can say so.

A message here is therefore written to the same standard as a label in the
UI (3 Oct 2026, after an audit of all 186 call sites found "Start 2FA setup
first by calling /2fa/setup.", "schoolId is required for SUPER_ADMIN." and
"Please contact the admin." -- sent to admins):

  * It says what happened and, where there is one, what to do next.
  * It uses the words on the screen, never the names in the code: "subject"
    not "board course", "Choose a school first" not "schoolId is required",
    "sign in" not "log in" (the button says Sign In).
  * It names the right person to ask for the reader's role -- see
    who_can_help(). A student is sent to their teacher; an admin is never
    told to "contact the admin".
  * It never contains an identifier, a route, an enum value or a field name.
    Anything a program needs goes in `details`.

`code` is for programs and is stable; rewording a message never needs a
frontend change. The reference the person can quote (requestId) is added to
every error response by app/core/error_handling.py.

One deliberate exception to "words on the screen": routes_platform.py's
operator-key errors. That endpoint is called from a terminal by the platform
operator, never from a page, and its messages are written for that reader.
"""
from fastapi import HTTPException


def api_error(status_code: int, code: str, message: str, details: dict | None = None):
    raise HTTPException(status_code=status_code, detail={"code": code, "message": message, "details": details or {}})


def who_can_help(role: str | None) -> str:
    """Who someone in this role goes to when they can't fix it themselves.

    Mirrors who actually holds the power in the product: a school admin
    manages that school's teacher and student accounts (routes_roster.py),
    and only a Super Admin manages admin accounts. Returned as a phrase that
    reads after "ask ..." / "contact ...".
    """
    if role == "STUDENT":
        return "your teacher or school admin"
    if role == "TEACHER":
        return "your school admin"
    if role in ("ADMIN", "SUPER_ADMIN"):
        return "your platform administrator"
    return "your school"


def status_words(status: str | None) -> str:
    """IN_REVIEW -> "In Review". Stored status values are upper snake case;
    the interface shows them as words, and so should a sentence about them."""
    return (status or "").replace("_", " ").strip().title() or "Unknown"
