"""The Assessment Scheme's API (Phase 4, #165, 23 Oct 2026).

Design: PHASE4_ASSESSMENT_SCHEME_DESIGN.md, approved by Shailesh. The rules
themselves live in app/services/assessment_service.py; this file decides
who may do what (design, section 5):

  * School Admin (ADMIN): their own school's academic years and schemes:
    create, edit, publish, make a new version; enter marks; see results.
  * Super Admin: the same for any school (naming it), plus the templates.
    A template is DRAFT until Ashalatha has checked it and a Super Admin
    publishes it; only then can a school copy it.
  * Teacher: reads the published schemes of the subjects they teach; enters
    marks for the sections they teach now; sees results for every section
    they have taught (the 20 Aug 2026 handover rule, as for practice).
  * Student: nothing here; results reach them through the report card
    (#188).

Anything outside a caller's reach is a 404, this codebase's convention for
not disclosing that another school's record exists.
"""
from datetime import date

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import and_, false, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.errors import api_error
from app.core.rate_limit import limiter
from app.database import get_db
from app.dependencies import require_roles
from app.models import (
    AcademicYear,
    AssessmentComponent,
    AssessmentScheme,
    Chapter,
    ComponentMark,
    LearningActivity,
    School,
    Student,
    TeacherSectionAssignment,
    User,
)
from app.services import assessment_service as service
from app.services import practice_access_service
from app.services.assessment_service import SchemeError
from app.services.assessment_templates import create_standard_templates, refresh_standard_templates
from app.services.audit_service import log_audit_event
from app.services.practice_access_service import Viewer

router = APIRouter(prefix="/api/assessment", tags=["assessment"])


def _viewer(
    user: User = Depends(require_roles("TEACHER", "ADMIN", "SUPER_ADMIN")),
    db: Session = Depends(get_db),
) -> Viewer:
    return practice_access_service.resolve_viewer(db, user)


def _refuse(error: SchemeError):
    api_error(422, "VALIDATION_ERROR", error.problems[0], {"problems": error.problems})


def _not_found(what: str = "scheme"):
    api_error(404, "NOT_FOUND", f"We couldn't find that {what}.")


def _school_for(db: Session, viewer: Viewer, requested: str | None) -> str:
    """An Admin acts on their own school; a Super Admin names one."""
    if viewer.role == "SUPER_ADMIN":
        if not requested:
            api_error(422, "VALIDATION_ERROR", "Choose a school first.")
        if db.get(School, requested) is None:
            _not_found("school")
        return requested
    if viewer.role != "ADMIN":
        api_error(403, "FORBIDDEN", "Only a school admin can do that.")
    if requested and requested != viewer.school_id:
        _not_found("school")
    return viewer.school_id


# --- access to one scheme --------------------------------------------------------


def _overlaps_year(year: AcademicYear | None):
    """A teacher's window counts for a scheme only if it overlaps the
    scheme's academic year: the 20 Aug 2026 handover rule (a teacher reads
    what happened on their watch, not after they left), found missing in
    review on 23 Oct 2026."""
    if year is None:
        return false()
    return and_(
        TeacherSectionAssignment.start_date <= year.end_date,
        or_(TeacherSectionAssignment.end_date.is_(None), TeacherSectionAssignment.end_date > year.start_date),
    )


def _teacher_windows(db: Session, viewer: Viewer, scheme: AssessmentScheme) -> list[TeacherSectionAssignment]:
    return (
        db.query(TeacherSectionAssignment)
        .filter(
            TeacherSectionAssignment.teacher_id == viewer.teacher.id,
            TeacherSectionAssignment.school_id == scheme.school_id,
            TeacherSectionAssignment.class_level_id == scheme.class_level_id,
            TeacherSectionAssignment.board_course_id == scheme.board_course_id,
            _overlaps_year(scheme.academic_year),
        )
        .all()
    )


def _can_manage(viewer: Viewer, scheme: AssessmentScheme) -> bool:
    if scheme.is_template:
        return viewer.role == "SUPER_ADMIN"
    return viewer.role == "SUPER_ADMIN" or (viewer.role == "ADMIN" and scheme.school_id == viewer.school_id)


def _load(db: Session, viewer: Viewer, scheme_id: str, *, manage: bool = False) -> AssessmentScheme:
    scheme = (
        db.query(AssessmentScheme)
        .options(
            joinedload(AssessmentScheme.components).joinedload(AssessmentComponent.activities),
            joinedload(AssessmentScheme.grade_bands),
        )
        .filter(AssessmentScheme.id == scheme_id)
        .first()
    )
    if scheme is None:
        _not_found()
    if _can_manage(viewer, scheme):
        return scheme
    visible = False
    if scheme.is_template:
        visible = viewer.role == "ADMIN" and scheme.status == "PUBLISHED"
    elif viewer.is_teacher and scheme.school_id == viewer.school_id and scheme.status != "DRAFT":
        visible = bool(_teacher_windows(db, viewer, scheme))
    if not visible:
        _not_found()
    if manage:
        api_error(403, "FORBIDDEN", "Only a school admin can change a scheme.")
    return scheme


def _sections(db: Session, viewer: Viewer, scheme: AssessmentScheme) -> dict[str, bool]:
    """Section -> whether this viewer may enter marks for it now."""
    if viewer.is_teacher:
        sections: dict[str, bool] = {}
        for window in _teacher_windows(db, viewer, scheme):
            sections[window.section] = sections.get(window.section, False) or window.end_date is None
        return dict(sorted(sections.items()))
    rows = (
        db.query(Student.section)
        .filter(service.in_class_clause(scheme), Student.section.isnot(None))
        .distinct()
        .all()
    )
    return {section: True for (section,) in sorted(rows) if section and section.strip()}


def _require_section(db: Session, viewer: Viewer, scheme: AssessmentScheme, section: str, *, to_enter: bool) -> None:
    if scheme.is_template:
        _not_found()
    sections = _sections(db, viewer, scheme)
    if section not in sections:
        _not_found("section")
    if to_enter and not sections[section]:
        api_error(403, "FORBIDDEN", "You no longer teach this section, so you can see its marks but not change them.")


# --- what is sent ------------------------------------------------------------------


def _year_dict(year: AcademicYear | None) -> dict | None:
    if year is None:
        return None
    return {
        "id": year.id,
        "label": year.label,
        "startDate": year.start_date.isoformat(),
        "endDate": year.end_date.isoformat(),
        "isCurrent": year.is_current,
    }


def _scheme_summary(scheme: AssessmentScheme) -> dict:
    return {
        "id": scheme.id,
        "lineageId": scheme.lineage_id,
        "version": scheme.version,
        "status": scheme.status,
        "name": scheme.name,
        "description": scheme.description,
        "isTemplate": scheme.is_template,
        "schoolId": scheme.school_id,
        "academicYear": _year_dict(scheme.academic_year),
        "classLevel": (
            {"id": scheme.class_level.id, "displayName": scheme.class_level.display_name} if scheme.class_level else None
        ),
        "boardCourse": (
            {"id": scheme.board_course.id, "displayName": scheme.board_course.display_name}
            if scheme.board_course
            else None
        ),
        "publishedAt": scheme.published_at.isoformat() if scheme.published_at else None,
        "updatedAt": scheme.updated_at.isoformat() if scheme.updated_at else None,
    }


def _scheme_detail(db: Session, viewer: Viewer, scheme: AssessmentScheme) -> dict:
    activity_ids = [link.learning_activity_id for c in scheme.components for link in c.activities]
    titles = (
        {a.id: a.title for a in db.query(LearningActivity).filter(LearningActivity.id.in_(activity_ids)).all()}
        if activity_ids
        else {}
    )
    newer = (
        db.query(AssessmentScheme.id, AssessmentScheme.version, AssessmentScheme.status)
        .filter(AssessmentScheme.lineage_id == scheme.lineage_id, AssessmentScheme.version > scheme.version)
        .order_by(AssessmentScheme.version.desc())
        .first()
    )
    can_manage = _can_manage(viewer, scheme)
    return {
        **_scheme_summary(scheme),
        "attemptRule": scheme.attempt_rule,
        "passPercent": scheme.pass_percent,
        "passLabel": scheme.pass_label,
        "failLabel": scheme.fail_label,
        "decimalPlaces": scheme.decimal_places,
        "components": [
            {
                "id": c.id,
                "componentKey": c.component_key,
                "name": c.name,
                "kind": c.kind,
                "term": c.term,
                "source": c.source,
                "maxMarks": c.max_marks,
                "weightPercent": c.weight_percent,
                "minPassPercent": c.min_pass_percent,
                "activities": [
                    {"id": link.learning_activity_id, "title": titles.get(link.learning_activity_id)}
                    for link in c.activities
                ],
            }
            for c in scheme.components
        ],
        "gradeBands": [{"label": b.label, "minPercent": b.min_percent} for b in scheme.grade_bands],
        "canManage": can_manage,
        "publishProblems": service.publish_problems(db, scheme) if scheme.status == "DRAFT" and can_manage else [],
        "newerVersion": {"id": newer[0], "version": newer[1], "status": newer[2]} if newer else None,
    }


# --- academic years ---------------------------------------------------------------


class YearBody(BaseModel):
    schoolId: str | None = None
    label: str = Field(max_length=20)
    startDate: date
    endDate: date


@router.get("/years")
def list_years(schoolId: str | None = None, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    school_id = viewer.school_id if viewer.is_teacher else _school_for(db, viewer, schoolId)
    years = (
        db.query(AcademicYear).filter(AcademicYear.school_id == school_id).order_by(AcademicYear.start_date.desc()).all()
    )
    return {"years": [_year_dict(y) for y in years]}


@router.post("/years")
@limiter.limit("30/minute")
def create_year(
    request: Request, body: YearBody, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)
):
    school_id = _school_for(db, viewer, body.schoolId)
    try:
        label = service.clean_year(body.label, body.startDate, body.endDate)
    except SchemeError as error:
        _refuse(error)
    if db.query(AcademicYear).filter(AcademicYear.school_id == school_id, AcademicYear.label == label).first():
        api_error(409, "CONFLICT", f"{label} is already one of this school's years.")
    year = AcademicYear(
        school_id=school_id,
        label=label,
        start_date=body.startDate,
        end_date=body.endDate,
        created_by_user_id=viewer.user.id,
    )
    db.add(year)
    db.flush()
    if not db.query(AcademicYear).filter(AcademicYear.school_id == school_id, AcademicYear.is_current.is_(True)).first():
        service.set_current_year(db, year)
    log_audit_event(
        db, "assessment.year.created", user_id=viewer.user.id, request=request,
        details={"schoolId": school_id, "yearId": year.id, "label": label},
    )
    db.commit()
    return _year_dict(year)


@router.post("/years/{year_id}/current")
@limiter.limit("30/minute")
def make_year_current(
    request: Request, year_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)
):
    year = db.get(AcademicYear, year_id)
    if year is None or (viewer.role != "SUPER_ADMIN" and (viewer.role != "ADMIN" or year.school_id != viewer.school_id)):
        _not_found("year")
    service.set_current_year(db, year)
    log_audit_event(
        db, "assessment.year.made_current", user_id=viewer.user.id, request=request,
        details={"schoolId": year.school_id, "yearId": year.id, "label": year.label},
    )
    db.commit()
    return _year_dict(year)


# --- schemes ------------------------------------------------------------------------


class ComponentBody(BaseModel):
    componentKey: str | None = Field(default=None, max_length=64)
    name: str = Field(default="", max_length=200)
    kind: str = Field(default="", max_length=40)
    term: str = Field(default="", max_length=40)
    source: str = Field(default="", max_length=40)
    maxMarks: str | float | int | None = None
    weightPercent: str | float | int | None = None
    minPassPercent: str | float | int | None = None
    activityIds: list[str] = Field(default_factory=list, max_length=100)


class BandBody(BaseModel):
    label: str = Field(default="", max_length=40)
    minPercent: str | float | int | None = None


class SchemeBody(BaseModel):
    name: str = Field(default="", max_length=300)
    description: str | None = Field(default=None, max_length=600)
    attemptRule: str = Field(default="BEST", max_length=20)
    passPercent: str | float | int | None = "33"
    passLabel: str = Field(default="Pass", max_length=80)
    failLabel: str = Field(default="Needs Improvement", max_length=80)
    decimalPlaces: int = 0
    components: list[ComponentBody] = Field(default_factory=list, max_length=40)
    gradeBands: list[BandBody] = Field(default_factory=list, max_length=30)


def _to_input(body: SchemeBody) -> service.SchemeInput:
    def text(value):
        return None if value is None else str(value)

    return service.SchemeInput(
        name=body.name,
        description=body.description,
        attempt_rule=body.attemptRule,
        pass_percent=text(body.passPercent),
        pass_label=body.passLabel,
        fail_label=body.failLabel,
        decimal_places=body.decimalPlaces,
        components=[
            service.ComponentInput(
                name=c.name,
                kind=c.kind,
                term=c.term,
                source=c.source,
                max_marks=text(c.maxMarks),
                weight_percent=text(c.weightPercent),
                min_pass_percent=text(c.minPassPercent),
                activity_ids=c.activityIds,
                component_key=c.componentKey,
            )
            for c in body.components
        ],
        grade_bands=[service.BandInput(label=b.label, min_percent=text(b.minPercent)) for b in body.gradeBands],
    )


@router.get("/schemes")
def list_schemes(
    schoolId: str | None = None,
    yearId: str | None = None,
    viewer: Viewer = Depends(_viewer),
    db: Session = Depends(get_db),
):
    query = db.query(AssessmentScheme).filter(AssessmentScheme.is_template.is_(False))
    if viewer.is_teacher:
        windows = (
            db.query(TeacherSectionAssignment)
            .filter(
                TeacherSectionAssignment.teacher_id == viewer.teacher.id,
                TeacherSectionAssignment.school_id == viewer.school_id,
            )
            .all()
        )
        courses = {w.board_course_id for w in windows}
        query = query.filter(
            AssessmentScheme.school_id == viewer.school_id,
            AssessmentScheme.status != "DRAFT",
            AssessmentScheme.board_course_id.in_(courses or {""}),
        )
    else:
        query = query.filter(AssessmentScheme.school_id == _school_for(db, viewer, schoolId))
    if yearId:
        query = query.filter(AssessmentScheme.academic_year_id == yearId)
    schemes = query.order_by(AssessmentScheme.name, AssessmentScheme.version).all()
    if viewer.is_teacher:
        # Same rule as _teacher_windows: a window that overlaps the year.
        def taught(scheme: AssessmentScheme) -> bool:
            year = scheme.academic_year
            return year is not None and any(
                w.class_level_id == scheme.class_level_id
                and w.board_course_id == scheme.board_course_id
                and w.start_date <= year.end_date
                and (w.end_date is None or w.end_date > year.start_date)
                for w in windows
            )

        schemes = [s for s in schemes if taught(s)]
    return {"schemes": [_scheme_summary(s) for s in schemes]}


class CreateSchemeBody(BaseModel):
    schoolId: str | None = None
    academicYearId: str
    boardCourseId: str
    templateId: str | None = None
    scheme: SchemeBody | None = None


@router.post("/schemes")
@limiter.limit("30/minute")
def create_scheme(
    request: Request, body: CreateSchemeBody, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)
):
    school_id = _school_for(db, viewer, body.schoolId)
    try:
        year, course = service.check_scope(
            db, school_id=school_id, academic_year_id=body.academicYearId, board_course_id=body.boardCourseId
        )
        if body.templateId:
            template = db.get(AssessmentScheme, body.templateId)
            if template is None or not template.is_template or template.status != "PUBLISHED":
                _not_found("template")
            scheme = service.copy_scheme(
                db, template, user_id=viewer.user.id, school_id=school_id, academic_year_id=year.id,
                class_level_id=course.class_level_id, board_course_id=course.id, as_new_version=False,
            )
        else:
            cleaned = service.clean_scheme_input(
                _to_input(body.scheme or SchemeBody(name=f"{course.display_name}, {year.label}"))
            )
            scheme = service.new_scheme(
                db, user_id=viewer.user.id, school_id=school_id, is_template=False, academic_year_id=year.id,
                class_level_id=course.class_level_id, board_course_id=course.id, cleaned=cleaned,
            )
    except SchemeError as error:
        db.rollback()
        _refuse(error)
    log_audit_event(
        db, "assessment.scheme.created", user_id=viewer.user.id, request=request,
        details={"schoolId": school_id, "schemeId": scheme.id, "fromTemplateId": body.templateId},
    )
    db.commit()
    return _scheme_detail(db, viewer, _load(db, viewer, scheme.id))


@router.get("/schemes/{scheme_id}")
def get_scheme(scheme_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    return _scheme_detail(db, viewer, _load(db, viewer, scheme_id))


@router.put("/schemes/{scheme_id}")
@limiter.limit("60/minute")
def update_scheme(
    request: Request, scheme_id: str, body: SchemeBody, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)
):
    scheme = _load(db, viewer, scheme_id, manage=True)
    try:
        service.write_scheme(db, scheme, service.clean_scheme_input(_to_input(body)))
    except SchemeError as error:
        db.rollback()
        _refuse(error)
    log_audit_event(
        db, "assessment.scheme.updated", user_id=viewer.user.id, request=request,
        details={"schemeId": scheme.id, "version": scheme.version},
    )
    db.commit()
    db.expire_all()
    return _scheme_detail(db, viewer, _load(db, viewer, scheme_id))


@router.delete("/schemes/{scheme_id}")
@limiter.limit("30/minute")
def delete_scheme(request: Request, scheme_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    scheme = _load(db, viewer, scheme_id, manage=True)
    if scheme.status != "DRAFT":
        api_error(409, "CONFLICT", "A published scheme cannot be deleted; it is kept with the results worked out from it.")
    log_audit_event(
        db, "assessment.scheme.deleted", user_id=viewer.user.id, request=request,
        details={"schemeId": scheme.id, "name": scheme.name, "version": scheme.version},
    )
    db.delete(scheme)
    db.commit()
    return {"deleted": True}


@router.post("/schemes/{scheme_id}/publish")
@limiter.limit("30/minute")
def publish_scheme(request: Request, scheme_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    scheme = _load(db, viewer, scheme_id, manage=True)
    try:
        outcome = service.publish(db, scheme, viewer.user.id)
    except SchemeError as error:
        db.rollback()
        _refuse(error)
    log_audit_event(
        db, "assessment.scheme.published", user_id=viewer.user.id, request=request,
        details={
            "schemeId": scheme.id,
            "version": scheme.version,
            "isTemplate": scheme.is_template,
            "replacedSchemeId": outcome.replaced.id if outcome.replaced else None,
            "marksCarried": outcome.marks_carried,
            "marksNotCarried": outcome.marks_dropped,
        },
    )
    db.commit()
    db.expire_all()
    return _scheme_detail(db, viewer, _load(db, viewer, scheme_id))


@router.post("/schemes/{scheme_id}/new-version")
@limiter.limit("30/minute")
def new_version(request: Request, scheme_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    scheme = _load(db, viewer, scheme_id, manage=True)
    if scheme.status != "PUBLISHED":
        api_error(409, "CONFLICT", "Only the published version can be copied into a new version.")
    try:
        copy = service.copy_scheme(
            db, scheme, user_id=viewer.user.id, school_id=scheme.school_id, academic_year_id=scheme.academic_year_id,
            class_level_id=scheme.class_level_id, board_course_id=scheme.board_course_id, as_new_version=True,
        )
    except SchemeError as error:
        db.rollback()
        _refuse(error)
    except IntegrityError:
        db.rollback()
        api_error(409, "CONFLICT", "Someone made a new version of this scheme at the same moment. Reload to see it.")
    log_audit_event(
        db, "assessment.scheme.new_version", user_id=viewer.user.id, request=request,
        details={"schemeId": copy.id, "fromSchemeId": scheme.id, "version": copy.version},
    )
    db.commit()
    return _scheme_detail(db, viewer, _load(db, viewer, copy.id))


@router.get("/schemes/{scheme_id}/activities")
def linkable_activities(scheme_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    """The practice sets a platform component may link: the published sets
    of the scheme's own subject, in chapter order."""
    scheme = _load(db, viewer, scheme_id, manage=True)
    if scheme.is_template:
        return {"activities": []}
    rows = (
        db.query(LearningActivity, Chapter)
        .join(Chapter, Chapter.id == LearningActivity.chapter_id)
        .filter(Chapter.board_course_id == scheme.board_course_id, LearningActivity.status == "PUBLISHED")
        .order_by(Chapter.sequence, LearningActivity.sequence, LearningActivity.title)
        .limit(2000)
        .all()
    )
    return {
        "activities": [
            {
                "id": activity.id,
                "title": activity.title,
                "activityType": activity.activity_type,
                "chapter": {"id": chapter.id, "title": chapter.title, "chapterNo": chapter.chapter_no},
            }
            for activity, chapter in rows
        ]
    }


@router.get("/schemes/{scheme_id}/sections")
def scheme_sections(scheme_id: str, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    scheme = _load(db, viewer, scheme_id)
    if scheme.is_template:
        return {"sections": []}
    can_enter = scheme.status == "PUBLISHED"
    return {
        "sections": [
            {"section": section, "canEnterMarks": can_enter and current}
            for section, current in _sections(db, viewer, scheme).items()
        ]
    }


# --- marks -----------------------------------------------------------------------------


def _student_row(student: Student) -> dict:
    return {
        "studentId": student.id,
        "studentCode": student.student_code,
        "studentName": student.user.full_name if student.user else None,
    }


def _component_of(scheme: AssessmentScheme, component_id: str) -> AssessmentComponent:
    for component in scheme.components:
        if component.id == component_id:
            return component
    _not_found("component")


@router.get("/schemes/{scheme_id}/components/{component_id}/marks")
def get_marks(
    scheme_id: str,
    component_id: str,
    section: str = Query(min_length=1, max_length=50),
    viewer: Viewer = Depends(_viewer),
    db: Session = Depends(get_db),
):
    scheme = _load(db, viewer, scheme_id)
    component = _component_of(scheme, component_id)
    _require_section(db, viewer, scheme, section, to_enter=False)
    students = service.section_students(db, scheme, section)
    marks = {
        m.student_id: m
        for m in db.query(ComponentMark)
        .filter(ComponentMark.component_id == component.id, ComponentMark.student_id.in_([s.id for s in students]))
        .all()
    } if students else {}
    can_enter = scheme.status == "PUBLISHED" and _sections(db, viewer, scheme).get(section, False)
    return {
        "component": {
            "id": component.id,
            "name": component.name,
            "source": component.source,
            "maxMarks": component.max_marks,
        },
        "canEnterMarks": can_enter,
        "rows": [
            {
                **_student_row(s),
                "status": marks[s.id].status if s.id in marks else None,
                "marks": marks[s.id].marks if s.id in marks else None,
                "updatedAt": marks[s.id].updated_at.isoformat() if s.id in marks and marks[s.id].updated_at else None,
            }
            for s in students
        ],
    }


class MarkBody(BaseModel):
    studentId: str
    status: str | None = Field(default=None, max_length=20)
    marks: str | float | int | None = None
    reason: str | None = Field(default=None, max_length=400)


class SaveMarksBody(BaseModel):
    section: str = Field(min_length=1, max_length=50)
    entries: list[MarkBody] = Field(min_length=1, max_length=200)


@router.put("/schemes/{scheme_id}/components/{component_id}/marks")
@limiter.limit("60/minute")
def save_marks(
    request: Request,
    scheme_id: str,
    component_id: str,
    body: SaveMarksBody,
    viewer: Viewer = Depends(_viewer),
    db: Session = Depends(get_db),
):
    scheme = _load(db, viewer, scheme_id)
    component = _component_of(scheme, component_id)
    _require_section(db, viewer, scheme, body.section, to_enter=True)
    allowed = {s.id for s in service.section_students(db, scheme, body.section)}
    try:
        changes = service.save_marks(
            db,
            component,
            [
                service.MarkEntry(
                    student_id=e.studentId,
                    status=e.status,
                    marks=None if e.marks is None else str(e.marks),
                    reason=e.reason,
                )
                for e in body.entries
            ],
            allowed_student_ids=allowed,
            user_id=viewer.user.id,
        )
    except SchemeError as error:
        db.rollback()
        _refuse(error)
    except IntegrityError:
        db.rollback()
        api_error(409, "CONFLICT", "Someone saved marks for these students at the same moment. Reload and try again.")
    if changes:
        log_audit_event(
            db, "assessment.marks.saved", user_id=viewer.user.id, request=request,
            details={
                "schemeId": scheme.id,
                "componentId": component.id,
                "section": body.section,
                "changes": [
                    {"studentId": c.student_id, "old": list(c.old), "new": list(c.new)} for c in changes
                ],
                "reasons": {
                    e.studentId: e.reason.strip() for e in body.entries if e.reason and e.reason.strip()
                },
            },
        )
    db.commit()
    return {"saved": len(changes)}


# --- results ------------------------------------------------------------------------


def _number(value) -> str | None:
    return None if value is None else service.as_text(value)


@router.get("/schemes/{scheme_id}/results")
def get_results(
    scheme_id: str,
    section: str = Query(min_length=1, max_length=50),
    viewer: Viewer = Depends(_viewer),
    db: Session = Depends(get_db),
):
    scheme = _load(db, viewer, scheme_id)
    _require_section(db, viewer, scheme, section, to_enter=False)
    students = service.section_students(db, scheme, section)
    results = service.results(db, scheme, [s.id for s in students])
    by_id = {s.id: s for s in students}
    return {
        "scheme": _scheme_summary(scheme),
        "components": [
            {"id": c.id, "name": c.name, "maxMarks": c.max_marks, "weightPercent": c.weight_percent, "source": c.source}
            for c in scheme.components
        ],
        "rows": [
            {
                **_student_row(by_id[r.student_id]),
                "components": [
                    {
                        "componentId": c.component.id,
                        "status": c.status,
                        "marks": _number(service.round_half_up(c.marks, 2)) if c.marks is not None else None,
                        "percent": _number(service.round_half_up(c.percent, 2)) if c.percent is not None else None,
                        "pendingReview": c.pending_review,
                        "meetsOwnMinimum": c.meets_own_minimum,
                    }
                    for c in r.components
                ],
                "result": _number(r.shown),
                # Kept for audit and reconciliation (blueprint 8.3), to 6 places.
                "unrounded": _number(service.round_half_up(r.unrounded, 6)) if r.unrounded is not None else None,
                "grade": r.grade,
                "outcome": None if r.passed is None else ("PASS" if r.passed else "BELOW_PASS"),
                "outcomeLabel": None if r.passed is None else (scheme.pass_label if r.passed else scheme.fail_label),
                "provisional": r.provisional,
                "notes": r.notes,
            }
            for r in results
        ],
    }


# --- templates -------------------------------------------------------------------------


@router.get("/templates")
def list_templates(viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    if viewer.is_teacher:
        api_error(403, "FORBIDDEN", "Only a school admin can use templates.")
    query = db.query(AssessmentScheme).filter(AssessmentScheme.is_template.is_(True))
    if viewer.role != "SUPER_ADMIN":
        query = query.filter(AssessmentScheme.status == "PUBLISHED")
    return {"templates": [_scheme_summary(t) for t in query.order_by(AssessmentScheme.name, AssessmentScheme.version).all()]}


@router.post("/templates")
@limiter.limit("30/minute")
def create_template(
    request: Request, body: SchemeBody, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)
):
    if viewer.role != "SUPER_ADMIN":
        api_error(403, "FORBIDDEN", "Only a Super Admin can make templates.")
    try:
        template = service.new_scheme(
            db, user_id=viewer.user.id, school_id=None, is_template=True, academic_year_id=None,
            class_level_id=None, board_course_id=None, cleaned=service.clean_scheme_input(_to_input(body)),
        )
    except SchemeError as error:
        db.rollback()
        _refuse(error)
    log_audit_event(
        db, "assessment.template.created", user_id=viewer.user.id, request=request, details={"schemeId": template.id}
    )
    db.commit()
    return _scheme_detail(db, viewer, _load(db, viewer, template.id))


@router.post("/templates/standard")
@limiter.limit("10/minute")
def create_standard(request: Request, viewer: Viewer = Depends(_viewer), db: Session = Depends(get_db)):
    """Creates the CBSE-style and ICSE-style starting templates that do not
    exist yet, as drafts for Ashalatha to check before they are published."""
    if viewer.role != "SUPER_ADMIN":
        api_error(403, "FORBIDDEN", "Only a Super Admin can make templates.")
    refreshed = refresh_standard_templates(db)
    if refreshed["removed"] or refreshed["updated"]:
        log_audit_event(
            db, "assessment.template.refreshed", user_id=viewer.user.id, request=request, details=refreshed,
        )
    created = create_standard_templates(db, viewer.user.id)
    if created:
        log_audit_event(
            db, "assessment.template.created", user_id=viewer.user.id, request=request,
            details={"schemeIds": [t.id for t in created], "standard": True},
        )
    db.commit()
    return {"created": [_scheme_summary(t) for t in created]}
