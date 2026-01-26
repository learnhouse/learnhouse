from typing import Optional
from sqlalchemy import Column, ForeignKey, Integer, UniqueConstraint
from sqlmodel import Field, SQLModel


class DiscussionCommentVoteBase(SQLModel):
    pass


class DiscussionCommentVote(DiscussionCommentVoteBase, table=True):
    __tablename__ = "discussioncommentvote"
    __table_args__ = (
        UniqueConstraint("comment_id", "user_id", name="unique_comment_user_vote"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    comment_id: int = Field(
        sa_column=Column(Integer, ForeignKey("discussioncomment.id", ondelete="CASCADE"))
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"))
    )
    vote_uuid: str = ""
    creation_date: str = ""


class DiscussionCommentVoteCreate(DiscussionCommentVoteBase):
    comment_id: int = Field(default=None, foreign_key="discussioncomment.id")
    user_id: int = Field(default=None, foreign_key="user.id")


class DiscussionCommentVoteRead(DiscussionCommentVoteBase):
    id: int
    comment_id: int = Field(default=None, foreign_key="discussioncomment.id")
    user_id: int = Field(default=None, foreign_key="user.id")
    vote_uuid: str
    creation_date: str
