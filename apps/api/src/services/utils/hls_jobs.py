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

# In-process consumer state (dev/self-host only).
_inprocess_sem = asyncio.Semaphore(1)
_inprocess_tasks: set[asyncio.Task] = set()


def _flag(name: str) -> bool:
    return os.environ.get(name, "false").strip().lower() == "true"


def hls_enabled() -> bool:
    return _flag("LEARNHOUSE_HLS_ENABLED")


def inprocess_worker_enabled() -> bool:
    return _flag("LEARNHOUSE_HLS_INPROCESS_WORKER")


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
        if not filename:
            return None
        org = (await db.execute(select(Organization).where(Organization.id == activity.org_id))).scalars().first()
        course = (await db.execute(select(Course).where(Course.id == activity.course_id))).scalars().first()
        if not org or not course:
            return None
        return {"org_uuid": org.org_uuid, "course_uuid": course.course_uuid, "filename": filename}


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
            local_src = os.path.join(td, filename)
            if not _fetch_source(src_key, local_src):
                await _set_status(activity_uuid, "failed", error="source_unavailable")
                return False

            out_dir = os.path.join(td, "hls")
            result = await transcode_source_to_hls(local_src, out_dir)
            if not result:
                await _set_status(activity_uuid, "failed", error="transcode_failed")
                return False

            if is_s3_enabled():
                ok = upload_directory_to_s3(out_dir, hls_prefix)
            else:
                shutil.copytree(out_dir, hls_prefix, dirs_exist_ok=True)
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


def _spawn_inprocess(activity_uuid: str) -> None:
    async def _run():
        async with _inprocess_sem:
            await transcode_activity(activity_uuid)

    task = asyncio.create_task(_run())
    _inprocess_tasks.add(task)
    task.add_done_callback(_inprocess_tasks.discard)


def enqueue(activity_uuid: str) -> None:
    """Queue an activity for HLS transcoding (fire-and-forget, never raises).

    Pushes to Redis (for a `transcode-worker`) and, when the in-process flag is
    set, also runs it locally. No-op when HLS is disabled.
    """
    if not hls_enabled():
        return
    try:
        # Mark queued so the UI can reflect it immediately.
        task = asyncio.create_task(_set_status(activity_uuid, "queued"))
        _inprocess_tasks.add(task)
        task.add_done_callback(_inprocess_tasks.discard)

        client = get_redis_client()
        if client:
            try:
                client.rpush(REDIS_QUEUE_KEY, activity_uuid)
            except Exception as e:
                logger.warning("HLS: could not enqueue %s to Redis: %s", activity_uuid, e)

        if inprocess_worker_enabled():
            _spawn_inprocess(activity_uuid)
        elif not client:
            logger.warning(
                "HLS enabled but no Redis queue and no in-process worker; "
                "activity %s will not transcode until a worker runs.", activity_uuid,
            )
    except RuntimeError:
        # No running event loop (e.g. called from a sync context) — skip.
        logger.warning("HLS: enqueue skipped for %s (no event loop)", activity_uuid)


async def run_worker(poll_timeout: int = 5) -> None:
    """Long-running worker: drain the Redis queue and transcode. For a dedicated
    deployment. Runs until cancelled."""
    client = get_redis_client()
    if not client:
        raise RuntimeError("HLS worker requires Redis (LEARNHOUSE_REDIS_CONNECTION_STRING)")
    logger.info("HLS worker started; polling %s", REDIS_QUEUE_KEY)
    while True:
        try:
            item = client.blpop(REDIS_QUEUE_KEY, timeout=poll_timeout)
        except Exception as e:
            logger.error("HLS worker: Redis poll error: %s", e)
            await asyncio.sleep(poll_timeout)
            continue
        if not item:
            await asyncio.sleep(0)  # yield
            continue
        _key, activity_uuid = item
        if isinstance(activity_uuid, bytes):
            activity_uuid = activity_uuid.decode()
        logger.info("HLS worker: transcoding %s", activity_uuid)
        await transcode_activity(activity_uuid)


async def backfill(limit: int = 0) -> dict:
    """Transcode existing hosted-video activities that aren't already `ready`.

    Processes inline (sequential) so running the CLI actually does the work.
    """
    async with _async_session_factory() as db:
        activities = (
            await db.execute(
                select(Activity).where(
                    Activity.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED
                )
            )
        ).scalars().all()
        targets = [
            a.activity_uuid
            for a in activities
            if (a.extra_metadata or {}).get("hls", {}).get("status") != "ready"
            and (a.content or {}).get("filename")
        ]

    if limit:
        targets = targets[:limit]
    done = failed = 0
    for uuid in targets:
        if await transcode_activity(uuid):
            done += 1
        else:
            failed += 1
    return {"total": len(targets), "done": done, "failed": failed}
