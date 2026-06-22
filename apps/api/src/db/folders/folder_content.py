from typing import Optional
from sqlalchemy import Column, ForeignKey, Integer, UniqueConstraint
from sqlmodel import Field, SQLModel


class FolderContent(SQLModel, table=True):
    """
    Polymorphic junction linking a folder to any resource by its UUID.

    `resource_uuid` holds a prefixed UUID (course_/podcast_/community_/board_/
    playground_/media_); the resource type is inferred from the prefix, mirroring
    the existing UserGroupResource / ResourceAuthor convention. Sub-folders are NOT
    stored here — they live in Folder.parent_folder_id.
    """

    __table_args__ = (
        UniqueConstraint("folder_id", "resource_uuid", name="uq_foldercontent_folder_resource"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    # NULL folder_id = the org library root (Drive-like): content can live at the
    # root alongside folders, not only inside a folder.
    folder_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("folder.id", ondelete="CASCADE"), nullable=True, index=True
        ),
    )
    resource_uuid: str = Field(default="", index=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    position: int = Field(default=0)
    creation_date: str = ""
    update_date: str = ""
