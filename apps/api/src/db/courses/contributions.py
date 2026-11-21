"""Course contributions: suggested edits, credit and per-course settings.

A course owner can open a course to contributions. People the course allows
then improve its pages from the learner view ("Suggest an edit") or leave
feedback on a passage; course editors review the suggestions, and every
accepted one is credited to its author.

Where a suggestion sits in a page is not a stored node id (page content has
none): it is the top-level index it was made at plus a fingerprint of the
blocks it replaces, the same way AI editor proposals are located (see
``src/services/courses/contributions/blocks.py``). Credit for a block
(``content_attribution``) is anchored the same way and re-anchored when the
page changes.

Feedback is not a table of its own: it is an ``activity_comment_thread`` of
kind ``feedback`` (see ``activity_comments.py``).
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field as PydanticField
from sqlalchemy import JSON, Boolean, Column, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlmodel import Field, SQLModel

NOTE_MAX = 1000
SUMMARY_MAX = 300
FP_MAX = 600
# Blocks one suggestion may replace or add, and the size of their JSON.
MAX_BLOCKS = 40
MAX_PAYLOAD_BYTES = 200_000

Audience = Literal["enrolled", "members", "signed_in"]
SuggestionStatus = Literal["pending", "accepted", "rejected", "changes_requested", "withdrawn"]
FeedbackType = Literal["typo", "unclear", "outdated", "wrong", "suggestion"]
FEEDBACK_TYPES: tuple[str, ...] = ("typo", "unclear", "outdated", "wrong", "suggestion")
AUDIENCES: tuple[str, ...] = ("enrolled", "members", "signed_in")
OPEN_STATUSES: tuple[str, ...] = ("pending", "changes_requested")


class CourseContributionSettings(SQLModel, table=True):
    """Per-course switch. No row means contributions are off."""

    __tablename__ = "course_contribution_settings"

    id: Optional[int] = Field(default=None, primary_key=True)
    course_id: int = Field(
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"), nullable=False, unique=True)
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    enabled: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, server_default="false"))
    # Who may suggest and give feedback: learners enrolled in the course, any
    # member of the org, or anyone signed in who can open the course.
    audience: str = Field(default="enrolled", sa_column=Column(String(16), nullable=False, server_default="enrolled"))
    allow_suggestions: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, server_default="true"))
    allow_feedback: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, server_default="true"))
    # Contributors marked trusted publish their edits without review.
    trusted_publish: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, server_default="false"))
    updated_by: Optional[int] = Field(
        default=None, sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"))
    )
    created_at: str = ""
    updated_at: str = ""


class ContentSuggestion(SQLModel, table=True):
    __tablename__ = "content_suggestion"
    __table_args__ = (
        Index("ix_content_suggestion_course_status", "course_id", "status"),
        Index("ix_content_suggestion_activity_status", "activity_id", "status"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    suggestion_uuid: str = Field(sa_column=Column(String, nullable=False, unique=True, index=True))
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    course_id: int = Field(
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"), nullable=False)
    )
    activity_id: int = Field(
        sa_column=Column(Integer, ForeignKey("activity.id", ondelete="CASCADE"), nullable=False)
    )
    author_id: Optional[int] = Field(
        default=None, sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), index=True)
    )
    status: str = Field(default="pending", sa_column=Column(String(20), nullable=False, server_default="pending"))
    # The page version the suggestion was made on, and where: the top-level
    # index of the first block it replaces (or where it inserts).
    base_version: int = Field(default=1, sa_column=Column(Integer, nullable=False, server_default="1"))
    start_index: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default="0"))
    # Blocks as they were (ProseMirror JSON) and as suggested. An insert has
    # no ``before``; a removal has no ``after``.
    before: list = Field(default_factory=list, sa_column=Column(JSON, nullable=False, server_default="[]"))
    after: list = Field(default_factory=list, sa_column=Column(JSON, nullable=False, server_default="[]"))
    # For an insert: the fingerprint of the block it goes after ("" = top).
    prev_fp: Optional[str] = Field(default=None, sa_column=Column(String(FP_MAX), nullable=True))
    note: str = Field(default="", sa_column=Column(String(NOTE_MAX), nullable=False, server_default=""))
    summary: str = Field(default="", sa_column=Column(String(SUMMARY_MAX), nullable=False, server_default=""))
    review_note: str = Field(default="", sa_column=Column(String(NOTE_MAX), nullable=False, server_default=""))
    reviewed_by: Optional[int] = Field(
        default=None, sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"))
    )
    reviewed_at: Optional[str] = None
    # Page version the accepted change produced.
    applied_version: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))
    # Published without review (a trusted contributor).
    auto_published: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, server_default="false"))
    created_at: str = ""
    updated_at: str = ""


class ContentAttribution(SQLModel, table=True):
    """Who helped write a block of a page."""

    __tablename__ = "content_attribution"
    __table_args__ = (
        UniqueConstraint("activity_id", "user_id", "block_fp", name="uq_content_attribution_block_user"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    )
    course_id: int = Field(
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    activity_id: int = Field(
        sa_column=Column(Integer, ForeignKey("activity.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    suggestion_id: Optional[int] = Field(
        default=None, sa_column=Column(Integer, ForeignKey("content_suggestion.id", ondelete="SET NULL"))
    )
    # Where the block was last seen: its fingerprint and top-level index.
    block_fp: str = Field(sa_column=Column(String(FP_MAX), nullable=False))
    block_type: str = Field(default="", sa_column=Column(String(64), nullable=False, server_default=""))
    block_index: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default="0"))
    created_at: str = ""
    updated_at: str = ""


class CourseContributor(SQLModel, table=True):
    """A person credited on a course for accepted suggestions."""

    __tablename__ = "course_contributor"
    __table_args__ = (UniqueConstraint("course_id", "user_id", name="uq_course_contributor_course_user"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    )
    course_id: int = Field(
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    accepted_count: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default="0"))
    trusted: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, server_default="false"))
    # Blocked people can no longer suggest or give feedback on the course.
    blocked: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, server_default="false"))
    first_contribution_at: Optional[str] = None
    last_contribution_at: Optional[str] = None


# ─── API shapes ──────────────────────────────────────────────────────────────


class ContributorUser(BaseModel):
    id: int
    user_uuid: str
    username: str
    first_name: str = ""
    last_name: str = ""
    avatar_image: str = ""


class SettingsRead(BaseModel):
    enabled: bool = False
    audience: Audience = "enrolled"
    allow_suggestions: bool = True
    allow_feedback: bool = True
    trusted_publish: bool = False
    # Whether the org's plan includes contributions.
    plan_allowed: bool = True


class SettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    audience: Optional[Audience] = None
    allow_suggestions: Optional[bool] = None
    allow_feedback: Optional[bool] = None
    trusted_publish: Optional[bool] = None


class SuggestionCreate(BaseModel):
    base_version: int = PydanticField(ge=0)
    start_index: int = PydanticField(ge=0, le=100_000)
    before: list[dict] = PydanticField(default_factory=list, max_length=MAX_BLOCKS)
    after: list[dict] = PydanticField(default_factory=list, max_length=MAX_BLOCKS)
    prev_fp: Optional[str] = PydanticField(default=None, max_length=FP_MAX * 2)
    note: str = PydanticField(default="", max_length=NOTE_MAX)


class SuggestionRevise(BaseModel):
    after: list[dict] = PydanticField(default_factory=list, max_length=MAX_BLOCKS)
    note: Optional[str] = PydanticField(default=None, max_length=NOTE_MAX)


class AcceptTarget(BaseModel):
    """The exact range of the current page to replace, picked by a reviewer
    when the suggestion no longer fits the page."""

    start_index: int = PydanticField(ge=0, le=100_000)
    length: int = PydanticField(ge=0, le=MAX_BLOCKS * 4)
    version: int = PydanticField(ge=0)


class SuggestionAccept(BaseModel):
    # Reviewer's own version of the change (edit, then accept).
    after: Optional[list[dict]] = PydanticField(default=None, max_length=MAX_BLOCKS)
    target: Optional[AcceptTarget] = None
    note: str = PydanticField(default="", max_length=NOTE_MAX)
    # The suggestion's updated_at the reviewer saw: refused (409) if the
    # author revised it since.
    expected_updated_at: Optional[str] = PydanticField(default=None, max_length=64)


class SuggestionDecision(BaseModel):
    note: str = PydanticField(default="", max_length=NOTE_MAX)


class SuggestionPlacement(BaseModel):
    """Where the suggestion lands on the page as it is now."""

    state: Literal["clean", "moved", "conflict", "outdated"]
    current_version: int
    start_index: Optional[int] = None
    # The page's blocks the suggestion would replace now (or, on a conflict,
    # the closest match, for the reviewer to compare against).
    current: list[dict] = []


class SuggestionRead(BaseModel):
    suggestion_uuid: str
    status: SuggestionStatus
    author: Optional[ContributorUser] = None
    reviewer: Optional[ContributorUser] = None
    course_uuid: str
    course_name: str = ""
    activity_uuid: str
    activity_name: str = ""
    base_version: int
    start_index: int
    before: list[dict] = []
    after: list[dict] = []
    note: str = ""
    summary: str = ""
    review_note: str = ""
    reviewed_at: Optional[str] = None
    applied_version: Optional[int] = None
    auto_published: bool = False
    created_at: str
    updated_at: str
    placement: Optional[SuggestionPlacement] = None


class SuggestionList(BaseModel):
    items: list[SuggestionRead]
    total: int


class FeedbackCreate(BaseModel):
    feedback_type: FeedbackType
    body: str = PydanticField(min_length=1, max_length=5000)
    quote: str = PydanticField(default="", max_length=2000)
    block_index: Optional[int] = PydanticField(default=None, ge=0, le=100_000)
    block_fp: Optional[str] = PydanticField(default=None, max_length=FP_MAX * 2)


class FeedbackReply(BaseModel):
    body: str = PydanticField(min_length=1, max_length=5000)


class FeedbackStatus(BaseModel):
    status: Literal["open", "resolved"]


class FeedbackComment(BaseModel):
    comment_uuid: str
    author: Optional[ContributorUser] = None
    body: str
    created_at: str
    from_team: bool = False


class FeedbackRead(BaseModel):
    thread_uuid: str
    feedback_type: str
    status: Literal["open", "resolved"]
    quote: str = ""
    anchor: Optional[dict] = None
    author: Optional[ContributorUser] = None
    course_uuid: str
    activity_uuid: str
    activity_name: str = ""
    created_at: str
    updated_at: str
    comments: list[FeedbackComment] = []


class FeedbackList(BaseModel):
    items: list[FeedbackRead]
    total: int


class BlockCredit(BaseModel):
    block_index: int
    block_fp: str
    users: list[ContributorUser]


class ActivityContributionContext(BaseModel):
    """What the learner page needs: may I suggest, and who wrote what."""

    enabled: bool = False
    can_suggest: bool = False
    can_feedback: bool = False
    can_review: bool = False
    # My suggestions go live without review.
    publishes_directly: bool = False
    current_version: int = 1
    # Why I can't contribute, for a hint: "signin", "enroll", "members", "blocked".
    reason: Optional[str] = None
    credits: list[BlockCredit] = []
    my_open_suggestions: int = 0


class ContributorRead(BaseModel):
    user: ContributorUser
    accepted_count: int
    trusted: bool = False
    blocked: bool = False
    first_contribution_at: Optional[str] = None
    last_contribution_at: Optional[str] = None


class ContributorList(BaseModel):
    items: list[ContributorRead]
    total: int


class ContributorUpdate(BaseModel):
    trusted: Optional[bool] = None
    blocked: Optional[bool] = None


class ContributionSummary(BaseModel):
    pending_suggestions: int = 0
    open_feedback: int = 0
    contributors: int = 0


class UserContributionCourse(BaseModel):
    course_uuid: str
    course_name: str
    thumbnail_image: str = ""
    accepted_count: int
    last_contribution_at: Optional[str] = None


class UserContributions(BaseModel):
    items: list[UserContributionCourse]
    total_accepted: int
