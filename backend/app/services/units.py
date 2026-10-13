"""Units and measured answers (Phase 4, #164, 13 Oct 2026).

Ashalatha's clarification note, item 5 (PROJECT_REFERENCE.md Section 7):
the number, the unit and the rounding of a measured answer are checked
separately; common spellings are accepted (metre, meter, m); one unit is
changed into another only when the question allows it; only the final
answer is rounded, and a 5 rounds up; the allowed difference for a reading
is set per question.

This module only reads text and does arithmetic. It knows nothing about
questions or marks: learning_service.grade_answer decides what an answer is
worth. Kept free of the database so every rule here is tested directly.

Arithmetic is Decimal, never float, so 0.1 + 0.2 is 0.3 and a tolerance of
0.05 means exactly 0.05.
"""
import re
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation, localcontext


@dataclass(frozen=True)
class Unit:
    code: str  # stored on the question, e.g. "g"
    kind: str  # only units of one kind convert into each other
    factor: Decimal  # how many of the kind's base unit one of these is
    singular: str  # as a person reads it: "gram"
    plural: str  # "grams"


def _u(code, kind, factor, singular, plural):
    return Unit(code, kind, Decimal(factor), singular, plural)


# The kinds a Class 5 to 10 Maths or Science answer is measured in. Base
# units: metre, gram, millilitre, second, rupee, degree, square centimetre,
# percent.
UNITS: dict[str, Unit] = {
    u.code: u
    for u in (
        _u("mm", "length", "0.001", "millimetre", "millimetres"),
        _u("cm", "length", "0.01", "centimetre", "centimetres"),
        _u("m", "length", "1", "metre", "metres"),
        _u("km", "length", "1000", "kilometre", "kilometres"),
        _u("mg", "mass", "0.001", "milligram", "milligrams"),
        _u("g", "mass", "1", "gram", "grams"),
        _u("kg", "mass", "1000", "kilogram", "kilograms"),
        _u("ml", "capacity", "1", "millilitre", "millilitres"),
        _u("l", "capacity", "1000", "litre", "litres"),
        _u("s", "time", "1", "second", "seconds"),
        _u("min", "time", "60", "minute", "minutes"),
        _u("h", "time", "3600", "hour", "hours"),
        _u("rupee", "money", "1", "rupee", "rupees"),
        _u("paise", "money", "0.01", "paisa", "paise"),
        _u("degree", "angle", "1", "degree", "degrees"),
        _u("mm2", "area", "0.01", "square millimetre", "square millimetres"),
        _u("cm2", "area", "1", "square centimetre", "square centimetres"),
        _u("m2", "area", "10000", "square metre", "square metres"),
        _u("percent", "percent", "1", "percent", "percent"),
    )
}

# Every spelling a person might write, already in the form _alias_key()
# produces (lower case, no dots, single spaces). Both British and American
# spellings, singular and plural, symbols and the usual short forms.
_ALIASES: dict[str, str] = {}


def _add(code: str, *spellings: str) -> None:
    for spelling in spellings:
        _ALIASES[spelling] = code


_add("mm", "mm", "millimetre", "millimetres", "millimeter", "millimeters")
_add("cm", "cm", "centimetre", "centimetres", "centimeter", "centimeters", "cms")
_add("m", "m", "metre", "metres", "meter", "meters", "mtr", "mtrs")
_add("km", "km", "kilometre", "kilometres", "kilometer", "kilometers", "kms")
_add("mg", "mg", "milligram", "milligrams", "milligramme", "milligrammes")
_add("g", "g", "gm", "gms", "gram", "grams", "gramme", "grammes", "gr")
_add("kg", "kg", "kgs", "kilogram", "kilograms", "kilogramme", "kilogrammes", "kilo", "kilos")
_add("ml", "ml", "millilitre", "millilitres", "milliliter", "milliliters")
_add("l", "l", "litre", "litres", "liter", "liters", "ltr", "ltrs", "lt")
_add("s", "s", "sec", "secs", "second", "seconds")
_add("min", "min", "mins", "minute", "minutes")
_add("h", "h", "hr", "hrs", "hour", "hours")
_add("rupee", "rupee", "rupees", "rs", "inr", "₹")
_add("paise", "paise", "paisa", "p")
_add("degree", "degree", "degrees", "°", "deg")
_add("mm2", "mm²", "mm2", "mm^2", "sq mm", "square mm", "square millimetre", "square millimetres", "square millimeter", "square millimeters")
_add("cm2", "cm²", "cm2", "cm^2", "sq cm", "sqcm", "square cm", "square centimetre", "square centimetres", "square centimeter", "square centimeters")
_add("m2", "m²", "m2", "m^2", "sq m", "square m", "square metre", "square metres", "square meter", "square meters")
_add("percent", "%", "percent", "per cent", "pc")


def _alias_key(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace(".", " ").strip().lower()).strip()


def unit_code(text: str | None) -> str | None:
    """The unit a written unit means ("Metres", "kg.", "sq cm"), or None
    when it is not one this module knows."""
    if not text or not text.strip():
        return None
    key = _alias_key(text)
    if key in UNITS:
        return key
    return _ALIASES.get(key)


def unit_label(code: str | None, *, plural: bool = True) -> str | None:
    unit = UNITS.get(code or "")
    if unit is None:
        return None
    return unit.plural if plural else unit.singular


# A number as people write it in India: an optional sign, digits with any
# commas (1,00,000 or 100,000), an optional decimal part.
_NUMBER = r"[-+]?(?:\d[\d,]*)?(?:\.\d+)?"
_LEADING_MONEY = re.compile(r"^\s*(₹|rs\.?|inr)\s*", re.IGNORECASE)
_MEASURE = re.compile(r"^\s*(" + _NUMBER + r")\s*(.*?)\s*$")


# Longer than any measured answer in a school question, and well inside what
# Decimal arithmetic handles at its default precision.
MAX_DIGITS = 18


@dataclass(frozen=True)
class Measurement:
    number: Decimal
    unit: str | None  # a code from UNITS, or None when no unit was written
    written: str | None = field(default=None, compare=False)  # the unit as written, in _alias_key form ("m")


def parse_measurement(text: str | None) -> Measurement | None:
    """A written answer as a number and an optional unit, or None when it is
    not one number with at most one unit after it: "250", "250 g",
    "2.5 kg", "₹ 1,250", "45°", "12 cm²", "50 %". Anything else (two
    numbers, a mixed measure such as "2 kg 50 g", a unit this module does
    not know, plain words) is None: the caller then compares the text
    itself, as it always has."""
    if text is None:
        return None
    raw = text.strip()
    if not raw:
        return None
    leading_unit = None
    money = _LEADING_MONEY.match(raw)
    if money:
        leading_unit = "rupee"
        raw = raw[money.end():]
    match = _MEASURE.match(raw)
    if not match or not re.search(r"\d", match.group(1)):
        return None
    number_text, rest = match.group(1), match.group(2)
    if "," in number_text and not re.fullmatch(r"[-+]?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?", number_text):
        return None  # "1,2,3" is a list, not a number
    try:
        number = Decimal(number_text.replace(",", ""))
    except InvalidOperation:
        return None
    if not number.is_finite() or len(number.as_tuple().digits) > MAX_DIGITS:
        return None
    unit = None
    written = _alias_key(rest) if rest else ""
    if written:  # "250." is the number alone: a full stop is not a unit
        unit = unit_code(rest)
        if unit is None:
            return None
    if leading_unit:
        if unit not in (None, "rupee"):
            return None
        unit = "rupee"
    return Measurement(number=number, unit=unit, written=written or None)


def convert(number: Decimal, from_code: str, to_code: str) -> Decimal | None:
    """`number` of one unit expressed in another of the same kind, or None
    across kinds (grams cannot become metres)."""
    source, target = UNITS.get(from_code), UNITS.get(to_code)
    if source is None or target is None or source.kind != target.kind:
        return None
    return number * source.factor / target.factor


def round_half_up(number: Decimal, places: int) -> Decimal:
    """Rounded to `places` decimal places, a 5 going up (2.45 to 2.5 at one
    place), never the banker's rounding Python's round() does. Worked with
    enough precision for the number given, so a long one cannot overflow
    Decimal's default of 28 digits (found in review, 13 Oct 2026)."""
    with localcontext() as context:
        context.prec = max(28, number.adjusted() + places + 10)
        return number.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)


def numbers_match(given: Decimal, expected: Decimal, *, tolerance: Decimal | None, decimal_places: int | None) -> bool:
    """The answer's number against the key's: both rounded half up to
    `decimal_places` when it is set, then equal within `tolerance`. Anything
    Decimal cannot work with is "no match", never an error."""
    try:
        if decimal_places is not None:
            given = round_half_up(given, decimal_places)
            expected = round_half_up(expected, decimal_places)
        allowed = tolerance if tolerance is not None and tolerance > 0 else Decimal(0)
        with localcontext() as context:
            context.prec = 60
            return abs(given - expected) <= allowed
    except InvalidOperation:
        return False


# A spelling that is one unit in general but, beside an answer of another
# kind, plainly means that kind: a child writing "5 m" for minutes.
_READS_AS = {("m", "min"): "min"}


def reads_as(written: str | None, given_code: str | None, expected_code: str | None) -> str | None:
    """The unit a written spelling should be read as, given the unit the
    answer is in; the general reading otherwise."""
    return _READS_AS.get((written or "", expected_code or ""), given_code)
