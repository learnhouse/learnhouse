from typing import Optional
from sqlalchemy import Column, ForeignKey, Integer, UniqueConstraint
from sqlmodel import Field, SQLModel


class DiscussionVoteBase(SQLModel):
    pass


class DiscussionVote(DiscussionVoteBase, table=True):
    __tablename__ = "discussionvote"
    __table_args__ = (
        UniqueConstraint("discussion_id", "user_id", name="unique_discussion_user_vote"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    discussion_id: int = Field(
        sa_column=Column(Integer, ForeignKey("discussion.id", ondelete="CASCADE"))
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"))
    )
    vote_uuid: str = ""
    creation_date: str = ""


class DiscussionVoteCreate(DiscussionVoteBase):
    discussion_id: int = Field(default=None, foreign_key="discussion.id")
    user_id: int = Field(default=None, foreign_key="user.id")


class DiscussionVoteRead(DiscussionVoteBase):
    id: int
    discussion_id: int = Field(default=None, foreign_key="discussion.id")
    user_id: int = Field(default=None, foreign_key="user.id")
    vote_uuid: str
    creation_date: str
