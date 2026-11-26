"""Who approved a question, when, and by what route (A-012, 26 Nov 2026).

A question used to record only its status, so nothing in the database could
tell "the platform's quality checks cleared it" apart from "the academic owner
read it and signed it off". That is A-012's test, word for word: ask the
database which of the 28,430 approved questions the academic owner has signed
off. There was no column or log that could answer.

Every path that approves a question goes through `approve()` here, so there is
one place that stamps the three approval columns and one list of the routes a
question can be approved by. The six writers, all read 26 Nov before this was
written:

  1. routes_curriculum_admin.update_question_status  -- a person in the studio
  2. routes_curriculum_admin._bulk_approve_questions -- the Approve and
     Publish button
  3. scripts/publish_courses.py                      -- calls (2) with no user
  4. services/curriculum_import_service              -- a workbook's Status
     column (A-035 will narrow this)
  5. scripts/apply_content_edits.py                  -- copies the status of
     the question it sits after (#262 will remove this)
  6. services/pattern_engine                         -- a question MADE from
     an approved pattern for one school's paper; not curriculum content

A seventh and eighth looked like writers and are not: `apply_content_edits`'s
field edits go through `setattr(question, attribute, value)`, but `attribute`
comes from `FIELDS`, which has no status entry and skips a label it does not
know; and `repeat_service` writes only `repeat_of_id`.

`SIGN_OFF` is in SOURCES and nothing in the platform writes it yet. That is
what A-012 is ultimately for, and the screen or script that records her
sign-off is separate work. The column existing is what makes it recordable at
all.
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.models import Question

# A person clicked Approve on this one question in Curriculum Studio.
SOURCE_REVIEW_SCREEN = "REVIEW_SCREEN"
# The Approve and Publish button: the quality checks cleared it, in a batch.
SOURCE_BULK = "BULK"
# scripts/publish_courses.py, which runs the same batch with no signed-in user.
SOURCE_PUBLISH_SCRIPT = "PUBLISH_SCRIPT"
# A workbook's Status column said Approved or Published.
SOURCE_IMPORT = "IMPORT"
# scripts/apply_content_edits.py copied a neighbouring question's status.
SOURCE_CONTENT_EDIT = "CONTENT_EDIT"
# Made from an approved pattern for a school's paper (origin != "BANK").
SOURCE_PATTERN = "PATTERN"
# The academic owner read the question and signed it off. Nothing writes this
# yet; see the module docstring.
SOURCE_SIGN_OFF = "SIGN_OFF"

SOURCES = frozenset(
    {
        SOURCE_REVIEW_SCREEN,
        SOURCE_BULK,
        SOURCE_PUBLISH_SCRIPT,
        SOURCE_IMPORT,
        SOURCE_CONTENT_EDIT,
        SOURCE_PATTERN,
        SOURCE_SIGN_OFF,
    }
)

# The statuses that mean an approval is in force. The same two names
# learning_service.READY_QUESTION_STATUSES holds, kept as its own frozenset
# here so this module needs no import into learning_service.
APPROVED_STATUSES = frozenset({"APPROVED", "PUBLISHED"})

# A sign-off is the only thing allowed to overwrite a recorded approval. Every
# other route leaves an already-approved question's stamp alone -- INCLUDING
# an empty one, which is the honest record for every question approved before
# these columns existed. So re-running an importer over live content cannot
# put today's date and "IMPORT" on work somebody approved last month, and
# publishing an already-approved question is not a second approval of it.
_MAY_OVERWRITE = frozenset({SOURCE_SIGN_OFF})

# The only two routes that can bring back a question a person sent back for
# rework. A batch, a script and a workbook cannot: that is A-011 part 4, his
# decision of 23 Nov 2026, and the reason this module exists at all.
_MAY_CLEAR_SEND_BACK = frozenset({SOURCE_REVIEW_SCREEN, SOURCE_SIGN_OFF})


def approve(
    question: Question,
    *,
    to_status: str,
    user_id: str | None,
    source: str,
) -> bool:
    """Move a question to an approved status and record who did it.

    `to_status` is APPROVED or PUBLISHED -- both, because a workbook's Status
    column and a copied neighbour's status can land a question straight in
    PUBLISHED, not only in APPROVED.

    `user_id` is None for a script run; `source` then carries what the user
    cannot, which is why the source is not optional.

    Returns whether the status changed, so the callers' counts stay honest.

    Two questions are left alone, and both return without stamping anything:

      * one a person SENT BACK for rework, unless this is the studio or a
        sign-off. A batch, the publish script, a workbook and the content-edit
        script all leave it where it is -- A-011 part 4. The batch counts its
        own skips before it reaches this function (`is_sent_back`); this is
        the backstop that covers the other routes.
      * one ALREADY in an approved status, unless this is a sign-off. Its
        stamp stands, empty or not: an empty stamp is the truthful record for
        a question approved before these columns existed, and overwriting it
        with today's date would invent a fact.

    An approval that does go through clears `sent_back_at`, because a person
    has looked at the question again.
    """
    if source not in SOURCES:
        raise ValueError(f"Unknown approval source {source!r}")
    if to_status not in APPROVED_STATUSES:
        raise ValueError(f"approve() moves a question to APPROVED or PUBLISHED, not {to_status!r}")

    if is_sent_back(question) and source not in _MAY_CLEAR_SEND_BACK:
        return False

    changed = question.status != to_status

    if question.status in APPROVED_STATUSES and source not in _MAY_OVERWRITE:
        question.status = to_status
        return changed

    question.status = to_status
    question.approved_by_user_id = user_id
    question.approved_at = datetime.now(timezone.utc)
    question.approval_source = source
    question.sent_back_at = None
    return changed


def send_back(question: Question) -> None:
    """Record that a person has sent an approved question back for rework.

    Stamped here and nowhere else, because `update_question_status` is the
    only human send-back path -- and it has to be a column of its own rather
    than a status test. Three reasons, each one checked in the code:

      * The 28,430 questions approved before this column existed have no
        approval stamp, so "approved_at IS NOT NULL" would never fire for any
        question live today.
      * SME_REVIEW -> DRAFT is an allowed transition
        (`_QUESTION_TRANSITIONS`), and bulk approve walks DRAFT straight
        through SME_REVIEW to APPROVED, so a status test would be dodged by
        one more click.
      * `curriculum_import_service.STATUS_MAP` maps the words "sme review",
        so a workbook can put a question into SME_REVIEW with no person
        involved. Sitting at SME_REVIEW is therefore not evidence of a
        send-back on its own.

    The stamp is not cleared when the question moves on to DRAFT: the rework
    is still outstanding. An approval through the studio clears it.
    """
    question.sent_back_at = datetime.now(timezone.utc)


def is_sent_back(question: Question) -> bool:
    """Whether a person has sent this question back and nobody has approved it
    since. A batch route must not approve one of these: his decision of
    23 Nov 2026 (#251, A-011 part 4) is that only a human send-back pulls a
    question from a live set, and silently re-approving it in the next publish
    run would undo that decision with nothing in the audit row naming the
    question."""
    return question.sent_back_at is not None
