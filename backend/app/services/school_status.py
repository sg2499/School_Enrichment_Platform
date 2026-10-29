"""Whether a person's school is suspended (#211, 29 Oct 2026).

A Super Admin can suspend a school (routes_schools_admin.py). While it is
suspended nobody at it can sign in or keep using a session: its admins,
teachers and students alike. Checked at sign-in (auth_service.login, the
two-factor step) and on every request (dependencies.get_current_user), so
suspending takes effect at once, and restoring does too.
"""

from sqlalchemy.orm import Session

from app.models import School, SchoolAdmin, Student, Teacher, User

SUSPENDED_MESSAGE = "Your school's Krama account is paused. Please ask your school to contact the Krama team."


def school_is_suspended(db: Session, user: User) -> bool:
    profile = {"ADMIN": SchoolAdmin, "TEACHER": Teacher, "STUDENT": Student}.get(user.role)
    if profile is None:
        return False  # SUPER_ADMIN belongs to no school
    active = (
        db.query(School.is_active)
        .join(profile, profile.school_id == School.id)
        .filter(profile.user_id == user.id)
        .scalar()
    )
    return active is False
