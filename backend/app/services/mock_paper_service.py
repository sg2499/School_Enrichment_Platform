"""Mock papers: building, previewing and approving a test (#166 step 3, 27 Oct
2026; PHASE5_MOCK_PAPER_DESIGN.md).

Shailesh's decisions: any test format the school needs; the section's
teacher approves every paper; on approval every student gets their own
version, all made at once; a student never gets the same question twice;
mock papers are practice only.

A DRAFT paper holds slots: each a place on the paper (section, marks, kind)
filled by an approved pattern, chosen to meet the format's difficulty mix
and application share and to spread marks across the chosen chapters. The
teacher's preview is made from each slot's sample seed and stored nowhere.
Approving freezes the paper and makes each student's version: fresh
questions from the same patterns, checked, none the student has had
before, and different from the other students' wherever the pattern
allows.

Who may do what: a teacher builds, approves and withdraws papers for the
sections they teach now, and sees papers of sections they taught; the
school's admin sees every paper at the school; the Super Admin has no
school, so none.
"""
from __future__ import annotations

import json
import random
import uuid
from types import SimpleNamespace
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.models import Chapter, ClassLevel, ConceptLesson, Question, Student, User
from app.models.papers import (
    GeneratedQuestion,
    MockPaper,
    MockPaperSlot,
    MockPaperVersion,
    MockPaperVersionItem,
    PaperFormat,
    QuestionPattern,
)
from app.services import analytics_service, paper_formats, pattern_engine
from app.services.analytics_service import Scope
from app.services.paper_formats import FormatError
from app.services.practice_access_service import Viewer

IST = timezone(timedelta(hours=5, minutes=30))
MAX_PATTERN_USES = 2
MIX_TOLERANCE = 10  # percentage points either way before the mix is flagged
MAX_TITLE = 120


# --- patterns as the paper sees them -----------------------------------------------------


def pattern_kind(pattern: QuestionPattern) -> str:
    qtype = pattern.question_type
    if qtype == "Case Study":
        return "CASE_STUDY"
    if qtype == "Single Select":
        return "CHOICE"
    if qtype in ("Constructed Response", "Long Answer"):
        # A Long Answer (#208) fills the written places of a paper: the
        # same 3- and 5-mark question, in steps the platform marks.
        return "WRITTEN"
    return "NUMBER"


def fits(kind: str, pattern: QuestionPattern) -> bool:
    actual = pattern_kind(pattern)
    if kind == "ANY":
        return actual != "CASE_STUDY"
    return actual == kind


def bucket(pattern: QuestionPattern) -> str:
    """Easy, medium or challenging, from the content's Difficulty 1 to 4."""
    if pattern.difficulty == 1:
        return "easy"
    if pattern.difficulty == 4:
        return "hard"
    return "medium"


def is_application(pattern: QuestionPattern) -> bool:
    words = (pattern.competency or "").casefold()
    return any(w in words for w in ("application", "reasoning", "problem solving"))


def approved_patterns(db: Session, board_course_id: str, chapter_ids: list[str]) -> list[QuestionPattern]:
    if not chapter_ids:
        return []
    return (
        db.query(QuestionPattern)
        .filter(
            QuestionPattern.board_course_id == board_course_id,
            QuestionPattern.chapter_id.in_(chapter_ids),
            QuestionPattern.status == "APPROVED",
        )
        .order_by(QuestionPattern.code)
        .all()
    )


# --- who may do what ----------------------------------------------------------------------


def _sections(db: Session, viewer: Viewer) -> list[dict]:
    if viewer.school_id is None:
        api_error(403, "FORBIDDEN", "Mock papers belong to a school; sign in as the school's teacher or admin.")
    return analytics_service.sections(db, viewer)


def _scope_entry(db: Session, viewer: Viewer, scope: Scope) -> dict:
    for entry in _sections(db, viewer):
        if entry["key"] == scope.key:
            return entry
    api_error(404, "NOT_FOUND", "That section couldn't be found.")


def can_change(viewer: Viewer, entry: dict) -> bool:
    """Only the section's teacher now builds, approves or withdraws."""
    return viewer.is_teacher and entry["isCurrent"]


def _require_change(db: Session, viewer: Viewer, scope: Scope) -> dict:
    entry = _scope_entry(db, viewer, scope)
    if not can_change(viewer, entry):
        api_error(403, "FORBIDDEN", "Only the section's teacher can build or approve its mock papers.")
    return entry


def _scope_of(paper: MockPaper) -> Scope:
    return Scope(paper.class_level_id, paper.section, paper.board_course_id)


def load_paper(db: Session, viewer: Viewer, paper_id: str, *, change: bool = False, lock: bool = False) -> tuple:
    query = db.query(MockPaper).filter(MockPaper.id == paper_id)
    if lock:
        query = query.with_for_update()
    paper = query.first()
    if paper is None or paper.school_id != viewer.school_id:
        api_error(404, "NOT_FOUND", "That mock paper couldn't be found.")
    entry = (_require_change if change else _scope_entry)(db, viewer, _scope_of(paper))
    return paper, entry


# --- formats ---------------------------------------------------------------------------------


def formats(db: Session, viewer: Viewer) -> list[dict]:
    if viewer.school_id is None:
        api_error(403, "FORBIDDEN", "Test formats belong to a school.")
    out = [{**f, "owner": "STARTING_POINT", "canEdit": False} for f in paper_formats.STARTING_POINTS]
    rows = (
        db.query(PaperFormat)
        .filter(PaperFormat.school_id == viewer.school_id)
        .filter((PaperFormat.owner_user_id.is_(None)) | (PaperFormat.owner_user_id == viewer.user.id))
        .order_by(PaperFormat.name)
        .all()
    )
    for row in rows:
        owner = "SCHOOL" if row.owner_user_id is None else "MINE"
        can_edit = owner == "MINE" or viewer.role == "ADMIN"
        out.append({**json.loads(row.spec_json), "id": row.id, "owner": owner, "canEdit": can_edit})
    return out


def save_format(db: Session, viewer: Viewer, raw: dict, format_id: str | None = None) -> PaperFormat:
    if viewer.school_id is None or viewer.role not in ("TEACHER", "ADMIN"):
        api_error(403, "FORBIDDEN", "Only a school's teachers and admin save test formats.")
    try:
        fmt = paper_formats.clean_format(raw)
    except FormatError as exc:
        api_error(422, "VALIDATION_ERROR", exc.problems[0], details={"problems": exc.problems})
    if format_id is None:
        row = PaperFormat(
            school_id=viewer.school_id,
            owner_user_id=None if viewer.role == "ADMIN" else viewer.user.id,
            created_by_user_id=viewer.user.id,
        )
        db.add(row)
    else:
        row = _editable_format(db, viewer, format_id)
    row.name = fmt["name"]
    row.spec_json = json.dumps(fmt, ensure_ascii=False)
    db.flush()
    return row


def _editable_format(db: Session, viewer: Viewer, format_id: str) -> PaperFormat:
    row = db.get(PaperFormat, format_id)
    if row is None or row.school_id != viewer.school_id:
        api_error(404, "NOT_FOUND", "That test format couldn't be found.")
    if row.owner_user_id is None and viewer.role != "ADMIN":
        api_error(403, "FORBIDDEN", "School formats are changed by the school's admin.")
    if row.owner_user_id is not None and row.owner_user_id != viewer.user.id:
        api_error(404, "NOT_FOUND", "That test format couldn't be found.")
    return row


def delete_format(db: Session, viewer: Viewer, format_id: str) -> None:
    db.delete(_editable_format(db, viewer, format_id))


# --- what the chapters can supply ------------------------------------------------------------------


def chapters_for(db: Session, board_course_id: str) -> list[dict]:
    rows = db.query(Chapter).filter(Chapter.board_course_id == board_course_id).order_by(Chapter.chapter_no).all()
    counts: dict[str, int] = {}
    for chapter_id, in db.query(QuestionPattern.chapter_id).filter(
        QuestionPattern.board_course_id == board_course_id, QuestionPattern.status == "APPROVED"
    ):
        counts[chapter_id] = counts.get(chapter_id, 0) + 1
    return [
        {"id": c.id, "chapterNo": c.chapter_no, "title": c.title, "approvedPatterns": counts.get(c.id, 0)}
        for c in rows
    ]


def supply(patterns: list[QuestionPattern], fmt: dict, chapter_ids: list[str]) -> list[dict]:
    """Per section: how many of its places (questions plus their either/or
    alternatives) the approved patterns can fill, found by choosing the
    whole paper as a draft would (sections share patterns, and each pattern
    fills at most two places; review)."""
    picks = plan(fmt, patterns, chapter_ids, random.Random(0))
    out = []
    for i, s in enumerate(fmt["sections"]):
        mine = [p for p in picks if p.section_index == i]
        filled = sum(1 for p in mine if p.pattern is not None)
        available = len({p.id for p in patterns if p.marks == s["marks"] and fits(s["kind"], p)})
        out.append({
            "section": i, "name": s["name"], "places": len(mine), "filled": filled, "patterns": available,
            "enough": filled == len(mine),
        })
    return out


# --- choosing the slots --------------------------------------------------------------------------------


@dataclass
class Pick:
    section_index: int
    position: int
    marks: int
    kind: str
    choice_group: int | None = None
    alternative: bool = False
    pattern: QuestionPattern | None = None
    seed: str | None = None


@dataclass
class Balance:
    fmt: dict
    chapter_ids: list[str]
    uses: dict = field(default_factory=dict)  # pattern id -> places filled
    chapter_marks: dict = field(default_factory=dict)
    bucket_marks: dict = field(default_factory=lambda: {"easy": 0, "medium": 0, "hard": 0})
    application_marks: int = 0
    counted_marks: int = 0

    def add(self, pick: Pick):
        p = pick.pattern
        self.uses[p.id] = self.uses.get(p.id, 0) + 1
        if pick.alternative:
            return
        self.chapter_marks[p.chapter_id] = self.chapter_marks.get(p.chapter_id, 0) + pick.marks
        self.bucket_marks[bucket(p)] += pick.marks
        self.application_marks += pick.marks if is_application(p) else 0
        self.counted_marks += pick.marks

    def remove(self, pick: Pick):
        p = pick.pattern
        self.uses[p.id] -= 1
        if pick.alternative:
            return
        self.chapter_marks[p.chapter_id] -= pick.marks
        self.bucket_marks[bucket(p)] -= pick.marks
        self.application_marks -= pick.marks if is_application(p) else 0
        self.counted_marks -= pick.marks

    def penalty(self, pick: Pick, p: QuestionPattern, section_skills: set, partner: QuestionPattern | None) -> float:
        total = paper_formats.total_marks(self.fmt) or 1
        score = 8.0 * self.uses.get(p.id, 0)
        if p.concept_lesson_id in section_skills:
            score += 6
        if partner is not None:
            # An either/or pair: same chapter and difficulty, a different skill.
            score += 0 if p.chapter_id == partner.chapter_id else 5
            score += 0 if bucket(p) == bucket(partner) else 4
            score += 20 if p.concept_lesson_id == partner.concept_lesson_id else 0
            return score
        target = total / max(1, len(self.chapter_ids))
        score += 6.0 * (self.chapter_marks.get(p.chapter_id, 0) + pick.marks) / target
        mix = self.fmt.get("difficulty")
        if mix:
            want = mix[bucket(p)] / 100 * total
            score += 5 if self.bucket_marks[bucket(p)] + pick.marks > want + 0.5 else -3
        need = self.fmt.get("applicationMin")
        if need and is_application(p) and self.application_marks < need / 100 * total:
            score -= 3
        return score


def _requests(fmt: dict) -> list[Pick]:
    out, group = [], 0
    for si, s in enumerate(fmt["sections"]):
        position = 0
        for q in range(s["count"]):
            position += 1
            if q < s["choices"]:
                group += 1
                out.append(Pick(si, position, s["marks"], s["kind"], choice_group=group))
                position += 1
                out.append(Pick(si, position, s["marks"], s["kind"], choice_group=group, alternative=True))
            else:
                out.append(Pick(si, position, s["marks"], s["kind"]))
    return out


def _choose(balance: Balance, pick: Pick, patterns, rng, *, section_skills, partner, exclude=()) -> QuestionPattern | None:
    best, best_score = None, None
    for p in patterns:
        if p.marks != pick.marks or not fits(pick.kind, p) or p.id in exclude:
            continue
        if balance.uses.get(p.id, 0) >= MAX_PATTERN_USES:
            continue
        score = balance.penalty(pick, p, section_skills, partner) + rng.random()
        if best_score is None or score < best_score:
            best, best_score = p, score
    return best


def plan(fmt: dict, patterns: list[QuestionPattern], chapter_ids: list[str], rng: random.Random) -> list[Pick]:
    balance = Balance(fmt, chapter_ids)
    picks = _requests(fmt)
    skills: dict[int, set] = {}
    by_group: dict[int, Pick] = {}
    # The places that take one kind only are filled first, so a section of
    # "any kind" doesn't use up what they need (review).
    for pick in sorted(picks, key=lambda x: (x.kind == "ANY", x.section_index, x.position)):
        section_skills = skills.setdefault(pick.section_index, set())
        partner = by_group.get(pick.choice_group).pattern if pick.alternative and pick.choice_group in by_group else None
        # An either/or choice is between two different questions.
        exclude = {partner.id} if partner is not None else ()
        chosen = _choose(balance, pick, patterns, rng, section_skills=section_skills, partner=partner, exclude=exclude)
        if chosen is not None:
            pick.pattern = chosen
            pick.seed = uuid.uuid4().hex[:16]
            balance.add(pick)
            section_skills.add(chosen.concept_lesson_id)
        if pick.choice_group and not pick.alternative:
            by_group[pick.choice_group] = pick
    return picks


# --- the checks ------------------------------------------------------------------------------------------


def checks(fmt: dict, slots: list, patterns_by_id: dict, chapters: list[dict]) -> dict:
    """What the paper achieves against its format, for the teacher."""
    counted = [s for s in slots if not s.alternative]
    filled = [s for s in counted if s.pattern_id in patterns_by_id]
    total = paper_formats.total_marks(fmt)
    marks = sum(s.marks for s in filled)
    mix = {"easy": 0, "medium": 0, "hard": 0}
    application = 0
    by_chapter: dict[str, int] = {}
    for s in filled:
        p = patterns_by_id[s.pattern_id]
        mix[bucket(p)] += s.marks
        application += s.marks if is_application(p) else 0
        by_chapter[p.chapter_id] = by_chapter.get(p.chapter_id, 0) + s.marks
    share = (lambda n: round(100 * n / marks) if marks else 0)
    achieved = {k: share(v) for k, v in mix.items()}
    unfilled = [s for s in slots if s.pattern_id not in patterns_by_id]
    items = [{
        "key": "marks", "label": "Total marks", "ok": marks == total and not unfilled, "blocking": bool(unfilled),
        "detail": f"{marks} of {total}" + (f"; {len(unfilled)} place{'s' if len(unfilled) != 1 else ''} with no approved question" if unfilled else ""),
    }]
    if fmt.get("difficulty"):
        want = fmt["difficulty"]
        ok = all(abs(achieved[k] - want[k]) <= MIX_TOLERANCE for k in want)
        items.append({
            "key": "difficulty", "label": "Difficulty mix", "ok": ok, "blocking": False,
            "detail": f"easy {achieved['easy']}%, medium {achieved['medium']}%, challenging {achieved['hard']}% "
                      f"(aim {want['easy']}/{want['medium']}/{want['hard']})",
        })
    if fmt.get("applicationMin") is not None:
        items.append({
            "key": "application", "label": "Application and reasoning", "ok": share(application) >= fmt["applicationMin"],
            "blocking": False, "detail": f"{share(application)}% of marks (at least {fmt['applicationMin']}%)",
        })
    missing = [c for c in chapters if not by_chapter.get(c["id"])]
    items.append({
        "key": "chapters", "label": "Chapters covered", "ok": not missing, "blocking": False,
        "detail": "every chapter chosen has marks" if not missing else
                  "no questions yet from " + ", ".join(f"Chapter {c['chapterNo']}" for c in missing),
    })
    return {
        "items": items, "marks": marks, "totalMarks": total, "mix": achieved,
        "applicationPercent": share(application),
        "chapterMarks": [{"chapterId": c["id"], "chapterNo": c["chapterNo"], "marks": by_chapter.get(c["id"], 0)} for c in chapters],
        "canApprove": not unfilled,
    }


# --- papers ------------------------------------------------------------------------------------------------------


def _aware(value: datetime) -> datetime:
    """Stored times come back without a zone on SQLite; they are UTC. The
    browser always sends an offset (lib/mockPapers.ts)."""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def status_of(paper: MockPaper, now: datetime | None = None) -> str:
    """DRAFT, SCHEDULED, OPEN, CLOSED or WITHDRAWN, as the teacher reads it."""
    if paper.status != "APPROVED":
        return paper.status
    now = now or datetime.now(UTC)
    opens, closes = _aware(paper.opens_at), _aware(paper.closes_at)
    if now < opens:
        return "SCHEDULED"
    return "OPEN" if now < closes else "CLOSED"


def _check_window(opens_at: datetime, closes_at: datetime) -> None:
    opens_at, closes_at = _aware(opens_at), _aware(closes_at)
    if closes_at <= opens_at:
        api_error(422, "VALIDATION_ERROR", "The paper must close after it opens.")
    if closes_at - opens_at > timedelta(days=60):
        api_error(422, "VALIDATION_ERROR", "Keep a paper open for at most 60 days.")


def _clean_title(title: str) -> str:
    title = " ".join((title or "").split())
    if not title:
        api_error(422, "VALIDATION_ERROR", "Give the paper a title.")
    if len(title) > MAX_TITLE:
        api_error(422, "VALIDATION_ERROR", f"Keep the title to {MAX_TITLE} characters.")
    return title


def _resolve_format(db: Session, viewer: Viewer, raw_format, format_id: str | None) -> dict:
    if raw_format is None and format_id:
        found = next((f for f in formats(db, viewer) if f["id"] == format_id), None)
        if found is None:
            api_error(404, "NOT_FOUND", "That test format couldn't be found.")
        raw_format = found
    try:
        return paper_formats.clean_format(raw_format)
    except FormatError as exc:
        api_error(422, "VALIDATION_ERROR", exc.problems[0], details={"problems": exc.problems})


def _clean_chapters(db: Session, board_course_id: str, chapter_ids: list[str]) -> list[str]:
    ids = list(dict.fromkeys(chapter_ids or []))
    if not ids:
        api_error(422, "VALIDATION_ERROR", "Choose at least one chapter.")
    found = {c.id for c in db.query(Chapter).filter(Chapter.id.in_(ids), Chapter.board_course_id == board_course_id)}
    if len(found) != len(ids):
        api_error(422, "VALIDATION_ERROR", "Choose chapters of this section's subject.")
    return ids


def create_draft(db: Session, viewer: Viewer, scope: Scope, *, title: str, raw_format, format_id, chapter_ids,
                 opens_at: datetime, closes_at: datetime) -> MockPaper:
    _require_change(db, viewer, scope)
    fmt = _resolve_format(db, viewer, raw_format, format_id)
    ids = _clean_chapters(db, scope.board_course_id, chapter_ids)
    _check_window(opens_at, closes_at)
    patterns = approved_patterns(db, scope.board_course_id, ids)
    if not patterns:
        api_error(409, "NO_APPROVED_PATTERNS", "None of these chapters has approved questions for papers yet.")
    paper = MockPaper(
        school_id=viewer.school_id, class_level_id=scope.class_level_id, section=scope.section,
        board_course_id=scope.board_course_id, title=_clean_title(title), status="DRAFT",
        format_json=json.dumps(fmt, ensure_ascii=False), chapter_ids_json=json.dumps(ids),
        opens_at=_aware(opens_at), closes_at=_aware(closes_at), created_by_user_id=viewer.user.id,
    )
    db.add(paper)
    db.flush()
    for pick in plan(fmt, patterns, ids, random.Random()):
        db.add(MockPaperSlot(
            paper_id=paper.id, section_index=pick.section_index, position=pick.position, marks=pick.marks,
            kind=pick.kind, choice_group=pick.choice_group, alternative=pick.alternative,
            pattern_id=pick.pattern.id if pick.pattern else None,
            pattern_version=pick.pattern.version if pick.pattern else None, sample_seed=pick.seed,
        ))
    db.flush()
    return paper


def slots_of(db: Session, paper: MockPaper) -> list[MockPaperSlot]:
    return (
        db.query(MockPaperSlot)
        .filter(MockPaperSlot.paper_id == paper.id)
        .order_by(MockPaperSlot.section_index, MockPaperSlot.position)
        .all()
    )


def _patterns_by_id(db: Session, slots) -> dict:
    ids = {s.pattern_id for s in slots if s.pattern_id}
    return {p.id: p for p in db.query(QuestionPattern).filter(QuestionPattern.id.in_(ids))} if ids else {}


def _usable(slot, patterns_by_id) -> QuestionPattern | None:
    """The slot's pattern, if it is still approved at the version chosen."""
    p = patterns_by_id.get(slot.pattern_id)
    if p is None or p.status != "APPROVED" or p.version != slot.pattern_version:
        return None
    return p


def _chapters(db: Session, paper: MockPaper) -> list[dict]:
    ids = json.loads(paper.chapter_ids_json)
    rows = {c.id: c for c in db.query(Chapter).filter(Chapter.id.in_(ids))}
    return [{"id": i, "chapterNo": rows[i].chapter_no, "title": rows[i].title} for i in ids if i in rows]


def _summary(db: Session, paper: MockPaper, *, now=None, version_count=None, levels=None, users=None) -> dict:
    fmt = json.loads(paper.format_json)
    level = (levels or {}).get(paper.class_level_id) or db.get(ClassLevel, paper.class_level_id)
    maker = (users or {}).get(paper.created_by_user_id) if users is not None else (
        db.get(User, paper.created_by_user_id) if paper.created_by_user_id else None)
    if version_count is None and paper.status != "DRAFT":
        version_count = db.query(MockPaperVersion).filter(MockPaperVersion.paper_id == paper.id).count()
    return {
        "id": paper.id, "title": paper.title, "status": status_of(paper, now),
        "scope": _scope_of(paper).key, "classLevel": level.display_name if level else None,
        "classLevelCode": level.code if level else None, "section": paper.section,
        "formatName": fmt["name"], "totalMarks": fmt["totalMarks"], "timeMinutes": fmt["timeMinutes"],
        "readingMinutes": fmt["readingMinutes"],
        "opensAt": _aware(paper.opens_at).isoformat(), "closesAt": _aware(paper.closes_at).isoformat(),
        "createdBy": maker.full_name if maker else None,
        "approvedAt": _aware(paper.approved_at).isoformat() if paper.approved_at else None,
        "versions": version_count or 0,
        "withdrawReason": paper.withdraw_reason,
    }


def list_papers(db: Session, viewer: Viewer) -> list[dict]:
    keys = {e["key"] for e in _sections(db, viewer)}
    rows = (
        db.query(MockPaper).filter(MockPaper.school_id == viewer.school_id)
        .order_by(MockPaper.opens_at.desc(), MockPaper.created_at.desc()).all()
    )
    rows = [p for p in rows if _scope_of(p).key in keys]
    if not rows:
        return []
    levels = {c.id: c for c in db.query(ClassLevel).filter(ClassLevel.id.in_({p.class_level_id for p in rows}))}
    users = {u.id: u for u in db.query(User).filter(User.id.in_({p.created_by_user_id for p in rows if p.created_by_user_id}))}
    from sqlalchemy import func as sqlfunc

    counts = dict(
        db.query(MockPaperVersion.paper_id, sqlfunc.count(MockPaperVersion.id))
        .filter(MockPaperVersion.paper_id.in_([p.id for p in rows])).group_by(MockPaperVersion.paper_id).all()
    )
    now = datetime.now(UTC)
    return [_summary(db, p, now=now, version_count=counts.get(p.id, 0), levels=levels, users=users) for p in rows]


def _frozen(slot, pattern):
    """The slot's pattern as it was approved with the paper: its spec and
    version then, whatever the pattern has become since (review)."""
    if pattern is None or not slot.approved_spec_json:
        return None
    spec = pattern_engine.clean_spec(json.loads(slot.approved_spec_json))
    return SimpleNamespace(
        id=pattern.id, code=pattern.code, chapter_id=pattern.chapter_id, concept_lesson_id=pattern.concept_lesson_id,
        difficulty=spec.difficulty, competency=spec.competency, spec_json=slot.approved_spec_json,
        version=slot.pattern_version, status="APPROVED",
    )


def _render_slot(slot, pattern) -> dict | None:
    if pattern is None:
        return None
    spec = pattern_engine.clean_spec(json.loads(pattern.spec_json))
    try:
        made = pattern_engine.make(spec, slot.sample_seed or "sample", version=pattern.version)
    except pattern_engine.GenerationError:
        return None
    questions = []
    for q in made.questions:
        stem = q["stem"]
        if made.stimulus is not None:
            stem = stem[len(made.stimulus):].strip()
        questions.append({
            "text": stem, "questionType": q["question_type"], "marks": q["marks"],
            "options": [{"letter": x.upper(), "text": q[f"option_{x}"]} for x in "abcd" if q.get(f"option_{x}")] or None,
            "answer": q["correct_answer"], "acceptedVariants": q.get("accepted_variants"),
            "answerUnit": q.get("answer_unit"), "markingSteps": q.get("teacher_note"),
            "explanation": q.get("explanation"), "mistakes": q.get("mistakes"),
        })
    return {"stimulus": made.stimulus, "questions": questions}


def detail(db: Session, viewer: Viewer, paper_id: str) -> dict:
    paper, entry = load_paper(db, viewer, paper_id)
    fmt = json.loads(paper.format_json)
    slots = slots_of(db, paper)
    patterns = _patterns_by_id(db, slots)
    chapters = _chapters(db, paper)
    skills = {s.id: s for s in db.query(ConceptLesson).filter(ConceptLesson.id.in_({p.concept_lesson_id for p in patterns.values()}))} if patterns else {}
    chapter_no = {c["id"]: c["chapterNo"] for c in chapters}
    draft = paper.status == "DRAFT"
    usable = {s.id: _usable(s, patterns) for s in slots}
    sections = []
    for si, s in enumerate(fmt["sections"]):
        items = []
        for slot in [x for x in slots if x.section_index == si]:
            p = usable[slot.id] if draft else _frozen(slot, patterns.get(slot.pattern_id))
            p = p or patterns.get(slot.pattern_id)
            ok = usable[slot.id] if draft else _frozen(slot, patterns.get(slot.pattern_id))
            sample = _render_slot(slot, ok) if ok else None
            items.append({
                "slotId": slot.id, "position": slot.position, "marks": slot.marks, "kind": slot.kind,
                "choiceGroup": slot.choice_group, "alternative": slot.alternative,
                "pattern": {
                    "id": p.id, "code": p.code, "difficulty": bucket(p), "application": is_application(p),
                    "chapterNo": chapter_no.get(p.chapter_id), "skill": skills[p.concept_lesson_id].title if p.concept_lesson_id in skills else None,
                } if p else None,
                "problem": None if ok and sample else ("No approved question fits this place." if p is None else
                                                       "This question's pattern has changed since; regenerate it."),
                "sample": sample,
            })
        sections.append({**s, "index": si, "kindLabel": paper_formats.KIND_LABEL[s["kind"]], "slots": items})
    if draft:
        usable_by_id = {s.pattern_id: patterns[s.pattern_id] for s in slots if usable[s.id]}
    else:
        usable_by_id = {s.pattern_id: f for s in slots if (f := _frozen(s, patterns.get(s.pattern_id)))}
    result = {
        **_summary(db, paper),
        "canChange": can_change(viewer, entry),
        "format": fmt, "chapters": chapters, "sections": sections,
        "checks": checks(fmt, slots, usable_by_id, chapters),
    }
    if draft:
        result["supply"] = supply(approved_patterns(db, paper.board_course_id, [c["id"] for c in chapters]), fmt, [c["id"] for c in chapters])
    return result


def update_draft(db: Session, viewer: Viewer, paper_id: str, *, title=None, opens_at=None, closes_at=None) -> MockPaper:
    paper, _entry = load_paper(db, viewer, paper_id, change=True, lock=True)
    if paper.status != "DRAFT":
        api_error(409, "PAPER_FROZEN", "An approved paper can't be changed.")
    if title is not None:
        paper.title = _clean_title(title)
    if opens_at is not None or closes_at is not None:
        new_open = _aware(opens_at) if opens_at is not None else _aware(paper.opens_at)
        new_close = _aware(closes_at) if closes_at is not None else _aware(paper.closes_at)
        _check_window(new_open, new_close)
        paper.opens_at, paper.closes_at = new_open, new_close
    return paper


def regenerate(db: Session, viewer: Viewer, paper_id: str, slot_id: str, mode: str) -> None:
    """New numbers for one place, or another question for it."""
    paper, _entry = load_paper(db, viewer, paper_id, change=True, lock=True)
    if paper.status != "DRAFT":
        api_error(409, "PAPER_FROZEN", "An approved paper can't be changed.")
    slots = slots_of(db, paper)
    slot = next((s for s in slots if s.id == slot_id), None)
    if slot is None:
        api_error(404, "NOT_FOUND", "That question couldn't be found on this paper.")
    patterns_all = approved_patterns(db, paper.board_course_id, json.loads(paper.chapter_ids_json))
    by_id = {p.id: p for p in patterns_all}
    current = by_id.get(slot.pattern_id)
    if mode == "numbers" and current is not None and current.version == slot.pattern_version:
        slot.sample_seed = uuid.uuid4().hex[:16]
        return
    fmt = json.loads(paper.format_json)
    balance = Balance(fmt, json.loads(paper.chapter_ids_json))
    section_skills, partner = set(), None
    for other in slots:
        p = by_id.get(other.pattern_id)
        if other.id == slot.id or p is None or p.version != other.pattern_version:
            continue
        balance.add(Pick(other.section_index, other.position, other.marks, other.kind, other.choice_group, other.alternative, p))
        if other.section_index == slot.section_index:
            section_skills.add(p.concept_lesson_id)
        if slot.choice_group and other.choice_group == slot.choice_group:
            partner = p
    pick = Pick(slot.section_index, slot.position, slot.marks, slot.kind, slot.choice_group, slot.alternative)
    exclude = {slot.pattern_id} if mode == "question" and slot.pattern_id else set()
    if partner is not None:
        exclude.add(partner.id)  # an either/or choice is between two different questions
    chosen = _choose(balance, pick, patterns_all, random.Random(), section_skills=section_skills,
                     partner=partner, exclude=exclude)
    if chosen is None and current is not None and current.version == slot.pattern_version:
        api_error(409, "NO_OTHER_QUESTION", "No other approved question fits this place. Try new numbers instead.")
    if chosen is None:
        api_error(409, "NO_APPROVED_PATTERNS", "No approved question fits this place yet.")
    slot.pattern_id, slot.pattern_version, slot.sample_seed = chosen.id, chosen.version, uuid.uuid4().hex[:16]


def discard(db: Session, viewer: Viewer, paper_id: str) -> None:
    paper, _entry = load_paper(db, viewer, paper_id, change=True, lock=True)
    if paper.status != "DRAFT":
        api_error(409, "PAPER_FROZEN", "An approved paper can be withdrawn, not discarded.")
    db.query(MockPaperSlot).filter(MockPaperSlot.paper_id == paper.id).delete(synchronize_session=False)
    db.delete(paper)


def section_students(db: Session, paper: MockPaper) -> list[Student]:
    level = db.get(ClassLevel, paper.class_level_id)
    if level is None:
        return []
    return (
        db.query(Student)
        .filter(Student.school_id == paper.school_id, Student.class_name == level.code,
                Student.section == paper.section, Student.is_active.is_(True))
        .order_by(Student.student_code)
        .all()
    )


def _make_versions(db: Session, paper: MockPaper, slots, sources: dict, students) -> int:
    """Each student's own copy: every slot (both halves of an either/or
    pair) filled from its pattern, with a question the student has never
    had, and where possible one no other student on this paper has."""
    specs = {sid: pattern_engine.clean_spec(json.loads(p.spec_json)) for sid, p in sources.items()}
    seen = pattern_engine.student_fingerprints(db, [s.id for s in students])
    taken: set[str] = set()
    questions, records, versions, items = [], [], [], []
    for student in students:
        version = MockPaperVersion(id=str(uuid.uuid4()), paper_id=paper.id, student_id=student.id)
        versions.append(version)
        mine = seen.get(student.id, set())
        for slot in slots:
            pattern = sources[slot.id]
            try:
                made = pattern_engine.make_new(specs[slot.id], pattern, mine, taken)
            except pattern_engine.GenerationError:
                api_error(409, "PATTERN_USED_UP",
                          f"One question ({pattern.code}) has no new copy left for a student. Regenerate it with another question.")
            for number, (question, record) in enumerate(
                pattern_engine.build_rows(pattern, made, school_id=paper.school_id, student_id=student.id), start=1
            ):
                questions.append(question)
                records.append(record)
                items.append(MockPaperVersionItem(
                    version_id=version.id, slot_id=slot.id, question_id=question.id,
                    part_number=number if made.stimulus is not None else None,
                ))
            for print_ in made.fingerprints():
                mine.add(print_)
                taken.add(print_)
    db.add_all(versions)
    db.add_all(questions)
    db.flush()
    db.add_all(records)
    db.add_all(items)
    db.flush()
    return len(versions)


def approve(db: Session, viewer: Viewer, paper_id: str, now: datetime | None = None) -> dict:
    paper, _entry = load_paper(db, viewer, paper_id, change=True, lock=True)
    if paper.status != "DRAFT":
        api_error(409, "PAPER_FROZEN", "This paper is already approved.")
    now = now or datetime.now(UTC)
    if _aware(paper.opens_at) <= now:
        # Approved after it opened, it could never be withdrawn (review).
        api_error(422, "VALIDATION_ERROR", "This paper's opening time has passed; choose new dates first.")
    slots = slots_of(db, paper)
    patterns = _patterns_by_id(db, slots)
    stale = [s for s in slots if _usable(s, patterns) is None]
    if stale:
        api_error(409, "PAPER_INCOMPLETE",
                  f"{len(stale)} place{'s' if len(stale) != 1 else ''} on the paper {'have' if len(stale) != 1 else 'has'} no usable question. Regenerate {'them' if len(stale) != 1 else 'it'} first.")
    students = section_students(db, paper)
    if not students:
        api_error(409, "NO_STUDENTS", "This section has no active students to give the paper to.")
    for slot in slots:
        slot.approved_spec_json = patterns[slot.pattern_id].spec_json
    sources = {slot.id: _frozen(slot, patterns[slot.pattern_id]) for slot in slots}
    try:
        count = _make_versions(db, paper, slots, sources, students)
    except IntegrityError:
        db.rollback()
        api_error(409, "TRY_AGAIN", "Another paper was being made for these students at the same moment. Please approve again.")
    paper.status = "APPROVED"
    paper.approved_by_user_id = viewer.user.id
    paper.approved_at = now
    return {"versions": count}


def ensure_version(db: Session, paper: MockPaper, student: Student) -> MockPaperVersion:
    """A student who joined after approval gets their own version when they
    open the paper (used by step 4)."""
    found = db.query(MockPaperVersion).filter_by(paper_id=paper.id, student_id=student.id).first()
    if found is not None:
        return found
    slots = slots_of(db, paper)
    patterns = _patterns_by_id(db, slots)
    sources = {slot.id: _frozen(slot, patterns.get(slot.pattern_id)) for slot in slots}
    if any(v is None for v in sources.values()):
        api_error(409, "PAPER_INCOMPLETE", "This paper can't be given to a new student.")
    _make_versions(db, paper, slots, sources, [student])
    return db.query(MockPaperVersion).filter_by(paper_id=paper.id, student_id=student.id).one()


def withdraw(db: Session, viewer: Viewer, paper_id: str, reason: str, now: datetime | None = None) -> MockPaper:
    paper, _entry = load_paper(db, viewer, paper_id, change=True, lock=True)
    reason = " ".join((reason or "").split())
    if not reason:
        api_error(422, "VALIDATION_ERROR", "Say why the paper is being withdrawn.")
    if len(reason) > 300:
        api_error(422, "VALIDATION_ERROR", "Keep the reason to 300 characters.")
    if status_of(paper, now) != "SCHEDULED":
        api_error(409, "CANNOT_WITHDRAW", "Only an approved paper that hasn't opened yet can be withdrawn.")
    # Nobody saw them (it hadn't opened), so the questions go: they no
    # longer count as had for these students (review).
    version_ids = [v.id for v in db.query(MockPaperVersion.id).filter(MockPaperVersion.paper_id == paper.id)]
    if version_ids:
        question_ids = [i.question_id for i in db.query(MockPaperVersionItem.question_id).filter(MockPaperVersionItem.version_id.in_(version_ids))]
        db.query(MockPaperVersionItem).filter(MockPaperVersionItem.version_id.in_(version_ids)).delete(synchronize_session=False)
        db.query(MockPaperVersion).filter(MockPaperVersion.id.in_(version_ids)).delete(synchronize_session=False)
        if question_ids:
            db.query(GeneratedQuestion).filter(GeneratedQuestion.question_id.in_(question_ids)).delete(synchronize_session=False)
            db.query(Question).filter(Question.id.in_(question_ids)).delete(synchronize_session=False)
    paper.status = "WITHDRAWN"
    paper.withdrawn_at = now or datetime.now(UTC)
    paper.withdraw_reason = reason
    return paper


def section_options(db: Session, viewer: Viewer) -> list[dict]:
    out = []
    for entry in _sections(db, viewer):
        out.append({**entry, "canChange": can_change(viewer, entry)})
    return out
