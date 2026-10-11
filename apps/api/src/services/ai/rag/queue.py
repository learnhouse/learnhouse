"""Debounced indexing queue: the single entry point for keeping RAG fresh.

Callers anywhere content changes do ``enqueue(ContentRef.activity(id))`` after
their commit. Refs live in a Redis sorted set scored by when they are due;
re-enqueueing pushes the due time back, so a burst of saves is indexed once,
after the last one. An in-app consumer claims due refs (``ZREM`` makes the
claim exclusive across pods) and runs the pipeline.

Transcription costs the org AI credits, so a ref only transcribes its media
when whoever queued it asked for that: a media upload, or an admin's manual
re-index. Everything else (edits, imports, the periodic backfill) indexes what
is there and leaves untranscribed media findable by name. The flag lives in a
Redis set beside the queue and is claimed together with the ref.

Without Redis the same debounce runs in-process. ``enqueue`` never raises: a
failure to schedule indexing must never fail the save that triggered it.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.redis import get_redis_client
from src.db.courses.activities import Activity
from src.services.ai.rag.types import ContentRef

logger = logging.getLogger(__name__)

REDIS_KEY = "learnhouse:rag:due"
TRANSCRIBE_KEY = "learnhouse:rag:transcribe"
DEBOUNCE_SECONDS = 10.0
POLL_SECONDS = 2.0
JOB_TIMEOUT_SECONDS = 45 * 60

_consumer_task: Optional[asyncio.Task] = None
_children: set[asyncio.Task] = set()
_inflight: dict[str, bool] = {}
_local_timers: dict[str, asyncio.TimerHandle] = {}
_local_transcribe: set[str] = set()


def concurrency() -> int:
    try:
        return max(1, int(os.environ.get("LEARNHOUSE_RAG_CONCURRENCY", "2")))
    except ValueError:
        return 2


def enqueue(ref: ContentRef, delay: float = DEBOUNCE_SECONDS, *, transcribe: bool = False) -> None:
    """Schedule a ref for indexing ``delay`` seconds from now (debounced).
    ``transcribe`` lets the run spend AI credits on media never transcribed."""
    try:
        _dispatch(ref, delay, transcribe)
    except Exception:
        logger.warning("RAG: could not schedule %s", ref.key, exc_info=True)


def index_activity(activity_id: Optional[int], *, transcribe: bool = False) -> None:
    """Re-index one activity soon. Call after committing any change to it;
    pass ``transcribe=True`` only where new media was uploaded."""
    if activity_id is not None:
        enqueue(ContentRef.activity(activity_id), transcribe=transcribe)


def index_course(course_id: Optional[int]) -> None:
    """Re-index a course's own text (description, chapters) soon."""
    if course_id is not None:
        enqueue(ContentRef.course(course_id))


async def enqueue_course(
    course_id: int, db: AsyncSession, delay: float = DEBOUNCE_SECONDS, *, transcribe: bool = False
) -> int:
    """Schedule a course's own text and all of its activities. Never raises."""
    try:
        activity_ids = (await db.execute(
            select(Activity.id).where(Activity.course_id == course_id)
        )).scalars().all()
    except Exception:
        logger.warning("RAG: could not schedule course %s", course_id, exc_info=True)
        return 0
    enqueue(ContentRef.course(course_id), delay)
    for activity_id in activity_ids:
        enqueue(ContentRef.activity(activity_id), delay, transcribe=transcribe)
    return len(activity_ids) + 1


def _dispatch(ref: ContentRef, delay: float, transcribe: bool = False) -> None:
    client = get_redis_client()
    if client is not None:
        # Flag first, so a consumer never claims the ref without it.
        if transcribe:
            client.sadd(TRANSCRIBE_KEY, ref.key)
        client.zadd(REDIS_KEY, {ref.key: time.time() + delay})
        return
    if transcribe:
        _local_transcribe.add(ref.key)
    _schedule_local(ref, delay)


def _schedule_local(ref: ContentRef, delay: float) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    previous = _local_timers.pop(ref.key, None)
    if previous is not None:
        previous.cancel()

    def fire() -> None:
        _local_timers.pop(ref.key, None)
        transcribe = ref.key in _local_transcribe
        _local_transcribe.discard(ref.key)
        _spawn(ref, transcribe=transcribe)

    _local_timers[ref.key] = loop.call_later(delay, fire)


def _spawn(ref: ContentRef, sem: Optional[asyncio.Semaphore] = None, *, transcribe: bool = False) -> None:
    task = asyncio.create_task(_run(ref, sem, transcribe=transcribe))
    _children.add(task)
    task.add_done_callback(_children.discard)


async def _run(ref: ContentRef, sem: Optional[asyncio.Semaphore] = None, *, transcribe: bool = False) -> None:
    from src.services.ai.rag.pipeline import run

    _inflight[ref.key] = transcribe
    try:
        await asyncio.wait_for(run(ref, transcribe=transcribe), timeout=JOB_TIMEOUT_SECONDS)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("RAG: indexing failed for %s", ref.key)
    finally:
        _inflight.pop(ref.key, None)
        if sem is not None:
            sem.release()


def _claim_due(client) -> Optional[tuple[str, bool]]:
    """Pop one due ref and its transcribe flag. ZREM decides the winner when
    several pods race; only the winner takes the flag."""
    for member in client.zrangebyscore(REDIS_KEY, 0, time.time(), start=0, num=5):
        key = member.decode() if isinstance(member, (bytes, bytearray)) else member
        if client.zrem(REDIS_KEY, key):
            return key, bool(client.srem(TRANSCRIBE_KEY, key))
    return None


async def _consumer_loop() -> None:
    client = get_redis_client()
    if client is None:
        return
    sem = asyncio.Semaphore(concurrency())
    failures = 0
    while True:
        await sem.acquire()
        try:
            claimed = await asyncio.to_thread(_claim_due, client)
            failures = 0
        except asyncio.CancelledError:
            sem.release()
            raise
        except Exception as e:
            failures += 1
            (logger.error if failures >= 3 else logger.warning)("RAG consumer: poll error: %s", e)
            claimed = None
        ref = ContentRef.parse(claimed[0]) if claimed else None
        if ref is None:
            sem.release()
            await asyncio.sleep(POLL_SECONDS)
            continue
        _spawn(ref, sem, transcribe=claimed[1])


def start_consumer() -> None:
    """Start the in-app consumer (call from app startup). No-op without Redis."""
    global _consumer_task
    if get_redis_client() is None:
        return
    if _consumer_task is None or _consumer_task.done():
        _consumer_task = asyncio.create_task(_consumer_loop())


async def stop_consumer() -> None:
    """Stop consuming; in-flight refs go back on the queue for the next pod."""
    global _consumer_task
    for timer in _local_timers.values():
        timer.cancel()
    _local_timers.clear()
    _local_transcribe.clear()
    client = get_redis_client()
    if client is not None and _inflight:
        try:
            transcribing = [key for key, transcribe in _inflight.items() if transcribe]
            if transcribing:
                client.sadd(TRANSCRIBE_KEY, *transcribing)
            client.zadd(REDIS_KEY, {key: time.time() for key in _inflight})
        except Exception:
            logger.warning("RAG: could not requeue in-flight refs", exc_info=True)
    if _consumer_task is not None:
        _consumer_task.cancel()
        try:
            await _consumer_task
        except asyncio.CancelledError:
            pass
        _consumer_task = None
    for task in list(_children):
        task.cancel()
    if _children:
        await asyncio.gather(*list(_children), return_exceptions=True)
