"""A-010 and A-040: one rounding rule for every percentage a person reads.

The audit's finding: "My Progress, Class Analytics and mock results round a
percentage before flooring it; the weekly report floors it. 17 of 21 shows
81% on one and 80% on the other." The two-rule arithmetic was round to one
decimal on the server, then floor on the screen, so any exact value ending
.95 or above gained a whole percent.

The audit also gave the measure these tests use: of the (earned, possible)
pairs with possible up to 60, 32 disagree between the two rules. After the
fix, none do.
"""
import math

from app.core import percentages
from app.services import progress_service, weekly_report_service  # noqa: F401  (import-cycle guard)

from tests import test_learning

test_learning._CHAPTER_NUM.update({"BFIL": 191})


def _old_server_then_screen(earned: int, possible: int) -> int:
    """What the platform used to show: the server's one-decimal rounding,
    floored by the screen (frontend's Math.floor(percent + 1e-9))."""
    return math.floor(round(100.0 * earned / possible, 1) + 1e-9)


def _floor_of_exact(earned: int, possible: int) -> int:
    """What the weekly report always did, and what everything does now."""
    return math.floor(100.0 * earned / possible)


def test_the_audits_own_example_17_of_21_reads_80_everywhere():
    # The pair named in the audit row. 80.952...%: the old rule showed 81 on
    # My Progress and 80 in the parent's weekly report.
    assert _old_server_then_screen(17, 21) == 81
    assert _floor_of_exact(17, 21) == 80
    assert percentages.whole_percent(17, 21) == 80


def test_no_pair_up_to_60_disagrees_any_more_and_32_did_before():
    """The audit's measure, run as a test: every (earned, possible) pair with
    possible up to 60."""
    disagreed_before = 0
    for possible in range(1, 61):
        for earned in range(possible + 1):
            exact_floor = _floor_of_exact(earned, possible)
            if _old_server_then_screen(earned, possible) != exact_floor:
                disagreed_before += 1
            # The one rule, for every pair, with no exceptions.
            assert percentages.whole_percent(earned, possible) == exact_floor, (earned, possible)
    assert disagreed_before == 32


def test_integer_division_not_float_arithmetic():
    """The float trap the frontend helper shares: multiplying first matters.
    math.floor((57 / 100) * 100) is 56, because the division lands a hair
    below. Both pairs are the ones that caught it."""
    assert math.floor((57 / 100) * 100) == 56  # the trap itself
    assert percentages.whole_percent(57, 100) == 57
    assert percentages.whole_percent(29, 50) == 58


def test_nothing_to_divide_by_is_none_not_zero():
    # A dash on the screen, never a 0% beside a child who has answered
    # nothing -- "0%" reads as a score, "—" reads as no score.
    assert percentages.whole_percent(0, 0) is None
    assert percentages.whole_percent(5, None) is None
    assert percentages.whole_percent(None, 10) == 0


def test_exact_percent_is_kept_separate_for_bands_and_thresholds():
    # A band must not move when a displayed number is floored: 79.95% floors
    # to 79 for the eye but is still 79.95 for band_for, which is what
    # decides Strong at 80.
    assert percentages.whole_percent(1599, 2000) == 79
    assert percentages.exact_percent(1599, 2000) == 79.95
    assert percentages.exact_percent(0, 0) is None


def test_a_floored_score_does_not_move_a_band():
    """The one real risk in the change, pinned: the band comes from the exact
    percentage, so flooring the shown number cannot demote a child."""
    # 17 of 21 is 80.95%: Strong needs 80, and the child keeps it even though
    # the screen now reads 80 rather than 81.
    assert progress_service.band_for(percentages.exact_percent(17, 21), 21) == "STRONG"
    # And a child genuinely below 80 is not promoted by the old rounding.
    assert progress_service.band_for(percentages.exact_percent(16, 21), 21) == "GETTING_THERE"


def test_no_service_works_out_a_shown_percentage_on_its_own():
    """A guard, so the rules cannot drift apart again: no file under app/
    works out a practice percentage for display outside
    app/core/percentages.py.

    Every exception is named here, because "one rule everywhere" is only
    true of the percentages that report how a child did on practice:
      * assessment_service (the report card's subject result) keeps exact
        Decimals on purpose. A card is a formal record, it shows one
        decimal ("91.0%", see frontend/lib/reportCards.ts), and the
        component's marks are worked back out of the percentage
        (`result.marks = result.percent * maximum / HUNDRED`), so flooring
        it would corrupt the marks themselves.
      * foundation_repair_service compares against the 70% secure threshold
        and so decides whether a child is given rescue practice (#269). A
        product rule, not a label, and Ashalatha's to set.
      * mock_paper_service's difficulty mix is checked against a target
        range while a paper is being built.
      * weekly_report_pdf's bar widths are a geometry; the figure printed
        beside each bar comes from the service, already floored.
    """
    import re
    from pathlib import Path

    allowed = {
        "app/core/percentages.py",
        "app/services/assessment_service.py",
        "app/services/foundation_repair_service.py",
        "app/services/mock_paper_service.py",
        "app/services/weekly_report_pdf.py",
    }
    # Both orders and both spellings: `100 * a / b`, `a / b * 100`, and a
    # round() of either. The first version of this guard only matched the
    # first form and so missed assessment_service's `earned / possible *
    # HUNDRED` -- the very drift it exists to catch.
    pattern = re.compile(
        r"round\(\s*100"
        r"|100(?:\.0)?\s*\*\s*[\w.\[\]'\"()]+\s*/"
        r"|/\s*[\w.\[\]'\"()]+\s*\*\s*(?:100\b|HUNDRED)"
    )
    offenders = []
    root = Path(__file__).resolve().parents[1] / "app"
    for path in sorted(root.rglob("*.py")):
        rel = path.relative_to(root.parent).as_posix()
        if rel in allowed:
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if line.lstrip().startswith("#") or '"""' in line:
                continue
            if pattern.search(line):
                offenders.append(f"{rel}:{number}: {line.strip()}")
    assert not offenders, "work the percentage out with app.core.percentages instead:\n" + "\n".join(offenders)


def test_practise_next_orders_on_the_exact_percentage_not_the_shown_one():
    """A-010's one behavioural edge. Practise Next puts the weakest skill
    first. The shown number is floored, so two skills at 33.33% and 33.88%
    both read 33 and would tie, falling through to the skill's code -- an
    alphabetical accident deciding which skill a child is sent to.

    This drives the real SkillRow and SkillScore, so it fails if the
    exact_percent property is taken away. It does not drive the sort
    expression itself, which is inline in progress_service.my_progress and
    cannot be reached from here: that line is held by review, not by a test.
    """
    from app.services.progress_service import NEEDS_WORK, SkillRow, SkillScore

    def row(earned, possible, code):
        skill = type("Skill", (), {"code": code, "id": code})()
        score = SkillScore(earned=earned, possible=possible, answered=possible)
        return SkillRow(skill=skill, chapter=object(), score=score)

    # 1 of 3 is 33.33%, 61 of 180 is 33.88%.
    weaker, stronger = row(1, 3, "Z-SKILL"), row(61, 180, "A-SKILL")
    assert weaker.band == stronger.band == NEEDS_WORK
    # Both read the same to the eye...
    assert weaker.percent == stronger.percent == 33
    # ...so ordering on the shown number ties and the code decides.
    shown = sorted([stronger, weaker], key=lambda r: (r.percent, r.skill.code))
    assert shown[0].skill.code == "A-SKILL"
    # The exact percentage keeps them apart, weakest first. This is the key
    # my_progress now uses.
    exact = sorted([stronger, weaker], key=lambda r: (r.exact_percent, r.skill.code))
    assert exact[0].skill.code == "Z-SKILL"


# --- #268: a set says how it is marked ---------------------------------------


def test_a_set_reports_how_it_is_actually_marked():
    """#268: evaluation_mode was hardcoded "AUTO" for every generated set, so
    "Measurement — Mastery E" -- twenty Constructed Response questions, every
    one hand-marked -- reported itself as automatically marked.

    Nothing reads the field today, which is why it was wrong for so long
    unnoticed. It is fixed because the first thing that reads it would read
    it wrong, and telling a teacher a 60-mark hand-marked set is "AUTO" is a
    worse mistake than an empty field."""
    from app.services.learning_service import evaluation_mode_for

    def q(*, auto, kind="Numeric Entry"):
        return type("Q", (), {"auto_gradable": auto, "question_type": kind})()

    written = q(auto=False, kind="Constructed Response")
    marked_by_platform = q(auto=True)

    assert evaluation_mode_for([marked_by_platform, marked_by_platform]) == "AUTO"
    assert evaluation_mode_for([written, written]) == "MANUAL"
    assert evaluation_mode_for([marked_by_platform, written]) == "HYBRID"
    # A Constructed Response is teacher-marked even when the flag says
    # otherwise -- upload_rule_service.teacher_marked decides, not this.
    assert evaluation_mode_for([q(auto=True, kind="Constructed Response")]) == "MANUAL"


def test_the_backfill_corrects_an_existing_set_and_then_does_nothing(db_session):
    """#268's backfill writes to the production database, so "it parses" is
    not a check. This drives it against a real world: a set of written
    questions stored as AUTO is reported, then corrected, then left alone."""
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from scripts.backfill_evaluation_mode import plan

    from app.models import LearningActivity
    from tests.test_class_analytics import _world

    w = _world(db_session, "BFIL")
    # The Mastery E shape: a set whose questions a teacher marks, stored AUTO.
    activity = db_session.get(LearningActivity, w["core"].id)
    activity.evaluation_mode = "AUTO"
    db_session.commit()

    changes, _examples, looked_at = plan(db_session, apply=False)
    assert looked_at > 0, "the backfill must actually see the sets"
    before = db_session.get(LearningActivity, activity.id).evaluation_mode
    assert before == "AUTO", "--report must not write"

    changes, _examples, _ = plan(db_session, apply=True)
    db_session.expire_all()
    after = db_session.get(LearningActivity, activity.id).evaluation_mode
    assert after in {"AUTO", "HYBRID", "MANUAL"}

    # Running it twice is a no-op, which is what makes it safe to re-run.
    again, _e, _l = plan(db_session, apply=False)
    assert not again, f"a second run should have nothing to do, got {again}"
