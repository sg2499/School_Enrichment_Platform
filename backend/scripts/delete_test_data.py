"""Delete the verification residue from 24-25 Nov 2026. IRREVERSIBLE.

Dry run by default. Nothing is written without --apply.

    python scripts/delete_test_data.py                     # dry run
    python scripts/delete_test_data.py --apply --expect-attempts 7 --expect-answers 21

WHAT IT DELETES

Exactly the assignment ids in DEFAULT_TARGETS and nothing else. There is no
title matching anywhere in this script: an earlier report matched '%test%'
and returned 18 real curriculum sets, because 'Greatest' and 'shortest'
contain the word. Ids only.

Deleting an Assignment cascades to its AssignmentTargets, their Attempts,
those Attempts' AttemptAnswers and Evaluations, and any AnswerAttachment row.
The LearningActivity is ondelete=RESTRICT and is never touched, so the SETS
survive -- only the fact that they were handed to a child goes.

WHAT NEEDS MORE THAN A CASCADE

`answer_attachments` carries `storage_backend` and `storage_key`, not a
foreign key to the bytes. So the row cascades and the FILE stays. This script
calls `attachment_service._drop`, the same helper the product uses when a
child replaces an upload, which deletes the stored bytes and then the row
through whichever storage backend the attachment names. Hand-rolling that
delete would have missed the LocalFolderStorage case.

WHAT IS DELIBERATELY NOT IN SCOPE

Assignment `2aeeaf52-913b-4afa-badc-f38942dc86ea` (Measurement -- Fluency A,
ABC Public School) was created **19 Nov 2026**, five days before the
verification runs, and holds an EVALUATED attempt with 17 answers that
predates them. It is residue by the look of it, but it was never on the
cleanup list and its evaluated attempt is not from this window, so it is NOT
a default target. Pass it to --assignments explicitly to include it.

The "A-013 Verification Paper" mock paper is also not here: #228 (PR #194)
already gives the school admin a delete for an approved or sat paper, with an
audit event and a typed confirmation. The product's own path is better than
anything this script would do.

HOW IT PROTECTS ITSELF

  * One transaction. Any mismatch rolls the whole thing back.
  * The audit file is written BEFORE the delete and must be OUTSIDE the repo;
    it holds every row and the PDF bytes, base64-encoded. The script refuses
    to run if that path is inside the working tree -- the last audit file
    sat untracked in backend/, and this one holds a child's answers.
  * --expect-attempts and --expect-answers must match what the dry run found,
    or --apply refuses before touching anything.
  * After deleting, it recounts. If anything survives, or any count differs
    from the prediction, it rolls back and says so.
  * A storage key shared by another attachment outside the scope is refused
    rather than deleted.
  * It prints the live ON DELETE rules from pg_constraint, not from the model
    files -- the real rules come from Alembic migrations.
"""

import argparse
import base64
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import func, text

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
    Student,
    User,
)
from app.services import attachment_service

# The five assignments created during the 24 Nov verification runs.
DEFAULT_TARGETS = (
    "15836681-7332-41eb-a7d6-fb035c4f6adf",  # ABC, Measurement -- Mastery A
    "00543f4d-a01e-4ad9-892a-ee48249304de",  # ABC, Measurement -- Guided Practice A
    "2aa992fb-bf60-488b-82c2-5d0c2dd29516",  # Krama Demo, We the Travellers I -- Chapter Mastery
    "54f234a2-08bb-4d0e-b06e-76516cfefa00",  # Krama Demo, We the Travellers I -- Case Study
    "92d9d4bd-e363-48c7-b5ec-aaa5c45c0b4c",  # ABC, Measurement -- Mastery E (2 uploads)
)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def _who(db, student) -> str:
    if student is None:
        return "?"
    name = None
    if getattr(student, "user_id", None):
        user = db.get(User, student.user_id)
        name = getattr(user, "full_name", None)
    code = getattr(student, "student_code", None) or student.id
    return f"{name} ({code})" if name else str(code)


def collect(db, assignment_ids: list[str]) -> dict:
    """Everything that would go, read out in full. No writes."""
    out = {
        "takenAt": datetime.now(UTC).isoformat(),
        "assignmentIds": assignment_ids,
        "assignments": [],
        "counts": {
            "assignments": 0,
            "targets": 0,
            "attempts": 0,
            "answers": 0,
            "evaluations": 0,
            "attachments": 0,
        },
        "missing": [],
    }
    for assignment_id in assignment_ids:
        assignment = db.get(Assignment, assignment_id)
        if assignment is None:
            out["missing"].append(assignment_id)
            continue
        activity = db.get(LearningActivity, assignment.learning_activity_id)
        school = db.get(School, assignment.school_id)
        targets = (
            db.query(AssignmentTarget)
            .filter(AssignmentTarget.assignment_id == assignment.id)
            .all()
        )
        record = {
            "id": assignment.id,
            "createdAt": assignment.created_at.isoformat() if assignment.created_at else None,
            "school": school.name if school else None,
            "set": activity.title if activity else None,
            "learningActivityId": assignment.learning_activity_id,
            "targets": [],
        }
        for target in targets:
            student = db.get(Student, target.student_id)
            attempts = (
                db.query(Attempt).filter(Attempt.assignment_target_id == target.id).all()
            )
            target_record = {
                "id": target.id,
                "studentId": target.student_id,
                "student": _who(db, student),
                "attempts": [],
            }
            for attempt in attempts:
                answers = (
                    db.query(AttemptAnswer)
                    .filter(AttemptAnswer.attempt_id == attempt.id)
                    .all()
                )
                evaluation = (
                    db.query(Evaluation).filter(Evaluation.attempt_id == attempt.id).first()
                )
                attempt_record = {
                    "id": attempt.id,
                    "status": attempt.status,
                    "attemptNumber": attempt.attempt_number,
                    "createdAt": attempt.created_at.isoformat() if attempt.created_at else None,
                    "evaluation": None,
                    "answers": [],
                }
                if evaluation:
                    attempt_record["evaluation"] = {
                        "id": evaluation.id,
                        "finalScore": evaluation.final_score,
                        "maxScore": evaluation.max_score,
                    }
                    out["counts"]["evaluations"] += 1
                for answer in answers:
                    attachment = (
                        db.query(AnswerAttachment)
                        .filter(AnswerAttachment.attempt_answer_id == answer.id)
                        .first()
                    )
                    answer_record = {
                        "id": answer.id,
                        "questionId": answer.question_id,
                        "responseText": answer.response_text,
                        "manualScore": getattr(answer, "manual_score", None),
                        "autoScore": getattr(answer, "auto_score", None),
                        "gradingNote": getattr(answer, "grading_note", None),
                        "attachment": None,
                    }
                    if attachment:
                        # The bytes go in the record, not just the metadata.
                        # Without them this file cannot restore a child's work,
                        # and then it is a receipt rather than a record.
                        raw = None
                        try:
                            raw = attachment_service.read_bytes(db, attachment)
                        except Exception as exc:  # noqa: BLE001
                            answer_record["attachmentReadError"] = str(exc)
                        answer_record["attachment"] = {
                            "id": attachment.id,
                            "filename": attachment.filename,
                            "sizeBytes": attachment.size_bytes,
                            "pageCount": attachment.page_count,
                            "sha256": attachment.sha256,
                            "storageBackend": attachment.storage_backend,
                            "storageKey": attachment.storage_key,
                            "base64": base64.b64encode(raw).decode() if raw else None,
                        }
                        out["counts"]["attachments"] += 1
                    attempt_record["answers"].append(answer_record)
                    out["counts"]["answers"] += 1
                target_record["attempts"].append(attempt_record)
                out["counts"]["attempts"] += 1
            record["targets"].append(target_record)
            out["counts"]["targets"] += 1
        out["assignments"].append(record)
        out["counts"]["assignments"] += 1
    return out


def _shared_storage_keys(db, plan: dict, assignment_ids: list[str]) -> list[str]:
    """Storage keys that some attachment OUTSIDE the scope also points at.

    One file per answer is the rule, so this should always be empty -- but a
    key deleted while another row still references it would leave that row
    pointing at nothing, and a child's PDF would 404 rather than download.
    Cheap to check, and the consequence of not checking lands on a different
    child than the one being cleaned up.
    """
    in_scope_attachment_ids = set()
    keys = {}
    for assignment in plan["assignments"]:
        for target in assignment["targets"]:
            for attempt in target["attempts"]:
                for answer in attempt["answers"]:
                    att = answer.get("attachment")
                    if att:
                        in_scope_attachment_ids.add(att["id"])
                        keys[att["storageKey"]] = att["id"]
    if not keys:
        return []
    shared = (
        db.query(AnswerAttachment.storage_key)
        .filter(AnswerAttachment.storage_key.in_(list(keys)))
        .filter(AnswerAttachment.id.notin_(in_scope_attachment_ids))
        .distinct()
        .all()
    )
    return [row[0] for row in shared]


def _print_live_fk_rules(db) -> None:
    """The ON DELETE rules as the DATABASE has them, not as the models say.

    The live constraints come from Alembic migrations. Reading a few model
    files and assuming they match is how a cascade gets believed into
    existence.
    """
    tables = (
        "assignment_targets",
        "attempts",
        "attempt_answers",
        "evaluations",
        "answer_attachments",
    )
    try:
        rows = db.execute(
            text(
                """
                SELECT c.conrelid::regclass::text AS child,
                       c.confrelid::regclass::text AS parent,
                       c.conname,
                       CASE c.confdeltype
                            WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
                            WHEN 'c' THEN 'CASCADE'   WHEN 'n' THEN 'SET NULL'
                            WHEN 'd' THEN 'SET DEFAULT' ELSE c.confdeltype::text
                       END AS on_delete
                FROM pg_constraint c
                WHERE c.contype = 'f'
                  AND c.conrelid::regclass::text = ANY(:tables)
                ORDER BY child, parent
                """
            ),
            {"tables": list(tables)},
        ).all()
    except Exception as exc:  # noqa: BLE001
        print(f"  (could not read pg_constraint: {exc} -- not Postgres?)")
        return
    if not rows:
        print("  (no constraints found)")
        return
    for child, parent, name, on_delete in rows:
        flag = "" if on_delete in {"CASCADE", "SET NULL"} else "   <-- NOT a cascade"
        print(f"  {child} -> {parent}: ON DELETE {on_delete}{flag}  ({name})")


def _summarise(plan: dict) -> None:
    counts = plan["counts"]
    print(f"  assignments  {counts['assignments']}")
    print(f"  targets      {counts['targets']}")
    print(f"  attempts     {counts['attempts']}")
    print(f"  answers      {counts['answers']}")
    print(f"  evaluations  {counts['evaluations']}")
    print(f"  attachments  {counts['attachments']}")
    if plan["missing"]:
        print(f"  NOT FOUND (already gone?): {', '.join(plan['missing'])}")
    print()
    for assignment in plan["assignments"]:
        print(f"  {assignment['id']}")
        print(f"    {assignment['createdAt']} | {assignment['school']} | {assignment['set']}")
        for target in assignment["targets"]:
            for attempt in target["attempts"]:
                ev = attempt["evaluation"]
                score = f"{ev['finalScore']} of {ev['maxScore']}" if ev else "not evaluated"
                uploads = sum(1 for a in attempt["answers"] if a["attachment"])
                print(
                    f"      attempt {attempt['id'][:8]} | {target['student']} | "
                    f"{attempt['status']} | answers {len(attempt['answers'])} | "
                    f"{score} | uploads {uploads}"
                )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="actually delete (default: dry run)")
    parser.add_argument(
        "--assignments",
        default=",".join(DEFAULT_TARGETS),
        help="comma-separated assignment ids. Default: the five from 24 Nov.",
    )
    parser.add_argument("--expect-attempts", type=int, default=None)
    parser.add_argument("--expect-answers", type=int, default=None)
    parser.add_argument(
        "--audit",
        default=None,
        help="where to write the full record. Must be OUTSIDE the repo. "
        "Default: a timestamped file in your home folder.",
    )
    args = parser.parse_args()

    ids = [i.strip() for i in args.assignments.split(",") if i.strip()]
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    audit_path = Path(args.audit) if args.audit else Path.home() / f"se_delete_audit_{stamp}.json"
    audit_path = audit_path.expanduser().resolve()
    if REPO_ROOT in audit_path.parents or audit_path == REPO_ROOT:
        print(f"Refusing: the audit file would be inside the repo ({audit_path}).")
        print("It holds a child's answers and their uploaded PDF. Put it outside.")
        return 2

    db = SessionLocal()
    try:
        print(f"Targets ({len(ids)}):")
        for i in ids:
            print(f"  {i}")

        print()
        print("Live ON DELETE rules, read from pg_constraint:")
        _print_live_fk_rules(db)

        print()
        print("What would go:")
        plan = collect(db, ids)
        _summarise(plan)

        shared = _shared_storage_keys(db, plan, ids)
        if shared:
            print()
            print("REFUSING: these storage keys are also referenced by an attachment")
            print("outside the scope, so deleting the bytes would break that row:")
            for key in shared:
                print(f"  {key}")
            return 2

        if not args.apply:
            print()
            print("Dry run -- nothing was written, and no audit file was created.")
            print("To delete, re-run as:")
            # The suggested command MUST carry --assignments. An earlier
            # version left it out, so copying the line verbatim silently fell
            # back to DEFAULT_TARGETS instead of the ids actually being
            # reported. The --expect guard caught it that time because the
            # defaults were already deleted and the counts came to 0 -- but
            # had they still existed and happened to match, this would have
            # deleted the wrong assignments while looking obedient.
            print(
                f"    python scripts/delete_test_data.py --apply "
                f'--assignments "{",".join(ids)}" '
                f"--expect-attempts {plan['counts']['attempts']} "
                f"--expect-answers {plan['counts']['answers']}"
            )
            return 0

        if args.apply and plan["missing"] and len(plan["missing"]) == len(ids):
            print()
            print("Refusing: every id given is already gone, so this scope is stale.")
            print("You are probably running the DEFAULT targets by accident --")
            print("--apply needs the same --assignments the dry run reported on.")
            return 2

        if args.expect_attempts is None or args.expect_answers is None:
            print()
            print("Refusing: --apply needs --expect-attempts and --expect-answers,")
            print("set to the numbers the dry run printed.")
            return 2
        if (
            args.expect_attempts != plan["counts"]["attempts"]
            or args.expect_answers != plan["counts"]["answers"]
        ):
            print()
            print(
                f"Refusing: you passed {args.expect_attempts} attempts and "
                f"{args.expect_answers} answers, but there are now "
                f"{plan['counts']['attempts']} and {plan['counts']['answers']}."
            )
            print("Re-run the dry run, read it, and pass what it prints.")
            return 2

        # The record goes out BEFORE anything is deleted, so it survives a
        # failure half way through.
        audit_path.write_text(json.dumps(plan, indent=2), encoding="utf-8")
        print()
        print(f"Record written: {audit_path}")
        print(f"  {audit_path.stat().st_size} bytes, including the PDF bytes base64-encoded.")
        print("  KEEP IT. This is the only way back.")

        # --- the delete, in one transaction --------------------------------
        attachment_rows = []
        for assignment in plan["assignments"]:
            for target in assignment["targets"]:
                for attempt in target["attempts"]:
                    for answer in attempt["answers"]:
                        att = answer.get("attachment")
                        if att:
                            row = db.get(AnswerAttachment, att["id"])
                            if row is not None:
                                attachment_rows.append(row)

        # Uploads first, through the product's own helper: it deletes the
        # stored bytes and then the row, for whichever backend the attachment
        # names. Doing it by hand would have handled only `database`.
        for row in attachment_rows:
            attachment_service._drop(db, row)

        for assignment_id in [a["id"] for a in plan["assignments"]]:
            assignment = db.get(Assignment, assignment_id)
            if assignment is not None:
                db.delete(assignment)
        db.flush()

        # Recount inside the transaction, before committing.
        problems = []
        for assignment in plan["assignments"]:
            if db.get(Assignment, assignment["id"]) is not None:
                problems.append(f"assignment {assignment['id']} survived")
            for target in assignment["targets"]:
                if db.get(AssignmentTarget, target["id"]) is not None:
                    problems.append(f"target {target['id']} survived")
                for attempt in target["attempts"]:
                    if db.get(Attempt, attempt["id"]) is not None:
                        problems.append(f"attempt {attempt['id']} survived")
                    for answer in attempt["answers"]:
                        if db.get(AttemptAnswer, answer["id"]) is not None:
                            problems.append(f"answer {answer['id']} survived")
                        att = answer.get("attachment")
                        if att:
                            if db.get(AnswerAttachment, att["id"]) is not None:
                                problems.append(f"attachment {att['id']} survived")
                            still = db.query(
                                func.count()
                            ).select_from(AnswerAttachment).filter(
                                AnswerAttachment.storage_key == att["storageKey"]
                            ).scalar()
                            if still:
                                problems.append(f"storage key still referenced: {att['storageKey']}")

        if problems:
            db.rollback()
            print()
            print("ROLLED BACK. Nothing was deleted. What did not go:")
            for problem in problems[:20]:
                print(f"  {problem}")
            return 1

        db.commit()
        print()
        print(
            f"Deleted: {plan['counts']['assignments']} assignments, "
            f"{plan['counts']['targets']} targets, {plan['counts']['attempts']} attempts, "
            f"{plan['counts']['answers']} answers, {plan['counts']['evaluations']} evaluations, "
            f"{plan['counts']['attachments']} uploads and their stored bytes."
        )
        print("The practice SETS themselves were not touched.")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
