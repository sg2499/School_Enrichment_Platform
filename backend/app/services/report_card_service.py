"""Report cards the school issues (Phase 4, #188, 23 Oct 2026).

Design: PHASE4_REPORT_CARD_DESIGN.md (Shailesh's decisions of 23 Oct 2026).
Models: app/models/report_card.py. The API (routes_report_cards.py) checks
who is asking; the rules are here:

  * a school's co-scholastic areas and grade scale for a year (defaults
    until it saves its own);
  * what a teacher records per student per term: attendance, a grade per
    area, a remark;
  * building a section's cards from the published schemes of its class and
    year (assessment_service.results), and the reasons a card cannot be
    issued yet: any result still Provisional, or no published scheme;
  * issuing (the cards kept exactly as built) and withdrawing.

The Term 1 card counts each subject's Term 1 components only, their weights
in proportion. The Year-End card counts every component (the scheme's full
result) and shows each term's own figure beside it.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.models import (
    AcademicYear,
    AssessmentScheme,
    ClassLevel,
    ReportCard,
    ReportCardIssue,
    ReportSettings,
    School,
    Student,
    StudentTermRecord,
)
from app.models.report_card import CARD_TERMS, RECORD_TERMS
from app.services import assessment_service
from app.services.assessment_service import SchemeError, as_text, round_half_up

DEFAULT_AREAS = ["Work Education", "Art Education", "Health and Physical Education", "Discipline"]
# CBSE's three-point scale for co-scholastic areas, Classes 6 to 8.
DEFAULT_SCALE = [
    {"label": "A", "meaning": "Outstanding"},
    {"label": "B", "meaning": "Very Good"},
    {"label": "C", "meaning": "Fair"},
]
MAX_AREAS = 10
MAX_SCALE = 6
MAX_REMARK = 300
MAX_DAYS = 366

TERM_LABEL = {"TERM_1": "Term 1", "TERM_2": "Term 2", "YEAR_END": "Year-End"}
CARD_TITLE = {"TERM_1": "Term 1 Report Card", "YEAR_END": "Year-End Report Card"}


# --- settings ------------------------------------------------------------------


@dataclass
class Settings:
    areas: list[str]
    scale: list[dict]
    saved: bool


def get_settings(db: Session, school_id: str, year_id: str) -> Settings:
    row = (
        db.query(ReportSettings)
        .filter(ReportSettings.school_id == school_id, ReportSettings.academic_year_id == year_id)
        .first()
    )
    if row is None:
        return Settings(areas=list(DEFAULT_AREAS), scale=[dict(s) for s in DEFAULT_SCALE], saved=False)
    return Settings(areas=json.loads(row.areas_json), scale=json.loads(row.scale_json), saved=True)


def clean_settings(areas: list, scale: list) -> tuple[list[str], list[dict]]:
    problems: list[str] = []
    names = [str(a or "").strip() for a in areas or []]
    if not names:
        problems.append("Add at least one co-scholastic area.")
    if len(names) > MAX_AREAS:
        problems.append(f"At most {MAX_AREAS} co-scholastic areas.")
    if any(not n for n in names):
        problems.append("Give every area a name.")
    if any(len(n) > 60 for n in names):
        problems.append("An area's name must be 60 characters or fewer.")
    if len({n.casefold() for n in names}) != len(names):
        problems.append("Two areas have the same name.")
    cleaned_scale = []
    for item in scale or []:
        item = item if isinstance(item, dict) else {}
        cleaned_scale.append(
            {"label": str(item.get("label") or "").strip(), "meaning": str(item.get("meaning") or "").strip()}
        )
    if len(cleaned_scale) < 2:
        problems.append("The grade scale needs at least two grades.")
    if len(cleaned_scale) > MAX_SCALE:
        problems.append(f"The grade scale can have at most {MAX_SCALE} grades.")
    if any(not s["label"] for s in cleaned_scale):
        problems.append("Give every grade on the scale a label.")
    if any(len(s["label"]) > 5 for s in cleaned_scale):
        problems.append("A grade's label must be 5 characters or fewer.")
    if any(len(s["meaning"]) > 40 for s in cleaned_scale):
        problems.append("A grade's meaning must be 40 characters or fewer.")
    if len({s["label"].casefold() for s in cleaned_scale}) != len(cleaned_scale):
        problems.append("Two grades on the scale have the same label.")
    if problems:
        raise SchemeError(problems)
    return names, cleaned_scale


def save_settings(db: Session, school_id: str, year_id: str, areas: list[str], scale: list[dict], user_id: str) -> None:
    row = (
        db.query(ReportSettings)
        .filter(ReportSettings.school_id == school_id, ReportSettings.academic_year_id == year_id)
        .first()
    )
    if row is None:
        row = ReportSettings(school_id=school_id, academic_year_id=year_id)
        db.add(row)
    row.areas_json = json.dumps(areas)
    row.scale_json = json.dumps(scale)
    row.updated_by_user_id = user_id
    db.flush()


# --- the students of a section ------------------------------------------------------


def section_students(db: Session, school_id: str, class_level: ClassLevel, section: str) -> list[Student]:
    """Active students of a school's class and section, paired with the class
    as assessment_service.in_class_clause does (the roster's class_name is
    the class level's code, or class_level_id where it is set)."""
    return (
        db.query(Student)
        .options(joinedload(Student.user))
        .filter(
            Student.school_id == school_id,
            Student.is_active.is_(True),
            or_(Student.class_level_id == class_level.id, Student.class_name == class_level.code),
            Student.section == section,
        )
        .order_by(Student.student_code)
        .all()
    )


def class_sections(db: Session, school_id: str) -> list[tuple[ClassLevel, str]]:
    """Every (class level, section) of a school that has active students."""
    levels = {c.code: c for c in db.query(ClassLevel).all()}
    by_id = {c.id: c for c in levels.values()}
    rows = (
        db.query(Student.class_level_id, Student.class_name, Student.section)
        .filter(Student.school_id == school_id, Student.is_active.is_(True), Student.section.isnot(None))
        .distinct()
        .all()
    )
    found: set[tuple[str, str]] = set()
    for class_level_id, class_name, section in rows:
        level = by_id.get(class_level_id) or levels.get((class_name or "").strip())
        if level is not None and section and section.strip():
            found.add((level.id, section))
    return sorted(((by_id[lid], sec) for lid, sec in found), key=lambda p: (p[0].display_order, p[1]))


# --- what a teacher records ------------------------------------------------------------


@dataclass
class RecordEntry:
    student_id: str
    working_days: int | None
    days_present: int | None
    grades: dict
    remark: str | None


def records_for(db: Session, year_id: str, term: str, student_ids: list[str]) -> dict[str, StudentTermRecord]:
    if not student_ids:
        return {}
    return {
        r.student_id: r
        for r in db.query(StudentTermRecord)
        .filter(
            StudentTermRecord.academic_year_id == year_id,
            StudentTermRecord.term == term,
            StudentTermRecord.student_id.in_(student_ids),
        )
        .all()
    }


def _whole_days(value) -> int | None | str:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return "bad"
    try:
        number = int(str(value).strip())
    except ValueError:
        return "bad"
    if str(number) != str(value).strip() or number < 0 or number > MAX_DAYS:
        return "bad"
    return number


def save_records(
    db: Session,
    *,
    school_id: str,
    year_id: str,
    term: str,
    entries: list[dict],
    allowed_student_ids: set[str],
    settings: Settings,
    user_id: str,
) -> int:
    """Saves several students' term records, all or none. Each entry is the
    student's whole record for the term (attendance, grades, remark).
    Returns how many records changed."""
    if term not in RECORD_TERMS:
        raise SchemeError("Choose Term 1 or Term 2.")
    problems: list[str] = []
    labels = {s["label"] for s in settings.scale}
    areas = set(settings.areas)
    cleaned: list[RecordEntry] = []
    seen: set[str] = set()
    for raw in entries:
        student_id = str(raw.get("studentId") or "")
        if student_id in seen:
            problems.append("A student appears twice in one save.")
            continue
        seen.add(student_id)
        if student_id not in allowed_student_ids:
            problems.append("One of these students is not in a section you can record for.")
            continue
        working = _whole_days(raw.get("workingDays"))
        present = _whole_days(raw.get("daysPresent"))
        if working == "bad" or present == "bad":
            problems.append(f"Days must be whole numbers from 0 to {MAX_DAYS}.")
            continue
        if working is not None and present is not None and present > working:
            problems.append("Days present can't be more than the working days.")
            continue
        grades_in = raw.get("grades") or {}
        if not isinstance(grades_in, dict):
            problems.append("Each grade must be for one of the school's areas.")
            continue
        grades = {}
        for area, label in grades_in.items():
            label = str(label or "").strip()
            if not label:
                continue
            if area not in areas:
                problems.append(f"\"{area}\" is not one of the school's co-scholastic areas.")
                continue
            if label not in labels:
                problems.append(f"\"{label}\" is not on the school's grade scale.")
                continue
            grades[area] = label
        remark = str(raw.get("remark") or "").strip() or None
        if remark and len(remark) > MAX_REMARK:
            problems.append(f"A remark must be {MAX_REMARK} characters or fewer.")
            continue
        cleaned.append(RecordEntry(student_id, working, present, grades, remark))
    if problems:
        raise SchemeError(sorted(set(problems), key=problems.index))
    existing = records_for(db, year_id, term, [e.student_id for e in cleaned])
    changed = 0
    for entry in cleaned:
        row = existing.get(entry.student_id)
        new = (entry.working_days, entry.days_present, json.dumps(entry.grades, sort_keys=True), entry.remark)
        if row is not None and (row.working_days, row.days_present, _sorted_json(row.grades_json), row.remark) == new:
            continue
        if row is None:
            row = StudentTermRecord(school_id=school_id, academic_year_id=year_id, student_id=entry.student_id, term=term)
            db.add(row)
        row.working_days, row.days_present, row.grades_json, row.remark = new
        row.updated_by_user_id = user_id
        changed += 1
    db.flush()
    return changed


def _sorted_json(text: str | None) -> str:
    return json.dumps(json.loads(text or "{}"), sort_keys=True)


# --- building the cards ----------------------------------------------------------------


@dataclass
class Readiness:
    cards: list[dict]
    problems: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def published_schemes(db: Session, school_id: str, year_id: str, class_level_id: str) -> list[AssessmentScheme]:
    schemes = (
        db.query(AssessmentScheme)
        .options(joinedload(AssessmentScheme.components), joinedload(AssessmentScheme.grade_bands))
        .filter(
            AssessmentScheme.school_id == school_id,
            AssessmentScheme.academic_year_id == year_id,
            AssessmentScheme.class_level_id == class_level_id,
            AssessmentScheme.status == "PUBLISHED",
            AssessmentScheme.is_template.is_(False),
        )
        .all()
    )
    return sorted(schemes, key=lambda s: (s.board_course.display_name if s.board_course else s.name).casefold())


def _num(value: Decimal | None, places: int = 2) -> str | None:
    return None if value is None else as_text(round_half_up(value, places))


def _shown(value: Decimal | None, places: int) -> str | None:
    """A result as the scheme shows it: "91" or "91.0"."""
    return None if value is None else format(round_half_up(value, places), "f")


def _student_name(student: Student) -> str:
    return student.user.full_name if student.user else student.student_code


def _component_cell(result) -> dict:
    status = result.status
    return {
        "name": result.component.name,
        "term": result.component.term,
        "maxMarks": result.component.max_marks,
        "status": status,
        "marks": _num(result.marks) if status == "MARKS" else None,
    }


def _missing_reason(result) -> str:
    if result.status == "MISSING":
        if result.component.source == "PLATFORM":
            return "practice set not done yet (it counts 0 once it closes)"
        return "no marks entered"
    return "an answer still waiting for a teacher's marks"


def build_cards(
    db: Session, *, school: School, year: AcademicYear, class_level: ClassLevel, section: str, card_term: str
) -> Readiness:
    """Each student's card for a section and term, and why it can't be
    issued yet (problems) or what is only missing from it (warnings)."""
    if card_term not in CARD_TERMS:
        raise SchemeError("Choose the Term 1 or the Year-End card.")
    students = section_students(db, school.id, class_level, section)
    readiness = Readiness(cards=[])
    if not students:
        readiness.problems.append(f"No students are in {class_level.display_name} {section}.")
        return readiness
    schemes = published_schemes(db, school.id, year.id, class_level.id)
    # A subject still only in draft is not on the cards: said, not hidden (review).
    published_lines = {s.lineage_id for s in schemes}
    drafts = (
        db.query(AssessmentScheme)
        .filter(
            AssessmentScheme.school_id == school.id,
            AssessmentScheme.academic_year_id == year.id,
            AssessmentScheme.class_level_id == class_level.id,
            AssessmentScheme.status == "DRAFT",
            AssessmentScheme.is_template.is_(False),
        )
        .all()
    )
    for draft in drafts:
        if draft.lineage_id not in published_lines:
            readiness.warnings.append(
                f"{_subject_name(draft)} has no published scheme yet, so it is not on these cards."
            )
    if card_term == "TERM_1":
        schemes = [s for s in schemes if any(c.term == "TERM_1" for c in s.components)]
    if not schemes:
        readiness.problems.append(
            f"No subject has a published scheme for {class_level.display_name} in {year.label}"
            + (" with a Term 1 component." if card_term == "TERM_1" else ".")
        )
        return readiness
    ids = [s.id for s in students]
    term_filter = "TERM_1" if card_term == "TERM_1" else None
    figures = {s.id: {r.student_id: r for r in assessment_service.results(db, s, ids, term=term_filter)} for s in schemes}
    per_term = {}
    if card_term == "YEAR_END":
        for s in schemes:
            per_term[s.id] = {
                term: {r.student_id: r for r in assessment_service.results(db, s, ids, term=term)}
                for term in ("TERM_1", "TERM_2")
                if any(c.term == term for c in s.components)
            }
    settings = get_settings(db, school.id, year.id)
    record_terms = ["TERM_1"] if card_term == "TERM_1" else ["TERM_1", "TERM_2"]
    records = {term: records_for(db, year.id, term, ids) for term in record_terms}
    remark_term = "TERM_1" if card_term == "TERM_1" else "TERM_2"

    no_attendance: list[str] = []
    no_grades: list[str] = []
    no_remark: list[str] = []
    on_scale = {s["label"] for s in settings.scale}
    for student in students:
        name = _student_name(student)
        subjects = []
        for scheme in schemes:
            result = figures[scheme.id][student.id]
            for cell in result.components:
                if cell.status == "MISSING" or cell.pending_review:
                    readiness.problems.append(
                        f"{name} ({student.student_code}), {_subject_name(scheme)}, {cell.component.name}: "
                        f"{_missing_reason(cell)}."
                    )
            subject = {
                "subject": _subject_name(scheme),
                "schemeName": scheme.name,
                "schemeVersion": scheme.version,
                "decimalPlaces": scheme.decimal_places,
                "components": [_component_cell(c) for c in result.components],
                "result": _shown(result.shown, scheme.decimal_places),
                "unrounded": _num(result.unrounded, 6),
                "grade": result.grade,
                "outcome": None if result.passed is None else ("PASS" if result.passed else "BELOW_PASS"),
                "outcomeLabel": None if result.passed is None else (scheme.pass_label if result.passed else scheme.fail_label),
                "notes": list(result.notes),
                "gradeBands": [{"label": b.label, "minPercent": b.min_percent} for b in scheme.grade_bands],
                "passPercent": scheme.pass_percent,
            }
            if card_term == "YEAR_END":
                subject["terms"] = {
                    term: {
                        "result": _shown(rows[student.id].shown, scheme.decimal_places),
                        "grade": rows[student.id].grade,
                    }
                    for term, rows in per_term[scheme.id].items()
                }
            subjects.append(subject)
        attendance = {}
        grades = {}
        for term in record_terms:
            row = records[term].get(student.id)
            attendance[term] = {
                "workingDays": row.working_days if row else None,
                "daysPresent": row.days_present if row else None,
            }
            # Only grades for today's areas on today's scale are printed; one
            # left from before the scale or an area changed counts as missing.
            saved_grades = json.loads(row.grades_json) if row else {}
            grades[term] = {
                area: label for area, label in saved_grades.items() if area in settings.areas and label in on_scale
            }
            if row is None or row.working_days is None or row.days_present is None:
                no_attendance.append(name)
            if any(area not in grades[term] for area in settings.areas):
                no_grades.append(name)
        remark_row = records[remark_term].get(student.id)
        if remark_row is None or not remark_row.remark:
            no_remark.append(name)
        readiness.cards.append(
            {
                "cardTerm": card_term,
                "title": CARD_TITLE[card_term],
                "school": {"name": school.name, "city": school.city},
                "year": year.label,
                "student": {
                    "id": student.id,
                    "name": name,
                    "code": student.student_code,
                    "classLevel": class_level.display_name,
                    "section": section,
                    "dob": student.dob,
                },
                "subjects": subjects,
                "coScholastic": {"areas": settings.areas, "scale": settings.scale, "grades": grades},
                "attendance": attendance,
                "remark": remark_row.remark if remark_row else None,
            }
        )
    for label, names in (
        ("attendance", no_attendance),
        ("co-scholastic grades", no_grades),
        ("remark", no_remark),
    ):
        unique = sorted(set(names))
        if unique:
            readiness.warnings.append(
                f"{len(unique)} {'student has' if len(unique) == 1 else 'students have'} no {label}: "
                + ", ".join(unique[:5])
                + (f" and {len(unique) - 5} more" if len(unique) > 5 else "")
                + "."
            )
    return readiness


def _subject_name(scheme: AssessmentScheme) -> str:
    return scheme.board_course.display_name if scheme.board_course else scheme.name


# --- issuing ---------------------------------------------------------------------------


class IssueBlocked(Exception):
    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("; ".join(problems))


def current_issue(
    db: Session, *, school_id: str, year_id: str, class_level_id: str, section: str, card_term: str
) -> ReportCardIssue | None:
    return (
        db.query(ReportCardIssue)
        .filter(
            ReportCardIssue.school_id == school_id,
            ReportCardIssue.academic_year_id == year_id,
            ReportCardIssue.class_level_id == class_level_id,
            ReportCardIssue.section == section,
            ReportCardIssue.card_term == card_term,
            ReportCardIssue.status == "ISSUED",
        )
        .first()
    )


def issue(
    db: Session, *, school: School, year: AcademicYear, class_level: ClassLevel, section: str, card_term: str, user_id: str
) -> ReportCardIssue:
    """Issues a section's cards, kept exactly as built. Refused while any
    result is Provisional, or while these cards are already issued."""
    # Two admins issuing the same section at once must not both pass the
    # check below: issuing for a year takes that year's row, as publishing does.
    db.query(AcademicYear).filter(AcademicYear.id == year.id).with_for_update().first()
    if current_issue(
        db, school_id=school.id, year_id=year.id, class_level_id=class_level.id, section=section, card_term=card_term
    ):
        raise IssueBlocked(["These cards are already issued. Withdraw them first to issue them again."])
    readiness = build_cards(db, school=school, year=year, class_level=class_level, section=section, card_term=card_term)
    if readiness.problems:
        raise IssueBlocked(readiness.problems)
    now = datetime.now(UTC)
    issued = ReportCardIssue(
        school_id=school.id,
        academic_year_id=year.id,
        class_level_id=class_level.id,
        section=section,
        card_term=card_term,
        status="ISSUED",
        issued_by_user_id=user_id,
        issued_at=now,
    )
    db.add(issued)
    db.flush()
    for index, card in enumerate(readiness.cards, start=1):
        card = {**card, "issuedAt": now.isoformat()}
        db.add(
            ReportCard(
                issue_id=issued.id,
                school_id=school.id,
                student_id=card["student"]["id"],
                sequence=index,
                card_json=json.dumps(card),
            )
        )
    db.flush()
    return issued


def withdraw(db: Session, issued: ReportCardIssue, reason: str, user_id: str) -> None:
    reason = (reason or "").strip()
    if issued.status != "ISSUED":
        raise SchemeError("These cards are already withdrawn.")
    if not reason:
        raise SchemeError("Give a reason for withdrawing the cards.")
    if len(reason) > 300:
        raise SchemeError("The reason must be 300 characters or fewer.")
    issued.status = "WITHDRAWN"
    issued.withdrawn_by_user_id = user_id
    issued.withdrawn_at = datetime.now(UTC)
    issued.withdraw_reason = reason
    db.flush()


def card_data(card: ReportCard) -> dict:
    return json.loads(card.card_json)
