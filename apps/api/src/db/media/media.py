from typing import Optional
from enum import Enum
from sqlalchemy import Column, ForeignKey, Integer, BigInteger
from sqlmodel import Field, SQLModel


class MediaTypeEnum(str, Enum):
    """Kind of media asset. Extensible — add new embeddable kinds here."""
    UPLOAD = "UPLOAD"  # A stored, downloadable file (pdf, mp4, etc.)
    EMBED = "EMBED"    # An external embed (YouTube/Vimeo/generic URL)


class MediaBase(SQLModel):
    name: str
    description: Optional[str] = ""
    media_type: MediaTypeEnum = Field(default=MediaTypeEnum.UPLOAD)
    # For EMBED
    url: Optional[str] = ""
    thumbnail_image: Optional[str] = ""
    public: bool = True


class Media(MediaBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), index=True
        )
    )
    media_uuid: str = Field(default="", index=True)
    # For UPLOAD — file metadata (mirrors BlockFile shape)
    file_id: Optional[str] = ""
    file_format: Optional[str] = ""
    file_size: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))
    file_mime: Optional[str] = ""
    creation_date: str = ""
    update_date: str = ""


class MediaCreate(MediaBase):
    org_id: int = Field(default=None, foreign_key="organization.id")
    # Optional: place into a folder right away
    folder_uuid: Optional[str] = None


class MediaUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    url: Optional[str] = None
    thumbnail_image: Optional[str] = None
    public: Optional[bool] = None


class MediaRead(MediaBase):
    id: int
    org_id: int
    media_uuid: str
    file_id: Optional[str] = ""
    file_format: Optional[str] = ""
    file_size: Optional[int] = None
    file_mime: Optional[str] = ""
    creation_date: str
    update_date: str
