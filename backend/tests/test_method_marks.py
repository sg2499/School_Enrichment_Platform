"""Part and method marks on auto-marked questions (#163, 22 Oct 2026).

Shailesh chose "working box + teacher review": on a Numeric Entry question
worth 2 or more marks the child may type their working under the answer;
marking stays automatic and instant; a teacher may review any auto-marked
answer worth 2 or more marks and change or keep its mark, with a reason
the student reads. Answers with working that fell short of full marks are
listed under Method Marks in the Practice Tracker. The machine's mark is
kept beside the teacher's.

Proves:
- which questions take working, and how working is saved, kept, cleared,
  limited and echoed back on resume;
- the review rules: who may review, which answers, the range, the reason,
  all-or-nothing rejection, restoring the automatic mark;
- the totals (final = auto + teacher, teacher = net change, negative when
  a mark is lowered) and the status (FINALISED once reviewed, back to
  AUTO_FINALISED when every review is withdrawn, PENDING_REVIEW while a
  written answer is still unmarked);
- the Method Marks list and count, the audit rows, and what the student
  sees.
"""
import json

from app.models import AttemptAnswer, AuditLog, Evaluation, Question
from app.services import learning_service
from tests.test_learning import (
    _add_question,
    _assign_teacher_section,
    _login,
    _make_chapter_with_skills,
    _make_school,
    _make_sectioned_student,
    _make_teacher,
    _publish,
)
from tests.test_practice_tracker import _assign, _target

# Distinct "CHnn" numbers, clear of test_learning.py (1-27) and
# test_practice_tracker.py (61-69).
_CH = {"MM1": 71, "MM2": 72, "MM3": 73, "MM4": 74}


def _q(db, code: str) -> Question:
    return db.query(Question).filter(Question.code == code).first()


def _activity(db, suffix: str, *, constructed: bool = False):
    """Q1 Numeric Entry, 3 marks, key 12. Q2 Single Select, 2 marks, key A.
    Q3 Numeric Entry, 1 mark, key 5. With constructed=True, Q4 Constructed
    Response, 2 marks."""
    chapter, (skill,) = _make_chapter_with_skills(db, suffix, n_skills=1)
    code = f"CH{_CH[suffix]:02d}-P01"
    _add_question(db, skill, f"{suffix}-Q1", assignment_code=code, question_type="Numeric Entry", correct_answer="12", marks=3)
    _add_question(db, skill, f"{suffix}-Q2", assignment_code=code, correct_answer="A", marks=2)
    _add_question(db, skill, f"{suffix}-Q3", assignment_code=code, question_type="Numeric Entry", correct_answer="5", marks=1)
    if constructed:
        _add_question(
            db, skill, f"{suffix}-Q4", assignment_code=code, question_type="Constructed Response",
            correct_answer="Model answer", marks=2, auto_gradable=False,
        )
    db.commit()
    [activity] = learning_service.generate_activities_for_chapter(db, chapter, created_by_user_id=None)
    _publish(db, activity)
    return activity, chapter


def _setup(db, suffix, *, constructed=False):
    activity, chapter = _activity(db, suffix, constructed=constructed)
    school = _make_school(db, suffix.lower())
    teacher = _make_teacher(db, school, suffix.lower())
    student = _make_sectioned_student(db, school, f"{suffix.lower()}-a", class_name="5", section="A")
    _assign_teacher_section(db, teacher, chapter.board_course_id, "A")
    assignment = _assign(db, school, activity, teacher.user_id)
    return school, teacher, student, assignment


# --- which questions take working ----------------------------------------------


def test_accepts_working_only_on_auto_marked_numeric_entry_worth_two_or_more():
    def q(**kw):
        base = {"question_type": "Numeric Entry", "marks": 2, "auto_gradable": True}
        return Question(**{**base, **kw})

    assert learning_service.accepts_working(q()) is True
    assert learning_service.accepts_working(q(marks=3)) is True
    assert learning_service.accepts_working(q(marks=1)) is False
    assert learning_service.accepts_working(q(question_type="Single Select")) is False
    assert learning_service.accepts_working(q(question_type="Text Entry")) is False
    assert learning_service.accepts_working(q(question_type="Constructed Response", auto_gradable=False)) is False
    assert learning_service.accepts_working(q(auto_gradable=False)) is False


def test_working_is_saved_kept_cleared_limited_and_resumed(client, db_session):
    _, _, student, assignment = _setup(db_session, "MM1")
    q1, q2, q3 = (_q(db_session, f"MM1-Q{i}") for i in (1, 2, 3))
    headers = _login(client, student.user.email)

    started = client.post("/api/learning/attempts", json={"assignmentTargetId": _target(db_session, assignment, student).id}, headers=headers)
    assert started.status_code == 200, started.text
    attempt = started.json()
    flags = {q["id"]: q["acceptsWorking"] for q in attempt["questions"]}
    assert flags == {q1.id: True, q2.id: False, q3.id: False}
    url = f"/api/learning/attempts/{attempt['id']}/answers"

    def saved(question):
        db_session.expire_all()
        return (
            db_session.query(AttemptAnswer)
            .filter(AttemptAnswer.attempt_id == attempt["id"], AttemptAnswer.question_id == question.id)
            .first()
        )

    assert client.put(url, json={"questionId": q1.id, "responseText": "11", "workingText": "  3 x 4 = 11\r\n  "}, headers=headers).status_code == 200
    assert saved(q1).working_text == "3 x 4 = 11"
    # The answer alone (no workingText field) keeps the working.
    assert client.put(url, json={"questionId": q1.id, "responseText": "13"}, headers=headers).status_code == 200
    assert (saved(q1).response_text, saved(q1).working_text) == ("13", "3 x 4 = 11")
    # Working for a question that takes none is ignored.
    assert client.put(url, json={"questionId": q2.id, "responseText": "A", "workingText": "guess"}, headers=headers).status_code == 200
    assert saved(q2).working_text is None
    # Too long: refused with a readable message; nothing changes.
    long = client.put(url, json={"questionId": q1.id, "responseText": "12", "workingText": "x" * 2001}, headers=headers)
    assert long.status_code == 422
    assert "2000" in long.json()["detail"]["message"]
    assert (saved(q1).response_text, saved(q1).working_text) == ("13", "3 x 4 = 11")

    # Resume echoes the working back.
    resumed = client.post("/api/learning/attempts", json={"assignmentTargetId": attempt["assignmentTargetId"]}, headers=headers).json()
    assert {q["id"]: q["workingText"] for q in resumed["questions"]}[q1.id] == "3 x 4 = 11"

    # An empty working clears it.
    assert client.put(url, json={"questionId": q1.id, "responseText": "13", "workingText": "   "}, headers=headers).status_code == 200
    assert saved(q1).working_text is None


# --- the review --------------------------------------------------------------------


def _submit(db, suffix, assignment, student, *, q1="13", working="3 x 4 = 13", q2="A", q3="5"):
    target = _target(db, assignment, student)
    attempt = learning_service.start_attempt(db, student, target.id)
    learning_service.save_answer(db, student, attempt.id, _q(db, f"{suffix}-Q1").id, q1, working, working_sent=True)
    learning_service.save_answer(db, student, attempt.id, _q(db, f"{suffix}-Q2").id, q2)
    learning_service.save_answer(db, student, attempt.id, _q(db, f"{suffix}-Q3").id, q3)
    if _q(db, f"{suffix}-Q4"):
        learning_service.save_answer(db, student, attempt.id, _q(db, f"{suffix}-Q4").id, "Written answer")
    learning_service.submit_attempt(db, student, attempt.id)
    db.refresh(attempt)
    return attempt


def test_method_marks_review_end_to_end(client, db_session):
    _, teacher, student, assignment = _setup(db_session, "MM2")
    attempt = _submit(db_session, "MM2", assignment, student)
    q1, q2, q3 = (_q(db_session, f"MM2-Q{i}") for i in (1, 2, 3))

    evaluation = db_session.query(Evaluation).filter(Evaluation.attempt_id == attempt.id).first()
    # Q1 wrong (0 of 3), Q2 right (2), Q3 right (1): 3 of 6, marked automatically.
    assert (evaluation.review_status, evaluation.auto_score, evaluation.final_score, evaluation.max_score) == (
        "AUTO_FINALISED", 3, 3, 6,
    )

    headers = _login(client, teacher.user.email)
    overview = client.get("/api/learning/tracker/overview", headers=headers).json()["counts"]
    assert (overview["methodMarks"], overview["needsReview"]) == (1, 0)
    [listed] = client.get("/api/learning/tracker/method-marks", headers=headers).json()["items"]
    assert (listed["attemptId"], listed["answersToReview"]) == (attempt.id, 1)

    review = client.get(f"/api/learning/tracker/attempts/{attempt.id}", headers=headers).json()
    by_id = {a["questionId"]: a for a in review["answers"]}
    assert by_id[q1.id]["workingText"] == "3 x 4 = 13"
    assert [by_id[q.id]["canReviewMarks"] for q in (q1, q2, q3)] == [True, True, False]
    assert [by_id[q.id]["awaitsMethodMarks"] for q in (q1, q2, q3)] == [True, False, False]

    url = f"/api/learning/tracker/attempts/{attempt.id}/mark-reviews"

    def post(*reviews):
        return client.post(
            url,
            json={"reviews": [{"questionId": q, "score": s, "reason": r} for q, s, r in reviews]},
            headers=headers,
        )

    # Rejections, all-or-nothing.
    no_reason = post((q1.id, 2, None))
    assert no_reason.status_code == 422 and no_reason.json()["detail"]["code"] == "REASON_REQUIRED"
    assert post((q1.id, 2, "   ")).json()["detail"]["code"] == "REASON_REQUIRED"
    one_mark = post((q3.id, 0, "Careless"))
    assert one_mark.status_code == 422 and one_mark.json()["detail"]["code"] == "NOT_REVIEWABLE"
    over = post((q1.id, 4, "Too many"))
    assert over.status_code == 422 and over.json()["detail"]["code"] == "SCORE_OUT_OF_RANGE"
    assert post((q1.id, -1, "Negative")).status_code == 422
    assert post((q1.id, 2, "x" * 201)).status_code == 422
    mixed = post((q1.id, 2, "Method right"), (q3.id, 0, "No"))
    assert mixed.status_code == 422
    assert post((q1.id, 2, "a"), (q1.id, 1, "b")).status_code == 422
    assert post(("not-a-question", 1, "x")).status_code == 422
    assert client.post(url, json={"reviews": []}, headers=headers).status_code == 422
    db_session.expire_all()
    assert db_session.query(AttemptAnswer).filter(
        AttemptAnswer.attempt_id == attempt.id, AttemptAnswer.manual_score.isnot(None)
    ).count() == 0

    # Method marks: 2 of 3 for the working. Final 5 of 6; the machine's 3 kept.
    awarded = post((q1.id, 2, "  Method right; slip in the last step.  "))
    assert awarded.status_code == 200, awarded.text
    body = awarded.json()
    ev = body["evaluation"]
    assert (ev["reviewStatus"], ev["autoScore"], ev["teacherScore"], ev["finalScore"]) == ("FINALISED", 3, 2, 5)
    assert ev["finalisedByName"] == teacher.user.full_name
    a1 = {a["questionId"]: a for a in body["answers"]}[q1.id]
    assert (a1["autoScore"], a1["manualScore"], a1["isCorrect"], a1["reviewReason"], a1["awaitsMethodMarks"]) == (
        0, 2, False, "Method right; slip in the last step.", False,
    )
    assert a1["gradedByName"] == teacher.user.full_name
    assert client.get("/api/learning/tracker/method-marks", headers=headers).json()["total"] == 0
    assert client.get("/api/learning/tracker/overview", headers=headers).json()["counts"]["methodMarks"] == 0

    # Lowering a full-marks answer: the net teacher change can be negative.
    lowered = post((q2.id, 1, "Right option, but the reason given was wrong.")).json()["evaluation"]
    assert (lowered["teacherScore"], lowered["finalScore"]) == (1, 4)

    # Keeping the automatic mark needs no reason.
    kept = post((q2.id, 2, None))
    assert kept.status_code == 200 and kept.json()["evaluation"]["finalScore"] == 5

    # The student reads the teacher's mark and reason beside the machine's.
    client.cookies.clear()
    student_headers = _login(client, student.user.email)
    result = client.get(f"/api/learning/attempts/{attempt.id}/result", headers=student_headers).json()
    assert (result["reviewStatus"], result["finalScore"]) == ("FINALISED", 5)
    r1 = {a["questionId"]: a for a in result["answers"]}[q1.id]
    assert (r1["autoScore"], r1["manualScore"], r1["reviewedByTeacher"], r1["reviewReason"], r1["workingText"]) == (
        0, 2, True, "Method right; slip in the last step.", "3 x 4 = 13",
    )
    r3 = {a["questionId"]: a for a in result["answers"]}[q3.id]
    assert (r3["reviewedByTeacher"], r3["reviewReason"]) == (False, None)

    # Restoring every review: back to the machine's marks, AUTO_FINALISED.
    client.cookies.clear()
    headers = _login(client, teacher.user.email)
    restored = post((q1.id, None, "ignored"), (q2.id, None, None)).json()
    assert (restored["evaluation"]["reviewStatus"], restored["evaluation"]["teacherScore"], restored["evaluation"]["finalScore"]) == (
        "AUTO_FINALISED", None, 3,
    )
    assert restored["evaluation"]["finalisedByName"] is None
    b1 = {a["questionId"]: a for a in restored["answers"]}[q1.id]
    assert (b1["manualScore"], b1["reviewReason"], b1["gradedByName"], b1["isCorrect"], b1["awaitsMethodMarks"]) == (
        None, None, None, False, True,
    )
    assert client.get("/api/learning/tracker/method-marks", headers=headers).json()["total"] == 1

    # Audit: one row per request that changed something.
    details = [
        json.loads(a.event_data_json)
        for a in db_session.query(AuditLog)
        .filter(AuditLog.event_type == "learning.attempt.marks_reviewed", AuditLog.user_id == teacher.user_id)
        .order_by(AuditLog.created_at)
        .all()
    ]
    assert len(details) == 4
    assert details[0]["reviews"] == [
        {"questionId": q1.id, "previousScore": None, "score": 2, "autoScore": 0, "maxScore": 3,
         "reason": "Method right; slip in the last step."},
    ]
    assert (details[0]["reviewStatusBefore"], details[0]["reviewStatusAfter"]) == ("AUTO_FINALISED", "FINALISED")
    assert (details[-1]["reviewStatusBefore"], details[-1]["reviewStatusAfter"]) == ("FINALISED", "AUTO_FINALISED")


def test_review_and_written_marks_add_up_and_pending_waits_for_the_written_answer(client, db_session):
    _, teacher, student, assignment = _setup(db_session, "MM3", constructed=True)
    attempt = _submit(db_session, "MM3", assignment, student)
    q1, q4 = _q(db_session, "MM3-Q1"), _q(db_session, "MM3-Q4")
    headers = _login(client, teacher.user.email)

    reviewed = client.post(
        f"/api/learning/tracker/attempts/{attempt.id}/mark-reviews",
        json={"reviews": [{"questionId": q1.id, "score": 1, "reason": "Correct first step."}]},
        headers=headers,
    ).json()
    # The written answer is still unmarked: still pending, provisional total.
    assert (reviewed["evaluation"]["reviewStatus"], reviewed["evaluation"]["finalScore"]) == ("PENDING_REVIEW", 4)
    assert reviewed["attempt"]["status"] == "SUBMITTED"

    graded = client.post(
        f"/api/learning/tracker/attempts/{attempt.id}/grades",
        json={"grades": [{"questionId": q4.id, "score": 2}]},
        headers=headers,
    ).json()
    ev = graded["evaluation"]
    # auto 3 + (1 - 0) for the review + 2 for the written answer = 6 of 8.
    assert (ev["reviewStatus"], ev["autoScore"], ev["teacherScore"], ev["finalScore"], ev["maxScore"]) == (
        "FINALISED", 3, 3, 6, 8,
    )
    assert graded["attempt"]["status"] == "EVALUATED"

    # A written answer still can't be reviewed as if auto-marked, and an
    # auto-marked one still can't be marked through /grades.
    bad = client.post(
        f"/api/learning/tracker/attempts/{attempt.id}/mark-reviews",
        json={"reviews": [{"questionId": q4.id, "score": 1, "reason": "x"}]},
        headers=headers,
    )
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "NOT_REVIEWABLE"
    bad = client.post(
        f"/api/learning/tracker/attempts/{attempt.id}/grades",
        json={"grades": [{"questionId": q1.id, "score": 2}]},
        headers=headers,
    )
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "NOT_MANUALLY_GRADABLE"


def test_only_the_sections_teacher_may_review(client, db_session):
    school, _, student, assignment = _setup(db_session, "MM4")
    attempt = _submit(db_session, "MM4", assignment, student)
    q1 = _q(db_session, "MM4-Q1")
    stranger = _make_teacher(db_session, school, "mm4-other")
    headers = _login(client, stranger.user.email)
    response = client.post(
        f"/api/learning/tracker/attempts/{attempt.id}/mark-reviews",
        json={"reviews": [{"questionId": q1.id, "score": 2, "reason": "x"}]},
        headers=headers,
    )
    assert response.status_code in (403, 404)
    assert client.get("/api/learning/tracker/method-marks", headers=headers).json()["total"] == 0
    # A student can't reach the endpoint at all.
    client.cookies.clear()
    student_headers = _login(client, student.user.email)
    assert client.post(
        f"/api/learning/tracker/attempts/{attempt.id}/mark-reviews",
        json={"reviews": [{"questionId": q1.id, "score": 2, "reason": "x"}]},
        headers=student_headers,
    ).status_code in (401, 403)
