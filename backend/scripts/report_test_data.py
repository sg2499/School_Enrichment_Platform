"""Report the test data left on production by the 24-25 Nov verification runs.

READ-ONLY. This script never writes. It finds the rows, counts what hangs off
them, and names what would be left behind by a delete.

    python scripts/report_test_data.py

WHAT IT LOOKS FOR

Three things, all created while verifying A-013, #270, #271 and #265:

  1. The practice attempts made as a student on "Measurement -- Mastery E"
     (attempt 1 marked 3 of 60 by a teacher; attempt 2 left open with one
     PDF on Q1).
  2. Assignment 92d9d4bd-e363-48c7-b5ec-aaa5c45c0b4c, covering 6 students.
  3. The demo school's "A-013 Verification Paper" mock paper.

WHY A REPORT FIRST

Deleting a child's attempt is irreversible and there is no undo. Two things
in particular are worth knowing before, not after:

  * **Orphaned uploads.** `answer_attachments` does NOT hold a foreign key to
    the stored bytes -- it carries `storage_backend` and `storage_key`. So the
    row cascades away with its answer while the FILE it points at stays
    behind. A child's uploaded PDF would outlive the record of it. This
    script lists those keys so a delete can take them too.
  * **Stale derived documents.** `report_cards`, `student_term_records`,
    `weekly_reports` and their issue tables key on `student_id`, not on the
    attempt, so a delete does not touch them. Any that were generated from
    these attempts would keep figures whose source is gone. Progress itself
    is safe: `progress_service.SkillScore` is a dataclass computed on read,
    not a stored table.
"""

import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import func

from app.database import SessionLocal
from app.models import (
    AnswerAttachment,
    Assignment,
    AssignmentTarget,
    Attempt,
    AttemptAnswer,
    Evaluation,
    LearningActivity,
    School,
    StoredFile,
    Student,
    User,
)

ASSIGNMENT_ID = "92d9d4bd-e363-48c7-b5ec-aaa5c45c0b4c"
MOCK_PAPER_TITLE = "A-013 Verification Paper"
ACTIVITY_HINT = "Mastery E"
# The live verification runs began on 24 Nov 2026. Anything in these tables
# created at or after this is from them.
SINCE = datetime(2026, 11, 24, tzinfo=UTC)


def _who(db, student) -> str:
    """A child's label. `Student` has no name column -- the name lives on the
    linked `User` -- so this reads both and leans on `student_code`, which is
    the identifier the rest of the reporting scripts use."""
    if student is None:
        return "?"
    name = None
    if getattr(student, "user_id", None):
        user = db.get(User, student.user_id)
        name = getattr(user, "full_name", None)
    code = getattr(student, "student_code", None) or student.id
    return f"{name} ({code})" if name else str(code)


def _rule(title: str) -> None:
    print()
    print(title)
    print("-" * len(title))


def report(db) -> int:
    """The whole report, against a session the caller owns.

    Separate from main() for the same reason strip_stray_names.plan is: a
    report that has only ever run against an EMPTY database proves that the
    SQL parses, not that the column names are right. Twice today a script
    passed on empty tables and would have broken on production -- once on
    `Question.origin`, once on `Student.full_name`, which does not exist. A
    test seeds rows and drives this.
    """
    if True:
        # --- 1. The named assignment ----------------------------------------
        _rule(f"1. Assignment {ASSIGNMENT_ID}")
        # Named explicitly and initialised here. An earlier version called this
        # `assignment`, and section 2's loop unpacks a row into `assignment`
        # too -- so the loop silently rebound it. On an empty database that
        # raised UnboundLocalError; on PRODUCTION, where both exist, it would
        # not have raised at all, it would have mixed one assignment's
        # attempts into the other's upload list.
        named_assignment = db.get(Assignment, ASSIGNMENT_ID)
        named_targets: list = []
        named_attempts: list = []
        if not named_assignment:
            print("  Not found. Already gone, or the id is wrong.")
        else:
            activity = db.get(LearningActivity, named_assignment.learning_activity_id)
            school = db.get(School, named_assignment.school_id)
            named_targets = (
                db.query(AssignmentTarget)
                .filter(AssignmentTarget.assignment_id == named_assignment.id)
                .all()
            )
            target_ids = [t.id for t in named_targets]
            named_attempts = (
                db.query(Attempt).filter(Attempt.assignment_target_id.in_(target_ids)).all()
                if target_ids
                else []
            )
            attempt_ids = [a.id for a in named_attempts]
            answers = (
                db.query(func.count(AttemptAnswer.id))
                .filter(AttemptAnswer.attempt_id.in_(attempt_ids))
                .scalar()
                or 0
                if attempt_ids
                else 0
            )
            evals = (
                db.query(func.count(Evaluation.id))
                .filter(Evaluation.attempt_id.in_(attempt_ids))
                .scalar()
                or 0
                if attempt_ids
                else 0
            )
            print(f"  school:            {school.name if school else '?'}")
            print(f"  set:               {activity.title if activity else '?'}")
            print(f"  students targeted: {len(named_targets)}")
            print(f"  attempts:          {len(named_attempts)}")
            print(f"  answers:           {answers}")
            print(f"  evaluations:       {evals}")
            for a in named_attempts:
                target = next((t for t in named_targets if t.id == a.assignment_target_id), None)
                student = db.get(Student, target.student_id) if target else None
                print(f"    attempt {a.id} | {_who(db, student)} | status {a.status}")
            print("  Deleting the assignment cascades to targets, attempts, answers")
            print("  and evaluations (all ondelete=CASCADE). The set itself is RESTRICT,")
            print("  so it is NOT touched.")

        # --- 2. Mastery E practice attempts --------------------------------
        _rule(f"2. Practice attempts on a set whose title contains {ACTIVITY_HINT!r}")
        rows = (
            db.query(Attempt, Student, LearningActivity, Assignment, School)
            .join(AssignmentTarget, AssignmentTarget.id == Attempt.assignment_target_id)
            .join(Student, Student.id == AssignmentTarget.student_id)
            .join(Assignment, Assignment.id == AssignmentTarget.assignment_id)
            .join(LearningActivity, LearningActivity.id == Assignment.learning_activity_id)
            .join(School, School.id == Assignment.school_id)
            .filter(LearningActivity.title.ilike(f"%{ACTIVITY_HINT}%"))
            .all()
        )
        if not rows:
            print("  None found.")
        for attempt, student, p_activity, p_assignment, p_school in rows:
            answers = (
                db.query(func.count(AttemptAnswer.id))
                .filter(AttemptAnswer.attempt_id == attempt.id)
                .scalar()
                or 0
            )
            ev = db.query(Evaluation).filter(Evaluation.attempt_id == attempt.id).first()
            score = f"{ev.final_score} of {ev.max_score}" if ev else "not evaluated"
            print(f"  {attempt.id}")
            print(f"    student {_who(db, student)} | school {p_school.name}")
            print(f"    set {p_activity.title} | assignment {p_assignment.id}")
            print(f"    status {attempt.status} | answers {answers} | {score}")

        # --- 3. Uploads that would be orphaned ------------------------------
        _rule("3. Uploaded files on those attempts -- the bytes a delete leaves behind")
        attempt_ids_all = [r[0].id for r in rows] + [a.id for a in named_attempts]
        attachments = []
        if attempt_ids_all:
            attachments = (
                db.query(AnswerAttachment, AttemptAnswer)
                .join(AttemptAnswer, AttemptAnswer.id == AnswerAttachment.attempt_answer_id)
                .filter(AttemptAnswer.attempt_id.in_(set(attempt_ids_all)))
                .all()
            )
        if not attachments:
            print("  None.")
        for att, answer in attachments:
            print(f"  {att.filename} | {att.size_bytes} bytes | {att.page_count} page(s)")
            print(f"    attachment {att.id} on answer {answer.id}")
            print(f"    backend {att.storage_backend} | key {att.storage_key}")
        if attachments:
            print()
            print("  These rows cascade away with their answers, but the FILES they point")
            print("  at do not -- there is no foreign key to the stored bytes. A delete")
            print("  must take these storage keys too, or a child's PDF outlives the")
            print("  record of it.")

        # --- 4. The mock paper ---------------------------------------------
        _rule(f"4. Mock paper {MOCK_PAPER_TITLE!r}")
        try:
            from app.models import MockPaper, MockPaperAnswer, MockPaperSitting

            papers = (
                db.query(MockPaper).filter(MockPaper.title.ilike(f"%{MOCK_PAPER_TITLE}%")).all()
            )
            if not papers:
                print("  Not found.")
            for paper in papers:
                sittings = (
                    db.query(MockPaperSitting)
                    .filter(MockPaperSitting.paper_id == paper.id)
                    .all()
                )
                sitting_ids = [s.id for s in sittings]
                answers = (
                    db.query(func.count(MockPaperAnswer.id))
                    .filter(MockPaperAnswer.sitting_id.in_(sitting_ids))
                    .scalar()
                    or 0
                    if sitting_ids
                    else 0
                )
                mock_atts = (
                    db.query(func.count(AnswerAttachment.id))
                    .join(MockPaperAnswer, MockPaperAnswer.id == AnswerAttachment.mock_answer_id)
                    .filter(MockPaperAnswer.sitting_id.in_(sitting_ids))
                    .scalar()
                    or 0
                    if sitting_ids
                    else 0
                )
                school = db.get(School, paper.school_id) if getattr(paper, "school_id", None) else None
                print(f"  {paper.id} | {paper.title}")
                print(f"    school {school.name if school else '?'} | status {getattr(paper, 'status', '?')}")
                print(f"    sittings {len(sittings)} | answers {answers} | uploads {mock_atts}")
        except Exception as exc:  # noqa: BLE001
            print(f"  Could not read the mock paper tables: {exc}")
            print("  (model names differ -- tell me and I will correct the script)")

        # --- 5. Derived documents that a delete would NOT fix ---------------
        _rule("5. Derived documents for the students involved")
        print("   These key on student_id, not on the attempt, so a delete leaves them.")
        student_ids = {r[1].id for r in rows} | {t.student_id for t in named_targets}
        if not student_ids:
            print("  No students involved.")
        else:
            try:
                from app.models import ReportCard, StudentTermRecord, WeeklyReport

                for model, label in (
                    (ReportCard, "report cards"),
                    (StudentTermRecord, "term records"),
                    (WeeklyReport, "weekly reports"),
                ):
                    n = (
                        db.query(func.count(model.id))
                        .filter(model.student_id.in_(student_ids))
                        .scalar()
                        or 0
                    )
                    print(f"  {label}: {n}")
            except Exception as exc:  # noqa: BLE001
                print(f"  Could not read them: {exc}")

        # --- 6. Everything created since the cut-off ------------------------
        _rule(f"6. Everything created in these tables since {SINCE}")
        print("   Searching by DATE, not by title. An earlier version of this section")
        print("   matched titles against '%test%' and '%verification%' and returned 18")
        print("   rows, every one a FALSE POSITIVE: ordinary English contains the")
        print("   pattern -- 'Grea(test)', 'shor(test)' -- and 'Quotients, remainders")
        print("   and verification' is a real skill. Opening a set as a student starts")
        print("   an attempt, so anything from the 24-25 Nov live runs shows up here")
        print("   whatever it is called.")

        for label, model, when in (
            ("assignments", Assignment, Assignment.created_at),
            ("attempts", Attempt, Attempt.created_at),
            ("mock papers", MockPaper, MockPaper.created_at),
            ("mock sittings", MockPaperSitting, MockPaperSitting.created_at),
            ("answer attachments", AnswerAttachment, AnswerAttachment.created_at),
            ("stored files", StoredFile, StoredFile.created_at),
        ):
            try:
                n = db.query(func.count()).select_from(model).filter(when >= SINCE).scalar() or 0
            except Exception as exc:  # noqa: BLE001
                print(f"  {label}: could not read ({exc})")
                continue
            print(f"  {label}: {n}")

        print()
        print("  attempts since the cut-off, in full (IN_PROGRESS included -- an")
        print("  abandoned attempt is still a row, and still a child's half-done work):")
        recent = (
            db.query(Attempt, Student, LearningActivity, School)
            .join(AssignmentTarget, AssignmentTarget.id == Attempt.assignment_target_id)
            .join(Student, Student.id == AssignmentTarget.student_id)
            .join(Assignment, Assignment.id == AssignmentTarget.assignment_id)
            .join(LearningActivity, LearningActivity.id == Assignment.learning_activity_id)
            .join(School, School.id == Assignment.school_id)
            .filter(Attempt.created_at >= SINCE)
            .order_by(Attempt.created_at)
            .all()
        )
        if not recent:
            print("    none")
        for attempt, student, activity, school in recent:
            print(f"    {attempt.created_at:%d %b %H:%M} | {attempt.status:12s} | {school.name}")
            print(f"      {activity.title} | {_who(db, student)} | {attempt.id}")

        # --- 7. Stored bytes with no attachment row -------------------------
        _rule("7. Stored files with no attachment row pointing at them")
        print("   A replaced upload drops the old file through attachment_service._drop,")
        print("   but if anything ever failed mid-way the bytes would sit here with")
        print("   nothing referencing them -- a child's PDF with no record.")
        try:
            referenced = db.query(AnswerAttachment.storage_key).subquery()
            orphan_files = (
                db.query(StoredFile.key, StoredFile.created_at)
                .filter(StoredFile.key.notin_(db.query(referenced.c.storage_key)))
                .order_by(StoredFile.created_at.desc())
                .limit(25)
                .all()
            )
            total_files = db.query(func.count()).select_from(StoredFile).scalar() or 0
            print(f"  stored files in all: {total_files}")
            if not orphan_files:
                print("  orphans: none -- every stored file has an attachment row.")
            else:
                print(f"  orphans: {len(orphan_files)} (showing up to 25)")
                for key, created in orphan_files:
                    print(f"    {created:%d %b %H:%M} | {key}")
        except Exception as exc:  # noqa: BLE001
            print(f"  Could not check: {exc}")

        # --- 8. The exact delete target -------------------------------------
        _rule("8. Assignments to delete, in full -- this is the target list")
        print("   Built from the database, not inferred from the attempt list. An")
        print("   assignment with NO attempt is still residue, and an assignment made")
        print("   BEFORE the cut-off can still hold an attempt made after it, so both")
        print("   are listed and the second kind is marked.")

        recent_assignments = (
            db.query(Assignment, LearningActivity, School)
            .join(LearningActivity, LearningActivity.id == Assignment.learning_activity_id)
            .join(School, School.id == Assignment.school_id)
            .filter(Assignment.created_at >= SINCE)
            .order_by(Assignment.created_at)
            .all()
        )
        older_with_recent_attempts = (
            db.query(Assignment, LearningActivity, School)
            .join(LearningActivity, LearningActivity.id == Assignment.learning_activity_id)
            .join(School, School.id == Assignment.school_id)
            .join(AssignmentTarget, AssignmentTarget.assignment_id == Assignment.id)
            .join(Attempt, Attempt.assignment_target_id == AssignmentTarget.id)
            .filter(Assignment.created_at < SINCE)
            .filter(Attempt.created_at >= SINCE)
            .distinct()
            .all()
        )

        def _describe(assignment, activity, school, *, note=""):
            targets = (
                db.query(func.count(AssignmentTarget.id))
                .filter(AssignmentTarget.assignment_id == assignment.id)
                .scalar()
                or 0
            )
            att = (
                db.query(Attempt)
                .join(AssignmentTarget, AssignmentTarget.id == Attempt.assignment_target_id)
                .filter(AssignmentTarget.assignment_id == assignment.id)
                .all()
            )
            answers = 0
            uploads = 0
            if att:
                ids = [a.id for a in att]
                answers = (
                    db.query(func.count(AttemptAnswer.id))
                    .filter(AttemptAnswer.attempt_id.in_(ids))
                    .scalar()
                    or 0
                )
                uploads = (
                    db.query(func.count(AnswerAttachment.id))
                    .join(AttemptAnswer, AttemptAnswer.id == AnswerAttachment.attempt_answer_id)
                    .filter(AttemptAnswer.attempt_id.in_(ids))
                    .scalar()
                    or 0
                )
            print(f"  {assignment.id}{note}")
            print(f"    {assignment.created_at:%d %b %H:%M} | {school.name} | {activity.title}")
            print(
                f"    targets {targets} | attempts {len(att)} "
                f"({', '.join(sorted({a.status for a in att})) or 'none'}) "
                f"| answers {answers} | uploads {uploads}"
            )

        if not recent_assignments and not older_with_recent_attempts:
            print("  none")
        for assignment, activity, school in recent_assignments:
            _describe(assignment, activity, school)
        for assignment, activity, school in older_with_recent_attempts:
            _describe(assignment, activity, school, note="   <-- MADE BEFORE THE CUT-OFF")

        print()
        print("  Deleting each of these cascades to its targets, attempts, answers and")
        print("  evaluations. Uploads need attachment_service._drop so the stored bytes")
        print("  go too. The SETS themselves are RESTRICT and are never touched.")

        # --- 9. Every remaining upload, named ------------------------------
        _rule("9. Every attachment still on production, and what it hangs off")
        print("   The loose end this closes: after the 24-25 Nov deletes, one")
        print("   stored PDF remained with an attachment row and nothing had")
        print("   placed it. An attachment hangs off EITHER a practice answer")
        print("   or a mock paper answer, never both, so both paths are read.")

        remaining = db.query(AnswerAttachment).order_by(AnswerAttachment.created_at).all()
        if not remaining:
            print("   none -- no uploads left on production at all.")
        for att in remaining:
            student = db.get(Student, att.student_id)
            where = "unplaced"
            detail = ""
            if att.attempt_answer_id:
                answer = db.get(AttemptAnswer, att.attempt_answer_id)
                attempt = db.get(Attempt, answer.attempt_id) if answer else None
                target = db.get(AssignmentTarget, attempt.assignment_target_id) if attempt else None
                assignment = db.get(Assignment, target.assignment_id) if target else None
                activity = (
                    db.get(LearningActivity, assignment.learning_activity_id)
                    if assignment
                    else None
                )
                school = db.get(School, assignment.school_id) if assignment else None
                where = "practice"
                detail = (
                    f"{getattr(school, 'name', '?')} | {getattr(activity, 'title', '?')} | "
                    f"attempt {getattr(attempt, 'id', '?')} ({getattr(attempt, 'status', '?')})"
                )
            elif att.mock_answer_id:
                from app.models import MockPaperAnswer

                answer = db.get(MockPaperAnswer, att.mock_answer_id)
                sitting = db.get(MockPaperSitting, answer.sitting_id) if answer else None
                paper = db.get(MockPaper, sitting.paper_id) if sitting else None
                school = db.get(School, paper.school_id) if paper else None
                where = "mock paper"
                detail = (
                    f"{getattr(school, 'name', '?')} | {getattr(paper, 'title', '?')} | "
                    f"sitting {getattr(sitting, 'id', '?')}"
                )
            print(f"   {att.created_at:%d %b %H:%M} | {where} | {att.filename} "
                  f"({att.size_bytes} bytes)")
            print(f"     {_who(db, student)} | {detail}")
            print(f"     attachment {att.id} | key {att.storage_key}")

        total_files = db.query(func.count()).select_from(StoredFile).scalar() or 0
        print()
        print(f"   stored files: {total_files} | attachment rows: {len(remaining)}")
        if total_files != len(remaining):
            print("   THESE DO NOT MATCH -- section 7 lists any file with no row.")

        print()
        print("Read-only: nothing was written.")
        return 0


def main() -> int:
    db = SessionLocal()
    try:
        return report(db)
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
