from typing import Optional
from sqlalchemy import Column, ForeignKey, Integer, Text
from sqlmodel import Field, SQLModel
from src.db.users import UserRead


class DiscussionCommentBase(SQLModel):
    content: str = Field(sa_column=Column(Text))


class DiscussionComment(DiscussionCommentBase, table=True):
    __tablename__ = "discussioncomment"

    id: Optional[int] = Field(default=None, primary_key=True)
    discussion_id: int = Field(
        sa_column=Column(Integer, ForeignKey("discussion.id", ondelete="CASCADE"))
    )
    author_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"))
    )
    comment_uuid: str = ""
    upvote_count: int = 0
    creation_date: str = ""
    update_date: str = ""


class DiscussionCommentCreate(DiscussionCommentBase):
    discussion_id: int = Field(default=None, foreign_key="discussion.id")
    author_id: int = Field(default=None, foreign_key="user.id")


class DiscussionCommentUpdate(SQLModel):
    content: Optional[str] = None


class DiscussionCommentRead(DiscussionCommentBase):
    id: int
    discussion_id: int = Field(default=None, foreign_key="discussion.id")
    author_id: int = Field(default=None, foreign_key="user.id")
    comment_uuid: str
    upvote_count: int = 0
    creation_date: str
    update_date: str


class DiscussionCommentReadWithAuthor(DiscussionCommentRead):
    author: Optional[UserRead] = None


class DiscussionCommentReadWithVoteStatus(DiscussionCommentReadWithAuthor):
    has_voted: bool = False
