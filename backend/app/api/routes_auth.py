"""Login, session, profile-photo, and 2FA endpoints.

Retained from MathPath's app/api/routes_auth.py (Phase 0 audit, "Retain
as-is" bucket) -- this is generic auth surface, no Abacus-specific logic.
Only the import paths and the Student/Teacher payload shape (via
auth_service.user_payload) changed.

Profile photos are stored as base64 data URLs in the DB (not on disk) --
deliberate, since Render's default web-service filesystem is ephemeral.
This is fine for small (<350KB) profile images; it is NOT the pattern for
real content/answer-key storage, which needs the signed-token + persistent-
disk layer described in PHASE_0_CODE_AUDIT.md's Replace bucket (later
phase, not built yet).
"""
import base64
import json
import re
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.cookies import (
    CSRF_COOKIE_NAME,
    clear_session_cookie,
    read_session_token,
    set_csrf_cookie,
    set_session_cookie,
)
from app.core.errors import api_error
from app.core.rate_limit import get_real_client_ip, limiter
from app.core.security import (
    create_access_token,
    decode_token,
    decode_two_factor_challenge_token,
    hash_password,
    password_fingerprint,
    strong_password_issue,
    two_factor_challenge_password_claim,
    verify_password,
)
from app.core.totp import (
    generate_backup_codes,
    generate_totp_secret,
    totp_provisioning_uri,
    totp_qr_code_data_url,
    verify_totp_code,
)
from app.database import get_db
from app.dependencies import MANDATORY_2FA_ROLES, get_current_session_id, get_current_user, require_roles
from app.models import Student, Teacher, User, UserSession
from app.services.audit_service import log_audit_event
from app.services.auth_service import (
    LOCKOUT_DURATION_MINUTES,
    export_user_data,
    force_logout_user,
    is_account_locked,
    login,
    record_failed_attempt,
    reset_lockout,
    user_payload,
)
from app.services.session_service import (
    list_active_sessions,
    revoke_all_sessions_for_user,
    revoke_session,
    start_session,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    identifier: str
    password: str


class ChangePasswordRequest(BaseModel):
    currentPassword: str
    newPassword: str
    # Stay signed in on this device afterwards (every other device is still
    # signed out). See change_password() below.
    keepSignedIn: bool = False


class TwoFactorEnableRequest(BaseModel):
    code: str


class TwoFactorDisableRequest(BaseModel):
    password: str


class TwoFactorVerifyLoginRequest(BaseModel):
    challengeToken: str
    code: str


@router.post("/login")
# A6 fix (30 Sep 2026 review): raised from 5/minute now that rate_limit.py
# keys on the real caller IP instead of a shared proxy hop (see
# get_real_client_ip's docstring) -- raising the number alone, without that
# key fix, would have just let more junk logins through the same shared
# bucket. 60/minute is deliberately generous: a whole class signing in from
# one school router/NAT at the start of a period is normal legitimate
# traffic now that it isn't lumped in with every other school's traffic too.
@limiter.limit("60/minute")
def login_route(request: Request, response: Response, payload: LoginRequest, db: Session = Depends(get_db)):
    result = login(db, payload.identifier, payload.password, request=request)
    if result.get("twoFactorRequired"):
        return result

    # Session lives in an httpOnly cookie, not the response body -- returning
    # the raw token in JSON here would defeat the point of httpOnly.
    set_session_cookie(response, result["user"]["role"], result["accessToken"])
    set_csrf_cookie(response)
    return {"tokenType": result["tokenType"], "user": result["user"]}


@router.get("/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return user_payload(db, user)


@router.get("/me/export")
@limiter.limit("5/hour")
def export_my_data(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Self-service "download my data" (2026-08-19, data protection Task
    #61) -- every authenticated role can pull a JSON export of their own
    account, profile, recent login sessions, and recent account activity.
    Rate-limited (unlike most GETs in this file) because it's a heavier
    query than a normal request and there's no legitimate reason to call it
    often. See auth_service.py's export_user_data() for exactly what is and
    isn't included, and why."""
    data = export_user_data(db, user)
    log_audit_event(db, "auth.data_export_requested", user_id=user.id, request=request)
    db.commit()
    return data


def safe_profile_photo_name(filename: str, prefix: str) -> str:
    suffix = Path(filename or "profile.png").suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
        api_error(400, "INVALID_FILE", "Please upload a JPG, PNG or WEBP image.")
    SafePrefix = re.sub(r"[^a-zA-Z0-9_-]", "-", prefix or "profile")[:80]
    Stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    return f"{SafePrefix}-{Stamp}{suffix}"


# Maps the accepted file extension to the format string Pillow reports for
# a genuinely decoded file of that type -- used by the content-sniffing
# check below, not just the filename check in safe_profile_photo_name().
_ALLOWED_IMAGE_FORMATS = {"jpg": "JPEG", "jpeg": "JPEG", "png": "PNG", "webp": "WEBP"}


def save_profile_photo(upload: UploadFile, prefix: str) -> str:
    FileName = safe_profile_photo_name(upload.filename or "profile.png", prefix)
    Suffix = Path(FileName).suffix.lower().lstrip(".")
    MimeType = "image/jpeg" if Suffix in {"jpg", "jpeg"} else f"image/{Suffix or 'png'}"
    Content = upload.file.read()
    if not Content:
        api_error(400, "INVALID_FILE", "That photo file is empty. Please choose another one.")
    # Raised from 350KB (19 Aug 2026, Shailesh: "we never know what image the
    # user is gonna upload so we need to keep that in mind always" -- a raw
    # phone-camera photo is routinely 3-10MB, and this endpoint was rejecting
    # every one of them with a message that claimed compression had already
    # happened when none ever did). The real fix is client-side: the upload
    # UI (components/UserMenu.tsx, via lib/imageCompression.ts) now resizes
    # and re-encodes any image to a JPEG comfortably under 300KB in the
    # browser before it's ever sent here, so this limit should almost never
    # trigger in normal use. It stays as a generous backend safety net --
    # never trust client-side enforcement alone -- sized well above what any
    # normally-compressed upload should produce, not as the primary gate.
    if len(Content) > 2_000_000:
        api_error(400, "FILE_TOO_LARGE", "That photo is too large. Please choose one under 2 MB.")

    # Content-sniffing, not just extension-checking (2026-08-19 security
    # hardening): safe_profile_photo_name() above only looks at the claimed
    # filename, which is trivial to spoof (rename anything to photo.jpg).
    # Actually decoding the bytes with Pillow -- rather than just checking a
    # magic-byte signature -- proves the upload is a real, well-formed image
    # of the claimed format, not an arbitrary file wearing an image
    # extension. Combined with the existing Content-Type: image/... plus
    # X-Content-Type-Options: nosniff response headers on the serving side
    # (get_profile_photo below), this closes the loop end to end: what gets
    # stored is provably a real image, and what gets served can't be
    # MIME-sniffed into executing as anything else even if it somehow
    # weren't.
    try:
        with Image.open(BytesIO(Content)) as probe:
            probe.verify()
        # verify() invalidates the Image object for further use, so re-open
        # a fresh copy from the same bytes just to read the detected format.
        with Image.open(BytesIO(Content)) as recheck:
            ActualFormat = recheck.format
    except (UnidentifiedImageError, OSError, ValueError):
        api_error(400, "INVALID_FILE", "That file isn't a valid image. Please upload a JPG, PNG or WEBP photo.")

    ExpectedFormat = _ALLOWED_IMAGE_FORMATS.get(Suffix)
    if ActualFormat != ExpectedFormat:
        api_error(
            400,
            "INVALID_FILE",
            f"This file is named .{Suffix} but it is actually {ActualFormat or 'not a recognised image'}. "
            "Please upload a JPG, PNG or WEBP photo.",
        )

    # A14 fix (30 Sep 2026 review): uploaded photos kept their original
    # EXIF/GPS metadata server-side -- the browser-side compression path
    # (lib/imageCompression.ts) already strips it, but nothing enforced that
    # server-side, so a client that skipped or bypassed it would still get
    # its metadata stored and served back out. Re-opening the already-
    # verified image, baking in its EXIF orientation as real pixels
    # (exif_transpose, so photos taken in portrait don't end up sideways),
    # and re-saving without passing exif= at all discards that metadata
    # unconditionally, regardless of what the client did or didn't do.
    with Image.open(BytesIO(Content)) as Source:
        Normalized = ImageOps.exif_transpose(Source)
        if MimeType == "image/jpeg" and Normalized.mode in ("RGBA", "P"):
            Normalized = Normalized.convert("RGB")
        OutputBuffer = BytesIO()
        Normalized.save(OutputBuffer, format=ActualFormat)
        Content = OutputBuffer.getvalue()

    Encoded = base64.b64encode(Content).decode("ascii")
    return f"data:{MimeType};base64,{Encoded}"


def _stored_photo_for_user(db: Session, TargetUser: User) -> str | None:
    if TargetUser.role == "STUDENT":
        StudentProfile = db.query(Student).filter(Student.user_id == TargetUser.id).first()
        return (StudentProfile.photo_url if StudentProfile else None) or TargetUser.photo_url
    if TargetUser.role == "TEACHER":
        TeacherProfile = db.query(Teacher).filter(Teacher.user_id == TargetUser.id).first()
        return (TeacherProfile.photo_url if TeacherProfile else None) or TargetUser.photo_url
    return TargetUser.photo_url


def _decode_data_url(PhotoValue: str) -> tuple[bytes, str]:
    if not PhotoValue or not PhotoValue.startswith("data:") or ";base64," not in PhotoValue:
        api_error(404, "PHOTO_NOT_FOUND", "Profile photo not found.")
    Header, Encoded = PhotoValue.split(",", 1)
    MimeType = Header.replace("data:", "").replace(";base64", "") or "image/png"
    try:
        return base64.b64decode(Encoded), MimeType
    except Exception:
        api_error(404, "PHOTO_NOT_FOUND", "Profile photo not found.")


def _requester_school_id(db: Session, user: User) -> str | None:
    """The school the requesting user themselves belongs to, or None for
    SUPER_ADMIN (platform-wide) or a role/account with no school profile
    row at all. Used only for the same-school photo-access check below --
    never for authorization decisions elsewhere, which already have their
    own dedicated helpers (routes_roster.py's _resolve_school, etc.)."""
    if user.role == "STUDENT":
        profile = db.query(Student).filter(Student.user_id == user.id).first()
        return profile.school_id if profile else None
    if user.role == "TEACHER":
        profile = db.query(Teacher).filter(Teacher.user_id == user.id).first()
        return profile.school_id if profile else None
    if user.role == "ADMIN":
        from app.models import SchoolAdmin

        profile = db.query(SchoolAdmin).filter(SchoolAdmin.user_id == user.id).first()
        return profile.school_id if profile else None
    return None  # SUPER_ADMIN


@router.get("/profile-photo/{user_id}")
def get_profile_photo(user_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    TargetUser = db.query(User).filter(User.id == user_id).first()
    if not TargetUser:
        api_error(404, "PHOTO_NOT_FOUND", "Profile photo not found.")
    # A4 fix (30 Sep 2026 security/DPDP review): this only checked that
    # *someone* was logged in, not who was asking about whom -- proven by
    # test, a STUDENT at school B could fetch a school-A student's photo.
    # Allowed: viewing your own photo, SUPER_ADMIN (platform-wide), or
    # same-school staff/students viewing someone else in their own school.
    # Cross-school is blocked even for ADMIN/TEACHER.
    if user.id != TargetUser.id and user.role != "SUPER_ADMIN":
        requester_school_id = _requester_school_id(db, user)
        target_school_id = _requester_school_id(db, TargetUser)
        if not requester_school_id or requester_school_id != target_school_id:
            api_error(404, "PHOTO_NOT_FOUND", "Profile photo not found.")
    PhotoValue = _stored_photo_for_user(db, TargetUser)
    if not PhotoValue:
        api_error(404, "PHOTO_NOT_FOUND", "Profile photo not found.")
    ImageBytes, MimeType = _decode_data_url(PhotoValue)
    return Response(
        content=ImageBytes,
        media_type=MimeType,
        headers={
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/profile-photo")
def upload_profile_photo(
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    PhotoUrl: str

    if user.role == "STUDENT":
        StudentProfile = db.query(Student).filter(Student.user_id == user.id).first()
        if not StudentProfile:
            api_error(404, "NOT_FOUND", "Your student profile isn't set up yet. Please ask your teacher or school admin.")
        PhotoUrl = save_profile_photo(file, StudentProfile.student_code)
        StudentProfile.photo_url = PhotoUrl
    elif user.role == "TEACHER":
        TeacherProfile = db.query(Teacher).filter(Teacher.user_id == user.id).first()
        if not TeacherProfile:
            api_error(404, "NOT_FOUND", "Your teacher profile isn't set up yet. Please ask your school admin.")
        PhotoUrl = save_profile_photo(file, TeacherProfile.teacher_code)
        TeacherProfile.photo_url = PhotoUrl
    else:
        PhotoUrl = save_profile_photo(file, user.email or user.phone or user.id)
        user.photo_url = PhotoUrl

    log_audit_event(db, "auth.profile_photo.updated", user_id=user.id, request=request)
    db.commit()
    db.refresh(user)
    PublicPhotoUrl = f"/api/auth/profile-photo/{user.id}?v={datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}"
    UpdatedUser = user_payload(db, user)
    UpdatedUser["profilePhotoUrl"] = PublicPhotoUrl
    return {"updated": True, "photoUrl": PublicPhotoUrl, "user": UpdatedUser}


def _own_account_key(request: Request) -> str:
    """Rate-limit key for something a signed-in person does to their OWN
    account: the account, not the network address.

    The address is the wrong key for change-password. A classroom is thirty
    students behind one school connection, and since 3 Oct 2026 every one of
    them goes through this endpoint the first time they sign in: at the old
    5-a-minute-per-address, the sixth student was refused and left unable to
    do the one thing the server would let them do. (Login was raised for the
    same shared-connection reason on 30 Sep.) What the limit is FOR is
    stopping guesses at one account's current password, and that is a
    per-account matter.

    The account is read from a token whose signature verifies, so nobody can
    spend another account's allowance. No valid token: the address, as
    before -- the request is about to be refused with a 401 anyway.
    """
    token = None
    authorization = request.headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not token:
        token = read_session_token(request)
    payload = decode_token(token) if token else None
    subject = payload.get("sub") if payload else None
    return f"account:{subject}" if subject else get_real_client_ip(request)


@router.post("/change-password")
# Two limits. Per account: enough for someone to get it wrong a few times,
# far too few to guess a current password. Per address: a ceiling that a
# whole class signing in for the first time does not reach.
@limiter.limit("10/minute", key_func=_own_account_key)
@limiter.limit("120/minute")
def change_password(
    request: Request,
    response: Response,
    payload: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Replaces the caller's own password.

    Every session of the account ends when its password changes: a token
    says which password it was issued under, and stops matching the moment
    the stored hash changes (password_fingerprint, core/security.py). That
    is right when someone changes a password because they fear it is known.
    It was wrong for the one case nearly every teacher and student meets
    first -- replacing the password the school issued them -- where it meant:
    sign in, choose a password, get signed out, sign in again.

    `keepSignedIn` (3 Oct 2026) keeps the one session that made this request
    and ends all the others: this browser is handed a fresh token for the
    same session, issued under the new password, and every other session row
    is revoked. Tokens this session held before the change are as dead as
    anyone else's. It applies only to a browser session (a cookie carrying a
    session id). A script holding a bearer token is not handed a new one in
    a response body, and a token with no session id cannot be told apart
    from the account's other tokens -- both are simply signed out, as
    before, and the response says so (`staySignedIn: false`).
    """
    # Neither is stripped: sign-in compares exactly what is typed, so this
    # does too. (A new password with a space at either end is refused by
    # strong_password_issue() rather than quietly altered.)
    CurrentPassword = payload.currentPassword or ""
    NewPassword = payload.newPassword or ""

    if not CurrentPassword.strip():
        api_error(400, "VALIDATION_ERROR", "Enter your current password.")
    if not NewPassword.strip():
        api_error(400, "VALIDATION_ERROR", "Enter a new password.")
    PasswordIssue = strong_password_issue(NewPassword)
    if PasswordIssue:
        api_error(400, "VALIDATION_ERROR", PasswordIssue)
    if not verify_password(CurrentPassword, user.password_hash):
        api_error(400, "INVALID_PASSWORD", "Your current password isn't right. Please try again.")
    # "Change" has to mean change. Without this, the forced first change
    # could be satisfied by typing the issued password again -- the flag
    # would clear and the password everyone else has seen would stay. The
    # current password has just been proven, so comparing the two strings
    # says the same thing a third bcrypt run would, without the quarter
    # second that costs on a single worker.
    if NewPassword == CurrentPassword:
        api_error(400, "VALIDATION_ERROR", "Choose a password that's different from your current one.")

    # The app's own clock, not the database's (this used to be func.now()),
    # so it is read from the same clock a token's `iat` is.
    ChangedAt = datetime.now(timezone.utc)
    # Held as its own value for the same reason login() holds the hash it
    # verified: the commit below expires `user`, and the fresh token must be
    # bound to the password set HERE, not to whatever a reload returns.
    NewHash = hash_password(NewPassword)
    user.password_hash = NewHash
    user.password_changed_at = ChangedAt
    # A1 fix: clears the forced-change gate the moment someone actually
    # takes ownership of the password -- see dependencies.py's
    # MUST_CHANGE_PASSWORD_ROLES check.
    user.must_change_password = False

    SessionId = getattr(request.state, "session_id", None)
    UsedCookie = bool(getattr(request.state, "used_cookie_auth", False))
    StaySignedIn = bool(payload.keepSignedIn and SessionId and UsedCookie)
    if StaySignedIn:
        # Every other device goes. Their tokens already fail (issued under
        # the old password); revoking the rows keeps the list of signed-in
        # devices true.
        db.query(UserSession).filter(
            UserSession.user_id == user.id,
            UserSession.id != SessionId,
            UserSession.revoked_at.is_(None),
        ).update({"revoked_at": ChangedAt}, synchronize_session=False)
    else:
        revoke_all_sessions_for_user(db, user.id)

    log_audit_event(
        db,
        "auth.password_changed",
        user_id=user.id,
        request=request,
        details={"keptThisSession": StaySignedIn},
    )
    db.commit()

    if not StaySignedIn:
        # The cookie it came in on now carries a dead token; removing it
        # saves the browser a refused request to find that out.
        if UsedCookie:
            clear_session_cookie(response, user.role)
        return {
            "updated": True,
            "staySignedIn": False,
            "message": "Your password has been changed. Please sign in again with the new one.",
        }

    # Issued after the commit, so it is never handed out for a change that
    # did not happen, and under the new password, so it is the one token of
    # this account that still works.
    set_session_cookie(
        response,
        user.role,
        create_access_token(user.id, user.role, session_id=SessionId, password_hash=NewHash),
    )
    return {
        "updated": True,
        "staySignedIn": True,
        "message": "Your password has been changed.",
        "user": user_payload(db, user),
    }


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    user: User = Depends(get_current_user),
    session_id: str | None = Depends(get_current_session_id),
    db: Session = Depends(get_db),
):
    """Clear only the current role's session cookie (plus the shared CSRF
    cookie) -- what a normal "Sign Out" button should call. Distinct from
    /logout-all-sessions below, which revokes every token issued anywhere.
    Also revokes this one device's UserSession row (if the token carried a
    "sid") so it drops off the Security Settings sessions list immediately
    instead of lingering there until its natural idle timeout.
    """
    if session_id:
        revoke_session(db, session_id)
    log_audit_event(db, "auth.logout", user_id=user.id, request=request)
    db.commit()
    clear_session_cookie(response, user.role)
    response.delete_cookie(CSRF_COOKIE_NAME, path="/")
    return {"loggedOut": True}


@router.post("/logout-all-sessions")
@limiter.limit("5/minute")
def logout_all_sessions(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Invalidate every access token already issued to the current user, including this one."""
    force_logout_user(db, user, request=request)
    return {"updated": True, "message": "You've been signed out of all devices. Please sign in again."}


def _session_summary(session, current_session_id: str | None) -> dict:
    return {
        "id": session.id,
        "ipAddress": session.ip_address,
        "userAgent": session.user_agent,
        "createdAt": session.created_at.isoformat() if session.created_at else None,
        "lastSeenAt": session.last_seen_at.isoformat() if session.last_seen_at else None,
        "isCurrent": session.id == current_session_id,
    }


@router.get("/sessions")
def list_sessions(
    user: User = Depends(get_current_user),
    session_id: str | None = Depends(get_current_session_id),
    db: Session = Depends(get_db),
):
    """The "where am I logged in" list backing the Security Settings page --
    every device/browser with a non-revoked, non-expired session for this
    account, most recently active first."""
    sessions = list_active_sessions(db, user.id)
    return {"sessions": [_session_summary(s, session_id) for s in sessions]}


@router.delete("/sessions/{target_session_id}")
def delete_session(
    request: Request,
    response: Response,
    target_session_id: str,
    user: User = Depends(get_current_user),
    session_id: str | None = Depends(get_current_session_id),
    db: Session = Depends(get_db),
):
    """Sign out one specific device without touching any of the user's other
    active sessions -- the middle ground between the single-device /logout
    (this device only, no id needed) and /logout-all-sessions (every
    device). Ownership is checked server-side (a user can only ever see and
    revoke their own sessions via list_active_sessions/this lookup); there
    is deliberately no admin-facing "revoke another user's session" surface
    yet -- that's a different feature (support/incident tooling) with its
    own authorization story, not a natural extension of this self-service
    one."""
    owned_session_ids = {s.id for s in list_active_sessions(db, user.id)}
    if target_session_id not in owned_session_ids:
        api_error(404, "NOT_FOUND", "That device is no longer signed in.")
    revoke_session(db, target_session_id)
    log_audit_event(
        db, "auth.session.revoked", user_id=user.id, request=request,
        details={"sessionId": target_session_id, "wasCurrentDevice": target_session_id == session_id},
    )
    db.commit()
    if target_session_id == session_id:
        # Revoking the device you're currently on -- clear its cookies too,
        # same as /logout, so the browser doesn't keep sending a token that
        # the next request would just reject anyway.
        clear_session_cookie(response, user.role)
        response.delete_cookie(CSRF_COOKIE_NAME, path="/")
    return {"updated": True}


# ---------------------------------------------------------------------------
# Two-factor authentication (TOTP). Setup/enable/disable gated to
# ADMIN/SUPER_ADMIN -- the highest-value account gets the strongest
# protection first. verify-login itself is not role-gated so it keeps
# working correctly if 2FA is ever extended to other roles later.
# ---------------------------------------------------------------------------

@router.post("/2fa/setup")
def two_factor_setup(
    request: Request,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    """Generate a new TOTP secret and return it as a QR code, but do not enable 2FA yet.

    The secret is stored as "pending" until confirmed via a correct code at
    POST /2fa/enable -- prevents a user from locking themselves into a
    broken 2FA setup (e.g. mis-scanned QR code) with no way back in.
    """
    Secret = generate_totp_secret()
    user.totp_pending_secret = Secret
    log_audit_event(db, "auth.2fa.setup_started", user_id=user.id, request=request)
    db.commit()
    AccountLabel = user.email or user.phone or user.full_name or user.id
    Uri = totp_provisioning_uri(Secret, AccountLabel)
    return {
        "secret": Secret,
        "qrCodeDataUrl": totp_qr_code_data_url(Uri),
        "otpauthUri": Uri,
    }


@router.post("/2fa/enable")
def two_factor_enable(
    request: Request,
    payload: TwoFactorEnableRequest,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    if not user.totp_pending_secret:
        api_error(400, "NO_PENDING_SETUP", "Your two-factor setup wasn't started or has been reset. Start the setup again to get a new QR code.")
    if not verify_totp_code(user.totp_pending_secret, payload.code):
        api_error(400, "INVALID_CODE", "That code didn't match. Check your authenticator app and try again.")

    BackupCodes = generate_backup_codes()
    user.totp_secret = user.totp_pending_secret
    user.totp_pending_secret = None
    user.totp_enabled = True
    user.totp_backup_codes_json = json.dumps([hash_password(code) for code in BackupCodes])
    log_audit_event(db, "auth.2fa.enabled", user_id=user.id, request=request)
    db.commit()
    return {
        "updated": True,
        "message": "Two-factor authentication is now enabled.",
        # Shown exactly once -- only the hashes are ever stored.
        "backupCodes": BackupCodes,
    }


@router.post("/2fa/disable")
# A8 fix (30 Sep 2026 review): had no rate limit at all before -- a stolen
# session could otherwise brute-force the account password (this endpoint's
# real gate) with no friction.
@limiter.limit("10/minute")
def two_factor_disable(
    request: Request,
    payload: TwoFactorDisableRequest,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    # 2026-08-19 security hardening, Shailesh: 2FA is mandatory (not just
    # available) for ADMIN/SUPER_ADMIN, so self-service disable is blocked
    # for exactly the roles get_current_user() also requires it for --
    # otherwise "mandatory" would only be true until someone clicked one
    # button. A genuinely lost-device case (no authenticator, no backup
    # codes left) is a support/DB-level recovery, not a self-service flow.
    if user.role in MANDATORY_2FA_ROLES:
        api_error(
            400,
            "TWO_FACTOR_MANDATORY",
            "Two-factor authentication is required for admin accounts and can't be turned off. "
            "If you've lost your authenticator and your backup codes, contact your platform administrator.",
        )
    if not verify_password(payload.password or "", user.password_hash):
        api_error(400, "INVALID_PASSWORD", "That password isn't right. Please try again.")
    user.totp_secret = None
    user.totp_pending_secret = None
    user.totp_enabled = False
    user.totp_backup_codes_json = None
    log_audit_event(db, "auth.2fa.disabled", user_id=user.id, request=request)
    db.commit()
    return {"updated": True, "message": "Two-factor authentication has been disabled."}


@router.post("/2fa/backup-codes/regenerate")
# A8 fix (30 Sep 2026 review): explicitly called out in the review -- this
# had no rate limit and no lockout, so a stolen session could brute-force
# the account password (this endpoint's real gate) with no friction at all.
@limiter.limit("10/minute")
def two_factor_regenerate_backup_codes(
    request: Request,
    payload: TwoFactorDisableRequest,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    """Invalidate every existing backup code and issue a fresh set.

    Password-gated the same way /2fa/disable is (reuses the same request
    shape) -- backup codes are a password-equivalent bypass of the TOTP step,
    so reissuing them deserves the same confirmation as turning 2FA off.
    """
    if not user.totp_enabled:
        api_error(400, "NOT_ENABLED", "Two-factor authentication isn't turned on for this account yet.")
    if not verify_password(payload.password or "", user.password_hash):
        api_error(400, "INVALID_PASSWORD", "That password isn't right. Please try again.")
    BackupCodes = generate_backup_codes()
    user.totp_backup_codes_json = json.dumps([hash_password(code) for code in BackupCodes])
    log_audit_event(db, "auth.2fa.backup_codes_regenerated", user_id=user.id, request=request)
    db.commit()
    return {
        "updated": True,
        "message": "New backup codes generated. Your old backup codes no longer work.",
        "backupCodes": BackupCodes,
    }


@router.post("/2fa/verify-login")
@limiter.limit("10/minute")
def two_factor_verify_login(request: Request, response: Response, payload: TwoFactorVerifyLoginRequest, db: Session = Depends(get_db)):
    UserId = decode_two_factor_challenge_token(payload.challengeToken)
    if not UserId:
        api_error(401, "UNAUTHORIZED", "This verification step has expired. Please sign in again.")

    user = db.get(User, UserId)
    if not user or not user.is_active or not user.totp_enabled:
        api_error(401, "UNAUTHORIZED", "This verification step has expired. Please sign in again.")

    # The password step was passed against one particular password. If that
    # password has since been changed or reset, this second step is the tail
    # of a sign-in that no longer counts: whoever started it has to start
    # again, with the password the account has now. (A challenge issued
    # before this claim existed has none, and at five minutes' life there
    # are none left a few minutes after this ships.) Held as a value: the
    # commits below expire `user`, and the session is issued under the
    # password this sign-in actually proved.
    PasswordHash = user.password_hash
    ChallengePassword = two_factor_challenge_password_claim(payload.challengeToken)
    if ChallengePassword and ChallengePassword != password_fingerprint(PasswordHash):
        api_error(401, "UNAUTHORIZED", "This verification step has expired. Please sign in again.")

    # A9 fix (30 Sep 2026 review): this step previously had no per-account
    # failure limit at all beyond a shared 10/minute IP limit -- an attacker
    # who already has the password could brute-force the 2FA step (or the
    # backup codes) with no meaningful friction. Reuses the exact same
    # lockout mechanism as a wrong password (record_failed_attempt/
    # is_account_locked/reset_lockout) so both attack paths against an
    # account are covered by one consistent policy.
    if is_account_locked(user):
        log_audit_event(db, "auth.login.2fa_blocked_locked", user_id=user.id, request=request)
        db.commit()
        api_error(
            423,
            "ACCOUNT_LOCKED",
            "Too many incorrect sign-in attempts. This account is locked for a short while. "
            "Please try again in a few minutes.",
        )

    Code = (payload.code or "").strip()

    def _issue_session(event_type: str) -> dict:
        reset_lockout(user)
        session_id = start_session(db, user, request=request)
        log_audit_event(db, event_type, user_id=user.id, request=request)
        db.commit()
        token = create_access_token(user.id, user.role, session_id=session_id, password_hash=PasswordHash)
        set_session_cookie(response, user.role, token)
        set_csrf_cookie(response)
        return {"tokenType": "Bearer", "user": user_payload(db, user)}

    # A9 replay guard: valid_window=1 means a code stays acceptable across
    # three 30-second steps, so without this, the *same* correct code could
    # be replayed by anyone who observed it (e.g. shoulder-surfing, a
    # network capture) for up to a minute after the legitimate holder used
    # it. Scoped to an actual TOTP match only -- a backup code is a
    # completely separate, single-use secret with no relationship to the
    # TOTP step, and must still be checked below even when the current step
    # was already consumed by an earlier TOTP login.
    CurrentStep = int(datetime.now(timezone.utc).timestamp() // 30)
    if verify_totp_code(user.totp_secret, Code):
        if user.totp_last_used_step is not None and CurrentStep <= user.totp_last_used_step:
            log_audit_event(db, "auth.login.2fa_replay_blocked", user_id=user.id, request=request)
            db.commit()
            api_error(401, "INVALID_CODE", "That code didn't match. Check your authenticator app and try again.")
        user.totp_last_used_step = CurrentStep
        return _issue_session("auth.login.success")

    StoredHashes = json.loads(user.totp_backup_codes_json or "[]")
    for Index, StoredHash in enumerate(StoredHashes):
        if verify_password(Code, StoredHash):
            del StoredHashes[Index]
            user.totp_backup_codes_json = json.dumps(StoredHashes)
            return _issue_session("auth.login.success_via_backup_code")

    locked = record_failed_attempt(db, user, request, "auth.login.2fa_failed")
    if locked:
        api_error(
            423,
            "ACCOUNT_LOCKED",
            f"Too many incorrect sign-in attempts. This account is locked for {LOCKOUT_DURATION_MINUTES} minutes. "
            "Please try again after that.",
        )
    api_error(401, "INVALID_CODE", "That code didn't match. Check your authenticator app and try again.")


@router.get("/ping")
def auth_ping(user: User = Depends(get_current_user)):
    """Heartbeat -- depending on get_current_user triggers the LRU-debounced
    last_active_at background update.
    """
    return {"status": "ok", "user_id": user.id}
