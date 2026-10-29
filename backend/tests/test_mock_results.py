"""Mock paper results outside the paper (#207, 28 Oct 2026).

Rules under test: nothing counts before the student hands in; from then
(#208: no release step) the student's My Progress lists the paper and its
answers count in the skill map like practice answers; a teacher sees the
same list for papers they can read (another section's teacher does not);
the weekly report lists papers handed in that week, and only those; Class
Analytics counts the section's mock answers towards its misconceptions.
"""
from datetime import timedelta

from app.models import ConceptLesson, MisconceptionReview, Question
from app.models.papers import MockPaperAnswer, MockPaperSitting
from app.services import analytics_service, mock_results_service, progress_service, weekly_report_service
from app.services import mock_sitting_service as sit
from app.services.analytics_service import tag_key
from app.services.practice_access_service import resolve_viewer
from tests.test_mock_papers import NOW, _world
from tests.test_mock_sittings import T0, T1, _items, _paper

NUMBERS = {
    "name": "Numbers", "timeMinutes": 30, "readingMinutes": 5, "difficulty": None, "applicationMin": None,
    "sections": [{"name": "A", "marks": 1, "count": 10, "kind": "NUMBER"}],
}


def _sit_all_wrong_but_one(db, paper, student):
    view = sit.start(db, student, paper.id, now=T1)
    parts = [p[2] for p in _items(db, view)]
    writing = T1 + timedelta(minutes=6)
    keys = {q.id: q for q in db.query(Question).filter(Question.id.in_([p["id"] for p in parts]))}
    for i, part in enumerate(parts):
        sit.save_answer(db, student, paper.id, part["id"], keys[part["id"]].correct_answer if i == 0 else "999999", now=writing)
    sit.submit(db, student, paper.id, now=writing + timedelta(minutes=1))
    db.commit()
    return [keys[p["id"]] for p in parts]


def test_handed_in_results_reach_progress_reports_and_analytics(db_session):
    db = db_session
    w = _world(db, "MKR1", students=2)
    paper, teacher = _paper(db, w, NUMBERS)
    a, b = w["students"]
    # While sitting: nothing outside the paper.
    sit.start(db, a, paper.id, now=T1)
    db.commit()
    assert progress_service.progress_payload(db, a, for_student=True)["mockPapers"] == []
    assert progress_service.skill_scores(db, a) == {}
    assert mock_results_service.answers(db, [a.id]) == []

    questions = _sit_all_wrong_but_one(db, paper, a)

    mine = progress_service.progress_payload(db, a, for_student=True)
    assert [(m["title"], m["score"], m["maxScore"], m["percent"]) for m in mine["mockPapers"]] == [("Practice", 1, 10, 10.0)]
    scores = progress_service.skill_scores(db, a)
    assert sum(s.answered for s in scores.values()) == 10
    assert sum(s.earned for s in scores.values()) == 1 and sum(s.possible for s in scores.values()) == 10
    # B never sat: no paper, no scores.
    assert progress_service.progress_payload(db, b, for_student=True)["mockPapers"] == []

    # The section's teacher sees the paper on the student's skills; the other
    # section's teacher (who can't read this section's work) does not.
    own = resolve_viewer(db, w["teacher"].user)
    seen = progress_service.progress_payload(
        db, a, assignment_clause=None, mock_clause=mock_results_service.readable_papers_clause(own), for_student=False
    )
    assert len(seen["mockPapers"]) == 1
    other = resolve_viewer(db, w["other"].user)
    hidden = progress_service.progress_payload(
        db, a, assignment_clause=None, mock_clause=mock_results_service.readable_papers_clause(other), for_student=False
    )
    assert hidden["mockPapers"] == [] and hidden["summary"]["overallPercent"] is None

    # The weekly report: the hand-in week lists it; the week before doesn't.
    sitting = db.query(MockPaperSitting).filter_by(paper_id=paper.id, student_id=a.id).one()
    handed_day = mock_results_service._aware(sitting.submitted_at).astimezone(weekly_report_service.SCHOOL_TIMEZONE).date()
    week = weekly_report_service.monday_of(handed_day)
    from app.models import ClassLevel

    class_level = db.query(ClassLevel).filter(ClassLevel.code == "5").first()
    page = weekly_report_service.build(db, school=w["school"], class_level=class_level, section="A", week_start=week, students=[a])[0]
    assert [m["title"] for m in page["mockPapers"]] == ["Practice"]
    earlier = weekly_report_service.build(
        db, school=w["school"], class_level=class_level, section="A", week_start=week - timedelta(days=7), students=[a]
    )[0]
    assert earlier["mockPapers"] == []
    from app.services import weekly_report_pdf

    assert weekly_report_pdf.render([page]).startswith(b"%PDF")

    # Class Analytics: a mistake tested by 2+ of A's (wrong) questions shows
    # once its note is approved. A balanced paper rarely asks one skill
    # twice, so two of A's wrong questions are made to test the same mistake.
    q1, q2 = questions[1], questions[2]
    q2.concept_lesson_id = q1.concept_lesson_id
    q1.misconception_tag = q2.misconception_tag = "Adds the place values instead of the digits."
    db.commit()
    by_tag: dict[tuple, list] = {}
    for q in questions[1:]:
        by_tag.setdefault((q.concept_lesson_id, tag_key(q.misconception_tag)), []).append(q)
    repeated = [k for k, qs in by_tag.items() if len(qs) >= 2 and k[1]]
    for skill_id, key in {(q.concept_lesson_id, tag_key(q.misconception_tag)) for q in questions if q.misconception_tag}:
        db.add(MisconceptionReview(concept_lesson_id=skill_id, tag_key=key, status="APPROVED", shown_note=f"Note {key[:20]}"))
    db.commit()
    scope = analytics_service.parse_scope(w["scope"])
    shown = analytics_service.misconceptions(db, own, scope, w["chapter"].id, analytics_service.FIRST)
    flagged = {(m["skill"]["id"], m["misconception"]) for m in shown["misconceptions"] if any(s["id"] == a.id for s in m["students"])}
    assert repeated and len(flagged) == len(repeated)


def test_an_unchosen_or_unmarked_answer_never_counts(db_session):
    db = db_session
    w = _world(db, "MKR2", students=1)
    paper, teacher = _paper(db, w, NUMBERS)
    (a,) = w["students"]
    _sit_all_wrong_but_one(db, paper, a)
    sitting = db.query(MockPaperSitting).filter_by(paper_id=paper.id, student_id=a.id).one()
    first, second = db.query(MockPaperAnswer).filter_by(sitting_id=sitting.id).limit(2).all()
    first.counted = False
    second.auto_score = None
    db.commit()
    assert len(mock_results_service.answers(db, [a.id])) == 8
    assert len(mock_results_service.answers(db, [a.id], before=sitting.submitted_at)) == 0


def test_one_long_answer_alone_never_flags_a_mistake(db_session):
    """A long answer's (or case study's) steps are one question for Class
    Analytics: a student who misses two steps of one long answer, and gets
    another question testing the same mistake right, has missed one of two
    questions, which doesn't flag them (#208 review)."""
    from app.models.papers import QuestionPattern

    db = db_session
    w = _world(db, "MKR3", students=1)
    fmt = {"name": "Steps", "timeMinutes": 30, "readingMinutes": 0, "difficulty": None, "applicationMin": None,
           "sections": [{"name": "A", "marks": 3, "count": 1, "kind": "WRITTEN"},
                        {"name": "B", "marks": 1, "count": 1, "kind": "NUMBER"}]}
    paper, teacher = _paper(db, w, fmt)
    (a,) = w["students"]
    view = sit.start(db, a, paper.id, now=T1)
    long_parts = [p for sec in view["sections"][:1] for place in sec["places"] for h in place["halves"] for p in h["parts"]]
    (number,) = [p for sec in view["sections"][1:] for place in sec["places"] for h in place["halves"] for p in h["parts"]]
    assert len(long_parts) >= 2
    qs = {q.id: q for q in db.query(Question).filter(Question.id.in_([p["id"] for p in long_parts] + [number["id"]]))}
    tag = qs[long_parts[0]["id"]].misconception_tag
    # The number question tests the same mistake.
    qs[number["id"]].misconception_tag = tag
    qs[number["id"]].concept_lesson_id = qs[long_parts[0]["id"]].concept_lesson_id
    db.commit()
    writing = T1 + timedelta(minutes=1)
    for part in long_parts[:2]:
        sit.save_answer(db, a, paper.id, part["id"], "999999", now=writing)
    for part in long_parts[2:]:
        sit.save_answer(db, a, paper.id, part["id"], qs[part["id"]].correct_answer, now=writing)
    sit.save_answer(db, a, paper.id, number["id"], qs[number["id"]].correct_answer, now=writing)
    sit.submit(db, a, paper.id, now=writing + timedelta(minutes=1))
    db.add(MisconceptionReview(concept_lesson_id=qs[number["id"]].concept_lesson_id, tag_key=tag_key(tag), status="APPROVED",
                               shown_note="Note"))
    db.commit()
    own = resolve_viewer(db, w["teacher"].user)
    shown = analytics_service.misconceptions(db, own, analytics_service.parse_scope(w["scope"]), w["chapter"].id,
                                             analytics_service.FIRST)
    flagged = [m for m in shown["misconceptions"] if any(s["id"] == a.id for s in m["students"])]
    assert flagged == [], flagged
