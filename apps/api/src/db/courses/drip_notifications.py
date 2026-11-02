from typing import Optional

from sqlalchemy import Column, ForeignKey, Integer, UniqueConstraint
from sqlmodel import Field, SQLModel


class DripNotification(SQLModel, table=True):
    """One row per (chapter, learner): the "chapter is open" email went out.

    Written before the email is sent, so a crash mid-run or two API replicas
    running the job at once can never mail the same learner twice; the
    loser of the race hits the unique constraint and skips.
    """

    __tablename__ = "drip_notification"
    __table_args__ = (
        UniqueConstraint("chapter_id", "user_id", name="uq_drip_notification_chapter_user"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    chapter_id: int = Field(
        sa_column=Column(Integer, ForeignKey("chapter.id", ondelete="CASCADE"), nullable=False)
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    course_id: int = Field(
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    )
    sent_at: str = ""
