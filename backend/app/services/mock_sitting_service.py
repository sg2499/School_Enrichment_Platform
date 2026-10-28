"""Sitting a mock paper online and marking it (#166 step 4, 27 Oct 2026;
PHASE5_MOCK_PAPER_DESIGN.md, "Sitting the paper online"; #208, 28 Oct:
results at hand-in).

A student opens an approved paper while it is open and sits their own
version once. The server keeps the time: reading time first (the questions
show, answers are locked), then the writing time, which ends at the time
allowed or when the paper closes, whichever is sooner. Answers save as the
student goes; when the time is up the paper is handed in with whatever was
saved, the next time anyone looks at it. In an either/or pair the student
chooses one question and only that one is marked.

No answers, hints or marks are shown during the paper. Everything that can
be marked automatically is marked when it is handed in, and the student
sees their marks per section and question at once, like practice (his
call, 28 Oct 2026: "the results should be out instantly as soon as the
students submit"); the right answers and solutions follow once the paper
has closed, so nobody still sitting can be shown them. A written answer
(until every long question marks itself, #208) waits for the section's
teacher, who may also change any mark at any time; nothing waits for a
release. Mock papers are practice: they never count in term marks.
"""
from __future__ import annotations

import json
import random
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.models import ClassLevel, Question, Student, User
from app.models.papers import (
    GeneratedQuestion,
    MockPaper,
    MockPaperAnswer,
    MockPaperSitting,
    MockPaperSlot,
    MockPaperVersion,
    MockPaperVersionItem,
)
from app.services import learning_service
from app.services import mock_paper_service as papers
from app.services.mock_paper_service import _aware
from app.services.practice_access_service import Viewer

# A save that left the browser just before the end still counts.
GRACE = timedelta(seconds=20)
MAX_RESPONSE = 2000


def _now(now: datetime | None) -> datetime:
    return now or datetime.now(UTC)


# --- whose paper ---------------------------------------------------------------------------


def student_of(db: Session, user: User) -> Student:
    student = db.query(Student).filter(Student.user_id == user.id).first()
    if student is None:
        api_error(404, "NOT_FOUND", "Your student profile isn't set up yet. Please ask your teacher or school admin.")
    return student


def _in_section(db: Session, student: Student, paper: MockPaper) -> bool:
    level = db.get(ClassLevel, paper.class_level_id)
    return bool(
        student.is_active and level is not None and student.school_id == paper.school_id
        and student.class_name == level.code and student.section == paper.section
    )


def _version(db: Session, paper: MockPaper, student: Student) -> MockPaperVersion | None:
    return db.query(MockPaperVersion).filter_by(paper_id=paper.id, student_id=student.id).first()


def _student_paper(db: Session, student: Student, paper_id: str, *, lock: bool = False) -> MockPaper:
    query = db.query(MockPaper).filter(MockPaper.id == paper_id)
    if lock:
        query = query.with_for_update()
    paper = query.first()
    if (
        paper is None or paper.school_id != student.school_id or paper.status != "APPROVED"
        or not (_version(db, paper, student) or _in_section(db, student, paper))
    ):
        api_error(404, "NOT_FOUND", "That paper couldn't be found.")
    return paper


def _sitting(db: Session, paper: MockPaper, student: Student) -> MockPaperSitting | None:
    return db.query(MockPaperSitting).filter_by(paper_id=paper.id, student_id=student.id).first()


# --- the paper as a student sees it ---------------------------------------------------------------


def public_question(question: Question) -> dict:
    """What a student may see while sitting: never the key, hints,
    explanations or marking steps."""
    return {
        "id": question.id,
        "questionType": question.question_type,
        "optionA": question.option_a,
        "optionB": question.option_b,
        "optionC": question.option_c,
        "optionD": question.option_d,
        "marks": question.marks,
        "answerInstruction": learning_service.answer_instruction(question),
        "answerNeedsUnit": learning_service.answer_needs_unit(question),
        "acceptsWorking": learning_service.accepts_working(question),
        "answerBlanks": learning_service.answer_blanks(question),
        "answerBlankLabels": learning_service.answer_blank_labels(question),
    }


def _layout(db: Session, paper: MockPaper, version: MockPaperVersion) -> list[dict]:
    """The student's paper: sections, each a list of places (a question, or
    an either/or pair), each place's parts with the Question rows."""
    fmt = json.loads(paper.format_json)
    slots = papers.slots_of(db, paper)
    items = db.query(MockPaperVersionItem).filter_by(version_id=version.id).all()
    questions = {q.id: q for q in db.query(Question).filter(Question.id.in_([i.question_id for i in items]))} if items else {}
    records = {g.question_id: g for g in db.query(GeneratedQuestion).filter(GeneratedQuestion.question_id.in_(list(questions)))} if questions else {}
    by_slot: dict[str, list] = {}
    for item in sorted(items, key=lambda i: i.part_number or 0):
        by_slot.setdefault(item.slot_id, []).append(item)
    sections = []
    for si, s in enumerate(fmt["sections"]):
        units: list[list[MockPaperSlot]] = []
        for slot in [x for x in slots if x.section_index == si]:
            if slot.alternative and units and units[-1][0].choice_group == slot.choice_group:
                units[-1].append(slot)
            else:
                units.append([slot])
        if fmt.get("shuffle"):
            random.Random(f"{version.id}:{si}").shuffle(units)
        places = []
        for unit in units:
            halves = []
            for slot in unit:
                parts = []
                stimulus = None
                for item in by_slot.get(slot.id, []):
                    q = questions[item.question_id]
                    rec = records.get(q.id)
                    text = q.stem
                    if rec is not None and rec.stimulus:
                        stimulus = rec.stimulus
                        text = text[len(rec.stimulus):].strip() if text.startswith(rec.stimulus) else text
                    parts.append({"question": q, "text": text, "part": item.part_number})
                halves.append({"slot": slot, "stimulus": stimulus, "parts": parts})
            places.append(halves)
        sections.append({"index": si, "format": s, "places": places})
    return sections


def _phase(sitting: MockPaperSitting, now: datetime) -> str:
    if sitting.status != "IN_PROGRESS":
        return "HANDED_IN"
    if now < _aware(sitting.writing_starts_at):
        return "READING"
    return "WRITING"


def _choices(sitting: MockPaperSitting) -> dict[str, str]:
    try:
        raw = json.loads(sitting.choices_json or "{}")
    except ValueError:
        return {}
    return {str(k): str(v) for k, v in raw.items()} if isinstance(raw, dict) else {}


def _answers(db: Session, sitting: MockPaperSitting) -> dict[str, MockPaperAnswer]:
    return {a.question_id: a for a in db.query(MockPaperAnswer).filter_by(sitting_id=sitting.id)}


def sitting_view(db: Session, paper: MockPaper, student: Student, sitting: MockPaperSitting, now: datetime) -> dict:
    version = _version(db, paper, student)
    fmt = json.loads(paper.format_json)
    answers = _answers(db, sitting)
    choices = _choices(sitting)
    phase = _phase(sitting, now)
    number = 0
    sections = []
    for sec in _layout(db, paper, version):
        places = []
        for halves in sec["places"]:
            number += 1
            group = halves[0]["slot"].choice_group
            out_halves = []
            for half in halves:
                slot = half["slot"]
                out_halves.append({
                    "slotId": slot.id,
                    "stimulus": half["stimulus"],
                    "parts": [{
                        "label": chr(96 + p["part"]) if p["part"] and len(half["parts"]) > 1 else None,
                        "text": p["text"],
                        **public_question(p["question"]),
                        "response": answers[p["question"].id].response_text if p["question"].id in answers else None,
                        "working": answers[p["question"].id].working_text if p["question"].id in answers else None,
                    } for p in half["parts"]],
                })
            places.append({
                "number": number, "marks": halves[0]["slot"].marks,
                "choiceGroup": group,
                "chosenSlotId": choices.get(str(group)) if group else None,
                "halves": out_halves,
            })
        if fmt.get("navigation") == "FORWARD" and sec["index"] > sitting.section_index:
            places = []  # a one-way paper shows a section when the student reaches it (review)
        sections.append({
            "index": sec["index"], "name": sec["format"]["name"], "marks": sec["format"]["marks"],
            "count": sec["format"]["count"], "choices": sec["format"]["choices"], "places": places,
        })
    return {
        "paper": _paper_brief(paper, fmt, now),
        "sitting": {
            "status": sitting.status, "phase": phase,
            "startedAt": _aware(sitting.started_at).isoformat(),
            "writingStartsAt": _aware(sitting.writing_starts_at).isoformat(),
            "deadlineAt": _aware(sitting.deadline_at).isoformat(),
            "submittedAt": _aware(sitting.submitted_at).isoformat() if sitting.submitted_at else None,
            "submittedHow": sitting.submitted_how,
            "sectionIndex": sitting.section_index,
            "serverNow": now.isoformat(),
        },
        # Only while sitting: a handed-in paper shows its result instead.
        "sections": sections if sitting.status == "IN_PROGRESS" else [],
    }


def _paper_brief(paper: MockPaper, fmt: dict, now: datetime) -> dict:
    return {
        "id": paper.id, "title": paper.title, "status": papers.status_of(paper, now),
        "totalMarks": fmt["totalMarks"], "timeMinutes": fmt["timeMinutes"], "readingMinutes": fmt["readingMinutes"],
        "navigation": fmt.get("navigation", "FREE"),
        "sections": [{"name": s["name"], "marks": s["marks"], "count": s["count"], "choices": s["choices"]} for s in fmt["sections"]],
        "opensAt": _aware(paper.opens_at).isoformat(), "closesAt": _aware(paper.closes_at).isoformat(),
        # #208: marks come at hand-in; the right answers and solutions once
        # the paper has closed, so nobody still sitting can be shown them.
        "solutionsOpen": solutions_open(paper, now),
    }


def solutions_at(paper: MockPaper) -> datetime:
    """When the right answers and solutions show: the close, plus the grace
    in which a last save may still arrive, after which every sitting is
    handed in (#208 review)."""
    return _aware(paper.closes_at) + GRACE


def solutions_open(paper: MockPaper, now: datetime) -> bool:
    return now >= solutions_at(paper)


# --- the student's list ------------------------------------------------------------------------


def student_papers(db: Session, student: Student, now: datetime | None = None) -> list[dict]:
    now = _now(now)
    level = db.query(ClassLevel).filter(ClassLevel.code == student.class_name).first()
    query = db.query(MockPaper).filter(MockPaper.school_id == student.school_id, MockPaper.status == "APPROVED")
    rows = []
    for paper in query.order_by(MockPaper.opens_at.desc()).all():
        mine = (student.is_active and level is not None and paper.class_level_id == level.id and paper.section == student.section)
        if not mine and _version(db, paper, student) is None:
            continue
        rows.append(paper)
    out = []
    for paper in rows:
        sitting = _sitting(db, paper, student)
        if sitting is not None:
            settle(db, sitting, now)
        fmt = json.loads(paper.format_json)
        handed_in = sitting is not None and sitting.status == "SUBMITTED"
        out.append({
            **_paper_brief(paper, fmt, now),
            "sitting": None if sitting is None else sitting.status,
            # #208: the marks come at hand-in; a written answer still to be
            # marked leaves the total open ("so far").
            "score": score_so_far(db, sitting) if handed_in else None,
            "waiting": waiting_count(db, sitting) if handed_in else 0,
        })
    db.commit()
    return out


# --- sitting -------------------------------------------------------------------------------------


def start(db: Session, student: Student, paper_id: str, now: datetime | None = None) -> dict:
    now = _now(now)
    paper = _student_paper(db, student, paper_id, lock=True)
    sitting = _sitting(db, paper, student)
    if sitting is None:
        if papers.status_of(paper, now) != "OPEN":
            api_error(409, "PAPER_NOT_OPEN", "This paper isn't open right now.")
        papers.ensure_version(db, paper, student)
        version = _version(db, paper, student)
        fmt = json.loads(paper.format_json)
        writing = now + timedelta(minutes=fmt["readingMinutes"])
        deadline = min(writing + timedelta(minutes=fmt["timeMinutes"]), _aware(paper.closes_at))
        if deadline - writing < timedelta(minutes=1):
            # One sitting only: don't use it up with no time to write (review).
            api_error(409, "TOO_LATE", "The paper closes too soon to sit it now.")
        sitting = MockPaperSitting(
            version_id=version.id, paper_id=paper.id, student_id=student.id, status="IN_PROGRESS",
            started_at=now, writing_starts_at=min(writing, deadline), deadline_at=deadline,
            section_index=0, choices_json="{}",
        )
        db.add(sitting)
        db.flush()
    settle(db, sitting, now)
    db.commit()
    return sitting_view(db, paper, student, sitting, now)


def view(db: Session, student: Student, paper_id: str, now: datetime | None = None) -> dict:
    now = _now(now)
    paper = _student_paper(db, student, paper_id)
    sitting = _sitting(db, paper, student)
    fmt = json.loads(paper.format_json)
    if sitting is None:
        return {"paper": _paper_brief(paper, fmt, now), "sitting": None, "sections": []}
    settle(db, sitting, now)
    db.commit()
    result = sitting_view(db, paper, student, sitting, now)
    if sitting.status == "SUBMITTED":
        result["result"] = student_result(db, paper, student, sitting, solutions=solutions_open(paper, now))
    return result


def _locked_sitting(db: Session, student: Student, paper_id: str, now: datetime) -> tuple:
    paper = _student_paper(db, student, paper_id)
    sitting = (
        db.query(MockPaperSitting).filter_by(paper_id=paper.id, student_id=student.id).with_for_update().first()
    )
    if sitting is None:
        api_error(409, "NOT_STARTED", "Start the paper first.")
    if settle(db, sitting, now):
        db.commit()
        api_error(409, "TIME_UP", "Time is up, so your paper has been handed in with the answers you saved.")
    if sitting.status != "IN_PROGRESS":
        api_error(409, "HANDED_IN", "You've already handed in this paper.")
    return paper, sitting


def _place_of(db: Session, paper: MockPaper, sitting: MockPaperSitting, question_id: str) -> tuple:
    item = (
        db.query(MockPaperVersionItem)
        .filter(MockPaperVersionItem.version_id == sitting.version_id, MockPaperVersionItem.question_id == question_id)
        .first()
    )
    if item is None:
        api_error(422, "VALIDATION_ERROR", "That question isn't on your paper.")
    slot = db.get(MockPaperSlot, item.slot_id)
    return item, slot


def save_answer(db: Session, student: Student, paper_id: str, question_id: str, response: str | None,
                working: str | None = None, *, working_sent: bool = False, now: datetime | None = None) -> dict:
    now = _now(now)
    paper, sitting = _locked_sitting(db, student, paper_id, now)
    if now < _aware(sitting.writing_starts_at):
        api_error(409, "READING_TIME", "It's reading time: you can start answering when it ends.")
    _item, slot = _place_of(db, paper, sitting, question_id)
    fmt = json.loads(paper.format_json)
    if fmt.get("navigation") == "FORWARD" and slot.section_index != sitting.section_index:
        api_error(409, "SECTION_CLOSED", "You can only answer the section you're on.")
    if response is not None and len(response) > MAX_RESPONSE:
        api_error(422, "VALIDATION_ERROR", f"An answer can be up to {MAX_RESPONSE} characters.")
    question = db.get(Question, question_id)
    answer = db.query(MockPaperAnswer).filter_by(sitting_id=sitting.id, question_id=question_id).first()
    if answer is None:
        answer = MockPaperAnswer(sitting_id=sitting.id, question_id=question_id, slot_id=slot.id, max_score=question.marks or 0)
        db.add(answer)
    if response is not None:
        answer.response_text = response.strip() or None
    if working_sent and learning_service.accepts_working(question):
        answer.working_text = learning_service._clean_working(working)
    answer.answered_at = now
    # Answering one half of an either/or pair chooses it, unless the
    # student has chosen already.
    if slot.choice_group:
        choices = _choices(sitting)
        if str(slot.choice_group) not in choices and answer.response_text:
            choices[str(slot.choice_group)] = slot.id
            sitting.choices_json = json.dumps(choices)
    db.commit()
    return {"saved": True, "savedAt": now.isoformat(), "chosenSlotId": _choices(sitting).get(str(slot.choice_group)) if slot.choice_group else None}


def choose(db: Session, student: Student, paper_id: str, slot_id: str, now: datetime | None = None) -> dict:
    now = _now(now)
    paper, sitting = _locked_sitting(db, student, paper_id, now)
    slot = db.get(MockPaperSlot, slot_id)
    if slot is None or slot.paper_id != paper.id or not slot.choice_group:
        api_error(422, "VALIDATION_ERROR", "That isn't one of the paper's either/or questions.")
    fmt = json.loads(paper.format_json)
    if fmt.get("navigation") == "FORWARD" and slot.section_index != sitting.section_index:
        api_error(409, "SECTION_CLOSED", "You can only answer the section you're on.")
    _writing_now(sitting, now)
    choices = _choices(sitting)
    choices[str(slot.choice_group)] = slot.id
    sitting.choices_json = json.dumps(choices)
    db.commit()
    return {"chosenSlotId": slot.id}


def _writing_now(sitting: MockPaperSitting, now: datetime) -> None:
    """Choosing and moving on are for the writing time itself: not in
    reading time, nor in the seconds of grace after the end (review)."""
    if now < _aware(sitting.writing_starts_at):
        api_error(409, "READING_TIME", "It's reading time: you can start answering when it ends.")
    if now > _aware(sitting.deadline_at):
        api_error(409, "TIME_UP", "Time is up, so your paper has been handed in with the answers you saved.")


def next_section(db: Session, student: Student, paper_id: str, now: datetime | None = None) -> dict:
    """On a one-way paper, move on to the next section (no going back)."""
    now = _now(now)
    paper, sitting = _locked_sitting(db, student, paper_id, now)
    fmt = json.loads(paper.format_json)
    if fmt.get("navigation") != "FORWARD":
        api_error(409, "FREE_PAPER", "On this paper you can move between sections freely.")
    _writing_now(sitting, now)
    if sitting.section_index >= len(fmt["sections"]) - 1:
        api_error(409, "LAST_SECTION", "This is the last section.")
    sitting.section_index += 1
    db.commit()
    student = db.get(Student, sitting.student_id)
    return sitting_view(db, paper, student, sitting, now)


def submit(db: Session, student: Student, paper_id: str, now: datetime | None = None) -> dict:
    now = _now(now)
    paper, sitting = _locked_sitting(db, student, paper_id, now)
    hand_in(db, sitting, "STUDENT", now)
    db.commit()
    result = sitting_view(db, paper, student, sitting, now)
    result["result"] = student_result(db, paper, student, sitting, solutions=solutions_open(paper, now))
    return result


# --- handing in and marking -------------------------------------------------------------------------


def settle(db: Session, sitting: MockPaperSitting, now: datetime) -> bool:
    """Hands in a paper whose time is up. True if it did."""
    if sitting.status == "IN_PROGRESS" and now >= _aware(sitting.deadline_at) + GRACE:
        # Locked and read again: a last save, or another hand-in, may be
        # in flight (review).
        db.refresh(sitting, with_for_update=True)
        if sitting.status != "IN_PROGRESS":
            return False
        paper = db.get(MockPaper, sitting.paper_id)
        how = "CLOSED" if _aware(sitting.deadline_at) >= _aware(paper.closes_at) else "TIME"
        hand_in(db, sitting, how, _aware(sitting.deadline_at))
        return True
    return False


def hand_in(db: Session, sitting: MockPaperSitting, how: str, when: datetime) -> None:
    """Marks every number and choice answer, records a written one for the
    teacher, and counts only the chosen half of each either/or pair."""
    paper = db.get(MockPaper, sitting.paper_id)
    fmt = json.loads(paper.format_json)
    slots = {s.id: s for s in papers.slots_of(db, paper)}
    items = db.query(MockPaperVersionItem).filter_by(version_id=sitting.version_id).all()
    answers = _answers(db, sitting)
    choices = _choices(sitting)
    # A pair with no choice made: the half with an answer, else the first.
    for group in {s.choice_group for s in slots.values() if s.choice_group}:
        if str(group) in choices:
            continue
        halves = sorted([s for s in slots.values() if s.choice_group == group], key=lambda s: s.alternative)
        answered = [s for s in halves if any(
            a.slot_id == s.id and a.response_text for a in answers.values())]
        choices[str(group)] = (answered or halves)[0].id
    sitting.choices_json = json.dumps(choices)
    questions = {q.id: q for q in db.query(Question).filter(Question.id.in_([i.question_id for i in items]))} if items else {}
    auto, waiting = 0, False
    for item in items:
        slot = slots[item.slot_id]
        question = questions[item.question_id]
        answer = answers.get(question.id)
        if answer is None:
            answer = MockPaperAnswer(sitting_id=sitting.id, question_id=question.id, slot_id=slot.id, max_score=question.marks or 0)
            db.add(answer)
        answer.counted = not slot.choice_group or choices.get(str(slot.choice_group)) == slot.id
        result = learning_service.grade_answer_detail(question, answer.response_text)
        answer.is_correct, answer.auto_score, answer.grading_note = result.is_correct, result.score, result.note
        if answer.auto_score is None and not (answer.response_text or "").strip():
            # A written answer left blank: nothing for the teacher to mark.
            answer.auto_score, answer.is_correct = 0, False
        if answer.counted:
            if answer.auto_score is None:
                waiting = True
            else:
                auto += answer.auto_score
    sitting.status = "SUBMITTED"
    sitting.submitted_at = when
    sitting.submitted_how = how
    sitting.auto_score = auto
    sitting.max_score = fmt["totalMarks"]
    sitting.final_score = None if waiting else auto
    db.flush()


def _recompute(db: Session, sitting: MockPaperSitting) -> None:
    total, waiting = 0, False
    for a in db.query(MockPaperAnswer).filter_by(sitting_id=sitting.id, counted=True):
        score = a.manual_score if a.manual_score is not None else a.auto_score
        if score is None:
            waiting = True
        else:
            total += score
    sitting.final_score = None if waiting else total


def score_so_far(db: Session, sitting: MockPaperSitting) -> int:
    total = 0
    for a in db.query(MockPaperAnswer).filter_by(sitting_id=sitting.id, counted=True):
        score = a.manual_score if a.manual_score is not None else a.auto_score
        total += score or 0
    return total


def waiting_count(db: Session, sitting: MockPaperSitting) -> int:
    return sum(1 for a in db.query(MockPaperAnswer).filter_by(sitting_id=sitting.id) if needs_marking(a))


def needs_marking(answer: MockPaperAnswer) -> bool:
    return bool(answer.counted) and answer.auto_score is None and answer.manual_score is None


def settle_paper(db: Session, paper: MockPaper, now: datetime | None = None) -> None:
    now = _now(now)
    for sitting in db.query(MockPaperSitting).filter_by(paper_id=paper.id, status="IN_PROGRESS"):
        settle(db, sitting, now)
    db.flush()


def _student_names(db: Session, student_ids) -> dict[str, tuple[str, str]]:
    if not student_ids:
        return {}
    rows = db.query(Student, User).join(User, User.id == Student.user_id).filter(Student.id.in_(list(student_ids))).all()
    return {s.id: (u.full_name, s.student_code) for s, u in rows}


def can_mark(viewer: Viewer, entry: dict) -> bool:
    """The section's teacher marks; so may the school's admin,
    so a section with no teacher now isn't left waiting (review)."""
    return papers.can_change(viewer, entry) or viewer.role == "ADMIN"


def _load_for_marking(db: Session, viewer: Viewer, paper_id: str):
    paper, entry = papers.load_paper(db, viewer, paper_id, lock=True)
    if not can_mark(viewer, entry):
        api_error(403, "FORBIDDEN", "Only the section's teacher or the school's admin can mark this paper.")
    return paper, entry


def reviewable(answer: MockPaperAnswer, question: Question) -> bool:
    """An automatic mark a teacher may change for method marks: a number
    answer worth 2+ marks, not given full marks, with working (#163's
    rule, kept on papers; review)."""
    return (
        bool(answer.counted) and answer.auto_score is not None and answer.auto_score < answer.max_score
        and bool((answer.working_text or "").strip()) and learning_service.accepts_working(question)
    )


def marking(db: Session, viewer: Viewer, paper_id: str, now: datetime | None = None) -> dict:
    """The written answers waiting for (or given) a teacher's marks, by
    question, each with that student's own question and marking steps."""
    paper, entry = papers.load_paper(db, viewer, paper_id)
    if paper.status != "APPROVED":
        api_error(409, "NOT_APPROVED", "This paper hasn't been approved.")
    settle_paper(db, paper, now)
    db.commit()
    slots = {s.id: s for s in papers.slots_of(db, paper)}
    sittings = {s.id: s for s in db.query(MockPaperSitting).filter_by(paper_id=paper.id, status="SUBMITTED")}
    answers = (
        db.query(MockPaperAnswer)
        .filter(MockPaperAnswer.sitting_id.in_(list(sittings)), MockPaperAnswer.counted.is_(True))
        .all()
    ) if sittings else []
    questions = {q.id: q for q in db.query(Question).filter(Question.id.in_([a.question_id for a in answers]))} if answers else {}
    written = [a for a in answers if a.auto_score is None or reviewable(a, questions[a.question_id])]
    names = _student_names(db, {sittings[a.sitting_id].student_id for a in written})
    number = _numbers(db, paper)
    groups: dict[str, dict] = {}
    for a in written:
        slot = slots[a.slot_id]
        key = f"{slot.choice_group}" if slot.choice_group else slot.id
        group = groups.setdefault(key, {
            "key": key, "number": number.get(slot.id), "sectionIndex": slot.section_index, "marks": slot.marks, "answers": [],
        })
        q = questions[a.question_id]
        name, code = names.get(sittings[a.sitting_id].student_id, ("", ""))
        group["answers"].append({
            "answerId": a.id, "student": name, "studentCode": code, "question": q.stem,
            "response": a.response_text, "working": a.working_text, "maxScore": a.max_score, "score": a.manual_score,
            "autoScore": a.auto_score,
            "modelAnswer": q.correct_answer, "markingSteps": q.teacher_note,
            "markedAt": _aware(a.graded_at).isoformat() if a.graded_at else None,
        })
    ordered = sorted(groups.values(), key=lambda g: (g["sectionIndex"], g["number"] or 0))
    for g in ordered:
        g["answers"].sort(key=lambda x: (x["student"], x["studentCode"]))
    return {
        "canMark": can_mark(viewer, entry),
        "questions": ordered,
        "toMark": sum(1 for a in written if needs_marking(a)),
        "shuffled": bool(json.loads(paper.format_json).get("shuffle")),
    }


def _numbers(db: Session, paper: MockPaper) -> dict[str, int]:
    """Each slot's question number on the paper as built (before any
    per-student order), both halves of a pair sharing one."""
    out, number = {}, 0
    for slot in papers.slots_of(db, paper):
        if not slot.alternative:
            number += 1
        out[slot.id] = number
    return out


def save_marks(db: Session, viewer: Viewer, paper_id: str, marks: list[dict], now: datetime | None = None) -> int:
    paper, _entry = _load_for_marking(db, viewer, paper_id)
    # #208: no release step; a mark can be changed at any time, and the
    # student's result, My Progress and reports follow it.
    now = _now(now)
    ids = [m.get("answerId") for m in marks]
    rows = {a.id: a for a in db.query(MockPaperAnswer).filter(MockPaperAnswer.id.in_(ids))} if ids else {}
    touched = set()
    for m in marks:
        a = rows.get(m.get("answerId"))
        sitting = db.get(MockPaperSitting, a.sitting_id) if a else None
        if a is None or sitting is None or sitting.paper_id != paper.id:
            api_error(404, "NOT_FOUND", "That answer couldn't be found on this paper.")
        question = db.get(Question, a.question_id) if a else None
        if not a.counted or (a.auto_score is not None and not reviewable(a, question)):
            api_error(422, "VALIDATION_ERROR", "Only written answers, and number answers with working, are marked here.")
        score = m.get("score")
        if score is None:
            a.manual_score, a.graded_by_user_id, a.graded_at = None, None, None
        elif not isinstance(score, int) or isinstance(score, bool) or not 0 <= score <= a.max_score:
            api_error(422, "VALIDATION_ERROR", f"A mark must be a whole number from 0 to {a.max_score}.")
        else:
            a.manual_score, a.graded_by_user_id, a.graded_at = score, viewer.user.id, now
        touched.add(sitting.id)
    db.flush()
    for sid in touched:
        _recompute(db, db.get(MockPaperSitting, sid))
    return len(marks)


def results(db: Session, viewer: Viewer, paper_id: str, now: datetime | None = None) -> dict:
    """Question by student, with each student's total, for the teacher and
    the school's admin."""
    now = _now(now)
    paper, entry = papers.load_paper(db, viewer, paper_id)
    if paper.status != "APPROVED":
        api_error(409, "NOT_APPROVED", "This paper hasn't been approved.")
    settle_paper(db, paper, now)
    db.commit()
    fmt = json.loads(paper.format_json)
    slots = papers.slots_of(db, paper)
    number = _numbers(db, paper)
    columns = []
    for slot in slots:
        if slot.alternative:
            continue
        columns.append({"key": f"g{slot.choice_group}" if slot.choice_group else slot.id, "number": number[slot.id],
                        "sectionIndex": slot.section_index, "marks": slot.marks, "choice": bool(slot.choice_group)})
    key_of = {s.id: (f"g{s.choice_group}" if s.choice_group else s.id) for s in slots}
    versions = db.query(MockPaperVersion).filter_by(paper_id=paper.id).all()
    sittings = {s.student_id: s for s in db.query(MockPaperSitting).filter_by(paper_id=paper.id)}
    answers: dict[str, list] = {}
    if sittings:
        for a in db.query(MockPaperAnswer).filter(MockPaperAnswer.sitting_id.in_([s.id for s in sittings.values()])):
            answers.setdefault(a.sitting_id, []).append(a)
    names = _student_names(db, {v.student_id for v in versions})
    rows = []
    for v in versions:
        sitting = sittings.get(v.student_id)
        name, code = names.get(v.student_id, ("", ""))
        cells: dict[str, dict] = {}
        section_marks = [0] * len(fmt["sections"])
        if sitting is not None and sitting.status == "SUBMITTED":
            for a in answers.get(sitting.id, []):
                if not a.counted:
                    continue
                k = key_of[a.slot_id]
                cell = cells.setdefault(k, {"score": 0, "max": 0, "waiting": False, "blank": True})
                score = a.manual_score if a.manual_score is not None else a.auto_score
                cell["max"] += a.max_score
                cell["blank"] = cell["blank"] and not (a.response_text or "").strip()
                if score is None:
                    cell["waiting"] = True
                else:
                    cell["score"] += score
                    section_marks[db.get(MockPaperSlot, a.slot_id).section_index] += score
        state = "NOT_STARTED" if sitting is None else ("IN_PROGRESS" if sitting.status == "IN_PROGRESS" else
                                                       ("MARKED" if sitting.final_score is not None else "TO_MARK"))
        rows.append({
            "studentId": v.student_id, "name": name, "studentCode": code, "state": state,
            "score": sitting.final_score if sitting else None, "autoScore": sitting.auto_score if sitting else None,
            "submittedHow": sitting.submitted_how if sitting else None,
            "cells": cells, "sectionMarks": section_marks,
        })
    rows.sort(key=lambda r: (r["name"], r["studentCode"]))
    handed = [r for r in rows if r["state"] in ("TO_MARK", "MARKED")]
    to_mark = sum(1 for sitting in sittings.values() if sitting.status == "SUBMITTED"
                  for a in answers.get(sitting.id, []) if needs_marking(a))
    status = papers.status_of(paper, now)
    in_progress = sum(1 for r in rows if r["state"] == "IN_PROGRESS")
    return {
        "canChange": can_mark(viewer, entry),
        "shuffled": bool(fmt.get("shuffle")),
        "status": status,
        "columns": columns,
        "sections": [{"name": s["name"], "marks": s["marks"] * s["count"]} for s in fmt["sections"]],
        "totalMarks": fmt["totalMarks"],
        "students": rows,
        "handedIn": len(handed),
        "toMark": to_mark,
        "inProgress": in_progress,
        "solutionsOpen": solutions_open(paper, now),
        "closesAt": _aware(paper.closes_at).isoformat(),
    }


def student_result(db: Session, paper: MockPaper, student: Student, sitting: MockPaperSitting, *, solutions: bool) -> dict:
    """After hand-in (#208): the student's marks per section and question,
    with their answers; the right answers, solutions and marking steps once
    the paper has closed (`solutions`)."""
    version = _version(db, paper, student)
    answers = _answers(db, sitting)
    choices = _choices(sitting)
    sections = []
    number = 0
    for sec in _layout(db, paper, version):
        places = []
        marks = 0
        for halves in sec["places"]:
            number += 1
            group = halves[0]["slot"].choice_group
            chosen = next((h for h in halves if not group or choices.get(str(group)) == h["slot"].id), halves[0])
            parts = []
            for p in chosen["parts"]:
                q = p["question"]
                a = answers.get(q.id)
                score = None if a is None else (a.manual_score if a.manual_score is not None else a.auto_score)
                marks += score or 0
                parts.append({
                    "label": chr(96 + p["part"]) if p["part"] and len(chosen["parts"]) > 1 else None,
                    "text": p["text"], **public_question(q),
                    "response": a.response_text if a else None, "working": a.working_text if a else None,
                    "score": score, "maxScore": q.marks,
                    "correctAnswer": q.correct_answer if solutions else None,
                    "acceptedVariants": q.accepted_variants if solutions else None,
                    "explanation": q.explanation if solutions else None,
                    "markingSteps": q.teacher_note if solutions else None,
                    "note": learning_service.grading_note_words(
                        a.grading_note, marks_lost=(a.max_score - a.auto_score) if a and a.auto_score is not None else None) if a else None,
                })
            places.append({"number": number, "marks": halves[0]["slot"].marks, "choice": bool(group),
                           "stimulus": chosen["stimulus"], "parts": parts})
        sections.append({"name": sec["format"]["name"], "marks": marks, "maxMarks": sec["format"]["marks"] * sec["format"]["count"], "places": places})
    return {
        "score": sitting.final_score, "scoreSoFar": score_so_far(db, sitting), "waiting": waiting_count(db, sitting),
        "maxScore": sitting.max_score, "sections": sections,
        "solutionsOpen": solutions, "solutionsAt": solutions_at(paper).isoformat(),
    }
