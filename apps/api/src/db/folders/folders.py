from typing import Optional, List
from sqlalchemy import Column, ForeignKey, Integer, BigInteger
from sqlmodel import Field, SQLModel


class FolderBase(SQLModel):
    name: str
    public: bool = True
    description: Optional[str] = ""
    thumbnail_image: Optional[str] = ""
    color: Optional[str] = "violet"


class Folder(FolderBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), index=True
        )
    )
    folder_uuid: str = Field(default="", index=True)
    # Self-referential parent for nesting. NULL = root folder.
    parent_folder_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("folder.id", ondelete="CASCADE"), nullable=True, index=True
        ),
    )
    creation_date: str = ""
    update_date: str = ""


class FolderCreate(FolderBase):
    org_id: int = Field(default=None, foreign_key="organization.id")
    parent_folder_uuid: Optional[str] = None


class FolderUpdate(SQLModel):
    name: Optional[str] = None
    public: Optional[bool] = None
    description: Optional[str] = None
    thumbnail_image: Optional[str] = None
    color: Optional[str] = None
    # When provided, re-parents the folder (use "" or "root" to move to root).
    parent_folder_uuid: Optional[str] = None


class FolderBreadcrumb(SQLModel):
    folder_uuid: str
    name: str


class FolderContentItem(SQLModel):
    """A resolved leaf item inside a folder (any resource type)."""
    resource_uuid: str
    resource_type: str  # courses | podcasts | communities | boards | playgrounds | media
    position: int = 0
    resource: dict


class FolderRead(FolderBase):
    id: int
    org_id: int
    folder_uuid: str
    parent_folder_id: Optional[int] = None
    creation_date: str
    update_date: str
    # Total number of children (sub-folders + leaf items), always populated.
    total_items: int = 0
    # Direct children
    subfolders: List["FolderRead"] = []
    items: List[FolderContentItem] = []
    breadcrumbs: List[FolderBreadcrumb] = []
