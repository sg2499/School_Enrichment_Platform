"""Unit tests for app/services/question_quality_service.py -- the free
structural + math-pattern quality checks (18 Aug 2026). Constructs Question
ORM objects directly without a DB session (nothing here needs persistence),
matching how curriculum_import_service.py's own real-data expectations were
verified: several of these cases are taken directly from real Chapter 1
content, including two genuine false positives caught and fixed while
building this (duplicate-by-stem-alone, and "immediately before" inside an
arithmetic-pattern question) -- both are regression-tested below so they
can't silently come back.
"""
from app.models import Question
from app.services.question_quality_service import evaluate_question, find_duplicate_question_ids, run_quality_checks


def _q(**kwargs) -> Question:
    defaults = dict(
        id=kwargs.pop("id", "q1"),
        code=kwargs.pop("code", "Q1"),
        concept_lesson_id="lesson1",
        question_type="Numeric Entry",
        stem="stem",
        correct_answer="1",
        marks=1,
    )
    defaults.update(kwargs)
    return Question(**defaults)


# --- structural checks -----------------------------------------------------


def test_empty_stem_is_flagged():
    q = _q(stem="   ", correct_answer="4")
    result = evaluate_question(q)
    assert result.status == "FLAGGED"
    assert any("empty" in f.lower() for f in result.flags)


def test_empty_correct_answer_is_flagged():
    q = _q(stem="What is 2 + 2?", correct_answer="")
    result = evaluate_question(q)
    assert result.status == "FLAGGED"
    assert any("correct answer is empty" in f.lower() for f in result.flags)


def test_single_select_answer_key_not_matching_any_option_is_flagged():
    q = _q(
        question_type="Single Select",
        stem="Which is largest?",
        option_a="10", option_b="20", option_c="30", option_d=None,
        correct_answer="D",  # D is empty -- the answer key points at nothing
    )
    result = evaluate_question(q)
    assert result.status == "FLAGGED"
    assert any("doesn't match any real option" in f for f in result.flags)


def test_single_select_valid_answer_key_is_not_flagged_for_that_reason():
    q = _q(
        question_type="Single Select",
        stem="Which is largest?",
        option_a="10", option_b="20", option_c="30", option_d="40",
        correct_answer="D",
    )
    result = evaluate_question(q)
    assert result.status != "FLAGGED"


def test_multi_select_valid_letters():
    q = _q(
        question_type="Multi Select",
        stem="Select all even numbers.",
        option_a="2", option_b="3", option_c="4", option_d="5",
        correct_answer="A,C",
    )
    result = evaluate_question(q)
    assert result.status != "FLAGGED"


def test_blocked_term_in_stem_is_flagged():
    q = _q(stem="This is a stupid shit question about numbers.", correct_answer="4")
    result = evaluate_question(q)
    assert result.status == "FLAGGED"
    assert any("blocked term" in f for f in result.flags)


def test_clean_unverifiable_question_is_unverified_not_clean():
    """No math verifier applies to a free-form word problem like this --
    it must NOT be silently treated as verified-correct."""
    q = _q(
        question_type="Constructed Response",
        stem="Explain why 50,000 is greater than 9,999 in one sentence.",
        correct_answer="It has more digits.",
    )
    result = evaluate_question(q)
    assert result.status == "UNVERIFIED"


# --- math-pattern verifiers (values taken from real Chapter 1 content) -----


def test_arithmetic_sequence_correct():
    q = _q(stem="Continue the pattern: 2,350, 2,450, 2,550, ___.", correct_answer="2650")
    result = evaluate_question(q)
    assert result.status == "VERIFIED"
    assert result.verified_by == "arithmetic_sequence"


def test_arithmetic_sequence_wrong_answer_is_flagged():
    q = _q(stem="Continue the pattern: 2,350, 2,450, 2,550, ___.", correct_answer="2700")
    result = evaluate_question(q)
    assert result.status == "FLAGGED"
    assert any("does not match" in f for f in result.flags)


def test_arithmetic_sequence_single_select_checks_the_option_text():
    q = _q(
        question_type="Single Select",
        stem="Which number comes next? 4,275, 4,475, 4,675, ___.",
        option_a="4,775", option_b="4,825", option_c="4,875", option_d="5,075",
        correct_answer="C",
    )
    result = evaluate_question(q)
    assert result.status == "VERIFIED"


def test_rounding_nearest_10():
    q = _q(stem="Round 4,236 to the nearest 10.", correct_answer="4240")
    assert evaluate_question(q).status == "VERIFIED"


def test_rounding_half_up_convention():
    # 6,150 to the nearest 100 -- remainder is exactly half (50/100), CBSE
    # convention (and the real content) rounds half UP, not to even.
    q = _q(stem="Round 6,150 to the nearest 100.", correct_answer="6200")
    assert evaluate_question(q).status == "VERIFIED"


def test_rounding_wrong_is_flagged():
    q = _q(stem="Round 2,346 to the nearest 100.", correct_answer="2400")  # real answer is 2300
    result = evaluate_question(q)
    assert result.status == "FLAGGED"


def test_place_value():
    q = _q(stem="What is the place value of 7 in 47,326?", correct_answer="7000")
    assert evaluate_question(q).status == "VERIFIED"


def test_face_value():
    q = _q(stem="What is the face value of 8 in 18,405?", correct_answer="8")
    assert evaluate_question(q).status == "VERIFIED"


def test_place_value_ambiguous_digit_is_unverified_not_guessed():
    # digit 7 appears twice -- the verifier must not guess which one
    q = _q(stem="What is the place value of 7 in 77,326?", correct_answer="70000")
    assert evaluate_question(q).status == "UNVERIFIED"


def test_digit_in_place():
    q = _q(stem="Which digit is in the hundreds place in 62,781?", correct_answer="7")
    assert evaluate_question(q).status == "VERIFIED"


def test_immediately_after_whole_number():
    q = _q(stem="What whole number comes immediately after 28,999?", correct_answer="29000")
    assert evaluate_question(q).status == "VERIFIED"


def test_immediately_before_inside_pattern_context_is_not_misapplied():
    """Regression test for a real false positive caught while building this:
    the generic 'immediately before' phrasing also shows up inside an
    arithmetic-pattern question, where it means 'the previous term in that
    pattern' (step 275), not N-1. The verifier must recognize this isn't a
    plain predecessor question (no "whole number" phrasing) and back off,
    leaving the correct stored answer unverified rather than flagging it as
    wrong."""
    q = _q(
        stem="A pattern adds 275 each time and ends ..., 6,250, 6,525. What number comes immediately before 6,250?",
        correct_answer="5975",
    )
    result = evaluate_question(q)
    assert result.status != "FLAGGED"


def test_complete_groups():
    q = _q(stem="How many complete groups of 10 are there in 7,934?", correct_answer="793")
    assert evaluate_question(q).status == "VERIFIED"


def test_ordering_increasing():
    q = _q(
        question_type="Ordering",
        stem="Arrange in increasing order: 19,900; 19,009; 18,990; 19,090.",
        correct_answer="18990;19009;19090;19900",
    )
    assert evaluate_question(q).status == "VERIFIED"


def test_digit_swap_literal():
    q = _q(stem="Swap the digits 2 and 7 in 27,461. What number is formed?", correct_answer="72461")
    assert evaluate_question(q).status == "VERIFIED"


def test_digit_swap_make_as_large_as_possible():
    q = _q(stem="Make 48,237 as large as possible by swapping exactly two digits once.", correct_answer="84237")
    assert evaluate_question(q).status == "VERIFIED"


def test_unit_conversion_kg_to_grams():
    q = _q(stem="Convert 2 kg to grams.", correct_answer="2000")
    assert evaluate_question(q).status == "VERIFIED"


def test_unit_conversion_wrong_is_flagged():
    q = _q(stem="Convert 2 kg to grams.", correct_answer="200")
    assert evaluate_question(q).status == "FLAGGED"


def test_unit_conversion_mismatched_families_is_unverified():
    q = _q(stem="Convert 2 kg to millilitres.", correct_answer="2000")
    assert evaluate_question(q).status == "UNVERIFIED"


# --- duplicate detection (real Chapter 1 regression cases) -----------------


def test_true_duplicate_same_stem_and_options_is_flagged():
    q1 = _q(id="d1", code="Q1", question_type="Single Select", stem="Which is largest?",
            option_a="1", option_b="2", option_c="3", option_d="4", correct_answer="D")
    q2 = _q(id="d2", code="Q2", question_type="Single Select", stem="Which is largest?",
            option_a="1", option_b="2", option_c="3", option_d="4", correct_answer="D")
    results = run_quality_checks([q1, q2])
    assert results["d1"].status == "FLAGGED"
    assert results["d2"].status == "FLAGGED"


def test_same_generic_stem_different_options_is_not_a_false_duplicate():
    """Regression test for a real false positive: 'Which number is
    greatest?' legitimately appears many times across Chapter 1 with
    completely different option sets and different correct answers --
    that's normal content design (the options carry the actual question),
    not a copy-paste bug, and must not be flagged as a duplicate."""
    q1 = _q(id="g1", code="Q042", question_type="Single Select", stem="Which number is greatest?",
            option_a="45,809", option_b="45,890", option_c="45,098", option_d="44,999", correct_answer="B")
    q2 = _q(id="g2", code="Q244", question_type="Single Select", stem="Which number is greatest?",
            option_a="71,099", option_b="70,999", option_c="71,909", option_d="71,990", correct_answer="D")
    duplicates = find_duplicate_question_ids([q1, q2])
    assert duplicates == {}
