"""Automated question quality checks -- the free (no external API) safety net
Shailesh asked for on 18 Aug 2026, after seeing how many questions there are
to review by hand (~500/chapter x 15 chapters) and being explicit that
nothing wrong or inappropriate can reach students, but that there's no
budget right now for a paid per-question AI review pass.

Two layers, both deterministic and free to run:

1. Structural checks (`_structural_flags`) -- data-integrity problems any
   question can have regardless of type: empty stem/answer, a Single/Multi
   Select correct_answer that doesn't actually name a real option (the
   single most common real "wrong answer key" bug), missing options,
   obviously too-short content, a lightweight inappropriate-language
   keyword scan. These are 100% reliable for what they check.

2. Math-pattern verifiers (`_MATH_VERIFIERS`) -- for question archetypes
   that follow a computable pattern (arithmetic sequences, rounding,
   place/face value, digit swaps, ordering, "complete groups of N"), the
   verifier actually computes the right answer from the stem and compares
   it to what's stored. This catches genuinely WRONG answers, not just
   missing data -- something no structural check can do. Verified against
   real Chapter 1 content (Content/CBSE_Class_5_Chapter_1.xlsx) while being
   built, not guessed at.

Honesty matters here more than usual: these two layers cannot mathematically
guarantee catching every possible error (an AI or human reviewer can't
either, for what it's worth) -- what they guarantee is that anything they
DO check is checked with 100% precision, and anything they can't check is
never silently treated as "fine". Three statuses, not two:

  - FLAGGED     -- a structural problem, OR a verifier proved the stored
                   answer is mathematically wrong. Always needs a human.
  - VERIFIED    -- structurally clean AND a verifier proved the stored
                   answer is correct. Safe to bulk-approve.
  - UNVERIFIED  -- structurally clean, but no verifier applies (open-ended
                   word problems, "Constructed Response" rubric questions,
                   comparison/explanation Single-Select items, etc.). NOT
                   the same as VERIFIED and never silently bulk-approved as
                   part of the default "approve all clean" action -- see
                   routes_curriculum_admin.py's bulk-approve endpoint.

Duplicate detection (`find_duplicate_question_ids`) needs sibling context
(other questions in the same lesson), so it's a separate pass over a list
rather than a single-question check.
"""
import re
from dataclasses import dataclass, field

from app.models import Question

# --- structural checks -----------------------------------------------------

_OPTION_LETTERS = ("A", "B", "C", "D")

# Deliberately short and conservative -- a first defensive net, not a claim
# of comprehensive content-moderation coverage (see module docstring's
# honesty note). Anything here is unambiguously inappropriate for a
# children's learning product regardless of context.
_BLOCKED_TERMS = (
    "fuck", "shit", "bitch", "asshole", "bastard", "cunt", "porn", "sex",
    "kill yourself", "suicide", "rape", "nazi", "terrorist",
)


def _contains_blocked_term(text: str | None) -> str | None:
    if not text:
        return None
    lowered = text.lower()
    for term in _BLOCKED_TERMS:
        if term in lowered:
            return term
    return None


def _structural_flags(question: Question) -> list[str]:
    flags: list[str] = []

    stem = (question.stem or "").strip()
    if not stem:
        flags.append("Question text (stem) is empty.")
    elif len(stem) < 5:
        flags.append(f"Question text is suspiciously short: {stem!r}.")

    correct_answer = (question.correct_answer or "").strip()
    if not correct_answer:
        flags.append("Correct answer is empty.")

    options = {
        "A": question.option_a,
        "B": question.option_b,
        "C": question.option_c,
        "D": question.option_d,
    }
    non_empty_options = {k: v for k, v in options.items() if v and str(v).strip()}

    question_type = (question.question_type or "").strip()
    if question_type in ("Single Select", "Multi Select"):
        if len(non_empty_options) < 2:
            flags.append(f"{question_type} question has fewer than 2 options.")

        letters = [part.strip().upper() for part in correct_answer.split(",") if part.strip()]
        if question_type == "Single Select" and len(letters) != 1:
            flags.append(f"Single Select correct answer should name exactly one option letter, got {correct_answer!r}.")
        for letter in letters:
            if letter not in _OPTION_LETTERS:
                flags.append(f"Correct answer {letter!r} is not a valid option letter (A-D).")
            elif letter not in non_empty_options:
                flags.append(f"Correct answer points at option {letter}, but option {letter} is empty -- the answer key doesn't match any real option.")

    if question.marks is not None and question.marks < 1:
        flags.append(f"Marks is {question.marks}, expected at least 1.")

    for label, text in [("stem", question.stem), ("option A", question.option_a), ("option B", question.option_b),
                         ("option C", question.option_c), ("option D", question.option_d),
                         ("explanation", question.explanation), ("hint", question.hint)]:
        term = _contains_blocked_term(text)
        if term:
            flags.append(f"{label} contains a blocked term ({term!r}) -- needs human review before this can be approved.")

    return flags


def find_duplicate_question_ids(questions: list[Question]) -> dict[str, str]:
    """Questions with an identical (case/space-insensitive) stem AND
    identical options within the same batch are almost certainly a
    copy-paste duplication, not two intentionally-similar questions.

    Deliberately keys on stem + all four options together, not stem alone --
    real content reuses short generic stems like "Which number is
    greatest?" or "Which statement is true?" across many DIFFERENT
    questions, distinguishing them entirely through the option values
    (confirmed against real Chapter 1 data: "Which number is greatest?"
    appears 2x with completely different options and different correct
    answers -- that's normal content design, not a bug, and keying on stem
    alone flagged it as a false-positive duplicate). Only a match on the
    full stem+options tuple is a real duplicate worth a human's attention.

    Returns {question_id: reason} for every question involved in a
    duplicate group (not just the second occurrence), so both/all copies
    get flagged for a human to decide which one is correct.
    """
    by_key: dict[tuple, list[Question]] = {}
    for q in questions:
        stem_key = re.sub(r"\s+", " ", (q.stem or "").strip().lower())
        if not stem_key:
            continue
        options_key = tuple(
            re.sub(r"\s+", " ", str(opt or "").strip().lower())
            for opt in (q.option_a, q.option_b, q.option_c, q.option_d)
        )
        by_key.setdefault((stem_key, options_key), []).append(q)

    result: dict[str, str] = {}
    for (stem_key, _options_key), group in by_key.items():
        if len(group) > 1:
            codes = ", ".join(q.code for q in group)
            for q in group:
                result[q.id] = f"Duplicate question (same text and options) shared with: {codes}."
    return result


# --- math-pattern verifiers --------------------------------------------------
# Each verifier takes (stem, question) and returns:
#   True  -- pattern matched, computed answer agrees with the stored one
#   False -- pattern matched, computed answer DISAGREES (a real error)
#   None  -- pattern doesn't apply to this stem, try the next verifier


def _to_int(text: str) -> int | None:
    cleaned = text.replace(",", "").strip()
    if not cleaned or not re.fullmatch(r"-?\d+", cleaned):
        return None
    return int(cleaned)


def _normalize_answer_numbers(text: str) -> list[str]:
    """Correct answers/accepted variants can be a single number, or several
    separated by ';' (Text Entry multi-blank, Ordering). Strip commas and
    whitespace from each so '2,650' and '2650' compare equal."""
    return [part.replace(",", "").strip() for part in text.split(";") if part.strip()]


def _answer_matches(computed: list[int], question: Question) -> bool:
    computed_strs = [str(c) for c in computed]
    for candidate in [question.correct_answer] + (question.accepted_variants or "").split("|"):
        if not candidate:
            continue
        if _normalize_answer_numbers(candidate) == computed_strs:
            return True
    return False


def _verify_arithmetic_sequence(stem: str, question: Question) -> bool | None:
    if "pattern" not in stem.lower() and "comes next" not in stem.lower():
        return None
    numbers = re.findall(r"-?[\d,]+(?:\.\d+)?", stem)
    parsed = [_to_int(n) for n in numbers]
    parsed = [n for n in parsed if n is not None]
    if len(parsed) < 3:
        return None
    diffs = [parsed[i + 1] - parsed[i] for i in range(len(parsed) - 1)]
    if len(set(diffs)) != 1:
        return None  # not a constant-difference sequence -- don't guess
    diff = diffs[0]
    blanks = stem.count("___")
    if blanks < 1:
        blanks = 1
    next_terms = [parsed[-1] + diff * (i + 1) for i in range(blanks)]

    if (question.question_type or "").strip() == "Single Select":
        # The blank is one of the options, not a typed number -- check the
        # option the correct_answer letter points at instead of the stored
        # correct_answer string itself.
        options = {"A": question.option_a, "B": question.option_b, "C": question.option_c, "D": question.option_d}
        letter = (question.correct_answer or "").strip().upper()
        option_text = options.get(letter)
        if option_text is None:
            return None
        option_number = _to_int(str(option_text))
        if option_number is None:
            return None
        return option_number == next_terms[0]

    return _answer_matches(next_terms, question)


def _round_half_up(value: int, unit: int) -> int:
    remainder = value % unit
    if remainder * 2 >= unit:
        return value - remainder + unit
    return value - remainder


def _verify_rounding(stem: str, question: Question) -> bool | None:
    match = re.search(r"[Rr]ound\s+([\d,]+)\s+to the nearest\s+([\d,]+)", stem)
    if not match:
        return None
    value = _to_int(match.group(1))
    unit = _to_int(match.group(2))
    if value is None or not unit:
        return None
    expected = _round_half_up(value, unit)
    return _answer_matches([expected], question)


def _verify_place_and_face_value(stem: str, question: Question) -> bool | None:
    match = re.search(r"(place|face) value of\s+(\d)\s+in\s+([\d,]+)", stem, re.IGNORECASE)
    if not match:
        return None
    kind, digit_str, number_str = match.groups()
    digit = digit_str
    number = number_str.replace(",", "")
    positions = [i for i, ch in enumerate(reversed(number)) if ch == digit]
    if len(positions) != 1:
        return None  # digit appears 0 or >1 times -- ambiguous, don't guess
    if kind.lower() == "face":
        expected = int(digit)
    else:
        expected = int(digit) * (10 ** positions[0])
    return _answer_matches([expected], question)


_PLACE_NAMES = {
    "units": 0, "ones": 0, "tens": 1, "hundreds": 2, "thousands": 3,
    "ten thousands": 4, "lakhs": 5,
}


def _verify_digit_in_place(stem: str, question: Question) -> bool | None:
    match = re.search(r"which digit is in the ([a-z ]+?) place in\s+([\d,]+)", stem, re.IGNORECASE)
    if not match:
        return None
    place_name, number_str = match.groups()
    position = _PLACE_NAMES.get(place_name.strip().lower())
    if position is None:
        return None
    number = number_str.replace(",", "")
    if position >= len(number):
        return None
    digit = int(number[len(number) - 1 - position])
    return _answer_matches([digit], question)


def _verify_immediately_before_after(stem: str, question: Question) -> bool | None:
    # Deliberately requires "whole number" -- confirmed against real Chapter
    # 1 content that plain predecessor/successor questions are always
    # phrased "What whole number comes immediately after/before N?", while
    # "immediately before/after" can ALSO appear inside an arithmetic-
    # pattern question ("A pattern adds 275 each time ... What number comes
    # immediately before 6,250?"), where the correct answer is the previous
    # TERM IN THAT PATTERN (N minus the step), not N-1. Without this guard
    # this verifier misread a real, correctly-answered pattern question as
    # wrong -- caught by testing against the real data before shipping.
    if "whole number" not in stem.lower():
        return None
    after = re.search(r"immediately after\s+([\d,]+)", stem, re.IGNORECASE)
    if after:
        n = _to_int(after.group(1))
        if n is None:
            return None
        return _answer_matches([n + 1], question)
    before = re.search(r"immediately before\s+([\d,]+)", stem, re.IGNORECASE)
    if before:
        n = _to_int(before.group(1))
        if n is None:
            return None
        return _answer_matches([n - 1], question)
    return None


def _verify_complete_groups(stem: str, question: Question) -> bool | None:
    match = re.search(r"complete groups of\s+([\d,]+)\s+are there in\s+([\d,]+)", stem, re.IGNORECASE)
    if not match:
        return None
    group_size = _to_int(match.group(1))
    total = _to_int(match.group(2))
    if not group_size or total is None:
        return None
    return _answer_matches([total // group_size], question)


def _verify_ordering(stem: str, question: Question) -> bool | None:
    if (question.question_type or "").strip() != "Ordering":
        return None
    match = re.search(r"[Aa]rrange in (increasing|decreasing) order:\s*(.+)", stem)
    if not match:
        return None
    direction, rest = match.groups()
    numbers = [_to_int(n) for n in re.findall(r"-?[\d,]+", rest)]
    numbers = [n for n in numbers if n is not None]
    if len(numbers) < 2:
        return None
    ordered = sorted(numbers, reverse=(direction == "decreasing"))
    expected_str = ";".join(str(n) for n in ordered)
    for candidate in [question.correct_answer] + (question.accepted_variants or "").split("|"):
        if not candidate:
            continue
        if candidate.replace(",", "").strip() == expected_str:
            return True
    return False


def _best_swap_value(number: str, want_max: bool) -> int | None:
    """Brute-forces every pair of digit positions (a 4-6 digit number has at
    most 15 pairs, entirely tractable) to find the largest/smallest value
    reachable by swapping exactly two digits once."""
    best = None
    digits = list(number)
    for i in range(len(digits)):
        for j in range(i + 1, len(digits)):
            if i == 0 and digits[j] == "0":
                continue  # would create a leading zero -- not a valid swap result
            swapped = digits.copy()
            swapped[i], swapped[j] = swapped[j], swapped[i]
            candidate = int("".join(swapped))
            if best is None or (want_max and candidate > best) or (not want_max and candidate < best):
                best = candidate
    return best


def _verify_digit_swap(stem: str, question: Question) -> bool | None:
    # "Make N as large/small as possible by swapping exactly two digits" --
    # no specific digits are named, so brute-force over every position pair
    # rather than trying to parse which two digits are involved.
    optimize_match = re.search(
        r"[Mm]ake\s+([\d,]+)\s+as (large|small) as possible by swapping (?:exactly )?two digits",
        stem,
    )
    if optimize_match:
        number_str, direction = optimize_match.groups()
        number = number_str.replace(",", "")
        best = _best_swap_value(number, want_max=(direction == "large"))
        if best is None:
            return None
        return _answer_matches([best], question)

    match = re.search(r"[Ss]wap the digits\s+(\d)\s+and\s+(\d)\s+in\s+([\d,]+)", stem)
    if not match:
        match = re.search(r"[Ii]n\s+([\d,]+),\s*swap the digits\s+(\d)\s+and\s+(\d)", stem)
        if match:
            number_str, d1, d2 = match.groups()
        else:
            return None
    else:
        d1, d2, number_str = match.groups()

    number = number_str.replace(",", "")
    if d1 not in number or d2 not in number:
        return None

    # Literal "swap digit d1 and d2" -- swap the first occurrence of each.
    digits = list(number)
    i1 = digits.index(d1)
    i2 = digits.index(d2)
    if i1 == i2:
        return None
    digits[i1], digits[i2] = digits[i2], digits[i1]
    if digits[0] == "0":
        return None  # ambiguous leading-zero case, don't guess
    return _answer_matches([int("".join(digits))], question)


# Fixed, unambiguous metric conversion factors -- Class 5 measurement
# content (verified against real Weight and Capacity chapter content).
_UNIT_TO_GRAMS = {"mg": 0.001, "g": 1, "kg": 1000, "quintal": 100000, "quintals": 100000, "tonne": 1_000_000, "tonnes": 1_000_000}
_UNIT_TO_ML = {"ml": 1, "l": 1000, "litre": 1000, "litres": 1000, "liter": 1000, "liters": 1000}
_UNIT_ALIASES = {
    "kilograms": "kg", "grams": "g", "milligrams": "mg", "millilitres": "ml", "milliliters": "ml",
}


def _verify_unit_conversion(stem: str, question: Question) -> bool | None:
    match = re.search(
        r"[Cc]onvert\s+([\d.,]+)\s+([a-zA-Z]+)\s+to\s+([a-zA-Z]+)", stem
    )
    if not match:
        return None
    amount_str, from_unit, to_unit = match.groups()
    from_unit = _UNIT_ALIASES.get(from_unit.lower(), from_unit.lower())
    to_unit = _UNIT_ALIASES.get(to_unit.lower(), to_unit.lower())
    try:
        amount = float(amount_str.replace(",", ""))
    except ValueError:
        return None

    if from_unit in _UNIT_TO_GRAMS and to_unit in _UNIT_TO_GRAMS:
        result = amount * _UNIT_TO_GRAMS[from_unit] / _UNIT_TO_GRAMS[to_unit]
    elif from_unit in _UNIT_TO_ML and to_unit in _UNIT_TO_ML:
        result = amount * _UNIT_TO_ML[from_unit] / _UNIT_TO_ML[to_unit]
    else:
        return None  # mismatched unit families (e.g. mass vs volume) -- don't guess

    if abs(result - round(result)) < 1e-9:
        return _answer_matches([round(result)], question)
    return None  # non-integer result -- comparing against a float-formatted answer isn't reliable enough to assert


_MATH_VERIFIERS = (
    _verify_arithmetic_sequence,
    _verify_rounding,
    _verify_place_and_face_value,
    _verify_digit_in_place,
    _verify_immediately_before_after,
    _verify_complete_groups,
    _verify_ordering,
    _verify_digit_swap,
    _verify_unit_conversion,
)


@dataclass
class QualityResult:
    status: str  # "FLAGGED" | "VERIFIED" | "UNVERIFIED"
    flags: list[str] = field(default_factory=list)
    verified_by: str | None = None


def evaluate_question(question: Question) -> QualityResult:
    flags = _structural_flags(question)

    stem = question.stem or ""
    verifier_outcome = None
    verifier_name = None
    for verifier in _MATH_VERIFIERS:
        outcome = verifier(stem, question)
        if outcome is not None:
            verifier_outcome = outcome
            verifier_name = verifier.__name__.removeprefix("_verify_")
            break

    if verifier_outcome is False:
        flags.append(
            f"Computed answer does not match the stored correct answer ({question.correct_answer!r}) "
            f"-- checked by the {verifier_name} pattern."
        )

    if flags:
        return QualityResult(status="FLAGGED", flags=flags)
    if verifier_outcome is True:
        return QualityResult(status="VERIFIED", verified_by=verifier_name)
    return QualityResult(status="UNVERIFIED")


def run_quality_checks(questions: list[Question]) -> dict[str, QualityResult]:
    """Evaluates every question independently, then layers duplicate
    detection across the whole batch on top (duplicates can't be detected
    one question at a time). Returns {question_id: QualityResult}; does not
    write to the DB or commit -- callers decide when/whether to persist."""
    results = {q.id: evaluate_question(q) for q in questions}
    duplicates = find_duplicate_question_ids(questions)
    for question_id, reason in duplicates.items():
        result = results[question_id]
        result.status = "FLAGGED"
        if reason not in result.flags:
            result.flags.append(reason)
    return results
