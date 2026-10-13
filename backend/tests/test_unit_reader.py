"""The unit a question asks for, read from its wording (13 Oct 2026).

Every pattern here is Class 5 wording (CBSE-C5-CH05/11/12/14/15). A
unit is read only where the question itself says it; anything else is
None, so the question is marked as before.
"""
import pytest

from app.services.unit_reader import answer_unit_from_question as read


@pytest.mark.parametrize(
    "stem, unit",
    [
        # "in <unit>" at the end of a sentence
        ("An activity starts at 08:05 and ends at 08:17. Find the elapsed time in minutes.", "min"),
        ("A relay team completes two stages in 82 seconds and 85 seconds. Find the combined time in seconds.", "s"),
        ("A quilt uses 35 square patches, each with side 2 cm. Find the total patch area in cm².", "cm2"),
        ("A classroom floor is 9 m long and 4 m broad. Find its area in m².", "m2"),
        ("Find the difference between 20 mm and 1 cm, in millimetres.", "mm"),
        ("A programme begins at 07:35 and finishes at 08:55. How many complete hours and extra minutes does it last in total minutes?", "min"),
        ("Find the difference in minutes between 83 minutes and 1 hr 15 min.", "min"),
        ("Add 25 mm and 18 mm. Give the total in millimetres.", "mm"),
        # "how many <unit>"
        ("2 km equals how many metres?", "m"),
        ("2 m 20 cm equals how many centimetres?", "cm"),
        ("A timer shows 132 seconds. How many complete minutes does it contain?", "min"),
        ("How many more hours are spent sleeping than studying?", "h"),
        ("How many fewer kilograms were wasted for Khichdi than Paratha?", "kg"),
        ("A rectangle 7 cm by 4 cm is lengthened to 10 cm. By how many cm² does its area increase?", "cm2"),
        ("How many hours after 01:05 a.m. is 01:05 p.m.?", "h"),
        # "convert ... to <unit>"
        ("Convert 420 seconds to minutes.", "min"),
        ("Convert 1 minute 12 seconds to total seconds.", "s"),
        # "find <unit> per ..."
        ("100 m of ribbon is divided into 5 equal rolls. Find metres per roll.", "m"),
        # a generated title's units are not the question's
        ("Adding distances in km and m — practice variation 9: The same two distances total how many metres?", "m"),
        ("Case study — Kilometre race: A 3 km race is run in 2 laps. Find the length of one lap in metres.", "m"),
    ],
)
def test_the_unit_the_question_asks_for(stem, unit):
    assert read(stem) == unit


@pytest.mark.parametrize(
    "stem",
    [
        None,
        "",
        # counts: no unit
        "How many children wear glasses?",
        "Flags are placed every 50 m on a 3000 m route, beginning at 50 m and including the finish. How many flags are placed?",
        "How many five-minute jumps move the minute hand from 12 to 2?",
        "A workshop lasts 2 hours. How many 30-minute blocks does it contain?",
        "How many 1 cm² patches cover a square whose side is 9 cm?",
        "How many factors does 20 have?",
        # the question does not say which unit
        "A rectangle has area 35 cm² and breadth 5 cm. Find its length.",
        "Find the perimeter of a rectangle 10 cm long and 4 cm broad.",
        "A double number line shows 1 m aligned with 100 cm. What value aligns with 3 m?",
        "Cloth costs ₹160 for 8 m. Find the cost per metre.",
        "If 1 hour moves from Sleeping to Studying, what is the new studying time?",
        # square units are not a measuring unit
        "A quilt patch covers 6 rows of 8 unit squares. Find its area in square units.",
    ],
)
def test_nothing_is_guessed(stem):
    assert read(stem) is None


# --- Found in the independent review (13 Oct 2026) --------------------------


@pytest.mark.parametrize(
    "stem",
    [
        # a unit word describing what is counted
        "How many metre sticks are needed?",
        "How many rupee coins make ₹20?",
        "How many litre bottles fill the tank?",
        "How many kilogram bags are there?",
        "How many minute intervals are there?",
        "How many square centimetre tiles cover it?",
        # half of a rate
        "How many km per hour does the car travel?",
        "How many metres per second does it move?",
        "How many km/h is that?",
        # a count, with a unit only in a statement
        "The tank holds 50 l. It is measured in litres, then poured into jugs of 2 l. How many jugs?",
        # two units named for the answer
        "How many minutes? Answer in seconds.",
        # one letter: metres or minutes?
        "How many km long is the race? Give your answer in m.",
        "Ravi took 2 minutes 5 seconds. How long did the race take, in m?",
        "How many m is it?",
        # round 2 of the review
        "A car goes 120 km in 2 hours. How many km does the car travel each hour?",
        "How many hours, minutes and seconds does it last?",
        "How many km does the train cover an hour?",
    ],
)
def test_nothing_is_read_where_the_wording_could_mean_something_else(stem):
    assert read(stem) is None


def test_an_instruction_sentence_agreeing_with_the_question_is_fine():
    assert read("Answer in grams. How many grams is it?") == "g"
    assert read("How many hours after 01:05 a.m. is 01:05 p.m.?") == "h"  # "a.m." does not end a sentence
    assert read("2 inches equal how many millimetres using 1 inch = 25 mm?") == "mm"
    assert read("A 6 km route is divided into 3 equal sections. Each section is how many metres?") == "m"
    assert read("How many seconds are in half a minute?") == "s"
    assert read("How many minutes are in an hour?") == "min"
