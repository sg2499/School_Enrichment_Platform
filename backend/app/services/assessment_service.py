"""The Assessment Scheme's rules (Phase 4, #165, 23 Oct 2026).

Design: PHASE4_ASSESSMENT_SCHEME_DESIGN.md, approved by Shailesh with all
six decisions as recommended. Models: app/models/assessment.py.

Everything a scheme decides is here, so the API (routes_assessment.py) only
checks who is asking and passes the work on:

  * checking what a School Admin or Super Admin types into a scheme;
  * the checks a scheme must pass before it is published, and publishing
    (a new version replaces the old one and takes over its entered marks);
  * a new version of a published scheme, and a school's copy of a template;
  * entering marks (half marks allowed; a changed mark needs a reason);
  * each student's result.

The result, per student, for one subject (design, section 3):

  component percentage = marks / maximum marks
  result               = sum(percentage x weight) / sum(weights counted)

  * ABSENT counts as 0. EXEMPT, and a component with no marks yet, are
    left out, the other weights counting in proportion (so the figure is
    "the result so far").
  * The result is Provisional while any component has no marks yet or a
    counted platform attempt is still waiting for a teacher's marks.
  * The unrounded figure is kept; the figure shown is rounded half up to
    the scheme's decimal places; the grade and pass are decided on the
    figure shown, so a child shown 91 is never given the grade below.

All arithmetic is Decimal, never float.
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, joinedload

from app.models import (
    AcademicYear,
    AssessmentComponent,
    AssessmentComponentActivity,
    AssessmentScheme,
    Assignment,
    AssignmentTarget,
    Attempt,
    BoardCourse,
    Chapter,
    ComponentMark,
    Evaluation,
    GradeBand,
    LearningActivity,
    Student,
)
from app.models.assessment import (
    ATTEMPT_RULES,
    COMPONENT_KINDS,
    COMPONENT_SOURCES,
    COMPONENT_TERMS,
    MARK_STATUSES,
)

HUNDRED = Decimal(100)
# India Standard Time. A fixed offset, not ZoneInfo("Asia/Kolkata"): Windows
# has no time-zone database for zoneinfo to read (ship.ps1 failed on it, 23
# Oct 2026), and India keeps no daylight saving, so +05:30 is exact.
SCHOOL_TIMEZONE = timezone(timedelta(hours=5, minutes=30), "IST")
MAX_MARKS_LIMIT = Decimal(1000)
MAX_COMPONENTS = 20
MAX_BANDS = 15
MAX_PLACES_IN_MARKS = 2
_FINAL_REVIEW_STATUSES = ("AUTO_FINALISED", "FINALISED")
_YEAR_LABEL = re.compile(r"^\d{4}-\d{2}$")


class SchemeError(Exception):
    """A request this module refuses, with sentences a person can act on."""

    def __init__(self, problems: list[str] | str):
        self.problems = [problems] if isinstance(problems, str) else list(problems)
        super().__init__("; ".join(self.problems))


# --- decimal text -------------------------------------------------------------


def to_decimal(value) -> Decimal | None:
    """A number from 17.5, "17.5" or " 17.50 "; None for anything else
    (text, True, NaN, infinity, more than nine digits before the point)."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        return None
    if not number.is_finite() or number.adjusted() > 8:
        return None
    return number


def places(number: Decimal) -> int:
    exponent = number.normalize().as_tuple().exponent
    return max(0, -exponent) if isinstance(exponent, int) else 0


def as_text(number: Decimal) -> str:
    """Stored and sent form: no exponent, no trailing zeros ("17.5", "80")."""
    text = format(number.normalize(), "f")
    return text if text != "-0" else "0"


def round_half_up(number: Decimal, decimal_places: int) -> Decimal:
    return number.quantize(Decimal(1).scaleb(-decimal_places), rounding=ROUND_HALF_UP)


def _percent_text(value) -> Decimal | None:
    number = to_decimal(value)
    if number is None or number < 0 or number > HUNDRED or places(number) > 2:
        return None
    return number


# --- what a person types into a scheme -----------------------------------------


@dataclass
class ComponentInput:
    name: str
    kind: str
    term: str
    source: str
    max_marks: str
    weight_percent: str
    min_pass_percent: str | None
    activity_ids: list[str]
    component_key: str | None = None


@dataclass
class BandInput:
    label: str
    min_percent: str


@dataclass
class SchemeInput:
    name: str
    attempt_rule: str
    pass_percent: str
    pass_label: str
    fail_label: str
    decimal_places: int
    components: list[ComponentInput]
    grade_bands: list[BandInput]
    description: str | None = None


def clean_scheme_input(raw: SchemeInput) -> SchemeInput:
    """The typed values checked one by one. Raises SchemeError listing every
    problem at once, in the words the editor shows. Saving a draft only
    needs these to be well formed; whether the scheme is complete (weights
    total 100, bands cover 0 to 100, ...) is checked when it is published."""
    problems: list[str] = []
    name = (raw.name or "").strip()
    if not name:
        problems.append("Give the scheme a name.")
    elif len(name) > 150:
        problems.append("The scheme's name must be 150 characters or fewer.")
    description = (raw.description or "").strip() or None
    if description and len(description) > 300:
        problems.append("The description must be 300 characters or fewer.")
    rule = (raw.attempt_rule or "").strip().upper()
    if rule not in ATTEMPT_RULES:
        problems.append("Choose which attempt counts: Best, First or Latest.")
    pass_percent = _percent_text(raw.pass_percent)
    if pass_percent is None:
        problems.append("The pass mark must be a percentage from 0 to 100, with at most 2 decimal places.")
    pass_label = (raw.pass_label or "").strip()
    fail_label = (raw.fail_label or "").strip()
    if not pass_label or not fail_label:
        problems.append("Give the words shown for a pass and for a result below the pass mark.")
    elif len(pass_label) > 40 or len(fail_label) > 40:
        problems.append("The words for a pass and a result below it must be 40 characters or fewer.")
    if raw.decimal_places not in (0, 1):
        problems.append("Show the result to 0 or 1 decimal places.")

    components: list[ComponentInput] = []
    if len(raw.components) > MAX_COMPONENTS:
        problems.append(f"A scheme can have at most {MAX_COMPONENTS} components.")
    seen_names: set[str] = set()
    for index, component in enumerate(raw.components[:MAX_COMPONENTS], start=1):
        where = f"Component {index}"
        c_name = (component.name or "").strip()
        if not c_name:
            problems.append(f"{where}: give it a name.")
        elif len(c_name) > 120:
            problems.append(f"{where}: the name must be 120 characters or fewer.")
        elif c_name.lower() in seen_names:
            problems.append(f"{where}: another component is already called \"{c_name}\".")
        seen_names.add(c_name.lower())
        where = f"\"{c_name}\"" if c_name else where
        kind = (component.kind or "").strip().upper()
        if kind not in COMPONENT_KINDS:
            problems.append(f"{where}: choose what kind of assessment it is.")
        term = (component.term or "").strip().upper()
        if term not in COMPONENT_TERMS:
            problems.append(f"{where}: choose Term 1, Term 2 or Whole Year.")
        source = (component.source or "").strip().upper()
        if source not in COMPONENT_SOURCES:
            problems.append(f"{where}: choose whether its marks are entered by teachers or come from the platform.")
        max_marks = to_decimal(component.max_marks)
        if max_marks is None or max_marks <= 0 or max_marks > MAX_MARKS_LIMIT or places(max_marks) > MAX_PLACES_IN_MARKS:
            problems.append(f"{where}: maximum marks must be more than 0 and at most 1,000, with at most 2 decimal places.")
        weight = _percent_text(component.weight_percent)
        if weight is None or weight == 0:
            problems.append(f"{where}: the weight must be a percentage above 0 and at most 100, with at most 2 decimal places.")
        min_pass = None
        if component.min_pass_percent not in (None, ""):
            min_pass = _percent_text(component.min_pass_percent)
            if min_pass is None:
                problems.append(f"{where}: its own pass mark must be a percentage from 0 to 100, or left empty.")
        activity_ids = list(dict.fromkeys(a for a in (component.activity_ids or []) if a))
        if source == "ENTERED" and activity_ids:
            problems.append(f"{where}: practice sets can only be linked when its marks come from the platform.")
        components.append(
            ComponentInput(
                name=c_name,
                kind=kind,
                term=term,
                source=source,
                max_marks=as_text(max_marks) if max_marks is not None else "",
                weight_percent=as_text(weight) if weight is not None else "",
                min_pass_percent=as_text(min_pass) if min_pass is not None else None,
                activity_ids=activity_ids,
                component_key=component.component_key,
            )
        )

    bands: list[BandInput] = []
    if len(raw.grade_bands) > MAX_BANDS:
        problems.append(f"A scheme can have at most {MAX_BANDS} grades.")
    seen_labels: set[str] = set()
    for index, band in enumerate(raw.grade_bands[:MAX_BANDS], start=1):
        label = (band.label or "").strip()
        if not label:
            problems.append(f"Grade {index}: give it a name, such as A1.")
        elif len(label) > 20:
            problems.append(f"Grade {index}: the name must be 20 characters or fewer.")
        elif label.lower() in seen_labels:
            problems.append(f"Grade {index}: another grade is already called {label}.")
        seen_labels.add(label.lower())
        minimum = _percent_text(band.min_percent)
        if minimum is None:
            problems.append(f"Grade {label or index}: the lowest percentage must be from 0 to 100, with at most 2 decimal places.")
        bands.append(BandInput(label=label, min_percent=as_text(minimum) if minimum is not None else ""))

    if problems:
        raise SchemeError(problems)
    return SchemeInput(
        name=name,
        description=description,
        attempt_rule=rule,
        pass_percent=as_text(pass_percent),
        pass_label=pass_label,
        fail_label=fail_label,
        decimal_places=raw.decimal_places,
        components=components,
        grade_bands=bands,
    )


def _check_activities(db: Session, scheme: AssessmentScheme, components: list[ComponentInput]) -> None:
    """Every linked practice set must exist, be published, and belong to the
    scheme's own course."""
    wanted = {a for c in components for a in c.activity_ids}
    if not wanted:
        return
    if scheme.is_template:
        raise SchemeError("A template cannot link practice sets: they belong to one school's course.")
    found = {
        activity.id: (activity, chapter)
        for activity, chapter in db.query(LearningActivity, Chapter)
        .join(Chapter, Chapter.id == LearningActivity.chapter_id)
        .filter(LearningActivity.id.in_(wanted))
        .all()
    }
    problems = []
    for component in components:
        for activity_id in component.activity_ids:
            pair = found.get(activity_id)
            if pair is None:
                problems.append(f"\"{component.name}\": one of its practice sets no longer exists.")
                continue
            activity, chapter = pair
            if chapter.board_course_id != scheme.board_course_id:
                problems.append(f"\"{component.name}\": \"{activity.title}\" is from another subject.")
            elif activity.status != "PUBLISHED":
                problems.append(f"\"{component.name}\": \"{activity.title}\" is not published.")
    if problems:
        raise SchemeError(problems)


def write_scheme(db: Session, scheme: AssessmentScheme, cleaned: SchemeInput) -> AssessmentScheme:
    """Replaces a draft's settings, components and grades with `cleaned`.
    Components keep their key when the editor sends it back, so a new
    version's components stay matched to the old ones'."""
    if scheme.status != "DRAFT":
        raise SchemeError("A published scheme cannot be changed. Make a new version to change it.")
    _check_activities(db, scheme, cleaned.components)
    scheme.name = cleaned.name
    scheme.description = cleaned.description
    scheme.attempt_rule = cleaned.attempt_rule
    scheme.pass_percent = cleaned.pass_percent
    scheme.pass_label = cleaned.pass_label
    scheme.fail_label = cleaned.fail_label
    scheme.decimal_places = cleaned.decimal_places
    known_keys = {c.component_key for c in scheme.components}
    used_keys: set[str] = set()
    scheme.components.clear()
    scheme.grade_bands.clear()
    db.flush()
    for sequence, component in enumerate(cleaned.components, start=1):
        # A key the draft does not have, or one already used in this save
        # (found in review, 23 Oct 2026: a repeated key would send the old
        # version's marks to the wrong component), gets a new one.
        reusable = component.component_key in known_keys and component.component_key not in used_keys
        key = component.component_key if reusable else str(uuid.uuid4())
        used_keys.add(key)
        row = AssessmentComponent(
            component_key=key,
            sequence=sequence,
            name=component.name,
            kind=component.kind,
            term=component.term,
            source=component.source,
            max_marks=component.max_marks,
            weight_percent=component.weight_percent,
            min_pass_percent=component.min_pass_percent,
        )
        row.activities = [AssessmentComponentActivity(learning_activity_id=a) for a in component.activity_ids]
        scheme.components.append(row)
    for sequence, band in enumerate(cleaned.grade_bands, start=1):
        scheme.grade_bands.append(GradeBand(sequence=sequence, label=band.label, min_percent=band.min_percent))
    db.flush()
    return scheme


# --- publishing ------------------------------------------------------------------


def publish_problems(db: Session, scheme: AssessmentScheme) -> list[str]:
    """What stops a draft from being published, in the words the editor
    shows; empty when it is ready."""
    problems: list[str] = []
    if not scheme.is_template and not (scheme.academic_year_id and scheme.class_level_id and scheme.board_course_id):
        problems.append("Choose the year, class and subject.")
    if not scheme.components:
        problems.append("Add at least one component.")
    total = sum((to_decimal(c.weight_percent) or Decimal(0)) for c in scheme.components)
    if scheme.components and total != HUNDRED:
        problems.append(f"The weights add up to {as_text(total)}%; they must add up to exactly 100%.")
    for component in scheme.components:
        if component.source == "PLATFORM" and not component.activities and not scheme.is_template:
            problems.append(f"\"{component.name}\": link at least one practice set, or have teachers enter its marks.")
    minimums = sorted((to_decimal(b.min_percent) for b in scheme.grade_bands), reverse=True)
    if not scheme.grade_bands:
        problems.append("Add the grades.")
    elif len(set(minimums)) != len(minimums):
        problems.append("Two grades start at the same percentage.")
    elif minimums[-1] != 0:
        problems.append("The lowest grade must start at 0%, so every result gets a grade.")
    if not problems and not scheme.is_template:
        clash = (
            db.query(AssessmentScheme)
            .filter(
                AssessmentScheme.school_id == scheme.school_id,
                AssessmentScheme.academic_year_id == scheme.academic_year_id,
                AssessmentScheme.board_course_id == scheme.board_course_id,
                AssessmentScheme.status == "PUBLISHED",
                AssessmentScheme.lineage_id != scheme.lineage_id,
                AssessmentScheme.is_template.is_(False),
            )
            .first()
        )
        if clash is not None:
            problems.append(
                f"\"{clash.name}\" is already the published scheme for this class, subject and year. "
                "Make a new version of it instead."
            )
    return problems


@dataclass
class PublishOutcome:
    replaced: AssessmentScheme | None
    marks_carried: int = 0
    # Marks the new version could not take, each {studentId, component, why}:
    # recorded in the publish audit entry.
    marks_dropped: list[dict] = field(default_factory=list)


def publish(db: Session, scheme: AssessmentScheme, user_id: str) -> PublishOutcome:
    """Publishes a draft. Returns the version it replaced, if any (now
    SUPERSEDED), and what happened to that version's entered marks, which
    are carried over to the matching components of this one."""
    if scheme.status != "DRAFT":
        raise SchemeError("Only a draft can be published.")
    if not scheme.is_template and scheme.academic_year_id:
        # Two admins publishing two different schemes for the same class,
        # subject and year at once must not both pass the check below
        # (review, 23 Oct 2026): publishing for a year takes that year's row.
        db.query(AcademicYear).filter(AcademicYear.id == scheme.academic_year_id).with_for_update().first()
    problems = publish_problems(db, scheme)
    if problems:
        raise SchemeError(problems)
    previous = (
        db.query(AssessmentScheme)
        .filter(AssessmentScheme.lineage_id == scheme.lineage_id, AssessmentScheme.status == "PUBLISHED")
        .with_for_update()
        .first()
    )
    outcome = PublishOutcome(replaced=previous)
    if previous is not None:
        previous.status = "SUPERSEDED"
        _carry_marks_over(db, previous, scheme, outcome)
    scheme.status = "PUBLISHED"
    scheme.published_at = datetime.now(UTC)
    scheme.published_by_user_id = user_id
    db.flush()
    return outcome


def _carry_marks_over(db: Session, old: AssessmentScheme, new: AssessmentScheme, outcome: PublishOutcome) -> None:
    by_key = {c.component_key: c for c in new.components}
    for old_component in old.components:
        target = by_key.get(old_component.component_key)
        marks = db.query(ComponentMark).filter(ComponentMark.component_id == old_component.id).all()
        for mark in marks:
            why = None
            if target is None:
                why = "the component was removed"
            elif target.source != "ENTERED" and mark.status == "ENTERED":
                why = "its marks now come from the platform"
            elif mark.marks is not None and to_decimal(mark.marks) > to_decimal(target.max_marks):
                why = "the maximum marks were lowered below it"
            if why:
                outcome.marks_dropped.append(
                    {"studentId": mark.student_id, "component": old_component.name, "why": why}
                )
                continue
            outcome.marks_carried += 1
            db.add(
                ComponentMark(
                    school_id=mark.school_id,
                    component_id=target.id,
                    student_id=mark.student_id,
                    status=mark.status,
                    marks=mark.marks,
                    change_reason=mark.change_reason,
                    entered_by_user_id=mark.entered_by_user_id,
                    entered_at=mark.entered_at,
                    updated_by_user_id=mark.updated_by_user_id,
                )
            )


def copy_scheme(
    db: Session,
    source: AssessmentScheme,
    *,
    user_id: str,
    school_id: str | None,
    academic_year_id: str | None,
    class_level_id: str | None,
    board_course_id: str | None,
    as_new_version: bool,
) -> AssessmentScheme:
    """A new draft copied from `source`: either its next version (same
    lineage, same scope, components keep their keys) or a school's own
    scheme started from a template (a new lineage)."""
    if as_new_version:
        newer = (
            db.query(AssessmentScheme)
            .filter(AssessmentScheme.lineage_id == source.lineage_id, AssessmentScheme.version > source.version)
            .first()
        )
        if newer is not None:
            raise SchemeError(f"Version {newer.version} of this scheme already exists. Change that one instead.")
    lineage = source.lineage_id if as_new_version else str(uuid.uuid4())
    copy = AssessmentScheme(
        # A new lineage's first version takes the lineage's id, as in new_scheme.
        id=str(uuid.uuid4()) if as_new_version else lineage,
        school_id=school_id,
        is_template=source.is_template if as_new_version else False,
        name=source.name,
        description=source.description,
        academic_year_id=academic_year_id,
        class_level_id=class_level_id,
        board_course_id=board_course_id,
        lineage_id=lineage,
        version=source.version + 1 if as_new_version else 1,
        status="DRAFT",
        attempt_rule=source.attempt_rule,
        pass_percent=source.pass_percent,
        pass_label=source.pass_label,
        fail_label=source.fail_label,
        decimal_places=source.decimal_places,
        created_by_user_id=user_id,
    )
    for component in source.components:
        row = AssessmentComponent(
            component_key=component.component_key if as_new_version else str(uuid.uuid4()),
            sequence=component.sequence,
            name=component.name,
            kind=component.kind,
            term=component.term,
            source=component.source,
            max_marks=component.max_marks,
            weight_percent=component.weight_percent,
            min_pass_percent=component.min_pass_percent,
        )
        if as_new_version:
            row.activities = [AssessmentComponentActivity(learning_activity_id=a.learning_activity_id) for a in component.activities]
        copy.components.append(row)
    for band in source.grade_bands:
        copy.grade_bands.append(GradeBand(sequence=band.sequence, label=band.label, min_percent=band.min_percent))
    db.add(copy)
    db.flush()
    return copy


def new_scheme(
    db: Session,
    *,
    user_id: str,
    school_id: str | None,
    is_template: bool,
    academic_year_id: str | None,
    class_level_id: str | None,
    board_course_id: str | None,
    cleaned: SchemeInput,
) -> AssessmentScheme:
    lineage = str(uuid.uuid4())
    scheme = AssessmentScheme(
        id=lineage,
        school_id=school_id,
        is_template=is_template,
        name=cleaned.name,
        academic_year_id=academic_year_id,
        class_level_id=class_level_id,
        board_course_id=board_course_id,
        lineage_id=lineage,
        version=1,
        status="DRAFT",
        attempt_rule=cleaned.attempt_rule,
        pass_percent=cleaned.pass_percent,
        pass_label=cleaned.pass_label,
        fail_label=cleaned.fail_label,
        decimal_places=cleaned.decimal_places,
        created_by_user_id=user_id,
    )
    db.add(scheme)
    db.flush()
    return write_scheme(db, scheme, cleaned)


def check_scope(db: Session, *, school_id: str, academic_year_id: str, board_course_id: str) -> tuple[AcademicYear, BoardCourse]:
    """The year must be this school's; the course gives the class level."""
    year = db.get(AcademicYear, academic_year_id)
    if year is None or year.school_id != school_id:
        raise SchemeError("Choose one of this school's academic years.")
    course = db.get(BoardCourse, board_course_id)
    if course is None:
        raise SchemeError("Choose a subject.")
    return year, course


# --- academic years ----------------------------------------------------------------


def clean_year(label: str, start: date | None, end: date | None) -> str:
    text = (label or "").strip()
    problems = []
    if not _YEAR_LABEL.match(text):
        problems.append("Write the year as 2026-27.")
    elif int(text[5:]) != (int(text[:4]) + 1) % 100:
        problems.append("The second part must be the year after the first, as in 2026-27.")
    if start is None or end is None:
        problems.append("Give the year's first and last day.")
    elif end <= start:
        problems.append("The last day must come after the first.")
    elif (end - start).days > 400:
        problems.append("An academic year can be at most 400 days long.")
    if problems:
        raise SchemeError(problems)
    return text


def set_current_year(db: Session, year: AcademicYear) -> None:
    db.query(AcademicYear).filter(AcademicYear.school_id == year.school_id, AcademicYear.id != year.id).update(
        {AcademicYear.is_current: False}, synchronize_session="fetch"
    )
    year.is_current = True
    db.flush()


# --- entering marks ----------------------------------------------------------------


@dataclass
class MarkEntry:
    student_id: str
    status: str | None  # ENTERED, ABSENT, EXEMPT, or None to clear
    marks: str | None
    reason: str | None


@dataclass
class MarkChange:
    student_id: str
    old: tuple[str | None, str | None]
    new: tuple[str | None, str | None]


def save_marks(
    db: Session,
    component: AssessmentComponent,
    entries: list[MarkEntry],
    *,
    allowed_student_ids: set[str],
    user_id: str,
) -> list[MarkChange]:
    """Saves several students' marks on one component, all or none. A mark
    already saved can be changed or cleared only with a reason. Returns what
    changed (unchanged entries are skipped)."""
    scheme = component.scheme
    if scheme.is_template or scheme.status != "PUBLISHED":
        raise SchemeError("Marks can only be entered on a published scheme.")
    existing = {
        m.student_id: m
        for m in db.query(ComponentMark)
        .filter(ComponentMark.component_id == component.id, ComponentMark.student_id.in_([e.student_id for e in entries]))
        .with_for_update()
        .all()
    }
    maximum = to_decimal(component.max_marks)
    problems: list[str] = []
    planned: list[tuple[MarkEntry, str | None, str | None]] = []
    seen: set[str] = set()
    for entry in entries:
        if entry.student_id in seen:
            problems.append("A student appears twice in one save.")
            continue
        seen.add(entry.student_id)
        if entry.student_id not in allowed_student_ids:
            problems.append("One of these students is not in a section you can enter marks for.")
            continue
        status = (entry.status or "").strip().upper() or None
        marks_text = None
        if status is not None and status not in MARK_STATUSES:
            problems.append("Each entry must be marks, Absent or Exempt.")
            continue
        if status == "ENTERED":
            if component.source != "ENTERED":
                problems.append(f"\"{component.name}\" takes its marks from the platform; only Absent or Exempt can be set.")
                continue
            number = to_decimal(entry.marks)
            if number is None or number < 0 or number > maximum or places(number) > MAX_PLACES_IN_MARKS:
                problems.append(
                    f"Marks must be from 0 to {as_text(maximum)}, with at most {MAX_PLACES_IN_MARKS} decimal places."
                )
                continue
            marks_text = as_text(number)
        current = existing.get(entry.student_id)
        old = (current.status, current.marks) if current else (None, None)
        if old == (status, marks_text):
            continue
        reason = (entry.reason or "").strip() or None
        if current is not None and not reason:
            problems.append("Give a reason for changing a mark that was already saved.")
            continue
        if reason and len(reason) > 200:
            problems.append("A reason must be 200 characters or fewer.")
            continue
        planned.append((entry, status, marks_text))
    if problems:
        raise SchemeError(sorted(set(problems), key=problems.index))

    changes: list[MarkChange] = []
    now = datetime.now(UTC)
    for entry, status, marks_text in planned:
        current = existing.get(entry.student_id)
        old = (current.status, current.marks) if current else (None, None)
        reason = (entry.reason or "").strip() or None
        if status is None:
            if current is not None:
                db.delete(current)
        elif current is None:
            db.add(
                ComponentMark(
                    school_id=scheme.school_id,
                    component_id=component.id,
                    student_id=entry.student_id,
                    status=status,
                    marks=marks_text,
                    change_reason=reason,
                    entered_by_user_id=user_id,
                    updated_by_user_id=user_id,
                )
            )
        else:
            current.status = status
            current.marks = marks_text
            current.change_reason = reason
            current.updated_by_user_id = user_id
            current.updated_at = now
        changes.append(MarkChange(student_id=entry.student_id, old=old, new=(status, marks_text)))
    db.flush()
    return changes


# --- results -------------------------------------------------------------------------


@dataclass
class ComponentResult:
    component: AssessmentComponent
    # MARKS (a number counts), ABSENT (counts 0), EXEMPT (left out),
    # MISSING (no marks yet: left out, result provisional).
    status: str
    marks: Decimal | None = None
    percent: Decimal | None = None
    pending_review: bool = False  # a counted platform attempt awaits a teacher
    meets_own_minimum: bool | None = None


@dataclass
class StudentResult:
    student_id: str
    components: list[ComponentResult]
    unrounded: Decimal | None
    shown: Decimal | None
    grade: str | None
    passed: bool | None
    provisional: bool
    exempt_count: int = 0
    notes: list[str] = field(default_factory=list)


def _year_bounds(year: AcademicYear | None) -> tuple[datetime, datetime] | None:
    if year is None:
        return None
    # A school's day, not UTC's: every school is in India for now, so
    # 00:00 to 05:30 IST on the first day belongs to the new year (review).
    start = datetime.combine(year.start_date, time.min, tzinfo=SCHOOL_TIMEZONE)
    end = datetime.combine(year.end_date, time.max, tzinfo=SCHOOL_TIMEZONE)
    return start, end


def _platform_scores(
    db: Session, scheme: AssessmentScheme, student_ids: list[str]
) -> dict[tuple[str, str], tuple[Decimal, Decimal, bool]]:
    """(component_id, student_id) -> (marks earned, marks possible, waiting
    for a teacher) over the component's practice sets, one counted attempt
    per set by the scheme's attempt rule. A set never assigned to the
    student is left out; a set assigned but not yet submitted makes the
    component MISSING for that student (reported as possible == 0)."""
    activity_to_components: dict[str, list[str]] = {}
    for component in scheme.components:
        if component.source == "PLATFORM":
            for link in component.activities:
                activity_to_components.setdefault(link.learning_activity_id, []).append(component.id)
    if not activity_to_components or not student_ids:
        return {}
    query = (
        db.query(Assignment.learning_activity_id, AssignmentTarget.student_id, AssignmentTarget.id)
        .join(AssignmentTarget, AssignmentTarget.assignment_id == Assignment.id)
        .filter(
            Assignment.school_id == scheme.school_id,
            Assignment.learning_activity_id.in_(list(activity_to_components)),
            Assignment.status != "CANCELLED",
            AssignmentTarget.student_id.in_(student_ids),
            # A student a teacher excused from a set (SKIPPED) is not
            # expected to do it, so it is left out like a set never given.
            AssignmentTarget.status != "SKIPPED",
        )
    )
    bounds = _year_bounds(scheme.academic_year)
    if bounds is not None:
        query = query.filter(Assignment.created_at >= bounds[0], Assignment.created_at <= bounds[1])
    targets = query.all()
    attempts: dict[str, list[tuple[Attempt, Evaluation | None]]] = {}
    if targets:
        for attempt, evaluation in (
            db.query(Attempt, Evaluation)
            .outerjoin(Evaluation, Evaluation.attempt_id == Attempt.id)
            .filter(
                Attempt.assignment_target_id.in_([t[2] for t in targets]),
                Attempt.status.in_(("SUBMITTED", "EVALUATED")),
            )
            .all()
        ):
            attempts.setdefault(attempt.assignment_target_id, []).append((attempt, evaluation))

    # Per (activity, student): the attempt that counts, across every
    # assignment of that set the student was given this year.
    per_set: dict[tuple[str, str], list[tuple[Attempt, Evaluation | None]]] = {}
    assigned: set[tuple[str, str]] = set()
    for activity_id, student_id, target_id in targets:
        assigned.add((activity_id, student_id))
        per_set.setdefault((activity_id, student_id), []).extend(attempts.get(target_id, []))

    totals: dict[tuple[str, str], list] = {}
    for activity_id, student_id in assigned:
        tried = per_set.get((activity_id, student_id), [])
        counted = _counted_attempt(tried, scheme.attempt_rule)
        for component_id in activity_to_components[activity_id]:
            entry = totals.setdefault((component_id, student_id), [Decimal(0), Decimal(0), False, False])
            if counted is None:
                entry[3] = True  # a set assigned and not yet done
                continue
            attempt, evaluation = counted
            entry[0] += Decimal(evaluation.final_score if evaluation else 0)
            entry[1] += Decimal(evaluation.max_score if evaluation else 0)
            if evaluation is None or evaluation.review_status not in _FINAL_REVIEW_STATUSES:
                entry[2] = True
            elif any(e is None or e.review_status not in _FINAL_REVIEW_STATUSES for _a, e in tried):
                # Another attempt is still being marked and could become the
                # one that counts (Best), so this figure is not final yet.
                entry[2] = entry[2] or scheme.attempt_rule == "BEST"
    return {
        key: (earned, possible if not undone else Decimal(0), pending)
        for key, (earned, possible, pending, undone) in totals.items()
    }


def _counted_attempt(tried: list[tuple[Attempt, Evaluation | None]], rule: str):
    if not tried:
        return None
    if rule == "FIRST":
        return min(tried, key=lambda pair: (pair[0].submitted_at or pair[0].created_at, pair[0].attempt_number))
    if rule == "LATEST":
        return max(tried, key=lambda pair: (pair[0].submitted_at or pair[0].created_at, pair[0].attempt_number))
    # BEST: the highest percentage among attempts already marked in full;
    # if none is, the latest one (its marks so far, shown as provisional).
    marked = [p for p in tried if p[1] is not None and p[1].review_status in _FINAL_REVIEW_STATUSES]
    if not marked:
        return max(tried, key=lambda pair: (pair[0].submitted_at or pair[0].created_at, pair[0].attempt_number))
    return max(
        marked,
        key=lambda pair: (
            Decimal(pair[1].final_score) / Decimal(pair[1].max_score) if pair[1].max_score else Decimal(0),
            pair[0].attempt_number,
        ),
    )


def grade_for(scheme: AssessmentScheme, shown: Decimal) -> str | None:
    for band in sorted(scheme.grade_bands, key=lambda b: to_decimal(b.min_percent), reverse=True):
        if shown >= to_decimal(band.min_percent):
            return band.label
    return None


def results(db: Session, scheme: AssessmentScheme, student_ids: list[str]) -> list[StudentResult]:
    """Each student's result on a scheme (see the module docstring)."""
    marks = {
        (m.component_id, m.student_id): m
        for m in db.query(ComponentMark)
        .filter(
            ComponentMark.component_id.in_([c.id for c in scheme.components]),
            ComponentMark.student_id.in_(student_ids),
        )
        .all()
    } if scheme.components and student_ids else {}
    platform = _platform_scores(db, scheme, student_ids)
    pass_percent = to_decimal(scheme.pass_percent)
    out: list[StudentResult] = []
    for student_id in student_ids:
        component_results: list[ComponentResult] = []
        weighted = Decimal(0)
        weight_counted = Decimal(0)
        provisional = False
        exempt = 0
        own_minimum_failed = False
        for component in scheme.components:
            maximum = to_decimal(component.max_marks)
            weight = to_decimal(component.weight_percent)
            mark = marks.get((component.id, student_id))
            result = ComponentResult(component=component, status="MISSING")
            if mark is not None and mark.status == "EXEMPT":
                result.status = "EXEMPT"
            elif mark is not None and mark.status == "ABSENT":
                result.status = "ABSENT"
                result.marks = Decimal(0)
                result.percent = Decimal(0)
            elif component.source == "ENTERED":
                if mark is not None and mark.status == "ENTERED":
                    result.status = "MARKS"
                    result.marks = to_decimal(mark.marks)
                    result.percent = result.marks / maximum * HUNDRED
            else:
                earned, possible, pending = platform.get((component.id, student_id), (Decimal(0), Decimal(0), False))
                if possible > 0:
                    result.status = "MARKS"
                    result.percent = earned / possible * HUNDRED
                    result.marks = result.percent * maximum / HUNDRED
                    result.pending_review = pending
            if result.status == "EXEMPT":
                exempt += 1
            elif result.status == "MISSING":
                provisional = True
            else:
                weighted += result.percent * weight
                weight_counted += weight
                provisional = provisional or result.pending_review
                minimum = to_decimal(component.min_pass_percent) if component.min_pass_percent else None
                if minimum is not None:
                    result.meets_own_minimum = round_half_up(result.percent, scheme.decimal_places) >= minimum
                    own_minimum_failed = own_minimum_failed or not result.meets_own_minimum
            component_results.append(result)
        unrounded = shown = grade = passed = None
        notes: list[str] = []
        if weight_counted > 0:
            unrounded = weighted / weight_counted
            shown = round_half_up(unrounded, scheme.decimal_places)
            grade = grade_for(scheme, shown)
            passed = shown >= pass_percent and not own_minimum_failed
        if exempt and exempt == len(scheme.components):
            notes.append("No result: exempt from every component.")
        elif exempt:
            notes.append(
                "Exempt from " + ("one component" if exempt == 1 else f"{exempt} components")
                + "; the others count in proportion."
            )
        out.append(
            StudentResult(
                student_id=student_id,
                components=component_results,
                unrounded=unrounded,
                shown=shown,
                grade=grade,
                passed=passed,
                provisional=provisional,
                exempt_count=exempt,
                notes=notes,
            )
        )
    return out


def in_class_clause(scheme: AssessmentScheme):
    """Students of the scheme's school and class: the same pairing
    learning_service.create_assignment targets by (class_name is the class
    level's code, "5"), or the normalised class_level_id where it is set."""
    code = scheme.class_level.code if scheme.class_level else None
    return and_(
        Student.school_id == scheme.school_id,
        Student.is_active.is_(True),
        or_(Student.class_level_id == scheme.class_level_id, Student.class_name == code),
    )


def section_students(db: Session, scheme: AssessmentScheme, section: str) -> list[Student]:
    return (
        db.query(Student)
        .options(joinedload(Student.user))
        .filter(in_class_clause(scheme), Student.section == section)
        .order_by(Student.student_code)
        .all()
    )
