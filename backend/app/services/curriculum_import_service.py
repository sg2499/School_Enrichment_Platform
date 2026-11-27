"""Imports one chapter workbook (the client's own "Portal Practice Bank"
.xlsx format -- see Content/CBSE_Class_5_Chapter_*.xlsx and each file's
"Portal Schema" sheet) into the curriculum + question-bank tables from
app/models/curriculum.py.

New for Phase 2. Column positions below were verified against three
different chapter files (1, 7, 10) before writing this -- the 32-column
"Question Bank" layout is identical in column order across every chapter
(only minor header label wording differs, e.g. "Chapter No" vs "Chapter
No."), so this parses by fixed position rather than by header text match,
which is the more brittle approach given that observed drift.

Import target is always DRAFT status (blueprint Section 15.1: "Import only
into DRAFT state; publishing requires validation and approval") -- this
service never marks anything PUBLISHED itself.

Idempotent by design: every natural code (Board.code, Discipline.code,
BoardCourse.code, Chapter.code, ConceptLesson.code, Question.code) is
looked up before insert, so re-running an import (e.g. after a content
team correction and re-export, blueprint Section 15.1's own "support
export... for correction and re-import" workflow) updates existing rows
rather than duplicating them.
"""
import json
import os
from dataclasses import dataclass, field

import openpyxl
from sqlalchemy.orm import Session

from app.models import (
    Board,
    BoardCourse,
    Chapter,
    ClassLevel,
    ConceptLesson,
    CourseDisciplineMap,
    CurriculumVersion,
    Discipline,
    Question,
    SubjectGroup,
)
from app.services import figures, question_approval_service
from app.services.audit_service import log_audit_event
from app.services.learning_service import MARKING_FIELD_LABELS, clean_marking_fields

# Question Bank sheet column positions (0-indexed) -- see module docstring.
QB_QUESTION_ID = 0
QB_BOARD = 1
QB_CLASS = 2
QB_SUBJECT = 3
QB_CHAPTER_NO = 4
QB_CHAPTER = 5
QB_SKILL_ID = 6
QB_SKILL = 7
QB_ASSIGNMENT_ID = 8
QB_STAGE = 9
QB_DIFFICULTY = 10
QB_COMPETENCY = 11
QB_QUESTION_TYPE = 12
QB_STEM = 13
QB_OPTION_A = 14
QB_OPTION_B = 15
QB_OPTION_C = 16
QB_OPTION_D = 17
QB_CORRECT_ANSWER = 18
QB_ACCEPTED_VARIANTS = 19
QB_HINT = 20
QB_EXPLANATION = 21
QB_MISCONCEPTION_TAG = 22
QB_MARKS = 23
QB_TIME_SECONDS = 24
QB_AUTO_GRADABLE = 25
QB_SHUFFLE_OPTIONS = 26
QB_RESPONSE_FORMAT = 27
QB_MEDIA_REQUIRED = 28
QB_TEACHER_NOTE = 29
QB_STATUS = 30
QB_SOURCE_ALIGNMENT = 31

# Optional marking columns (Phase 4, #164, 13 Oct 2026). Unlike the 32 above
# these are found by header name, wherever they sit, because they are new:
# a workbook made before them has none and imports exactly as before. A
# column that is absent leaves what is stored alone (so re-importing an old
# file never wipes a unit set in Curriculum Studio); a column that is there
# with an empty cell clears the field.
_MARKING_HEADERS = {label.lower(): key for key, label in MARKING_FIELD_LABELS.items()}
_MARKING_HEADERS["allow unit conversion"] = "allow_unit_conversion"


def _marking_columns(header_row) -> dict[str, int]:
    columns: dict[str, int] = {}
    for index, cell in enumerate(header_row or ()):
        key = _MARKING_HEADERS.get(str(cell).strip().lower()) if cell is not None else None
        if key and key not in columns:
            columns[key] = index
    return columns


STATUS_MAP = {
    "draft": "DRAFT",
    "sme review": "SME_REVIEW",
    "approved": "APPROVED",
    "published": "PUBLISHED",
}


@dataclass
class ImportResult:
    board_code: str
    discipline_code: str
    board_course_code: str
    chapter_code: str
    chapter_title: str
    concept_lessons_created: int = 0
    concept_lessons_updated: int = 0
    # Skills in a PUBLISHED chapter the workbook would have rewritten (A-035).
    concept_lessons_skipped_published: int = 0
    questions_created: int = 0
    questions_updated: int = 0
    # A-035: rows an import refused to touch because a person had already
    # approved the question, and A-036: rows whose Question ID belongs to a
    # question in another chapter. Both are reported, never applied silently.
    questions_skipped_approved: int = 0
    questions_skipped_other_chapter: int = 0
    # New rows whose Status column asked for something other than Draft. Not
    # a warning: a new question always starts as a Draft (A-035).
    questions_status_ignored: int = 0
    # The questions --allow-approved-overwrite actually rewrote, BY CODE.
    # A-012's own finding was that counts without ids cannot answer "which
    # ones"; this list is what makes an overwrite recoverable.
    overwritten_codes: list = field(default_factory=list)
    warnings: list = field(default_factory=list)


def _yn_to_bool(value) -> bool:
    return str(value).strip().lower() == "yes"


def _normalize_status(value) -> str:
    if not value:
        return "DRAFT"
    return STATUS_MAP.get(str(value).strip().lower(), "DRAFT")


def _row_changes_question(question, row, marking_columns, figure_column) -> list[str]:
    """Whether this workbook row would change anything about a question that
    already exists (A-035).

    Returns the NAMES of the fields that would change, so the refusal can say
    which ones. A bare "this differs" on 316 questions is unreadable and
    unactionable; "differs in: answer_unit, unit_rule" tells you at a glance
    that a re-import would undo the marking work (found on production,
    27 Nov 2026).

    Deliberately errs towards "changed": a field this does not compare is a
    field the import would change without saying so, which is the failure
    that matters. Status is not compared -- an import never sets it.
    """
    changed: list[str] = []
    for index, attribute in (
        (QB_ASSIGNMENT_ID, "assignment_code"),
        (QB_STAGE, "stage"),
        (QB_COMPETENCY, "competency"),
        (QB_QUESTION_TYPE, "question_type"),
        (QB_STEM, "stem"),
        (QB_OPTION_A, "option_a"),
        (QB_OPTION_B, "option_b"),
        (QB_OPTION_C, "option_c"),
        (QB_OPTION_D, "option_d"),
        (QB_ACCEPTED_VARIANTS, "accepted_variants"),
        (QB_HINT, "hint"),
        (QB_EXPLANATION, "explanation"),
        (QB_MISCONCEPTION_TAG, "misconception_tag"),
        (QB_RESPONSE_FORMAT, "response_format"),
        (QB_MEDIA_REQUIRED, "media_required"),
        (QB_TEACHER_NOTE, "teacher_note"),
        (QB_SOURCE_ALIGNMENT, "source_alignment"),
    ):
        if row[index] != getattr(question, attribute):
            changed.append(attribute)

    correct = str(row[QB_CORRECT_ANSWER]) if row[QB_CORRECT_ANSWER] is not None else ""
    if correct != (question.correct_answer or ""):
        changed.append("correct_answer")
    if (int(row[QB_DIFFICULTY]) if row[QB_DIFFICULTY] is not None else None) != question.difficulty:
        changed.append("difficulty")
    if (int(row[QB_MARKS]) if row[QB_MARKS] is not None else 1) != question.marks:
        changed.append("marks")
    if (int(row[QB_TIME_SECONDS]) if row[QB_TIME_SECONDS] is not None else None) != question.time_seconds:
        changed.append("time_seconds")
    if _yn_to_bool(row[QB_AUTO_GRADABLE]) != bool(question.auto_gradable):
        changed.append("auto_gradable")
    if _yn_to_bool(row[QB_SHUFFLE_OPTIONS]) != bool(question.shuffle_options):
        changed.append("shuffle_options")

    if marking_columns:
        marking, _problems = clean_marking_fields(
            {key: (row[index] if index < len(row) else None) for key, index in marking_columns.items()}
        )
        for key, value in marking.items():
            if value != getattr(question, key):
                changed.append(key)

    if figure_column is not None:
        raw = row[figure_column] if figure_column < len(row) else None
        if raw is None or not str(raw).strip():
            if question.figure is not None:
                changed.append("figure")
        else:
            try:
                if json.dumps(figures.check(str(raw))) != (question.figure or ""):
                    changed.append("figure")
            except figures.FigureError:
                changed.append("figure")

    return changed


def _find_header_row(rows, first_cell_value: str) -> int:
    """Skill Map sheets have 1-4 title/subtitle rows before the real header
    (see module docstring's Skill Map dump) -- locate it by content instead
    of assuming a fixed row index, since that varies slightly between files.
    """
    for i, row in enumerate(rows):
        if row and row[0] == first_cell_value:
            return i
    raise ValueError(f"Could not find header row starting with {first_cell_value!r}")


def _get_or_create_board(db: Session, code: str, display_name: str) -> Board:
    board = db.query(Board).filter(Board.code == code).first()
    if board:
        return board
    board = Board(code=code, display_name=display_name)
    db.add(board)
    db.flush()
    return board


def _get_or_create_class_level(db: Session, code: str) -> ClassLevel:
    level = db.query(ClassLevel).filter(ClassLevel.code == code).first()
    if level:
        return level
    level = ClassLevel(code=code, display_name=f"Class {code}", display_order=int(code) if code.isdigit() else 0)
    db.add(level)
    db.flush()
    return level


def _get_or_create_subject_group(db: Session, code: str, display_name: str) -> SubjectGroup:
    group = db.query(SubjectGroup).filter(SubjectGroup.code == code).first()
    if group:
        return group
    group = SubjectGroup(code=code, display_name=display_name)
    db.add(group)
    db.flush()
    return group


def _get_or_create_discipline(db: Session, code: str, display_name: str, subject_group: SubjectGroup) -> Discipline:
    discipline = db.query(Discipline).filter(Discipline.code == code).first()
    if discipline:
        return discipline
    discipline = Discipline(code=code, display_name=display_name, subject_group_id=subject_group.id)
    db.add(discipline)
    db.flush()
    return discipline


def _get_or_create_board_course(
    db: Session, board: Board, class_level: ClassLevel, code: str, display_name: str
) -> BoardCourse:
    course = (
        db.query(BoardCourse)
        .filter(
            BoardCourse.board_id == board.id,
            BoardCourse.class_level_id == class_level.id,
            BoardCourse.code == code,
        )
        .first()
    )
    if course:
        return course
    course = BoardCourse(
        board_id=board.id, class_level_id=class_level.id, code=code, display_name=display_name, status="DRAFT"
    )
    db.add(course)
    db.flush()
    return course


def _get_or_create_curriculum_version(
    db: Session, board: Board, code: str, label: str, status: str, effective_from: str | None
) -> CurriculumVersion:
    version = (
        db.query(CurriculumVersion)
        .filter(CurriculumVersion.board_id == board.id, CurriculumVersion.code == code)
        .first()
    )
    if version:
        return version
    version = CurriculumVersion(
        board_id=board.id, code=code, label=label, status=status, effective_from=effective_from
    )
    db.add(version)
    db.flush()
    return version


def _ensure_course_discipline_map(db: Session, board_course: BoardCourse, discipline: Discipline) -> None:
    existing = (
        db.query(CourseDisciplineMap)
        .filter(
            CourseDisciplineMap.board_course_id == board_course.id,
            CourseDisciplineMap.discipline_id == discipline.id,
        )
        .first()
    )
    if existing:
        return
    db.add(CourseDisciplineMap(board_course_id=board_course.id, discipline_id=discipline.id, sequence=1))
    db.flush()


def import_chapter_workbook(
    db: Session,
    file_path: str,
    *,
    board_code: str = "CBSE",
    board_display_name: str = "CBSE",
    class_level_code: str = "5",
    subject_group_code: str = "SCIENCE",
    subject_group_display_name: str = "Science Group",
    discipline_code: str = "MATHEMATICS",
    discipline_display_name: str = "Mathematics",
    board_course_code: str = "MATHEMATICS",
    board_course_display_name: str = "Mathematics",
    curriculum_version_code: str = "2026-27",
    curriculum_version_label: str = "2026-27",
    curriculum_version_status: str = "PUBLISHED",
    curriculum_version_effective_from: str | None = "2026-04-01",
    commit: bool = True,
    allow_approved_overwrite: bool = False,
) -> ImportResult:
    """Import one chapter workbook. Master data (board/class level/subject
    group/discipline/board course/curriculum version) is shared across
    chapters and created once, on first import, then reused -- callers
    importing multiple chapters for the same board/class/subject/edition
    should pass the same codes each time.

    A chapter's real identity is (board_course, discipline, curriculum_version,
    code) -- see the Chapter model docstring (18 Aug 2026) -- not just
    (discipline, code), so that e.g. Class 6 Maths content can safely reuse
    "CH01" the same way Class 5 Maths does, and a future syllabus edition can
    be imported alongside an older one without colliding with it. Callers
    importing a new class or a new syllabus year should pass a distinct
    board_course_code/class_level_code or curriculum_version_code
    accordingly -- reusing the same codes across genuinely different
    classes/editions is what would cause a collision, not this importer.
    """
    wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)

    qb_rows = list(wb["Question Bank"].iter_rows(values_only=True))
    if not qb_rows or qb_rows[0][QB_QUESTION_ID] != "Question ID":
        raise ValueError("Question Bank sheet does not start with the expected header row")
    qb_data_rows = [r for r in qb_rows[1:] if r and r[QB_QUESTION_ID]]
    marking_columns = _marking_columns(qb_rows[0])
    figure_column = next((i for i, cell in enumerate(qb_rows[0]) if cell is not None and str(cell).strip().lower() == "figure"), None)

    sm_rows = list(wb["Skill Map"].iter_rows(values_only=True))
    sm_header_idx = _find_header_row(sm_rows, "Skill ID")
    sm_data_rows = [r for r in sm_rows[sm_header_idx + 1 :] if r and r[0]]

    first = qb_data_rows[0]
    chapter_no = int(first[QB_CHAPTER_NO])
    chapter_title = str(first[QB_CHAPTER]).strip()
    chapter_code = f"CH{chapter_no:02d}"

    board = _get_or_create_board(db, board_code, board_display_name)
    class_level = _get_or_create_class_level(db, class_level_code)
    subject_group = _get_or_create_subject_group(db, subject_group_code, subject_group_display_name)
    discipline = _get_or_create_discipline(db, discipline_code, discipline_display_name, subject_group)
    board_course = _get_or_create_board_course(
        db, board, class_level, board_course_code, board_course_display_name
    )
    _ensure_course_discipline_map(db, board_course, discipline)
    curriculum_version = _get_or_create_curriculum_version(
        db, board, curriculum_version_code, curriculum_version_label,
        curriculum_version_status, curriculum_version_effective_from,
    )

    chapter = (
        db.query(Chapter)
        .filter(
            Chapter.board_course_id == board_course.id,
            Chapter.discipline_id == discipline.id,
            Chapter.curriculum_version_id == curriculum_version.id,
            Chapter.code == chapter_code,
        )
        .first()
    )
    if chapter is None:
        chapter = Chapter(
            discipline_id=discipline.id,
            board_course_id=board_course.id,
            curriculum_version_id=curriculum_version.id,
            code=chapter_code,
            chapter_no=chapter_no,
            title=chapter_title,
            sequence=chapter_no,
            status="DRAFT",
            source_reference=f"Imported from {file_path}",
        )
        db.add(chapter)
        db.flush()
    else:
        chapter.title = chapter_title

    result = ImportResult(
        board_code=board_code,
        discipline_code=discipline_code,
        board_course_code=board_course_code,
        chapter_code=chapter_code,
        chapter_title=chapter_title,
    )

    # --- Concept lessons (one per Skill Map row) ---
    concept_lessons_by_code: dict[str, ConceptLesson] = {}
    for i, row in enumerate(sm_data_rows, start=1):
        skill_id = str(row[0]).strip()
        skill_name = str(row[1]).strip()
        learning_outcome = row[2]
        prerequisite_note = row[3]
        priority_misconception = row[4]

        lesson = (
            db.query(ConceptLesson)
            .filter(ConceptLesson.chapter_id == chapter.id, ConceptLesson.code == skill_id)
            .first()
        )
        if lesson is None:
            lesson = ConceptLesson(
                chapter_id=chapter.id,
                code=skill_id,
                title=skill_name,
                learning_outcome=learning_outcome,
                prerequisite_note=prerequisite_note,
                priority_misconception=priority_misconception,
                sequence=i,
                status="DRAFT",
            )
            db.add(lesson)
            db.flush()
            result.concept_lessons_created += 1
        else:
            # A-035, extended to skills after the 27 Nov production dry run.
            # The guard below started on questions alone, and the run showed
            # 225 skill rows being rewritten per pass -- including the names
            # Ashalatha reviewed through apply_content_edits.py's "Skill
            # Names" sheet. A workbook does not overrule a reviewer there
            # either. A skill in a chapter nobody has published yet is still
            # updated freely: nothing is live to protect.
            differs = [
                field
                for field, value in (
                    ("title", skill_name),
                    ("learning_outcome", learning_outcome),
                    ("prerequisite_note", prerequisite_note),
                    ("priority_misconception", priority_misconception),
                )
                if getattr(lesson, field) != value
            ]
            if differs and chapter.status == "PUBLISHED" and not allow_approved_overwrite:
                result.warnings.append(
                    f"Skill {skill_id}: this chapter is published, so the workbook's version was "
                    f"not applied. It differs in: {', '.join(differs)}. Re-run with "
                    f"--allow-approved-overwrite to replace it."
                )
                result.concept_lessons_skipped_published += 1
            elif differs:
                lesson.title = skill_name
                lesson.learning_outcome = learning_outcome
                lesson.prerequisite_note = prerequisite_note
                lesson.priority_misconception = priority_misconception
                # Counted only where something really changed. It used to
                # count every skill it touched, so a re-run over content that
                # had not moved reported "15 updated" for fifteen no-op
                # writes -- which reads as a change nobody made (found on
                # production, 27 Nov 2026). Same rule the question side uses.
                result.concept_lessons_updated += 1
                if chapter.status == "PUBLISHED":
                    result.overwritten_codes.append(skill_id)
        concept_lessons_by_code[skill_id] = lesson

    # Every skill in THIS chapter. A question whose code is already taken by
    # a question outside this set belongs to another chapter (A-036); moving
    # one between skills WITHIN a chapter stays allowed, because that is a
    # correction a re-import is meant to make.
    lesson_ids = {lesson.id for lesson in concept_lessons_by_code.values()}

    # --- Questions (one per Question Bank row) ---
    for row in qb_data_rows:
        skill_id = str(row[QB_SKILL_ID]).strip()
        lesson = concept_lessons_by_code.get(skill_id)
        if lesson is None:
            result.warnings.append(
                f"Question {row[QB_QUESTION_ID]} references Skill ID {skill_id!r}, not found in Skill Map -- skipped"
            )
            continue

        code = str(row[QB_QUESTION_ID]).strip()
        # A question is found by its code ALONE, and uq_question_code is
        # global, so before this check a workbook that reused another board's
        # Question ID did not collide -- it silently moved that question into
        # this chapter and rewrote it, inside whatever sets already held it
        # (A-036). The code is the supplier's; the chapter is ours.
        question = db.query(Question).filter(Question.code == code).first()
        is_new = question is None
        if question is not None and question.concept_lesson_id not in lesson_ids:
            result.warnings.append(
                f"Question {code}: that Question ID already belongs to a question in another "
                f"chapter, so this row was skipped. Give it an ID of its own."
            )
            result.questions_skipped_other_chapter += 1
            continue
        if question is not None and question.status in question_approval_service.APPROVED_STATUSES:
            # A-035: a person has approved this question. A workbook does not
            # overrule a person, and a re-import used to rewrite the stem, the
            # key and the marking of live content without a word. The warning
            # is raised only where the row would actually change something,
            # so a re-run over a whole class does not bury the real
            # differences under thousands of identical rows.
            if not allow_approved_overwrite:
                differs = _row_changes_question(question, row, marking_columns, figure_column)
                if differs:
                    result.warnings.append(
                        f"Question {code}: a person has already approved this question, so the "
                        f"workbook's version was not applied. It differs in: {', '.join(differs)}. "
                        f"Re-run with --allow-approved-overwrite to replace it."
                    )
                    result.questions_skipped_approved += 1
                continue
            result.overwritten_codes.append(code)
        if question is None:
            question = Question(code=code, concept_lesson_id=lesson.id)

        question.concept_lesson_id = lesson.id
        question.assignment_code = row[QB_ASSIGNMENT_ID]
        question.stage = row[QB_STAGE]
        question.difficulty = int(row[QB_DIFFICULTY]) if row[QB_DIFFICULTY] is not None else None
        question.competency = row[QB_COMPETENCY]
        question.question_type = row[QB_QUESTION_TYPE]
        question.stem = row[QB_STEM]
        question.option_a = row[QB_OPTION_A]
        question.option_b = row[QB_OPTION_B]
        question.option_c = row[QB_OPTION_C]
        question.option_d = row[QB_OPTION_D]
        question.correct_answer = str(row[QB_CORRECT_ANSWER]) if row[QB_CORRECT_ANSWER] is not None else ""
        question.accepted_variants = row[QB_ACCEPTED_VARIANTS]
        question.hint = row[QB_HINT]
        question.explanation = row[QB_EXPLANATION]
        question.misconception_tag = row[QB_MISCONCEPTION_TAG]
        question.marks = int(row[QB_MARKS]) if row[QB_MARKS] is not None else 1
        question.time_seconds = int(row[QB_TIME_SECONDS]) if row[QB_TIME_SECONDS] is not None else None
        question.auto_gradable = _yn_to_bool(row[QB_AUTO_GRADABLE])
        question.shuffle_options = _yn_to_bool(row[QB_SHUFFLE_OPTIONS])
        question.response_format = row[QB_RESPONSE_FORMAT]
        question.media_required = row[QB_MEDIA_REQUIRED]
        question.teacher_note = row[QB_TEACHER_NOTE]
        # A-035: an import NEVER sets the status of a question that already
        # exists, in either direction. It used to take the Status column at
        # its word, which meant a supplier's spreadsheet could approve a
        # question nobody had read (import once as Draft, re-import as
        # Approved -- and this loader advertises itself as safe to re-run),
        # or send a live question back for rework and pull it out of its sets,
        # which is A-011 part 4 undone by a spreadsheet. A new question always
        # starts in DRAFT, whatever the column says, which is what
        # import_class5_maths.py has always promised on screen.
        if is_new:
            question.status = "DRAFT"
            if _normalize_status(row[QB_STATUS]) != "DRAFT":
                # Counted, not warned per row. A new question starting as a
                # Draft is the rule, not a problem with the file, and a
                # supplier workbook can carry hundreds of such rows -- one
                # line at the end says it once. Warnings are for things that
                # need a person to look.
                result.questions_status_ignored += 1
        question.source_alignment = row[QB_SOURCE_ALIGNMENT]
        if marking_columns:
            marking, problems = clean_marking_fields(
                {key: (row[index] if index < len(row) else None) for key, index in marking_columns.items()}
            )
            for key, value in marking.items():
                setattr(question, key, value)
            for _field, problem in problems:
                result.warnings.append(f"Question {code}: {problem} Left as it was.")
        if figure_column is not None:
            # #218: a drawn picture. Like the marking columns, an absent column
            # leaves what is stored alone; an empty cell clears it.
            raw = row[figure_column] if figure_column < len(row) else None
            if raw is None or not str(raw).strip():
                question.figure = None
            else:
                try:
                    question.figure = json.dumps(figures.check(str(raw)))
                except figures.FigureError as exc:
                    result.warnings.append(f"Question {code}: the figure cannot be drawn ({exc}) Left as it was.")

        if is_new:
            db.add(question)
            result.questions_created += 1
        else:
            result.questions_updated += 1

    # A-035: an import left no trace at all. log_audit_event only does
    # db.add, so this row lives or dies with the rest of the import -- a
    # dry run that rolls back leaves no audit row either, which is right.
    # The overwritten questions are listed BY CODE, not counted: A-012's own
    # finding was that a count cannot answer "which ones".
    log_audit_event(
        db,
        "curriculum.chapter.imported",
        details={
            "chapterCode": chapter.code,
            "boardCode": board_code,
            "classLevel": class_level_code,
            "file": os.path.basename(file_path),
            "conceptLessonsCreated": result.concept_lessons_created,
            "conceptLessonsUpdated": result.concept_lessons_updated,
            "conceptLessonsSkippedPublished": result.concept_lessons_skipped_published,
            "questionsCreated": result.questions_created,
            "questionsUpdated": result.questions_updated,
            "questionsSkippedApproved": result.questions_skipped_approved,
            "questionsSkippedOtherChapter": result.questions_skipped_other_chapter,
            "questionsStatusIgnored": result.questions_status_ignored,
            "allowApprovedOverwrite": allow_approved_overwrite,
            "overwrittenCodes": result.overwritten_codes,
        },
    )

    if commit:
        db.commit()
    else:
        # The caller commits (or rolls back) a whole batch: all or nothing.
        db.flush()
    return result
