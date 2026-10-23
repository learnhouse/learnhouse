"""
Database models and schemas for the Skyroom live-class integration.

Skyroom (https://www.skyroom.online) is a web-conferencing / virtual-classroom
service. Its web service recommends creating a room once and reusing it across
sessions rather than creating/deleting a room per class. We therefore persist a
mapping between a LearnHouse organization (optionally a specific course /
activity) and the remote Skyroom ``room_id`` so the room is created once and
reused on every subsequent session.
"""

from typing import Optional

from pydantic import BaseModel
from sqlalchemy import (
    Boolean,
    Column,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlmodel import Field, SQLModel


class SkyroomLiveClass(SQLModel, table=True):
    """A persisted mapping between a LearnHouse org/course/activity and a
    remote Skyroom virtual room."""

    __tablename__ = "skyroom_live_class"
    __table_args__ = (
        Index("ix_skyroom_live_class_uuid", "liveclass_uuid"),
        Index("ix_skyroom_live_class_org_id", "org_id"),
        Index("ix_skyroom_live_class_org_room", "org_id", "skyroom_room_id"),
        Index("ix_skyroom_live_class_course_id", "course_id"),
        Index("ix_skyroom_live_class_activity_id", "activity_id"),
        {"extend_existing": True},
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    liveclass_uuid: str = Field(default="", max_length=100)
    org_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
        )
    )
    # Optional context the live class is attached to. Nullable because a room can
    # be a standalone org-level room not tied to any course or activity.
    course_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("course.id", ondelete="SET NULL"), nullable=True
        ),
    )
    activity_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("activity.id", ondelete="SET NULL"), nullable=True
        ),
    )

    # Remote Skyroom identifiers. ``skyroom_room_id`` is the numeric id returned
    # by the Skyroom ``createRoom`` action and reused for every later call.
    skyroom_room_id: int = Field(
        sa_column=Column(Integer, nullable=False)
    )
    # The latinized room name Skyroom builds the room URL from (max 128 chars).
    room_name: str = Field(sa_column=Column(String(128), nullable=False))
    # Human-facing title shown to participants (max 128 chars).
    title: str = Field(sa_column=Column(String(128), nullable=False))
    # Last known room URL (from getRoomUrl); may be refreshed on demand.
    room_url: Optional[str] = Field(default=None, sa_column=Column(String(2048)))

    guest_login: bool = Field(
        default=False, sa_column=Column(Boolean, nullable=False, server_default="false")
    )
    op_login_first: bool = Field(
        default=True, sa_column=Column(Boolean, nullable=False, server_default="true")
    )
    max_users: Optional[int] = Field(default=None, sa_column=Column(Integer))

    is_active: bool = Field(
        default=True, sa_column=Column(Boolean, nullable=False, server_default="true")
    )

    created_by_user_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
        )
    )
    creation_date: str = ""
    update_date: str = ""


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class SkyroomLiveClassCreate(BaseModel):
    # Latinized, URL-safe room name (max 128). Skyroom requires latin names.
    room_name: str
    title: str
    course_id: Optional[int] = None
    activity_id: Optional[int] = None
    guest_login: bool = False
    op_login_first: bool = True
    max_users: Optional[int] = None


class SkyroomLiveClassUpdate(BaseModel):
    title: Optional[str] = None
    guest_login: Optional[bool] = None
    op_login_first: Optional[bool] = None
    max_users: Optional[int] = None
    is_active: Optional[bool] = None


class SkyroomLiveClassRead(BaseModel):
    id: int
    liveclass_uuid: str
    org_id: int
    course_id: Optional[int] = None
    activity_id: Optional[int] = None
    skyroom_room_id: int
    room_name: str
    title: str
    room_url: Optional[str] = None
    guest_login: bool
    op_login_first: bool
    max_users: Optional[int] = None
    is_active: bool
    created_by_user_id: int
    creation_date: str
    update_date: str


class SkyroomJoinLinkRequest(BaseModel):
    """Request a direct login URL for a participant (createLoginUrl).

    ``user_id`` is an opaque, non-spaced identifier used by Skyroom to prevent
    concurrent reuse of the generated link; we default it to the acting
    LearnHouse user id. ``access`` maps to Skyroom roles:
    1 = normal user, 2 = presenter, 3 = operator.
    """

    nickname: str
    user_id: Optional[str] = None
    access: int = 1
    concurrent: int = 1
    language: str = "fa"
    ttl: int = 3600


class SkyroomJoinLinkResponse(BaseModel):
    url: str
