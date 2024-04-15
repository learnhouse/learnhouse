from typing import Optional
from sqlalchemy import Column, ForeignKey, Integer
from sqlmodel import Field, SQLModel


class CourseUpdate(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    courseupdate_uuid: str
    title: str 
    content: str 
    course_id: int = Field(
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"))
    )
    linked_activity_uuids: Optional[str] = Field(default=None)
    org_id: int = Field(default=None, foreign_key="organization.id")
    creation_date: str
    update_date: str

class CourseUpdateCreate(SQLModel):
    title: str 
    content: str 
    linked_activity_uuids: Optional[str] = Field(default=None)
    org_id: int

class CourseUpdateRead(SQLModel):
    id: int
    title: str 
    content: str 
    course_id: int
    courseupdate_uuid: str
    linked_activity_uuids: Optional[str] = Field(default=None)
    org_id: int
    creation_date: str
    update_date: str

class CourseUpdateUpdate(SQLModel):
    title: Optional[str] = None
    content: Optional[str] = None
    linked_activity_uuids: Optional[str] = Field(default=None)

    