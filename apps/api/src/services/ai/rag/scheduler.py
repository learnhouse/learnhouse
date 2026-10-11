"""Periodic backfill: queue whatever the index is missing or behind on.

Content changes are indexed by their own triggers. This tick is the safety
net for everything those miss: content from before indexing existed, a pod
that died with work in flight, an embedding provider that was down. Every
interval it compares each ref's last indexed time with its content's update
time and queues the ones that never were indexed, were indexed by the old
indexer, or are out of date. It only looks at orgs that use AI search, caps
how much one sweep queues, and never transcribes media, so it spends no AI
credits; a quiet platform costs one query per interval.

Modelled on ``src/services/demo/scheduler.py``: one replica per interval via a
Redis lock, a failed sweep never kills the loop, and nothing here can stop the
application booting.
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import case, func, or_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.course_embeddings import CourseEmbedding
from src.db.courses.activities import Activity
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.services.ai.rag import queue
from src.services.ai.rag.gating import orgs_using_ai
from src.services.ai.rag.types import ContentRef

logger = logging.getLogger(__name__)

DEFAULT_INTERVAL_HOURS = 3.0
DEFAULT_BATCH = 500
#: Let the app settle, and spread a rolling deploy's replicas before the lock.
STARTUP_DELAY_SECONDS = 60
STARTUP_JITTER_SECONDS = 30

_task: Optional[asyncio.Task] = None


def interval_hours() -> float:
    """LEARNHOUSE_RAG_BACKFILL_HOURS; 0 turns the periodic backfill off."""
    try:
        return max(0.0, float(os.environ.get("LEARNHOUSE_RAG_BACKFILL_HOURS", DEFAULT_INTERVAL_HOURS)))
    except ValueError:
        return DEFAULT_INTERVAL_HOURS


@dataclass
class Stale:
    id: int
    org_id: int
    never_indexed: bool


@dataclass
class SweepResult:
    activities: int = 0
    courses: int = 0
    never_indexed: int = 0
    # Stale refs left for a later sweep by the per-sweep cap.
    deferred: int = 0

    @property
    def queued(self) -> int:
        return self.activities + self.courses


def batch_size() -> int:
    """LEARNHOUSE_RAG_BACKFILL_BATCH: most refs one sweep queues, so a large
    backlog (the first sweep after deploy) is spread over several intervals."""
    try:
        return max(1, int(os.environ.get("LEARNHOUSE_RAG_BACKFILL_BATCH", DEFAULT_BATCH)))
    except ValueError:
        return DEFAULT_BATCH


def _ts(column):
    """A stored timestamp cut to whole seconds, with any ISO "T" made a space,
    so dates written as str(datetime) and as isoformat() compare correctly."""
    return func.substr(func.replace(column, "T", " "), 1, 19)


def _indexed(owner, *where):
    """Per owner: last indexed time, and whether any row predates content
    hashes (written by the old indexer, which skipped most content kinds)."""
    return (
        select(
            owner.label("owner_id"),
            func.max(_ts(CourseEmbedding.update_date)).label("indexed_at"),
            func.sum(case((CourseEmbedding.content_hash.is_(None), 1), else_=0)).label("legacy"),  # type: ignore[union-attr]
        )
        .where(*where)
        .group_by(owner)
        .subquery()
    )


def _is_stale(indexed, *updated):
    return or_(
        indexed.c.indexed_at.is_(None),
        indexed.c.legacy > 0,
        *(_ts(column) > indexed.c.indexed_at for column in updated),
    )


async def stale_activities(db: AsyncSession) -> list[Stale]:
    """Activities never indexed, indexed by the old indexer, or changed (they
    or their chapter) since they were last indexed."""
    indexed = _indexed(
        CourseEmbedding.activity_id, CourseEmbedding.activity_id.is_not(None)  # type: ignore[union-attr]
    )
    chapter = (
        select(ChapterActivity.activity_id, func.max(Chapter.update_date).label("updated"))
        .join(Chapter, Chapter.id == ChapterActivity.chapter_id)  # type: ignore[arg-type]
        .group_by(ChapterActivity.activity_id)
        .subquery()
    )
    rows = await db.execute(
        select(Activity.id, Activity.org_id, indexed.c.indexed_at.is_(None))
        .outerjoin(indexed, indexed.c.owner_id == Activity.id)
        .outerjoin(chapter, chapter.c.activity_id == Activity.id)
        .where(_is_stale(indexed, Activity.update_date, chapter.c.updated))
        .order_by(Activity.id)
    )
    return [Stale(*row) for row in rows.all()]


async def stale_courses(db: AsyncSession) -> list[Stale]:
    """Courses whose own text (description, chapters) was never indexed, was
    indexed by the old indexer, or changed since."""
    indexed = _indexed(
        CourseEmbedding.course_id, CourseEmbedding.activity_id.is_(None)  # type: ignore[union-attr]
    )
    chapter = (
        select(Chapter.course_id, func.max(Chapter.update_date).label("updated"))
        .group_by(Chapter.course_id)
        .subquery()
    )
    rows = await db.execute(
        select(Course.id, Course.org_id, indexed.c.indexed_at.is_(None))
        .outerjoin(indexed, indexed.c.owner_id == Course.id)
        .outerjoin(chapter, chapter.c.course_id == Course.id)
        .where(_is_stale(indexed, Course.update_date, chapter.c.updated))
        .order_by(Course.id)
    )
    return [Stale(*row) for row in rows.all()]


async def sweep(db: AsyncSession) -> SweepResult:
    """Queue refs that are missing from the index or out of date, for orgs
    that use AI search, up to the per-sweep cap. Never transcribes: media
    transcription only runs for new uploads or an admin's re-index."""
    courses = await stale_courses(db)
    activities = await stale_activities(db)
    using_ai = await orgs_using_ai({item.org_id for item in courses + activities}, db)
    refs = [
        (ContentRef.course(item.id), item) for item in courses if item.org_id in using_ai
    ] + [
        (ContentRef.activity(item.id), item) for item in activities if item.org_id in using_ai
    ]
    limit = batch_size()
    for ref, _ in refs[:limit]:
        queue.enqueue(ref, delay=0)
    taken = refs[:limit]
    return SweepResult(
        activities=sum(ref.kind == "activity" for ref, _ in taken),
        courses=sum(ref.kind == "course" for ref, _ in taken),
        never_indexed=sum(item.never_indexed for _, item in taken),
        deferred=len(refs) - len(taken),
    )


def _lock_key(now: datetime, interval_seconds: int) -> str:
    """One lock per interval bucket, so a sweep is claimed at most once."""
    return f"learnhouse:rag:backfill:{int(now.timestamp()) // interval_seconds}"


async def _claim(now: datetime, interval_seconds: int) -> bool:
    """Try to become the replica that sweeps this interval. Without Redis
    there is only this process, so it always sweeps."""
    try:
        from src.core.redis import get_redis_client

        client = get_redis_client()
        if client is None:
            return True
        # Expire inside the interval so the next bucket is always claimable
        # even if a pod dies holding this one.
        ttl = max(30, interval_seconds - 5)
        return bool(await asyncio.to_thread(
            client.set, _lock_key(now, interval_seconds), "1", nx=True, ex=ttl
        ))
    except Exception as exc:
        logger.warning("RAG backfill: lock unavailable, sweeping anyway: %s", exc)
        return True


async def run_once() -> SweepResult:
    from src.core.events.database import _async_session_factory

    started = time.monotonic()
    async with _async_session_factory() as db:
        result = await sweep(db)
    elapsed = time.monotonic() - started
    if result.queued:
        logger.info(
            "RAG backfill: queued %s activities and %s courses for indexing "
            "(%s never indexed, the rest out of date)%s in %.1fs",
            result.activities, result.courses, result.never_indexed,
            f"; {result.deferred} more left for the next sweep" if result.deferred else "",
            elapsed,
        )
    else:
        logger.info("RAG backfill: index is up to date (checked in %.1fs)", elapsed)
    return result


async def _tick(interval_seconds: int) -> None:
    try:
        if await _claim(datetime.now(timezone.utc), interval_seconds):
            await run_once()
        else:
            logger.debug("RAG backfill: another replica has this interval")
    except asyncio.CancelledError:
        raise
    except Exception:
        # A failed sweep must not kill the loop; the next interval retries.
        logger.exception("RAG backfill: sweep failed, will retry next interval")


async def _loop(interval_seconds: int) -> None:
    # Sweep soon after boot rather than a full interval later, so a fresh
    # deploy picks up anything that predates it.
    await asyncio.sleep(STARTUP_DELAY_SECONDS + STARTUP_JITTER_SECONDS * random.random())
    while True:
        await _tick(interval_seconds)
        await asyncio.sleep(interval_seconds)


def start_scheduler() -> None:
    """Start the periodic backfill. Never raises: this runs at startup."""
    global _task
    try:
        hours = interval_hours()
        if not hours:
            logger.info("RAG backfill disabled (LEARNHOUSE_RAG_BACKFILL_HOURS=0)")
            return
        if _task is None or _task.done():
            _task = asyncio.create_task(_loop(max(60, int(hours * 3600))))
            logger.info("RAG backfill scheduler started (every %sh)", f"{hours:g}")
    except Exception as exc:
        logger.warning("RAG backfill scheduler not started: %s", exc)


async def stop_scheduler() -> None:
    """Stop the tick. Never raises."""
    global _task
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except (asyncio.CancelledError, Exception):
        pass
    finally:
        _task = None
