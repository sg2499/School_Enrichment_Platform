"""Removes the teachers and students of one school who have never used Krama (#242).

For a test school whose people were uploaded wrongly and should be uploaded again.
Read-only unless --apply (then it asks YES).

    python scripts/remove_unused_people.py --school "ABC Public School"
    python scripts/remove_unused_people.py --school "ABC Public School" --apply
    python scripts/remove_unused_people.py --school "ABC Public School" --even-if-used --apply   (test school only)

Only teachers and students are ever touched, never an admin. A person is removed
only if they have never signed in (no session, no password of their own, no last
activity) and have no practice given to them. If any person of the school
has used Krama the script lists them and removes nobody, so it cannot be used on
a school in real use. Their audit-trail rows stay, with the person's link cleared.

Run from backend/ with ENVIRONMENT=development and DATABASE_URL set, as for the
other scripts.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def find_people(db, school):
    from app.models import Student, Teacher, User

    teachers = db.query(Teacher, User).join(User, User.id == Teacher.user_id).filter(Teacher.school_id == school.id).all()
    students = db.query(Student, User).join(User, User.id == Student.user_id).filter(Student.school_id == school.id).all()
    return teachers, students


def used_reasons(db, teachers, students) -> list[str]:
    """Why somebody can't be removed: a sign-in, or any work recorded for them."""
    from sqlalchemy import func

    from app.models import AssignmentTarget, UserSession

    reasons = []
    for person, user in [*teachers, *students]:
        if user.last_active_at is not None or user.password_changed_at is not None:
            reasons.append(f"{user.full_name} has signed in.")
        elif db.query(func.count(UserSession.id)).filter(UserSession.user_id == user.id).scalar():
            reasons.append(f"{user.full_name} has a session on record.")
    for student, user in students:
        if db.query(func.count(AssignmentTarget.id)).filter(AssignmentTarget.student_id == student.id).scalar():
            reasons.append(f"{user.full_name} has been given practice.")
    return reasons


def remove_people(db, school, teachers, students) -> dict:
    """Deletes them in one transaction (the caller commits). Returns the counts."""
    from sqlalchemy import update

    from app.models import AuditLog, Student, Teacher, TeacherSectionAssignment, User, UserSession

    user_ids = [u.id for _p, u in [*teachers, *students]]
    student_ids = [s.id for s, _u in students]
    teacher_ids = [t.id for t, _u in teachers]
    if user_ids:
        db.execute(update(AuditLog).where(AuditLog.user_id.in_(user_ids)).values(user_id=None))
    if student_ids:
        db.execute(update(AuditLog).where(AuditLog.student_id.in_(student_ids)).values(student_id=None))
        db.query(Student).filter(Student.id.in_(student_ids)).delete(synchronize_session=False)
    if teacher_ids:
        db.query(TeacherSectionAssignment).filter(TeacherSectionAssignment.teacher_id.in_(teacher_ids)).delete(
            synchronize_session=False
        )
        db.query(Teacher).filter(Teacher.id.in_(teacher_ids)).delete(synchronize_session=False)
    if user_ids:
        db.query(UserSession).filter(UserSession.user_id.in_(user_ids)).delete(synchronize_session=False)
        db.query(User).filter(User.id.in_(user_ids)).delete(synchronize_session=False)
    db.add(
        AuditLog(
            event_type="school.unused_people_removed",
            event_data_json=f'{{"school": "{school.name}", "teachers": {len(teacher_ids)}, "students": {len(student_ids)}}}',
        )
    )
    return {"teachers": len(teacher_ids), "students": len(student_ids)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--school", required=True, help="the school's exact name")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--even-if-used",
        action="store_true",
        help="also remove people who have signed in (a test school only): their practice, sessions and marks go too",
    )
    args = parser.parse_args()

    from app.database import SessionLocal, engine
    from app.models import School
    from scripts.apply_answer_units import mask_database_url

    print(f"Target database: {mask_database_url(str(engine.url))}")
    if "sqlite" in str(engine.url):
        print("WARNING: DATABASE_URL is not set (or points at SQLite) -- this is not production.")
    db = SessionLocal()
    try:
        schools = db.query(School).filter(School.name == args.school).all()
        if len(schools) != 1:
            print(f'Expected exactly one school named "{args.school}", found {len(schools)}. Nothing written.')
            return 1
        school = schools[0]
        teachers, students = find_people(db, school)
        print(f"{school.name} ({school.board}): {len(teachers)} teachers, {len(students)} students.")
        reasons = used_reasons(db, teachers, students)
        if reasons and not args.even_if_used:
            print("These people have used Krama, so nobody is removed:")
            for r in reasons:
                print("  -", r)
            print("For a test school you want emptied anyway, add --even-if-used.")
            return 1
        if reasons:
            print("These people have used Krama; their practice, sessions and marks will be removed with them:")
            for r in reasons:
                print("  -", r)
        if not (teachers or students):
            print("Nobody to remove.")
            return 0
        for _t, u in teachers:
            print("  teacher:", u.full_name)
        for s, u in students:
            print(f"  student: {u.full_name} ({s.class_name or '-'}{s.section or ''})")
        if not args.apply:
            print("\nREAD ONLY: add --apply to remove them.")
            return 0
        if input("\nRemove these people for good? Type YES: ").strip() != "YES":
            print("Cancelled; nothing written.")
            return 0
        counts = remove_people(db, school, teachers, students)
        db.commit()
        print(f"Done: removed {counts['teachers']} teachers and {counts['students']} students.")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
