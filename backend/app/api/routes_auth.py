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
from datetime import datetime
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.cookies import (
    CSRF_COOKIE_NAME,
    clear_session_cookie,
    set_csrf_cookie,
    set_session_cookie,
)
from app.core.errors import api_error
from app.core.rate_limit import limiter
from app.core.security import (
    create_access_token,
    decode_two_factor_challenge_token,
    hash_password,
    strong_password_issue,
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
from app.models import Student, Teacher, User
from app.services.audit_service import log_audit_event
from app.services.auth_service import export_user_data, force_logout_user, login, user_payload
from app.services.session_service import (
    list_active_sessions,
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


class TwoFactorEnableRequest(BaseModel):
    code: str


class TwoFactorDisableRequest(BaseModel):
    password: str


class TwoFactorVerifyLoginRequest(BaseModel):
    challengeToken: str
    code: str


@router.post("/login")
@limiter.limit("5/minute")
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
        api_error(400, "INVALID_FILE", "Only JPG, PNG, and WEBP images are allowed.")
    SafePrefix = re.sub(r"[^a-zA-Z0-9_-]", "-", prefix or "profile")[:80]
    Stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
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
        api_error(400, "INVALID_FILE", "Profile photo file is empty.")
    if len(Content) > 350_000:
        api_error(400, "FILE_TOO_LARGE", "Profile photo must be under 350 KB after compression.")

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
        api_error(400, "INVALID_FILE", "That file isn't a valid image. Please upload a real JPG, PNG, or WEBP photo.")

    ExpectedFormat = _ALLOWED_IMAGE_FORMATS.get(Suffix)
    if ActualFormat != ExpectedFormat:
        api_error(
            400,
            "INVALID_FILE",
            f"This file's actual contents ({ActualFormat or 'unrecognized'}) don't match its "
            f".{Suffix} extension. Please upload a genuine JPG, PNG, or WEBP file.",
        )

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


@router.get("/profile-photo/{user_id}")
def get_profile_photo(user_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    TargetUser = db.query(User).filter(User.id == user_id).first()
    if not TargetUser:
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
            api_error(404, "NOT_FOUND", "Student profile not found.")
        PhotoUrl = save_profile_photo(file, StudentProfile.student_code)
        StudentProfile.photo_url = PhotoUrl
    elif user.role == "TEACHER":
        TeacherProfile = db.query(Teacher).filter(Teacher.user_id == user.id).first()
        if not TeacherProfile:
            api_error(404, "NOT_FOUND", "Teacher profile not found.")
        PhotoUrl = save_profile_photo(file, TeacherProfile.teacher_code)
        TeacherProfile.photo_url = PhotoUrl
    else:
        PhotoUrl = save_profile_photo(file, user.email or user.phone or user.id)
        user.photo_url = PhotoUrl

    log_audit_event(db, "auth.profile_photo.updated", user_id=user.id, request=request)
    db.commit()
    db.refresh(user)
    PublicPhotoUrl = f"/api/auth/profile-photo/{user.id}?v={datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}"
    UpdatedUser = user_payload(db, user)
    UpdatedUser["profilePhotoUrl"] = PublicPhotoUrl
    return {"updated": True, "photoUrl": PublicPhotoUrl, "user": UpdatedUser}


@router.post("/change-password")
@limiter.limit("5/minute")
def change_password(
    request: Request,
    payload: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    CurrentPassword = (payload.currentPassword or "").strip()
    NewPassword = (payload.newPassword or "").strip()

    if not CurrentPassword:
        api_error(400, "VALIDATION_ERROR", "Current password is required.")
    if not NewPassword:
        api_error(400, "VALIDATION_ERROR", "New password is required.")
    PasswordIssue = strong_password_issue(NewPassword)
    if PasswordIssue:
        api_error(400, "VALIDATION_ERROR", PasswordIssue)
    if not verify_password(CurrentPassword, user.password_hash):
        api_error(400, "INVALID_PASSWORD", "Current password is incorrect.")

    from sqlalchemy.sql import func
    user.password_hash = hash_password(NewPassword)
    user.password_changed_at = func.now()
    log_audit_event(db, "auth.password_changed", user_id=user.id, request=request)
    db.commit()
    return {"updated": True, "message": "Password updated successfully."}


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
    return {"updated": True, "message": "You have been signed out of all sessions. Please log in again."}


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
        api_error(404, "NOT_FOUND", "Session not found.")
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
        api_error(400, "NO_PENDING_SETUP", "Start 2FA setup first by calling /2fa/setup.")
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
            "Two-factor authentication is mandatory for this account and cannot be disabled. "
            "If you've lost access to your authenticator, contact your platform administrator.",
        )
    if not verify_password(payload.password or "", user.password_hash):
        api_error(400, "INVALID_PASSWORD", "Password is incorrect.")
    user.totp_secret = None
    user.totp_pending_secret = None
    user.totp_enabled = False
    user.totp_backup_codes_json = None
    log_audit_event(db, "auth.2fa.disabled", user_id=user.id, request=request)
    db.commit()
    return {"updated": True, "message": "Two-factor authentication has been disabled."}


@router.post("/2fa/backup-codes/regenerate")
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
        api_error(400, "NOT_ENABLED", "Two-factor authentication is not enabled on this account.")
    if not verify_password(payload.password or "", user.password_hash):
        api_error(400, "INVALID_PASSWORD", "Password is incorrect.")
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
        api_error(401, "UNAUTHORIZED", "This verification step has expired. Please log in again.")

    user = db.get(User, UserId)
    if not user or not user.is_active or not user.totp_enabled:
        api_error(401, "UNAUTHORIZED", "This verification step has expired. Please log in again.")

    Code = (payload.code or "").strip()

    def _issue_session(event_type: str) -> dict:
        session_id = start_session(db, user, request=request)
        log_audit_event(db, event_type, user_id=user.id, request=request)
        db.commit()
        token = create_access_token(user.id, user.role, session_id=session_id)
        set_session_cookie(response, user.role, token)
        set_csrf_cookie(response)
        return {"tokenType": "Bearer", "user": user_payload(db, user)}

    if verify_totp_code(user.totp_secret, Code):
        return _issue_session("auth.login.success")

    StoredHashes = json.loads(user.totp_backup_codes_json or "[]")
    for Index, StoredHash in enumerate(StoredHashes):
        if verify_password(Code, StoredHash):
            del StoredHashes[Index]
            user.totp_backup_codes_json = json.dumps(StoredHashes)
            return _issue_session("auth.login.success_via_backup_code")

    log_audit_event(db, "auth.login.2fa_failed", user_id=user.id, request=request)
    db.commit()
    api_error(401, "INVALID_CODE", "That code didn't match. Check your authenticator app and try again.")


@router.get("/ping")
def auth_ping(user: User = Depends(get_current_user)):
    """Heartbeat -- depending on get_current_user triggers the LRU-debounced
    last_active_at background update.
    """
    return {"status": "ok", "user_id": user.id}
