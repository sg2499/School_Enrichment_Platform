"""One rounding rule for every percentage a person is shown (A-010, A-040).

A percentage a child, a parent or a teacher reads always rounds DOWN, so
6 of 9 is 66% and 17 of 21 is 80% -- never 81%. The rule itself is not
new: routes_practice_tracker._percent carried it, and its comment already
claimed "one rounding rule everywhere". Four other places broke that
claim.

What went wrong before (the audit's A-010): the server rounded to one
decimal and the screen then floored the rounded number. 17 of 21 is
80.952...%, which rounds to 81.0 and then floors to 81. The weekly
report floored the exact value and said 80. One child, one skill,
two numbers on two screens, and a parent holding the lower one. Every
(earned, possible) pair whose exact percentage ends .95 or above
disagreed; with possible up to 60 there are 32 such pairs.

Integer division does the flooring here, never float arithmetic, because
floats land a hair below a whole number and floor the wrong way:
`math.floor((57 / 100) * 100)` is 56, not 57. `(100 * 57) // 100` is 57.
The frontend's lib/percentages.ts keeps the same rule the same way, for
the figures it has to work out on the screen (A-040).

NOT for bands, thresholds or geometry:
  * A band reads the exact percentage (progress_service.band_for via
    _Score.exact_percent), so no rounding can move a child between
    Strong and Getting There.
  * foundation_repair_service compares against the 70% secure threshold
    and so decides whether a child is given rescue practice. Flooring
    there would change children's learning paths, not a label, and that
    is a product rule for Ashalatha to set (#269).
  * assessment_service's report-card result keeps exact Decimals on
    purpose: a card is a formal record, shows one decimal ("91.0%"), and
    works the component's marks back out of the percentage, so flooring
    it would corrupt the marks.
  * mock_paper_service's difficulty mix and the weekly PDF's bar widths
    are a target range and a geometry, not a number anybody reads.

So this is one rule for every percentage that reports how a child did on
practice -- not, despite the temptation to write it, one rule platform-wide.
"""


def whole_percent(earned: float | None, possible: int | None) -> int | None:
    """The percentage to show a person: a whole number, rounded down.
    None when there is nothing to divide by, which every screen renders
    as a dash rather than a 0%."""
    if not possible:
        return None
    # int() at the end, not // alone. Every stored score is an Integer
    # column (Question.marks, AttemptAnswer.auto_score and manual_score,
    # Evaluation.final_score and max_score, and the mock paper's own), so
    # nothing here is a fraction -- but progress_service.SkillScore.earned
    # is typed float and starts at 0.0, so the sum arrives as a float and
    # 100 * 3.0 // 7 is 42.0. Left as it came, that reaches a screen as
    # "42.0%" anywhere the number is printed without going through a
    # helper, and PercentText does exactly that. int() drops the ".0";
    # the division has already done the flooring.
    return int((100 * (earned or 0)) // possible)


def exact_percent(earned: float | None, possible: int | None) -> float | None:
    """The unrounded percentage, for deciding a band or a threshold --
    never for display. Separate from whole_percent so that reaching for
    one instead of the other is a visible choice in the calling code."""
    if not possible:
        return None
    return 100.0 * (earned or 0) / possible
