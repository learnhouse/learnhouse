from typing import Optional
from sqlmodel import Field, SQLModel
from enum import Enum


class CourseAuthorshipEnum(str, Enum):
    CREATOR = "CREATOR"
    MAINTAINER = "MAINTAINER"
    REPORTER = "REPORTER"


class CourseAuthor(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    course_id: int = Field(default=None, foreign_key="course.id")
    user_id: int = Field(default=None, foreign_key="user.id")
    authorship: CourseAuthorshipEnum = CourseAuthorshipEnum.CREATOR
    creation_date: str
    update_date: str
