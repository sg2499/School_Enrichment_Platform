"""The Assessment Scheme (#165, 23 Oct 2026).

PHASE4_ASSESSMENT_SCHEME_DESIGN.md, approved by Shailesh with all six
decisions as recommended: paper marks are entered by teachers; the Best
attempt counts by default; the school's own Admin publishes; Absent counts
0 and Exempt spreads its weight; CBSE- and ICSE-style templates stay drafts
until checked; half marks on entered marks.

Proves:
- the result: weights, rounding half up, the grade and pass decided on the
  figure shown, Absent, Exempt, missing marks (Provisional), a component's
  own minimum, 1 decimal place; and that every result reconciles with its
  components worked out by hand (the roadmap's Phase 4 exit gate);
- platform components: Best, First and Latest; a set still being marked
  makes the result Provisional; a set never given to a student is left
  out; a set given and not done is missing;
- what a scheme must pass before publishing, and that only one scheme per
  class, subject and year is published;
- a new version: marks carry over by component, the old one is kept;
- marks entry: ranges, half marks, Absent/Exempt, a reason to change a
  saved mark, all or nothing;
- who may do what: School Admin, Super Admin, Teacher (current and past
  sections), another school; templates; audit rows.
"""
import json
import random
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.models import (
    AcademicYear,
    AssessmentScheme,
    AuditLog,
    ComponentMark,
    Evaluation,
    Question,
)
from app.services import assessment_service as service
from app.services import learning_service
from app.services.assessment_service import (
    BandInput,
    ComponentInput,
    MarkEntry,
    SchemeError,
    SchemeInput,
)
from tests.test_learning import (
    _add_question,
    _assign_teacher_section,
    _login,
    _make_chapter_with_skills,
    _make_school,
    _make_school_admin,
    _make_sectioned_student,
    _make_super_admin,
    _make_teacher,
    _publish,
)
from tests.test_practice_tracker import _assign, _target

# Distinct "CHnn" numbers, clear of the other test files (1-33, 61-74).
_CH = {f"AS{n}": 80 + n for n in range(1, 17)}

BANDS = [("A1", "91"), ("A2", "81"), ("B1", "71"), ("B2", "61"), ("C1", "51"), ("C2", "41"), ("D", "33"), ("E", "0")]


def _component(name, max_marks, weight, *, source="ENTERED", minimum=None, activity_ids=None, kind="OTHER"):
    return ComponentInput(
        name=name, kind=kind, term="WHOLE_YEAR", source=source, max_marks=max_marks, weight_percent=weight,
        min_pass_percent=minimum, activity_ids=activity_ids or [],
    )


def _input(components, *, name="Maths 2026-27", pass_percent="33", places=0, rule="BEST", bands=BANDS):
    return SchemeInput(
        name=name, attempt_rule=rule, pass_percent=pass_percent, pass_label="Pass", fail_label="Needs Improvement",
        decimal_places=places, components=components, grade_bands=[BandInput(label, m) for label, m in bands],
    )


def _year(db, school):
    today = date.today()
    start = today - timedelta(days=100)
    year = AcademicYear(
        school_id=school.id, label=f"{start.year}-{(start.year + 1) % 100:02d}", start_date=start,
        end_date=start + timedelta(days=364), is_current=True,
    )
    db.add(year)
    db.commit()
    return year


def _world(db, suffix, *, questions=None):
    """A school, its year, a Class 5 course with one published practice set,
    a teacher of section A, and students A1, A2 (section A) and B1 (B)."""
    chapter, (skill,) = _make_chapter_with_skills(db, suffix, n_skills=1)
    code = f"CH{_CH[suffix]:02d}-P01"
    for q in questions or [("Q1", "Single Select", "A", 2, True), ("Q2", "Numeric Entry", "5", 2, True)]:
        _add_question(
            db, skill, f"{suffix}-{q[0]}", assignment_code=code, question_type=q[1], correct_answer=q[2], marks=q[3],
            auto_gradable=q[4],
        )
    db.commit()
    [activity] = learning_service.generate_activities_for_chapter(db, chapter, created_by_user_id=None)
    _publish(db, activity)
    school = _make_school(db, suffix.lower())
    year = _year(db, school)
    teacher = _make_teacher(db, school, suffix.lower())
    _assign_teacher_section(db, teacher, chapter.board_course_id, "A")
    students = {
        "A1": _make_sectioned_student(db, school, f"{suffix.lower()}-a1", class_name="5", section="A"),
        "A2": _make_sectioned_student(db, school, f"{suffix.lower()}-a2", class_name="5", section="A"),
        "B1": _make_sectioned_student(db, school, f"{suffix.lower()}-b1", class_name="5", section="B"),
    }
    return {
        "school": school, "year": year, "teacher": teacher, "students": students, "activity": activity,
        "course_id": chapter.board_course_id, "suffix": suffix,
    }


def _scheme(db, w, components, **kwargs) -> AssessmentScheme:
    from app.models import BoardCourse

    course = db.get(BoardCourse, w["course_id"])
    scheme = service.new_scheme(
        db, user_id=None, school_id=w["school"].id, is_template=False, academic_year_id=w["year"].id,
        class_level_id=course.class_level_id, board_course_id=course.id,
        cleaned=service.clean_scheme_input(_input(components, **kwargs)),
    )
    db.commit()
    return scheme


def _published(db, w, components, **kwargs) -> AssessmentScheme:
    scheme = _scheme(db, w, components, **kwargs)
    service.publish(db, scheme, user_id=None)
    db.commit()
    return scheme


def _enter(db, scheme, name, marks_by_student, *, reason=None):
    component = next(c for c in scheme.components if c.name == name)
    entries = []
    for student, value in marks_by_student.items():
        status = value if value in ("ABSENT", "EXEMPT") else ("ENTERED" if value is not None else None)
        entries.append(MarkEntry(student.id, status, None if status != "ENTERED" else str(value), reason))
    service.save_marks(db, component, entries, allowed_student_ids={s.id for s in marks_by_student}, user_id=None)
    db.commit()


def _result(db, scheme, student):
    (result,) = service.results(db, scheme, [student.id])
    return result


# --- the result ------------------------------------------------------------------


def test_weights_rounding_grade_and_pass(db_session):
    w = _world(db_session, "AS1")
    a1, a2, b1 = w["students"]["A1"], w["students"]["A2"], w["students"]["B1"]
    scheme = _published(
        db_session, w,
        [_component("Periodic Test", "20", "20"), _component("Half-Yearly", "40", "30"), _component("Annual", "80", "50")],
    )
    # 18/20 = 90%, 36/40 = 90%, 73/80 = 91.25%: 0.2*90 + 0.3*90 + 0.5*91.25 = 90.625 -> 91 -> A1.
    _enter(db_session, scheme, "Periodic Test", {a1: "18", a2: "8", b1: "17.5"})
    _enter(db_session, scheme, "Half-Yearly", {a1: "36", a2: "12", b1: "ABSENT"})
    _enter(db_session, scheme, "Annual", {a1: "73", a2: "22", b1: "EXEMPT"})

    r = _result(db_session, scheme, a1)
    assert r.unrounded == Decimal("90.625") and r.shown == Decimal(91)
    assert (r.grade, r.passed, r.provisional) == ("A1", True, False)

    # 0.2*40 + 0.3*30 + 0.5*27.5 = 30.75 -> 31: E, below the pass mark of 33.
    r = _result(db_session, scheme, a2)
    assert (r.shown, r.grade, r.passed) == (Decimal(31), "E", False)

    # Half marks (17.5/20 = 87.5%); Absent counts 0; Exempt leaves Annual
    # out, so 20 and 30 count in proportion: (0.2*87.5 + 0.3*0) / 0.5 = 35.
    r = _result(db_session, scheme, b1)
    assert (r.shown, r.grade, r.passed, r.provisional) == (Decimal(35), "D", True, False)
    assert [c.status for c in r.components] == ["MARKS", "ABSENT", "EXEMPT"]
    assert r.notes == ["Exempt from one component; the others count in proportion."]


def test_the_grade_follows_the_figure_shown_and_a_five_rounds_up(db_session):
    w = _world(db_session, "AS2")
    a1, a2, b1 = w["students"]["A1"], w["students"]["A2"], w["students"]["B1"]
    scheme = _published(db_session, w, [_component("Annual", "200", "100")])
    _enter(db_session, scheme, "Annual", {a1: "181", a2: "180.99", b1: "65.5"})
    assert (_result(db_session, scheme, a1).shown, _result(db_session, scheme, a1).grade) == (Decimal(91), "A1")  # 90.5
    assert (_result(db_session, scheme, a2).shown, _result(db_session, scheme, a2).grade) == (Decimal(90), "A2")  # 90.495
    assert _result(db_session, scheme, b1).shown == Decimal(33)  # 32.75 shown as 33: a pass
    assert _result(db_session, scheme, b1).passed is True


def test_one_decimal_place_and_a_components_own_minimum(db_session):
    w = _world(db_session, "AS3")
    a1, a2, b1 = w["students"]["A1"], w["students"]["A2"], w["students"]["B1"]
    scheme = _published(
        db_session, w,
        [_component("Internal", "20", "20"), _component("Theory", "80", "80", minimum="33")],
        places=1,
    )
    _enter(db_session, scheme, "Internal", {a1: "20", a2: "20", b1: "20"})
    _enter(db_session, scheme, "Theory", {a1: "26", a2: "27", b1: None})
    # A1: theory 32.5% is under its own 33%, so below the pass mark although
    # the subject's 0.2*100 + 0.8*32.5 = 46.0 is above 33.
    r = _result(db_session, scheme, a1)
    assert (r.shown, r.passed) == (Decimal("46.0"), False)
    assert [c.meets_own_minimum for c in r.components] == [None, False]
    r = _result(db_session, scheme, a2)  # 33.75% -> 33.8 >= 33
    assert (r.shown, r.passed) == (Decimal("47.0"), True)
    # B1 has no theory mark yet: Provisional, worked out on what there is.
    r = _result(db_session, scheme, b1)
    assert r.provisional is True and r.shown == Decimal("100.0") and r.components[1].status == "MISSING"


def test_every_result_reconciles_with_its_components_by_hand(db_session):
    w = _world(db_session, "AS4")
    students = list(w["students"].values())
    components = [_component(f"C{i}", m, wt) for i, (m, wt) in enumerate([("10", "7.5"), ("25", "12.5"), ("50", "30"), ("80", "50")])]
    scheme = _published(db_session, w, components, places=1)
    rng = random.Random(165)
    for _round in range(25):
        chosen = {}
        for component in scheme.components:
            row = {}
            for student in students:
                pick = rng.random()
                row[student] = "ABSENT" if pick < 0.08 else "EXEMPT" if pick < 0.14 else str(
                    Decimal(rng.randint(0, int(Decimal(component.max_marks)) * 2)) / 2
                )
            chosen[component.name] = row
            _enter(db_session, scheme, component.name, row, reason="Re-entered for the check")
        for student in students:
            num = den = Decimal(0)
            for component in scheme.components:
                value = chosen[component.name][student]
                if value == "EXEMPT":
                    continue
                percent = Decimal(0) if value == "ABSENT" else Decimal(value) / Decimal(component.max_marks) * 100
                num += percent * Decimal(component.weight_percent)
                den += Decimal(component.weight_percent)
            r = _result(db_session, scheme, student)
            if den == 0:
                assert r.shown is None
                continue
            assert r.unrounded == num / den
            assert r.shown == service.round_half_up(num / den, 1)
            assert r.grade == service.grade_for(scheme, r.shown)


# --- platform components -----------------------------------------------------------


def _submit(db, w, student, assignment, *, q1, q2):
    target = _target(db, assignment, student)
    attempt = learning_service.start_attempt(db, student, target.id)
    s = w["suffix"]
    for code, answer in ((f"{s}-Q1", q1), (f"{s}-Q2", q2)):
        question = db.query(Question).filter(Question.code == code).first()
        if question is not None:
            learning_service.save_answer(db, student, attempt.id, question.id, answer)
    learning_service.submit_attempt(db, student, attempt.id)
    db.refresh(attempt)
    return attempt


def test_platform_marks_best_first_latest_and_who_has_none(db_session):
    w = _world(db_session, "AS5")
    a1, a2, b1 = w["students"]["A1"], w["students"]["A2"], w["students"]["B1"]
    assignment = _assign(db_session, w["school"], w["activity"], w["teacher"].user_id, section="A")
    _submit(db_session, w, a1, assignment, q1="A", q2="9")  # 2 of 4
    _submit(db_session, w, a1, assignment, q1="A", q2="5")  # 4 of 4
    _submit(db_session, w, a1, assignment, q1="B", q2="9")  # 0 of 4
    platform = [_component("Practice", "10", "100", source="PLATFORM", activity_ids=[w["activity"].id])]

    scheme = _published(db_session, w, platform, rule="BEST")
    r = _result(db_session, scheme, a1)
    assert (r.components[0].percent, r.components[0].marks, r.shown) == (Decimal(100), Decimal(10), Decimal(100))
    for rule, expected in (("FIRST", Decimal(50)), ("LATEST", Decimal(0))):
        scheme.attempt_rule = rule
        db_session.commit()
        assert _result(db_session, scheme, a1).shown == expected
    # A2 was given the set and has not done it: missing, so Provisional and
    # no result yet. B1 (section B) was never given it: left out, as Exempt
    # is, so it does not hold up a report card (#188 review).
    r = _result(db_session, scheme, a2)
    assert (r.components[0].status, r.provisional, r.shown) == ("MISSING", True, None)
    r = _result(db_session, scheme, b1)
    assert (r.components[0].status, r.provisional, r.notes) == (
        "EXEMPT", False, ['No practice sets for "Practice" were given; it is left out.', "No result: every component is left out."]
    )


def test_a_set_still_being_marked_makes_the_result_provisional(db_session):
    w = _world(db_session, "AS6", questions=[
        ("Q1", "Single Select", "A", 2, True),
        ("Q2", "Constructed Response", "Model answer", 2, False),
    ])
    a1 = w["students"]["A1"]
    assignment = _assign(db_session, w["school"], w["activity"], w["teacher"].user_id, section="A")
    attempt = _submit(db_session, w, a1, assignment, q1="A", q2="My answer")
    evaluation = db_session.query(Evaluation).filter(Evaluation.attempt_id == attempt.id).one()
    assert evaluation.review_status == "PENDING_REVIEW"
    scheme = _published(
        db_session, w, [_component("Practice", "4", "100", source="PLATFORM", activity_ids=[w["activity"].id])]
    )
    r = _result(db_session, scheme, a1)
    assert r.provisional is True and r.components[0].pending_review is True
    # A teacher's Absent overrides a platform component.
    _enter(db_session, scheme, "Practice", {a1: "ABSENT"})
    r = _result(db_session, scheme, a1)
    assert (r.components[0].status, r.shown, r.provisional) == ("ABSENT", Decimal(0), False)


# --- typing a scheme in, publishing, versions ------------------------------------------------


def test_what_is_typed_is_checked_all_at_once():
    bad = _input(
        [
            _component("", "0", "0"),
            ComponentInput("Same", "NOPE", "TERM_3", "SOMEWHERE", "10.555", "101", "x", []),
            _component("same", "10", "10", activity_ids=["a1"]),
        ],
        pass_percent="133",
        bands=[("A", "90"), ("a", "-1")],
    )
    with pytest.raises(SchemeError) as caught:
        service.clean_scheme_input(bad)
    problems = caught.value.problems
    assert "The pass mark must be a percentage from 0 to 100, with at most 2 decimal places." in problems
    assert "Component 1: give it a name." in problems
    assert "\"Same\": choose what kind of assessment it is." in problems
    assert "\"Same\": choose Term 1, Term 2 or Whole Year." in problems
    assert any("maximum marks" in p for p in problems)
    assert "Component 3: another component is already called \"same\"." in problems
    assert "\"same\": practice sets can only be linked when its marks come from the platform." in problems
    assert "Grade 2: another grade is already called a." in problems


def test_publishing_checks_and_one_published_scheme_per_class_subject_and_year(db_session):
    w = _world(db_session, "AS7")
    _published(db_session, w, [_component("Annual", "80", "100")], name="The published one")
    draft = _scheme(db_session, w, [_component("Annual", "80", "60")], bands=[("A", "50"), ("B", "50")])
    problems = service.publish_problems(db_session, draft)
    assert "The weights add up to 60%; they must add up to exactly 100%." in problems
    assert "Two grades start at the same percentage." in problems
    with pytest.raises(SchemeError):
        service.publish(db_session, draft, user_id=None)
    db_session.rollback()

    service.write_scheme(db_session, draft, service.clean_scheme_input(
        _input([_component("Annual", "80", "100", source="PLATFORM")], bands=[("A", "50"), ("B", "10")])
    ))
    problems = service.publish_problems(db_session, draft)
    assert problems == [
        "\"Annual\": link at least one practice set, or have teachers enter its marks.",
        "The lowest grade must start at 0%, so every result gets a grade.",
    ]
    db_session.rollback()

    # Another lineage for the same class, subject and year is refused.
    other = _scheme(db_session, w, [_component("Annual", "80", "100")], name="Another")
    [problem] = service.publish_problems(db_session, other)
    assert problem.startswith("\"The published one\" is already the published scheme")
    assert problem.endswith("is already the published scheme for this class, subject and year. Make a new version of it instead.")
    db_session.delete(other)
    db_session.commit()


def test_a_new_version_carries_marks_over_and_keeps_the_old_one(db_session):
    w = _world(db_session, "AS8")
    a1 = w["students"]["A1"]
    old = _published(db_session, w, [_component("Annual", "200", "100")])
    _enter(db_session, old, "Annual", {a1: "181"})
    new = service.copy_scheme(
        db_session, old, user_id=None, school_id=old.school_id, academic_year_id=old.academic_year_id,
        class_level_id=old.class_level_id, board_course_id=old.board_course_id, as_new_version=True,
    )
    db_session.commit()
    assert (new.version, new.status, new.lineage_id) == (2, "DRAFT", old.lineage_id)
    with pytest.raises(SchemeError, match="Version 2 of this scheme already exists"):
        service.copy_scheme(
            db_session, old, user_id=None, school_id=old.school_id, academic_year_id=old.academic_year_id,
            class_level_id=old.class_level_id, board_course_id=old.board_course_id, as_new_version=True,
        )
    annual = new.components[0]
    service.write_scheme(db_session, new, service.clean_scheme_input(_input([
        ComponentInput("Annual", "ANNUAL", "WHOLE_YEAR", "ENTERED", "200", "80", None, [], annual.component_key),
        _component("Project", "20", "20"),
    ])))
    db_session.commit()
    with pytest.raises(SchemeError, match="Marks can only be entered on a published scheme"):
        _enter(db_session, new, "Project", {a1: "10"})
    db_session.rollback()
    outcome = service.publish(db_session, new, user_id=None)
    db_session.commit()
    assert outcome.replaced.id == old.id and old.status == "SUPERSEDED" and new.status == "PUBLISHED"
    assert (outcome.marks_carried, outcome.marks_dropped) == (1, [])
    # A1's 181 of 200 came across; Project has no marks yet: Provisional.
    r = _result(db_session, new, a1)
    assert (r.components[0].marks, r.components[1].status, r.provisional) == (Decimal(181), "MISSING", True)
    # The old version still gives the old result.
    assert _result(db_session, old, a1).shown == Decimal(91)


# --- entering marks -----------------------------------------------------------------------


def test_marks_entry_rules(db_session):
    w = _world(db_session, "AS9")
    a1, a2, b1 = w["students"]["A1"], w["students"]["A2"], w["students"]["B1"]
    scheme = _published(db_session, w, [_component("Internal", "20", "20"), _component("Theory", "80", "80")])
    _enter(db_session, scheme, "Internal", {a1: "20", a2: "20"})
    internal = next(c for c in scheme.components if c.name == "Internal")
    allowed = {a1.id, a2.id}

    def save(entries):
        return service.save_marks(db_session, internal, entries, allowed_student_ids=allowed, user_id=None)

    for value in ("21", "-1", "10.125", "ten"):
        with pytest.raises(SchemeError, match="Marks must be from 0 to 20, with at most 2 decimal places"):
            save([MarkEntry(a1.id, "ENTERED", value, None)])
        db_session.rollback()
    with pytest.raises(SchemeError, match="not in a section you can enter marks for"):
        save([MarkEntry(b1.id, "ENTERED", "5", None)])
    db_session.rollback()
    # A1 and A2 already have 20: changing needs a reason,
    # and one bad entry saves nothing.
    with pytest.raises(SchemeError, match="Give a reason for changing a mark that was already saved"):
        save([MarkEntry(a1.id, "ENTERED", "19.5", "Recount"), MarkEntry(a2.id, "ENTERED", "18", None)])
    db_session.rollback()
    assert db_session.query(ComponentMark).filter_by(component_id=internal.id, student_id=a1.id).one().marks == "20"
    changes = save([MarkEntry(a1.id, "ENTERED", "19.50", "Recount"), MarkEntry(a2.id, "ENTERED", "20", None)])
    db_session.commit()
    assert [(c.old, c.new) for c in changes] == [(("ENTERED", "20"), ("ENTERED", "19.5"))]  # A2 unchanged: skipped
    changes = save([MarkEntry(a2.id, None, None, "Entered by mistake")])
    db_session.commit()
    assert changes[0].new == (None, None)
    assert db_session.query(ComponentMark).filter_by(component_id=internal.id, student_id=a2.id).first() is None


# --- the API: who may do what -------------------------------------------------------------


class _Person:
    """One signed-in user with their own test client. Each role has its own
    session cookie, and an admin's two-factor code cannot be used twice in
    the same 30 seconds, so every person signs in once, on a client of
    their own (the app's test database override applies to all of them)."""

    def __init__(self, email: str):
        from fastapi.testclient import TestClient

        from app.main import app

        self.client = TestClient(app)
        self.headers = _login(self.client, email)

    def get(self, url, **kw):
        return self.client.get(url, headers=self.headers, **kw)

    def post(self, url, **kw):
        return self.client.post(url, headers=self.headers, **kw)

    def put(self, url, **kw):
        return self.client.put(url, headers=self.headers, **kw)

    def delete(self, url, **kw):
        return self.client.delete(url, headers=self.headers, **kw)


def _api_world(db, suffix):
    w = _world(db, suffix)
    w["admin"] = _make_school_admin(db, w["school"], suffix.lower())
    return w


def test_school_admin_builds_publishes_and_teacher_enters_marks(client, db_session):
    w = _api_world(db_session, "AS10")
    a1 = w["students"]["A1"]
    admin = _Person(w["admin"].email)
    teacher = _Person(w["teacher"].user.email)

    years = admin.get("/api/assessment/years").json()["years"]
    assert [y["label"] for y in years] == [w["year"].label]
    created = admin.post("/api/assessment/schemes", json={"academicYearId": w["year"].id, "boardCourseId": w["course_id"]})
    assert created.status_code == 200, created.text
    draft = created.json()
    assert draft["status"] == "DRAFT" and draft["canManage"] is True
    assert "Add at least one component." in draft["publishProblems"]

    body = {
        "name": "Mathematics, Class 5", "attemptRule": "BEST", "passPercent": "33", "passLabel": "Pass",
        "failLabel": "Needs Improvement", "decimalPlaces": 0,
        "components": [
            {"name": "Half-Yearly", "kind": "HALF_YEARLY", "term": "TERM_1", "source": "ENTERED", "maxMarks": "80", "weightPercent": "40"},
            {"name": "Practice", "kind": "PLATFORM_PRACTICE", "term": "WHOLE_YEAR", "source": "PLATFORM", "maxMarks": "20",
             "weightPercent": "60", "activityIds": [w["activity"].id]},
        ],
        "gradeBands": [{"label": label, "minPercent": m} for label, m in BANDS],
    }
    saved = admin.put(f"/api/assessment/schemes/{draft['id']}", json=body)
    assert saved.status_code == 200, saved.text
    assert saved.json()["publishProblems"] == []
    assert saved.json()["components"][1]["activities"] == [{"id": w["activity"].id, "title": w["activity"].title}]
    bad = admin.put(f"/api/assessment/schemes/{draft['id']}", json={**body, "decimalPlaces": 3})
    assert bad.status_code == 422 and bad.json()["detail"]["message"] == "Show the result to 0 or 1 decimal places."
    linkable = admin.get(f"/api/assessment/schemes/{draft['id']}/activities").json()["activities"]
    assert [a["id"] for a in linkable] == [w["activity"].id]

    # A teacher sees nothing until it is published.
    assert teacher.get(f"/api/assessment/schemes/{draft['id']}").status_code == 404
    assert teacher.get("/api/assessment/schemes").json() == {"schemes": []}
    published = admin.post(f"/api/assessment/schemes/{draft['id']}/publish")
    assert published.status_code == 200 and published.json()["status"] == "PUBLISHED"
    again = admin.put(f"/api/assessment/schemes/{draft['id']}", json=body)
    assert again.status_code == 422 and "Make a new version" in again.json()["detail"]["message"]
    assert admin.delete(f"/api/assessment/schemes/{draft['id']}").status_code == 409

    listed = teacher.get("/api/assessment/schemes").json()["schemes"]
    assert [s["id"] for s in listed] == [draft["id"]]
    detail = teacher.get(f"/api/assessment/schemes/{draft['id']}").json()
    assert detail["canManage"] is False
    assert teacher.put(f"/api/assessment/schemes/{draft['id']}", json=body).status_code == 403
    assert teacher.post(f"/api/assessment/schemes/{draft['id']}/publish").status_code == 403
    assert teacher.get(f"/api/assessment/schemes/{draft['id']}/sections").json() == {
        "sections": [{"section": "A", "canEnterMarks": True}]
    }
    assert admin.get(f"/api/assessment/schemes/{draft['id']}/sections").json() == {
        "sections": [{"section": "A", "canEnterMarks": True}, {"section": "B", "canEnterMarks": True}]
    }
    half = detail["components"][0]["id"]
    marks_url = f"/api/assessment/schemes/{draft['id']}/components/{half}/marks"
    sheet = teacher.get(marks_url, params={"section": "A"}).json()
    assert [r["studentCode"] for r in sheet["rows"]] == ["STU-as10-a1", "STU-as10-a2"] and sheet["canEnterMarks"] is True
    assert teacher.get(marks_url, params={"section": "B"}).status_code == 404
    saved = teacher.put(marks_url, json={"section": "A", "entries": [
        {"studentId": a1.id, "status": "ENTERED", "marks": 60.5},
        {"studentId": w["students"]["A2"].id, "status": "ABSENT"},
    ]})
    assert saved.status_code == 200 and saved.json() == {"saved": 2}
    refused = teacher.put(marks_url, json={"section": "A", "entries": [{"studentId": a1.id, "status": "ENTERED", "marks": "61"}]})
    assert refused.status_code == 422
    assert refused.json()["detail"]["message"] == "Give a reason for changing a mark that was already saved."
    other_section = teacher.put(marks_url, json={"section": "A", "entries": [
        {"studentId": w["students"]["B1"].id, "status": "ABSENT"},
    ]})
    assert other_section.status_code == 422

    results = teacher.get(f"/api/assessment/schemes/{draft['id']}/results", params={"section": "A"}).json()
    row = results["rows"][0]
    # Half-yearly 60.5/80 = 75.625%; the practice set was never given to A1,
    # so it is left out (#188 review): 75.625 -> 76, B1 (71 to 80).
    assert (row["result"], row["unrounded"], row["grade"], row["outcomeLabel"], row["provisional"]) == (
        "76", "75.625", "B1", "Pass", False
    )
    assert [c["status"] for c in row["components"]] == ["MARKS", "EXEMPT"]
    assert results["rows"][1]["result"] == "0" and results["rows"][1]["outcome"] == "BELOW_PASS"

    # A new version, made by the admin, starts as a draft the teacher cannot see.
    version = admin.post(f"/api/assessment/schemes/{draft['id']}/new-version")
    assert version.status_code == 200 and version.json()["version"] == 2
    assert teacher.get(f"/api/assessment/schemes/{version.json()['id']}").status_code == 404
    assert admin.get(f"/api/assessment/schemes/{draft['id']}").json()["newerVersion"]["version"] == 2

    events = [e.event_type for e in db_session.query(AuditLog).filter(AuditLog.event_type.like("assessment.%")).all()]
    for expected in (
        "assessment.scheme.created", "assessment.scheme.updated", "assessment.scheme.published",
        "assessment.marks.saved", "assessment.scheme.new_version",
    ):
        assert expected in events
    saved_event = (
        db_session.query(AuditLog).filter(AuditLog.event_type == "assessment.marks.saved").order_by(AuditLog.id).all()[-1]
    )
    assert {"studentId": a1.id, "old": [None, None], "new": ["ENTERED", "60.5"]} in json.loads(saved_event.event_data_json)["changes"]


def test_a_teacher_who_has_moved_on_reads_but_cannot_enter(client, db_session):
    from app.models import TeacherSectionAssignment

    w = _api_world(db_session, "AS11")
    scheme = _published(db_session, w, [_component("Annual", "80", "100")])
    window = db_session.query(TeacherSectionAssignment).filter_by(teacher_id=w["teacher"].id).one()
    window.end_date = date.today()
    db_session.commit()
    teacher = _Person(w["teacher"].user.email)
    assert teacher.get(f"/api/assessment/schemes/{scheme.id}/sections").json() == {
        "sections": [{"section": "A", "canEnterMarks": False}]
    }
    url = f"/api/assessment/schemes/{scheme.id}/components/{scheme.components[0].id}/marks"
    assert teacher.get(url, params={"section": "A"}).json()["canEnterMarks"] is False
    refused = teacher.put(url, json={"section": "A", "entries": [{"studentId": w["students"]["A2"].id, "status": "ABSENT"}]})
    assert refused.status_code == 403
    assert teacher.get(f"/api/assessment/schemes/{scheme.id}/results", params={"section": "A"}).status_code == 200


def test_another_schools_admin_and_a_super_admin(client, db_session):
    w = _api_world(db_session, "AS12")
    scheme = _published(db_session, w, [_component("Annual", "80", "100")])
    stranger_school = _make_school(db_session, "as12-other")
    stranger = _Person(_make_school_admin(db_session, stranger_school, "as12-other").email)
    assert stranger.get(f"/api/assessment/schemes/{scheme.id}").status_code == 404
    assert stranger.get("/api/assessment/schemes").json() == {"schemes": []}
    assert stranger.get("/api/assessment/years", params={"schoolId": w["school"].id}).status_code == 404
    url = f"/api/assessment/schemes/{scheme.id}/components/{scheme.components[0].id}/marks"
    assert stranger.get(url, params={"section": "A"}).status_code == 404
    assert stranger.post("/api/assessment/schemes", json={
        "academicYearId": w["year"].id, "boardCourseId": w["course_id"],
    }).status_code == 422  # not one of their years

    sa = _Person(_make_super_admin(db_session, "as12").email)
    assert sa.get("/api/assessment/schemes").status_code == 422  # must name a school
    listed = sa.get("/api/assessment/schemes", params={"schoolId": w["school"].id}).json()
    assert scheme.id in [s["id"] for s in listed["schemes"]]
    assert sa.get(f"/api/assessment/schemes/{scheme.id}/results", params={"section": "B"}).status_code == 200


def test_years_and_templates(client, db_session):
    from app.models import Chapter

    school = _make_school(db_session, "as-years")
    admin = _Person(_make_school_admin(db_session, school, "as-years").email)
    sa = _Person(_make_super_admin(db_session, "as-years").email)
    bad = admin.post("/api/assessment/years", json={"label": "2026-28", "startDate": "2026-04-01", "endDate": "2027-03-31"})
    assert bad.status_code == 422
    first = admin.post("/api/assessment/years", json={"label": "2026-27", "startDate": "2026-04-01", "endDate": "2027-03-31"})
    assert first.status_code == 200 and first.json()["isCurrent"] is True
    second = admin.post("/api/assessment/years", json={"label": "2027-28", "startDate": "2027-04-01", "endDate": "2028-03-31"})
    assert second.json()["isCurrent"] is False
    assert admin.post(f"/api/assessment/years/{second.json()['id']}/current").json()["isCurrent"] is True
    years = admin.get("/api/assessment/years").json()["years"]
    assert [(y["label"], y["isCurrent"]) for y in years] == [("2027-28", True), ("2026-27", False)]
    dup = admin.post("/api/assessment/years", json={"label": "2026-27", "startDate": "2026-04-01", "endDate": "2027-03-31"})
    assert dup.status_code == 409

    # Templates: the standard ones start as drafts for Ashalatha to check;
    # a School Admin sees only published ones and cannot change them.
    assert admin.post("/api/assessment/templates/standard").status_code == 403
    made = sa.post("/api/assessment/templates/standard").json()["created"]
    assert {t["name"] for t in made} >= {"CBSE-Style, Classes 6 to 8", "CBSE-Style, Classes 9 and 10", "ICSE-Style, Classes 9 and 10"}
    assert all(t["status"] == "DRAFT" for t in made)
    assert sa.post("/api/assessment/templates/standard").json() == {"created": []}
    assert admin.get("/api/assessment/templates").json() == {"templates": []}
    cbse = next(t for t in made if t["name"] == "CBSE-Style, Classes 6 to 8")
    assert admin.get(f"/api/assessment/schemes/{cbse['id']}").status_code == 404
    published = sa.post(f"/api/assessment/schemes/{cbse['id']}/publish")
    assert published.status_code == 200, published.text
    assert [t["id"] for t in admin.get("/api/assessment/templates").json()["templates"]] == [cbse["id"]]
    assert admin.put(f"/api/assessment/schemes/{cbse['id']}", json={"name": "Mine"}).status_code == 403

    # A school's copy of the template is its own draft, with its own keys.
    _make_chapter_with_skills(db_session, "AS-TPL", n_skills=1)
    course_id = db_session.query(Chapter).filter(Chapter.code == "CH-AS-TPL").one().board_course_id
    copy = admin.post("/api/assessment/schemes", json={
        "academicYearId": years[1]["id"], "boardCourseId": course_id, "templateId": cbse["id"],
    })
    assert copy.status_code == 200, copy.text
    body = copy.json()
    assert (body["status"], body["isTemplate"], len(body["components"])) == ("DRAFT", False, 8)
    assert body["publishProblems"] == []
    template_keys = {c.component_key for c in db_session.get(AssessmentScheme, cbse["id"]).components}
    assert not template_keys & {c["componentKey"] for c in body["components"]}
    assert admin.delete(f"/api/assessment/schemes/{body['id']}").json() == {"deleted": True}


# --- found in review (23 Oct 2026) ---------------------------------------------------------


def test_a_repeated_component_key_cannot_move_marks(db_session):
    w = _world(db_session, "AS13")
    a1 = w["students"]["A1"]
    old = _published(db_session, w, [_component("Annual", "80", "80"), _component("Project", "20", "20")])
    _enter(db_session, old, "Annual", {a1: "70"})
    _enter(db_session, old, "Project", {a1: "5"})
    new = service.copy_scheme(
        db_session, old, user_id=None, school_id=old.school_id, academic_year_id=old.academic_year_id,
        class_level_id=old.class_level_id, board_course_id=old.board_course_id, as_new_version=True,
    )
    annual_key = new.components[0].component_key
    service.write_scheme(db_session, new, service.clean_scheme_input(_input([
        ComponentInput("Annual", "ANNUAL", "WHOLE_YEAR", "ENTERED", "80", "80", None, [], annual_key),
        ComponentInput("Project", "PROJECT", "WHOLE_YEAR", "ENTERED", "10", "20", None, [], annual_key),
    ])))
    assert new.components[0].component_key == annual_key != new.components[1].component_key
    outcome = service.publish(db_session, new, user_id=None)
    db_session.commit()
    r = _result(db_session, new, a1)
    # Annual's 70 stays on Annual; Project lost its key, so its 5 is not
    # carried, and the publish says so.
    assert [(c.status, c.marks) for c in r.components] == [("MARKS", Decimal(70)), ("MISSING", None)]
    assert outcome.marks_carried == 1
    assert outcome.marks_dropped == [{"studentId": a1.id, "component": "Project", "why": "the component was removed"}]


def test_marks_a_new_version_cannot_take_are_reported(db_session):
    w = _world(db_session, "AS14")
    a1, a2 = w["students"]["A1"], w["students"]["A2"]
    old = _published(db_session, w, [_component("Annual", "80", "100")])
    _enter(db_session, old, "Annual", {a1: "70", a2: "30"})
    new = service.copy_scheme(
        db_session, old, user_id=None, school_id=old.school_id, academic_year_id=old.academic_year_id,
        class_level_id=old.class_level_id, board_course_id=old.board_course_id, as_new_version=True,
    )
    key = new.components[0].component_key
    service.write_scheme(db_session, new, service.clean_scheme_input(_input([
        ComponentInput("Annual", "ANNUAL", "WHOLE_YEAR", "ENTERED", "50", "100", None, [], key),
    ])))
    outcome = service.publish(db_session, new, user_id=None)
    db_session.commit()
    assert outcome.marks_carried == 1
    assert outcome.marks_dropped == [
        {"studentId": a1.id, "component": "Annual", "why": "the maximum marks were lowered below it"}
    ]


def test_an_excused_student_and_a_fully_exempt_one(db_session):
    w = _world(db_session, "AS15")
    a1, a2 = w["students"]["A1"], w["students"]["A2"]
    assignment = _assign(db_session, w["school"], w["activity"], w["teacher"].user_id, section="A")
    _target(db_session, assignment, a1).status = "SKIPPED"
    db_session.commit()
    scheme = _published(db_session, w, [
        _component("Practice", "10", "50", source="PLATFORM", activity_ids=[w["activity"].id]),
        _component("Annual", "80", "50"),
    ])
    _enter(db_session, scheme, "Annual", {a1: "40", a2: "EXEMPT"})
    _enter(db_session, scheme, "Practice", {a2: "EXEMPT"})
    # A1 was excused from the set: it is left out like a set never given.
    r = _result(db_session, scheme, a1)
    assert (r.components[0].status, r.provisional, r.shown) == ("EXEMPT", False, Decimal(50))
    r = _result(db_session, scheme, a2)
    assert (r.shown, r.grade, r.notes) == (None, None, ["No result: exempt from every component."])


def test_a_teacher_from_an_earlier_year_sees_nothing_of_this_one(client, db_session):
    from app.models import TeacherSectionAssignment

    w = _api_world(db_session, "AS16")
    scheme = _published(db_session, w, [_component("Annual", "80", "100")])
    window = db_session.query(TeacherSectionAssignment).filter_by(teacher_id=w["teacher"].id).one()
    window.start_date = w["year"].start_date - timedelta(days=700)
    window.end_date = w["year"].start_date - timedelta(days=300)
    db_session.commit()
    teacher = _Person(w["teacher"].user.email)
    assert teacher.get("/api/assessment/schemes").json() == {"schemes": []}
    assert teacher.get(f"/api/assessment/schemes/{scheme.id}").status_code == 404
    assert teacher.get(f"/api/assessment/schemes/{scheme.id}/results", params={"section": "A"}).status_code == 404
    # A window that ended inside this year still counts (read only).
    window.end_date = w["year"].start_date + timedelta(days=30)
    db_session.commit()
    assert teacher.get(f"/api/assessment/schemes/{scheme.id}/results", params={"section": "A"}).status_code == 200


_CH["AS40"] = 140


def test_self_practice_never_counts_in_platform_marks(db_session):
    """#184: a set a student opened themselves from My Progress is not one a
    teacher gave, so it neither counts nor makes a component missing."""
    w = _world(db_session, "AS40")
    b1 = w["students"]["B1"]
    own = learning_service.create_assignment(
        db_session, school=w["school"], learning_activity=w["activity"], assigned_by_user_id=b1.user_id,
        student_ids=[b1.id], reason="SELF_PRACTICE",
    )
    _submit(db_session, w, b1, own, q1="A", q2="5")
    scheme = _published(
        db_session, w, [_component("Practice", "10", "100", source="PLATFORM", activity_ids=[w["activity"].id])]
    )
    r = _result(db_session, scheme, b1)
    assert (r.components[0].status, r.provisional, r.shown) == ("EXEMPT", False, None)
