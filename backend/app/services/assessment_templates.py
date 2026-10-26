"""The starting schemes a school can copy (#165, 23 Oct 2026).

Drafted with AI help from how CBSE and ICSE schools commonly grade
(checked 23 Oct 2026; PHASE4_ASSESSMENT_SCHEME_DESIGN.md, "What schools
actually do"), so they are created as DRAFT templates: no school sees them
until Ashalatha has checked them and a Super Admin publishes them
(Shailesh, 23 Oct 2026: "anything AI-drafted is a proposal for Ashalatha's
approval"). A school edits its own copy freely.

Every figure is a common pattern, not a board rule: CBSE leaves Classes 6
to 8 to schools; for Classes 9 and 10 the 80/20 split and 33% to pass are
CBSE's.

Ashalatha's review, 26 Oct 2026: both CBSE templates approved as they are;
the ICSE one split by subject group (Groups I and II 80 + 20, Group III
50 + 50), 33% to pass, ICSE's own grades 1 to 9; and a Class 5 template
added (15 + 5 + 10 + 10 platform practice + 60). A1 to E stays for the
CBSE-style school reports, never as ICSE's result scale. The templates are
still created as drafts, for the Super Admin to publish.
"""
from sqlalchemy.orm import Session

from app.models import AssessmentScheme
from app.services.assessment_service import BandInput, ComponentInput, SchemeInput, clean_scheme_input, new_scheme

_EIGHT_BANDS = [
    ("A1", "91"), ("A2", "81"), ("B1", "71"), ("B2", "61"),
    ("C1", "51"), ("C2", "41"), ("D", "33"), ("E", "0"),
]


# ICSE's official grades (CISCE regulations): 1 is the highest; 7 and above pass.
_ICSE_GRADES = [
    ("1", "90"), ("2", "80"), ("3", "70"), ("4", "60"), ("5", "50"),
    ("6", "40"), ("7", "33"), ("8", "21"), ("9", "0"),
]


def _platform(name, term, max_marks, weight):
    """Practice on the platform: the school chooses the sets in its copy."""
    return ComponentInput(
        name=name, kind="PLATFORM_PRACTICE", term=term, source="PLATFORM", max_marks=max_marks,
        weight_percent=weight, min_pass_percent=None, activity_ids=[],
    )


def _component(name, kind, term, max_marks, weight):
    return ComponentInput(
        name=name, kind=kind, term=term, source="ENTERED", max_marks=max_marks,
        weight_percent=weight, min_pass_percent=None, activity_ids=[],
    )


STANDARD_TEMPLATES = [
    SchemeInput(
        name="CBSE-Style, Classes 6 to 8",
        description="Two terms: periodic test, notebook, subject enrichment and a term examination each. Approved by Ashalatha, 26 Oct 2026.",
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
        description="Internal assessment of 20 (periodic tests, multiple assessment, portfolio, subject enrichment) and an annual examination of 80. Approved by Ashalatha, 26 Oct 2026.",
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
    # Ashalatha, 26 Oct 2026 (Q5, Q7): ICSE weighting depends on the subject
    # group; 33% to pass; the official grades 1 to 9 (CISCE regulations,
    # 2027), not CBSE's A1 to E.
    SchemeInput(
        name="ICSE-Style, Classes 9 and 10, Groups I and II",
        description="For Group I and Group II subjects: external examination of 80 and internal assessment of 20. Pass at 33%. Grades 1 to 9 as in the ICSE regulations.",
        attempt_rule="BEST", pass_percent="33", pass_label="Pass", fail_label="Needs Improvement", decimal_places=0,
        components=[
            _component("Internal Assessment", "PROJECT", "WHOLE_YEAR", "20", "20"),
            _component("External Examination", "ANNUAL", "WHOLE_YEAR", "80", "80"),
        ],
        grade_bands=[BandInput(label, minimum) for label, minimum in _ICSE_GRADES],
    ),
    SchemeInput(
        name="ICSE-Style, Classes 9 and 10, Group III",
        description="For Group III subjects: external examination of 50 and internal assessment of 50. Pass at 33%. Grades 1 to 9 as in the ICSE regulations.",
        attempt_rule="BEST", pass_percent="33", pass_label="Pass", fail_label="Needs Improvement", decimal_places=0,
        components=[
            _component("Internal Assessment", "PROJECT", "WHOLE_YEAR", "50", "50"),
            _component("External Examination", "ANNUAL", "WHOLE_YEAR", "50", "50"),
        ],
        grade_bands=[BandInput(label, minimum) for label, minimum in _ICSE_GRADES],
    ),
    # Ashalatha, 26 Oct 2026 (Q6): Class 5, a 100-mark term with platform
    # practice carrying 10. The school picks the practice sets for its copy.
    SchemeInput(
        name="Class 5 Standard",
        description="Each term out of 100: periodic tests 15, notebook and classwork 5, subject enrichment and project 10, platform practice 10, term examination 60. Choose the practice sets in your school's copy.",
        attempt_rule="BEST", pass_percent="33", pass_label="Pass", fail_label="Needs Improvement", decimal_places=0,
        components=[
            _component("Periodic Tests, Term 1", "PERIODIC_TEST", "TERM_1", "15", "7.5"),
            _component("Notebook and Classwork, Term 1", "NOTEBOOK", "TERM_1", "5", "2.5"),
            _component("Subject Enrichment and Project, Term 1", "SUBJECT_ENRICHMENT", "TERM_1", "10", "5"),
            _platform("Platform Practice, Term 1", "TERM_1", "10", "5"),
            _component("Term 1 Examination", "HALF_YEARLY", "TERM_1", "60", "30"),
            _component("Periodic Tests, Term 2", "PERIODIC_TEST", "TERM_2", "15", "7.5"),
            _component("Notebook and Classwork, Term 2", "NOTEBOOK", "TERM_2", "5", "2.5"),
            _component("Subject Enrichment and Project, Term 2", "SUBJECT_ENRICHMENT", "TERM_2", "10", "5"),
            _platform("Platform Practice, Term 2", "TERM_2", "10", "5"),
            _component("Term 2 Examination", "ANNUAL", "TERM_2", "60", "30"),
        ],
        grade_bands=[BandInput(label, minimum) for label, minimum in _EIGHT_BANDS],
    ),
]


# Standard templates replaced by Ashalatha's review (26 Oct 2026): the one
# ICSE template became two, by subject group.
RETIRED_TEMPLATE_NAMES = ("ICSE-Style, Classes 9 and 10",)


def refresh_standard_templates(db: Session) -> dict:
    """Brings standard templates made before her review up to date (#203
    review): a retired one still in DRAFT is deleted (a draft template has
    no school copies or results: schools copy only published ones); a
    standard one still in DRAFT gets its current description. A published
    template is never changed here. Returns what was done, for the audit."""
    by_name = {t.name: t for t in STANDARD_TEMPLATES}
    removed, updated, kept_published = [], [], []
    for scheme in db.query(AssessmentScheme).filter(AssessmentScheme.is_template.is_(True), AssessmentScheme.school_id.is_(None)).all():
        if scheme.name in RETIRED_TEMPLATE_NAMES:
            if scheme.status == "DRAFT":
                removed.append(scheme.id)
                db.delete(scheme)
            else:
                kept_published.append(scheme.id)
        elif scheme.name in by_name and scheme.status == "DRAFT" and scheme.description != by_name[scheme.name].description:
            scheme.description = by_name[scheme.name].description
            updated.append(scheme.id)
    db.flush()
    return {"removed": removed, "updated": updated, "retiredButPublished": kept_published}


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
