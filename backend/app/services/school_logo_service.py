"""A school's logo (#202, 26 Oct 2026).

Shailesh: "we need to have an option for the admin for each school where
they can upload the school logo which would then be used across roles for
that school and be displayed wherever relevant".

The school's admin uploads a PNG, JPG or WEBP image. It is decoded (not
just its name trusted), turned upright, stripped of metadata, fitted within
LOGO_MAX_SIDE pixels and kept as a PNG (so a transparent background stays
transparent) in schools.logo_data, as profile photos are kept. SVG is not
accepted: it can carry script, and the PDFs cannot draw it.

Who sees it: everyone signed in at that school (the app's side rail, the
weekly reports and report cards on screen) and the PDFs the school issues.
"""
from __future__ import annotations

import base64
from datetime import UTC, datetime
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.orm import Session, undefer

from app.models import School

LOGO_MAX_BYTES = 3_000_000
LOGO_MAX_SIDE = 600
LOGO_MIN_SIDE = 32
LOGO_MAX_INPUT_SIDE = 4000
LOGO_MAX_PIXELS = 16_000_000
_OPEN_FORMATS = ["PNG", "JPEG", "WEBP"]


class LogoError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def clean_logo(content: bytes) -> bytes:
    """The uploaded bytes as a checked, upright, metadata-free PNG of at
    most LOGO_MAX_SIDE pixels a side."""
    if not content:
        raise LogoError("That file is empty. Please choose the logo image again.")
    if len(content) > LOGO_MAX_BYTES:
        raise LogoError("That image is too large. Please choose one under 3 MB.")
    try:
        with Image.open(BytesIO(content), formats=_OPEN_FORMATS) as probe:
            # The size is in the header: refuse a huge canvas before decoding
            # it (a small file can hold one that needs gigabytes; #202 review).
            if probe.width > LOGO_MAX_INPUT_SIDE or probe.height > LOGO_MAX_INPUT_SIDE or probe.width * probe.height > LOGO_MAX_PIXELS:
                raise LogoError("That image is too large in pixels. Please use one under 4,000 pixels on each side.")
            probe.verify()
        with Image.open(BytesIO(content), formats=_OPEN_FORMATS) as source:
            if source.format == "JPEG":
                source.draft("RGB", (2 * LOGO_MAX_SIDE, 2 * LOGO_MAX_SIDE))
            image = ImageOps.exif_transpose(source)
            image.load()
    except LogoError:
        raise
    except Image.DecompressionBombError:
        raise LogoError("That image is too large in pixels. Please use one under 4,000 pixels on each side.") from None
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError):
        raise LogoError("That file isn't an image we can read. Please upload a PNG, JPG or WEBP image.") from None
    # Smaller first, then the copies made below are small too.
    image.thumbnail((2 * LOGO_MAX_SIDE, 2 * LOGO_MAX_SIDE), Image.LANCZOS)
    image = image.convert("RGBA")
    # Trim fully transparent margins, so the logo fills the space it is given.
    box = image.getchannel("A").getbbox()
    if box is None:
        raise LogoError("That image looks empty (it is fully transparent). Please choose the logo image again.")
    image = image.crop(box)
    if min(image.size) < LOGO_MIN_SIDE:
        raise LogoError(f"That image is too small to print well. Please use one at least {LOGO_MIN_SIDE} pixels on each side.")
    image.thumbnail((LOGO_MAX_SIDE, LOGO_MAX_SIDE), Image.LANCZOS)
    out = BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()


def readable_logo(png: bytes | None) -> bytes | None:
    """The stored logo, decoded in full to prove it can be drawn, as PNG
    bytes; None if there is none or it is damaged, so a PDF is always made
    (#202 review: a truncated image only fails when the PDF draws it)."""
    if not png:
        return None
    try:
        with Image.open(BytesIO(png), formats=_OPEN_FORMATS) as image:
            image.load()
            out = BytesIO()
            image.convert("RGBA").save(out, format="PNG")
            return out.getvalue()
    except Exception:  # noqa: BLE001 - any damage means no logo, never no PDF
        return None


def save_logo(db: Session, school: School, png: bytes) -> None:
    school.logo_data = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
    school.logo_updated_at = datetime.now(UTC)
    db.flush()


def remove_logo(db: Session, school: School) -> None:
    school.logo_data = None
    school.logo_updated_at = None
    db.flush()


def logo_stamp(school: School) -> str | None:
    return school.logo_updated_at.strftime("%Y%m%d%H%M%S%f") if school.logo_updated_at else None


def logo_url(school: School | None) -> str | None:
    """The address the app loads the logo from; changes when it is replaced,
    so a browser never shows the old one from its cache."""
    if school is None or school.logo_updated_at is None:
        return None
    return f"/api/schools/{school.id}/logo?v={logo_stamp(school)}"


def logo_bytes(db: Session, school_id: str | None) -> bytes | None:
    """The logo as PNG bytes, for the PDFs; None when the school has none."""
    if not school_id:
        return None
    school = db.query(School).options(undefer(School.logo_data)).filter(School.id == school_id).first()
    data = school.logo_data if school else None
    if not data or ";base64," not in data:
        return None
    try:
        return readable_logo(base64.b64decode(data.split(",", 1)[1]))
    except ValueError:
        return None


def with_logo(db, data: dict, school_id: str | None) -> dict:
    """A report or card to show on screen, with its school's current logo
    address (#202): the logo is the school's now, not kept in the copy."""
    school = db.get(School, school_id) if school_id else None
    return {**data, "school": {**data.get("school", {}), "logoUrl": logo_url(school)}}
