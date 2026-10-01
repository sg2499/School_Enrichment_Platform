"""Proves the Practice Tracker API and manual grading (1 Oct 2026):

- assignments now record their section scope, and practice_access_service's
  SQL list filter agrees with teacher_assignment_service.teacher_may_read_record
  on every handover boundary;
- every new list endpoint really paginates server-side (page/pageSize,
  totals, a page past the end, the pageSize cap) and filters;
- the ownership ACL is enforced on the new endpoints: an unrelated teacher
  gets 404, an outgoing (transferred) teacher can read what they set but
  can't mark or grant (403), an incoming teacher sees nothing from before
  their window, admins are school-scoped;
- manual grading: range checks, no re-marking auto-scored answers, partial
  marking, FINALISED once everything is marked, corrections, audit rows.

Setup goes through the ORM/service layer (same convention as
test_learning.py) so each test's 5/minute login budget is spent only on the
roles actually under test.
"""
import json
from datetime import date, datetime, timezone

from sqlalchemy import event

from app.models import (
    Assignment,
    AssignmentTarget,
    AttemptAnswer,
    AuditLog,
    ClassLevel,
    Evaluation,
    Question,
)
from app.services import learning_service, practice_access_service, teacher_assignment_service
from tests.conftest import engine
from tests.test_learning import (
    _add_question,
    _assign_teacher_section,
    _login,
    _make_chapter_with_skills,
    _make_school,
    _make_school_admin,
    _make_sectioned_student,
    _make_teacher,
    _publish,
)

# Distinct "CHnn" numbers so classify_assignment_code recognises each test's
# assignment codes; kept clear of test_learning.py's own 1-27 range.
_CH = {
    "TRK1": 61, "TRK2": 62, "TRK3": 63, "TRK4": 64, "TRK5": 65, "TRK6": 66, "TRK7": 67, "TRK8": 68, "TRK9": 69,
}


def _utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


def _activity(db, suffix: str, *, constructed: bool = False):
    """A published CORE_PRACTICE activity. With constructed=True it has one
    auto-marked Single Select (1 mark) plus two Constructed Response items
    (3 and 2 marks) that auto-marking leaves unscored."""
    chapter, (skill,) = _make_chapter_with_skills(db, suffix, n_skills=1)
    code = f"CH{_CH[suffix]:02d}-P01"
    _add_question(db, skill, f"{suffix}-Q1", assignment_code=code, correct_answer="A", marks=1)
    if constructed:
        _add_question(
            db, skill, f"{suffix}-Q2", assignment_code=code, question_type="Constructed Response",
            correct_answer="Model answer two", marks=3, auto_gradable=False,
        )
        q3 = _add_question(
            db, skill, f"{suffix}-Q3", assignment_code=code, question_type="Constructed Response",
            correct_answer="Model answer three", marks=2, auto_gradable=False,
        )
        q3.teacher_note = "Award 1 mark for the method, 1 for the answer."
    db.commit()
    [activity] = learning_service.generate_activities_for_chapter(db, chapter, created_by_user_id=None)
    _publish(db, activity)
    return activity, chapter


def _question(db, code: str) -> Question:
    return db.query(Question).filter(Question.code == code).first()


def _assign(db, school, activity, by_user_id, *, section="A", created_at: datetime | None = None, max_attempts=3):
    assignment = learning_service.create_assignment(
        db, school=school, learning_activity=activity, assigned_by_user_id=by_user_id,
        class_name="5", section=section, max_attempts=max_attempts,
    )
    if created_at is not None:
        assignment.created_at = created_at
        db.commit()
        db.refresh(assignment)
    return assignment


def _target(db, assignment, student) -> AssignmentTarget:
    return (
        db.query(AssignmentTarget)
        .filter(AssignmentTarget.assignment_id == assignment.id, AssignmentTarget.student_id == student.id)
        .first()
    )


def _submit_constructed(db, suffix, assignment, student, *, single_select="A"):
    target = _target(db, assignment, student)
    attempt = learning_service.start_attempt(db, student, target.id)
    learning_service.save_answer(db, student, attempt.id, _question(db, f"{suffix}-Q1").id, single_select)
    learning_service.save_answer(db, student, attempt.id, _question(db, f"{suffix}-Q2").id, "Because of reasons")
    learning_service.save_answer(db, student, attempt.id, _question(db, f"{suffix}-Q3").id, "42")
    learning_service.submit_attempt(db, student, attempt.id)
    db.refresh(attempt)
    return attempt


def _handover(db, outgoing, incoming, board_course_id, *, section="A", on=date(2026, 8, 20)):
    """outgoing teaches (5, section, course) from 1 Apr 2026; handed to
    incoming on `on`."""
    row = _assign_teacher_section(db, outgoing, board_course_id, section)
    teacher_assignment_service.transfer_teacher(
        db, assignment=row, new_teacher_id=incoming.id, transfer_date=on, admin_user_id=None,
    )
    db.commit()


# --- scope recording + SQL/Python parity ---------------------------------------


def test_create_assignment_records_section_scope(db_session):
    activity, chapter = _activity(db_session, "TRK1")
    school = _make_school(db_session, "trk1")
    student = _make_sectioned_student(db_session, school, "trk1-a", class_name="5", section="A")
    class_level = db_session.query(ClassLevel).filter(ClassLevel.code == "5").first()

    scoped = learning_service.create_assignment(
        db_session, school=school, learning_activity=activity, assigned_by_user_id=None,
        class_name="5", section=" A ",
    )
    assert (scoped.class_level_id, scoped.section, scoped.board_course_id) == (class_level.id, "A", chapter.board_course_id)

    whole_class = learning_service.create_assignment(
        db_session, school=school, learning_activity=activity, assigned_by_user_id=None, class_name="5",
    )
    assert whole_class.section is None and whole_class.class_level_id == class_level.id
    assert practice_access_service.assignment_scope(whole_class) is None

    # studentIds (Foundation Repair / admin targeting): never section-scoped,
    # even if a section was passed alongside -- targeting ignores it too.
    individual = learning_service.create_assignment(
        db_session, school=school, learning_activity=activity, assigned_by_user_id=None,
        class_name="5", section="A", student_ids=[student.id],
    )
    assert individual.section is None and individual.class_level_id is None
    assert individual.board_course_id == chapter.board_course_id


def test_readable_assignments_sql_clause_matches_teacher_may_read_record(db_session):
    """The tracker lists assignments with a SQL EXISTS
    (readable_record_window_clause); single-record checks use
    teacher_may_read_record in Python. They must agree, including on the
    exact boundaries: start date inclusive, end date exclusive."""
    activity, chapter = _activity(db_session, "TRK2")
    school = _make_school(db_session, "trk2")
    outgoing = _make_teacher(db_session, school, "trk2-out")
    incoming = _make_teacher(db_session, school, "trk2-in")
    unrelated = _make_teacher(db_session, school, "trk2-x")
    _make_sectioned_student(db_session, school, "trk2-a", class_name="5", section="A")
    _make_sectioned_student(db_session, school, "trk2-b", class_name="5", section="B")
    admin = _make_school_admin(db_session, school, "trk2")
    _handover(db_session, outgoing, incoming, chapter.board_course_id)

    def at(*args):
        return _assign(db_session, school, activity, admin.id, created_at=_utc(*args))

    before_window = at(2026, 3, 31, 23, 59)
    first_day = at(2026, 4, 1, 0, 0)
    last_moment = at(2026, 8, 19, 23, 59, 59)
    handover_day = at(2026, 8, 20, 0, 0)
    later = at(2026, 9, 15, 10, 0)
    other_section = _assign(db_session, school, activity, admin.id, section="B", created_at=_utc(2026, 5, 1))
    # Not section-scoped, created by the outgoing teacher: creator-only.
    own_unscoped = learning_service.create_assignment(
        db_session, school=school, learning_activity=activity, assigned_by_user_id=outgoing.user_id, class_name="5",
    )
    every = [before_window, first_day, last_moment, handover_day, later, other_section, own_unscoped]

    expected = {
        outgoing.id: {first_day.id, last_moment.id, own_unscoped.id},
        incoming.id: {handover_day.id, later.id},
        unrelated.id: set(),
    }
    for teacher in (outgoing, incoming, unrelated):
        viewer = practice_access_service.resolve_viewer(db_session, teacher.user)
        via_sql = {
            a.id
            for a in db_session.query(Assignment)
            .filter(Assignment.id.in_([a.id for a in every]), practice_access_service.readable_assignments_clause(viewer))
            .all()
        }
        via_python = {a.id for a in every if practice_access_service.can_read_assignment(db_session, viewer, a)}
        assert via_sql == via_python == expected[teacher.id], teacher.teacher_code
        # The list endpoints' one-query-per-page canAct must agree with the
        # per-record check on every row they can return.
        bulk = practice_access_service.bulk_act_checker(db_session, viewer)
        for assignment in every:
            if assignment.id in via_sql:
                assert bulk(assignment) == practice_access_service.can_act_on_assignment(db_session, viewer, assignment)

    # Writes: only today's teacher of the section, never the outgoing one --
    # except on the outgoing teacher's own unscoped (legacy-shaped) row.
    out_viewer = practice_access_service.resolve_viewer(db_session, outgoing.user)
    in_viewer = practice_access_service.resolve_viewer(db_session, incoming.user)
    assert not practice_access_service.can_act_on_assignment(db_session, out_viewer, last_moment)
    assert practice_access_service.can_act_on_assignment(db_session, out_viewer, own_unscoped)
    assert practice_access_service.can_act_on_assignment(db_session, in_viewer, later)
    assert not practice_access_service.can_act_on_assignment(db_session, in_viewer, first_day)  # can't even read it


# --- pagination + filters -----------------------------------------------------------


def test_tracker_assignments_paginate_filter_and_report_progress(client, db_session):
    activity, chapter = _activity(db_session, "TRK3")
    other_activity, _ = _activity(db_session, "TRK4")
    school = _make_school(db_session, "trk3")
    teacher = _make_teacher(db_session, school, "trk3")
    s1 = _make_sectioned_student(db_session, school, "trk3-1", class_name="5", section="A")
    s2 = _make_sectioned_student(db_session, school, "trk3-2", class_name="5", section="A")
    _make_sectioned_student(db_session, school, "trk3-3", class_name="5", section="A")
    _make_sectioned_student(db_session, school, "trk3-b", class_name="5", section="B")
    _assign_teacher_section(db_session, teacher, chapter.board_course_id, "A")
    _assign_teacher_section(db_session, teacher, chapter.board_course_id, "B")

    in_a = [_assign(db_session, school, activity, teacher.user_id, created_at=_utc(2026, 9, 1, 9, i)) for i in range(7)]
    in_b = [_assign(db_session, school, activity, teacher.user_id, section="B", created_at=_utc(2026, 9, 2, 9, i)) for i in range(3)]
    # A different course's chapter (other_activity), to prove board course
    # filtering -- created by the teacher, so readable as creator.
    other_course = _assign(db_session, school, other_activity, teacher.user_id, created_at=_utc(2026, 9, 3))
    in_b[0].status = "CLOSED"
    db_session.commit()

    # Progress on the newest section-A assignment: s1 completes (1/1), s2
    # starts, the third student hasn't begun.
    newest_a = in_a[-1]
    attempt = learning_service.start_attempt(db_session, s1, _target(db_session, newest_a, s1).id)
    learning_service.save_answer(db_session, s1, attempt.id, _question(db_session, "TRK3-Q1").id, "A")
    learning_service.submit_attempt(db_session, s1, attempt.id)
    learning_service.start_attempt(db_session, s2, _target(db_session, newest_a, s2).id)

    headers = _login(client, teacher.user.email)
    def get(**params):
        return client.get("/api/learning/tracker/assignments", params=params, headers=headers)

    page1 = get(pageSize=4).json()
    assert (page1["total"], page1["totalPages"], page1["page"], page1["pageSize"]) == (11, 3, 1, 4)
    assert [row["id"] for row in page1["items"]] == [other_course.id, in_b[2].id, in_b[1].id, in_b[0].id]
    page3 = get(pageSize=4, page=3).json()
    assert len(page3["items"]) == 3
    seen = {row["id"] for p in (1, 2, 3) for row in get(pageSize=4, page=p).json()["items"]}
    assert len(seen) == 11  # no row skipped or repeated across pages
    beyond = get(pageSize=4, page=9).json()
    assert beyond["items"] == [] and beyond["total"] == 11

    # No N+1: a page of 10 costs the same number of SQL statements as a page
    # of 2 (auth + count + rows + a fixed set of grouped aggregates).
    def statements_for(page_size: int) -> int:
        seen: list[str] = []
        listener = lambda *args: seen.append(args[2])
        event.listen(engine, "before_cursor_execute", listener)
        try:
            assert get(pageSize=page_size).status_code == 200
        finally:
            event.remove(engine, "before_cursor_execute", listener)
        return len([sql for sql in seen if not sql.lstrip().upper().startswith("UPDATE")])

    assert statements_for(2) == statements_for(10)

    assert get(pageSize=101).status_code == 422
    assert get(page=0).status_code == 422

    section_b = get(section="B").json()
    assert section_b["total"] == 3
    class_level = db_session.query(ClassLevel).filter(ClassLevel.code == "5").first()
    scoped = get(classLevelId=class_level.id, section="A", boardCourseId=chapter.board_course_id).json()
    assert scoped["total"] == 7
    assert get(status="CLOSED").json()["total"] == 1
    assert get(status="NOPE").status_code == 422
    assert get(q="TRK4").json()["total"] == 1  # activity titles embed the chapter suffix
    assert get(q="%").json()["total"] == 0  # LIKE wildcards are escaped, not obeyed

    [row] = get(classLevelId=class_level.id, section="A", boardCourseId=chapter.board_course_id, pageSize=1).json()["items"]
    assert row["id"] == newest_a.id
    assert row["progress"] == {
        "targeted": 3, "notStarted": 1, "inProgress": 1, "completed": 1, "needsReview": 0, "averagePercent": 100,
    }
    assert (row["classLevelCode"], row["section"], row["boardCourseName"]) == ("5", "A", "Mathematics")
    assert row["isMine"] is True and row["canAct"] is True

    # One assignment's students, paginated, with filter-chip counts.
    students = client.get(
        f"/api/learning/tracker/assignments/{newest_a.id}/students", params={"pageSize": 2}, headers=headers
    ).json()
    assert (students["total"], students["totalPages"], len(students["items"])) == (3, 2, 2)
    assert students["counts"] == {"all": 3, "notStarted": 1, "inProgress": 1, "completed": 1, "needsReview": 0}
    completed = client.get(
        f"/api/learning/tracker/assignments/{newest_a.id}/students", params={"status": "COMPLETED"}, headers=headers
    ).json()
    [done] = completed["items"]
    assert done["studentId"] == s1.id and done["latestAttempt"]["evaluation"]["finalScore"] == 1
    searched = client.get(
        f"/api/learning/tracker/assignments/{newest_a.id}/students", params={"q": "trk3-2"}, headers=headers
    ).json()
    assert [r["studentId"] for r in searched["items"]] == [s2.id]


# --- ownership ACL on the new endpoints ---------------------------------------------


def test_handover_read_only_for_outgoing_and_invisible_to_incoming(client, db_session):
    activity, chapter = _activity(db_session, "TRK5", constructed=True)
    school = _make_school(db_session, "trk5")
    outgoing = _make_teacher(db_session, school, "trk5-out")
    incoming = _make_teacher(db_session, school, "trk5-in")
    stranger = _make_teacher(db_session, school, "trk5-x")
    student = _make_sectioned_student(db_session, school, "trk5-a", class_name="5", section="A")
    _handover(db_session, outgoing, incoming, chapter.board_course_id)

    old = _assign(db_session, school, activity, outgoing.user_id, created_at=_utc(2026, 7, 1), max_attempts=1)
    new = _assign(db_session, school, activity, None, created_at=_utc(2026, 9, 1))
    old_attempt = _submit_constructed(db_session, "TRK5", old, student)
    old_target = _target(db_session, old, student)
    q2 = _question(db_session, "TRK5-Q2")

    # Stranger: same school, no section -- nothing exists, as far as they can tell.
    headers = _login(client, stranger.user.email)
    for path in (
        f"/api/learning/tracker/assignments/{old.id}",
        f"/api/learning/tracker/assignments/{old.id}/students",
        f"/api/learning/tracker/attempts/{old_attempt.id}",
        f"/api/learning/tracker/students/{student.id}",
        f"/api/learning/assignments/{old.id}/targets",
    ):
        assert client.get(path, headers=headers).status_code == 404, path
    assert client.post(
        f"/api/learning/tracker/attempts/{old_attempt.id}/grades",
        json={"grades": [{"questionId": q2.id, "score": 1}]}, headers=headers,
    ).status_code == 404
    assert client.get("/api/learning/tracker/assignments", headers=headers).json()["total"] == 0

    # Outgoing: reads what was set on their watch, can't change it.
    client.cookies.clear()
    headers = _login(client, outgoing.user.email)
    listed = client.get("/api/learning/tracker/assignments", headers=headers).json()
    assert [r["id"] for r in listed["items"]] == [old.id]
    assert listed["items"][0]["canAct"] is False
    review = client.get(f"/api/learning/tracker/attempts/{old_attempt.id}", headers=headers)
    assert review.status_code == 200 and review.json()["canGrade"] is False
    grade = client.post(
        f"/api/learning/tracker/attempts/{old_attempt.id}/grades",
        json={"grades": [{"questionId": q2.id, "score": 1}]}, headers=headers,
    )
    assert grade.status_code == 403 and grade.json()["detail"]["code"] == "READ_ONLY_HANDOVER"
    grant = client.post(f"/api/learning/assignments/{old.id}/targets/{old_target.id}/grant-attempt", headers=headers)
    assert grant.status_code == 403
    assert client.get(f"/api/learning/tracker/assignments/{new.id}", headers=headers).status_code == 404
    # Read-only work isn't "waiting for you" either.
    assert client.get("/api/learning/tracker/review-queue", headers=headers).json()["total"] == 0
    overview = client.get("/api/learning/tracker/overview", headers=headers).json()
    assert overview["counts"]["needsReview"] == 0
    assert [(s["section"], s["isCurrent"]) for s in overview["sections"]] == [("A", False)]

    # Incoming: sees and acts on what's set from their start date, including
    # an admin-created assignment (new read access via the section window);
    # nothing from before.
    client.cookies.clear()
    headers = _login(client, incoming.user.email)
    listed = client.get("/api/learning/tracker/assignments", headers=headers).json()
    assert [r["id"] for r in listed["items"]] == [new.id]
    assert listed["items"][0]["canAct"] is True and listed["items"][0]["isMine"] is False
    assert client.get(f"/api/learning/assignments/{new.id}/targets", headers=headers).status_code == 200
    assert client.get(f"/api/learning/tracker/attempts/{old_attempt.id}", headers=headers).status_code == 404
    assert client.get(f"/api/learning/assignments/{old.id}/targets", headers=headers).status_code == 404
    assert client.get(f"/api/learning/attempts/{old_attempt.id}/result", headers=headers).status_code == 404

    db_session.refresh(old_target)
    assert old_target.bonus_attempts == 0
    assert db_session.query(AttemptAnswer).filter(
        AttemptAnswer.attempt_id == old_attempt.id, AttemptAnswer.manual_score.isnot(None)
    ).count() == 0


def test_admin_tracker_access_is_school_scoped(client, db_session):
    activity, chapter = _activity(db_session, "TRK6", constructed=True)
    school = _make_school(db_session, "trk6")
    other_school = _make_school(db_session, "trk6-other")
    teacher = _make_teacher(db_session, school, "trk6")
    student = _make_sectioned_student(db_session, school, "trk6-a", class_name="5", section="A")
    _assign_teacher_section(db_session, teacher, chapter.board_course_id, "A")
    assignment = _assign(db_session, school, activity, teacher.user_id)
    attempt = _submit_constructed(db_session, "TRK6", assignment, student)
    other_admin = _make_school_admin(db_session, other_school, "trk6-other")
    admin = _make_school_admin(db_session, school, "trk6")

    headers = _login(client, other_admin.email)
    assert client.get(f"/api/learning/tracker/attempts/{attempt.id}", headers=headers).status_code == 404
    assert client.get("/api/learning/tracker/review-queue", headers=headers).json()["total"] == 0

    client.cookies.clear()
    headers = _login(client, admin.email)
    queue = client.get("/api/learning/tracker/review-queue", headers=headers).json()
    assert [r["attemptId"] for r in queue["items"]] == [attempt.id]
    # An admin may mark (e.g. to clear a handed-over attempt nobody else can).
    graded = client.post(
        f"/api/learning/tracker/attempts/{attempt.id}/grades",
        json={"grades": [
            {"questionId": _question(db_session, "TRK6-Q2").id, "score": 3},
            {"questionId": _question(db_session, "TRK6-Q3").id, "score": 0},
        ]},
        headers=headers,
    )
    assert graded.status_code == 200, graded.text
    assert graded.json()["evaluation"]["reviewStatus"] == "FINALISED"
    assert graded.json()["evaluation"]["finalScore"] == 4


# --- manual grading -------------------------------------------------------------------


def test_manual_grading_end_to_end(client, db_session):
    activity, chapter = _activity(db_session, "TRK7", constructed=True)
    school = _make_school(db_session, "trk7")
    teacher = _make_teacher(db_session, school, "trk7")
    student = _make_sectioned_student(db_session, school, "trk7-a", class_name="5", section="A")
    _assign_teacher_section(db_session, teacher, chapter.board_course_id, "A")
    assignment = _assign(db_session, school, activity, teacher.user_id)
    attempt = _submit_constructed(db_session, "TRK7", assignment, student)
    q1, q2, q3 = (_question(db_session, f"TRK7-Q{i}") for i in (1, 2, 3))

    evaluation = db_session.query(Evaluation).filter(Evaluation.attempt_id == attempt.id).first()
    assert (evaluation.review_status, evaluation.auto_score, evaluation.final_score, evaluation.max_score) == (
        "PENDING_REVIEW", 1, 1, 6,
    )
    assert attempt.status == "SUBMITTED"

    headers = _login(client, teacher.user.email)
    url = f"/api/learning/tracker/attempts/{attempt.id}/grades"

    queue = client.get("/api/learning/tracker/review-queue", headers=headers).json()
    [queued] = queue["items"]
    assert (queued["attemptId"], queued["answersToMark"], queued["answersMarked"]) == (attempt.id, 2, 0)
    assert client.get("/api/learning/tracker/overview", headers=headers).json()["counts"]["needsReview"] == 1

    review = client.get(f"/api/learning/tracker/attempts/{attempt.id}", headers=headers).json()
    assert review["canGrade"] is True
    assert [a["questionId"] for a in review["answers"]] == [q1.id, q2.id, q3.id]  # activity sequence order
    assert [a["needsManualGrade"] for a in review["answers"]] == [False, True, True]
    assert review["answers"][2]["teacherNote"] == "Award 1 mark for the method, 1 for the answer."
    assert review["answers"][1]["correctAnswer"] == "Model answer two"

    def post(*grades):
        return client.post(url, json={"grades": [{"questionId": q, "score": s} for q, s in grades]}, headers=headers)

    # Every rejection is all-or-nothing: nothing below is written.
    over = post((q2.id, 2), (q3.id, 3))  # q3 is out of 2
    assert over.status_code == 422 and over.json()["detail"]["code"] == "SCORE_OUT_OF_RANGE"
    assert post((q2.id, -1)).status_code == 422
    auto = post((q1.id, 1))
    assert auto.status_code == 422 and auto.json()["detail"]["code"] == "NOT_MANUALLY_GRADABLE"
    assert post((q2.id, 1), (q2.id, 2)).status_code == 422
    assert post(("not-a-question", 1)).status_code == 422
    assert client.post(url, json={"grades": []}, headers=headers).status_code == 422
    assert client.post(url, json={"grades": [{"questionId": q2.id, "score": 1.5}]}, headers=headers).status_code == 422
    db_session.expire_all()
    assert db_session.query(AttemptAnswer).filter(
        AttemptAnswer.attempt_id == attempt.id, AttemptAnswer.manual_score.isnot(None)
    ).count() == 0

    # Partial marking: still pending, provisional final score.
    partial = post((q2.id, 2))
    assert partial.status_code == 200, partial.text
    body = partial.json()
    assert (body["evaluation"]["reviewStatus"], body["evaluation"]["teacherScore"], body["evaluation"]["finalScore"]) == (
        "PENDING_REVIEW", 2, 3,
    )
    marked = next(a for a in body["answers"] if a["questionId"] == q2.id)
    assert marked["manualScore"] == 2 and marked["gradedByName"] == teacher.user.full_name
    assert client.get("/api/learning/tracker/review-queue", headers=headers).json()["items"][0]["answersToMark"] == 1

    # Last one: FINALISED, attempt EVALUATED, out of the queue.
    final = post((q3.id, 2)).json()
    assert (final["evaluation"]["reviewStatus"], final["evaluation"]["finalScore"], final["evaluation"]["teacherScore"]) == (
        "FINALISED", 5, 4,
    )
    assert final["evaluation"]["finalisedByName"] == teacher.user.full_name
    assert final["attempt"]["status"] == "EVALUATED"
    assert client.get("/api/learning/tracker/review-queue", headers=headers).json()["total"] == 0
    row = client.get("/api/learning/tracker/assignments", headers=headers).json()["items"][0]
    assert row["progress"]["needsReview"] == 0 and row["progress"]["averagePercent"] == round(100 * 5 / 6)

    # A correction after finalising is allowed, recomputes, and stays FINALISED.
    corrected = post((q2.id, 3)).json()
    assert (corrected["evaluation"]["reviewStatus"], corrected["evaluation"]["finalScore"]) == ("FINALISED", 6)

    # Audit: one row per grading request, with what moved.
    audits = (
        db_session.query(AuditLog)
        .filter(AuditLog.event_type == "learning.attempt.manually_graded", AuditLog.user_id == teacher.user_id)
        .order_by(AuditLog.created_at)
        .all()
    )
    details = [json.loads(a.event_data_json) for a in audits]
    assert len(details) == 3
    assert details[-1]["grades"] == [{"questionId": q2.id, "previousScore": 2, "score": 3, "maxScore": 3}]
    assert (details[1]["reviewStatusBefore"], details[1]["reviewStatusAfter"]) == ("PENDING_REVIEW", "FINALISED")

    # The student's own result reflects the teacher's marks.
    client.cookies.clear()
    student_headers = _login(client, student.user.email)
    result = client.get(f"/api/learning/attempts/{attempt.id}/result", headers=student_headers).json()
    assert (result["reviewStatus"], result["finalScore"], result["teacherScore"]) == ("FINALISED", 6, 5)
    assert {a["questionId"]: a["manualScore"] for a in result["answers"]}[q3.id] == 2


def test_review_queue_is_oldest_first_and_paginated(client, db_session):
    activity, chapter = _activity(db_session, "TRK8", constructed=True)
    school = _make_school(db_session, "trk8")
    teacher = _make_teacher(db_session, school, "trk8")
    students = [_make_sectioned_student(db_session, school, f"trk8-{i}", class_name="5", section="A") for i in range(3)]
    _assign_teacher_section(db_session, teacher, chapter.board_course_id, "A")
    assignment = _assign(db_session, school, activity, teacher.user_id)
    attempts = [_submit_constructed(db_session, "TRK8", assignment, s) for s in students]
    for i, attempt in enumerate(attempts):  # submitted newest-first on purpose
        attempt.submitted_at = _utc(2026, 9, 10 - i, 12, 0)
    db_session.commit()

    headers = _login(client, teacher.user.email)
    page1 = client.get("/api/learning/tracker/review-queue", params={"pageSize": 2}, headers=headers).json()
    page2 = client.get("/api/learning/tracker/review-queue", params={"pageSize": 2, "page": 2}, headers=headers).json()
    assert page1["total"] == 3 and page1["totalPages"] == 2
    assert [r["attemptId"] for r in page1["items"] + page2["items"]] == [attempts[2].id, attempts[1].id, attempts[0].id]

    students_view = client.get(
        f"/api/learning/tracker/assignments/{assignment.id}/students", params={"status": "NEEDS_REVIEW"}, headers=headers
    ).json()
    assert students_view["total"] == 3 and students_view["counts"]["needsReview"] == 3


def test_section_students_and_student_history_respect_handover(client, db_session):
    activity, chapter = _activity(db_session, "TRK9")
    school = _make_school(db_session, "trk9")
    outgoing = _make_teacher(db_session, school, "trk9-out")
    incoming = _make_teacher(db_session, school, "trk9-in")
    taught = _make_sectioned_student(db_session, school, "trk9-taught", class_name="5", section="A")
    old = _assign(db_session, school, activity, outgoing.user_id, created_at=_utc(2026, 7, 1))
    # Joins 5A after the outgoing teacher's assignment was set.
    newcomer = _make_sectioned_student(db_session, school, "trk9-new", class_name="5", section="A")
    elsewhere = _make_sectioned_student(db_session, school, "trk9-6c", class_name="6", section="C")
    _handover(db_session, outgoing, incoming, chapter.board_course_id)
    new = _assign(db_session, school, activity, incoming.user_id, created_at=_utc(2026, 9, 1))
    attempt = learning_service.start_attempt(db_session, taught, _target(db_session, new, taught).id)
    learning_service.save_answer(db_session, taught, attempt.id, _question(db_session, "TRK9-Q1").id, "B")
    learning_service.submit_attempt(db_session, taught, attempt.id)

    class_level = db_session.query(ClassLevel).filter(ClassLevel.code == "5").first()
    scope = {"classLevelId": class_level.id, "section": "A", "boardCourseId": chapter.board_course_id}

    # Incoming (current): the whole 5A roster, numbers from their own window.
    headers = _login(client, incoming.user.email)
    listed = client.get("/api/learning/tracker/students", params=scope, headers=headers).json()
    assert {r["studentId"] for r in listed["items"]} == {taught.id, newcomer.id}
    stats = {r["studentId"]: r["stats"] for r in listed["items"]}[taught.id]
    assert (stats["assigned"], stats["completed"], stats["averagePercent"]) == (1, 1, 0)
    history = client.get(f"/api/learning/tracker/students/{taught.id}", headers=headers).json()
    assert [item["assignment"]["id"] for item in history["items"]] == [new.id]
    assert history["student"]["studentCode"] == taught.student_code
    assert client.get(f"/api/learning/tracker/students/{elsewhere.id}", headers=headers).status_code == 404

    # Outgoing (past): only students their own assignments reached, and only
    # those assignments in the history -- the newcomer and the new
    # assignment stay invisible.
    client.cookies.clear()
    headers = _login(client, outgoing.user.email)
    listed = client.get("/api/learning/tracker/students", params=scope, headers=headers).json()
    assert [r["studentId"] for r in listed["items"]] == [taught.id]
    history = client.get(f"/api/learning/tracker/students/{taught.id}", headers=headers).json()
    assert [item["assignment"]["id"] for item in history["items"]] == [old.id]
    assert history["items"][0]["canGrantAttempt"] is False
    assert client.get(f"/api/learning/tracker/students/{newcomer.id}", headers=headers).status_code == 404
