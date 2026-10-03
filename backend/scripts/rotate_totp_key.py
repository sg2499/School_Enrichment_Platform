"""Re-encrypts every stored TOTP secret under a new TOTP_ENCRYPTION_KEY.

Why this exists (3 Oct 2026). The key that protects the admins' 2FA secrets
at rest was once committed to this public repository, so it has to be
replaced -- and replacing it is not just changing the Render setting: every
secret already in the database is a Fernet token made with the OLD key, and
a server that only knows the new key could not read any of them (every admin
sign-in would fail with a 500 until the secrets were re-enrolled).

Rotation is therefore three steps, and this script is the middle one:

  1. Render:  TOTP_ENCRYPTION_KEY = NEW,OLD   (new first: it encrypts; every
                                               key is tried when decrypting)
  2. This script: re-encrypts users.totp_secret and users.totp_pending_secret
                  under NEW.
  3. Render:  TOTP_ENCRYPTION_KEY = NEW       (only once step 2 says it is safe)

What it does, in order, and why it is safe to run:

  * Reads every non-empty secret and works out which key each one is under.
    If ANY value cannot be read with the keys you supply, it stops before
    changing anything -- a half-rotated table is worse than an old one.
  * Without --apply it only reports. Nothing is written.
  * With --apply it re-encrypts in ONE transaction, then re-reads every row
    and checks that (a) each secret now opens with the new key ALONE and
    (b) it decrypts to exactly the value it had before. Only then does it
    commit; if any check fails the transaction is rolled back untouched.
  * Running it again is harmless: values already under the new key are left
    as they are.
  * It never prints a secret or a key, and the keys are typed at a hidden
    prompt (or taken from ROTATE_NEW_KEY / ROTATE_OLD_KEYS, for terminals
    that will not paste into it) rather than passed on the command line, so
    they don't land in shell history or in the process list.

Usage (from backend/, with DATABASE_URL set to the production database):
    python scripts/rotate_totp_key.py            # report only
    python scripts/rotate_totp_key.py --apply    # rotate for real
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# users.totp_secret / users.totp_pending_secret hold Fernet tokens (the model
# exposes them as decrypting properties; this script works on the raw columns).
COLUMNS = ("totp_secret", "totp_pending_secret")


class RotationError(Exception):
    """Something that must stop the rotation before it changes anything."""


@dataclass
class Report:
    """What a run found or did. Counts only -- never a secret, never a key."""

    accounts: int = 0
    secrets: int = 0
    already_current: int = 0
    to_rotate: int = 0
    rotated: int = 0
    unreadable: list[tuple[int, str]] = field(default_factory=list)  # (user id, column)


def build_keys(new_key: str, old_keys: str) -> tuple[Fernet, list[Fernet]]:
    """The new key (it encrypts) and every key a stored value might be under.

    Raises RotationError with a plain sentence for a malformed or repeated key.
    """
    new_key = (new_key or "").strip()
    olds = [part.strip() for part in (old_keys or "").split(",") if part.strip()]
    if not new_key:
        raise RotationError("The new key is empty.")
    if new_key in olds:
        raise RotationError("The new key is the same as one of the old keys; a rotation has to introduce a new one.")
    ring = []
    for position, key in enumerate([new_key, *olds]):
        try:
            ring.append(Fernet(key.encode("ascii")))
        except (ValueError, TypeError, UnicodeError) as exc:
            label = "The new key" if position == 0 else f"Old key #{position}"
            raise RotationError(f"{label} is not a valid Fernet key (44 characters ending in '=').") from exc
    return ring[0], ring


def _plaintext(token: str, fernets: list[Fernet]) -> str | None:
    for fernet in fernets:
        try:
            return fernet.decrypt(token.encode("ascii")).decode("utf-8")
        except (InvalidToken, UnicodeError):
            continue
    return None


def _is_under(token: str, fernet: Fernet) -> bool:
    try:
        fernet.decrypt(token.encode("ascii"))
        return True
    except (InvalidToken, UnicodeError):
        return False


def rotate(connection, new_key: str, old_keys: str, *, apply: bool) -> Report:
    """Report on, or perform, the re-encryption using an open SQLAlchemy
    connection (a transaction the caller commits or rolls back).

    Raises RotationError when any secret cannot be read or a post-write check
    fails; the caller must then roll back.
    """
    from sqlalchemy import text

    primary, ring = build_keys(new_key, old_keys)
    report = Report()

    lock = " FOR UPDATE" if connection.dialect.name == "postgresql" else ""
    rows = connection.execute(
        text(
            "SELECT id, totp_secret, totp_pending_secret FROM users "
            "WHERE totp_secret IS NOT NULL OR totp_pending_secret IS NOT NULL ORDER BY id" + lock
        )
    ).fetchall()

    planned: list[tuple[int, dict[str, str | None], dict[str, str | None]]] = []
    for user_id, *values in rows:
        report.accounts += 1
        before: dict[str, str | None] = {}
        after: dict[str, str | None] = {}
        for column, token in zip(COLUMNS, values):
            before[column] = after[column] = None
            if token is None or token == "":
                continue
            report.secrets += 1
            plain = _plaintext(token, ring)
            if plain is None:
                report.unreadable.append((user_id, column))
                continue
            before[column] = plain
            if _is_under(token, primary):
                report.already_current += 1
                after[column] = token
            else:
                report.to_rotate += 1
                after[column] = primary.encrypt(plain.encode("utf-8")).decode("ascii")
        planned.append((user_id, before, after))

    if report.unreadable:
        raise RotationError(
            f"{len(report.unreadable)} stored secret(s) cannot be read with the keys you gave "
            "(a wrong or missing old key, or a value that was never encrypted). Nothing was changed."
        )
    if not apply:
        return report

    for user_id, _before, after in planned:
        connection.execute(
            text("UPDATE users SET totp_secret = :a, totp_pending_secret = :b WHERE id = :id"),
            {"a": after["totp_secret"], "b": after["totp_pending_secret"], "id": user_id},
        )
        report.rotated += 1

    # Read it all back as the server will after the old key is gone: new key
    # ALONE, and the very same secrets as before.
    for user_id, before, _after in planned:
        stored = connection.execute(
            text("SELECT totp_secret, totp_pending_secret FROM users WHERE id = :id"), {"id": user_id}
        ).one()
        for column, token in zip(COLUMNS, stored):
            expected = before[column]
            if expected is None:
                if token not in (None, ""):
                    raise RotationError("A secret appeared that was not there a moment ago; rolled back.")
                continue
            if token is None or _plaintext(token, [primary]) != expected:
                raise RotationError(
                    "After re-encrypting, a secret did not open with the new key alone or changed value; rolled back."
                )
    return report


def _mask_database_url(url: str) -> str:
    if "@" not in url:
        return url
    scheme_and_creds, host_and_rest = url.rsplit("@", 1)
    scheme = scheme_and_creds.split("://", 1)[0] if "://" in scheme_and_creds else ""
    return f"{scheme}://***:***@{host_and_rest}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="Write the re-encrypted values. Without it, only report.")
    args = parser.parse_args()

    from app.database import engine

    print(f"Target database: {_mask_database_url(str(engine.url))}")
    if "sqlite" in str(engine.url):
        print("WARNING: DATABASE_URL is not set (or points at SQLite) -- this is NOT the production database.")

    # Normally typed at a hidden prompt. Some Windows terminals will not paste
    # into that prompt, so the same two values may instead be put in these
    # variables for the one run (set with Read-Host so they stay out of
    # shell history) and removed afterwards.
    new_key = os.environ.get("ROTATE_NEW_KEY") or getpass.getpass("NEW key (the fresh one, not echoed): ")
    old_keys = os.environ.get("ROTATE_OLD_KEYS") or getpass.getpass(
        "OLD key(s) still in use, comma-separated (not echoed): "
    )

    if args.apply:
        answer = input("This re-encrypts every stored 2FA secret under the new key. Type YES to proceed: ")
        if answer.strip() != "YES":
            print("Aborted. Nothing was changed.")
            return 1

    try:
        with engine.begin() as connection:  # commits on success, rolls back on any exception
            report = rotate(connection, new_key, old_keys, apply=args.apply)
    except RotationError as exc:
        print(f"STOPPED: {exc}")
        return 1

    print(
        f"{report.accounts} account(s) hold {report.secrets} secret(s): "
        f"{report.already_current} already under the new key, {report.to_rotate} under an old key."
    )
    if not args.apply:
        print("Report only -- nothing was written. Run again with --apply to rotate.")
        return 0
    print(f"Re-encrypted {report.rotated} account(s). Every secret was re-read and opens with the new key alone.")
    print("It is now safe to remove the old key from Render (set TOTP_ENCRYPTION_KEY to the new key only).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
