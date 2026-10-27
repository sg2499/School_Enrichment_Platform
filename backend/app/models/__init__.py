from app.models.assessment import (  # noqa: F401
    AcademicYear,
    AssessmentComponent,
    AssessmentComponentActivity,
    AssessmentScheme,
    ComponentMark,
    GradeBand,
)
from app.models.curriculum import (  # noqa: F401
    Board,
    BoardCourse,
    Chapter,
    ClassLevel,
    ConceptLesson,
    CourseDisciplineMap,
    CurriculumVersion,
    Discipline,
    MisconceptionReview,
    PrerequisiteLink,
    Question,
    SchoolCurriculumMap,
    SubjectGroup,
    Term,
)
from app.models.papers import GeneratedQuestion, QuestionPattern  # noqa: F401
from app.models.learning import (  # noqa: F401
    ACTIVITY_TYPES,
    ASSIGNMENT_REASONS,
    FOUNDATION_REPAIR_REASONS,
    Assignment,
    AssignmentTarget,
    Attempt,
    AttemptAnswer,
    Evaluation,
    LearningActivity,
    LearningActivityQuestion,
)
from app.models.models import AuditLog, School, SchoolAdmin, Student, Teacher, User, UserSession  # noqa: F401
from app.models.report_card import ReportCard, ReportCardIssue, ReportSettings, StudentTermRecord  # noqa: F401
from app.models.weekly_report import WeeklyReport, WeeklyReportIssue, WeeklyReportNote  # noqa: F401
from app.models.teacher_assignment import TeacherSectionAssignment  # noqa: F401
