"""The unit a question asks for, read from its own wording (13 Oct 2026).

Shailesh, 13 Oct 2026: "by seeing the question you can easily make out the
correct unit for the right answer". Decided the same day: only where the
question itself says which unit the answer is in. A best guess from the
units a question mentions is never made, because a wrong guess would mark a
child wrong for writing the right unit. So this answers for wording such as

    "Find the elapsed time in minutes."       -> min
    "2 km equals how many metres?"            -> m
    "Convert 420 seconds to minutes."         -> min
    "Find the total patch area in cm²."       -> cm2
    "Find metres per roll."                   -> m

and says nothing (None) for "Find its length." (which unit?), "How many
children ...?" (a count, no unit) or "A double number line shows 1 m
aligned with 100 cm. What value aligns with 3 m?".

Read only when a question's unit rule is Stated or Required and no Answer
Unit is recorded (learning_service.marking_rule). A recorded Answer Unit --
Ashalatha's, from the workbook or Curriculum Studio -- always wins.

Checked against all 1,270 "unit stated" Class 5 questions: 380 get a unit,
every one of them read by hand (tests/test_unit_reader.py holds the
patterns, with the real wording).
"""
import re

from app.services.units import unit_code

# A unit as a question writes it: "square centimetres", "sq cm", "cm²", or
# one word ("grams", "km", "min").
_UNIT = r"(square\s+(?:centi|milli)?met(?:re|er)s?|sq\.?\s*(?:cm|m|mm)|cm²|m²|mm²|cm2|m2|mm2|[a-zA-Z]+)"
# Words that may sit between "how many" and the unit without changing it.
_ADJ = r"(?:(?:more|fewer|complete|whole|full|total|extra|equal|exact)\s+)*"
# After "how many <unit>", the word that shows the unit is the answer's: a
# verb, a comparison or a preposition ("how many metres are cut", "how many
# minutes longer is", "how many seconds have passed", "how many minutes
# past the hour"). Any other word means the unit word describes something
# counted ("how many metre sticks", "how many rupee coins") or is half of a
# rate ("how many km per hour"): no unit is read. Found in review, 13 Oct.
_FOLLOWS_A_UNIT = {
    "", "are", "is", "was", "were", "be", "been", "does", "do", "did", "has", "have", "had", "must", "should",
    "can", "could", "will", "would", "may", "might", "longer", "shorter", "farther", "further", "higher", "lower",
    "heavier", "lighter", "more", "less", "fewer", "remain", "remains", "remained", "pass", "passes", "passed",
    "elapse", "elapsed", "of", "in", "take", "takes", "took", "after", "before", "past", "altogether", "there",
    "it", "this", "that", "make", "makes", "spent", "until", "from", "since", "between", "to", "left", "apart",
    "away", "long", "old", "using",
}
# One letter is too ambiguous to read from a question ("in m" may mean
# minutes): never read. A child's "5 m" is a different matter (units.reads_as).
_TOO_SHORT = {"m", "s", "h", "l", "g", "p"}
# Instructions that may name the answer's unit outside the asking sentence.
_INSTRUCTION = re.compile(r"^(?:give|answer|write|express|round|convert|find|state|record)\b", re.I)
_COUNT = "COUNT"
# "each hour", "every minute", "per second", "km an hour": the answer is
# a rate, whose unit is two units ("km per hour"). Not "each section".
_TIME_WORD = r"(?:hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|weeks?)\b"
_RATE = re.compile(
    r"\b(?:each|every|per)\s+" + _TIME_WORD
    # "60 km an hour", but not a quantity: "half a minute", "in an hour".
    + r"|(?<!half )(?<!quarter )(?<!\bin )(?<!\bof )(?<!\bfor )\ban?\s+" + _TIME_WORD,
    re.I,
)
_UNCLEAR = "UNCLEAR"  # a one-letter unit where the answer's unit is named


def _strip_title(stem: str) -> str:
    """Drops a generated topic title ("Adding distances in km and m --
    practice variation 16: ..."), whose units are not the question's."""
    return re.sub(r"^.*?(?:practice variation \d+|case study[^:]*):\s*", "", stem.strip(), flags=re.I)


def _sentences(stem: str) -> list[str]:
    text = _strip_title(stem)
    # Full stops that do not end a sentence: "a.m.", "p.m.", "Rs.", "approx."
    text = re.sub(r"\b(a|p)\.m\.", r"\1m", text, flags=re.I)
    text = re.sub(r"\b(rs|approx|no|sq|hr|hrs|min|mins|sec|secs|kg|km|cm|mm)\.", r"\1", text, flags=re.I)
    return [p.strip() for p in re.split(r"(?<=[.?!])\s+", text) if p.strip()]


def _code(text: str) -> str | None:
    """A unit code; _UNCLEAR for a one-letter unit ("in m" may be minutes);
    None when the text is not a unit."""
    code = unit_code(text)
    if code is None:
        return None
    return _UNCLEAR if text.strip().lower().rstrip(".") in _TOO_SHORT else code


def _read(sentence: str) -> str | None:
    """A unit code, _COUNT when the sentence asks for a count, _UNCLEAR when
    it names the answer's unit by one letter, or None."""
    # "... in minutes." / "... in total seconds?" / ", in millimetres." An
    # explicit "in <unit>" ending the sentence decides, even after "how many
    # complete hours and extra minutes ... in total minutes?".
    for m in re.finditer(r"\bin\s+(?:total\s+|whole\s+)?" + _UNIT + r"\s*(?:[?.!]?\s*$|,)", sentence, re.I):
        code = _code(m.group(1))
        if code:
            return code
    # "how many (more/complete/...) (square) <word> <next>": a unit, or a count.
    m = re.search(r"\bhow many\s+" + _ADJ + r"(square\s+)?([\w²-]+)(?:\s*(/|[\w-]+))?", sentence, re.I)
    if m:
        word, following = m.group(2), (m.group(3) or "").lower()
        if "-" in word or word[0].isdigit():
            return _COUNT  # "five-minute jumps", "1 cm² patches"
        code = _code(("square " if m.group(1) else "") + word)
        if code is None:
            return _COUNT  # "children", "jumps"
        if following not in _FOLLOWS_A_UNIT:
            return _COUNT
        rest = sentence[m.end(2):]
        if re.match(r"\s*(?:,|and\b|or\b)", rest, re.I):
            return _UNCLEAR  # "how many hours, minutes and seconds": more than one unit
        if _RATE.search(sentence):
            return _UNCLEAR  # "how many km does it travel each hour": a rate
        return code
    # "Find the difference in minutes between ..."
    m = re.search(r"\bin\s+" + _UNIT + r"\s+between\b", sentence, re.I)
    if m and _code(m.group(1)):
        return _code(m.group(1))
    # "Convert 420 seconds to minutes." / "... to total seconds."
    m = re.search(r"\bto\s+(?:total\s+)?" + _UNIT + r"\s*[?.]?\s*$", sentence, re.I)
    if m and _code(m.group(1)) and re.search(r"\b(?:convert|change|express|write)\b", sentence, re.I):
        return _code(m.group(1))
    # "Find metres per roll."
    m = re.search(r"\b(?:find|what is)\s+(?:the\s+)?" + _UNIT + r"\s+(?:per|for)\b", sentence, re.I)
    if m and _code(m.group(1)):
        return _code(m.group(1))
    return None


def answer_unit_from_question(stem: str | None) -> str | None:
    """The unit code the question asks for (units.UNITS), or None when the
    question does not say, says two different things, or asks for a count."""
    if not stem or not stem.strip():
        return None
    sentences = _sentences(stem)
    if not sentences:
        return None
    asks = [p for p in sentences if p.endswith("?")]
    asking = asks[-1] if asks else sentences[-1]
    found = set()
    for sentence in sentences:
        if sentence is not asking and not _INSTRUCTION.match(sentence):
            continue  # a statement's units are not the answer's
        read = _read(sentence)
        if read == _COUNT and sentence is asking:
            return None  # the question asks for a count
        if read == _UNCLEAR:
            return None  # "Give your answer in m.": metres or minutes?
        if read and read != _COUNT:
            found.add(read)
    # Two sentences naming two units ("How many minutes? Answer in
    # seconds."): the question does not say one thing, so nothing is read.
    return found.pop() if len(found) == 1 else None
