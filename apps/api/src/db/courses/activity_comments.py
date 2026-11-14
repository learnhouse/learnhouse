"""Editor comments on activity content (Google Docs style).

A thread is anchored on a span of the activity's text by the editor's
``comment`` mark (``attrs.threadId`` = ``thread_uuid``); ``quote`` keeps the
text it was anchored on, so a thread whose text was deleted still says what it
was about. Comments are visible to the people who can edit the activity, never
to learners.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field as PydanticField
from sqlalchemy import JSON, Boolean, Column, ForeignKey, Index, Integer, String
from sqlmodel import Field, SQLModel

QUOTE_MAX = 500
BODY_MAX = 5000
MAX_MENTIONS = 20

ThreadStatus = Literal["open", "resolved"]


class ActivityCommentThread(SQLModel, table=True):
    __tablename__ = "activity_comment_thread"
    __table_args__ = (
        Index("ix_activity_comment_thread_activity_status", "activity_id", "status"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    thread_uuid: str = Field(sa_column=Column(String, nullable=False, unique=True, index=True))
    activity_id: int = Field(
        sa_column=Column(Integer, ForeignKey("activity.id", ondelete="CASCADE"), nullable=False)
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    created_by: Optional[int] = Field(
        default=None, sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"))
    )
    quote: str = Field(default="", sa_column=Column(String(QUOTE_MAX), nullable=False, server_default=""))
    status: str = Field(default="open", sa_column=Column(String(16), nullable=False, server_default="open"))
    resolved_by: Optional[int] = Field(
        default=None, sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"))
    )
    resolved_at: Optional[str] = None
    created_at: str = ""
    updated_at: str = ""
    # Language version the thread was started on (None = the course's default
    # language): comments stay per locale.
    locale: Optional[str] = Field(default=None, sa_column=Column(String(20), nullable=True))


class ActivityComment(SQLModel, table=True):
    __tablename__ = "activity_comment"

    id: Optional[int] = Field(default=None, primary_key=True)
    comment_uuid: str = Field(sa_column=Column(String, nullable=False, unique=True, index=True))
    thread_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("activity_comment_thread.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    author_id: Optional[int] = Field(
        default=None, sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"))
    )
    body: str = Field(default="", sa_column=Column(String(BODY_MAX), nullable=False, server_default=""))
    # User ids named with @ in the body, validated against who may edit.
    mentions: list = Field(default_factory=list, sa_column=Column(JSON, nullable=False, server_default="[]"))
    edited_at: Optional[str] = None
    created_at: str = ""
    # Soft delete: the row stays so a thread keeps its shape ("comment
    # deleted" between replies); the body is never served again.
    deleted: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, server_default="false"))


# ─── API shapes ──────────────────────────────────────────────────────────────


class CommentAuthor(BaseModel):
    id: int
    user_uuid: str
    username: str
    first_name: str = ""
    last_name: str = ""
    avatar_image: str = ""


class CommentRead(BaseModel):
    comment_uuid: str
    author: Optional[CommentAuthor] = None
    body: str
    mentions: list[int] = []
    edited_at: Optional[str] = None
    created_at: str
    deleted: bool = False


class ThreadRead(BaseModel):
    thread_uuid: str
    quote: str
    status: ThreadStatus
    created_by: Optional[CommentAuthor] = None
    resolved_by: Optional[CommentAuthor] = None
    resolved_at: Optional[str] = None
    created_at: str
    updated_at: str
    comments: list[CommentRead] = []


class ThreadList(BaseModel):
    threads: list[ThreadRead]
    # What the caller may do in the UI: delete anyone's comment.
    can_moderate: bool = False
    current_user_id: int


class ThreadCreate(BaseModel):
    quote: str = PydanticField(default="", max_length=QUOTE_MAX * 4)
    body: str = PydanticField(min_length=1, max_length=BODY_MAX)
    mentions: list[int] = PydanticField(default_factory=list, max_length=MAX_MENTIONS)


class CommentCreate(BaseModel):
    body: str = PydanticField(min_length=1, max_length=BODY_MAX)
    mentions: list[int] = PydanticField(default_factory=list, max_length=MAX_MENTIONS)


class CommentUpdate(BaseModel):
    body: str = PydanticField(min_length=1, max_length=BODY_MAX)
    mentions: list[int] = PydanticField(default_factory=list, max_length=MAX_MENTIONS)


class ThreadStatusUpdate(BaseModel):
    status: ThreadStatus
