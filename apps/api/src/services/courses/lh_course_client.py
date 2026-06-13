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

from sqlalchemy import text
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.courses import Course

logger = logging.getLogger(__name__)


class LhCourseClient:
    """Thin async client for upserting KB-sourced courses directly into the DB.

    Parameters
    ----------
    org_id:
        The LearnHouse organisation id that owns all synced courses.
    """

    def __init__(self, org_id: int) -> None:
        self.org_id = org_id

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
            Markdown body of the artifact — reserved for a future chapter/
            activity upsert; ignored in this iteration.
        """
        from src.core.events.database import _async_session_factory  # local import avoids circular at module level

        kb_id: str = match["extra_metadata.kb_id"]
        new_sha: str | None = (course.get("extra_metadata") or {}).get("kb_sha")

        async with _async_session_factory() as session:
            existing = await self._find_by_kb_id(session, org_id, kb_id)

            if existing is None:
                await self._create(session, org_id, course, kb_id)
                logger.info("kb_sync: created course for kb_id=%s", kb_id)
            else:
                old_sha = (existing.extra_metadata or {}).get("kb_sha")
                if old_sha == new_sha:
                    logger.debug(
                        "kb_sync: skipping unchanged kb_id=%s (sha=%s)", kb_id, new_sha
                    )
                    return
                await self._update(session, existing, course)
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
        # Branch on the dialect explicitly rather than try/except-and-fallback:
        # PostgreSQL (asyncpg, prod) supports the ->> JSON operator; SQLite
        # (aiosqlite, used in tests via JSON type remapping) does not. A blanket
        # except would also swallow genuine connection/programming errors and
        # silently degrade to a full org-courses scan, so we detect instead.
        if session.get_bind().dialect.name == "postgresql":
            stmt = select(Course).where(
                Course.org_id == org_id,
                text("extra_metadata->>'kb_id' = :kb_id").bindparams(kb_id=kb_id),
            )
            return (await session.execute(stmt)).scalars().first()

        # Non-Postgres (SQLite/tests): fetch org courses carrying extra_metadata
        # and filter in Python. Small result set (only KB-sourced courses).
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
