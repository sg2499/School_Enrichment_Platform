"""Class Analytics (#186, 26 Oct 2026).

Rules under test: the grid for a practice set reads each student's first
handed-in attempt (or the latest, when asked); cells say correct, partial,
wrong, blank or waiting for marks; a misconception counts for a student who
missed 2+ of the questions testing it; the report offers the skill's
Remediation set; a student's own practice is left out; a teacher sees only
their own sections and another school's admin sees nothing.
"""
from app.models import AssignmentTarget, MisconceptionReview, SchoolCurriculumMap
from app.services import analytics_service, learning_service
from app.services.practice_access_service import resolve_viewer
from tests import test_learning
from tests.test_learning import (
    _ac,
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

test_learning._CHAPTER_NUM.update({"CA1": 151, "CA2": 152})


def _world(db, sx="CA1", reviewed=True):
    chapter, (s1, s2) = _make_chapter_with_skills(db, sx, n_skills=2)
    qs = []
    for i in range(3):
        q = _add_question(db, s1, f"{sx}-Q{i}", assignment_code=_ac(sx, "P01"))
        q.misconception_tag = "Adds the denominators."
        qs.append(q)
    q4 = _add_question(db, s1, f"{sx}-Q3", assignment_code=_ac(sx, "P01"), question_type="Numeric Entry", correct_answer="10", marks=2)
    q4.misconception_tag = "Adds the denominators."
    qs.append(q4)
    w = _add_question(db, s1, f"{sx}-W", assignment_code=_ac(sx, "P01"), question_type="Constructed Response", correct_answer="Because.", auto_gradable=False)
    w.misconception_tag = "Explains without the rule."
    qs.append(w)
    rem = _add_question(db, s1, f"{sx}-R1", assignment_code=_ac(sx, "REM-S01"))
    rem.misconception_tag = "Adds the denominators."
    if reviewed:
        db.add(MisconceptionReview(
            concept_lesson_id=s1.id, tag_key=analytics_service.tag_key("Adds the denominators."), status="APPROVED",
            shown_note="Adds the denominators.", next_step="Shade both fractions on one strip.",
        ))
    db.commit()
    activities = learning_service.generate_activities_for_chapter(db, chapter, created_by_user_id=None)
    for a in activities:
        _publish(db, a)
    core = next(a for a in activities if a.activity_type == "CORE_PRACTICE")
    remediation = next(a for a in activities if a.activity_type == "REMEDIATION")
    school = _make_school(db, sx.lower())
    db.add(SchoolCurriculumMap(school_id=school.id, board_course_id=chapter.board_course_id, chapter_id=chapter.id, class_name="5"))
    teacher = _make_teacher(db, school, sx.lower())
    _assign_teacher_section(db, teacher, chapter.board_course_id, "A")
    other_teacher = _make_teacher(db, school, f"{sx.lower()}-b")
    _assign_teacher_section(db, other_teacher, chapter.board_course_id, "B")
    students = [_make_sectioned_student(db, school, f"{sx.lower()}-{i}", class_name="5", section="A") for i in range(3)]
    db.commit()
    assignment = learning_service.create_assignment(
        db, school=school, learning_activity=core, assigned_by_user_id=teacher.user_id, class_name="5", section="A",
    )
    return {"chapter": chapter, "qs": qs, "core": core, "remediation": remediation, "school": school,
            "teacher": teacher, "other_teacher": other_teacher, "students": students, "assignment": assignment}


def _do(db, student, target_id, answers):
    attempt = learning_service.start_attempt(db, student, target_id)
    for q, text in answers.items():
        learning_service.save_answer(db, student, attempt.id, q.id, text)
    learning_service.submit_attempt(db, student, attempt.id)


def test_grid_misconceptions_and_access(client, db_session):
    w = _world(db_session)
    a, b, c = w["students"]
    q1, q2, q3, q4, wr = w["qs"]
    target = {t.student_id: t for t in db_session.query(AssignmentTarget).filter_by(assignment_id=w["assignment"].id)}
    # a: first attempt misses q1, q2, q4 (blank), writes an answer; then all right.
    _do(db_session, a, target[a.id].id, {q1: "B", q2: "B", q3: "A", wr: "My reason"})
    _do(db_session, a, target[a.id].id, {q1: "A", q2: "A", q3: "A", q4: "10"})
    # b: misses only q1 (one slip). c: never hands in.
    _do(db_session, b, target[b.id].id, {q1: "B", q2: "A", q3: "A", q4: "10"})

    scope = f"{w['assignment'].class_level_id}|A|{w['assignment'].board_course_id}"
    headers = {**_login(client, w["teacher"].user.email), "x-auth-role": "TEACHER"}

    sections = client.get("/api/learning/analytics/sections", headers=headers).json()["sections"]
    assert [s["key"] for s in sections] == [scope]

    sets = client.get("/api/learning/analytics/sets", params={"scope": scope}, headers=headers).json()
    assert [(s["learningActivityId"], s["students"], s["handedIn"]) for s in sets["sets"]] == [(w["core"].id, 3, 2)]
    assert [c_["id"] for c_ in sets["chapters"]] == [w["chapter"].id]

    grid = client.get(f"/api/learning/analytics/sets/{w['core'].id}", params={"scope": scope}, headers=headers).json()
    rows = {s["studentCode"]: s for s in grid["students"]}
    states = lambda code: [cell["state"] if cell else None for cell in rows[code]["cells"]]
    assert states(a.student_code) == ["WRONG", "WRONG", "CORRECT", "BLANK", "PENDING"]
    # A written answer, even left blank, waits for the teacher's mark.
    assert states(b.student_code) == ["WRONG", "CORRECT", "CORRECT", "CORRECT", "PENDING"]
    assert rows[c.student_code]["handedIn"] is False and states(c.student_code) == [None] * 5
    assert grid["questions"][0]["percentCorrect"] == 0.0 and grid["questions"][1]["percentCorrect"] == 50.0
    latest = client.get(
        f"/api/learning/analytics/sets/{w['core'].id}", params={"scope": scope, "attempt": "latest"}, headers=headers
    ).json()
    assert [cell["state"] for cell in {s["studentCode"]: s for s in latest["students"]}[a.student_code]["cells"][:4]] == ["CORRECT"] * 4

    report = client.get(
        f"/api/learning/analytics/chapters/{w['chapter'].id}/misconceptions", params={"scope": scope}, headers=headers
    ).json()
    top = report["misconceptions"][0]
    assert top["misconception"] == "Adds the denominators." and top["nextStep"] == "Shade both fractions on one strip."
    assert report["awaitingReview"] == 0
    assert [s["studentCode"] for s in top["students"]] == [a.student_code]  # b's one slip isn't a pattern
    assert top["students"][0]["missed"] == 3 and top["studentsAnswered"] == 2
    assert top["practiceSet"]["learningActivityId"] == w["remediation"].id
    later = client.get(
        f"/api/learning/analytics/chapters/{w['chapter'].id}/misconceptions",
        params={"scope": scope, "attempt": "latest"},
        headers=headers,
    ).json()
    assert all(not m["students"] for m in later["misconceptions"])

    # A student's own practice isn't counted.
    own = learning_service.create_assignment(
        db_session, school=w["school"], learning_activity=w["remediation"], assigned_by_user_id=b.user_id,
        student_ids=[b.id], reason="SELF_PRACTICE", section_scope=(w["assignment"].class_level_id, "A", w["assignment"].board_course_id),
    )
    viewer = resolve_viewer(db_session, w["teacher"].user)
    sets_after = analytics_service.practice_sets(db_session, viewer, analytics_service.parse_scope(scope))
    assert [s["learningActivityId"] for s in sets_after["sets"]] == [w["core"].id] and own.id

    # Another section's teacher and another school's admin see nothing.
    other = {**_login(client, w["other_teacher"].user.email), "x-auth-role": "TEACHER"}
    assert client.get("/api/learning/analytics/sets", params={"scope": scope}, headers=other).status_code == 404
    stranger = _make_school_admin(db_session, _make_school(db_session, "ca1-x"), "ca1-x")
    db_session.commit()
    admin_headers = {**_login(client, stranger.email), "x-auth-role": "ADMIN"}
    assert client.get("/api/learning/analytics/sets", params={"scope": scope}, headers=admin_headers).status_code == 404
    assert client.get("/api/learning/analytics/sets", params={"scope": "nonsense"}, headers=headers).status_code == 422


def test_review_fixes(client, db_session):
    """#186 review: one mistake however its note is spelled; a moved student
    stays in the report but can't be given practice in this section; a
    mistake tested by one question isn't judged; the Super Admin is refused;
    every answer says which section it is for."""
    import pytest
    from fastapi import HTTPException

    from tests.test_learning import _make_super_admin

    w = _world(db_session, "CA2")
    a, b, c = w["students"]
    q1, q2, q3, q4, wr = w["qs"]
    q2.misconception_tag = "  adds the DENOMINATORS "  # same mistake, spelled differently
    db_session.commit()
    target = {t.student_id: t for t in db_session.query(AssignmentTarget).filter_by(assignment_id=w["assignment"].id)}
    _do(db_session, a, target[a.id].id, {q1: "B", q2: "B", q3: "A", q4: "10"})
    _do(db_session, b, target[b.id].id, {q1: "B", q2: "B", q3: "B", q4: "10"})
    # b moves to 5B.
    b.section = "B"
    db_session.commit()

    viewer = resolve_viewer(db_session, w["teacher"].user)
    scope = analytics_service.parse_scope(f"{w['assignment'].class_level_id}|A|{w['assignment'].board_course_id}")
    report = analytics_service.misconceptions(db_session, viewer, scope, w["chapter"].id, "first")
    assert report["scope"] == scope.key
    tags = [m["misconception"] for m in report["misconceptions"]]
    assert len(tags) == 1  # the spellings are one mistake; the written one (1 question) isn't judged
    flagged = {s["studentCode"]: s["inSection"] for s in report["misconceptions"][0]["students"]}
    assert flagged == {a.student_code: True, b.student_code: False}
    assert analytics_service.tag_key("Adds the denominators.") == analytics_service.tag_key("adds  the denominators")

    grid = analytics_service.set_grid(db_session, viewer, scope, w["core"].id, "first")
    assert grid["scope"] == scope.key and grid["questions"][2]["percentCorrect"] == 50.0

    sup = resolve_viewer(db_session, _make_super_admin(db_session, "ca1-sup"))
    with pytest.raises(HTTPException) as refused:
        analytics_service.sections(db_session, sup)
    assert refused.value.status_code == 403


def test_notes_wait_for_review(db_session):
    """Ashalatha, Q14 (26 Oct 2026): a misconception note reaches the
    dashboard only once she has approved it, in her wording; until then it
    is counted as waiting; one she turned down is neither shown nor counted."""
    test_learning._CHAPTER_NUM.update({"CA3": 153})
    w = _world(db_session, "CA3", reviewed=False)
    a, _b, _c = w["students"]
    q1, q2, q3, q4, _wr = w["qs"]
    target = {t.student_id: t for t in db_session.query(AssignmentTarget).filter_by(assignment_id=w["assignment"].id)}
    _do(db_session, a, target[a.id].id, {q1: "B", q2: "B", q3: "A", q4: "10"})
    viewer = resolve_viewer(db_session, w["teacher"].user)
    scope = analytics_service.parse_scope(f"{w['assignment'].class_level_id}|A|{w['assignment'].board_course_id}")
    skill_id = q1.concept_lesson_id

    report = analytics_service.misconceptions(db_session, viewer, scope, w["chapter"].id, "first")
    assert report["misconceptions"] == [] and (report["awaitingReview"], report["heldForReview"]) == (1, 1)
    # On the latest attempt nobody shows it: held back, but not "waiting".
    grid = analytics_service.set_grid(db_session, viewer, scope, w["core"].id, "first")
    assert all(q["misconception"] is None for q in grid["questions"])

    review = MisconceptionReview(
        concept_lesson_id=skill_id, tag_key=analytics_service.tag_key(q1.misconception_tag), status="APPROVED",
        shown_note="Adds the denominators as well as the numerators.", next_step="Use fraction strips.",
    )
    db_session.add(review)
    db_session.commit()
    report = analytics_service.misconceptions(db_session, viewer, scope, w["chapter"].id, "first")
    assert [(m["misconception"], m["nextStep"]) for m in report["misconceptions"]] == [
        ("Adds the denominators as well as the numerators.", "Use fraction strips.")
    ]
    assert report["awaitingReview"] == 0
    grid = analytics_service.set_grid(db_session, viewer, scope, w["core"].id, "first")
    assert grid["questions"][0]["misconception"] == "Adds the denominators as well as the numerators."

    # Reviewed note changed by a re-import: the new wording waits again.
    q1.misconception_tag = "Adds the tops and the bottoms."
    db_session.commit()
    grid = analytics_service.set_grid(db_session, viewer, scope, w["core"].id, "first")
    assert grid["questions"][0]["misconception"] is None and grid["questions"][1]["misconception"]

    review.status = "REJECTED"
    db_session.commit()
    report = analytics_service.misconceptions(db_session, viewer, scope, w["chapter"].id, "first")
    assert report["misconceptions"] == [] and report["awaitingReview"] == 0
