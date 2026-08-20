"""Teacher <-> section/subject assignment (20 Aug 2026, Practice Overview
redesign, Phase 0).

Why this table exists at all: School Enrichment serves whole schools (many
hundreds of students per standard, several sections per standard, multiple
subjects, and -- per the client, Shailesh -- eventually multiple boards),
not a single tutor's small roster the way the MathPath reference platform
does. A teacher is routinely assigned one subject across *several* sections
of a standard (Shailesh's own example: "Maths to 4 sections in the 5th
standard"), and which teacher owns which section/subject is something only
a school ADMIN can know and set -- it can never be inferred from the data
that already exists (`Student.teacher_id`, a single free FK with no subject
or section dimension, cannot represent this and is superseded by this
table; it is left in place, unused going forward, rather than dropped, so
nothing that still reads it breaks).

Row identity is (school, class_level, section, board_course) -- one
"teacher of record" for a given subject in a given section at a time.
`start_date`/`end_date` make that an actual real Date, not this codebase's
usual advisory free-text date convention (see Assignment.available_from's
docstring) -- these dates are load-bearing here: they gate both which
sections a teacher may currently act on (see
teacher_assignment_service.get_current_sections_for_teacher) and, per
Shailesh's explicit answer on 20 Aug 2026, which historical records a
teacher who has since been transferred off a section may still read
("the outgoing teacher can see the historical data which concerns them but
the future activities should not be shown to them") -- i.e. a teacher's
read access to Assignment/AssignmentTarget/Attempt rows is scoped to
whichever of their own assignment windows (current or ended) that record's
creation falls inside, not to "this section, ever, regardless of when".

A transfer (the designated teacher for a section/subject changing mid-year)
is modeled as ending one row (`end_date` set) and starting a brand new row
for the incoming teacher on the same date, atomically, in
teacher_assignment_service.transfer_teacher -- never by mutating
`teacher_id` in place, which would silently erase who was responsible for
what, when.

Substitute teachers (covering a class physically on a day the designated
teacher is absent) are deliberately NOT modeled here -- Shailesh confirmed
substitutes need no application access at all ("purely offline coverage"),
so there is nothing for this table, or any access-control check built on
it, to represent for them.
"""
from sqlalchemy import Column, Date, DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import relationship

from app.database import Base
from app.models.models import uuid_str


class TeacherSectionAssignment(Base):
    __tablename__ = "teacher_section_assignments"
    id = Column(String, primary_key=True, default=uuid_str)

    school_id = Column(String, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True)
    teacher_id = Column(String, ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False, index=True)
    class_level_id = Column(String, ForeignKey("class_levels.id", ondelete="RESTRICT"), nullable=False, index=True)
    # Free-text, matching Student.section's own convention (e.g. "A") -- a
    # normalized Section entity isn't needed yet; nothing besides this table
    # and Student.section stores structural facts about a section.
    section = Column(String(50), nullable=False)
    board_course_id = Column(String, ForeignKey("board_courses.id", ondelete="RESTRICT"), nullable=False, index=True)

    start_date = Column(Date, nullable=False)
    # NULL = this is the current, active assignment for this
    # (school, class_level, section, board_course) combination. Set only by
    # transfer_teacher() when control moves to a new teacher.
    end_date = Column(Date, nullable=True)

    # The admin who made this assignment/transfer -- nullable because a
    # SUPER_ADMIN acting without a SchoolAdmin row is a legitimate caller
    # too (see routes_curriculum_admin.py's _resolve_school_id docstring for
    # the same SUPER_ADMIN-has-no-SchoolAdmin-row pattern).
    created_by_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    school = relationship("School")
    teacher = relationship("Teacher")
    class_level = relationship("ClassLevel")
    board_course = relationship("BoardCourse")

    __table_args__ = (
        # Every lookup this table exists to answer -- "who currently teaches
        # this section/subject" and "was this teacher ever responsible for
        # this section/subject" -- filters on this exact column set.
        Index(
            "ix_tsa_school_class_section_course",
            "school_id",
            "class_level_id",
            "section",
            "board_course_id",
        ),
        Index("ix_tsa_teacher_current", "teacher_id", "end_date"),
    )
