"""The marking findings of the 22 Nov 2026 pre-pilot audit, batch A
(23 Nov 2026): A-003 comma lists read as one number, A-004 a label dropped
from a one-box key, A-005 a different unknown accepted, A-006 spacing and
spelling a correct answer was marked wrong for, A-028 a compound unit the
question named being invisible.

Each finding has the case that was wrong, and beside it the case that was
already right and must stay right -- most of these fixes narrow an existing
leniency, and the leniency was there for a reason.
"""
import pytest

from app.models import Question
from app.services import learning_service, units
from app.services.learning_service import grade_answer, units_named_in


def _q(answer, question_type="Text Entry", stem="Work it out.", **fields) -> Question:
    return Question(
        question_type=question_type, correct_answer=answer, marks=1,
        auto_gradable=True, stem=stem, **fields,
    )


def _ok(answer, response, **fields):
    return grade_answer(_q(answer, **fields), response)[0] is True


# --- A-003: a list of numbers read as one number ---------------------------
#
# "5, 100" is two numbers. _normalize_value used to strip the comma out of
# any digit group that could be a grouping comma, so the key became 5100 and
# a child who typed the two numbers was marked wrong.


@pytest.mark.parametrize("response", ["5, 100", "5,100", "5 100"])
def test_a_comma_then_space_in_the_key_means_a_list(response):
    assert _ok("5, 100", response)


@pytest.mark.parametrize("response", ["1,000, 2,000", "1000, 2000", "1000,2000", "1,000 2,000"])
def test_a_list_of_thousands_keeps_its_thousands_and_still_separates(response):
    assert _ok("1,000, 2,000", response)


@pytest.mark.parametrize("response", ["1,2,3", "1, 2, 3", "1 2 3"])
def test_commas_that_cannot_be_grouping_commas_are_a_list(response):
    assert _ok("1,2,3", response)


def test_a_wrong_list_is_still_wrong():
    assert not _ok("5, 100", "5, 10")
    assert not _ok("5, 100", "100, 5")
    assert not _ok("1,2,3", "1, 2")


@pytest.mark.parametrize("response", ["19,250", "19250", "19,250 km", "19250 km"])
def test_a_grouped_number_is_still_one_number(response):
    assert _ok("19,250", response, question_type="Numeric Entry", stem="How far in km?")


def test_an_indian_grouped_number_is_still_one_number():
    assert _ok("1,00,000", "100000", question_type="Numeric Entry")


def test_the_key_decides_how_the_child_s_commas_are_read():
    # The same typed answer, "5,100", is two numbers against a list key and
    # one number against a number key. Read on its own it would always look
    # like one number, which is why the key is what decides (A-003).
    assert _ok("5, 100", "5,100")
    assert _ok("5100", "5,100", question_type="Numeric Entry")


def test_a_validly_grouped_key_with_no_space_is_left_as_a_number():
    # 125 keys in the content are written "97,44,61,101" or "160,409,220":
    # no space, and every group could be a grouping comma, so nothing in the
    # key says which is meant. These stay numbers, as they were before this
    # change, and are being fixed in the content by adding the space. Pinned
    # here so that changing it is a decision, not an accident.
    assert learning_service._list_parts("160,409,220") is None
    assert learning_service._normalize_value("160,409,220") == "160409220"


# --- A-004: a label dropped from a one-box key -----------------------------
#
# "Base 2" in a two-box answer is the box labelled Base, so the child types
# "2". The same leniency on a one-box answer accepted "11" for the key
# "Decrease 11" and "3" for "quarter past 3", where the label IS the answer.


@pytest.mark.parametrize("key,response", [
    ("Decrease 11", "11"),
    ("Increase 11", "11"),
    ("quarter past 3", "3"),
    ("Profit 20", "20"),
])
def test_a_one_box_key_keeps_its_label(key, response):
    assert not _ok(key, response)


@pytest.mark.parametrize("key,response", [
    ("Decrease 11", "decrease 11"),
    ("Decrease 11", "Decrease 11"),
    ("quarter past 3", "quarter past 3"),
])
def test_a_one_box_key_is_still_right_written_whole(key, response):
    assert _ok(key, response)


def test_a_one_box_key_that_is_the_wrong_direction_is_wrong():
    # The pair this protects: "increase" appears in 25 keys in the content,
    # and its opposite reads the same once the label is dropped.
    assert not _ok("Increase 11", "decrease 11")
    assert not _ok("Decrease 11", "increase 11")


@pytest.mark.parametrize("response", ["Base 9; exponent 2", "9;2", "9; 2"])
def test_several_boxes_still_take_the_values_alone(response):
    # Unchanged: each box carries its label on screen, so the child has been
    # told which part goes where.
    assert _ok("Base 9; exponent 2", response)


def test_a_label_is_never_dropped_from_the_child_s_answer():
    assert not _ok("Base 9; exponent 2", "exponent 9; base 2")


# --- A-005: a different unknown accepted -----------------------------------
#
# The name of the unknown was dropped from both sides before comparing, so
# "y = 3" passed as "x = 3".


def test_a_different_unknown_is_wrong():
    assert not _ok("x = 3", "y = 3")
    assert not _ok("x = 3; y = 5", "y = 3; x = 5")


def test_the_unknown_may_still_be_left_out_or_shown():
    # #244, and the reason the names are dropped at all: a child who writes
    # the unknown is not marked down for it, and one who leaves it out is
    # not either.
    assert _ok("3", "x = 3")
    assert _ok("x = 3", "3")
    assert _ok("x = 3", "x = 3")
    assert _ok("x = 3", "X=3")


# --- A-006: spacing and spelling a correct answer was marked wrong for -----


@pytest.mark.parametrize("response", ["3:4", "3 : 4", "3 :4"])
def test_the_spaces_around_a_ratio_colon_mean_nothing(response):
    assert _ok("3 : 4", response)


@pytest.mark.parametrize("response", ["1:15 p.m.", "1:15 pm", "1:15pm", "1:15 P.M.", "1:15 PM"])
def test_one_clock_time_however_the_meridiem_is_written(response):
    assert _ok("1:15 p.m.", response)


@pytest.mark.parametrize("response", ["9:45 a.m.", "9:45 am", "9:45am", "9:45 A.M."])
def test_the_morning_too(response):
    assert _ok("9:45 a.m.", response)


def test_a_time_in_the_wrong_half_of_the_day_is_wrong():
    assert not _ok("1:15 p.m.", "1:15 a.m.")


def test_the_ordinary_word_am_is_left_alone():
    # The fold is anchored to a digit, so a sentence keeps its "am".
    assert learning_service._normalize_value("I am 9") == "i am 9"
    assert not _ok("I am 9 years old", "I 9m 9 years old")


@pytest.mark.parametrize("response,number", [
    ("5 kgs", 5.0), ("12 ltr", 12.0), ("3 yrs", 3.0), ("7 cms", 7.0),
    ("2 inches", 2.0), ("45°", 45.0), ("6 months", 6.0), ("9 cm²", 9.0),
    ("60 kmph", 60.0), ("4 kilos", 4.0), ("8 mtr", 8.0),
])
def test_a_number_is_read_through_any_unit_spelling_units_py_knows(response, number):
    assert learning_service._numeric_value(response) == number


def test_free_text_is_not_read_as_a_number():
    # The vocabulary is still closed: the reason it is not a general "drop
    # any trailing word" rule is that it would make "subtract 500 each time"
    # numeric-match the key "add 500 each time".
    assert learning_service._numeric_value("add 500 each time") is None
    assert not _ok("add 500 each time", "subtract 500 each time")


def test_the_trailing_unit_vocabulary_comes_from_units_py():
    # A-006: the second, hand-written list this replaces knew "kg" but not
    # "kgs". Any unit added to units.py from now on is understood here too.
    for spelling in ("kgs", "ltr", "yrs", "cms", "inches", "celsius", "cm3", "m/s"):
        assert units.unit_code(spelling) is not None
        assert learning_service._numeric_value(f"7 {spelling}") == 7.0


# --- A-028: a compound unit the question named was invisible ---------------
#
# units_named_in split the wording on letters, so "km/h" was read as
# {km, h} and never as a speed; _written_unit folded a child's "km/h" to
# "km" to paper over it, which also made "60 km/h" right for 60 kilometres.


def test_a_speed_in_the_wording_is_read_as_a_speed():
    named = units_named_in("A car travels at 60 km/h for 2 hours.")
    assert "kmh" in named
    # A distance and a time named together name the speed as well, even
    # where the wording never writes "km/h" (what the fold removed from
    # _written_unit used to cover, by pretending a speed was a distance).
    assert units_named_in("A train covers 90 km in 2 hours.") == frozenset({"km", "h", "kmh"})


def test_a_child_s_speed_is_read_as_a_speed():
    assert learning_service._written_unit("60 km/h") == "kmh"
    assert learning_service._written_unit("60 kmph") == "kmh"
    assert learning_service._written_unit("16 cm") == "cm"


@pytest.mark.parametrize("stem", [
    "A car travels at 60 km/h for 2 hours. What is its speed?",
    "A car covers 120 km in 2 hours. Find its speed.",
])
def test_the_speed_the_question_named_is_accepted(stem):
    # The second wording never writes the unit: it names a distance and a
    # time, which is the same thing. Removing the km/h-to-km fold without
    # this would have marked "60 km/h" wrong on every speed question of
    # that shape, and ICSE Class 7 has a Speed chapter.
    assert _ok("60", "60 km/h", question_type="Numeric Entry", stem=stem)
    assert _ok("60", "60 kmph", question_type="Numeric Entry", stem=stem)
    assert _ok("60", "60", question_type="Numeric Entry", stem=stem)


def test_a_rate_needs_both_of_its_units_named():
    assert units_named_in("A bus travels 450 km") == frozenset({"km"})
    assert units_named_in("The journey took 2 hours.") == frozenset({"h"})


def test_a_speed_is_not_a_distance():
    # What the old fold allowed: "60 km/h" for a key of 60 kilometres.
    q = _q("60 km", question_type="Numeric Entry", stem="How far did it go?",
           answer_unit="km", unit_rule="REQUIRED")
    assert grade_answer(q, "60 km/h")[0] is not True


@pytest.mark.parametrize("stem", [
    "Mind the gap.", "The metal pole is tall.", "She has a mint.", "Lambs graze here.",
])
def test_a_unit_hidden_inside_a_word_is_not_a_unit(stem):
    assert units_named_in(stem) == frozenset()


def test_an_area_in_the_wording_is_read_as_an_area_and_as_its_length():
    # Both, on purpose: a question that gives an area in cm² asks for a side
    # in cm, and nothing else in the wording says cm.
    assert units_named_in("Find the total patch area in cm².") == frozenset({"cm2", "cm"})
    assert units_named_in("Find the area in square centimetres.") == frozenset({"cm2", "cm"})


def test_a_percentage_in_the_wording_is_read_with_no_space_before_it():
    # "10%" is written with nothing between the number and the sign, so the
    # sign may follow a digit; a letter may not ("6s" below).
    assert units_named_in("Find 10% of 340.") == frozenset({"percent"})
    assert units_named_in("Measure the 45° angle.") == frozenset({"degree"})


def test_a_letter_stuck_to_a_digit_is_not_a_unit():
    # "the two 6s in 66,205" is not six seconds. Reading it as one accepted
    # "54000 seconds" for a place-value question.
    assert units_named_in("The two 6s in 66,205 have different place values.") == frozenset()
    assert not _ok("54000", "54000 seconds", question_type="Numeric Entry",
                   stem="The two 6s in 66,205 have different place values. Find the difference.")


def test_rupees_in_the_wording():
    assert "rupee" in units_named_in("A pen costs ₹12.")
    assert "rupee" in units_named_in("A pen costs 12 rupees.")


# --- A-006 and the pattern engine ------------------------------------------


def test_the_clock_forms_the_pattern_engine_lists_are_now_marked_without_the_list():
    # pattern_engine.clock_12_variants records every usual way of writing a
    # 12-hour time, because marking could not read them. Three of the five
    # no longer need the list: a question whose variants were never recorded
    # now marks them right anyway. The two that write a full stop for the
    # colon ("1.15 p.m.") still need it -- a full stop is not a colon, and
    # making it one would change every decimal.
    from app.services.pattern_engine import clock_12, clock_12_variants

    key = clock_12(795)
    assert key == "1:15 p.m."
    question = _q(key)
    by_normalisation, by_variant = [], []
    for variant in clock_12_variants(key).split("|"):
        (by_normalisation if grade_answer(question, variant)[0] else by_variant).append(variant)
    assert by_normalisation == ["1:15 pm", "1:15pm", "1:15p.m."]
    assert by_variant == ["1.15 p.m.", "1.15 pm"]
    assert grade_answer(_q(key, accepted_variants=clock_12_variants(key)), "1.15 pm")[0] is True
    assert grade_answer(question, "1:15 a.m.")[0] is False


def test_a_morning_time_the_pattern_engine_generates():
    from app.services.pattern_engine import clock_12

    assert clock_12(5) == "12:05 a.m."
    assert _ok("12:05 a.m.", "12:05am")
    assert not _ok("12:05 a.m.", "12:05 p.m.")
