"""The weekly parent report (Phase 6, #187, 26 Oct 2026).

Decisions (Shailesh, 26 Oct 2026; PHASE6_WEEKLY_REPORT_DESIGN.md):

- The platform drafts every child's page for a week, Monday to Sunday in
  India. A teacher who teaches the section now, or the school admin,
  issues the whole section in one step; the page is kept exactly as issued.
  There is no email or WhatsApp sending: the school downloads one PDF for
  the section or one per child, and the child sees the page in their
  account.
- The page: each set given that week (set or due that week) with its
  status and score, the week's totals, the child's strong skills and skills
  to work on, and the teacher's notes. Never a class ranking.
- One note for the section, and an optional short note per child.

What counts as "given": practice a teacher or the school set for the child
(any subject), not cancelled, and not the child's own practice
(SELF_PRACTICE), which is counted separately as "practised on their own".
Statuses are as of when the page is made (drafted or issued), so a set done
late after the week ended shows as Done Late.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.models import (
    Assignment,
    AssignmentTarget,
    Attempt,
    AttemptAnswer,
    BoardCourse,
    Chapter,
    ClassLevel,
    Evaluation,
    LearningActivity,
    School,
    Student,
    TeacherSectionAssignment,
    WeeklyReport,
    WeeklyReportIssue,
    WeeklyReportNote,
)
from app.services import progress_service, report_card_service
from app.services.assessment_service import SCHOOL_TIMEZONE
from app.services.practice_access_service import Viewer

WEEKS_SHOWN = 12
MAX_NOTE = 300
SKILLS_SHOWN = 3
SELF_PRACTICE = "SELF_PRACTICE"
_HANDED_IN = ("SUBMITTED", "EVALUATED")
TITLE = "Weekly Practice Report"

# A set's status on the page.
DONE_ON_TIME = "DONE_ON_TIME"
DONE_LATE = "DONE_LATE"
DONE = "DONE"  # handed in; the set had no due date
NOT_DONE = "NOT_DONE"  # due date passed (or the set was closed) and not handed in
IN_PROGRESS = "IN_PROGRESS"
NOT_STARTED = "NOT_STARTED"
DONE_STATES = (DONE_ON_TIME, DONE_LATE, DONE)
STATUS_LABEL = {
    DONE_ON_TIME: "Done on Time",
    DONE_LATE: "Done Late",
    DONE: "Done",
    NOT_DONE: "Not Done",
    IN_PROGRESS: "Started",
    NOT_STARTED: "Not Started Yet",
}

ACTIVITY_LABEL = {
    "PREREQUISITE_CHECK": "Prerequisite Check",
    "CONCEPT_SIMPLE": "Concept",
    "CORE_PRACTICE": "Core Practice",
    "EXTRA_PRACTICE": "Extra Practice",
    "REMEDIATION": "Remediation",
    "CHALLENGE": "Challenge",
    "CASE_STUDY": "Case Study",
    "CHAPTER_MASTERY": "Chapter Mastery",
}


class WeeklyError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


# --- weeks -----------------------------------------------------------------------------


def today() -> date:
    return datetime.now(SCHOOL_TIMEZONE).date()


def monday_of(day: date) -> date:
    return day - timedelta(days=day.weekday())


def week_window(week_start: date) -> tuple[datetime, datetime]:
    """[start, end) of a week in India time, as aware datetimes."""
    start = datetime.combine(week_start, time.min, tzinfo=SCHOOL_TIMEZONE)
    return start, start + timedelta(days=7)


def _day_label(day: date) -> str:
    return f"{day.day} {day.strftime('%b %Y')}"


def week_label(week_start: date) -> str:
    end = week_start + timedelta(days=6)
    if week_start.year != end.year:
        return f"{_day_label(week_start)} to {_day_label(end)}"
    if week_start.month != end.month:
        return f"{week_start.day} {week_start.strftime('%b')} to {_day_label(end)}"
    return f"{week_start.day} to {_day_label(end)}"


def recent_weeks(now: date | None = None) -> list[dict]:
    """This week and the eleven before it, newest first."""
    current = monday_of(now or today())
    out = []
    for back in range(WEEKS_SHOWN):
        start = current - timedelta(weeks=back)
        out.append({"start": start.isoformat(), "label": week_label(start), "isCurrent": back == 0})
    return out


def default_week(now: date | None = None) -> date:
    """The week that ended most recently: on Monday to Friday last week; on
    Saturday and Sunday the week now ending (schools issue on Saturday)."""
    day = now or today()
    current = monday_of(day)
    return current if day.weekday() >= 5 else current - timedelta(weeks=1)


def parse_week(raw: str | None, now: date | None = None) -> date:
    if not raw:
        return default_week(now)
    try:
        start = date.fromisoformat(raw.strip()[:10])
    except ValueError:
        api_error(422, "VALIDATION_ERROR", "Choose a week from the list.")
    current = monday_of(now or today())
    if start.weekday() != 0 or start > current or start < current - timedelta(weeks=WEEKS_SHOWN - 1):
        api_error(422, "VALIDATION_ERROR", "Choose a week from the list.")
    return start


# --- who may see and change a section ---------------------------------------------------


@dataclass
class SectionAccess:
    class_level: ClassLevel
    section: str
    can_change: bool


def require_school(viewer: Viewer) -> str:
    if viewer.role == "SUPER_ADMIN" or not viewer.school_id:
        api_error(
            403, "FORBIDDEN",
            "Weekly reports belong to one school. Sign in as that school's admin or teacher to see them.",
        )
    return viewer.school_id


def _teacher_windows(db: Session, viewer: Viewer) -> list[TeacherSectionAssignment]:
    return (
        db.query(TeacherSectionAssignment)
        .filter(
            TeacherSectionAssignment.teacher_id == viewer.teacher.id,
            TeacherSectionAssignment.school_id == viewer.school_id,
        )
        .all()
    )


def _teaches_now(window: TeacherSectionAssignment, day: date) -> bool:
    return window.start_date <= day and (window.end_date is None or window.end_date > day)


def _overlaps(window: TeacherSectionAssignment, start: date, end: date) -> bool:
    """Whether a teaching window [start_date, end_date) touches [start, end]."""
    return window.start_date <= end and (window.end_date is None or window.end_date > start)


def sections(db: Session, viewer: Viewer) -> list[dict]:
    """The sections the viewer can open: an admin, every section of the
    school with students; a teacher, every section they teach now or taught
    in the weeks shown (any subject)."""
    school_id = require_school(viewer)
    now = today()
    all_weeks = [date.fromisoformat(w["start"]) for w in recent_weeks(now)]
    if not viewer.is_teacher:
        return [
            {
                "classLevelId": level.id, "classLevel": level.display_name, "section": sec, "canChange": True,
                "weeks": [w.isoformat() for w in all_weeks],
            }
            for level, sec in report_card_service.class_sections(db, school_id)
        ]
    found: dict[tuple[str, str], list[TeacherSectionAssignment]] = {}
    for w in _teacher_windows(db, viewer):
        found.setdefault((w.class_level_id, w.section), []).append(w)
    levels = {c.id: c for c in db.query(ClassLevel).filter(ClassLevel.id.in_({k[0] for k in found})).all()} if found else {}
    rows = []
    for (level_id, sec), windows in found.items():
        if level_id not in levels:
            continue
        can = any(_teaches_now(w, now) for w in windows)
        # The weeks they may open: every week while they teach it now; the
        # weeks they taught it, once they no longer do (#187 review).
        weeks = all_weeks if can else [s for s in all_weeks if _taught_in(windows, s)]
        if weeks:
            rows.append((levels[level_id], sec, can, weeks))
    rows.sort(key=lambda r: (r[0].display_order, r[1]))
    return [
        {
            "classLevelId": level.id, "classLevel": level.display_name, "section": sec, "canChange": can,
            "weeks": [w.isoformat() for w in weeks],
        }
        for level, sec, can, weeks in rows
    ]


def _taught_in(windows: list[TeacherSectionAssignment], week_start: date) -> bool:
    return any(_overlaps(w, week_start, week_start + timedelta(days=6)) for w in windows)


def access(db: Session, viewer: Viewer, class_level_id: str, section: str, week_start: date | None) -> SectionAccess:
    """A teacher may read a section's week if they taught it that week or
    teach it now; change it (notes, issue, withdraw) only if they teach it
    now. An admin may do both for their school. Anything else is a 404."""
    school_id = require_school(viewer)
    level = db.get(ClassLevel, class_level_id)
    section = (section or "").strip()
    if level is None or not section:
        api_error(404, "NOT_FOUND", "We couldn't find that section.")
    if not viewer.is_teacher:
        known = {(lv.id, sec) for lv, sec in report_card_service.class_sections(db, school_id)}
        has_issue = (
            db.query(WeeklyReportIssue.id)
            .filter(
                WeeklyReportIssue.school_id == school_id,
                WeeklyReportIssue.class_level_id == level.id,
                WeeklyReportIssue.section == section,
            )
            .first()
        )
        if (level.id, section) not in known and not has_issue:
            api_error(404, "NOT_FOUND", "We couldn't find that section.")
        return SectionAccess(level, section, True)
    now = today()
    windows = [w for w in _teacher_windows(db, viewer) if w.class_level_id == level.id and w.section == section]
    can_change = any(_teaches_now(w, now) for w in windows)
    can_read = can_change
    if week_start is not None and not can_read:
        can_read = _taught_in(windows, week_start)
    if not can_read:
        api_error(404, "NOT_FOUND", "We couldn't find that section.")
    return SectionAccess(level, section, can_change)


def require_live(acc: SectionAccess) -> None:
    """Drafts and previews are the children's work as of today: only for
    those who teach the section now (or the admin). A former teacher reads
    issued pages only (#187 review, DPDP: no more than is needed)."""
    if not acc.can_change:
        api_error(403, "FORBIDDEN", "You no longer teach this section, so you can read the pages issued while you did.")


def lock_school(db: Session, school_id: str) -> None:
    """Serialises issuing and note saving within a school. FOR NO KEY
    UPDATE, so ordinary inserts that point at the school don't wait
    (#187 review)."""
    db.query(School).filter(School.id == school_id).with_for_update(key_share=True).first()


def require_change(acc: SectionAccess) -> None:
    if not acc.can_change:
        api_error(403, "FORBIDDEN", "You no longer teach this section, so you can read its reports but not change them.")


# --- notes -------------------------------------------------------------------------------


def _notes_query(db: Session, school_id: str, class_level_id: str, section: str, week_start: date):
    return db.query(WeeklyReportNote).filter(
        WeeklyReportNote.school_id == school_id,
        WeeklyReportNote.class_level_id == class_level_id,
        WeeklyReportNote.section == section,
        WeeklyReportNote.week_start == week_start,
    )


def notes_for(db: Session, school_id: str, class_level_id: str, section: str, week_start: date) -> tuple[str | None, dict[str, str]]:
    section_note = None
    child: dict[str, str] = {}
    for n in _notes_query(db, school_id, class_level_id, section, week_start).all():
        if n.student_id is None:
            section_note = n.note
        else:
            child[n.student_id] = n.note
    return section_note, child


def clean_note(text: str | None, who: str) -> str | None:
    text = " ".join((text or "").split())
    if len(text) > MAX_NOTE:
        raise WeeklyError(f"The note for {who} must be {MAX_NOTE} characters or fewer.")
    return text or None


def save_notes(
    db: Session,
    *,
    school_id: str,
    class_level_id: str,
    section: str,
    week_start: date,
    section_note: str | None,
    child_notes: dict[str, str | None],
    allowed_student_ids: set[str],
    user_id: str,
    update_section: bool,
) -> int:
    """Saves the section note (when update_section) and the given children's
    notes; an empty note removes it. A note for a child who has left the
    section since the page loaded is skipped. Returns how many changed."""
    lock_school(db, school_id)
    if current_issue(db, school_id=school_id, class_level_id=class_level_id, section=section, week_start=week_start):
        raise WeeklyError("This week is already issued. Withdraw it first to change its notes.")
    child_notes = {sid: text for sid, text in child_notes.items() if sid in allowed_student_ids}
    existing = {n.student_id: n for n in _notes_query(db, school_id, class_level_id, section, week_start).all()}
    wanted: dict[str | None, str | None] = {}
    if update_section:
        wanted[None] = clean_note(section_note, "the section")
    for sid, text in child_notes.items():
        wanted[sid] = clean_note(text, "that student")
    changed = 0
    for sid, text in wanted.items():
        row = existing.get(sid)
        if text is None:
            if row is not None:
                db.delete(row)
                changed += 1
        elif row is None:
            db.add(
                WeeklyReportNote(
                    school_id=school_id, class_level_id=class_level_id, section=section, week_start=week_start,
                    student_id=sid, note=text, updated_by_user_id=user_id,
                )
            )
            changed += 1
        elif row.note != text:
            row.note = text
            row.updated_by_user_id = user_id
            changed += 1
    db.flush()
    return changed


# --- building the pages -------------------------------------------------------------------


@dataclass
class _Target:
    target_id: str
    student_id: str
    assignment: Assignment
    activity: LearningActivity
    subject: str | None
    chapter_no: int | None
    target_status: str
    attempts: list[tuple] = field(default_factory=list)  # (status, submitted_at, final, max, review_status)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _due(assignment: Assignment) -> date | None:
    raw = (assignment.due_date or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


def _given_targets(db: Session, student_ids: list[str], week_start: date) -> list[_Target]:
    """Teacher- or school-set practice for these students, set or due this
    week, not cancelled."""
    if not student_ids:
        return []
    start, end = week_window(week_start)
    first_day, last_day = week_start.isoformat(), (week_start + timedelta(days=6)).isoformat()
    due_day = func.substr(Assignment.due_date, 1, 10)
    rows = (
        db.query(AssignmentTarget, Assignment, LearningActivity, BoardCourse.display_name, Chapter.chapter_no)
        .join(Assignment, Assignment.id == AssignmentTarget.assignment_id)
        .join(LearningActivity, LearningActivity.id == Assignment.learning_activity_id)
        .outerjoin(Chapter, Chapter.id == LearningActivity.chapter_id)
        .outerjoin(BoardCourse, BoardCourse.id == Chapter.board_course_id)
        .filter(
            AssignmentTarget.student_id.in_(student_ids),
            Assignment.status != "CANCELLED",
            Assignment.reason != SELF_PRACTICE,
            # Excused by the teacher: not given (as the schemes treat it).
            AssignmentTarget.status != "SKIPPED",
            or_(
                and_(Assignment.created_at >= start, Assignment.created_at < end),
                and_(due_day >= first_day, due_day <= last_day),
            ),
        )
        .all()
    )
    targets = {
        t.id: _Target(t.id, t.student_id, a, act, subject, chapter_no, t.status)
        for t, a, act, subject, chapter_no in rows
    }
    if targets:
        attempts = (
            db.query(
                Attempt.assignment_target_id, Attempt.status, Attempt.submitted_at,
                Evaluation.final_score, Evaluation.max_score, Evaluation.review_status,
            )
            .outerjoin(Evaluation, Evaluation.attempt_id == Attempt.id)
            .filter(Attempt.assignment_target_id.in_(list(targets)))
            .all()
        )
        for target_id, status, submitted_at, final, max_score, review in attempts:
            targets[target_id].attempts.append((status, _aware(submitted_at), final, max_score, review))
    return list(targets.values())


def _set_row(target: _Target, now: date) -> dict:
    assignment = target.assignment
    due = _due(assignment)
    handed = [a for a in target.attempts if a[0] in _HANDED_IN]
    first_in = min((a[1] for a in handed if a[1] is not None), default=None)
    if handed:
        if due is None:
            status = DONE
        elif first_in is not None and first_in.astimezone(SCHOOL_TIMEZONE).date() > due:
            status = DONE_LATE
        else:
            status = DONE_ON_TIME
    elif assignment.status == "CLOSED" or (due is not None and due < now):
        status = NOT_DONE
    elif any(a[0] == "IN_PROGRESS" for a in target.attempts):
        status = IN_PROGRESS
    else:
        status = NOT_STARTED
    # The best handed-in attempt's marks, as the school's Best rule does.
    scored = [a for a in handed if a[2] is not None and a[3]]
    # Compared as a share of the marks, in case a set's marks changed between attempts.
    best = max(scored, key=lambda a: (a[2] / a[3], a[1] or datetime.min.replace(tzinfo=UTC)), default=None)
    created = _aware(assignment.created_at)
    return {
        "title": target.activity.title,
        "subject": target.subject,
        "chapterNo": target.chapter_no,
        "activityType": target.activity.activity_type,
        "activityLabel": ACTIVITY_LABEL.get(target.activity.activity_type, "Practice"),
        "setOn": created.astimezone(SCHOOL_TIMEZONE).date().isoformat() if created else None,
        "dueDate": due.isoformat() if due else None,
        "status": status,
        "statusLabel": STATUS_LABEL[status],
        "score": best[2] if best else None,
        "possible": best[3] if best else None,
        # Waiting for a teacher's mark: the best attempt's, or every attempt's.
        "marksToCome": bool(best and best[4] == "PENDING_REVIEW") or bool(handed and best is None),
        "attempts": len(handed),
    }


def _sort_key(row: dict):
    return (row["dueDate"] or row["setOn"] or "", row["subject"] or "", row["chapterNo"] or 0, row["title"])


def _week_numbers(db: Session, student_ids: list[str], week_start: date) -> dict[str, dict]:
    """Per student: answers handed in this week (any practice, their own
    included), how many were marked and the share of marks earned, and how
    many of their own practice sets they handed in."""
    out = {sid: {"answered": 0, "marked": 0, "earned": 0, "possible": 0, "ownPractice": set()} for sid in student_ids}
    if not student_ids:
        return out
    start, end = week_window(week_start)
    rows = (
        db.query(
            AssignmentTarget.student_id, AssignmentTarget.id, Assignment.reason, AttemptAnswer.response_text,
            AttemptAnswer.manual_score, AttemptAnswer.auto_score, AttemptAnswer.max_score,
        )
        .join(Attempt, Attempt.id == AttemptAnswer.attempt_id)
        .join(AssignmentTarget, AssignmentTarget.id == Attempt.assignment_target_id)
        .join(Assignment, Assignment.id == AssignmentTarget.assignment_id)
        .filter(
            AssignmentTarget.student_id.in_(student_ids),
            Attempt.status.in_(_HANDED_IN),
            Attempt.submitted_at >= start,
            Attempt.submitted_at < end,
            Assignment.status != "CANCELLED",
        )
        .all()
    )
    for sid, target_id, reason, response, manual, auto, max_score in rows:
        entry = out[sid]
        # A question left blank still counts towards the marks (as 0), not as answered.
        if _has_text(response):
            entry["answered"] += 1
        score = manual if manual is not None else auto
        if score is not None and max_score:
            entry["marked"] += 1
            entry["earned"] += max(0, min(score, max_score))
            entry["possible"] += max_score
        if reason == SELF_PRACTICE:
            entry["ownPractice"].add(target_id)
    for entry in out.values():
        possible = entry.pop("possible")
        earned = entry.pop("earned")
        entry["percent"] = int(100 * earned / possible) if possible else None  # rounded down, as My Progress
        entry["ownPractice"] = len(entry["ownPractice"])
    return out


def _has_text(raw: str | None) -> bool:
    """Whether a saved answer has anything in it (answers in several boxes
    are kept as JSON, so '["", ""]' is still blank)."""
    text = (raw or "").strip()
    if not text:
        return False
    if text[0] in "[{":
        try:
            value = json.loads(text)
        except ValueError:
            return True
        values = value.values() if isinstance(value, dict) else value if isinstance(value, list) else [value]
        return any(str(v).strip() for v in values if v is not None)
    return True


def _totals(rows: list[dict]) -> dict:
    count = lambda *states: sum(1 for r in rows if r["status"] in states)
    return {
        "given": len(rows),
        "done": count(*DONE_STATES),
        # A set with no due date can't be late: handed in is on time.
        "onTime": count(DONE_ON_TIME, DONE),
        "late": count(DONE_LATE),
        "notDone": count(NOT_DONE),
        "open": count(IN_PROGRESS, NOT_STARTED),
    }


def _skills(db: Session, student: Student, week_start: date) -> dict:
    """Strong skills and skills to work on, from the practice handed in up to
    the end of the week (so a week issued again later says the same)."""
    _, end = week_window(week_start)
    rows = [
        r for r in progress_service.skill_rows(db, student, Attempt.submitted_at < end)
        if r.score is not None and r.score.answered >= progress_service.MIN_ANSWERS_FOR_BAND
    ]
    as_dict = lambda r: {
        "title": r.skill.title,
        "chapter": r.chapter.title,
        "chapterNo": r.chapter.chapter_no,
        "percent": int(r.score.exact_percent) if r.score.exact_percent is not None else None,
        "band": r.band,
    }
    strong = sorted((r for r in rows if r.band == progress_service.STRONG), key=lambda r: -r.score.exact_percent)
    weak = sorted((r for r in rows if r.band in progress_service.WEAK_BANDS), key=lambda r: r.score.exact_percent)
    return {"strong": [as_dict(r) for r in strong[:SKILLS_SHOWN]], "workOn": [as_dict(r) for r in weak[:SKILLS_SHOWN]]}


def _student_name(student: Student) -> str:
    return (student.user.full_name if student.user else None) or student.student_code


def build(
    db: Session,
    *,
    school: School,
    class_level: ClassLevel,
    section: str,
    week_start: date,
    students: list[Student],
    with_skills: bool = True,
) -> list[dict]:
    """Every given student's page for the week, as it stands now."""
    ids = [s.id for s in students]
    now = today()
    by_student: dict[str, list[dict]] = {sid: [] for sid in ids}
    for target in _given_targets(db, ids, week_start):
        by_student[target.student_id].append(_set_row(target, now))
    numbers = _week_numbers(db, ids, week_start)
    section_note, child_notes = notes_for(db, school.id, class_level.id, section, week_start)
    pages = []
    for student in students:
        rows = sorted(by_student[student.id], key=_sort_key)
        page = {
            "version": 1,
            "title": TITLE,
            "school": {"name": school.name, "city": school.city},
            "student": {
                "id": student.id,
                "name": _student_name(student),
                "code": student.student_code,
                "classLevel": class_level.display_name,
                "section": section,
            },
            "week": {
                "start": week_start.isoformat(),
                "end": (week_start + timedelta(days=6)).isoformat(),
                "label": week_label(week_start),
            },
            "sets": rows,
            "totals": _totals(rows),
            "weekNumbers": numbers[student.id],
            "notes": {"section": section_note, "child": child_notes.get(student.id)},
            "madeOn": now.isoformat(),
        }
        if with_skills:
            page["skills"] = _skills(db, student, week_start)
        pages.append(page)
    return pages


# --- issuing -----------------------------------------------------------------------------


def current_issue(
    db: Session, *, school_id: str, class_level_id: str, section: str, week_start: date
) -> WeeklyReportIssue | None:
    return (
        db.query(WeeklyReportIssue)
        .filter(
            WeeklyReportIssue.school_id == school_id,
            WeeklyReportIssue.class_level_id == class_level_id,
            WeeklyReportIssue.section == section,
            WeeklyReportIssue.week_start == week_start,
            WeeklyReportIssue.status == "ISSUED",
        )
        .first()
    )


def issue(
    db: Session, *, school: School, class_level: ClassLevel, section: str, week_start: date, user_id: str, issuer_name: str
) -> WeeklyReportIssue:
    # Two people issuing the same section at once, or a note saved while it
    # issues, must not both pass the check below (the partial unique index
    # is the backstop).
    lock_school(db, school.id)
    if current_issue(db, school_id=school.id, class_level_id=class_level.id, section=section, week_start=week_start):
        raise WeeklyError("This week is already issued. Withdraw it first to issue it again.")
    students = report_card_service.section_students(db, school.id, class_level, section)
    if not students:
        raise WeeklyError("This section has no active students, so there is nothing to issue.")
    pages = build(db, school=school, class_level=class_level, section=section, week_start=week_start, students=students)
    now = datetime.now(UTC)
    issued = WeeklyReportIssue(
        school_id=school.id, class_level_id=class_level.id, section=section, week_start=week_start,
        status="ISSUED", issued_by_user_id=user_id, issued_at=now,
    )
    db.add(issued)
    db.flush()
    for index, page in enumerate(pages, start=1):
        page = {**page, "issuedAt": now.isoformat(), "issuedBy": issuer_name}
        db.add(
            WeeklyReport(
                issue_id=issued.id, school_id=school.id, student_id=page["student"]["id"], sequence=index,
                report_json=json.dumps(page),
            )
        )
    db.flush()
    return issued


def withdraw(db: Session, issued: WeeklyReportIssue, reason: str, user_id: str) -> None:
    reason = " ".join((reason or "").split())
    if issued.status != "ISSUED":
        raise WeeklyError("This week is already withdrawn.")
    if not reason:
        raise WeeklyError("Give a reason for withdrawing this week's reports.")
    if len(reason) > MAX_NOTE:
        raise WeeklyError(f"The reason must be {MAX_NOTE} characters or fewer.")
    issued.status = "WITHDRAWN"
    issued.withdrawn_by_user_id = user_id
    issued.withdrawn_at = datetime.now(UTC)
    issued.withdraw_reason = reason
    db.flush()


def page_data(report: WeeklyReport) -> dict:
    return json.loads(report.report_json)
