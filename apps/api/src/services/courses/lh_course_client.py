"""LearnHouse course client for background jobs.

Provides an upsert interface that operates directly against the async session
(bypassing RBAC/request context) — suitable for cron/scheduler background jobs
where there is no HTTP request or logged-in user.

Deferred:
- ResourceAuthor row: courses created here have no author entry. The LMS
  dashboard will show them authorless until a human editor claims them. A future
  iteration could designate a service-account user_id at creation time.
- Webhook dispatch (course_created / course_published events) is not fired; the
  KB sync is an internal bookkeeping operation, not a user-visible publish action.
- Feature-usage accounting (increase_feature_usage) is skipped; the nightly job
  should not count against org quotas.
"""

import logging
from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import cast, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course

logger = logging.getLogger(__name__)


class LhCourseClient:
    """Thin async client for upserting KB-sourced courses directly into the DB.

    Parameters
    ----------
    org_id:
        The LearnHouse organisation id that owns all synced courses.
    session_factory:
        Optional callable that returns an async context manager yielding an
        AsyncSession.  When ``None`` (default) the production
        ``_async_session_factory`` is imported lazily at call time.  Pass a
        custom factory in tests to share the test fixture's session.
    """

    def __init__(self, org_id: int, session_factory=None) -> None:
        self.org_id = org_id
        self._session_factory = session_factory

    # ------------------------------------------------------------------
    # Public interface (matches the protocol used by kb_sync.sync_rows)
    # ------------------------------------------------------------------

    async def upsert_course(
        self,
        *,
        org_id: int,
        match: dict[str, Any],
        course: dict[str, Any],
        body_md: str | None = None,
    ) -> None:
        """Create or update a course row.

        Lookup key is ``match["extra_metadata.kb_id"]``.  If the existing row
        has the same ``kb_sha`` the update is skipped (no-op).

        Parameters
        ----------
        org_id:
            Organisation id for the course (may differ from ``self.org_id``
            but in practice they are the same).
        match:
            Dict with key ``"extra_metadata.kb_id"`` identifying the row.
        course:
            Course fields dict (name, description, tags, public, published,
            open_to_contributors, extra_metadata).
        body_md:
            Markdown body of the artifact — rendered into a chapter + markdown
            activity on create, and refreshed on SHA-changed update.
        """
        if self._session_factory is None:
            from src.core.events.database import _async_session_factory  # local import avoids circular at module level

            factory = _async_session_factory
        else:
            factory = self._session_factory

        kb_id: str = match["extra_metadata.kb_id"]
        new_sha: str | None = (course.get("extra_metadata") or {}).get("kb_sha")

        async with factory() as session:
            existing = await self._find_by_kb_id(session, org_id, kb_id)

            if existing is None:
                created = await self._create(session, org_id, course, kb_id)
                if body_md and body_md.strip():
                    await self._create_chapter_and_activity(session, org_id, created, body_md)
                logger.info("kb_sync: created course for kb_id=%s", kb_id)
            else:
                old_sha = (existing.extra_metadata or {}).get("kb_sha")
                if old_sha == new_sha:
                    logger.debug(
                        "kb_sync: skipping unchanged kb_id=%s (sha=%s)", kb_id, new_sha
                    )
                    return
                await self._update(session, existing, course)
                if body_md and body_md.strip():
                    await self._refresh_or_create_markdown_activity(
                        session, org_id, existing, body_md
                    )
                logger.info(
                    "kb_sync: updated course for kb_id=%s (sha %s → %s)",
                    kb_id,
                    old_sha,
                    new_sha,
                )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _find_by_kb_id(
        self,
        session: AsyncSession,
        org_id: int,
        kb_id: str,
    ) -> Course | None:
        """Return the Course row whose extra_metadata->>'kb_id' == kb_id."""
        # Use a raw JSON path expression that works for both PostgreSQL (asyncpg)
        # and SQLite (aiosqlite, used in tests via JSON type remapping).
        #
        # We do a Python-side filter as a fallback so tests running on SQLite
        # (which lacks ->> operator) still work: fetch all org courses that
        # carry extra_metadata and filter in Python.  The result set is small
        # (only KB-sourced courses have source=="kb") so this is acceptable.
        try:
            stmt = select(Course).where(
                Course.org_id == org_id,
                text("extra_metadata->>'kb_id' = :kb_id").bindparams(kb_id=kb_id),
            )
            result = (await session.execute(stmt)).scalars().first()
            return result
        except Exception:
            # Fallback for SQLite / dialect that doesn't support ->> (tests)
            stmt_all = select(Course).where(
                Course.org_id == org_id,
                Course.extra_metadata.isnot(None),  # type: ignore[attr-defined]
            )
            rows = (await session.execute(stmt_all)).scalars().all()
            for row in rows:
                if (row.extra_metadata or {}).get("kb_id") == kb_id:
                    return row
            return None

    async def _create(
        self,
        session: AsyncSession,
        org_id: int,
        course_data: dict[str, Any],
        kb_id: str,
    ) -> Course:
        now = str(datetime.now())
        course = Course(
            org_id=org_id,
            name=course_data["name"],
            description=course_data.get("description") or "",
            tags=course_data.get("tags"),
            public=course_data.get("public", False),
            published=course_data.get("published", False),
            open_to_contributors=course_data.get("open_to_contributors", False),
            course_uuid=f"course_{uuid4()}",
            creation_date=now,
            update_date=now,
            extra_metadata=course_data.get("extra_metadata"),
        )
        session.add(course)
        await session.commit()
        await session.refresh(course)
        return course

    async def _update(
        self,
        session: AsyncSession,
        existing: Course,
        course_data: dict[str, Any],
    ) -> Course:
        existing.name = course_data["name"]
        existing.description = course_data.get("description") or existing.description
        existing.tags = course_data.get("tags") or existing.tags
        existing.extra_metadata = course_data.get("extra_metadata") or existing.extra_metadata
        existing.update_date = str(datetime.now())
        session.add(existing)
        await session.commit()
        await session.refresh(existing)
        return existing

    async def _create_chapter_and_activity(
        self,
        session: AsyncSession,
        org_id: int,
        course: Course,
        body_md: str,
    ) -> None:
        """Create a Chapter + CourseChapter + Activity + ChapterActivity for the given body_md."""
        now = str(datetime.now())

        # 1. Chapter
        chapter = Chapter(
            name="Content",
            org_id=org_id,
            course_id=course.id,
            chapter_uuid=f"chapter_{uuid4()}",
            creation_date=now,
            update_date=now,
        )
        session.add(chapter)

        # 2. Activity
        activity = Activity(
            name=course.name,
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_MARKDOWN,
            content={"markdown": body_md},
            published=True,
            org_id=org_id,
            course_id=course.id,
            activity_uuid=f"activity_{uuid4()}",
            creation_date=now,
            update_date=now,
        )
        session.add(activity)

        # Flush to get auto-generated ids before creating link rows
        await session.flush()

        # 3. CourseChapter link
        course_chapter = CourseChapter(
            order=0,
            course_id=course.id,
            chapter_id=chapter.id,
            org_id=org_id,
            creation_date=now,
            update_date=now,
        )
        session.add(course_chapter)

        # 4. ChapterActivity link
        chapter_activity = ChapterActivity(
            order=0,
            chapter_id=chapter.id,
            activity_id=activity.id,
            course_id=course.id,
            org_id=org_id,
            creation_date=now,
            update_date=now,
        )
        session.add(chapter_activity)

        await session.commit()

    async def _refresh_or_create_markdown_activity(
        self,
        session: AsyncSession,
        org_id: int,
        course: Course,
        body_md: str,
    ) -> None:
        """Update an existing markdown Activity's content, or create one if absent."""
        now = str(datetime.now())

        stmt = select(Activity).where(
            Activity.course_id == course.id,
            Activity.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_DYNAMIC_MARKDOWN,
        )
        existing_activity = (await session.execute(stmt)).scalars().first()

        if existing_activity is not None:
            existing_activity.content = {"markdown": body_md}
            existing_activity.update_date = now
            session.add(existing_activity)
            await session.commit()
        else:
            await self._create_chapter_and_activity(session, org_id, course, body_md)
