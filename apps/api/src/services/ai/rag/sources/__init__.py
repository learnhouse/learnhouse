"""Source registry: one extractor per activity type.

A source module registers itself with ``@source(ActivityTypeEnum.X)`` and
implements ``async def extract(activity, ctx) -> list[Segment]``. Adding a new
kind of content to AI search means adding one module here (or registering one
from a plugin); the pipeline, storage, retrieval and copilot citations need no
changes.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity, ActivityTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.services.ai.rag.formats import join, prose_strings
from src.services.ai.rag.types import ContentRef, Segment, SourceType

logger = logging.getLogger(__name__)


@dataclass
class SourceContext:
    db: AsyncSession
    org_uuid: str
    course: Course
    activity: Optional[Activity] = None
    # Media found during extraction that has no transcript yet; the pipeline
    # transcribes it afterwards and indexes the activity again.
    pending_media: list = field(default_factory=list)

    @property
    def course_dir(self) -> str:
        return f"content/orgs/{self.org_uuid}/courses/{self.course.course_uuid}"

    def activity_dir(self, activity_uuid: Optional[str] = None) -> str:
        uuid = activity_uuid or (self.activity.activity_uuid if self.activity else "")
        return f"{self.course_dir}/activities/{uuid}"


@dataclass
class Extraction:
    """Everything the pipeline needs to store one ref's rows."""

    ref: ContentRef
    org_id: int
    course_id: int
    course_name: str
    segments: list[Segment]
    activity_id: Optional[int] = None
    activity_uuid: str = ""
    activity_name: str = ""
    chapter_name: str = ""
    pending_media: list = field(default_factory=list)


Extractor = Callable[[Activity, SourceContext], Awaitable[list[Segment]]]
_EXTRACTORS: dict[ActivityTypeEnum, Extractor] = {}


def source(*activity_types: ActivityTypeEnum) -> Callable[[Extractor], Extractor]:
    """Register an extractor for one or more activity types."""

    def register(fn: Extractor) -> Extractor:
        for activity_type in activity_types:
            _EXTRACTORS[activity_type] = fn
        return fn

    return register


def activity_summary(activity: Activity) -> Segment:
    """Name and details of an activity. Indexed for every activity, so even
    content without extractable text (an embed, a video still being
    transcribed) can be found and cited."""
    text = join([f"Activity: {activity.name}", join(prose_strings(activity.details or {}))])
    return Segment(text=text, source_type=SourceType.ACTIVITY)


async def extract(ref: ContentRef, db: AsyncSession) -> Optional[Extraction]:
    """Run the matching extractor for a ref. None when the ref no longer exists."""
    if ref.kind == "course":
        course = await db.get(Course, ref.id)
        if course is None:
            return None
        ctx = await _context(course, db)
        if ctx is None:
            return None
        from src.services.ai.rag.sources.course import extract_course

        return Extraction(
            ref=ref,
            org_id=course.org_id,
            course_id=course.id,
            course_name=course.name,
            segments=await extract_course(course, ctx),
        )

    activity = await db.get(Activity, ref.id)
    if activity is None:
        return None
    course = await db.get(Course, activity.course_id)
    if course is None:
        return None
    ctx = await _context(course, db, activity)
    if ctx is None:
        return None

    segments = [activity_summary(activity)]
    extractor = _EXTRACTORS.get(activity.activity_type)
    if extractor is not None:
        try:
            segments += await extractor(activity, ctx)
        except Exception:
            # A broken file or malformed content must not stop the activity
            # from being findable by name.
            logger.exception("RAG: extraction failed for activity %s", activity.id)

    return Extraction(
        ref=ref,
        org_id=activity.org_id,
        course_id=course.id,
        course_name=course.name,
        segments=[s for s in segments if s.text.strip()],
        activity_id=activity.id,
        activity_uuid=activity.activity_uuid,
        activity_name=activity.name,
        chapter_name=await _chapter_name(activity.id, db),
        pending_media=ctx.pending_media,
    )


async def _context(
    course: Course, db: AsyncSession, activity: Optional[Activity] = None
) -> Optional[SourceContext]:
    org = await db.get(Organization, course.org_id)
    if org is None:
        return None
    return SourceContext(db=db, org_uuid=org.org_uuid, course=course, activity=activity)


async def _chapter_name(activity_id: int, db: AsyncSession) -> str:
    name = (await db.execute(
        select(Chapter.name)
        .join(ChapterActivity, ChapterActivity.chapter_id == Chapter.id)  # type: ignore[arg-type]
        .where(ChapterActivity.activity_id == activity_id)
    )).scalars().first()
    return name or ""


# Register the built-in sources.
from src.services.ai.rag.sources import (  # noqa: E402,F401
    assignment,
    custom,
    document,
    dynamic,
    video,
)
from src.core.ee_hooks import register_ee_rag_sources  # noqa: E402

register_ee_rag_sources()
