from typing import Optional
from sqlmodel import Field, SQLModel

class CourseBase(SQLModel):
    name: str
    description: Optional[str] = ""
    about: Optional[str] = ""
    course_slug: str
    learnings: Optional[str] = ""
    tags: Optional[str] = ""
    thumbnail_image: Optional[str] = ""
    public: bool

class Course(CourseBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(default=None, foreign_key="organization.id")
    course_uuid: str
    creation_date: str
    update_date: str
    
class CourseCreate(CourseBase):
    pass

class CourseRead(CourseBase):
    id: int
    course_uuid: str
    creation_date: str
    update_date: str
    pass