"""#261: a set cannot be published past the approval gate.

`POST /api/learning/activities/{id}/publish` checked only that the set HAD
questions, then set it PUBLISHED. A Super Admin could publish a set full of
Drafts, or of questions sent back for rework, straight past the gate A-001
put on the bulk Approve and Publish path -- which this endpoint sat beside
and did not share.

Found 23 Nov 2026 while fixing A-001; it is also why A-011's filter had to
be narrowed to SME_REVIEW rather than "anything not approved": production
holds 4,828 questions that are not approved, and this endpoint is part of
how they got into live sets.
"""
import pytest

from app.models import LearningActivity, Question
from app.services import learning_service
from tests import test_learning
from tests.test_class_analytics import _world
from tests.test_learning import _login, _make_super_admin

test_learning._CHAPTER_NUM.update(
    {"PUBG": 211, "PUBH": 212, "PUBI": 213, "PUBJ": 214, "PUBK": 215}
)


def _activity(db, w):
    return db.get(LearningActivity, w["assignment"].learning_activity_id)


def _publish(client, headers, activity_id):
    return client.post(f"/api/learning/activities/{activity_id}/publish", headers=headers)


def test_a_set_with_a_draft_question_cannot_be_published(client, db_session):
    db = db_session
    w = _world(db, "PUBG")
    headers = _login(client, _make_super_admin(db, "pub261a").email)
    activity = _activity(db, w)
    activity.status = "DRAFT"
    # One question not yet approved is enough: a child must not meet it.
    w["qs"][0].status = "DRAFT"
    db.commit()

    response = _publish(client, headers, activity.id)

    assert response.status_code == 422, response.text
    body = response.json()["detail"]
    assert body["code"] == "SET_NOT_READY"
    assert "1 of its questions are not approved" in body["message"]
    # The words the studio shows, never the stored enum: a person reading
    # this should not meet "SME_REVIEW" or "Sme Review".
    assert "1 Draft" in body["message"], "the reviewer is told what is wrong, not just that it is"
    assert "DRAFT" not in body["message"], "the stored enum must not reach a person"
    db.refresh(activity)
    assert activity.status == "DRAFT", "nothing was published"


def test_a_set_whose_questions_are_all_cleared_still_publishes(client, db_session):
    """The gate must not block the ordinary case -- both statuses that count
    as cleared for release are accepted, not just APPROVED."""
    db = db_session
    w = _world(db, "PUBH")
    headers = _login(client, _make_super_admin(db, "pub261b").email)
    activity = _activity(db, w)
    activity.status = "DRAFT"
    for i, q in enumerate(w["qs"]):
        q.status = "PUBLISHED" if i == 0 else "APPROVED"
    db.commit()
    assert learning_service.READY_QUESTION_STATUSES == {"APPROVED", "PUBLISHED"}

    response = _publish(client, headers, activity.id)

    assert response.status_code == 200, response.text
    db.refresh(activity)
    assert activity.status == "PUBLISHED"


def test_a_set_with_a_question_sent_back_cannot_be_published(client, db_session):
    """The A-011 case from the other end: a question sent back for rework
    must not be re-published into a live set by this route."""
    db = db_session
    w = _world(db, "PUBI")
    headers = _login(client, _make_super_admin(db, "pub261c").email)
    activity = _activity(db, w)
    activity.status = "DRAFT"
    w["qs"][0].status = "SME_REVIEW"
    db.commit()

    response = _publish(client, headers, activity.id)

    assert response.status_code == 422
    message = response.json()["detail"]["message"]
    assert "1 In Review" in message
    assert "SME_REVIEW" not in message and "Sme Review" not in message, (
        "the stored enum must not reach a person"
    )
    db.refresh(activity)
    assert activity.status == "DRAFT"


def test_an_empty_set_still_says_it_is_empty(client, db_session):
    """The original check is kept: "no questions" and "not approved" are
    different problems and read differently."""
    db = db_session
    w = _world(db, "PUBJ")
    headers = _login(client, _make_super_admin(db, "pub261d").email)
    chapter = w["chapter"]
    empty = LearningActivity(
        chapter_id=chapter.id,
        activity_type="CORE_PRACTICE",
        title="Empty set",
        sequence=99,
        status="DRAFT",
        evaluation_mode="AUTO",
    )
    db.add(empty)
    db.commit()

    response = _publish(client, headers, empty.id)

    assert response.status_code == 422
    assert "no questions yet" in response.json()["detail"]["message"]


# --- #267: the stray character names in the written stems --------------------


def test_the_stray_name_script_strips_exactly_what_a_reimport_would():
    """#267. A child reads "Show all working and explain your reasoning.
    Vihaan: Convert 49800 cm to metres." on production today. The converter
    strips that correctly now; these 60 rows were imported in the window
    before it could.

    The script reuses the converter's own functions, so this pins that it
    strips a leading name and nothing else -- above all that it does NOT eat
    a name that belongs to the question's wording."""
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from scripts.strip_stray_names import stripped

    instruction = "Show all working and explain your reasoning. "

    # The three names measured on production, each stripped -- and NAMED.
    # The second half of the tuple is what the report prints, and an earlier
    # version of this script worked it out by comparing lengths, which gave
    # "all" (from "Show all working") instead of the name. The report is the
    # only thing a person reads before writing to production, so the name it
    # would print is pinned here, not just the corrected stem.
    for name in ("Vihaan", "Naina", "Saanvi"):
        assert stripped(f"{instruction}{name}: Convert 49800 cm to metres.") == (
            f"{instruction}Convert 49800 cm to metres.",
            name,
        )

    # Question 10's shape: the name is in the sentence too, and that one stays.
    assert stripped(f"{instruction}Vihaan: Vihaan buys 3 items at 328.50 each.") == (
        f"{instruction}Vihaan buys 3 items at 328.50 each.",
        "Vihaan",
    )

    # A name with no instruction in front of it is still named correctly.
    assert stripped("Naina: Convert 3 m to cm.") == ("Convert 3 m to cm.", "Naina")

    # Nothing else is touched, and nothing is named.
    assert stripped(f"{instruction}Convert 5 kg to grams.") == (
        f"{instruction}Convert 5 kg to grams.",
        None,
    )
    assert stripped("Convert 8 L to millilitres.") == ("Convert 8 L to millilitres.", None)
    # A word that is not a name is not treated as one.
    assert stripped(f"{instruction}Note: the unit matters here.") == (
        f"{instruction}Note: the unit matters here.",
        None,
    )
    assert stripped("") == ("", None)


def test_the_stray_name_script_writes_only_the_named_rows(db_session, tmp_path):
    """#267, the other half. `stripped` is pure and easy to test; `plan` is
    the half that WRITES TO PRODUCTION, and it had never run once. It drives
    the audit file, the --expect guard and the UPDATE itself."""
    from scripts.strip_stray_names import plan

    db = db_session
    w = _world(db, "PUBK")
    # _world has no "lesson" key; every question it makes shares one.
    lesson_id = w["qs"][0].concept_lesson_id
    instruction = "Show all working and explain your reasoning. "

    affected = Question(
        concept_lesson_id=lesson_id,
        code="STRIP-1",
        stem=f"{instruction}Vihaan: Convert 49800 cm to metres.",
        question_type="Constructed Response",
        marks=3,
        status="PUBLISHED",
        origin="BANK",
        auto_gradable=False,
        correct_answer="Working shown.",
    )
    untouched = Question(
        concept_lesson_id=lesson_id,
        code="STRIP-2",
        stem=f"{instruction}Convert 5 kg to grams.",
        question_type="Constructed Response",
        marks=3,
        status="PUBLISHED",
        origin="BANK",
        auto_gradable=False,
        correct_answer="Working shown.",
    )
    not_a_name = Question(
        concept_lesson_id=lesson_id,
        code="STRIP-3",
        stem=f"{instruction}Note: the unit matters here.",
        question_type="Constructed Response",
        marks=3,
        status="PUBLISHED",
        origin="BANK",
        auto_gradable=False,
        correct_answer="Working shown.",
    )
    looks_like_a_name = Question(
        concept_lesson_id=lesson_id,
        code="STRIP-4",
        # The converter's pattern matches this exactly as it matches a name,
        # and `_NOT_NAMES` does not list it. Running the bare pattern over
        # every board would have cut "Complete" off this stem. Found by the
        # FULL suite, where another test's fixtures put 9 such stems in the
        # database; running this file alone could never have shown it.
        stem="Complete: the pattern 2, 4, 6, __.",
        question_type="Constructed Response",
        marks=3,
        status="PUBLISHED",
        origin="BANK",
        auto_gradable=False,
        correct_answer="8",
    )
    db.add_all([affected, untouched, not_a_name, looks_like_a_name])
    db.commit()
    before = {q.code: q.stem for q in (affected, untouched, not_a_name, looks_like_a_name)}

    # 1. Report mode writes NOTHING to the database, but does write the file.
    audit = tmp_path / "audit.csv"
    names, rows, looked_at, declined = plan(db, apply=False, audit_path=str(audit))
    assert looked_at >= 3, "it looked at every question, not only the three"
    db.expire_all()
    for question in (affected, untouched, not_a_name, looks_like_a_name):
        assert question.stem == before[question.code], f"{question.code} changed in report mode"
    assert names == {"Vihaan": 1}, "the report names the name, not a slice of the instruction"
    # "Complete" sits where a name sits, so it is REPORTED -- never stripped.
    assert declined["Complete"] >= 1, "a word that is not a name must be surfaced"
    assert "Complete" not in names
    assert [r["code"] for r in rows] == ["STRIP-1"]
    assert audit.exists(), "the undo record is written before anything changes"
    text = audit.read_text(encoding="utf-8")
    assert "STRIP-1" in text and "STRIP-2" not in text
    # In full, not truncated: both stems are present end to end.
    assert before["STRIP-1"] in text
    assert f"{instruction}Convert 49800 cm to metres." in text

    # 2. The --expect guard refuses a count that does not match, and writes
    #    nothing when it refuses.
    with pytest.raises(SystemExit) as refused:
        plan(db, apply=True, audit_path=str(audit), expect=99)
    assert "Refusing to write" in str(refused.value)
    db.expire_all()
    assert affected.stem == before["STRIP-1"], "a refused run must not write"

    # 3. With the right count it writes, and ONLY the named row.
    names, rows, _, _ = plan(db, apply=True, audit_path=str(audit), expect=1)
    db.expire_all()
    assert affected.stem == f"{instruction}Convert 49800 cm to metres."
    assert untouched.stem == before["STRIP-2"], "a stem with no stray name is untouched"
    assert not_a_name.stem == before["STRIP-3"], '"Note:" is not a name'
    assert looks_like_a_name.stem == before["STRIP-4"], (
        '"Complete:" matches the pattern but is not in the allow-list, so it stays'
    )

    # 4. Idempotent: a second run finds nothing.
    names, rows, _, _ = plan(db, apply=False, audit_path=str(audit))
    assert names == {} and rows == []
