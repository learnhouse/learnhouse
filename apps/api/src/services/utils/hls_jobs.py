"""
HLS transcoding jobs.

Ties the transcoder to activities and storage: resolve an activity's source
video, transcode it to an HLS ladder, upload the output next to the original,
and record status on `activity.extra_metadata["hls"]`.

Execution models (no dedicated worker infra exists yet):
- A `transcode-worker` CLI drains a Redis queue — the recommended prod path so
  heavy ffmpeg runs off the API pods.
- An in-process consumer (`LEARNHOUSE_HLS_INPROCESS_WORKER=true`, default off,
  Semaphore(1)) for dev/self-host.

Everything is gated by `LEARNHOUSE_HLS_ENABLED` (default off). Until a video is
`ready`, callers keep using the optimized MP4 fallback.
"""

import asyncio
import logging
import os
import shutil
import tempfile
from datetime import datetime, timezone
from typing import Optional

from sqlmodel import select

from src.core.events.database import _async_session_factory
from src.core.redis import get_redis_client
from src.db.courses.activities import Activity, ActivitySubTypeEnum
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.services.courses.transfer.storage_utils import (
    is_s3_enabled,
    get_storage_client,
    get_s3_bucket_name,
    upload_directory_to_s3,
)
from src.services.utils.hls_transcode import transcode_source_to_hls

logger = logging.getLogger(__name__)

REDIS_QUEUE_KEY = "learnhouse:hls:queue"

# In-app background consumer state. Transcoding runs INSIDE the API process as
# an asyncio background task that drains the Redis queue — no separate worker
# deployment. ffmpeg runs as an async subprocess and S3 I/O is offloaded to a
# thread, so the event loop is never blocked; a semaphore caps how many
# transcodes run at once per pod.
_consumer_task: Optional["asyncio.Task"] = None
_consumer_children: set = set()


def _flag(name: str) -> bool:
    return os.environ.get(name, "false").strip().lower() == "true"


def hls_enabled() -> bool:
    return _flag("LEARNHOUSE_HLS_ENABLED")


def hls_concurrency() -> int:
    """Max concurrent transcodes per API pod (LEARNHOUSE_HLS_CONCURRENCY, default 1)."""
    try:
        return max(1, int(os.environ.get("LEARNHOUSE_HLS_CONCURRENCY", "1")))
    except (TypeError, ValueError):
        return 1


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _set_status(activity_uuid: str, status: str, **extra) -> None:
    """Write {status, updated_at, **extra} to activity.extra_metadata['hls']."""
    async with _async_session_factory() as db:
        activity = (
            await db.execute(select(Activity).where(Activity.activity_uuid == activity_uuid))
        ).scalars().first()
        if not activity:
            return
        meta = dict(activity.extra_metadata or {})
        meta["hls"] = {"status": status, "updated_at": _now(), **extra}
        # Reassign so SQLAlchemy detects the JSONB change.
        activity.extra_metadata = meta
        db.add(activity)
        await db.commit()


async def _resolve_source(activity_uuid: str) -> Optional[dict]:
    """Return {org_uuid, course_uuid, filename} for a hosted-video activity."""
    async with _async_session_factory() as db:
        activity = (
            await db.execute(select(Activity).where(Activity.activity_uuid == activity_uuid))
        ).scalars().first()
        if not activity or activity.activity_sub_type != ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED:
            return None
        filename = (activity.content or {}).get("filename")
        if not filename or not _safe_filename(filename):
            return None
        org = (await db.execute(select(Organization).where(Organization.id == activity.org_id))).scalars().first()
        course = (await db.execute(select(Course).where(Course.id == activity.course_id))).scalars().first()
        if not org or not course:
            return None
        return {"org_uuid": org.org_uuid, "course_uuid": course.course_uuid, "filename": filename}


def _safe_filename(filename: str) -> bool:
    """A stored filename must be a bare name — reject path separators, traversal,
    NUL, and absolute paths so it can't escape the activity's key/dir on join."""
    if not filename or "\x00" in filename:
        return False
    if "/" in filename or "\\" in filename:
        return False
    if filename in (".", "..") or filename.startswith("."):
        return False
    return True


def _fetch_source(src_key: str, local_path: str) -> bool:
    """Copy the source video to local_path (stream-download from R2, or local copy)."""
    if is_s3_enabled():
        client = get_storage_client()
        if not client:
            return False
        try:
            client.download_file(get_s3_bucket_name(), src_key, local_path)
            return True
        except Exception as e:
            logger.error("HLS: failed to download source %s: %s", src_key, e)
            return False
    # Local filesystem: the source lives at the content-relative key.
    if os.path.isfile(src_key):
        shutil.copyfile(src_key, local_path)
        return True
    logger.error("HLS: local source missing %s", src_key)
    return False


async def transcode_activity(activity_uuid: str) -> bool:
    """Full job: resolve → download → transcode → upload → mark ready/failed."""
    info = await _resolve_source(activity_uuid)
    if not info:
        logger.warning("HLS: no transcodable source for activity %s", activity_uuid)
        return False

    org_uuid, course_uuid, filename = info["org_uuid"], info["course_uuid"], info["filename"]
    base = f"content/orgs/{org_uuid}/courses/{course_uuid}/activities/{activity_uuid}/video"
    src_key = f"{base}/{filename}"
    hls_prefix = f"{base}/hls"

    await _set_status(activity_uuid, "processing")
    try:
        with tempfile.TemporaryDirectory() as td:
            # basename() is defensive belt-and-suspenders on top of _safe_filename.
            local_src = os.path.join(td, os.path.basename(filename))
            # Blocking I/O off the event loop (matters for the in-process worker).
            if not await asyncio.to_thread(_fetch_source, src_key, local_src):
                await _set_status(activity_uuid, "failed", error="source_unavailable")
                return False

            out_dir = os.path.join(td, "hls")
            result = await transcode_source_to_hls(local_src, out_dir)
            if not result:
                await _set_status(activity_uuid, "failed", error="transcode_failed")
                return False

            if is_s3_enabled():
                ok = await asyncio.to_thread(upload_directory_to_s3, out_dir, hls_prefix)
            else:
                await asyncio.to_thread(shutil.copytree, out_dir, hls_prefix, dirs_exist_ok=True)
                ok = True
            if not ok:
                await _set_status(activity_uuid, "failed", error="upload_failed")
                return False

        await _set_status(
            activity_uuid, "ready",
            master=result["master"], renditions=result["renditions"],
            thumbnails=result.get("thumbnails"),
        )
        logger.info("HLS ready for activity %s (%s)", activity_uuid, ",".join(result["renditions"]))
        return True
    except Exception as e:
        logger.error("HLS job crashed for %s: %s", activity_uuid, e)
        await _set_status(activity_uuid, "failed", error="exception")
        return False


def enqueue(activity_uuid: str) -> None:
    """Queue an activity for HLS transcoding (fire-and-forget, never raises).

    Just pushes to the Redis queue; the in-app background consumer (started at
    app startup) drains and transcodes it. No-op when HLS is disabled.
    """
    if not hls_enabled():
        return
    client = get_redis_client()
    if not client:
        logger.warning("HLS enabled but no Redis; cannot enqueue %s", activity_uuid)
        return
    try:
        client.rpush(REDIS_QUEUE_KEY, activity_uuid)
    except Exception as e:
        logger.warning("HLS: could not enqueue %s to Redis: %s", activity_uuid, e)


# ---------------------------------------------------------------------------
# In-app background consumer (Redis queue → asyncio background tasks; no worker)
# ---------------------------------------------------------------------------

async def _consumer_loop(poll_timeout: int = 5) -> None:
    """Drain the Redis queue and transcode, capped at hls_concurrency() jobs.

    Acquires a permit BEFORE pulling the next item, so the queue is never
    drained into memory and at most `concurrency` transcodes run at once.
    """
    client = get_redis_client()
    if not client:
        logger.warning("HLS consumer: Redis unavailable; not started")
        return
    sem = asyncio.Semaphore(hls_concurrency())
    logger.info("HLS in-app consumer started (concurrency=%s)", hls_concurrency())

    async def _run(uuid: str) -> None:
        try:
            await transcode_activity(uuid)
        except Exception as e:
            logger.error("HLS consumer: job %s failed: %s", uuid, e)
        finally:
            sem.release()

    while True:
        await sem.acquire()
        try:
            item = await asyncio.to_thread(client.blpop, REDIS_QUEUE_KEY, poll_timeout)
        except asyncio.CancelledError:
            sem.release()
            raise
        except Exception as e:
            logger.error("HLS consumer: poll error: %s", e)
            sem.release()
            await asyncio.sleep(poll_timeout)
            continue
        if not item:
            sem.release()
            continue
        activity_uuid = item[1].decode() if isinstance(item[1], bytes) else item[1]
        task = asyncio.create_task(_run(activity_uuid))  # releases the permit when done
        _consumer_children.add(task)
        task.add_done_callback(_consumer_children.discard)


def start_consumer() -> None:
    """Start the in-app HLS consumer (call from app startup). Idempotent no-op
    when HLS is disabled or Redis is unavailable."""
    global _consumer_task
    if not hls_enabled():
        return
    if _consumer_task and not _consumer_task.done():
        return
    if not get_redis_client():
        logger.warning("HLS enabled but no Redis; in-app consumer not started")
        return
    _consumer_task = asyncio.create_task(_consumer_loop())


async def stop_consumer() -> None:
    """Cancel the consumer and wait for in-flight transcodes (call from shutdown)."""
    global _consumer_task
    if _consumer_task:
        _consumer_task.cancel()
        try:
            await _consumer_task
        except asyncio.CancelledError:
            pass
        _consumer_task = None
    if _consumer_children:
        await asyncio.gather(*list(_consumer_children), return_exceptions=True)


async def _pending_targets(limit: int = 0) -> list[str]:
    """UUIDs of hosted-video activities that aren't `ready` and have a file."""
    async with _async_session_factory() as db:
        activities = (
            await db.execute(
                select(Activity).where(
                    Activity.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED
                )
            )
        ).scalars().all()
        # ((... or {}).get("hls") or {}) guards against extra_metadata={"hls": None}.
        targets = [
            a.activity_uuid
            for a in activities
            if ((a.extra_metadata or {}).get("hls") or {}).get("status") != "ready"
            and (a.content or {}).get("filename")
        ]
    if limit and limit > 0:
        targets = targets[:limit]
    return targets


async def enqueue_pending(limit: int = 0) -> dict:
    """Enqueue every not-yet-ready hosted video for HLS. The in-app consumer
    transcodes them in the background — this returns immediately."""
    targets = await _pending_targets(limit)
    client = get_redis_client()
    if not client:
        return {"pending": len(targets), "enqueued": 0, "error": "no_redis"}
    enqueued = 0
    for uuid in targets:
        try:
            client.rpush(REDIS_QUEUE_KEY, uuid)
            enqueued += 1
        except Exception as e:
            logger.warning("HLS: could not enqueue %s: %s", uuid, e)
    return {"pending": len(targets), "enqueued": enqueued}


async def backfill(limit: int = 0) -> dict:
    """Transcode existing not-ready hosted videos INLINE (sequential).

    Kept for one-off CLI use / tests. The normal path is enqueue_pending(), which
    hands work to the in-app background consumer instead of blocking here.
    """
    targets = await _pending_targets(limit)
    done = failed = 0
    for uuid in targets:
        if await transcode_activity(uuid):
            done += 1
        else:
            failed += 1
    return {"total": len(targets), "done": done, "failed": failed}
