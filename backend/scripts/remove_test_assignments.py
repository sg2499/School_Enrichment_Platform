"""Removes the practice given to one section of a TEST school, with every attempt on it (#247).

For the three open test assignments left in ICSE Class 7 section A and the attempts
the test student made on them. Read-only unless --apply (then it asks YES).

    python scripts/remove_test_assignments.py --school "ABC Public School" --section A
    python scripts/remove_test_assignments.py --school "ABC Public School" --section A --apply

Removes, for that school and section only: the assignments, their targets, every
attempt on them with its answers, marks and attached PDFs. Students, teachers,
sections, practice sets and questions stay. The audit trail keeps one row with the
counts. Never use it on a school in real use: it refuses a school that has a report
card or weekly report issued, and a section whose attempts were marked by anyone
other than the test teacher is shown before you type YES.

Run from backend/ with ENVIRONMENT=development and DATABASE_URL set, as for the
other scripts.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def find_assignments(db, school, section: str, class_name: str | None = None):
    from app.models import Assignment

    query = db.query(Assignment).filter(Assignment.school_id == school.id, Assignment.section == section)
    if class_name:
        query = query.filter(Assignment.class_name == class_name)
    return query.order_by(Assignment.created_at).all()


def describe(db, assignments) -> list[dict]:

    from app.models import AssignmentTarget, Attempt, Student, User

    rows = []
    for a in assignments:
        targets = db.query(AssignmentTarget).filter(AssignmentTarget.assignment_id == a.id).all()
        target_ids = [t.id for t in targets]
        attempts = (
            db.query(Attempt).filter(Attempt.assignment_target_id.in_(target_ids)).all() if target_ids else []
        )
        names = []
        for t in targets:
            student = db.query(Student).filter(Student.id == t.student_id).one_or_none()
            user = db.query(User).filter(User.id == student.user_id).one_or_none() if student else None
            names.append(user.full_name if user else "?")
        rows.append(
            {
                "assignment": a,
                "title": a.learning_activity.title if a.learning_activity else "?",
                "class_name": a.class_name or "-",
                "status": a.status,
                "targets": len(targets),
                "students": ", ".join(sorted(set(names)))[:80],
                "attempts": len(attempts),
                "scores": ", ".join(f"{x.attempt_number}:{x.status}" for x in attempts),
            }
        )
    return rows


def issued_records(db, school) -> list[str]:
    """Report cards or weekly reports issued for the school: a sign it is not a test school."""
    from app.models import ReportCardIssue, WeeklyReportIssue

    found = []
    for model, label in ((ReportCardIssue, "report cards"), (WeeklyReportIssue, "weekly reports")):
        if db.query(model).filter(model.school_id == school.id).count():
            found.append(label)
    return found


def remove(db, school, section: str, assignments) -> dict:
    from app.models import (
        AnswerAttachment,
        Assignment,
        AssignmentTarget,
        Attempt,
        AttemptAnswer,
        AuditLog,
        Evaluation,
        StoredFile,
    )

    a_ids = [a.id for a in assignments]
    target_ids = [t for (t,) in db.query(AssignmentTarget.id).filter(AssignmentTarget.assignment_id.in_(a_ids)).all()]
    attempt_ids = (
        [x for (x,) in db.query(Attempt.id).filter(Attempt.assignment_target_id.in_(target_ids)).all()] if target_ids else []
    )
    answer_ids = (
        [x for (x,) in db.query(AttemptAnswer.id).filter(AttemptAnswer.attempt_id.in_(attempt_ids)).all()]
        if attempt_ids
        else []
    )
    files = 0
    if answer_ids:
        atts = db.query(AnswerAttachment).filter(AnswerAttachment.attempt_answer_id.in_(answer_ids)).all()
        for att in atts:
            if att.storage_backend == "database":
                db.query(StoredFile).filter(StoredFile.key == att.storage_key).delete(synchronize_session=False)
            files += 1
            db.delete(att)
        db.flush()
        db.query(AttemptAnswer).filter(AttemptAnswer.id.in_(answer_ids)).delete(synchronize_session=False)
    if attempt_ids:
        db.query(Evaluation).filter(Evaluation.attempt_id.in_(attempt_ids)).delete(synchronize_session=False)
        db.query(Attempt).filter(Attempt.id.in_(attempt_ids)).delete(synchronize_session=False)
    if target_ids:
        db.query(AssignmentTarget).filter(AssignmentTarget.id.in_(target_ids)).delete(synchronize_session=False)
    db.query(Assignment).filter(Assignment.id.in_(a_ids)).delete(synchronize_session=False)
    counts = {
        "assignments": len(a_ids),
        "targets": len(target_ids),
        "attempts": len(attempt_ids),
        "answers": len(answer_ids),
        "pdfs": files,
    }
    db.add(
        AuditLog(
            event_type="school.test_assignments_removed",
            event_data_json=json.dumps({"school": school.name, "section": section, **counts}),
        )
    )
    return counts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--school", required=True, help="the school's exact name")
    parser.add_argument("--section", required=True, help="the section letter, for example A")
    parser.add_argument("--class-name", default=None, help="only assignments set for this class, exactly as the report prints it")
    parser.add_argument("--apply", action="store_true")
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
        issued = issued_records(db, school)
        if issued:
            print(f"{school.name} has issued {' and '.join(issued)}, so it is not treated as a test school. Nothing written.")
            return 1
        assignments = find_assignments(db, school, args.section, args.class_name)
        if not assignments:
            print(f"No practice is set for {school.name}, section {args.section}. Nothing to remove.")
            return 0
        rows = describe(db, assignments)
        print(f"{school.name} ({school.board}), section {args.section}: {len(rows)} assignments")
        for r in rows:
            print(f"  - class {r['class_name']}: {r['title']} [{r['status']}] to {r['targets']} student(s) ({r['students']}); attempts {r['attempts']} ({r['scores']})")
        if not args.apply:
            print("\nREAD ONLY: add --apply to remove them.")
            return 0
        if input("\nRemove these assignments and every attempt on them for good? Type YES: ").strip() != "YES":
            print("Cancelled; nothing written.")
            return 0
        counts = remove(db, school, args.section, assignments)
        db.commit()
        print("Done: removed " + ", ".join(f"{v} {k}" for k, v in counts.items()) + ".")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
