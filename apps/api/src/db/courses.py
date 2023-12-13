from typing import List, Optional
from sqlmodel import Field, SQLModel
from src.db.users import UserRead
from src.db.trails import TrailRead
from src.db.chapters import ChapterRead


class CourseBase(SQLModel):
    name: str
    description: Optional[str]
    about: Optional[str]
    learnings: Optional[str]
    tags: Optional[str]
    thumbnail_image: Optional[str]
    public: bool


class Course(CourseBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(default=None, foreign_key="organization.id")
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


class CourseRead(CourseBase):
    id: int
    org_id: int = Field(default=None, foreign_key="organization.id")
    authors: List[UserRead] 
    course_uuid: str
    creation_date: str
    update_date: str
    pass


class FullCourseRead(CourseBase):
    id: int
    course_uuid: str
    creation_date: str
    update_date: str
    # Chapters, Activities
    chapters: List[ChapterRead]
    authors: List[UserRead] 
    pass


class FullCourseReadWithTrail(CourseBase):
    id: int
    course_uuid: str
    creation_date: str
    update_date: str
    authors: List[UserRead] 
    # Chapters, Activities
    chapters: List[ChapterRead]
    # Trail
    trail: TrailRead | None
    pass
