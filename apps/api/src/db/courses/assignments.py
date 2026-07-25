from typing import Optional, Dict
from sqlalchemy import JSON, Column, ForeignKey, Index, UniqueConstraint
from sqlmodel import Field, SQLModel
from enum import Enum


## Assignment ##
class GradingTypeEnum(str, Enum):
    ALPHABET = "ALPHABET"
    NUMERIC = "NUMERIC"
    PERCENTAGE = "PERCENTAGE"
    PASS_FAIL = "PASS_FAIL"
    GPA_SCALE = "GPA_SCALE"


class AssignmentBase(SQLModel):
    """Represents the common fields for an assignment."""

    title: str
    description: str
    due_date: str
    published: Optional[bool] = False
    grading_type: GradingTypeEnum
    # When True, submissions are graded + marked as done automatically on
    # submit. Only applies when every task is auto-gradable (no file uploads
    # which require a human). Teacher can still override by re-grading later.
    auto_grading: Optional[bool] = False
    # When True, the student-facing task views block paste events on code
    # editors and text inputs. This is a soft deterrent — it can be bypassed
    # but it discourages casual AI-assisted copy/paste.
    anti_copy_paste: Optional[bool] = False
    # When True, after a submission is GRADED the student's task view reveals
    # the correct answers (which quiz options were right, the accepted short
    # answer, the expected number, the correct form blanks). Defaults to False
    # so existing assignments don't start leaking answer keys automatically —
    # the teacher must explicitly opt in.
    show_correct_answers: Optional[bool] = False
    # When True, after a submission is GRADED the student may reset their work
    # and try the assignment again. The retry wipes per-task submissions and
    # the user submission row back to a fresh state — only the attempt
    # counter on AssignmentUserSubmission survives, so a future grade
    # replaces the previous one (no submission history is kept).
    allow_retries: Optional[bool] = False
    # Upper bound on the number of attempts. 0 means unlimited. The first
    # submission is attempt 1, so a teacher who sets max_retries=3 gives the
    # student up to 3 graded attempts total (initial + 2 retries).
    max_retries: Optional[int] = 0
    # Passing line as a percentage (0-100). When None, the grading-type default
    # applies (50 for NUMERIC/PERCENTAGE/PASS_FAIL, 60 for ALPHABET/GPA_SCALE).
    # Nullable so every existing assignment keeps its legacy behavior.
    pass_threshold_percentage: Optional[float] = None

    org_id: int
    course_id: int
    chapter_id: int
    activity_id: int


class AssignmentCreate(AssignmentBase):
    """Model for creating a new assignment."""

    pass  # Inherits all fields from AssignmentBase


class AssignmentRead(AssignmentBase):
    """Model for reading an assignment."""

    id: int
    assignment_uuid: str
    creation_date: Optional[str] = None
    update_date: Optional[str] = None
    # Populated by the read service from a joined query so the frontend can
    # build file-ref URLs without a second round-trip per request.
    course_uuid: Optional[str] = None
    activity_uuid: Optional[str] = None


class AssignmentUpdate(SQLModel):
    """Model for updating an assignment.

    The structural foreign keys (org_id / course_id / chapter_id / activity_id)
    are intentionally NOT exposed here. They locate the assignment inside a
    single tenant/course, and the update endpoint only authorizes against the
    assignment's *current* course — so accepting client-supplied parents would
    let an instructor reparent an assignment into another org/course they don't
    own. Assignments are created inside a course and never legitimately moved
    across one through this endpoint.
    """

    title: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[str] = None
    published: Optional[bool] = None
    grading_type: Optional[GradingTypeEnum] = None
    auto_grading: Optional[bool] = None
    anti_copy_paste: Optional[bool] = None
    show_correct_answers: Optional[bool] = None
    allow_retries: Optional[bool] = None
    max_retries: Optional[int] = None
    pass_threshold_percentage: Optional[float] = None
    update_date: Optional[str] = None


class Assignment(AssignmentBase, table=True):
    """Represents an assignment with relevant details and foreign keys."""
    __table_args__ = (
        Index("ix_assignment_course_id", "course_id"),
        Index("ix_assignment_org_id", "org_id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    creation_date: Optional[str] = None
    update_date: Optional[str] = None
    assignment_uuid: str = Field(default="", index=True)

    org_id: int = Field(
        sa_column=Column("org_id", ForeignKey("organization.id", ondelete="CASCADE"))
    )
    course_id: int = Field(
        sa_column=Column("course_id", ForeignKey("course.id", ondelete="CASCADE"))
    )
    chapter_id: int = Field(
        sa_column=Column("chapter_id", ForeignKey("chapter.id", ondelete="CASCADE"))
    )
    activity_id: int = Field(
        sa_column=Column("activity_id", ForeignKey("activity.id", ondelete="CASCADE"))
    )


## Assignment ##

## AssignmentTask ##


class AssignmentTaskTypeEnum(str, Enum):
    FILE_SUBMISSION = "FILE_SUBMISSION"
    QUIZ = "QUIZ"
    FORM = "FORM"
    CODE = "CODE"
    SHORT_ANSWER = "SHORT_ANSWER"
    NUMBER_ANSWER = "NUMBER_ANSWER"
    # Headless/custom task: the `contents` JSON (the task definition) and the
    # `task_submission` JSON (the learner answer) are an arbitrary, caller-owned
    # data object. The server never interprets or auto-grades it — it is graded
    # manually (or left ungraded), so custom frontends fully control the schema.
    CUSTOM = "CUSTOM"
    OTHER = "OTHER"


class AssignmentTaskBase(SQLModel):
    """Represents the common fields for an assignment task."""

    title: str
    description: str
    hint: str
    reference_file: Optional[str] = None
    assignment_type: AssignmentTaskTypeEnum
    contents: Dict = Field(default_factory=dict, sa_column=Column(JSON))
    # Internal grading scale for this task. Defaults to 100 — every task is
    # graded out of 100 (a percentage). The field stays in the DB because
    # legacy assignments set different values which, when summed, yielded a
    # weighted average. New tasks and the UI always use 100, so the
    # compute_assignment_grade math produces a simple average across tasks.
    # Must be non-negative: a negative max would subtract from the assignment
    # total, and compute_assignment_grade clamps a non-positive total to a
    # vacuous pass, so a single negative task could cancel real points and hand
    # out the certificate. (DB CHECK constraint is a follow-up; the API rejects
    # it here.)
    max_grade_value: int = Field(default=100, ge=0)


class AssignmentTaskCreate(AssignmentTaskBase):
    """Model for creating a new assignment task."""

    pass  # Inherits all fields from AssignmentTaskBase


class AssignmentTaskRead(AssignmentTaskBase):
    """Model for reading an assignment task."""

    id: int
    assignment_task_uuid: str
    creation_date: str
    update_date: str


class AssignmentTaskUpdate(SQLModel):
    """Model for updating an assignment task."""

    title: Optional[str] = None
    description: Optional[str] = None
    hint: Optional[str] = None
    assignment_type: Optional[AssignmentTaskTypeEnum] = None
    contents: Optional[Dict] = Field(default=None, sa_column=Column(JSON))
    max_grade_value: Optional[int] = Field(default=None, ge=0)


class AssignmentTask(AssignmentTaskBase, table=True):
    """Represents a task within an assignment with various attributes and foreign keys."""

    id: Optional[int] = Field(default=None, primary_key=True)

    assignment_task_uuid: str
    creation_date: str
    update_date: str

    assignment_id: int = Field(
        sa_column=Column(
            "assignment_id", ForeignKey("assignment.id", ondelete="CASCADE")
        )
    )
    org_id: int = Field(
        sa_column=Column("org_id", ForeignKey("organization.id", ondelete="CASCADE"))
    )
    course_id: int = Field(
        sa_column=Column("course_id", ForeignKey("course.id", ondelete="CASCADE"))
    )
    chapter_id: int = Field(
        sa_column=Column("chapter_id", ForeignKey("chapter.id", ondelete="CASCADE"))
    )
    activity_id: int = Field(
        sa_column=Column("activity_id", ForeignKey("activity.id", ondelete="CASCADE"))
    )


## AssignmentTask ##


## AssignmentTaskSubmission ##


class AssignmentTaskSubmissionBase(SQLModel):
    """Represents the common fields for an assignment task submission."""
    assignment_task_submission_uuid: str
    task_submission: Dict = Field(default_factory=dict, sa_column=Column(JSON))
    grade: int = 0  # Task-local raw score; aggregated into AssignmentUserSubmission.grade
    task_submission_grade_feedback: str
    # True when a teacher set this task's grade through the manual grading UI.
    # The aggregate grading pass skips server-side re-verification for these
    # rows so the teacher's deliberate override is not overwritten.
    manually_graded: bool = False
    assignment_type: AssignmentTaskTypeEnum

    user_id: int
    activity_id: int
    course_id: int
    chapter_id: int
    assignment_task_id: int


class AssignmentTaskSubmissionCreate(AssignmentTaskSubmissionBase):
    """Model for creating a new assignment task submission."""

    pass  # Inherits all fields from AssignmentTaskSubmissionBase


class AssignmentTaskSubmissionRead(AssignmentTaskSubmissionBase):
    """Model for reading an assignment task submission."""

    id: int
    creation_date: str
    update_date: str


class AssignmentTaskSubmissionUpdate(SQLModel):
    """Model for updating an assignment task submission."""

    assignment_task_id: Optional[int] = None
    assignment_task_submission_uuid: Optional[str] = None
    task_submission: Optional[Dict] = Field(default=None, sa_column=Column(JSON))
    grade: Optional[int] = None
    task_submission_grade_feedback: Optional[str] = None
    manually_graded: Optional[bool] = None
    assignment_type: Optional[AssignmentTaskTypeEnum] = None


class AssignmentTaskSubmission(AssignmentTaskSubmissionBase, table=True):
    """Represents a submission for a specific assignment task with grade and feedback."""
    # One submission row per (user, task). Enforced in the DB so two concurrent
    # save-progress/submit requests can't each pass the "does a row exist?" check
    # and both INSERT (duplicate rows make grading pick a nondeterministic row).
    __table_args__ = (
        UniqueConstraint(
            "user_id", "assignment_task_id",
            name="uq_assignmenttasksubmission_user_task",
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    assignment_task_submission_uuid: str
    task_submission: Dict = Field(default_factory=dict, sa_column=Column(JSON))
    grade: int = 0  # Task-local raw score; aggregated into AssignmentUserSubmission.grade
    task_submission_grade_feedback: str
    manually_graded: bool = Field(default=False, nullable=False)
    assignment_type: AssignmentTaskTypeEnum

    user_id: int = Field(
        sa_column=Column("user_id", ForeignKey("user.id", ondelete="CASCADE"))
    )
    activity_id: int = Field(
        sa_column=Column("activity_id", ForeignKey("activity.id", ondelete="CASCADE"))
    )
    course_id: int = Field(
        sa_column=Column("course_id", ForeignKey("course.id", ondelete="CASCADE"))
    )
    chapter_id: int = Field(
        sa_column=Column("chapter_id", ForeignKey("chapter.id", ondelete="CASCADE"))
    )
    assignment_task_id: int = Field(
        sa_column=Column(
            "assignment_task_id", ForeignKey("assignmenttask.id", ondelete="CASCADE")
        )
    )

    creation_date: str
    update_date: str


## AssignmentTaskSubmission ##

## AssignmentUserSubmission ##


class AssignmentUserSubmissionStatus(str, Enum):
    PENDING = "PENDING"
    SUBMITTED = "SUBMITTED"
    GRADED = "GRADED"
    LATE = "LATE"
    NOT_SUBMITTED = "NOT_SUBMITTED"


class AssignmentUserSubmissionBase(SQLModel):
    """Represents the submission status of an assignment for a user."""

    submission_status: AssignmentUserSubmissionStatus = (
        AssignmentUserSubmissionStatus.SUBMITTED
    )
    grade: int
    # Optional overall note left by the instructor on the assignment as a whole
    # (separate from task_submission_grade_feedback which is per-task).
    overall_feedback: Optional[str] = None
    # Which attempt produced this row. The first submission is attempt 1.
    # When retries are enabled, the retry endpoint resets the row in place
    # (status -> PENDING, grade -> 0, attempt_number incremented) so a single
    # AssignmentUserSubmission row tracks the student's latest attempt while
    # still bounding how many times they can resubmit.
    attempt_number: int = 1
    user_id: int = Field(
        sa_column=Column("user_id", ForeignKey("user.id", ondelete="CASCADE"))
    )
    assignment_id: int = Field(
        sa_column=Column(
            "assignment_id", ForeignKey("assignment.id", ondelete="CASCADE")
        )
    )


class AssignmentUserSubmissionCreate(SQLModel):
    """Model for creating/updating an assignment user submission.

    Carries the editable submission fields so the instructor update endpoint
    can actually persist them. These are Optional because the update path only
    applies non-None values and strips the privileged ones for students.
    """

    assignment_id: int
    # Only the fields the update endpoint guards for students are exposed here.
    # attempt_number / overall_feedback are intentionally NOT settable through
    # this model: the update service does not strip them for non-instructors,
    # so exposing them would let a student reset their own retry counter
    # (attempt_number) or overwrite the instructor's feedback.
    submission_status: Optional[AssignmentUserSubmissionStatus] = None
    grade: Optional[int] = None
    user_id: Optional[int] = None


class AssignmentUserSubmissionRead(AssignmentUserSubmissionBase):
    """Model for reading an assignment user submission."""

    id: int
    creation_date: str
    update_date: str


class AssignmentUserSubmissionUpdate(SQLModel):
    """Model for updating an assignment user submission."""

    submission_status: Optional[AssignmentUserSubmissionStatus] = None
    grade: Optional[int] = None
    overall_feedback: Optional[str] = None
    attempt_number: Optional[int] = None
    user_id: Optional[int] = None
    assignment_id: Optional[int] = None


class AssignmentUserSubmission(AssignmentUserSubmissionBase, table=True):
    """Represents the submission status of an assignment for a user."""
    # One submission row per (user, assignment) — retries reset the row in place
    # rather than inserting a new one. Enforced in the DB so two concurrent
    # submit requests (double-click) can't both INSERT a duplicate row that then
    # splits grading/webhooks across two rows.
    __table_args__ = (
        UniqueConstraint(
            "user_id", "assignment_id",
            name="uq_assignmentusersubmission_user_assignment",
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    creation_date: str
    update_date: str
    assignmentusersubmission_uuid: str

    submission_status: AssignmentUserSubmissionStatus = (
        AssignmentUserSubmissionStatus.SUBMITTED
    )
    grade: int
    overall_feedback: Optional[str] = None
    attempt_number: int = 1
    user_id: int = Field(
        sa_column=Column("user_id", ForeignKey("user.id", ondelete="CASCADE"))
    )
    assignment_id: int = Field(
        sa_column=Column(
            "assignment_id", ForeignKey("assignment.id", ondelete="CASCADE")
        )
    )
