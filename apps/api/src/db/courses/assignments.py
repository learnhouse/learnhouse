from typing import Optional, Dict
from sqlalchemy import JSON, Column, ForeignKey, null
from sqlmodel import Field, SQLModel
from enum import Enum


## Assignment ##
class GradingTypeEnum(str, Enum):
    ALPHABET = "ALPHABET"
    NUMERIC = "NUMERIC"
    PERCENTAGE = "PERCENTAGE"


class AssignmentBase(SQLModel):
    """Represents the common fields for an assignment."""

    title: str
    description: str
    due_date: str
    published: Optional[bool] = False
    grading_type: GradingTypeEnum

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
    creation_date: Optional[str]
    update_date: Optional[str]


class AssignmentUpdate(SQLModel):
    """Model for updating an assignment."""

    title: Optional[str]
    description: Optional[str]
    due_date: Optional[str]
    published: Optional[bool]
    grading_type: Optional[GradingTypeEnum]
    org_id: Optional[int]
    course_id: Optional[int]
    chapter_id: Optional[int]
    activity_id: Optional[int]
    update_date: Optional[str]


class Assignment(AssignmentBase, table=True):
    """Represents an assignment with relevant details and foreign keys."""

    id: Optional[int] = Field(default=None, primary_key=True)
    creation_date: Optional[str]
    update_date: Optional[str]
    assignment_uuid: str

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
    FORM = "FORM"  # soon to be implemented
    OTHER = "OTHER"


class AssignmentTaskBase(SQLModel):
    """Represents the common fields for an assignment task."""

    title: str
    description: str
    hint: str
    reference_file: Optional[str]
    assignment_type: AssignmentTaskTypeEnum
    contents: Dict = Field(default={}, sa_column=Column(JSON))
    max_grade_value: int = 0  # Value is always between 0-100


class AssignmentTaskCreate(AssignmentTaskBase):
    """Model for creating a new assignment task."""

    pass  # Inherits all fields from AssignmentTaskBase


class AssignmentTaskRead(AssignmentTaskBase):
    """Model for reading an assignment task."""

    id: int
    assignment_task_uuid: str


class AssignmentTaskUpdate(SQLModel):
    """Model for updating an assignment task."""

    title: Optional[str]
    description: Optional[str]
    hint: Optional[str]
    assignment_type: Optional[AssignmentTaskTypeEnum]
    contents: Optional[Dict] = Field(default=None, sa_column=Column(JSON))
    max_grade_value: Optional[int]


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

    task_submission: Dict = Field(default={}, sa_column=Column(JSON))
    grade: int = 0  # Value is always between 0-100
    task_submission_grade_feedback: str
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

    assignment_task_id: Optional[int]
    assignment_task_submission_uuid: Optional[str]
    task_submission: Optional[Dict] = Field(default=None, sa_column=Column(JSON))
    grade: Optional[int]
    task_submission_grade_feedback: Optional[str]
    assignment_type: Optional[AssignmentTaskTypeEnum]


class AssignmentTaskSubmission(AssignmentTaskSubmissionBase, table=True):
    """Represents a submission for a specific assignment task with grade and feedback."""

    id: Optional[int] = Field(default=None, primary_key=True)
    assignment_task_submission_uuid: str
    task_submission: Dict = Field(default={}, sa_column=Column(JSON))
    grade: int = 0  # Value is always between 0-100
    task_submission_grade_feedback: str
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
        AssignmentUserSubmissionStatus.PENDING
    )
    grade: int
    user_id: int = Field(
        sa_column=Column("user_id", ForeignKey("user.id", ondelete="CASCADE"))
    )
    assignment_id: int = Field(
        sa_column=Column(
            "assignment_id", ForeignKey("assignment.id", ondelete="CASCADE")
        )
    )


class AssignmentUserSubmissionCreate(SQLModel):
    """Model for creating a new assignment user submission."""

    assignment_id: int
    pass  # Inherits all fields from AssignmentUserSubmissionBase


class AssignmentUserSubmissionRead(AssignmentUserSubmissionBase):
    """Model for reading an assignment user submission."""

    id: int
    creation_date: str
    update_date: str


class AssignmentUserSubmissionUpdate(SQLModel):
    """Model for updating an assignment user submission."""

    submission_status: Optional[AssignmentUserSubmissionStatus]
    grade: Optional[str]
    user_id: Optional[int]
    assignment_id: Optional[int]


class AssignmentUserSubmission(AssignmentUserSubmissionBase, table=True):
    """Represents the submission status of an assignment for a user."""

    id: Optional[int] = Field(default=None, primary_key=True)
    creation_date: str
    update_date: str
    assignmentusersubmission_uuid: str

    submission_status: AssignmentUserSubmissionStatus = (
        AssignmentUserSubmissionStatus.PENDING
    )
    grade: int
    user_id: int = Field(
        sa_column=Column("user_id", ForeignKey("user.id", ondelete="CASCADE"))
    )
    assignment_id: int = Field(
        sa_column=Column(
            "assignment_id", ForeignKey("assignment.id", ondelete="CASCADE")
        )
    )
