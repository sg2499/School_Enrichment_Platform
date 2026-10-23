"""Measured answers: units, tolerance and rounding (Phase 4, #164).

The rules are Ashalatha's clarification note, item 5, as designed in
PHASE4_UNITS_DESIGN.md: the number, the unit and the rounding are checked
separately; common spellings are accepted; another unit is accepted only
when the question allows conversion; only the final answer is rounded, and
a 5 goes up; the allowed difference is set per question; a missing required
unit makes a one-mark answer wrong and costs only the unit mark on a longer
one. A question with none of the new fields set is marked as before.
"""
from decimal import Decimal

import pytest

from app.models import Question
from app.services import units
from app.services.learning_service import (
    UNIT_MISSING,
    WRONG_UNIT,
    GradeResult,
    default_unit_rule,
    grade_answer,
    grade_answer_detail,
    marking_rule,
    parse_tolerance,
)

STATED_FORMAT = "Integer; unit stated in question"


def _q(answer="250", *, marks=1, variants=None, response_format=None, **fields) -> Question:
    return Question(
        question_type=fields.pop("question_type", "Numeric Entry"),
        correct_answer=answer,
        accepted_variants=variants,
        marks=marks,
        auto_gradable=True,
        response_format=response_format,
        **fields,
    )


# --- units.py: reading what a child writes ---------------------------------


@pytest.mark.parametrize(
    "text, code",
    [
        ("m", "m"), ("metre", "m"), ("Metres", "m"), ("meter", "m"), ("meters", "m"),
        ("cm", "cm"), ("centimetres", "cm"), ("CM.", "cm"), ("kg", "kg"), ("Kgs", "kg"),
        ("kilogram", "kg"), ("g", "g"), ("gm", "g"), ("grams", "g"), ("l", "l"),
        ("litre", "l"), ("liters", "l"), ("ml", "ml"), ("millilitre", "ml"), ("min", "min"),
        ("minutes", "min"), ("hrs", "h"), ("hour", "h"), ("sec", "s"), ("Rs.", "rupee"),
        ("rupees", "rupee"), ("₹", "rupee"), ("paise", "paise"), ("°", "degree"),
        ("degrees", "degree"), ("cm²", "cm2"), ("sq cm", "cm2"), ("square centimetres", "cm2"),
        ("sq. m", "m2"), ("%", "percent"), ("per cent", "percent"),
        ("inch", "inch"), ("Inches", "inch"),
    ],
)
def test_common_spellings_are_one_unit(text, code):
    assert units.unit_code(text) == code


@pytest.mark.parametrize("text", [None, "", "  ", "apples", "kmph", "cubits"])
def test_an_unknown_unit_is_none(text):
    assert units.unit_code(text) is None


@pytest.mark.parametrize(
    "text, number, unit",
    [
        ("250", "250", None),
        ("250 g", "250", "g"),
        ("250g", "250", "g"),
        (" 2.5 kg ", "2.5", "kg"),
        ("₹ 1,250", "1250", "rupee"),
        ("Rs. 1,00,000", "100000", "rupee"),
        ("1,250 rupees", "1250", "rupee"),
        ("45°", "45", "degree"),
        ("12 cm²", "12", "cm2"),
        ("50 %", "50", "percent"),
        ("-3", "-3", None),
        ("+7", "7", None),
        (".5 l", "0.5", "l"),
    ],
)
def test_a_measurement_is_split_into_number_and_unit(text, number, unit):
    assert units.parse_measurement(text) == units.Measurement(Decimal(number), unit)


@pytest.mark.parametrize(
    "text",
    [None, "", "kg", "two hundred", "2 kg 50 g", "250 apples", "1,2,3", "₹ 5 kg", "12 34", "nan", "Infinity"],
)
def test_anything_but_one_number_and_one_unit_is_not_a_measurement(text):
    assert units.parse_measurement(text) is None


def test_conversion_is_only_within_one_kind():
    assert units.convert(Decimal(2), "kg", "g") == Decimal(2000)
    assert units.convert(Decimal(150), "cm", "m") == Decimal("1.5")
    assert units.convert(Decimal(2), "h", "min") == Decimal(120)
    assert units.convert(Decimal(1), "m2", "cm2") == Decimal(10000)
    assert units.convert(Decimal(250), "paise", "rupee") == Decimal("2.5")
    assert units.convert(Decimal(2), "kg", "m") is None
    assert units.convert(Decimal(2), "kg", "nope") is None


def test_rounding_takes_a_5_up_not_to_the_even_digit():
    assert units.round_half_up(Decimal("2.45"), 1) == Decimal("2.5")
    assert units.round_half_up(Decimal("2.35"), 1) == Decimal("2.4")
    assert units.round_half_up(Decimal("0.125"), 2) == Decimal("0.13")
    assert units.round_half_up(Decimal("2.5"), 0) == Decimal(3)
    assert units.round_half_up(Decimal("-2.5"), 0) == Decimal(-3)  # away from zero
    assert units.round_half_up(Decimal("2.44"), 1) == Decimal("2.4")


def test_tolerance_edges_are_exact():
    match = units.numbers_match
    assert match(Decimal("10.05"), Decimal(10), tolerance=Decimal("0.05"), decimal_places=None)
    assert not match(Decimal("10.051"), Decimal(10), tolerance=Decimal("0.05"), decimal_places=None)
    assert match(Decimal("9.95"), Decimal(10), tolerance=Decimal("0.05"), decimal_places=None)
    assert match(Decimal("0.3"), Decimal("0.1") + Decimal("0.2"), tolerance=None, decimal_places=None)
    assert not match(Decimal("10.01"), Decimal(10), tolerance=Decimal(0), decimal_places=None)


def test_unit_labels_read_as_words():
    assert units.unit_label("g") == "grams"
    assert units.unit_label("g", plural=False) == "gram"
    assert units.unit_label("cm2") == "square centimetres"
    assert units.unit_label("nope") is None and units.unit_label(None) is None


# --- reading a question's marking fields -----------------------------------


def test_the_unit_rule_defaults_from_the_response_format():
    assert default_unit_rule(STATED_FORMAT) == "STATED"
    assert default_unit_rule("Integer; Unit stated in question") == "STATED"
    assert default_unit_rule("Integer") == "NONE"
    assert default_unit_rule(None) == "NONE"
    assert marking_rule(_q(response_format=STATED_FORMAT)).unit_rule == "STATED"
    assert marking_rule(_q(response_format=STATED_FORMAT, unit_rule="NONE")).unit_rule == "NONE"
    assert marking_rule(_q(unit_rule="required")).unit_rule == "REQUIRED"
    assert marking_rule(_q(unit_rule="bogus")).unit_rule == "NONE"


def test_unreadable_stored_fields_are_ignored_not_fatal():
    assert parse_tolerance("0.5") == Decimal("0.5")
    for bad in (None, "", " ", "abc", "-1", "NaN", "inf"):
        assert parse_tolerance(bad) is None, bad
    rule = marking_rule(_q(answer_unit="furlong", unit_mark=-2, decimal_places=-1, numeric_tolerance="x"))
    assert rule.answer_unit is None and rule.unit_mark == 1 and rule.decimal_places is None and rule.tolerance is None
    assert marking_rule(_q(answer_unit="Grams")).answer_unit == "g"


# --- no fields set: marked exactly as before -------------------------------


def test_with_no_marking_fields_a_written_unit_is_still_ignored_as_before():
    # Today's behaviour, kept until a unit is recorded for the question.
    q = _q(response_format=STATED_FORMAT)
    assert grade_answer(q, "250") == (True, 1)
    assert grade_answer(q, "250 kg") == (True, 1)
    assert grade_answer(q, "251") == (False, 0)
    assert grade_answer_detail(q, "250").note is None


def test_other_question_types_never_take_the_unit_rules():
    text_q = _q("250 g", question_type="Text Entry", unit_rule="REQUIRED", answer_unit="g")
    assert grade_answer(text_q, "250 g") == (True, 1)
    single = _q("B", question_type="Single Select", unit_rule="REQUIRED", answer_unit="g")
    assert grade_answer(single, "B") == (True, 1)


def test_several_blanks_keep_todays_marking():
    q = _q("2;50", unit_rule="REQUIRED", answer_unit="kg", marks=2)
    assert grade_answer(q, "2;50") == (True, 2)


# --- Stated ----------------------------------------------------------------


def test_stated_accepts_the_number_alone_or_with_the_right_unit():
    q = _q(response_format=STATED_FORMAT, answer_unit="g")
    for given in ("250", "250 g", "250g", "250 grams", "250 gm", " 250 Grams "):
        assert grade_answer_detail(q, given) == GradeResult(True, 1), given


def test_stated_marks_a_wrong_unit_wrong_and_says_why():
    q = _q(response_format=STATED_FORMAT, answer_unit="g")
    assert grade_answer_detail(q, "250 kg") == GradeResult(False, 0, WRONG_UNIT)
    assert grade_answer_detail(q, "250 cm") == GradeResult(False, 0, WRONG_UNIT)
    # A wrong number is just wrong: no note suggesting it was nearly right.
    assert grade_answer_detail(q, "300 kg") == GradeResult(False, 0)
    assert grade_answer_detail(q, "251") == GradeResult(False, 0)


def test_conversion_only_when_the_question_allows_it():
    no = _q("2000", response_format=STATED_FORMAT, answer_unit="g")
    assert grade_answer_detail(no, "2 kg") == GradeResult(False, 0)  # 2 is not 2000, so no note
    yes = _q("2000", response_format=STATED_FORMAT, answer_unit="g", allow_unit_conversion=True)
    assert grade_answer_detail(yes, "2 kg") == GradeResult(True, 1)
    assert grade_answer_detail(yes, "2000 g") == GradeResult(True, 1)
    assert grade_answer_detail(yes, "2.5 kg") == GradeResult(False, 0)
    assert grade_answer_detail(yes, "2000 m") == GradeResult(False, 0, WRONG_UNIT)  # another kind


def test_a_key_that_carries_its_own_unit_is_respected():
    q = _q("1.5 m", response_format=STATED_FORMAT, answer_unit="cm", allow_unit_conversion=True)
    assert grade_answer(q, "150 cm") == (True, 1)
    assert grade_answer(q, "1.5 m") == (True, 1)


def test_inches_added_for_ashalathas_review():
    # Her Unit List (23 Oct 2026) adds inches, for Chapter 5's "2 feet equal
    # how many inches?". Only "inch" and "inches": "in" is an ordinary word.
    q = _q("24", response_format=STATED_FORMAT, answer_unit="inch")
    for given in ("24", "24 inches", "24 inch", "24 Inches"):
        assert grade_answer_detail(q, given) == GradeResult(True, 1), given
    assert grade_answer_detail(q, "24 cm") == GradeResult(False, 0, WRONG_UNIT)
    assert grade_answer_detail(q, "24 feet") == GradeResult(False, 0)  # not a unit marking knows
    assert units.unit_code("in") is None
    assert units.unit_label("inch") == "inches"
    assert units.unit_label("inch", plural=False) == "inch"
    # A length like any other: converts to centimetres only when allowed.
    assert units.convert(Decimal(1), "inch", "cm") == Decimal("2.54")
    yes = _q("254", response_format=STATED_FORMAT, answer_unit="cm", allow_unit_conversion=True)
    assert grade_answer(yes, "100 inches") == (True, 1)


def test_rupees_and_area():
    money = _q("1250", response_format=STATED_FORMAT, answer_unit="rupee")
    for given in ("1250", "1,250", "₹1,250", "Rs. 1250", "1250 rupees"):
        assert grade_answer(money, given) == (True, 1), given
    area = _q("24", response_format=STATED_FORMAT, answer_unit="cm2")
    assert grade_answer(area, "24 sq cm") == (True, 1)
    assert grade_answer_detail(area, "24 cm") == GradeResult(False, 0, WRONG_UNIT)


# --- Required --------------------------------------------------------------


def test_required_on_a_one_mark_question_a_missing_unit_is_wrong():
    q = _q("12", unit_rule="REQUIRED", answer_unit="cm")
    assert grade_answer_detail(q, "12 cm") == GradeResult(True, 1)
    assert grade_answer_detail(q, "12 centimetres") == GradeResult(True, 1)
    assert grade_answer_detail(q, "12") == GradeResult(False, 0, UNIT_MISSING)
    assert grade_answer_detail(q, "12 m") == GradeResult(False, 0, WRONG_UNIT)
    assert grade_answer_detail(q, "13") == GradeResult(False, 0)


def test_required_on_a_longer_question_only_the_unit_mark_is_lost():
    q = _q("12", unit_rule="REQUIRED", answer_unit="cm", marks=3)
    assert grade_answer_detail(q, "12 cm") == GradeResult(True, 3)
    assert grade_answer_detail(q, "12") == GradeResult(False, 2, UNIT_MISSING)
    assert grade_answer(q, "12") == (False, 2)
    two = _q("12", unit_rule="REQUIRED", answer_unit="cm", marks=3, unit_mark=2)
    assert grade_answer_detail(two, "12") == GradeResult(False, 1, UNIT_MISSING)
    more = _q("12", unit_rule="REQUIRED", answer_unit="cm", marks=2, unit_mark=5)
    assert grade_answer_detail(more, "12") == GradeResult(False, 0, UNIT_MISSING)
    # A wrong unit is still wrong, not part marks.
    assert grade_answer_detail(q, "12 kg") == GradeResult(False, 0, WRONG_UNIT)


def test_required_with_no_unit_recorded_behaves_as_today():
    q = _q("12", unit_rule="REQUIRED", marks=2)
    assert grade_answer(q, "12") == (True, 2)
    assert grade_answer(q, "12 cm") == (True, 2)


# --- Tolerance and decimal places ------------------------------------------


def test_tolerance_for_a_reading():
    q = _q("36.5", numeric_tolerance="0.2")
    assert grade_answer(q, "36.7") == (True, 1)
    assert grade_answer(q, "36.3") == (True, 1)
    assert grade_answer(q, "36.71") == (False, 0)
    assert grade_answer(q, "36.5 degrees") == (True, 1)  # rule NONE: a written unit is ignored


def test_decimal_places_round_the_final_answer_half_up():
    q = _q("3.14", decimal_places=2)
    assert grade_answer(q, "3.14159") == (True, 1)
    assert grade_answer(q, "3.135") == (True, 1)  # a 5 goes up
    assert grade_answer(q, "3.134") == (False, 0)
    whole = _q("3", decimal_places=0)
    assert grade_answer(whole, "2.5") == (True, 1)
    assert grade_answer(whole, "2.49") == (False, 0)


def test_rounding_tolerance_and_unit_together():
    q = _q("2.5", unit_rule="REQUIRED", answer_unit="kg", decimal_places=1, numeric_tolerance="0.1", marks=2)
    assert grade_answer_detail(q, "2.56 kg") == GradeResult(True, 2)  # 2.6, within 0.1
    assert grade_answer_detail(q, "2.4 kg") == GradeResult(True, 2)
    assert grade_answer_detail(q, "2.66 kg") == GradeResult(False, 0)  # 2.7
    assert grade_answer_detail(q, "2.5") == GradeResult(False, 1, UNIT_MISSING)


# --- Accepted Variants always win -----------------------------------------


def test_accepted_variants_win_over_the_unit_rules():
    q = _q("2050", variants="2 kg 50 g|2.05 kg", unit_rule="REQUIRED", answer_unit="g", marks=2)
    assert grade_answer(q, "2 kg 50 g") == (True, 2)  # a mixed measure, listed
    assert grade_answer(q, "2 KG 50 G") == (True, 2)
    assert grade_answer(q, "2.05 kg") == (True, 2)  # listed, so right without conversion
    assert grade_answer(q, "2050 g") == (True, 2)
    assert grade_answer_detail(q, "2050") == GradeResult(False, 1, UNIT_MISSING)
    assert grade_answer(q, "2 kg 60 g") == (False, 0)


def test_blank_and_nonsense_answers_are_wrong():
    q = _q(response_format=STATED_FORMAT, answer_unit="g")
    for given in (None, "", "   ", "grams", "two fifty", "250 apples"):
        assert grade_answer_detail(q, given) == GradeResult(False, 0), given


def test_a_question_not_marked_automatically_stays_unmarked():
    q = _q(unit_rule="REQUIRED", answer_unit="g")
    q.auto_gradable = False
    assert grade_answer_detail(q, "250 g") == GradeResult(None, None)


# --- Found in the independent review (13 Oct 2026) --------------------------


def test_a_very_long_answer_or_key_is_wrong_never_a_crash():
    q = _q("12.5", decimal_places=2)
    assert grade_answer(q, "1" * 30) == (False, 0)
    assert grade_answer(q, "999999999999999999999999999.5") == (False, 0)
    assert grade_answer(_q("12", decimal_places=6), "1" * 23) == (False, 0)
    long_key = _q("1" * 30, decimal_places=0)
    assert grade_answer(long_key, "5") == (False, 0)
    assert grade_answer(long_key, "1" * 30) == (True, 1)  # still right when typed exactly
    assert units.round_half_up(Decimal("1" * 30 + ".5"), 2) == Decimal("1" * 30 + ".50")


def test_a_key_these_rules_cannot_read_is_marked_the_old_way():
    for key, right in (("60 km/h", ["60 km/h", "60"]), ("5 days", ["5 days", "5"]), ("1/2", ["1/2"])):
        for setting in (dict(numeric_tolerance="0.5"), dict(decimal_places=0)):
            q = _q(key, **setting)
            for given in right:
                assert grade_answer(q, given) == (True, 1), (key, setting, given)
            assert grade_answer(q, "61") == (False, 0), (key, setting)


def test_formats_the_old_marking_accepted_are_still_right():
    q = _q("250", numeric_tolerance="1")  # rule NONE: no unit to check
    for given in ("250.", "$250", "250 days", "250 kg"):
        assert grade_answer(q, given) == (True, 1), given
    stated = _q("250", response_format=STATED_FORMAT, answer_unit="g")
    assert grade_answer(stated, "250.") == (True, 1)
    # "5 m" beside an answer in minutes means minutes.
    minutes = _q("5", response_format=STATED_FORMAT, answer_unit="min")
    assert grade_answer_detail(minutes, "5 m") == GradeResult(True, 1)
    assert grade_answer_detail(_q("5", response_format=STATED_FORMAT, answer_unit="cm"), "5 m") == GradeResult(False, 0, WRONG_UNIT)


def test_rule_none_ignores_a_unit_inside_the_key():
    q = _q("250 g", unit_rule="NONE", numeric_tolerance="1")
    assert grade_answer_detail(q, "250 kg") == GradeResult(True, 1)
    assert grade_answer_detail(q, "250") == GradeResult(True, 1)


def test_a_unit_mark_of_zero_loses_nothing_and_is_not_called_wrong():
    q = _q("12", unit_rule="REQUIRED", answer_unit="cm", marks=2, unit_mark=0)
    assert grade_answer_detail(q, "12") == GradeResult(True, 2)


def test_out_of_range_settings_are_refused():
    from app.services.learning_service import clean_marking_fields

    values, problems = clean_marking_fields({"unit_mark": "1e12", "decimal_places": "1e100000000", "numeric_tolerance": "1e-30"})
    assert values == {}
    assert [field for field, _ in problems] == ["unit_mark", "decimal_places", "numeric_tolerance"]
    assert "from 0 to 100" in problems[0][1]
    assert "at most 10 decimal places" in problems[2][1]
    assert clean_marking_fields({"unit_mark": 101})[1] and not clean_marking_fields({"unit_mark": 100})[1]
    assert clean_marking_fields({"allow_unit_conversion": 1})[0] == {"allow_unit_conversion": True}
    assert clean_marking_fields({"allow_unit_conversion": "0"})[0] == {"allow_unit_conversion": False}
    assert clean_marking_fields({"numeric_tolerance": "0.0000000001"})[0] == {"numeric_tolerance": "0.0000000001"}


def test_the_unit_word_after_a_key_of_one_is_singular():
    from app.services.learning_service import answer_unit_label

    assert answer_unit_label(_q("1", response_format=STATED_FORMAT, answer_unit="kg")) == "kilogram"
    assert answer_unit_label(_q("2", response_format=STATED_FORMAT, answer_unit="kg")) == "kilograms"


# --- The unit read from the question; variants in another unit (13 Oct 2026) --


def test_a_stated_question_with_no_recorded_unit_takes_the_unit_it_asks_for():
    q = _q("200", response_format=STATED_FORMAT, stem="2 m equals how many centimetres?")
    rule = marking_rule(q)
    assert (rule.answer_unit, rule.unit_source) == ("cm", "QUESTION")
    assert grade_answer_detail(q, "200") == GradeResult(True, 1)
    assert grade_answer_detail(q, "200 cm") == GradeResult(True, 1)
    assert grade_answer_detail(q, "200 m") == GradeResult(False, 0, WRONG_UNIT)


def test_a_recorded_unit_always_wins_over_the_question():
    q = _q("2", response_format=STATED_FORMAT, answer_unit="m", stem="2 m equals how many centimetres?")
    assert (marking_rule(q).answer_unit, marking_rule(q).unit_source) == ("m", "RECORDED")


def test_nothing_is_read_where_the_question_does_not_say():
    for stem in ("How many children wear glasses?", "A rectangle has area 35 cm² and breadth 5 cm. Find its length."):
        q = _q("8", response_format=STATED_FORMAT, stem=stem)
        assert marking_rule(q).answer_unit is None
        assert grade_answer(q, "8 kg") == (True, 1)  # as before: number alone


def test_a_rule_none_question_is_never_read():
    q = _q("200", stem="2 m equals how many centimetres?")  # Response Format without "unit stated"
    assert marking_rule(q).answer_unit is None
    assert grade_answer(q, "200 m") == (True, 1)  # as before


def test_a_variant_in_another_unit_no_longer_makes_a_wrong_unit_right():
    # The real Chapter 5 list (CBSE-C5-CH05-Q161).
    q = _q("6550", variants="6550|6550 mm|6550 cm|6550 m|6550 km|6550 markers|6550 children|₹6550",
           response_format=STATED_FORMAT, stem="6 km 550 m equals how many metres?")
    for right in ("6550", "6550 m", "6550 metres", "6,550 m", "6550 markers"):
        assert grade_answer(q, right) == (True, 1), right
    for wrong in ("6550 km", "6550 mm", "6550 cm", "₹6550", "6550 rupees"):
        assert grade_answer_detail(q, wrong) == GradeResult(False, 0, WRONG_UNIT), wrong


def test_a_variant_that_is_the_same_amount_in_another_unit_still_counts():
    q = _q("6550", variants="6.55 km|6 km 550 m", response_format=STATED_FORMAT, stem="6 km 550 m equals how many metres?")
    assert grade_answer(q, "6.55 km") == (True, 1)  # listed, and the same amount
    assert grade_answer(q, "6 km 550 m") == (True, 1)
    assert grade_answer_detail(q, "6.5 km") == GradeResult(False, 0)  # not listed, conversion off


def test_variants_are_untouched_where_no_unit_is_checked():
    q = _q("8", variants="8|8 items|8 children|8 hours|8 icons|8 kg", response_format=STATED_FORMAT, stem="How many children wear glasses?")
    for given in ("8", "8 kg", "8 hours", "8 children"):
        assert grade_answer(q, given) == (True, 1), given


def test_the_student_is_told_the_unit_read_from_the_question():
    from app.services.learning_service import answer_instruction, answer_unit_label

    q = _q("200", response_format=STATED_FORMAT, stem="2 m equals how many centimetres?")
    assert answer_instruction(q) == "Answer in centimetres."
    assert answer_unit_label(q) == "centimetres"


def test_an_equivalent_variant_within_the_questions_tolerance_or_rounding_still_counts():
    # Found in review: the equal-amount check ignored the question's own rule.
    rounded = _q("3.33", variants="333.3 cm", response_format=STATED_FORMAT, answer_unit="m", decimal_places=2)
    assert grade_answer(rounded, "333.3 cm") == (True, 1)
    near = _q("2.5", variants="245 cm", response_format=STATED_FORMAT, answer_unit="m", numeric_tolerance="0.1")
    assert grade_answer(near, "245 cm") == (True, 1)
    approx = _q("20", variants="0.33 h", response_format=STATED_FORMAT, answer_unit="min")
    assert grade_answer(approx, "0.33 h") == (True, 1)  # a different number, listed on purpose
    blanket = _q("20", variants="20 h|20 s", response_format=STATED_FORMAT, answer_unit="min")
    assert grade_answer_detail(blanket, "20 h") == GradeResult(False, 0, WRONG_UNIT)


def test_an_answer_the_rules_cannot_read_gets_what_marking_always_gave_it():
    q = _q("60", response_format=STATED_FORMAT, answer_unit="km")
    for given in ("60 km/h", "60 kmph"):
        assert grade_answer(q, given) == (True, 1), given
    assert grade_answer(q, "61 km/h") == (False, 0)
