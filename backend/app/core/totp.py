"""TOTP-based two-factor authentication helpers (2026-07-21 security audit, Phase 2).

Kept as its own module rather than folded into security.py so the optional
pyotp/qrcode dependency stays isolated to the one feature that needs it.
"""
import base64
import io
import secrets as secrets_module

import pyotp
import qrcode

ISSUER_NAME = "MathPath"
BACKUP_CODE_COUNT = 10


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def totp_provisioning_uri(secret: str, account_label: str) -> str:
    return pyotp.totp.TOTP(secret).provisioning_uri(name=account_label, issuer_name=ISSUER_NAME)


def totp_qr_code_data_url(uri: str) -> str:
    """Render the otpauth:// URI as a QR code PNG, returned as a base64 data URL.

    Generated server-side (rather than a frontend QR library) to match this
    codebase's existing convention of returning images as base64 data URLs
    (see profile photos in routes_auth.py) instead of adding a new frontend
    dependency for a one-time setup screen.
    """
    image = qrcode.make(uri)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def verify_totp_code(secret: str, code: str) -> bool:
    if not secret or not code:
        return False
    try:
        # valid_window=1 tolerates one 30-second step of clock drift on
        # either side, standard practice for TOTP verification.
        return pyotp.TOTP(secret).verify(code.strip(), valid_window=1)
    except Exception:
        return False


def generate_backup_codes(count: int = BACKUP_CODE_COUNT) -> list[str]:
    """Generate one-time backup codes, returned in plaintext exactly once.

    Callers must hash these (see app.core.security.hash_password) before
    storing -- the caller never persists the plaintext, only shows it to the
    user at generation time, the same trust model as a password.
    """
    return [f"{secrets_module.token_hex(4)}-{secrets_module.token_hex(2)}" for _ in range(count)]
