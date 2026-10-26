"""Records Ashalatha's review of the misconception notes (Q14).

Why this exists (26 Oct 2026). She decided that a misconception note is
reviewed (accuracy, neutral language, a next step) before it appears on a
teacher's Class Analytics. Until then the dashboard shows each one only as
waiting for review. She reviews "SE_Class_5_Misconception_Notes_Review.xlsx",
one row per skill, and this script records her decisions as
MisconceptionReview rows.

The sheet ("Misconception Notes"):

  Skill ID | Chapter No | Chapter | Skill | Questions | Current Note |
  Sample Question | Proposed Note | Proposed Next Step | Our Flag | Why |
  Decision | Your Note | Your Next Step | Comments

  * Decision: Approve shows the Proposed Note and Next Step; Change shows
    hers (an empty Your Next Step keeps the proposed one); Reject keeps the
    note off the dashboard for good. A row with no decision stays waiting.

What it does, and why it is safe to run:

  * Checks every row before anything is written: the Skill ID names exactly
    one skill, and the Current Note is still the note on that skill's
    questions (a review is tied to the note she read: if a question's note
    changes later, the new one waits for review). If any row fails, it
    stops and changes nothing, listing every problem.
  * Without --apply it only reports what would change.
  * With --apply it writes in ONE transaction with one audit-log entry
    ("curriculum.misconception_reviews.applied").
  * Running it again is harmless; running it with a later sheet replaces a
    skill's earlier decision.

Usage (from backend/, DATABASE_URL set to the production database):
    python scripts/apply_misconception_reviews.py --workbook "C:\\path\\to\\SE_Class_5_Misconception_Notes_Reviewed.xlsx"
    python scripts/apply_misconception_reviews.py --workbook "..." --apply
"""
from __future__ import annotations

import argparse
import hashlib
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

SHEET = "Misconception Notes"
COLUMNS = {
    "code": "Skill ID",
    "current": "Current Note",
    "proposed": "Proposed Note",
    "proposed_step": "Proposed Next Step",
    "decision": "Decision",
    "yours": "Your Note",
    "your_step": "Your Next Step",
}
AUDIT_EVENT = "curriculum.misconception_reviews.applied"
REVIEWER = "Ashalatha Gupta"
DECISIONS = {"approve": "Approve", "change": "Change", "reject": "Reject"}
MAX_NOTE = 400


class StopBeforeWriting(Exception):
    """Something that must stop the run before it changes anything."""


@dataclass(frozen=True)
class Row:
    row: int
    code: str
    current: str
    decision: str
    note: str | None
    next_step: str | None

    @property
    def status(self) -> str:
        return "REJECTED" if self.decision == "Reject" else "APPROVED"


@dataclass
class Plan:
    to_write: list = field(default_factory=list)  # (skill, Row, existing review or None)
    already_set: int = 0


def _text(value) -> str:
    return "" if value is None else " ".join(str(value).split())


def read_rows(path: str) -> tuple[list[Row], int]:
    import openpyxl

    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    if SHEET not in workbook.sheetnames:
        raise StopBeforeWriting(f'The workbook has no "{SHEET}" sheet.')
    rows = workbook[SHEET].iter_rows(values_only=True)
    header = [_text(cell) for cell in next(rows, ())]
    missing = [name for name in COLUMNS.values() if name not in header]
    if missing:
        raise StopBeforeWriting(f'The "{SHEET}" sheet has no column {", ".join(missing)}.')
    index = {key: header.index(name) for key, name in COLUMNS.items()}
    out, problems, seen, undecided = [], [], set(), 0
    for number, values in enumerate(rows, start=2):
        cell = {key: (values[i] if i < len(values) else None) for key, i in index.items()}
        code = _text(cell["code"])
        if not code:
            continue
        where = f"Row {number} ({code})"
        if code in seen:
            problems.append(f"{where}: this skill appears more than once.")
            continue
        seen.add(code)
        choice = _text(cell["decision"])
        if not choice:
            undecided += 1
            continue
        decision = DECISIONS.get(choice.casefold())
        if decision is None:
            problems.append(f"{where}: Decision is {choice}, not Approve, Change or Reject.")
            continue
        current = _text(cell["current"])
        if not current:
            problems.append(f"{where}: Current Note is empty.")
            continue
        note = step = None
        if decision == "Approve":
            note, step = _text(cell["proposed"]), _text(cell["proposed_step"])
        elif decision == "Change":
            note = _text(cell["yours"])
            step = _text(cell["your_step"]) or _text(cell["proposed_step"])
            if not note:
                problems.append(f"{where}: Decision is Change, but Your Note is empty.")
                continue
        if decision != "Reject":
            if not note:
                problems.append(f"{where}: there is no note to show.")
                continue
            if len(note) > MAX_NOTE or len(step or "") > MAX_NOTE:
                problems.append(f"{where}: the note or next step is longer than {MAX_NOTE} characters.")
                continue
        out.append(Row(number, code, current, decision, note, step or None))
    workbook.close()
    if problems:
        raise StopBeforeWriting("\n".join(problems))
    return out, undecided


def make_plan(db, rows: list[Row], *, lock: bool = False) -> Plan:
    from app.models import ConceptLesson, MisconceptionReview, Question
    from app.services.analytics_service import tag_key

    plan = Plan()
    problems: list[str] = []
    found: dict[str, list] = {}
    for lesson in db.query(ConceptLesson).filter(ConceptLesson.code.in_([r.code for r in rows])):
        found.setdefault(lesson.code, []).append(lesson)
    skills = {code: lessons[0] for code, lessons in found.items() if len(lessons) == 1}
    tags: dict[str, set[str]] = {}
    for skill_id, tag in db.query(Question.concept_lesson_id, Question.misconception_tag).filter(
        Question.concept_lesson_id.in_([s.id for s in skills.values()])
    ):
        if tag_key(tag):
            tags.setdefault(skill_id, set()).add(tag_key(tag))
    query = db.query(MisconceptionReview).filter(MisconceptionReview.concept_lesson_id.in_([s.id for s in skills.values()]))
    if lock:
        query = query.with_for_update()
    existing = {(r.concept_lesson_id, r.tag_key): r for r in query}
    for row in rows:
        if row.code not in found:
            problems.append(f"{row.code}: no skill on the platform has this Skill ID.")
            continue
        if row.code not in skills:
            problems.append(f"{row.code}: more than one skill has this Skill ID, so it can't be matched safely.")
            continue
        skill = skills[row.code]
        key = tag_key(row.current)
        if key not in tags.get(skill.id, set()):
            problems.append(f"{row.code}: no question of this skill has the Current Note any more, so it is left for a fresh look.")
            continue
        review = existing.get((skill.id, key))
        if review is not None and (review.status, review.shown_note, review.next_step) == (row.status, row.note, row.next_step):
            plan.already_set += 1
        else:
            plan.to_write.append((skill, row, key, review))
    if problems:
        raise StopBeforeWriting("\n".join(problems))
    return plan


def apply_plan(db, plan: Plan, *, workbook_name: str, workbook_sha256: str) -> None:
    from app.models import MisconceptionReview
    from app.services.audit_service import log_audit_event

    changes = []
    for skill, row, key, review in plan.to_write:
        changes.append(
            {
                "skill": row.code,
                "decision": row.decision,
                "old": [review.status, review.shown_note, review.next_step] if review else None,
                "new": [row.status, row.note, row.next_step],
            }
        )
        if review is None:
            review = MisconceptionReview(concept_lesson_id=skill.id, tag_key=key)
            db.add(review)
        review.status = row.status
        review.shown_note = row.note
        review.next_step = row.next_step
        review.reviewed_by = REVIEWER
        review.workbook_sha256 = workbook_sha256
    log_audit_event(
        db,
        AUDIT_EVENT,
        details={
            "workbook": workbook_name,
            "workbookSha256": workbook_sha256,
            "skillsWritten": len(changes),
            "skillsAlreadySet": plan.already_set,
            "changes": changes,
        },
    )
    db.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--workbook", required=True, help="Ashalatha's reviewed workbook (.xlsx).")
    parser.add_argument("--apply", action="store_true", help="Write the changes. Without it, only report.")
    parser.add_argument("--yes", action="store_true", help="With --apply, skip the typed confirmation.")
    args = parser.parse_args()

    path = Path(args.workbook)
    if not path.is_file():
        print(f"Workbook not found: {path}")
        return 1
    sha256 = hashlib.sha256(path.read_bytes()).hexdigest()

    from app.database import SessionLocal, engine
    from scripts.apply_answer_units import mask_database_url

    db_url = str(engine.url)
    print(f"Target database: {mask_database_url(db_url)}")
    if "sqlite" in db_url:
        print("NOTE: DATABASE_URL is not set (or points at SQLite), so this is not production.")
    print(f"Workbook: {path.name} (SHA-256 {sha256[:12]}...)\n")

    db = SessionLocal()
    try:
        rows, undecided = read_rows(str(path))
        plan = make_plan(db, rows)
        choices = Counter(r.decision for r in rows)
        print(
            f"Skills decided: {len(rows)} ({choices['Approve']} Approve, {choices['Change']} Change, "
            f"{choices['Reject']} Reject); no decision yet: {undecided}"
        )
        print(f"Already as she decided: {plan.already_set}")
        print(f"To record: {len(plan.to_write)}")
        if not args.apply:
            print("\nReport only: nothing was written. Run again with --apply to record these.")
            return 0
        if not plan.to_write:
            print("\nNothing to change.")
            return 0
        if not args.yes and input(f"\nType YES to record {len(plan.to_write)} reviews: ").strip() != "YES":
            print("Stopped: nothing was written.")
            return 1
        db.rollback()
        plan = make_plan(db, rows, lock=True)
        apply_plan(db, plan, workbook_name=path.name, workbook_sha256=sha256)
        print(f"\nDone: {len(plan.to_write)} reviews recorded. Approved notes now show on Class Analytics.")
        return 0
    except StopBeforeWriting as stop:
        print(f"\nStopped before writing anything:\n{stop}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
