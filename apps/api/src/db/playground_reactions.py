from typing import Optional, List
from sqlalchemy import Column, ForeignKey, Integer, String, UniqueConstraint
from sqlmodel import Field, SQLModel


class PlaygroundReaction(SQLModel, table=True):
    __tablename__ = "playgroundreaction"
    __table_args__ = (
        UniqueConstraint(
            "playground_id", "user_id", "emoji", name="unique_playground_user_emoji"
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    playground_id: int = Field(
        sa_column=Column(Integer, ForeignKey("playground.id", ondelete="CASCADE"))
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"))
    )
    emoji: str = Field(sa_column=Column(String(50)))
    reaction_uuid: str = ""
    creation_date: str = ""


class ReactionUser(SQLModel):
    id: int
    user_uuid: str
    username: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    avatar_image: Optional[str] = None


class PlaygroundReactionSummary(SQLModel):
    emoji: str
    count: int
    users: List[ReactionUser]
    has_reacted: bool
