from typing import Optional
from pydantic import BaseModel
from sqlmodel import Field, SQLModel
from src.db.trail_runs import TrailRunRead



class TrailBase(SQLModel):
    org_id: int = Field(default=None, foreign_key="organization.id")
    user_id: int = Field(default=None, foreign_key="user.id")


class Trail(TrailBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    trail_uuid: str = ""
    creation_date: str = ""
    update_date: str    = ""


class TrailCreate(TrailBase):
    pass


# trick because Lists are not supported in SQLModel (runs: list[TrailRun] )
class TrailRead(BaseModel):
    id: Optional[int] = Field(default=None, primary_key=True)
    trail_uuid: str
    org_id: int = Field(default=None, foreign_key="organization.id")
    user_id: int = Field(default=None, foreign_key="user.id")
    creation_date: str
    update_date: str
    runs: list[TrailRunRead]
