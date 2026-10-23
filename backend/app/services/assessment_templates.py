"""The starting schemes a school can copy (#165, 23 Oct 2026).

Drafted with AI help from how CBSE and ICSE schools commonly grade
(checked 23 Oct 2026; PHASE4_ASSESSMENT_SCHEME_DESIGN.md, "What schools
actually do"), so they are created as DRAFT templates: no school sees them
until Ashalatha has checked them and a Super Admin publishes them
(Shailesh, 23 Oct 2026: "anything AI-drafted is a proposal for Ashalatha's
approval"). A school edits its own copy freely.

Every figure is a common pattern, not a board rule: CBSE leaves Classes 6
to 8 to schools; for Classes 9 and 10 the 80/20 split and 33% to pass are
CBSE's; sources disagree on ICSE's pass mark (33% or 35%), so it is one of
the things for her to confirm.
"""
from sqlalchemy.orm import Session

from app.models import AssessmentScheme
from app.services.assessment_service import BandInput, ComponentInput, SchemeInput, clean_scheme_input, new_scheme

_EIGHT_BANDS = [
    ("A1", "91"), ("A2", "81"), ("B1", "71"), ("B2", "61"),
    ("C1", "51"), ("C2", "41"), ("D", "33"), ("E", "0"),
]


def _component(name, kind, term, max_marks, weight):
    return ComponentInput(
        name=name, kind=kind, term=term, source="ENTERED", max_marks=max_marks,
        weight_percent=weight, min_pass_percent=None, activity_ids=[],
    )


STANDARD_TEMPLATES = [
    SchemeInput(
        name="CBSE-Style, Classes 6 to 8",
        description="Two terms: periodic test, notebook, subject enrichment and a term examination each. Check with Ashalatha before publishing.",
        attempt_rule="BEST", pass_percent="33", pass_label="Pass", fail_label="Needs Improvement", decimal_places=0,
        components=[
            _component("Periodic Test 1", "PERIODIC_TEST", "TERM_1", "10", "5"),
            _component("Notebook, Term 1", "NOTEBOOK", "TERM_1", "5", "2.5"),
            _component("Subject Enrichment, Term 1", "SUBJECT_ENRICHMENT", "TERM_1", "5", "2.5"),
            _component("Half-Yearly Examination", "HALF_YEARLY", "TERM_1", "80", "40"),
            _component("Periodic Test 2", "PERIODIC_TEST", "TERM_2", "10", "5"),
            _component("Notebook, Term 2", "NOTEBOOK", "TERM_2", "5", "2.5"),
            _component("Subject Enrichment, Term 2", "SUBJECT_ENRICHMENT", "TERM_2", "5", "2.5"),
            _component("Annual Examination", "ANNUAL", "TERM_2", "80", "40"),
        ],
        grade_bands=[BandInput(label, minimum) for label, minimum in _EIGHT_BANDS],
    ),
    SchemeInput(
        name="CBSE-Style, Classes 9 and 10",
        description="Internal assessment of 20 (periodic tests, multiple assessment, portfolio, subject enrichment) and an annual examination of 80. Check with Ashalatha before publishing.",
        attempt_rule="BEST", pass_percent="33", pass_label="Pass", fail_label="Needs Improvement", decimal_places=0,
        components=[
            _component("Periodic Tests", "PERIODIC_TEST", "WHOLE_YEAR", "5", "5"),
            _component("Multiple Assessment", "OTHER", "WHOLE_YEAR", "5", "5"),
            _component("Portfolio", "NOTEBOOK", "WHOLE_YEAR", "5", "5"),
            _component("Subject Enrichment", "SUBJECT_ENRICHMENT", "WHOLE_YEAR", "5", "5"),
            _component("Annual Examination", "ANNUAL", "WHOLE_YEAR", "80", "80"),
        ],
        grade_bands=[BandInput(label, minimum) for label, minimum in _EIGHT_BANDS],
    ),
    SchemeInput(
        name="ICSE-Style, Classes 9 and 10",
        description="Internal assessment of 20 and an annual examination of 80. Sources give 33% or 35% to pass: confirm with Ashalatha before publishing.",
        attempt_rule="BEST", pass_percent="33", pass_label="Pass", fail_label="Needs Improvement", decimal_places=0,
        components=[
            _component("Internal Assessment", "PROJECT", "WHOLE_YEAR", "20", "20"),
            _component("Annual Examination", "ANNUAL", "WHOLE_YEAR", "80", "80"),
        ],
        grade_bands=[BandInput(label, minimum) for label, minimum in _EIGHT_BANDS],
    ),
]


def create_standard_templates(db: Session, user_id: str) -> list[AssessmentScheme]:
    """Creates each standard template that does not exist yet (by name), as
    a DRAFT. Returns the ones created."""
    existing = {name for (name,) in db.query(AssessmentScheme.name).filter(AssessmentScheme.is_template.is_(True)).all()}
    created = []
    for template in STANDARD_TEMPLATES:
        if template.name in existing:
            continue
        created.append(
            new_scheme(
                db,
                user_id=user_id,
                school_id=None,
                is_template=True,
                academic_year_id=None,
                class_level_id=None,
                board_course_id=None,
                cleaned=clean_scheme_input(template),
            )
        )
    return created
