from typing import Optional
from sqlmodel import Field, SQLModel


class CollectionBase(SQLModel):
    name: str
    public: bool
    description: Optional[str] = ""
    

class Collection(CollectionBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(default=None, foreign_key="organization.id")
    collection_uuid: str = ""
    creation_date: str = ""
    update_date: str = ""


class CollectionCreate(CollectionBase):
    courses: list[int]
    org_id: int = Field(default=None, foreign_key="organization.id")

    pass


class CollectionUpdate(CollectionBase):
    courses: Optional[list]
    name: Optional[str]
    public: Optional[bool]
    description: Optional[str]


class CollectionRead(CollectionBase):
    id: int
    courses: list
    collection_uuid: str
    creation_date: str
    update_date: str
    pass
