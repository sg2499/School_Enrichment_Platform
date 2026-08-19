"""Proves the 2026-08-19 profile-photo content-sniffing hardening
(app/api/routes_auth.py's save_profile_photo()): the upload endpoint now
actually decodes the file as an image and checks its real format, not just
the claimed filename extension.

Also covers the (same-day, second pass) oversized-file rejection at its new
2MB ceiling -- raised from the original 350KB now that the real size gate is
client-side compression (frontend/lib/imageCompression.ts); this backend
check is the safety-net behind it, not the primary UX gate.
"""
import os
from io import BytesIO

from PIL import Image

from app.core.security import hash_password
from app.models import School, Teacher, User

PASSWORD = "Xk4$nQ8vPz"


def _make_teacher(db, email: str) -> tuple[User, Teacher]:
    school = School(name="Photo Upload Test School", board="CBSE", city="Bengaluru")
    db.add(school)
    db.flush()
    user = User(full_name="Photo Test Teacher", email=email, password_hash=hash_password(PASSWORD), role="TEACHER")
    db.add(user)
    db.flush()
    teacher = Teacher(user_id=user.id, school_id=school.id, teacher_code=f"TCH-{email.split('@')[0]}")
    db.add(teacher)
    db.commit()
    return user, teacher


def _login(client, email: str) -> dict:
    response = client.post("/api/auth/login", json={"identifier": email, "password": PASSWORD})
    assert response.status_code == 200
    csrf_token = client.cookies.get("se_csrf")
    assert csrf_token
    return {"x-csrf-token": csrf_token}


def _real_jpeg_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (4, 4), color=(200, 40, 40)).save(buffer, format="JPEG")
    return buffer.getvalue()


def _real_png_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (4, 4), color=(40, 200, 40)).save(buffer, format="PNG")
    return buffer.getvalue()


def _oversized_png_bytes() -> bytes:
    # Random noise, not a solid color -- PNG's compression makes a large
    # solid-color image tiny regardless of pixel dimensions, so this needs
    # real entropy to actually land over the 2MB ceiling being tested.
    width, height = 1400, 1400
    pixels = os.urandom(width * height * 3)
    buffer = BytesIO()
    Image.frombytes("RGB", (width, height), pixels).save(buffer, format="PNG")
    return buffer.getvalue()


def test_genuine_jpeg_upload_succeeds(client, db_session):
    _make_teacher(db_session, "photo-good-jpeg@example.com")
    headers = _login(client, "photo-good-jpeg@example.com")

    response = client.post(
        "/api/auth/profile-photo",
        files={"file": ("photo.jpg", _real_jpeg_bytes(), "image/jpeg")},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["updated"] is True


def test_non_image_file_disguised_with_jpg_extension_is_rejected(client, db_session):
    _make_teacher(db_session, "photo-fake-jpeg@example.com")
    headers = _login(client, "photo-fake-jpeg@example.com")

    malicious_bytes = b"<html><body><script>alert('not a photo')</script></body></html>"
    response = client.post(
        "/api/auth/profile-photo",
        files={"file": ("photo.jpg", malicious_bytes, "image/jpeg")},
        headers=headers,
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "INVALID_FILE"


def test_real_image_with_mismatched_extension_is_rejected(client, db_session):
    _make_teacher(db_session, "photo-mismatch@example.com")
    headers = _login(client, "photo-mismatch@example.com")

    # A genuine PNG, but named/declared as a .jpg -- content-sniffing should
    # catch the mismatch even though the bytes are a real, valid image.
    response = client.post(
        "/api/auth/profile-photo",
        files={"file": ("photo.jpg", _real_png_bytes(), "image/jpeg")},
        headers=headers,
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "INVALID_FILE"


def test_genuine_png_upload_succeeds(client, db_session):
    _make_teacher(db_session, "photo-good-png@example.com")
    headers = _login(client, "photo-good-png@example.com")

    response = client.post(
        "/api/auth/profile-photo",
        files={"file": ("photo.png", _real_png_bytes(), "image/png")},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["updated"] is True


def test_oversized_file_is_rejected(client, db_session):
    _make_teacher(db_session, "photo-too-big@example.com")
    headers = _login(client, "photo-too-big@example.com")

    payload = _oversized_png_bytes()
    assert len(payload) > 2_000_000  # guards against the fixture itself drifting under the limit

    response = client.post(
        "/api/auth/profile-photo",
        files={"file": ("photo.png", payload, "image/png")},
        headers=headers,
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "FILE_TOO_LARGE"
