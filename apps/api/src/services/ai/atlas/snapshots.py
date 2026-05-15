"""Course-structure snapshot cache for the resolver.

Holds a compact projection of (course, chapters, activities) keyed by
``course_uuid`` in Redis with a short TTL. The resolver consumes
snapshots for fuzzy / ordinal / exact-name passes without re-querying
Postgres every turn.

Why a separate cache from ``services/courses/cache.py``:
  - Atlas needs a slimmer projection (names, uuids, positions, types)
    and only for the *current* user's view (so unpublished items are
    visible when the caller has permission).
  - TTL is short (60s) — a course author editing in another tab should
    see the new state within a turn or two, and apply paths can
    explicitly invalidate.
"""

from __future__ import annotations

import json
import logging
from typing import Optional, Union

import redis.asyncio as redis_async
from fastapi import Request
from pydantic import BaseModel
from sqlmodel.ext.asyncio.session import AsyncSession

from config.config import get_learnhouse_config
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.services.courses.courses import get_course_meta

logger = logging.getLogger(__name__)


SNAPSHOT_TTL_SECONDS = 60


class ActivityNode(BaseModel):
    """Activity entry in a snapshot — just what the resolver needs."""

    uuid: str
    name: str
    activity_type: Optional[str] = None
    activity_sub_type: Optional[str] = None
    position: int  # 0-based within the parent chapter
    published: Optional[bool] = None


class ChapterNode(BaseModel):
    """Chapter entry in a snapshot."""

    uuid: str
    id: int
    name: str
    position: int  # 0-based within the course
    activities: list[ActivityNode]


class CourseSnapshot(BaseModel):
    """Flat, JSON-serializable view of a course used by the resolver."""

    course_uuid: str
    course_id: int
    course_name: str
    published: bool
    chapters: list[ChapterNode]

    def all_activities(self) -> list[ActivityNode]:
        """Flattened in display order, preserving chapter then activity position."""
        flat: list[ActivityNode] = []
        for ch in self.chapters:
            flat.extend(ch.activities)
        return flat


class SnapshotCache:
    """Async, Redis-backed cache. One instance per HTTP request.

    Falls back to a one-shot in-process dict when Redis is unconfigured
    (tests, dev without Redis), so the resolver still works deterministically.
    """

    KEY_PREFIX = "atlas:snapshot:"

    def __init__(self) -> None:
        self._memory: dict[str, CourseSnapshot] = {}
        self._redis: Optional[redis_async.Redis] = None
        conn = get_learnhouse_config().redis_config.redis_connection_string
        if conn:
            try:
                self._redis = redis_async.from_url(
                    conn, socket_connect_timeout=5, socket_timeout=5
                )
            except Exception as e:
                logger.warning("Atlas snapshot cache: Redis unavailable, using in-memory fallback: %s", e)
                self._redis = None

    def _key(self, course_uuid: str) -> str:
        return f"{self.KEY_PREFIX}{course_uuid}"

    async def get(self, course_uuid: str) -> Optional[CourseSnapshot]:
        """Return a cached snapshot or ``None``. Never raises on cache miss."""
        if course_uuid in self._memory:
            return self._memory[course_uuid]
        if self._redis is None:
            return None
        try:
            raw = await self._redis.get(self._key(course_uuid))
            if not raw:
                return None
            data = json.loads(raw)
            snap = CourseSnapshot.model_validate(data)
            self._memory[course_uuid] = snap
            return snap
        except Exception as e:
            logger.warning("Atlas snapshot cache read failed: %s", e)
            return None

    async def put(self, snap: CourseSnapshot) -> None:
        """Store a snapshot. Best-effort — write failures don't propagate."""
        self._memory[snap.course_uuid] = snap
        if self._redis is None:
            return
        try:
            await self._redis.setex(
                self._key(snap.course_uuid),
                SNAPSHOT_TTL_SECONDS,
                snap.model_dump_json(),
            )
        except Exception as e:
            logger.warning("Atlas snapshot cache write failed: %s", e)

    async def invalidate(self, course_uuid: str) -> None:
        """Drop the snapshot for a course after an apply mutates it."""
        self._memory.pop(course_uuid, None)
        if self._redis is None:
            return
        try:
            await self._redis.delete(self._key(course_uuid))
        except Exception as e:
            logger.warning("Atlas snapshot cache invalidate failed: %s", e)

    async def get_or_build(
        self,
        course_uuid: str,
        *,
        request: Request,
        db: AsyncSession,
        current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    ) -> CourseSnapshot:
        """Cache-aside: return a snapshot, building from the DB on miss.

        Building goes through ``get_course_meta`` with ``slim=True`` and
        ``with_unpublished_activities=True`` so the resolver sees the
        full author view; the existing RBAC inside ``get_course_meta``
        will 403 if the caller isn't permitted to read the course.
        """
        cached = await self.get(course_uuid)
        if cached is not None:
            return cached

        course_read = await get_course_meta(
            request=request,
            course_uuid=course_uuid,
            with_unpublished_activities=True,
            current_user=current_user,
            db_session=db,
            slim=True,
        )
        snap = _build_snapshot(course_read)
        await self.put(snap)
        return snap

    async def close(self) -> None:
        """Release the Redis connection at end of request."""
        if self._redis is not None:
            try:
                await self._redis.aclose()
            except Exception:
                pass


def _build_snapshot(course_read) -> CourseSnapshot:
    """Project a ``FullCourseRead`` into the compact resolver shape.

    Lives at module scope (not on the class) so it's trivial to unit-test
    against a synthetic ``FullCourseRead`` without touching Redis.
    """
    chapters: list[ChapterNode] = []
    for chap_idx, chap in enumerate(getattr(course_read, "chapters", []) or []):
        activities: list[ActivityNode] = []
        for act_idx, act in enumerate(getattr(chap, "activities", []) or []):
            activities.append(
                ActivityNode(
                    uuid=getattr(act, "activity_uuid", "") or "",
                    name=getattr(act, "name", "") or "",
                    activity_type=_enum_value(getattr(act, "activity_type", None)),
                    activity_sub_type=_enum_value(getattr(act, "activity_sub_type", None)),
                    position=act_idx,
                    published=getattr(act, "published", None),
                )
            )
        chapters.append(
            ChapterNode(
                uuid=getattr(chap, "chapter_uuid", "") or "",
                id=int(getattr(chap, "id", 0) or 0),
                name=getattr(chap, "name", "") or "",
                position=chap_idx,
                activities=activities,
            )
        )
    return CourseSnapshot(
        course_uuid=getattr(course_read, "course_uuid", "") or "",
        course_id=int(getattr(course_read, "id", 0) or 0),
        course_name=getattr(course_read, "name", "") or "",
        published=bool(getattr(course_read, "published", False)),
        chapters=chapters,
    )


def _enum_value(v):
    """Unwrap a string-enum to its raw value; pass through plain strings/None."""
    if v is None:
        return None
    return getattr(v, "value", v)
