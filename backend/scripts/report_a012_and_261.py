"""Two read-only reports: A-012 on production, and the count #261's decision needs.

READ-ONLY. This script never writes. It opens a session, runs counts, prints
them, and closes. There is no --apply and no flag that changes anything.

    python scripts/report_a012_and_261.py

SECTION 1 AND 2 -- A-012, now that PR #239 is live
--------------------------------------------------
A-012 added four columns to `questions` (migration `c2e7a4b9f318`, applied on
production 26 Nov 2026 13:25:57 UTC). Two things are worth seeing on live
data:

  * Every question approved before that migration carries an EMPTY approval
    stamp, and that is deliberate -- the bulk-approval audit rows hold counts
    and not question ids, and publish_courses.py's rows hold no user at all,
    so there was nothing honest to backfill from. Empty reads "not recorded".
    Section 1 should therefore show one line, "(not recorded)", holding the
    whole bank, until something approves a question after the deploy.
  * The migration marks every question sitting at SME_REVIEW as sent back for
    rework, because a real send-back and an importer's SME_REVIEW cannot be
    told apart after the fact, and holding content back is the safe reading of
    an unknown. Section 2 is how many rows that was -- the number that was
    meant to be seen before the deploy. Each one is now skipped by the
    Approve and Publish button and by publish_courses.py (both say so out
    loud) until somebody approves it in Curriculum Studio, which clears it.

SECTION 3 AND 4 -- the count #261's decision needs
--------------------------------------------------
`learning_service.servable_questions` decides what a child is served, and it
is a BLACKLIST: `status NOT IN ('SME_REVIEW')`. Every publishing gate is a
WHITELIST: `READY_QUESTION_STATUSES = {'APPROVED', 'PUBLISHED'}`
(`routes_curriculum_admin` 477/539/556, `routes_learning` 236, and the top-up
at `learning_service` 240). So a question that goes APPROVED -> SME_REVIEW ->
DRAFT -- both steps allowed by `_QUESTION_TRANSITIONS` -- is served again,
unapproved.

`report_unapproved_in_published_sets.py` answered this for PUBLISHED sets on
25 Nov: 2,504 sets, zero holding an unapproved question. That is not the whole
question, because serving keys on a set's question LINKS and not on the set
being published, and A-019 says an assigned set can be demoted back to Draft,
after which its top-up takes everything. Section 3 therefore looks at sets
that have an ASSIGNMENT, whatever the set's own status, and says whether any
child has already answered the questions involved.

Section 4 reads the result out in words, so the decision rests on a sentence
and not on a table.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import case, func
from sqlalchemy.engine import make_url

from app.core.config import DATABASE_URL
from app.database import SessionLocal
from app.models import (
    Assignment,
    Attempt,
    AttemptAnswer,
    LearningActivity,
    LearningActivityQuestion,
    Question,
)
from app.services import learning_service
from scripts.apply_answer_units import mask_database_url

READY = tuple(sorted(learning_service.READY_QUESTION_STATUSES))
WITHDRAWN = tuple(sorted(learning_service.WITHDRAWN_QUESTION_STATUSES))


def _rule(title: str) -> None:
    print()
    print(title)
    print("-" * len(title))


def _table(rows, headers) -> None:
    if not rows:
        print("  (nothing)")
        return
    widths = [max(len(str(h)), *(len(str(r[i])) for r in rows)) for i, h in enumerate(headers)]
    print("  " + "  ".join(str(h).ljust(widths[i]) for i, h in enumerate(headers)))
    print("  " + "  ".join("-" * widths[i] for i in range(len(headers))))
    for row in rows:
        print("  " + "  ".join(str(row[i]).ljust(widths[i]) for i in range(len(headers))))


def main() -> int:
    # config.py falls back to sqlite:///./school_enrichment.db when
    # DATABASE_URL is unset, and that file exists in backend/. Without this
    # refusal the report would quietly describe a local database and section 4
    # would print "no risk" about data nobody cares about -- and the #261
    # decision would rest on that sentence. Same guard the Workbench lookup
    # scripts carry.
    url = make_url(DATABASE_URL)
    if not url.drivername.startswith("postgresql"):
        print("This report is only meaningful against production Postgres.")
        print(f"DATABASE_URL points at: {url.drivername}")
        print()
        print("In PowerShell, set both and run it again:")
        print('  $env:ENVIRONMENT = "development"')
        print('  $env:DATABASE_URL = "<the external Postgres URL from Render>"')
        print()
        print("Nothing was read and nothing was written.")
        return 1

    print(f"Database: {mask_database_url(DATABASE_URL)}")
    db = SessionLocal()
    try:
        print(f"Approved for release: {', '.join(READY)}")
        print(f"Held back at serve time: status in {', '.join(WITHDRAWN)}, OR a send-back stamp")
        print("  (learning_service.withdrawn_question_clause -- #261, 26 Nov 2026)")

        # --- 1. A-012: what route approved each question --------------------
        _rule("1. A-012 -- how each question in the bank came to be approved")
        rows = (
            db.query(
                Question.approval_source,
                func.count(Question.id),
                func.count(Question.approved_by_user_id),
                func.min(Question.approved_at),
                func.max(Question.approved_at),
            )
            .group_by(Question.approval_source)
            .order_by(func.count(Question.id).desc())
            .all()
        )
        _table(
            [
                (source or "(not recorded)", total, with_person, earliest or "-", latest or "-")
                for source, total, with_person, earliest, latest in rows
            ],
            ["route", "questions", "with a person", "earliest", "latest"],
        )
        print()
        print("  '(not recorded)' is the truthful answer for every question approved before")
        print("  26 Nov 2026: there was no column, and the audit rows cannot supply one.")
        print("  SIGN_OFF is reserved for the academic owner and nothing writes it yet.")

        # --- 2. A-012: what the migration marked as sent back ---------------
        _rule("2. A-012 -- questions marked as sent back for rework")
        marked = (
            db.query(Question.status, func.count(Question.id))
            .filter(Question.sent_back_at.isnot(None))
            .group_by(Question.status)
            .order_by(Question.status)
            .all()
        )
        _table(list(marked), ["question status", "questions"])
        total_marked = sum(count for _status, count in marked)
        print()
        print(f"  {total_marked} in total. Each is skipped by the Approve and Publish button and by")
        print("  publish_courses.py until somebody approves it in Curriculum Studio, which")
        print("  clears the mark. Both now say how many they skipped.")
        if any(status not in WITHDRAWN for status, _count in marked):
            print()
            print("  NOTE: a status other than SME_REVIEW appears above, which means something")
            print("  has sent a question back since the deploy. That is normal if a person did.")

        # --- 3. #261: unapproved questions in sets that are assigned --------
        _rule("3. #261 -- questions that are NOT approved, inside sets a class has been assigned")
        answers = (
            db.query(
                LearningActivity.status.label("set_status"),
                Question.status.label("question_status"),
                Question.sent_back_at.isnot(None).label("sent_back"),
                func.count(func.distinct(Question.id)).label("questions"),
                func.count(func.distinct(LearningActivity.id)).label("sets"),
                func.count(func.distinct(Assignment.id)).label("assignments"),
                func.count(func.distinct(AttemptAnswer.id)).label("answers_given"),
                func.count(
                    func.distinct(
                        case((Attempt.status == "IN_PROGRESS", AttemptAnswer.id), else_=None)
                    )
                ).label("answers_in_open_attempts"),
            )
            .select_from(Question)
            .join(LearningActivityQuestion, LearningActivityQuestion.question_id == Question.id)
            .join(LearningActivity, LearningActivity.id == LearningActivityQuestion.learning_activity_id)
            .join(Assignment, Assignment.learning_activity_id == LearningActivity.id)
            .outerjoin(AttemptAnswer, AttemptAnswer.question_id == Question.id)
            .outerjoin(Attempt, Attempt.id == AttemptAnswer.attempt_id)
            .filter(Question.status.notin_(READY))
            .group_by(
                LearningActivity.status,
                Question.status,
                Question.sent_back_at.isnot(None),
            )
            .order_by(LearningActivity.status, Question.status)
            .all()
        )
        _table(
            [
                (r.set_status, r.question_status, "yes" if r.sent_back else "no",
                 r.questions, r.sets, r.assignments, r.answers_given, r.answers_in_open_attempts)
                for r in answers
            ],
            ["set status", "question status", "sent back", "questions", "sets", "assignments",
             "answers given", "of those, still open"],
        )
        print()
        print("  'answers given' counts every answer to that question, at any attempt status.")
        print("  'still open' is the subset in attempts a child has not handed in -- A-011")
        print("  part 2 (an open attempt) and part 3 (one already marked) are different")
        print("  decisions of his, so the two figures are kept apart.")

        # --- 3b. the same without the assignment join, for scale ------------
        _rule("3b. Every set holding a question that is not approved, assigned or not")
        scale = (
            db.query(
                LearningActivity.status,
                func.count(func.distinct(LearningActivity.id)),
                func.count(func.distinct(Question.id)),
            )
            .select_from(Question)
            .join(LearningActivityQuestion, LearningActivityQuestion.question_id == Question.id)
            .join(LearningActivity, LearningActivity.id == LearningActivityQuestion.learning_activity_id)
            .filter(Question.status.notin_(READY))
            .group_by(LearningActivity.status)
            .order_by(LearningActivity.status)
            .all()
        )
        _table(list(scale), ["set status", "sets", "unapproved questions in them"])

        # --- 4. what it means ----------------------------------------------
        _rule("4. What this says about #261")
        # The ones the serve-time rule does NOT hide: not in the withdrawn
        # statuses AND carrying no send-back stamp. Since 26 Nov the stamp is
        # half the rule, so filtering on the status alone would call a stamped
        # Draft "served" when it is not.
        newly_hidden = [
            r for r in answers
            if r.question_status not in WITHDRAWN and not r.sent_back
        ]
        touched = [r for r in newly_hidden if r.answers_given]
        open_now = sum(r.answers_in_open_attempts for r in newly_hidden)

        print("  DECIDED 26 Nov 2026, by Shailesh: hold back anything carrying")
        print("  `sent_back_at` as well as SME_REVIEW, rather than serving only APPROVED")
        print("  or PUBLISHED. The stamp survives SME_REVIEW -> DRAFT by design, so this")
        print("  closes the exact hole and hides only what a person rejected -- #251 /")
        print("  A-011 part 4 kept rather than bent. A whitelist would also have hidden")
        print("  questions nobody sent back, and until A-035 lands a workbook re-import")
        print("  can set a live question to Draft on its own.")
        print()
        print("  Built as learning_service.withdrawn_question_clause(), one shared")
        print("  predicate read by withdrawn_question_ids, servable_questions,")
        print("  set_is_held and report_withdrawn_questions.py -- so A-011's 'one place")
        print("  decides what a set contains' stays true.")
        print()
        print("  The sections above are kept because they are the before-and-after: a")
        print("  later run showing rows here means something has changed on production.")
        print()
        if not answers:
            print("  WHAT THE DATA SAYS: nothing. No set a class has been assigned holds a")
            print("  question that is not approved -- which is what it said on 26 Nov when")
            print("  the decision was taken.")
        elif not newly_hidden:
            print("  WHAT THE DATA SAYS: everything above is already held back at serve time,")
            print("  so no child is seeing an unapproved question. Expected.")
        elif not touched:
            questions = sum(r.questions for r in newly_hidden)
            print(f"  NEW SINCE THE DECISION: {questions} question(s) that no person sent back")
            print("  are in assigned sets. The rule above leaves them served, on purpose --")
            print("  only a human send-back pulls a question from a live set. No child has")
            print("  answered any of them yet. Worth knowing how they got there: #262 and")
            print("  A-035 can put one in, and so can A-019 demoting an assigned set to Draft.")
        else:
            questions = sum(r.questions for r in touched)
            given = sum(r.answers_given for r in touched)
            print(f"  NEW SINCE THE DECISION, AND WORTH A LOOK: {questions} question(s) that no")
            print(f"  person sent back are in assigned sets and carry {given} answer(s) a child")
            print("  has already given"
                  + (f", {open_now} of them in attempts still open." if open_now else ", none in an open attempt."))
            print("  The rule above does NOT hide these -- a workbook or a demoted set, not a")
            print("  person, put them there, and hiding them would be the whitelist his 26 Nov")
            print("  decision ruled out. So children are being served unapproved questions and")
            print("  the fix belongs at the source: #262, A-035, or A-019's demotion. Report")
            print("  these numbers.")

        print()
        print("Nothing was written. This script has no write path.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
