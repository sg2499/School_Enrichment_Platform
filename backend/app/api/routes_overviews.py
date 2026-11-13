"""Read-only overview screens (#224, 12 Nov 2026): the Question Bank, Papers
and Mocks, Reports and Settings screens that used to be "Soon" in the rail,
and the teacher's My Classes.

Everything here is a count or a setting. Nothing returns a question's
wording or answer (the bank is the content owner's work, and a school needs
to know how much there is and how far it is reviewed, not to copy it), a
pattern's specification, a student's marks, an address or a browser. The
activity log names staff and says only "a student" for a child.
"""
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from app.core.brand import COMPANY_NAME, PRODUCT_NAME
from app.core.config import ACCESS_TOKEN_EXPIRE_MINUTES, IS_PRODUCTION
from app.core.errors import api_error
from app.core.pagination import PageParams, page_envelope, page_params, paginate
from app.core.security import ACCESS_TOKEN_EXPIRE_MINUTES_BY_ROLE
from app.database import get_db
from app.dependencies import get_current_teacher, require_roles
from app.models import (
    Assignment,
    AssignmentTarget,
    Attempt,
    AuditLog,
    Board,
    BoardCourse,
    Chapter,
    ClassLevel,
    ConceptLesson,
    CurriculumVersion,
    Discipline,
    MockPaper,
    MockPaperSitting,
    Question,
    QuestionPattern,
    ReportCardIssue,
    School,
    SchoolAdmin,
    SchoolCurriculumMap,
    Student,
    Teacher,
    TeacherSectionAssignment,
    User,
    WeeklyReportIssue,
)
from app.services.auth_service import LOCKOUT_DURATION_MINUTES, MAX_FAILED_LOGIN_ATTEMPTS
from app.services.session_service import MAX_SESSION_LIFETIME_MINUTES_BY_ROLE

router = APIRouter(prefix="/api/overview", tags=["overview"])

IST = timezone(timedelta(hours=5, minutes=30), "IST")
_READY = ("APPROVED", "PUBLISHED")


def _today() -> date:
    return datetime.now(IST).date()


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


# --- Question Bank: counts only ------------------------------------------


def _bank_scope(db: Session, user: User):
    """The chapters a caller may count. A Super Admin sees every chapter at any
    status. A school's admin sees only chapters that are published, in a
    published edition, and in the school's own board (when the school has
    one), the same rule as Curriculum Studio's list plus the board."""
    query = (
        db.query(Chapter, BoardCourse, Board, ClassLevel, Discipline)
        .join(BoardCourse, Chapter.board_course_id == BoardCourse.id)
        .join(Board, BoardCourse.board_id == Board.id)
        .join(ClassLevel, BoardCourse.class_level_id == ClassLevel.id)
        .join(Discipline, Chapter.discipline_id == Discipline.id)
    )
    if user.role == "SUPER_ADMIN":
        return query
    school_admin = db.query(SchoolAdmin).filter(SchoolAdmin.user_id == user.id).first()
    if not school_admin:
        api_error(403, "FORBIDDEN", "Your admin account isn't linked to a school. Please contact your platform administrator.")
    school = db.get(School, school_admin.school_id)
    query = query.join(CurriculumVersion, Chapter.curriculum_version_id == CurriculumVersion.id).filter(
        Chapter.status == "PUBLISHED", CurriculumVersion.status == "PUBLISHED"
    )
    if school and school.board:
        query = query.filter(func.upper(Board.code) == school.board.strip().upper())
    return query


@router.get("/question-bank")
def question_bank(user: User = Depends(require_roles("ADMIN", "SUPER_ADMIN")), db: Session = Depends(get_db)):
    """How much content there is, by chapter and skill, and how far it is
    reviewed. Counts only: no stem, option, answer, hint or explanation."""
    rows = _bank_scope(db, user).order_by(Board.code, ClassLevel.display_order, Discipline.code, Chapter.chapter_no).all()
    chapter_ids = [chapter.id for chapter, *_ in rows]
    is_super = user.role == "SUPER_ADMIN"

    skills: dict[str, list[ConceptLesson]] = {}
    per_skill: dict[str, dict] = {}
    if chapter_ids:
        for skill in (
            db.query(ConceptLesson)
            .filter(ConceptLesson.chapter_id.in_(chapter_ids))
            .order_by(ConceptLesson.chapter_id, ConceptLesson.sequence, ConceptLesson.code)
        ):
            skills.setdefault(skill.chapter_id, []).append(skill)
        ready = func.sum(case((Question.status.in_(_READY), 1), else_=0))
        in_review = func.sum(case((Question.status == "SME_REVIEW", 1), else_=0))
        flagged = func.sum(
            case((Question.quality_status == "FLAGGED", case((Question.status.in_(_READY), 0), else_=1)), else_=0)
        )
        for skill_id, difficulty, qtype, n, r, rv, fl in (
            db.query(Question.concept_lesson_id, Question.difficulty, Question.question_type, func.count(Question.id), ready, in_review, flagged)
            .join(ConceptLesson, Question.concept_lesson_id == ConceptLesson.id)
            .filter(ConceptLesson.chapter_id.in_(chapter_ids), Question.origin == "BANK")
            .group_by(Question.concept_lesson_id, Question.difficulty, Question.question_type)
        ):
            bucket = per_skill.setdefault(
                skill_id, {"questions": 0, "approved": 0, "inReview": 0, "flagged": 0, "byDifficulty": {}, "byType": {}}
            )
            bucket["questions"] += int(n)
            bucket["approved"] += int(r or 0)
            bucket["inReview"] += int(rv or 0)
            bucket["flagged"] += int(fl or 0)
            key = str(difficulty) if difficulty is not None else "none"
            bucket["byDifficulty"][key] = bucket["byDifficulty"].get(key, 0) + int(n)
            bucket["byType"][qtype] = bucket["byType"].get(qtype, 0) + int(n)

    chapters = []
    totals = {"chapters": 0, "skills": 0, "questions": 0, "approved": 0, "byDifficulty": {}, "byType": {}}
    if is_super:
        totals.update({"inReview": 0, "flagged": 0})
    for chapter, course, board, level, discipline in rows:
        chapter_skills = []
        c = {"questions": 0, "approved": 0, "inReview": 0, "flagged": 0, "byDifficulty": {}, "byType": {}}
        for skill in skills.get(chapter.id, []):
            s = per_skill.get(skill.id) or {"questions": 0, "approved": 0, "inReview": 0, "flagged": 0, "byDifficulty": {}, "byType": {}}
            for key in ("questions", "approved", "inReview", "flagged"):
                c[key] += s[key]
            for group in ("byDifficulty", "byType"):
                for k, v in s[group].items():
                    c[group][k] = c[group].get(k, 0) + v
            entry = {
                "id": skill.id,
                "code": skill.code,
                "title": skill.title,
                "questions": s["questions"],
                "approved": s["approved"],
                "byDifficulty": s["byDifficulty"],
            }
            if is_super:
                entry["inReview"] = s["inReview"]
                entry["flagged"] = s["flagged"]
            chapter_skills.append(entry)
        item = {
            "id": chapter.id,
            "code": chapter.code,
            "chapterNo": chapter.chapter_no,
            "title": chapter.title,
            "board": board.code,
            "classCode": level.code,
            "subject": discipline.display_name,
            "status": chapter.status,
            "skillCount": len(chapter_skills),
            "questions": c["questions"],
            "approved": c["approved"],
            "byDifficulty": c["byDifficulty"],
            "byType": c["byType"],
            "skills": chapter_skills,
        }
        if is_super:
            item["inReview"] = c["inReview"]
            item["flagged"] = c["flagged"]
        chapters.append(item)
        totals["chapters"] += 1
        totals["skills"] += len(chapter_skills)
        totals["questions"] += c["questions"]
        totals["approved"] += c["approved"]
        if is_super:
            totals["inReview"] += c["inReview"]
            totals["flagged"] += c["flagged"]
        for group in ("byDifficulty", "byType"):
            for k, v in c[group].items():
                totals[group][k] = totals[group].get(k, 0) + v
    return {"scope": "platform" if is_super else "school", "totals": totals, "chapters": chapters}


# --- Papers and Mocks: the pattern bank, counts only ----------------------


@router.get("/patterns")
def pattern_bank(_user: User = Depends(require_roles("SUPER_ADMIN")), db: Session = Depends(get_db)):
    """The mock-paper question patterns by chapter and status. Counts only: no
    specification, wording or answer."""
    rows = (
        db.query(Chapter, BoardCourse, Board, ClassLevel, Discipline)
        .join(BoardCourse, Chapter.board_course_id == BoardCourse.id)
        .join(Board, BoardCourse.board_id == Board.id)
        .join(ClassLevel, BoardCourse.class_level_id == ClassLevel.id)
        .join(Discipline, Chapter.discipline_id == Discipline.id)
        .order_by(Board.code, ClassLevel.display_order, Discipline.code, Chapter.chapter_no)
        .all()
    )
    by_chapter: dict[str, dict] = {}
    for chapter_id, status, marks, n in db.query(
        QuestionPattern.chapter_id, QuestionPattern.status, QuestionPattern.marks, func.count(QuestionPattern.id)
    ).group_by(QuestionPattern.chapter_id, QuestionPattern.status, QuestionPattern.marks):
        b = by_chapter.setdefault(chapter_id, {"total": 0, "byStatus": {}, "byMarks": {}})
        b["total"] += int(n)
        b["byStatus"][status] = b["byStatus"].get(status, 0) + int(n)
        b["byMarks"][str(marks)] = b["byMarks"].get(str(marks), 0) + int(n)
    chapters = []
    totals = {"total": 0, "byStatus": {"APPROVED": 0, "DRAFT": 0, "RETIRED": 0}, "byMarks": {}}
    for chapter, _course, board, level, discipline in rows:
        b = by_chapter.get(chapter.id, {"total": 0, "byStatus": {}, "byMarks": {}})
        chapters.append(
            {
                "id": chapter.id,
                "chapterNo": chapter.chapter_no,
                "title": chapter.title,
                "board": board.code,
                "classCode": level.code,
                "subject": discipline.display_name,
                "patterns": b["total"],
                "approved": b["byStatus"].get("APPROVED", 0),
                "draft": b["byStatus"].get("DRAFT", 0),
                "retired": b["byStatus"].get("RETIRED", 0),
                "byMarks": b["byMarks"],
            }
        )
        totals["total"] += b["total"]
        for k, v in b["byStatus"].items():
            totals["byStatus"][k] = totals["byStatus"].get(k, 0) + v
        for k, v in b["byMarks"].items():
            totals["byMarks"][k] = totals["byMarks"].get(k, 0) + v

    paper_status = {
        status: int(n) for status, n in db.query(MockPaper.status, func.count(MockPaper.id)).group_by(MockPaper.status)
    }
    return {"totals": totals, "chapters": chapters, "papersByStatus": paper_status}


# --- Reports: what each school has used, counts only ----------------------


@router.get("/usage")
def usage(_user: User = Depends(require_roles("SUPER_ADMIN")), db: Session = Depends(get_db)):
    """Per school: who is on Krama and what has been done with it. Counts
    only, nothing about any one person."""
    from app.api.routes_schools_admin import EMPTY_COUNTS, _counts

    schools = db.query(School).order_by(School.name).all()
    ids = [s.id for s in schools]
    counts = _counts(db, ids) if ids else {}

    def grouped(query) -> dict[str, int]:
        return {sid: int(n) for sid, n in query}

    assignments = grouped(
        db.query(Assignment.school_id, func.count(Assignment.id))
        .filter(Assignment.status != "CANCELLED")
        .group_by(Assignment.school_id)
    )
    handed_in = grouped(
        db.query(Assignment.school_id, func.count(Attempt.id))
        .join(AssignmentTarget, AssignmentTarget.assignment_id == Assignment.id)
        .join(Attempt, Attempt.assignment_target_id == AssignmentTarget.id)
        .filter(Attempt.status.in_(("SUBMITTED", "EVALUATED")))
        .group_by(Assignment.school_id)
    )
    papers = grouped(
        db.query(MockPaper.school_id, func.count(MockPaper.id))
        .filter(MockPaper.status.notin_(("DRAFT", "WITHDRAWN")))
        .group_by(MockPaper.school_id)
    )
    sittings = grouped(
        db.query(MockPaper.school_id, func.count(MockPaperSitting.id))
        .join(MockPaperSitting, MockPaperSitting.paper_id == MockPaper.id)
        .filter(MockPaperSitting.status == "SUBMITTED")
        .group_by(MockPaper.school_id)
    )
    cards = grouped(
        db.query(ReportCardIssue.school_id, func.count(ReportCardIssue.id))
        .filter(ReportCardIssue.status == "ISSUED")
        .group_by(ReportCardIssue.school_id)
    )
    weekly = grouped(
        db.query(WeeklyReportIssue.school_id, func.count(WeeklyReportIssue.id))
        .filter(WeeklyReportIssue.status == "ISSUED")
        .group_by(WeeklyReportIssue.school_id)
    )
    rows = []
    totals = {k: 0 for k in ("students", "teachers", "assignmentsSet", "setsHandedIn", "papersSet", "papersHandedIn", "reportCardSets", "weeklyReportSets")}
    for school in schools:
        c = counts.get(school.id) or dict(EMPTY_COUNTS)
        row = {
            "id": school.id,
            "name": school.name,
            "board": school.board,
            "city": school.city,
            "isActive": school.is_active,
            "students": c["students"],
            "teachers": c["teachers"],
            "sections": c["sections"],
            "notSignedIn": c["notSignedIn"],
            "lastActiveAt": c["lastActiveAt"],
            "assignmentsSet": assignments.get(school.id, 0),
            "setsHandedIn": handed_in.get(school.id, 0),
            "papersSet": papers.get(school.id, 0),
            "papersHandedIn": sittings.get(school.id, 0),
            "reportCardSets": cards.get(school.id, 0),
            "weeklyReportSets": weekly.get(school.id, 0),
        }
        rows.append(row)
        for key in totals:
            totals[key] += row[key]
    return {"schools": rows, "totals": totals, "asOf": datetime.now(timezone.utc).isoformat()}


# --- Settings: the platform's details, rules and recent activity ----------


def _minutes_words(minutes: int) -> str:
    if minutes % 60 == 0:
        hours = minutes // 60
        return f"{hours} hour" + ("" if hours == 1 else "s")
    return f"{minutes} minutes"


@router.get("/platform")
def platform_settings(_user: User = Depends(require_roles("SUPER_ADMIN")), db: Session = Depends(get_db)):
    """What the Super Admin's Settings screen shows. Read-only: the sign-in
    rules are in the code, so changing one is a release, not a form."""
    roles = (("STUDENT", "Students"), ("TEACHER", "Teachers"), ("ADMIN", "School Admins"), ("SUPER_ADMIN", "Super Admins"))
    rules = []
    for role, label in roles:
        idle = ACCESS_TOKEN_EXPIRE_MINUTES_BY_ROLE.get(role, ACCESS_TOKEN_EXPIRE_MINUTES)
        cap = MAX_SESSION_LIFETIME_MINUTES_BY_ROLE.get(role)
        rules.append(
            {
                "role": role,
                "label": label,
                "idleMinutes": idle,
                "idle": _minutes_words(idle),
                "maxMinutes": cap,
                "max": _minutes_words(cap) if cap else "No fixed limit",
                "twoFactor": "Required" if role in ("ADMIN", "SUPER_ADMIN") else "Not used",
            }
        )
    return {
        "product": {"name": PRODUCT_NAME, "company": COMPANY_NAME, "environment": "Production" if IS_PRODUCTION else "Development"},
        "platform": {
            "schools": db.query(School).count(),
            "activeSchools": db.query(School).filter(School.is_active.is_(True)).count(),
            "boards": [code for (code,) in db.query(Board.code).filter(Board.is_active.is_(True)).order_by(Board.code)],
        },
        "signIn": {
            "rules": rules,
            "lockoutAttempts": MAX_FAILED_LOGIN_ATTEMPTS,
            "lockoutMinutes": LOCKOUT_DURATION_MINUTES,
        },
    }


_EVENT_WORDS = {
    "auth.login.password_ok_awaiting_2fa": "Password Accepted, Second Step Pending",
    "auth.login.success_via_backup_code": "Signed In with a Backup Code",
    "auth.login.failed": "Sign-In Failed",
    "auth.login.2fa_failed": "Second Step Failed",
    "auth.login.2fa_blocked_locked": "Second Step Blocked: Account Locked",
    "auth.login.2fa_replay_blocked": "Reused Second-Step Code Refused",
    "auth.2fa.setup_started": "Two-Factor Setup Started",
    "auth.2fa.enabled": "Two-Factor Turned On",
    "auth.2fa.disabled": "Two-Factor Turned Off",
    "auth.2fa.backup_codes_regenerated": "Backup Codes Renewed",
    "auth.password_reset_by_script": "Password Reset by the Team",
    "content.patterns.loaded": "Mock Paper Patterns Loaded",
    "content.patterns.reviewed": "Mock Paper Patterns Reviewed",
    "curriculum.answer_units.applied": "Answer Units Updated",
    "curriculum.content_edits.applied": "Question Edits Applied",
    "curriculum.misconception_reviews.applied": "Misconception Notes Reviewed",
    "curriculum.prerequisites.applied": "Skill Prerequisites Recorded",
    "curriculum.question_marks.applied": "Question Marks Updated",
    "curriculum.question_reviews.applied": "Question Reviews Applied",
    "curriculum.version.created": "Curriculum Version Created",
    "curriculum.version.status_changed": "Curriculum Version Status Changed",
    "assessment.scheme.updated": "Assessment Scheme Edited",
    "assessment.scheme.deleted": "Assessment Scheme Deleted",
    "assessment.scheme.new_version": "Assessment Scheme New Version",
    "assessment.template.created": "Scheme Template Created",
    "assessment.template.refreshed": "Scheme Template Refreshed",
    "assessment.year.created": "School Year Added",
    "assessment.year.made_current": "Current School Year Changed",
    "report.records.saved": "Report Card Records Saved",
    "report.settings.saved": "Report Card Settings Saved",
    "weekly_report.notes.saved": "Weekly Report Notes Saved",
    "learning.attempt.marks_reviewed": "Method Marks Reviewed",
    "mock_paper.drafted": "Mock Paper Drafted",
    "mock_paper.discarded": "Mock Paper Discarded",
    "mock_paper.deleted": "Mock Paper Deleted",
    "mock_paper.format.saved": "Mock Paper Format Saved",
    "mock_paper.format.deleted": "Mock Paper Format Deleted",
    "mock_paper.marked": "Mock Paper Answer Marked",
    "mock_paper.marks_reviewed": "Mock Paper Marks Reviewed",
    "roster.person_create_email_rejected": "Account Not Created: Email Already Used",
    "roster.school_setup_import_refused": "School Setup Import Refused",
    "auth.login.success": "Signed In",
    "auth.login.blocked_locked": "Sign-In Blocked: Account Locked",
    "auth.login.wrong_way_in": "Signed In on the Wrong Tab",
    "auth.logout": "Signed Out",
    "auth.logout_all_sessions": "Signed Out Everywhere",
    "auth.session.revoked": "Device Signed Out",
    "auth.password_changed": "Password Changed",
    "auth.password_reset_by_admin": "Password Reset by an Admin",
    "auth.data_export_requested": "Data Export Requested",
    "auth.profile_photo.updated": "Profile Photo Changed",
    "platform.school_created": "School Added",
    "platform.school_provisioned": "School Added",
    "platform.school_updated": "School Details Changed",
    "platform.school_suspended": "School Suspended",
    "platform.school_restored": "School Restored",
    "school.logo.updated": "School Logo Changed",
    "school.logo.removed": "School Logo Removed",
    "roster.person_created": "Account Created",
    "roster.person_status_changed": "Account Activated or Deactivated",
    "roster.person_password_reset": "Password Reset",
    "roster.bulk_import": "People Imported",
    "roster.school_setup_import": "School Setup Imported",
    "roster.section_slips_reissued": "Sign-In Slips Reissued",
    "teacher_assignment.created": "Teacher Given a Section",
    "teacher_assignment.transferred": "Section Moved to Another Teacher",
    "curriculum.chapter.status_changed": "Chapter Status Changed",
    "curriculum.chapter.bulk_published": "Chapters Published",
    "curriculum.chapter.bulk_status_changed": "Chapters Status Changed",
    "curriculum.concept_lesson.status_changed": "Skill Status Changed",
    "curriculum.question.status_changed": "Question Status Changed",
    "curriculum.question.bulk_approved": "Questions Approved",
    "curriculum.question.marking_changed": "Question Marking Changed",
    "curriculum.school_map.created": "Chapter Added to a Calendar",
    "curriculum.school_map.rescheduled": "Chapter Rescheduled",
    "curriculum.school_map.deleted": "Chapter Removed from a Calendar",
    "assessment.scheme.published": "Assessment Scheme Published",
    "assessment.scheme.created": "Assessment Scheme Created",
    "assessment.marks.saved": "Marks Saved",
    "report.cards.issued": "Report Cards Issued",
    "report.cards.withdrawn": "Report Cards Withdrawn",
    "weekly_report.issued": "Weekly Reports Issued",
    "weekly_report.withdrawn": "Weekly Reports Withdrawn",
    "mock_paper.approved": "Mock Paper Approved",
    "mock_paper.withdrawn": "Mock Paper Withdrawn",
    "learning.attempt.manually_graded": "Written Answer Marked",
    "learning.attempt.extra_granted": "Extra Attempt Given",
}
_CATEGORY_WORDS = {
    "auth": "Sign-In and Accounts",
    "platform": "Schools",
    "school": "Schools",
    "roster": "People",
    "teacher_assignment": "People",
    "curriculum": "Content",
    "content": "Content",
    "assessment": "Marks and Reports",
    "report": "Marks and Reports",
    "weekly_report": "Marks and Reports",
    "mock_paper": "Mock Papers",
    "learning": "Practice",
}
_CATEGORY_FILTERS = {
    "Sign-In and Accounts": ("auth.",),
    "Schools": ("platform.", "school."),
    "People": ("roster.", "teacher_assignment."),
    "Content": ("curriculum.", "content."),
    "Marks and Reports": ("assessment.", "report.", "weekly_report."),
    "Mock Papers": ("mock_paper.",),
    "Practice": ("learning.",),
}


def _event_label(event_type: str) -> str:
    if event_type in _EVENT_WORDS:
        return _EVENT_WORDS[event_type]
    words = event_type.replace(".", " ").replace("_", " ").split()
    return " ".join(w.capitalize() for w in words) or "Activity"


@router.get("/activity")
def activity(
    category: str | None = Query(None, max_length=40),
    params: PageParams = Depends(page_params),
    _user: User = Depends(require_roles("SUPER_ADMIN")),
    db: Session = Depends(get_db),
):
    """Recent activity, newest first: what happened, who did it and when.
    No address, no browser, no detail. A child is "A student"."""
    query = db.query(AuditLog)
    if category:
        prefixes = _CATEGORY_FILTERS.get(category)
        if prefixes is None:
            api_error(422, "VALIDATION_ERROR", "Choose one of the activity groups on the page.")
        query = query.filter(or_(*[AuditLog.event_type.like(f"{p}%") for p in prefixes]))
    query = query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
    rows, total = paginate(query, params)
    users = {
        u.id: u
        for u in db.query(User).filter(User.id.in_({r.user_id for r in rows if r.user_id})).all()
    } if rows else {}
    items = []
    for row in rows:
        actor = users.get(row.user_id) if row.user_id else None
        if actor is None:
            who, role = None, None
        elif actor.role == "STUDENT":
            who, role = "A student", "STUDENT"
        else:
            who, role = actor.full_name, actor.role
        head = row.event_type.split(".", 1)[0]
        items.append(
            {
                "id": row.id,
                "at": _iso(row.created_at),
                "event": _event_label(row.event_type),
                "group": _CATEGORY_WORDS.get(head, "Other"),
                "who": who,
                "role": role,
            }
        )
    return page_envelope(items, total, params, groups=list(_CATEGORY_FILTERS))


# --- A teacher's My Classes -------------------------------------------------


def _students_in_section(db: Session, school_id: str, level: ClassLevel, section: str) -> int:
    return (
        db.query(func.count(Student.id))
        .filter(
            Student.school_id == school_id,
            or_(Student.class_level_id == level.id, Student.class_name == level.code),
            func.upper(func.trim(Student.section)) == (section or "").strip().upper(),
            Student.is_active.is_(True),
        )
        .scalar()
        or 0
    )


@router.get("/my-classes")
def my_classes(teacher: Teacher = Depends(get_current_teacher), db: Session = Depends(get_db)):
    """The teacher's own current sections with what each has going on: how
    many students, the practice they have set, mock papers, and the chapter
    their school's calendar has running. Only the teacher's own."""
    sections = (
        db.query(TeacherSectionAssignment)
        .filter(TeacherSectionAssignment.teacher_id == teacher.id, TeacherSectionAssignment.end_date.is_(None))
        .all()
    )
    today = _today().isoformat()
    out = []
    for tsa in sorted(sections, key=lambda t: ((t.class_level.display_order if t.class_level else 0), t.section)):
        level = tsa.class_level
        if level is None:
            continue
        like = [Assignment.class_level_id == level.id, Assignment.class_name == level.code]
        scope = (
            Assignment.school_id == teacher.school_id,
            or_(*like),
            func.upper(func.trim(Assignment.section)) == tsa.section.strip().upper(),
            Assignment.assigned_by_user_id == teacher.user_id,
        )
        set_by_me = db.query(func.count(Assignment.id)).filter(*scope, Assignment.status != "CANCELLED").scalar() or 0
        active = db.query(func.count(Assignment.id)).filter(*scope, Assignment.status == "ACTIVE").scalar() or 0
        papers = (
            db.query(func.count(MockPaper.id))
            .filter(
                MockPaper.school_id == teacher.school_id,
                MockPaper.class_level_id == level.id,
                func.upper(func.trim(MockPaper.section)) == tsa.section.strip().upper(),
                MockPaper.status.notin_(("DRAFT", "WITHDRAWN")),
            )
            .scalar()
            or 0
        )
        maps = (
            db.query(SchoolCurriculumMap, Chapter)
            .join(Chapter, SchoolCurriculumMap.chapter_id == Chapter.id)
            .filter(SchoolCurriculumMap.school_id == teacher.school_id, SchoolCurriculumMap.board_course_id == tsa.board_course_id)
            .all()
        )
        running = [
            (m, c) for m, c in maps if m.planned_start_date and m.planned_end_date and m.planned_start_date <= today <= m.planned_end_date
        ]
        upcoming = sorted(
            [(m, c) for m, c in maps if m.planned_start_date and m.planned_start_date > today],
            key=lambda pair: pair[0].planned_start_date,
        )

        def chapter_entry(pair):
            m, c = pair
            return {"chapterNo": c.chapter_no, "title": c.title, "start": m.planned_start_date, "end": m.planned_end_date}

        out.append(
            {
                "id": tsa.id,
                "classCode": level.code,
                "className": level.display_name,
                "section": tsa.section,
                "course": tsa.board_course.display_name if tsa.board_course else None,
                "students": _students_in_section(db, teacher.school_id, level, tsa.section),
                "practiceSet": set_by_me,
                "practiceActive": active,
                "papers": papers,
                "runningChapter": chapter_entry(sorted(running, key=lambda p: p[0].planned_start_date)[0]) if running else None,
                "nextChapter": chapter_entry(upcoming[0]) if upcoming else None,
                "since": tsa.start_date.isoformat() if tsa.start_date else None,
            }
        )
    return {"classes": out}
