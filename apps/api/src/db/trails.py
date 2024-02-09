from typing import Optional
from pydantic import BaseModel
from sqlalchemy import Column, ForeignKey, Integer
from sqlmodel import Field, SQLModel
from src.db.trail_runs import TrailRunRead


class TrailBase(SQLModel):
    org_id: int = Field(default=None, foreign_key="organization.id")
    user_id: int = Field(default=None, foreign_key="user.id")


class Trail(TrailBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    trail_uuid: str = ""
    creation_date: str = ""
    update_date: str = ""


class TrailCreate(TrailBase):
    pass


# trick because Lists are not supported in SQLModel (runs: list[TrailRun] )
class TrailRead(BaseModel):
    id: Optional[int] = Field(default=None, primary_key=True)
    trail_uuid: Optional[str]
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"))
    )
    creation_date: Optional[str]
    update_date: Optional[str]
    runs: list[TrailRunRead]

    class Config:
        orm_mode = True
