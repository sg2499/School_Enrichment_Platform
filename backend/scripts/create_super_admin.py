"""One-time bootstrap: creates a platform-operator (SUPER_ADMIN) account.

Why this exists: the only account-creation path this platform has today,
POST /api/platform/schools (routes_platform.py), always creates a
school-scoped ADMIN tied to one SchoolAdmin row -- there is no endpoint
that creates the platform-wide SUPER_ADMIN role. That role is deliberately
more restricted in a different direction: it has no school of its own
(auth_service.py's user_payload() skips the SchoolAdmin lookup for it
entirely), but it is the ONLY role allowed to move Chapter/ConceptLesson/
Question through draft -> review -> publish (routes_curriculum_admin.py) --
a school's own ADMIN (e.g. Ashalatha Gupta's MathPath account) can map
already-published content into their school's calendar, but can never
publish anything themselves. Discovered this gap for real on 18 Aug 2026:
after loading all 15 real Class 5 Maths chapters, nobody could review or
publish them because no SUPER_ADMIN account existed anywhere in the
system yet.

Deliberately a standalone script, not an HTTP endpoint: creating the first
platform operator is a rare, one-time (or very-low-frequency) action, and
-- same reasoning as import_class5_maths.py -- writing a new privileged
account directly into the production database is exactly the kind of
action that should be a visible, deliberate step you run yourself with
production credentials you hold, not something exposed over HTTP or run
by an agent.

Usage (from backend/, with DATABASE_URL set to the target database):
    python scripts/create_super_admin.py --email you@example.com --full-name "Your Name"
You'll be prompted for a password (not echoed, not passed on the command
line where it could end up in shell history).
"""
import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email", required=True, help="Login email for the new SUPER_ADMIN account.")
    parser.add_argument("--full-name", required=True, help="Display name.")
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip the interactive confirmation prompt (for non-interactive/CI use).",
    )
    args = parser.parse_args()

    from app.core.security import hash_password, strong_password_issue
    from app.database import SessionLocal, engine
    from app.models import User

    email = args.email.strip().lower()
    if "@" not in email or email.startswith("@") or email.endswith("@"):
        print(f"'{email}' doesn't look like a valid email address.")
        return 1

    def mask_database_url(url: str) -> str:
        if "@" not in url:
            return url
        scheme_and_creds, host_and_rest = url.rsplit("@", 1)
        scheme = scheme_and_creds.split("://", 1)[0] if "://" in scheme_and_creds else ""
        return f"{scheme}://***:***@{host_and_rest}"

    print(f"Target database: {mask_database_url(str(engine.url))}")
    if "sqlite" in str(engine.url):
        print("WARNING: DATABASE_URL is not set (or points at SQLite) -- this will NOT write to production.")

    password = getpass.getpass("Password for the new SUPER_ADMIN account: ")
    confirm = getpass.getpass("Confirm password: ")
    if password != confirm:
        print("Passwords did not match.")
        return 1
    issue = strong_password_issue(password)
    if issue:
        print(f"Weak password: {issue}")
        return 1

    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == email).first()
        if existing:
            print(f"A user with email {email} already exists (role={existing.role}, id={existing.id}).")
            if existing.role == "SUPER_ADMIN":
                print("They are already a SUPER_ADMIN -- nothing to do.")
                return 0
            if not args.yes:
                answer = input(f"Promote this existing account to SUPER_ADMIN? Type YES to proceed: ")
                if answer.strip() != "YES":
                    print("Aborted.")
                    return 1
            existing.role = "SUPER_ADMIN"
            db.commit()
            print(f"Promoted {email} to SUPER_ADMIN.")
            return 0

        if not args.yes:
            answer = input(f"Create new SUPER_ADMIN account {email!r} ({args.full_name!r})? Type YES to proceed: ")
            if answer.strip() != "YES":
                print("Aborted.")
                return 1

        user = User(
            full_name=args.full_name.strip(),
            email=email,
            password_hash=hash_password(password),
            role="SUPER_ADMIN",
            is_active=True,
        )
        db.add(user)
        db.commit()
        print(f"Created SUPER_ADMIN account: {args.full_name} <{email}> (id={user.id})")
        print("Sign in at the login page with this email/password to reach the Curriculum Studio's")
        print("platform-admin view (draft / review / publish chapters).")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
