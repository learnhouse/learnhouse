"""Language versions of a course (multilingual courses).

A course is written in its ``default_locale`` and may have language versions:
one ``course_translation`` row per locale (the version itself: its status and
the translated course fields), plus per-locale rows for chapters and
activities. Nothing else is duplicated: progress, enrollments, certificates,
analytics and payments stay on the one course.

Learners only see a translation when the language version is published AND
the item's own translation is published; drafts are for editors.
"""

from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, Integer, LargeBinary, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class TranslationStatus(str, Enum):
    DRAFT = "draft"
    PUBLISHED = "published"


class TranslatedBy(str, Enum):
    USER = "user"
    ATLAS = "atlas"


def _org_fk() -> Column:
    return Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True)


class CourseTranslation(SQLModel, table=True):
    __tablename__ = "course_translation"
    __table_args__ = (
        UniqueConstraint("course_id", "locale", name="uq_course_translation_locale"),
        Index("ix_course_translation_org_slug", "org_id", "slug"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    course_id: int = Field(
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    org_id: int = Field(sa_column=_org_fk())
    locale: str = Field(sa_column=Column(String(20), nullable=False))
    status: str = Field(default=TranslationStatus.DRAFT.value, sa_column=Column(String(16), nullable=False))
    translated_by: Optional[str] = Field(default=None, sa_column=Column(String(16), nullable=True))
    name: Optional[str] = None
    description: Optional[str] = None
    about: Optional[str] = None
    learnings: Optional[str] = None
    tags: Optional[str] = None
    seo: Optional[dict] = Field(default=None, sa_column=Column(JSONB, nullable=True))
    slug: Optional[str] = Field(default=None, sa_column=Column(String(100), nullable=True))
    # Fingerprint of the source fields this translation was made from.
    source_hash: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    created_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, nullable=True))
    updated_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, nullable=True))
    updated_by_id: Optional[int] = Field(
        default=None, sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True)
    )


class ChapterTranslation(SQLModel, table=True):
    __tablename__ = "chapter_translation"
    __table_args__ = (UniqueConstraint("chapter_id", "locale", name="uq_chapter_translation_locale"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    chapter_id: int = Field(
        sa_column=Column(Integer, ForeignKey("chapter.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    course_id: int = Field(
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    org_id: int = Field(sa_column=_org_fk())
    locale: str = Field(sa_column=Column(String(20), nullable=False))
    status: str = Field(default=TranslationStatus.DRAFT.value, sa_column=Column(String(16), nullable=False))
    translated_by: Optional[str] = Field(default=None, sa_column=Column(String(16), nullable=True))
    name: Optional[str] = None
    description: Optional[str] = None
    source_hash: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    updated_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, nullable=True))


class ActivityTranslation(SQLModel, table=True):
    __tablename__ = "activity_translation"
    __table_args__ = (
        UniqueConstraint("activity_id", "locale", name="uq_activity_translation_locale"),
        Index("ix_activity_translation_course_locale", "course_id", "locale"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    activity_id: int = Field(
        sa_column=Column(Integer, ForeignKey("activity.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    course_id: int = Field(
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"), nullable=False)
    )
    org_id: int = Field(sa_column=_org_fk())
    locale: str = Field(sa_column=Column(String(20), nullable=False))
    status: str = Field(default=TranslationStatus.DRAFT.value, sa_column=Column(String(16), nullable=False))
    translated_by: Optional[str] = Field(default=None, sa_column=Column(String(16), nullable=True))
    name: Optional[str] = None
    content: Optional[dict] = Field(default=None, sa_column=Column(JSON, nullable=True))
    # Texts outside the page content (assignment title/description, tasks).
    extra: Optional[dict] = Field(default=None, sa_column=Column(JSON, nullable=True))
    # activity.current_version this translation was made from (diff link)
    source_version: Optional[int] = Field(default=None)
    # Fingerprint of the source's translatable text then (outdated detection)
    source_hash: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    # The translation's own content version (collab base_version, conflicts)
    version: int = Field(default=1)
    created_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, nullable=True))
    updated_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, nullable=True))
    updated_by_id: Optional[int] = Field(
        default=None, sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True)
    )


class ActivityTranslationCollabState(SQLModel, table=True):
    """Yjs state of a translation's collab room (kept out of the row, like
    ActivityCollabState for the default language)."""

    __tablename__ = "activity_translation_collab"

    translation_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("activity_translation.id", ondelete="CASCADE"), primary_key=True
        )
    )
    org_id: int = Field(sa_column=_org_fk())
    ydoc_state: Optional[bytes] = Field(default=None, sa_column=Column(LargeBinary, nullable=True))
    ydoc_version: int = Field(default=0)
    updated_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, nullable=True))
