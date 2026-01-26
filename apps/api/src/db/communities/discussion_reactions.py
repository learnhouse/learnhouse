from typing import Optional, List
from sqlalchemy import Column, ForeignKey, Integer, String, UniqueConstraint
from sqlmodel import Field, SQLModel


class DiscussionReactionBase(SQLModel):
    pass


class DiscussionReaction(DiscussionReactionBase, table=True):
    __tablename__ = "discussionreaction"
    __table_args__ = (
        UniqueConstraint(
            "discussion_id", "user_id", "emoji", name="unique_discussion_user_emoji"
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    discussion_id: int = Field(
        sa_column=Column(Integer, ForeignKey("discussion.id", ondelete="CASCADE"))
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"))
    )
    emoji: str = Field(sa_column=Column(String(50)))
    reaction_uuid: str = ""
    creation_date: str = ""


class DiscussionReactionCreate(DiscussionReactionBase):
    discussion_id: int = Field(default=None, foreign_key="discussion.id")
    user_id: int = Field(default=None, foreign_key="user.id")
    emoji: str


class DiscussionReactionRead(DiscussionReactionBase):
    id: int
    discussion_id: int = Field(default=None, foreign_key="discussion.id")
    user_id: int = Field(default=None, foreign_key="user.id")
    emoji: str
    reaction_uuid: str
    creation_date: str


class ReactionUser(SQLModel):
    """User info for reaction display."""

    id: int
    user_uuid: str
    username: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    avatar_image: Optional[str] = None


class DiscussionReactionSummary(SQLModel):
    """Summary of reactions for a single emoji."""

    emoji: str
    count: int
    users: List[ReactionUser]
    has_reacted: bool
