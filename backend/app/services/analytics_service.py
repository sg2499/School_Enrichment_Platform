"""Class Analytics (#186, 26 Oct 2026): what a section got right and wrong,
for its teacher and the school's admin.

Decisions (Shailesh, 26 Oct 2026; PHASE6_CLASS_ANALYTICS_DESIGN.md):

- Per practice set, a question-by-student grid; per chapter, the
  misconceptions the section holds.
- The student's FIRST handed-in attempt counts by default (after handing in,
  students see the right answers, so later attempts show what they
  remembered); a switch shows the latest instead.
- A misconception counts for a student when they missed 2 or more of the
  questions that test it (each question carries one, written by the content
  team) -- "use repeated error patterns", never one slip (blueprint
  Section 11). "Missed" means fewer than full marks on a marked answer; a
  written answer waiting for its mark is not counted either way.
- The report leads to action: the skill's Remediation set (else its Extra
  Practice set), for the teacher to set for those students from Assign
  Practice. Nothing is assigned from here.
- A misconception note is shown only once Ashalatha has approved it, in her
  wording with her next step (Q14, 26 Oct 2026; MisconceptionReview). Until
  then it is only counted, as waiting for review.

What counts: practice the teacher (or the school) set for that section --
assignments recorded with that section, course and class, that the viewer
may read (practice_access_service). A student's own practice is left out.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import and_, or_
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
    ConceptLesson,
    LearningActivity,
    LearningActivityQuestion,
    MisconceptionReview,
    Question,
    Student,
    TeacherSectionAssignment,
    User,
)
from app.services import mock_results_service, practice_access_service
from app.services.practice_access_service import Viewer

MISSED_FOR_MISCONCEPTION = 2
_HANDED_IN = ("SUBMITTED", "EVALUATED")
_EARLIEST = datetime.min.replace(tzinfo=timezone.utc)
FIRST, LATEST = "first", "latest"


@dataclass(frozen=True)
class Scope:
    class_level_id: str
    section: str
    board_course_id: str

    @property
    def key(self) -> str:
        return f"{self.class_level_id}|{self.section}|{self.board_course_id}"


def parse_scope(raw: str | None) -> Scope:
    parts = (raw or "").split("|")
    if len(parts) != 3 or not all(p.strip() for p in parts):
        api_error(422, "VALIDATION_ERROR", "Choose a section to look at.")
    return Scope(parts[0].strip(), parts[1].strip(), parts[2].strip())


def parse_attempt(raw: str | None) -> str:
    value = (raw or FIRST).lower()
    if value not in (FIRST, LATEST):
        api_error(422, "VALIDATION_ERROR", "Choose the first or the latest attempt.")
    return value


# --- sections -----------------------------------------------------------------


def _require_school(viewer: Viewer) -> None:
    """A section is one school's (class levels and courses are shared by
    every school), so a Super Admin, who has none, is refused (#186 review)."""
    if viewer.school_id is None:
        api_error(403, "FORBIDDEN", "Class Analytics shows one school's sections. Sign in as that school's admin to see them.")


def sections(db: Session, viewer: Viewer) -> list[dict]:
    """The sections this viewer may look at: a teacher's own (current and
    past), an admin's whole school (every section a teacher is or was
    assigned to, and every section practice was set for)."""
    _require_school(viewer)
    triples: dict[tuple, bool] = {}
    tsa = db.query(TeacherSectionAssignment)
    if viewer.is_teacher:
        tsa = tsa.filter(TeacherSectionAssignment.teacher_id == viewer.teacher.id)
    elif viewer.school_id is not None:
        tsa = tsa.filter(TeacherSectionAssignment.school_id == viewer.school_id)
    for row in tsa.all():
        key = (row.class_level_id, row.section, row.board_course_id)
        triples[key] = triples.get(key, False) or row.end_date is None
    if not viewer.is_teacher:
        q = db.query(Assignment.class_level_id, Assignment.section, Assignment.board_course_id).filter(
            practice_access_service.readable_assignments_clause(viewer),
            Assignment.class_level_id.isnot(None),
            Assignment.section.isnot(None),
            Assignment.board_course_id.isnot(None),
            Assignment.reason != "SELF_PRACTICE",
        )
        for row in q.distinct().all():
            triples.setdefault(tuple(row), True)
    levels = {c.id: c for c in db.query(ClassLevel).filter(ClassLevel.id.in_({t[0] for t in triples})).all()} if triples else {}
    courses = {c.id: c for c in db.query(BoardCourse).filter(BoardCourse.id.in_({t[2] for t in triples})).all()} if triples else {}
    out = []
    for (level_id, section, course_id), current in triples.items():
        level = levels.get(level_id)
        course = courses.get(course_id)
        out.append(
            {
                "key": f"{level_id}|{section}|{course_id}",
                "classLevelId": level_id,
                "classLevelCode": level.code if level else None,
                "section": section,
                "boardCourseId": course_id,
                "boardCourseName": course.display_name if course else None,
                "isCurrent": current,
            }
        )

    def order(entry):
        code = entry["classLevelCode"] or ""
        return (not entry["isCurrent"], int(code) if code.isdigit() else 999, entry["section"], entry["boardCourseName"] or "")

    return sorted(out, key=order)


def _require_scope_visible(db: Session, viewer: Viewer, scope: Scope) -> None:
    if not any(s["key"] == scope.key for s in sections(db, viewer)):
        api_error(404, "NOT_FOUND", "That section couldn't be found.")


# --- what counts ----------------------------------------------------------------


def _scope_assignments_clause(viewer: Viewer, scope: Scope):
    return and_(
        practice_access_service.readable_assignments_clause(viewer),
        Assignment.class_level_id == scope.class_level_id,
        Assignment.section == scope.section,
        Assignment.board_course_id == scope.board_course_id,
        Assignment.status != "CANCELLED",
        Assignment.reason != "SELF_PRACTICE",
    )


def _section_students(db: Session, viewer: Viewer, scope: Scope, assignment_ids: list[str]) -> list[tuple[Student, User]]:
    """The section's current students, and anyone the section's practice was
    set for (a student who has since moved still has their answers here)."""
    level = db.get(ClassLevel, scope.class_level_id)
    conditions = []
    if level is not None:
        conditions.append(
            and_(Student.class_name == level.code, Student.section == scope.section, Student.is_active.is_(True))
        )
    if assignment_ids:
        conditions.append(
            Student.id.in_(
                db.query(AssignmentTarget.student_id).filter(AssignmentTarget.assignment_id.in_(assignment_ids))
            )
        )
    if not conditions:
        return []
    query = (
        db.query(Student, User)
        .join(User, User.id == Student.user_id)
        .filter(or_(*conditions))
    )
    if viewer.school_id is not None:
        query = query.filter(Student.school_id == viewer.school_id)
    return query.order_by(User.full_name, Student.student_code).all()


def _in_section(db: Session, scope: Scope):
    level = db.get(ClassLevel, scope.class_level_id)
    code = level.code if level else None
    return lambda s: bool(s.is_active) and code is not None and s.class_name == code and s.section == scope.section


def _student_dict(student: Student, user: User, in_section=None) -> dict:
    out = {"id": student.id, "name": user.full_name, "studentCode": student.student_code, "isActive": bool(student.is_active)}
    if in_section is not None:
        # Whether practice can still be set for them in this section (a
        # student who has moved, or left, can't be).
        out["inSection"] = in_section(student)
    return out


def _answers(db: Session, assignment_ids: list[str], *, question_ids: set[str] | None = None, chapter_id: str | None = None):
    """Every answer in a handed-in attempt on these assignments:
    (student_id, question_id, score or None, max_score, response_text, attempt key)."""
    if not assignment_ids:
        return []
    query = (
        db.query(
            AssignmentTarget.student_id,
            AttemptAnswer.question_id,
            AttemptAnswer.manual_score,
            AttemptAnswer.auto_score,
            AttemptAnswer.max_score,
            AttemptAnswer.response_text,
            Attempt.submitted_at,
            Attempt.attempt_number,
            Attempt.id,
        )
        .join(Attempt, Attempt.id == AttemptAnswer.attempt_id)
        .join(AssignmentTarget, AssignmentTarget.id == Attempt.assignment_target_id)
        .filter(AssignmentTarget.assignment_id.in_(assignment_ids), Attempt.status.in_(_HANDED_IN))
    )
    if question_ids is not None:
        query = query.filter(AttemptAnswer.question_id.in_(question_ids))
    if chapter_id is not None:
        query = (
            query.join(Question, Question.id == AttemptAnswer.question_id)
            .join(ConceptLesson, ConceptLesson.id == Question.concept_lesson_id)
            .filter(ConceptLesson.chapter_id == chapter_id)
        )
    out = []
    for student_id, question_id, manual, auto, max_score, response, submitted_at, number, attempt_id in query.all():
        stamp = submitted_at or _EARLIEST
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        score = manual if manual is not None else auto
        out.append((student_id, question_id, score, max_score or 0, response, (stamp, number, attempt_id)))
    return out


def _pick(rows, which: str) -> dict[tuple[str, str], tuple]:
    """(student, question) -> the answer from the first or latest handed-in
    attempt that has it."""
    chosen: dict[tuple[str, str], tuple] = {}
    for row in rows:
        key = (row[0], row[1])
        current = chosen.get(key)
        if current is None or (row[5] < current[5] if which == FIRST else row[5] > current[5]):
            chosen[key] = row
    return chosen


def cell_state(score, max_score, response) -> str:
    """CORRECT, PARTIAL, WRONG, BLANK or PENDING (a written answer waiting
    for its mark)."""
    if score is None:
        return "PENDING"
    if max_score and score >= max_score:
        return "CORRECT"
    if score > 0:
        return "PARTIAL"
    return "BLANK" if not (response or "").strip() else "WRONG"


def tag_key(tag: str | None) -> str:
    """One misconception however its note is spelled: case, spacing and a
    closing full stop don't make a different mistake (#186 review)."""
    return " ".join((tag or "").split()).rstrip(" .;:").casefold()


def reviewed_notes(db: Session, skill_ids) -> dict[tuple[str, str], MisconceptionReview]:
    """Every review of these skills' notes, by (skill id, tag key). Only an
    APPROVED one is shown to teachers (Ashalatha, Q14, 26 Oct 2026): a
    misconception note is checked for accuracy, neutral language and a next
    step before it reaches a dashboard."""
    ids = list(skill_ids)
    if not ids:
        return {}
    return {
        (r.concept_lesson_id, r.tag_key): r
        for r in db.query(MisconceptionReview).filter(MisconceptionReview.concept_lesson_id.in_(ids))
    }


def _approved(review: MisconceptionReview | None) -> MisconceptionReview | None:
    return review if review is not None and review.status == "APPROVED" and (review.shown_note or "").strip() else None


def _short(text: str | None, limit: int = 140) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


# --- practice sets --------------------------------------------------------------


def practice_sets(db: Session, viewer: Viewer, scope: Scope) -> dict:
    _require_scope_visible(db, viewer, scope)
    rows = (
        db.query(Assignment, LearningActivity)
        .join(LearningActivity, LearningActivity.id == Assignment.learning_activity_id)
        .filter(_scope_assignments_clause(viewer, scope))
        .all()
    )
    by_activity: dict[str, dict] = {}
    chapters: dict[str, Chapter] = {}
    for assignment, activity in rows:
        entry = by_activity.setdefault(
            activity.id,
            {"activity": activity, "assignmentIds": [], "lastSetAt": None},
        )
        entry["assignmentIds"].append(assignment.id)
        if assignment.created_at and (entry["lastSetAt"] is None or assignment.created_at > entry["lastSetAt"]):
            entry["lastSetAt"] = assignment.created_at
    chapter_ids = {e["activity"].chapter_id for e in by_activity.values()}
    # #207: a chapter a handed-in mock paper covered has misconceptions to
    # show even if no practice was set on it.
    chapter_ids |= mock_results_service.handed_in_chapter_ids(
        db,
        and_(
            mock_results_service.readable_papers_clause(viewer),
            mock_results_service.section_clause(scope.class_level_id, scope.section, scope.board_course_id),
        ),
    )
    if chapter_ids:
        chapters = {c.id: c for c in db.query(Chapter).filter(Chapter.id.in_(chapter_ids)).all()}
    all_ids = [aid for e in by_activity.values() for aid in e["assignmentIds"]]
    targeted: dict[str, set[str]] = {}
    handed_in: dict[str, set[str]] = {}
    if all_ids:
        for assignment_id, student_id in db.query(AssignmentTarget.assignment_id, AssignmentTarget.student_id).filter(
            AssignmentTarget.assignment_id.in_(all_ids)
        ):
            targeted.setdefault(assignment_id, set()).add(student_id)
        for assignment_id, student_id in (
            db.query(AssignmentTarget.assignment_id, AssignmentTarget.student_id)
            .join(Attempt, Attempt.assignment_target_id == AssignmentTarget.id)
            .filter(AssignmentTarget.assignment_id.in_(all_ids), Attempt.status.in_(_HANDED_IN))
            .distinct()
        ):
            handed_in.setdefault(assignment_id, set()).add(student_id)
    items = []
    for activity_id, entry in by_activity.items():
        activity = entry["activity"]
        chapter = chapters.get(activity.chapter_id)
        students = set().union(*(targeted.get(a, set()) for a in entry["assignmentIds"]))
        done = set().union(*(handed_in.get(a, set()) for a in entry["assignmentIds"]))
        items.append(
            {
                "learningActivityId": activity_id,
                "title": activity.title,
                "activityType": activity.activity_type,
                "chapterId": activity.chapter_id,
                "chapterTitle": chapter.title if chapter else None,
                "chapterNo": chapter.chapter_no if chapter else None,
                "students": len(students),
                "handedIn": len(done & students),
                "lastSetAt": entry["lastSetAt"].isoformat() if entry["lastSetAt"] else None,
            }
        )
    items.sort(key=lambda i: i["lastSetAt"] or "", reverse=True)
    chapter_list = sorted(
        ({"id": c.id, "chapterNo": c.chapter_no, "title": c.title} for c in chapters.values()),
        key=lambda c: (c["chapterNo"] or 0, c["title"]),
    )
    return {"scope": scope.key, "sets": items, "chapters": chapter_list}


def set_grid(db: Session, viewer: Viewer, scope: Scope, activity_id: str, which: str) -> dict:
    _require_scope_visible(db, viewer, scope)
    activity = db.get(LearningActivity, activity_id)
    assignment_ids = (
        [
            a.id
            for a in db.query(Assignment.id).filter(
                _scope_assignments_clause(viewer, scope), Assignment.learning_activity_id == activity_id
            )
        ]
        if activity
        else []
    )
    if not activity or not assignment_ids:
        api_error(404, "NOT_FOUND", "That practice set wasn't given to this section.")
    question_rows = (
        db.query(Question, LearningActivityQuestion.sequence, ConceptLesson)
        .join(LearningActivityQuestion, LearningActivityQuestion.question_id == Question.id)
        .join(ConceptLesson, ConceptLesson.id == Question.concept_lesson_id)
        .filter(LearningActivityQuestion.learning_activity_id == activity_id)
        .order_by(LearningActivityQuestion.sequence, Question.code)
        .all()
    )
    question_ids = {q.id for q, _, _ in question_rows}
    targeted = {
        sid
        for (sid,) in db.query(AssignmentTarget.student_id).filter(AssignmentTarget.assignment_id.in_(assignment_ids))
    }
    picked = _pick(_answers(db, assignment_ids, question_ids=question_ids), which)
    students_rows = [
        (s, u) for s, u in _section_students(db, viewer, scope, assignment_ids) if s.id in targeted
    ]
    reviews = reviewed_notes(db, {skill.id for _q, _s, skill in question_rows})
    questions = []
    for n, (q, _seq, skill) in enumerate(question_rows, start=1):
        # The share of students who got it fully right (part marks are not
        # "right": #186 review), among those whose answer is marked.
        right = answered = 0
        for s, _u in students_rows:
            row = picked.get((s.id, q.id))
            if row is None or row[2] is None:
                continue
            answered += 1
            right += 1 if row[3] and row[2] >= row[3] else 0
        questions.append(
            {
                "id": q.id,
                "number": n,
                "code": q.code,
                "stem": _short(q.stem),
                "questionType": q.question_type,
                "marks": q.marks,
                "skillTitle": skill.title,
                # Only a note Ashalatha has approved, in her wording (Q14).
                "misconception": _short(note.shown_note, 200) if (note := _approved(reviews.get((skill.id, tag_key(q.misconception_tag))))) else None,
                "answered": answered,
                "percentCorrect": round(100.0 * right / answered, 1) if answered else None,
            }
        )
    students = []
    for s, u in students_rows:
        cells = []
        earned = possible = 0
        attempted = False
        for q, _seq, _skill in question_rows:
            row = picked.get((s.id, q.id))
            if row is None:
                cells.append(None)
                continue
            attempted = True
            state = cell_state(row[2], row[3], row[4])
            cells.append({"state": state, "score": row[2], "max": row[3]})
            if row[2] is not None:
                earned += max(0, min(row[2], row[3]))
                possible += row[3]
        students.append(
            {
                **_student_dict(s, u),
                "handedIn": attempted,
                "score": earned if attempted else None,
                "possible": possible if attempted else None,
                "cells": cells,
            }
        )
    return {
        "scope": scope.key,
        "activity": {"id": activity.id, "title": activity.title, "activityType": activity.activity_type},
        "attempt": which,
        "questions": questions,
        "students": students,
    }


# --- misconceptions -------------------------------------------------------------


def misconceptions(db: Session, viewer: Viewer, scope: Scope, chapter_id: str, which: str) -> dict:
    _require_scope_visible(db, viewer, scope)
    chapter = db.get(Chapter, chapter_id)
    if chapter is None:
        api_error(404, "NOT_FOUND", "That chapter couldn't be found.")
    assignment_ids = [
        a.id
        for a in db.query(Assignment.id)
        .join(LearningActivity, LearningActivity.id == Assignment.learning_activity_id)
        .filter(_scope_assignments_clause(viewer, scope), LearningActivity.chapter_id == chapter_id)
    ]
    picked = _pick(_answers(db, assignment_ids, chapter_id=chapter_id), which) if assignment_ids else {}
    students = {s.id: (s, u) for s, u in _section_students(db, viewer, scope, assignment_ids)}
    # #207: the section's mock papers count too, from hand-in (#208). Each student's
    # paper questions are their own, so there is no first or latest to pick.
    mock_rows = mock_results_service.answers(
        db,
        None,
        chapter_id=chapter_id,
        paper_clause=and_(
            mock_results_service.readable_papers_clause(viewer),
            mock_results_service.section_clause(scope.class_level_id, scope.section, scope.board_course_id),
        ),
    )
    missing = {a.student_id for a in mock_rows} - set(students)
    if missing:
        for s, u in db.query(Student, User).join(User, User.id == Student.user_id).filter(Student.id.in_(missing)).all():
            students[s.id] = (s, u)
    # A mock question is generated for one student, so "questions that test
    # it" counts the paper's question (its slot), not each student's copy
    # (#207 review).
    counted_as: dict[str, str] = {}
    for a in mock_rows:
        picked[(a.student_id, a.question_id)] = (a.student_id, a.question_id, a.score, a.max_score, None, (a.handed_in_at, 0, a.sitting_id))
        counted_as[a.question_id] = f"slot:{a.slot_id}"
    # Only the questions answered here (the chapter's every question, at
    # every school, would be read otherwise).
    answered_ids = {qid for _, qid in picked}
    by_question: dict = {}
    if answered_ids:
        for qid, tag, skill in (
            db.query(Question.id, Question.misconception_tag, ConceptLesson)
            .join(ConceptLesson, ConceptLesson.id == Question.concept_lesson_id)
            .filter(ConceptLesson.chapter_id == chapter_id, Question.id.in_(answered_ids))
            .all()
        ):
            by_question[qid] = (tag, skill)
    in_section = _in_section(db, scope)

    groups: dict[tuple[str, str], dict] = {}
    for (student_id, question_id), row in picked.items():
        if student_id not in students or row[2] is None or question_id not in by_question:
            continue
        raw_tag, skill = by_question[question_id]
        key = tag_key(raw_tag)
        if not key:
            continue
        group = groups.setdefault(
            (skill.id, key),
            {"skill": skill, "tag": " ".join(raw_tag.split()), "questions": set(), "per_student": {}},
        )
        group["questions"].add(counted_as.get(question_id, question_id))
        answered, missed = group["per_student"].get(student_id, (0, 0))
        group["per_student"][student_id] = (answered + 1, missed + (1 if row[2] < row[3] else 0))

    skill_ids = list({g["skill"].id for g in groups.values()})
    rescue: dict[str, LearningActivity] = {}
    if skill_ids:
        for activity in (
            db.query(LearningActivity)
            .filter(
                LearningActivity.concept_lesson_id.in_(skill_ids),
                LearningActivity.status == "PUBLISHED",
                LearningActivity.activity_type.in_(("REMEDIATION", "EXTRA_PRACTICE")),
            )
            .order_by(LearningActivity.sequence, LearningActivity.title)
            .all()
        ):
            current = rescue.get(activity.concept_lesson_id)
            if current is None or (current.activity_type != "REMEDIATION" and activity.activity_type == "REMEDIATION"):
                rescue[activity.concept_lesson_id] = activity

    reviews = reviewed_notes(db, skill_ids)
    items = []
    waiting = held = 0
    for (skill_id, key), group in groups.items():
        # Only students who answered 2+ of its questions could show the
        # pattern, so they are the "of N" (#186 review); a mistake tested by
        # one question so far can't be judged yet and is left out.
        if len(group["questions"]) < MISSED_FOR_MISCONCEPTION:
            continue
        review = reviews.get((skill_id, key))
        approved = _approved(review)
        flagged = []
        judged = 0
        for student_id, (answered, missed) in group["per_student"].items():
            if answered >= MISSED_FOR_MISCONCEPTION:
                judged += 1
            if missed >= MISSED_FOR_MISCONCEPTION:
                s, u = students[student_id]
                flagged.append({**_student_dict(s, u, in_section), "missed": missed, "answered": answered})
        if approved is None:
            # Not reviewed yet: never shown; counted when a student shows
            # the mistake (review). One she turned down is neither shown nor
            # counted.
            if review is None or review.status != "REJECTED":
                held += 1
                waiting += 1 if flagged else 0
            continue
        flagged.sort(key=lambda f: (-f["missed"], f["name"] or "", f["studentCode"]))
        skill = group["skill"]
        set_ = rescue.get(skill.id)
        items.append(
            {
                "misconception": " ".join(approved.shown_note.split()),
                "nextStep": " ".join(approved.next_step.split()) if approved.next_step else None,
                "skill": {"id": skill.id, "code": skill.code, "title": skill.title},
                "studentsAnswered": judged,
                "questionsAsked": len(group["questions"]),
                "students": flagged,
                "practiceSet": {"learningActivityId": set_.id, "title": set_.title, "activityType": set_.activity_type} if set_ else None,
            }
        )
    items.sort(
        key=lambda i: (
            -len(i["students"]),
            -(len(i["students"]) / i["studentsAnswered"] if i["studentsAnswered"] else 0),
            i["skill"]["code"],
            i["misconception"],
        )
    )
    return {
        "scope": scope.key,
        "chapter": {"id": chapter.id, "chapterNo": chapter.chapter_no, "title": chapter.title},
        "attempt": which,
        "missedThreshold": MISSED_FOR_MISCONCEPTION,
        "studentsInSection": len(students),
        "misconceptions": items,
        # Mistakes students in this section show (2+ missed) that are not on
        # screen because their note is still waiting for Ashalatha's review.
        "awaitingReview": waiting,
        # Every tested mistake held back for review, shown by a student or not.
        "heldForReview": held,
    }
