from typing import Optional
from openai import BaseModel
from sqlalchemy import JSON, Column, ForeignKey
from sqlmodel import Field, SQLModel
from enum import Enum


class AssignmentTypeEnum(str, Enum):
    FILE_SUBMISSION = "FILE_SUBMISSION"
    QUIZ = "QUIZ"
    OTHER = "OTHER"


class Assignment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    assignment_uuid: str
    title: str
    description: str
    due_date: str

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

    creation_date: str
    update_date: str


class AssignmentTask(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    assignment_task_uuid: str = ""
    title: str = ""
    description: str = ""
    hint: str = ""
    assignment_type: AssignmentTypeEnum
    contents: dict = Field(default={}, sa_column=Column(JSON))
    max_grade_value: int = (
        0  # Value is always between 0-100 and is used as the maximum grade for the task
    )

    # Foreign keys
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
    creation_date: str
    update_date: str


class AssignmentTaskSubmission(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    assignment_task_submission_uuid: str = ""
    task_submission: dict = Field(default={}, sa_column=Column(JSON))
    grade: int = (
        0  # Value is always between 0-100 depending on the questions, this is used to calculate the final grade on the AssignmentUser model
    )
    task_submission_grade_feedback: str = ""  # Feedback given by the teacher

    # Foreign keys
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
            "assignment_task_id", ForeignKey("assignment_task.id", ondelete="CASCADE")
        )
    )
    creation_date: str = ""
    update_date: str = ""


# Note on grading :
# To calculate the final grade :




class AssignmentUserSubmissionStatus(str, Enum):
    PENDING = "PENDING"
    SUBMITTED = "SUBMITTED"
    GRADED = "GRADED"
    LATE = "LATE"
    NOT_SUBMITTED = "NOT_SUBMITTED"


class AssignmentUserSubmission(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    assignment_user_uuid: str = ""
    submission_status: AssignmentUserSubmissionStatus = (
        AssignmentUserSubmissionStatus.PENDING
    )
    grading: str = ""
    user_id: int = Field(
        sa_column=Column("user_id", ForeignKey("user.id", ondelete="CASCADE"))
    )
    assignment_id: int = Field(
        sa_column=Column(
            "assignment_id", ForeignKey("assignment.id", ondelete="CASCADE")
        )
    )
    creation_date: str = ""
    update_date: str = ""
