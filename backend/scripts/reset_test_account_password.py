"""One-time helper: resets the password for an EXISTING account you already
control, when you've forgotten it. Originally written for a MathPath test
ADMIN account, but works for any existing user -- pass whichever email
needs resetting on the command line.

Why this exists: this platform has no self-service "forgot password" email
flow yet (routes_auth.py only has an authenticated /change-password, which
is no help if you can't log in at all). The only account-creation/repair
script that already existed was create_super_admin.py, which creates or
promotes -- it deliberately doesn't touch an existing non-SUPER_ADMIN
account's password. This is the equivalent for "I own this account, I just
forgot the password."

Sets both password_hash and password_changed_at, so any existing login
sessions for this account stop working the next time they are used, as
they do after a password change in the app: a session token is bound to
the password it was issued under (core/security.py, password_fingerprint),
and get_current_user()'s IsStaleAfterPasswordChange check covers tokens
older than that binding.

Usage (from backend/, with DATABASE_URL set to the target database):
    python scripts/reset_test_account_password.py --email you@example.com
You'll be prompted for a new password (not echoed, not passed on the
command line where it could end up in shell history).
"""
import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email", required=True, help="Login email of the EXISTING account to reset.")
    args = parser.parse_args()

    from app.core.security import hash_password, strong_password_issue
    from app.database import SessionLocal, engine
    from app.models import User
    from app.services.audit_service import log_audit_event

    email = args.email.strip().lower()

    def mask_database_url(url: str) -> str:
        if "@" not in url:
            return url
        scheme_and_creds, host_and_rest = url.rsplit("@", 1)
        scheme = scheme_and_creds.split("://", 1)[0] if "://" in scheme_and_creds else ""
        return f"{scheme}://***:***@{host_and_rest}"

    print(f"Target database: {mask_database_url(str(engine.url))}")
    if "sqlite" in str(engine.url):
        print("WARNING: DATABASE_URL is not set (or points at SQLite) -- this will NOT write to production.")

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            print(f"No user found with email {email!r}. Nothing to reset.")
            return 1

        print(f"Found account: {user.full_name} <{user.email}> (role={user.role}, id={user.id}, "
              f"active={user.is_active}).")
        answer = input("Reset this account's password? Type YES to proceed: ")
        if answer.strip() != "YES":
            print("Aborted.")
            return 1

        password = getpass.getpass("New password: ")
        confirm = getpass.getpass("Confirm new password: ")
        if password != confirm:
            print("Passwords did not match.")
            return 1
        issue = strong_password_issue(password)
        if issue:
            print(f"Weak password: {issue}")
            return 1

        from sqlalchemy.sql import func
        user.password_hash = hash_password(password)
        user.password_changed_at = func.now()
        log_audit_event(db, "auth.password_reset_by_script", user_id=user.id)
        db.commit()
        print(f"Password reset for {user.full_name} <{user.email}>.")
        print("Any existing login sessions for this account are now stale and will require signing in again.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
