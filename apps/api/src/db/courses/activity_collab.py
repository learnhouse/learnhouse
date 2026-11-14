from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, LargeBinary
from sqlmodel import Field, SQLModel


class ActivityCollabState(SQLModel, table=True):
    """The collaborative editing state of an activity.

    Kept out of the ``activity`` row so the Yjs binary is never loaded with
    the activity itself. ``ydoc_version`` is the ``activity.current_version``
    the stored ydoc corresponds to: when the content changes outside the
    collab room (legacy save, AI tools, version restore) the activity version
    moves past it and the collab server rewrites the room from the content.
    """

    __tablename__ = "activitycollabstate"

    activity_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("activity.id", ondelete="CASCADE"), primary_key=True
        )
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    )
    ydoc_state: Optional[bytes] = Field(default=None, sa_column=Column(LargeBinary, nullable=True))
    ydoc_version: int = Field(default=0)
    # Version history coalescing: when the last collab snapshot was taken and
    # who had edited then (a new snapshot when this set changes).
    last_snapshot_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, nullable=True))
    last_snapshot_contributors: Optional[list] = Field(default=None, sa_column=Column(JSON, nullable=True))
    updated_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, nullable=True))
