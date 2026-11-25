"""#269's report, tested against real rows and real arithmetic.

The arithmetic half is the part that actually answers Ashalatha's question,
so it is pinned directly: every score column is an Integer, so the rounding
can only hide a sub-70 child where a whole number of marks lands in
[0.6995p, 0.70p), and at every round total it cannot.
"""

import io
from contextlib import redirect_stdout

import pytest

from scripts.report_secure_threshold_269 import THRESHOLD, _could_hide, report
from tests.test_learning import _CHAPTER_NUM

_SUFFIXES = [f"S269{n}" for n in range(1, 5)]
for _n, _s in enumerate(_SUFFIXES, start=241):
    _CHAPTER_NUM[_s] = _n
_next = iter(_SUFFIXES)


def test_the_threshold_comes_from_the_service_not_a_retyped_number():
    from app.services import foundation_repair_service

    assert THRESHOLD == foundation_repair_service.DEFAULT_SECURE_THRESHOLD_PERCENT


@pytest.mark.parametrize(
    "total,expected",
    [
        # No integer mark can sit in [0.6995p, 0.70p) at any of these.
        (20, False), (30, False), (40, False), (60, False), (80, False),
        (100, False), (120, False), (200, False), (300, False), (600, False),
        (1000, False), (1400, False),
        # The smallest total that admits a case at all.
        (203, True),
        # And the correction to a claim this file used to imply: it is NOT a
        # general rule that round totals cannot hide a child. From 2,000 up
        # they can, because 0.6995 x total is whole there too and the
        # interval is a full mark wide.
        (2000, True), (2010, True), (3000, True), (5000, True),
    ],
)
def test_only_unusual_totals_can_hide_a_child(total, expected):
    assert _could_hide(total) is expected, (
        f"{total} marks: the answer to #269 turns on whether a whole number of "
        f"marks can land just under 70%"
    )


def test_round_totals_are_not_automatically_safe():
    """Pins the correction. The tidy explanation -- "0.70 x total is whole, so
    nothing fits beneath it" -- is wrong from 2,000 marks up, where
    0.6995 x total is whole as well. It held for every total anyone had
    actually tested, which is exactly why it went unchallenged."""
    exact = 100.0 * 1399 / 2000
    assert exact < 70
    assert round(exact, 1) >= 70.0
    assert _could_hide(2000) is True
    # But still impossible anywhere a child realistically reaches.
    assert not any(_could_hide(t) for t in range(1, 203))


def test_the_boundary_case_is_real_arithmetic_not_a_claim():
    """142 of 203 is under 70% but is shown as 70.0%, so it would be treated
    as secure. This is the one shape of child the decision moves."""
    exact = 100.0 * 142 / 203
    assert exact < 70
    assert round(exact, 1) >= 70.0
    assert f"{exact:.4f}" == "69.9507"


def test_the_report_runs_over_real_evaluations(db_session):
    from tests import test_class_analytics as ca

    db = db_session
    w = ca._world(db, next(_next))
    students = w["students"]

    from app.models import AssignmentTarget

    rows = (
        db.query(AssignmentTarget)
        .filter(AssignmentTarget.assignment_id == w["assignment"].id)
        .all()
    )
    by_student = {t.student_id: t for t in rows}

    # One child answers everything right, one gets them wrong, so section 1
    # has a secure case and a rescue case to count.
    auto = [q for q in w["qs"] if q.auto_gradable]
    assert auto, "need an auto-marked question to produce an evaluation"
    ca._do(db, students[0], by_student[students[0].id].id, {q: q.correct_answer for q in auto})
    ca._do(db, students[1], by_student[students[1].id].id, {q: "nonsense" for q in auto})
    db.commit()

    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = report(db)
    out = buffer.getvalue()

    assert code == 0
    for heading in (
        "1. How many children does the answer actually move?",
        "2. Can the rounding hide anyone",
        "3. The other place the number lives",
        "4. Sets with no lesson id",
    ):
        assert heading in out, f"missing: {heading}\n{out}"

    # Section 1 read real rows rather than reporting the empty-table message.
    section1 = out.split("1. How many")[1].split("2. Can the rounding")[0]
    assert "No CORE_PRACTICE evaluations on record at all." not in section1, (
        f"the report found nothing, so it proves nothing:\n{section1}"
    )
    assert "skill results:" in section1
    # Both children are on one side or the other, and neither is a boundary
    # case, because no realistic total can produce one.
    assert "CHILDREN THE ANSWER MOVES:  0" in section1, (
        f"a boundary case cannot occur at these totals:\n{section1}"
    )
    assert "Read-only: nothing was written." in out
