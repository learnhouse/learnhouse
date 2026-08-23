from typing import Optional

from sqlalchemy import Column, ForeignKey, Index, Integer, UniqueConstraint
from sqlmodel import Field, SQLModel


class DemoEntityKind:
    """Kinds of row the demo bundle owns.

    Plain constants rather than an Enum: these are written into a VARCHAR
    column, and a native PG enum would need a migration every time the bundle
    learns to seed a new kind of thing.
    """

    ORG = "org"
    USER = "user"
    COURSE = "course"
    CHAPTER = "chapter"
    ACTIVITY = "activity"
    BLOCK = "block"
    MEDIA = "media"
    ASSIGNMENT = "assignment"
    ASSIGNMENT_TASK = "assignment_task"
    USERGROUP = "usergroup"
    FOLDER = "folder"
    CERTIFICATION = "certification"
    COURSE_UPDATE = "course_update"
    COMMUNITY = "community"
    DISCUSSION = "discussion"
    DISCUSSION_COMMENT = "discussion_comment"
    BOARD = "board"
    PLAYGROUND = "playground"
    PODCAST = "podcast"
    PODCAST_EPISODE = "podcast_episode"
    API_TOKEN = "api_token"
    WEBHOOK = "webhook"
    PAYMENTS_GROUP = "payments_group"
    PAYMENTS_OFFER = "payments_offer"
    PAYMENTS_ENROLLMENT = "payments_enrollment"


class DemoEntity(SQLModel, table=True):
    """Registry of every row the demo bundle owns.

    The demo organization is refreshed in place on a schedule rather than
    dropped and rebuilt, so the refresh has to answer two questions cheaply:
    "which rows do I manage?" and "what is this row's stable identity in the
    bundle?". This table answers both.

    `bundle_key` is the identity the manifest declares (``course:01-foo``,
    ``student:07``) and never changes for the life of an install; `entity_id`
    and `entity_uuid` are where that identity currently lives in the database.
    Keeping the uuid stable is what lets media stay put on disk / in S3 across
    a refresh, and what lets a course a visitor deleted be re-created without
    re-uploading its files.

    Anything inside the demo org that has *no* row here was created by a
    visitor, and the refresh deletes it as drift.
    """

    __tablename__ = "demo_entity"
    __table_args__ = (
        # The refresh looks rows up by (kind, bundle_key); the constraint also
        # makes double-registration a database error rather than a silent
        # duplicate that would strand one of the two rows as permanent drift.
        UniqueConstraint("kind", "bundle_key", name="uq_demo_entity_kind_key"),
        Index("ix_demo_entity_kind", "kind"),
        Index("ix_demo_entity_uuid", "entity_uuid"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    kind: str = Field(nullable=False)
    bundle_key: str = Field(nullable=False)
    entity_id: int = Field(nullable=False)
    entity_uuid: str = Field(nullable=False)
    org_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("organization.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    creation_date: str = ""
    update_date: str = ""
