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
from pathlib import Path

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import Response
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
from app.dependencies import get_current_user, require_roles
from app.models import Student, Teacher, User
from app.services.auth_service import force_logout_user, login, user_payload

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
    result = login(db, payload.identifier, payload.password)
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


def safe_profile_photo_name(filename: str, prefix: str) -> str:
    suffix = Path(filename or "profile.png").suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
        api_error(400, "INVALID_FILE", "Only JPG, PNG, and WEBP images are allowed.")
    SafePrefix = re.sub(r"[^a-zA-Z0-9_-]", "-", prefix or "profile")[:80]
    Stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S%f")
    return f"{SafePrefix}-{Stamp}{suffix}"


def save_profile_photo(upload: UploadFile, prefix: str) -> str:
    FileName = safe_profile_photo_name(upload.filename or "profile.png", prefix)
    Suffix = Path(FileName).suffix.lower().lstrip(".")
    MimeType = "image/jpeg" if Suffix in {"jpg", "jpeg"} else f"image/{Suffix or 'png'}"
    Content = upload.file.read()
    if not Content:
        api_error(400, "INVALID_FILE", "Profile photo file is empty.")
    if len(Content) > 350_000:
        api_error(400, "FILE_TOO_LARGE", "Profile photo must be under 350 KB after compression.")
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
    db.commit()
    return {"updated": True, "message": "Password updated successfully."}


@router.post("/logout")
def logout(response: Response, user: User = Depends(get_current_user)):
    """Clear only the current role's session cookie (plus the shared CSRF
    cookie) -- what a normal "Sign Out" button should call. Distinct from
    /logout-all-sessions below, which revokes every token issued anywhere.
    """
    clear_session_cookie(response, user.role)
    response.delete_cookie(CSRF_COOKIE_NAME, path="/")
    return {"loggedOut": True}


@router.post("/logout-all-sessions")
@limiter.limit("5/minute")
def logout_all_sessions(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Invalidate every access token already issued to the current user, including this one."""
    force_logout_user(db, user)
    return {"updated": True, "message": "You have been signed out of all sessions. Please log in again."}


# ---------------------------------------------------------------------------
# Two-factor authentication (TOTP). Setup/enable/disable gated to
# ADMIN/SUPER_ADMIN -- the highest-value account gets the strongest
# protection first. verify-login itself is not role-gated so it keeps
# working correctly if 2FA is ever extended to other roles later.
# ---------------------------------------------------------------------------

@router.post("/2fa/setup")
def two_factor_setup(user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")), db: Session = Depends(get_db)):
    """Generate a new TOTP secret and return it as a QR code, but do not enable 2FA yet.

    The secret is stored as "pending" until confirmed via a correct code at
    POST /2fa/enable -- prevents a user from locking themselves into a
    broken 2FA setup (e.g. mis-scanned QR code) with no way back in.
    """
    Secret = generate_totp_secret()
    user.totp_pending_secret = Secret
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
    db.commit()
    return {
        "updated": True,
        "message": "Two-factor authentication is now enabled.",
        # Shown exactly once -- only the hashes are ever stored.
        "backupCodes": BackupCodes,
    }


@router.post("/2fa/disable")
def two_factor_disable(
    payload: TwoFactorDisableRequest,
    user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.password or "", user.password_hash):
        api_error(400, "INVALID_PASSWORD", "Password is incorrect.")
    user.totp_secret = None
    user.totp_pending_secret = None
    user.totp_enabled = False
    user.totp_backup_codes_json = None
    db.commit()
    return {"updated": True, "message": "Two-factor authentication has been disabled."}


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

    def _issue_session() -> dict:
        token = create_access_token(user.id, user.role)
        set_session_cookie(response, user.role, token)
        set_csrf_cookie(response)
        return {"tokenType": "Bearer", "user": user_payload(db, user)}

    if verify_totp_code(user.totp_secret, Code):
        return _issue_session()

    StoredHashes = json.loads(user.totp_backup_codes_json or "[]")
    for Index, StoredHash in enumerate(StoredHashes):
        if verify_password(Code, StoredHash):
            del StoredHashes[Index]
            user.totp_backup_codes_json = json.dumps(StoredHashes)
            db.commit()
            return _issue_session()

    api_error(401, "INVALID_CODE", "That code didn't match. Check your authenticator app and try again.")


@router.get("/ping")
def auth_ping(user: User = Depends(get_current_user)):
    """Heartbeat -- depending on get_current_user triggers the LRU-debounced
    last_active_at background update.
    """
    return {"status": "ok", "user_id": user.id}
