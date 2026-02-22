from typing import List, Optional
from enum import Enum
from sqlalchemy import Column, ForeignKey, Integer, LargeBinary
from sqlmodel import Field, SQLModel


class BoardMemberRole(str, Enum):
    OWNER = "owner"
    EDITOR = "editor"
    VIEWER = "viewer"


class BoardBase(SQLModel):
    name: str
    description: Optional[str] = None
    thumbnail_image: Optional[str] = Field(default="")
    public: bool = Field(default=True)


class Board(BoardBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    )
    board_uuid: str = Field(default="", index=True)
    created_by: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True)
    )
    ydoc_state: Optional[bytes] = Field(default=None, sa_column=Column(LargeBinary, nullable=True))
    creation_date: str = ""
    update_date: str = ""


class BoardMember(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    board_id: int = Field(
        sa_column=Column(Integer, ForeignKey("board.id", ondelete="CASCADE"), index=True)
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), index=True)
    )
    role: str = Field(default=BoardMemberRole.EDITOR)
    creation_date: str = ""


class BoardCreate(SQLModel):
    name: str
    description: Optional[str] = None
    thumbnail_image: Optional[str] = Field(default="")


class BoardUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    thumbnail_image: Optional[str] = None
    public: Optional[bool] = None


class BoardRead(BoardBase):
    id: int
    org_id: int
    board_uuid: str
    created_by: Optional[int] = None
    creation_date: str
    update_date: str
    member_count: int = 0


class BoardMemberCreate(SQLModel):
    user_id: int
    role: str = BoardMemberRole.EDITOR


class BoardMemberRead(SQLModel):
    id: int
    board_id: int
    user_id: int
    role: str
    creation_date: str
    username: Optional[str] = None
    email: Optional[str] = None
    avatar_image: Optional[str] = None
    user_uuid: Optional[str] = None


class BoardMemberBatchCreate(SQLModel):
    members: List[BoardMemberCreate]
