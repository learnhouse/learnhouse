from typing import Optional
from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class InstallBase(SQLModel):
    step: int = Field(default=0)
    data: dict = Field(default={}, sa_column=Column(JSON))


class Install(InstallBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    install_uuid: str = Field(default=None)
    creation_date: str = ""
    update_date: str = ""


class InstallCreate(InstallBase):
    pass


class InstallUpdate(InstallBase):
    pass


class InstallRead(InstallBase):
    id: Optional[int] = Field(default=None, primary_key=True)
    install_uuid: str = Field(default=None)
    creation_date: str
    update_date: str
    pass
