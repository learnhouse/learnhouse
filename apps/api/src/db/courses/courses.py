from typing import List, Optional
from sqlalchemy import Column, ForeignKey, Integer
from sqlmodel import Field, SQLModel
from src.db.users import UserRead
from src.db.trails import TrailRead
from src.db.courses.chapters import ChapterRead
from src.db.resource_authors import ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum


class AuthorWithRole(SQLModel):
    user: UserRead
    authorship: ResourceAuthorshipEnum
    authorship_status: ResourceAuthorshipStatusEnum
    creation_date: str
    update_date: str


class CourseBase(SQLModel):
    name: str
    description: Optional[str]
    about: Optional[str]
    learnings: Optional[str]
    tags: Optional[str]
    thumbnail_image: Optional[str]
    public: bool
    open_to_contributors: bool


class Course(CourseBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    course_uuid: str = ""   
    creation_date: str = ""
    update_date: str = ""


class CourseCreate(CourseBase):
    org_id: int = Field(default=None, foreign_key="organization.id")
    pass


class CourseUpdate(CourseBase):
    name: str
    description: Optional[str]
    about: Optional[str]
    learnings: Optional[str]
    tags: Optional[str]
    public: Optional[bool]
    open_to_contributors: Optional[bool]


class CourseRead(CourseBase):
    id: int
    org_id: int = Field(default=None, foreign_key="organization.id")
    authors: List[AuthorWithRole]
    course_uuid: str
    creation_date: str
    update_date: str
    pass


class FullCourseRead(CourseBase):
    id: int
    org_id: int
    course_uuid: Optional[str]
    creation_date: Optional[str]
    update_date: Optional[str]
    # Chapters, Activities
    chapters: List[ChapterRead]
    authors: List[AuthorWithRole]
    pass


class FullCourseReadWithTrail(CourseBase):
    id: int
    course_uuid: Optional[str]
    creation_date: Optional[str]
    update_date: Optional[str]
    org_id: int = Field(default=None, foreign_key="organization.id")
    authors: List[AuthorWithRole]
    # Chapters, Activities
    chapters: List[ChapterRead]
    # Trail
    trail: TrailRead | None
    pass
