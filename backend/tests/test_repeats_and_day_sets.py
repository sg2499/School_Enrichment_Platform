"""Repeated questions and the five-day sets (#234, 18 Nov 2026).

A repeat (same chapter, wording, options and answer) is flagged, kept in the
bank, and left out of practice sets and bulk approval. The L..-D..A-E codes
of the ICSE-style content become chapter-wide sets by day.
"""
from app.models import LearningActivity, LearningActivityQuestion, Question
from app.services import learning_service, repeat_service
from app.services.question_quality_service import run_quality_checks
from tests.test_learning import _make_chapter_with_skills


def _q(db, lesson, code, stem, answer="4", assignment=None, **kw):
    q = Question(concept_lesson_id=lesson.id, code=code, assignment_code=assignment, question_type="Numeric Entry",
                 stem=stem, correct_answer=answer, marks=1, auto_gradable=True, status="DRAFT", **kw)
    db.add(q)
    db.flush()
    return q


def test_a_repeat_is_found_within_a_chapter_and_the_first_by_code_is_kept(db_session):
    chapter, (s1, s2) = _make_chapter_with_skills(db_session, "rep1")
    a = _q(db_session, s1, "R1-001", "What is 2 + 2?")
    b = _q(db_session, s2, "R1-002", "  what is 2 +  2? ")  # case and spacing ignored, other skill
    c = _q(db_session, s1, "R1-003", "What is 2 + 2?", answer="5")  # different answer: not a repeat
    d = _q(db_session, s1, "R1-004", "What is 3 + 3?", answer="6")
    db_session.commit()

    report = repeat_service.process_chapter(db_session, chapter, apply=False)
    assert report.repeats == 1 and report.pairs == [("R1-002", "R1-001")]
    assert b.repeat_of_id is None  # a dry run writes nothing

    repeat_service.process_chapter(db_session, chapter, apply=True)
    db_session.commit()
    assert (a.repeat_of_id, b.repeat_of_id, c.repeat_of_id, d.repeat_of_id) == (None, a.id, None, None)

    # Run again: nothing changes. Change the wording: the flag clears.
    again = repeat_service.process_chapter(db_session, chapter, apply=True)
    assert again.newly_flagged == 0 and again.cleared == 0
    b.stem = "What is 4 + 0?"
    repeat_service.process_chapter(db_session, chapter, apply=True)
    assert b.repeat_of_id is None


def test_same_stem_with_different_options_is_not_a_repeat(db_session):
    _chapter, (s1,) = _make_chapter_with_skills(db_session, "rep2", n_skills=1)
    a = _q(db_session, s1, "R2-001", "Which number is greatest?", option_a="1", option_b="2")
    b = _q(db_session, s1, "R2-002", "Which number is greatest?", option_a="7", option_b="9")
    db_session.commit()
    assert repeat_service.find_repeats([a, b]) == {}


def test_a_repeat_is_not_held_back_as_a_duplicate_and_the_kept_copy_is_not_flagged(db_session):
    chapter, (s1,) = _make_chapter_with_skills(db_session, "rep3", n_skills=1)
    a = _q(db_session, s1, "R3-001", "What is 2 + 2?")
    b = _q(db_session, s1, "R3-002", "What is 2 + 2?")
    db_session.commit()
    assert run_quality_checks([a, b])[a.id].status == "FLAGGED"  # before the scan, as before
    repeat_service.process_chapter(db_session, chapter, apply=True)
    results = run_quality_checks([a, b])
    assert "Duplicate" not in " ".join(results[a.id].flags + results[b.id].flags)


def test_day_sets_are_chapter_wide_by_day_and_leave_repeats_out(db_session):
    chapter, (s1, s2) = _make_chapter_with_skills(db_session, "rep4")
    kept = _q(db_session, s1, "R4-001", "What is 2 + 2?", assignment="L01-D1A")
    _q(db_session, s2, "R4-002", "What is 5 + 5?", answer="10", assignment="L01-D1A")
    repeat = _q(db_session, s2, "R4-003", "What is 2 + 2?", assignment="L01-D2B")  # repeat, in another set
    _q(db_session, s1, "R4-004", "What is 6 + 6?", answer="12", assignment="L01-D2B")
    for day in (3, 4, 5):
        _q(db_session, s1, f"R4-00{day + 2}", f"What is {day} + 1?", answer=str(day + 1), assignment=f"L01-D{day}A")
    db_session.commit()
    repeat_service.process_chapter(db_session, chapter, apply=True)
    db_session.commit()
    assert repeat.repeat_of_id == kept.id

    created = learning_service.generate_activities_for_chapter(db_session, chapter, created_by_user_id=None)
    by_code = {a.source_assignment_code: a for a in created}
    assert set(by_code) == {"L01-D1A", "L01-D2B", "L01-D3A", "L01-D4A", "L01-D5A"}
    assert [by_code[c].activity_type for c in ("L01-D1A", "L01-D2B", "L01-D3A", "L01-D4A", "L01-D5A")] == [
        "PREREQUISITE_CHECK", "CORE_PRACTICE", "FLUENCY", "APPLICATION", "CHALLENGE"]
    assert all(a.concept_lesson_id is None for a in created)  # the chapter's, across every skill
    assert [by_code[c].pacing_day for c in ("L01-D1A", "L01-D2B", "L01-D5A")] == [1, 2, 5]
    assert by_code["L01-D2B"].title == f"{chapter.title} — Guided Practice B"
    assert [a.sequence for a in sorted(created, key=lambda a: a.sequence)] == sorted(a.sequence for a in created)
    # D1A holds both skills' questions; the repeat is not in D2B.
    d1 = learning_service._activity_question_ids(db_session, by_code["L01-D1A"].id)
    assert len(d1) == 2
    d2 = learning_service._activity_question_ids(db_session, by_code["L01-D2B"].id)
    assert repeat.id not in d2 and len(d2) == 1
    assert db_session.query(LearningActivityQuestion).join(Question).filter(Question.repeat_of_id.isnot(None)).count() == 0
    assert db_session.query(LearningActivity).filter(LearningActivity.chapter_id == chapter.id).count() == 5


def test_fresh_questions_are_added_to_an_existing_set_unless_it_is_live_and_assigned(db_session):
    from app.models import Assignment
    from tests.test_learning import _make_school

    chapter, (s1, s2) = _make_chapter_with_skills(db_session, "top1")
    _q(db_session, s1, "T1-001", "What is 2 + 2?", assignment="L01-D1A")
    _q(db_session, s2, "T1-002", "What is 5 + 5?", answer="10", assignment="L01-D1A")
    _q(db_session, s1, "T1-003", "What is 6 + 6?", answer="12", assignment="L01-D2A")
    db_session.commit()
    created = learning_service.generate_activities_for_chapter(db_session, chapter, created_by_user_id=None)
    sets = {a.source_assignment_code: a for a in created}
    assert len(learning_service._activity_question_ids(db_session, sets["L01-D2A"].id)) == 1

    # Fresh replacements arrive later, for the second skill (new codes).
    fresh_a = _q(db_session, s2, "T1-501", "What is 7 + 7?", answer="14", assignment="L01-D2A")
    fresh_b = _q(db_session, s2, "T1-502", "What is 9 + 9?", answer="18", assignment="L01-D1A")
    db_session.commit()
    sets["L01-D1A"].status = "PUBLISHED"  # live, but nobody has been given it
    sets["L01-D2A"].status = "PUBLISHED"
    db_session.add(Assignment(school_id=_make_school(db_session, "top1").id, learning_activity_id=sets["L01-D2A"].id, class_name="5"))
    db_session.commit()

    again = learning_service.generate_activities_for_chapter(db_session, chapter, created_by_user_id=None)
    assert again == []  # nothing new is made
    d1 = learning_service._activity_question_ids(db_session, sets["L01-D1A"].id)
    assert fresh_b.id in d1 and len(d1) == 3
    d2 = learning_service._activity_question_ids(db_session, sets["L01-D2A"].id)
    assert fresh_a.id not in d2 and len(d2) == 1  # published and assigned: left as it is
    # In skill order: skill 1's question, then skill 2's two.
    codes = [q.code for q in db_session.query(Question).filter(Question.id.in_(d1)).all()]
    ordered = [r.question_id for r in db_session.query(LearningActivityQuestion).filter(
        LearningActivityQuestion.learning_activity_id == sets["L01-D1A"].id).order_by(LearningActivityQuestion.sequence).all()]
    by_id = {q.id: q.code for q in db_session.query(Question).filter(Question.id.in_(ordered)).all()}
    assert [by_id[i] for i in ordered] == ["T1-001", "T1-002", "T1-502"] and sorted(codes) == sorted(by_id.values())
    assert sets["L01-D1A"].estimated_minutes == 6


def test_the_old_cbse_codes_still_classify_as_before():
    assert learning_service.classify_assignment_code("CH01-P01") == ("CORE_PRACTICE", False)
    assert learning_service.classify_assignment_code("CH01-MASTERY") == ("CHAPTER_MASTERY", True)
    assert learning_service.classify_assignment_code("L01-D3C") == ("FLUENCY", True)
    assert learning_service.classify_assignment_code("L01-D6A") == (None, False)
    assert learning_service.classify_assignment_code("L01-D1F") == (None, False)


def _as_super_admin(client, db, suffix):
    from tests.test_learning import _login, _make_super_admin
    admin = _make_super_admin(db, suffix)
    db.commit()
    return {**_login(client, admin.email), "x-auth-role": "SUPER_ADMIN"}


def test_the_repeats_list_scan_and_bulk_approval_over_the_api(client, db_session):
    chapter, (s1, s2) = _make_chapter_with_skills(db_session, "rep5")
    a = _q(db_session, s1, "R5-001", "What is 2 + 2?")
    b = _q(db_session, s2, "R5-002", "What is 2 + 2?")
    c = _q(db_session, s1, "R5-003", "What is 9 + 9?", answer="18")
    db_session.commit()
    headers = _as_super_admin(client, db_session, "rep5")

    scan = client.post(f"/api/curriculum-admin/chapters/{chapter.id}/repeats/scan", headers=headers)
    assert scan.status_code == 200, scan.text
    body = scan.json()
    assert body["count"] == 1 and body["repeats"][0]["code"] == "R5-002" and body["repeats"][0]["keptCode"] == "R5-001"
    assert client.get(f"/api/curriculum-admin/chapters/{chapter.id}/repeats", headers=headers).json()["count"] == 1

    lesson = client.get(f"/api/curriculum-admin/concept-lessons/{s2.id}/questions", headers=headers).json()
    assert lesson["questions"][0]["repeatOfId"] == a.id

    approval = client.post(f"/api/curriculum-admin/chapters/{chapter.id}/questions/bulk-approve",
                           json={"includeUnverified": True}, headers=headers)
    assert approval.status_code == 200, approval.text
    assert approval.json()["skippedRepeatsCount"] == 1
    db_session.expire_all()
    assert (a.status, b.status, c.status) == ("APPROVED", "DRAFT", "APPROVED")


def test_a_measure_in_two_units_is_marked_right_however_it_is_spaced():
    from app.services import learning_service as ls
    q = Question(question_type="Text Entry", stem="Express 14911 m as kilometres and metres.",
                 correct_answer="14 km 911 m", marks=1, auto_gradable=True)
    for ok in ("14 km 911 m", "14km 911m", "14 km 911m", "14 kilometres 911 metres", "14 km and 911 m", "14 Km, 911 M"):
        assert ls.grade_answer(q, ok) == (True, 1), ok
    for bad in ("14 km 912 m", "911 m 14 km", "14.911 km", "14 km", "14 km 911", "about 14 km 911 m", "14 kg 911 g"):
        assert ls.grade_answer(q, bad)[0] is False, bad
    plain = Question(question_type="Text Entry", stem="Name it.", correct_answer="triangle", marks=1, auto_gradable=True)
    assert ls.grade_answer(plain, "triangle")[0] is True and ls.grade_answer(plain, "square")[0] is False
