"""#244 (19 Nov 2026): one answer, written any sensible way, is marked the
same. Covers x / * / x as times, powers, spaces, labelled parts, minus and
dash forms, a trailing full stop, "x = 3", unit case, the key-derived box
labels, the duplicate-assignment guard and a school's board scope."""
import pytest

from app.models import Board, BoardCourse, ClassLevel, Question
from app.services import learning_service, units
from app.services.learning_service import answer_blank_labels, grade_answer
from tests import test_learning
from tests.test_curriculum_admin import (
    _get_or_create_board_course,
    _login,
    _make_chapter,
    _make_school_admin,
)
from tests.test_learning import _make_school, _published_single_activity

test_learning._CHAPTER_NUM.update({"mf1": 131})


def _q(answer, question_type="Text Entry", stem="Work it out.", **fields) -> Question:
    return Question(
        question_type=question_type, correct_answer=answer, marks=1,
        auto_gradable=True, stem=stem, **fields,
    )


def _ok(answer, response, **fields):
    return grade_answer(_q(answer, **fields), response)[0] is True


@pytest.mark.parametrize("response", ["3 × 4", "3x4", "3 x 4", "3*4", "3 * 4", "3×4", "3 X 4"])
def test_times_signs_and_spaces_are_one_expression(response):
    assert _ok("3 × 4", response)


@pytest.mark.parametrize("response", ["2^3", "2 ^ 3", "2**3", "2³", "2^(3)", "2^{3}"])
def test_power_forms_are_one_expression(response):
    assert _ok("2³", response)
    assert _ok("2^3", response)


@pytest.mark.parametrize("response", ["-9", "−9", "– 9", "- 9", "–9"])
def test_minus_forms_are_one_number(response):
    assert _ok("-9", response, question_type="Numeric Entry")


def test_a_trailing_full_stop_and_a_leading_variable_do_not_matter():
    assert _ok("3", "x = 3")
    assert _ok("3", "x=3")
    assert _ok("3", "3.")
    assert _ok("x = 3", "3")


def test_thousands_commas_are_ignored_but_a_list_still_matches_itself():
    assert _ok("19250", "19,250", question_type="Numeric Entry")
    assert _ok("1,2,3", "1, 2, 3")


@pytest.mark.parametrize("response", ["Base 9; exponent 2", "9;2", "9; 2", "base 9;exponent 2"])
def test_labelled_key_accepts_the_values_alone(response):
    assert _ok("Base 9; exponent 2", response)


def test_a_wrong_value_in_a_labelled_key_is_still_wrong():
    assert not _ok("Base 9; exponent 2", "9;3")


@pytest.mark.parametrize("text", ["degrees C", "DEGREES C", "Degree c", "degrees celsius", "°C", "°c"])
def test_celsius_spellings_and_case(text):
    assert units.parse_measurement(f"-9 {text}") is not None
    assert units.parse_measurement(f"-9 {text}") == units.parse_measurement("-9 °C")


@pytest.mark.parametrize("unit", ["CM", "Cm", "cM", "cm", "KG", "Kg", "METRES", "Metres"])
def test_unit_case_never_matters(unit):
    expected = units.parse_measurement(f"5 {unit.lower()}")
    assert units.parse_measurement(f"5 {unit}") == expected


def test_box_labels_come_from_a_labelled_key():
    q = _q("Base 9; exponent 2", question_type="Text Entry", stem="Write the base and exponent.")
    assert answer_blank_labels(q) == ["Base", "Exponent"]


def test_box_labels_fall_back_to_none_when_parts_are_plain():
    assert answer_blank_labels(_q("21310;22410")) is None
    assert answer_blank_labels(_q("Base 9; 2")) is None
    assert answer_blank_labels(_q("Mean 9; mean 8")) is None


def test_stem_labels_win_over_key_labels():
    q = _q("Base 9; exponent 2", stem="Enter number;power.")
    assert answer_blank_labels(q) == ["Number", "Power"]


def test_the_same_set_is_not_set_twice_for_one_open_section(db_session):
    from fastapi import HTTPException

    activity = _published_single_activity(db_session, "mf1")
    school = _make_school(db_session, "mf1")
    test_learning._make_sectioned_student(db_session, school, "mf1-a", class_name="5", section="A")
    learning_service.create_assignment(
        db_session, school=school, learning_activity=activity, assigned_by_user_id="t",
        class_name="5", section="A",
    )
    with pytest.raises(HTTPException) as err:
        learning_service.create_assignment(
            db_session, school=school, learning_activity=activity, assigned_by_user_id="t",
            class_name="5", section="A",
        )
    assert err.value.status_code == 409
    # another section is a different audience
    test_learning._make_sectioned_student(db_session, school, "mf1-b", class_name="5", section="B")
    learning_service.create_assignment(
        db_session, school=school, learning_activity=activity, assigned_by_user_id="t",
        class_name="5", section="B",
    )


def test_a_school_admin_sees_only_their_own_boards(client, db_session):
    _, board_course, _ = _get_or_create_board_course(db_session), None, None
    other = db_session.query(Board).filter(Board.code == "MF-OTHER").first()
    if not other:
        other = Board(code="MF-OTHER", display_name="Other Board")
        db_session.add(other)
        db_session.commit()
    _make_school_admin(db_session, "mf-admin@example.com", "MF School")  # board "CBSE"
    csrf = _login(client, "mf-admin@example.com")
    response = client.get("/api/curriculum-admin/boards", headers=csrf)
    assert response.status_code == 200
    codes = {b["code"] for b in response.json()["boards"]}
    assert "CBSE" in codes
    assert "MF-OTHER" not in codes
