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
import json
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
from src.db.courses.blocks import Block, BlockTypeEnum
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
_reaper_task: Optional["asyncio.Task"] = None
_consumer_children: set = set()
# UUIDs currently transcoding on THIS pod — re-enqueued on shutdown so a pod
# termination (deploy/autoscale) never leaves a job stuck at "processing".
_inflight: set = set()

REAPER_INTERVAL_SECONDS = 5 * 60
CONSUMER_POLL_SECONDS = 2
# Hard ceiling for a single transcode job; bounds any hang so the consumer slot
# always frees (the reconciler re-queues anything left unfinished).
JOB_TIMEOUT_SECONDS = 40 * 60

# Reconciliation: a running transcode holds a heartbeated Redis "lease" so the
# reconciler can tell active work from an interrupted job WITHOUT relying on
# stale timestamps (a slow 1-thread encode can outlive any fixed staleness
# window). The lease expires shortly after a pod dies, so its job is re-queued
# fast. Retries are capped so a genuinely broken video can't loop forever.
LEASE_TTL_SECONDS = 180
LEASE_HEARTBEAT_SECONDS = 60


def hls_max_retries() -> int:
    """Max auto-retries per video before the reconciler gives up
    (LEARNHOUSE_HLS_MAX_RETRIES, default 6)."""
    try:
        return max(1, int(os.environ.get("LEARNHOUSE_HLS_MAX_RETRIES", "6")))
    except (TypeError, ValueError):
        return 6


def _lease_key(activity_uuid: str) -> str:
    return f"learnhouse:hls:lease:{activity_uuid}"


def _retries_key(activity_uuid: str) -> str:
    return f"learnhouse:hls:retries:{activity_uuid}"


async def _lease_heartbeat(client, key: str) -> None:
    """Refresh the processing lease's TTL until cancelled."""
    try:
        while True:
            await asyncio.sleep(LEASE_HEARTBEAT_SECONDS)
            await asyncio.to_thread(client.expire, key, LEASE_TTL_SECONDS)
    except asyncio.CancelledError:
        raise
    except Exception:
        pass


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

    # Hold a heartbeated lease so the reconciler knows this job is actively
    # running; it expires shortly after this pod dies, prompting a fast retry.
    client = get_redis_client()
    lease = _lease_key(activity_uuid)
    heartbeat = None
    if client:
        try:
            client.set(lease, "1", ex=LEASE_TTL_SECONDS)
            heartbeat = asyncio.create_task(_lease_heartbeat(client, lease))
        except Exception:
            heartbeat = None

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
        if client:
            try:
                client.delete(_retries_key(activity_uuid))  # success clears the retry count
            except Exception:
                pass
        logger.info("HLS ready for activity %s (%s)", activity_uuid, ",".join(result["renditions"]))
        return True
    except Exception as e:
        logger.error("HLS job crashed for %s: %s", activity_uuid, e)
        await _set_status(activity_uuid, "failed", error="exception")
        return False
    finally:
        if heartbeat:
            heartbeat.cancel()
        if client:
            try:
                client.delete(lease)
            except Exception:
                pass


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
# Video BLOCK transcoding — reuses the SAME queue/consumer/reconciler/transcoder
# as activities. A block job is a JSON queue item; a legacy bare uuid string is
# still an activity job, so the activity path is untouched.
# ---------------------------------------------------------------------------

def _block_item(activity_uuid: str, block_uuid: str) -> str:
    """Canonical queue payload for a block job (stable key order for dedup)."""
    return json.dumps({"kind": "block", "activity_uuid": activity_uuid, "block_uuid": block_uuid})


def _parse_item(item: str) -> dict:
    """Decode a queue item into a job descriptor.

    A bare activity_uuid (legacy) → an activity job; a JSON `{"kind":"block",...}`
    → a block job.
    """
    if item and item.startswith("{"):
        try:
            data = json.loads(item)
            if isinstance(data, dict) and data.get("kind") == "block":
                return {
                    "kind": "block",
                    "activity_uuid": data.get("activity_uuid"),
                    "block_uuid": data.get("block_uuid"),
                }
        except Exception:
            pass
    return {"kind": "activity", "activity_uuid": item}


def enqueue_block(activity_uuid: str, block_uuid: str) -> None:
    """Queue a video BLOCK for HLS transcoding (fire-and-forget, never raises)."""
    if not hls_enabled():
        return
    client = get_redis_client()
    if not client:
        logger.warning("HLS enabled but no Redis; cannot enqueue block %s", block_uuid)
        return
    try:
        client.rpush(REDIS_QUEUE_KEY, _block_item(activity_uuid, block_uuid))
    except Exception as e:  # pragma: no cover
        logger.warning("HLS: could not enqueue block %s to Redis: %s", block_uuid, e)


async def _set_block_status(block_uuid: str, status: str, **extra) -> None:
    """Write {status, updated_at, **extra} to block.content['hls']."""
    async with _async_session_factory() as db:
        block = (
            await db.execute(select(Block).where(Block.block_uuid == block_uuid))
        ).scalars().first()
        if not block:
            return
        content = dict(block.content or {})
        content["hls"] = {"status": status, "updated_at": _now(), **extra}
        block.content = content  # reassign so SQLAlchemy detects the JSON change
        db.add(block)
        await db.commit()


async def _resolve_block_source(block_uuid: str) -> Optional[dict]:
    """Return {org_uuid, course_uuid, activity_uuid, filename} for a video block."""
    async with _async_session_factory() as db:
        block = (
            await db.execute(select(Block).where(Block.block_uuid == block_uuid))
        ).scalars().first()
        if not block or block.block_type != BlockTypeEnum.BLOCK_VIDEO:
            return None
        content = block.content or {}
        file_id, fmt = content.get("file_id"), content.get("file_format")
        if not file_id or not fmt:
            return None
        filename = f"{file_id}.{fmt}"
        if not _safe_filename(filename):
            return None
        org = (await db.execute(select(Organization).where(Organization.id == block.org_id))).scalars().first()
        course = (await db.execute(select(Course).where(Course.id == block.course_id))).scalars().first()
        activity = (await db.execute(select(Activity).where(Activity.id == block.activity_id))).scalars().first()
        if not org or not course or not activity:  # pragma: no cover
            return None
        return {
            "org_uuid": org.org_uuid,
            "course_uuid": course.course_uuid,
            "activity_uuid": activity.activity_uuid,
            "filename": filename,
        }


async def transcode_block(activity_uuid: str, block_uuid: str) -> bool:
    """Full block job: resolve → download → transcode → upload → mark ready/failed.

    Mirrors transcode_activity but keys storage/status/lease off the block.
    """
    info = await _resolve_block_source(block_uuid)
    if not info:
        logger.warning("HLS: no transcodable source for block %s", block_uuid)
        return False

    org_uuid, course_uuid, filename = info["org_uuid"], info["course_uuid"], info["filename"]
    base = (
        f"content/orgs/{org_uuid}/courses/{course_uuid}/activities/{info['activity_uuid']}"
        f"/dynamic/blocks/videoBlock/{block_uuid}"
    )
    src_key = f"{base}/{filename}"
    hls_prefix = f"{base}/hls"

    client = get_redis_client()
    lease = _lease_key(f"block:{block_uuid}")
    heartbeat = None
    if client:
        try:
            client.set(lease, "1", ex=LEASE_TTL_SECONDS)
            heartbeat = asyncio.create_task(_lease_heartbeat(client, lease))
        except Exception:  # pragma: no cover
            heartbeat = None

    await _set_block_status(block_uuid, "processing")
    try:
        with tempfile.TemporaryDirectory() as td:
            local_src = os.path.join(td, os.path.basename(filename))
            if not await asyncio.to_thread(_fetch_source, src_key, local_src):
                await _set_block_status(block_uuid, "failed", error="source_unavailable")
                return False

            out_dir = os.path.join(td, "hls")
            result = await transcode_source_to_hls(local_src, out_dir)
            if not result:
                await _set_block_status(block_uuid, "failed", error="transcode_failed")
                return False

            if is_s3_enabled():
                ok = await asyncio.to_thread(upload_directory_to_s3, out_dir, hls_prefix)
            else:
                await asyncio.to_thread(shutil.copytree, out_dir, hls_prefix, dirs_exist_ok=True)
                ok = True
            if not ok:
                await _set_block_status(block_uuid, "failed", error="upload_failed")
                return False

        await _set_block_status(
            block_uuid, "ready",
            master=result["master"], renditions=result["renditions"],
            thumbnails=result.get("thumbnails"),
        )
        if client:
            try:
                client.delete(_retries_key(f"block:{block_uuid}"))
            except Exception:  # pragma: no cover
                pass
        logger.info("HLS ready for block %s (%s)", block_uuid, ",".join(result["renditions"]))
        return True
    except Exception as e:
        logger.error("HLS block job crashed for %s: %s", block_uuid, e)
        await _set_block_status(block_uuid, "failed", error="exception")
        return False
    finally:
        if heartbeat:
            heartbeat.cancel()
        if client:
            try:
                client.delete(lease)
            except Exception:  # pragma: no cover
                pass


async def _dispatch(job: dict) -> bool:
    """Run the right transcode for a parsed queue job."""
    if job["kind"] == "block":
        return await transcode_block(job["activity_uuid"], job["block_uuid"])
    return await transcode_activity(job["activity_uuid"])


async def _mark_failed(job: dict, error: str) -> None:
    if job["kind"] == "block":
        await _set_block_status(job["block_uuid"], "failed", error=error)
    else:
        await _set_status(job["activity_uuid"], "failed", error=error)


# ---------------------------------------------------------------------------
# In-app background consumer (Redis queue → asyncio background tasks; no worker)
# ---------------------------------------------------------------------------

async def _consumer_loop(poll_seconds: int = CONSUMER_POLL_SECONDS) -> None:
    """Drain the Redis queue and transcode, capped at hls_concurrency() jobs.

    Uses non-blocking LPOP + sleep (NOT BLPOP) so it never collides with the
    Redis client's socket_timeout (which turned every idle poll into an error
    and could drop a job popped server-side). Acquires a permit before pulling,
    so at most `concurrency` transcodes run at once and the queue is never
    drained into memory.
    """
    client = get_redis_client()
    if not client:
        logger.warning("HLS consumer: Redis unavailable; not started")
        return
    sem = asyncio.Semaphore(hls_concurrency())
    logger.info("HLS in-app consumer started (concurrency=%s)", hls_concurrency())

    async def _run(item: str) -> None:
        # `item` is the RAW queue payload (an activity uuid, or a block JSON job);
        # _inflight holds it verbatim so shutdown re-enqueues the right thing.
        _inflight.add(item)
        job = _parse_item(item)
        try:
            # Hard overall cap so NO single job can occupy a slot indefinitely
            # (e.g. a subprocess spawn that hangs before its own timeout applies).
            await asyncio.wait_for(_dispatch(job), timeout=JOB_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            logger.error("HLS: job %s exceeded %ss — marking failed", item, JOB_TIMEOUT_SECONDS)
            try:
                await _mark_failed(job, "timeout")
            except Exception:
                pass
        except asyncio.CancelledError:
            # Interrupted (pod shutting down) — re-queue so another pod finishes it.
            try:
                client.rpush(REDIS_QUEUE_KEY, item)
            except Exception:
                pass
            raise
        except Exception as e:
            logger.error("HLS consumer: job %s failed: %s", item, e)
        finally:
            _inflight.discard(item)
            sem.release()

    while True:
        await sem.acquire()
        try:
            item = await asyncio.to_thread(client.lpop, REDIS_QUEUE_KEY)
        except asyncio.CancelledError:
            sem.release()
            raise
        except Exception as e:
            logger.error("HLS consumer: poll error: %s", e)
            sem.release()
            await asyncio.sleep(poll_seconds)
            continue
        if not item:
            sem.release()
            await asyncio.sleep(poll_seconds)
            continue
        raw_item = item.decode() if isinstance(item, (bytes, bytearray)) else item
        task = asyncio.create_task(_run(raw_item))  # releases the permit when done
        _consumer_children.add(task)
        task.add_done_callback(_consumer_children.discard)


async def reconcile_unfinished(max_retries: Optional[int] = None) -> dict:
    """Re-poll for hosted videos whose HLS isn't `ready` and (re)queue them —
    the clean auto-retry system that replaces manual re-triggering.

    Per video it:
      * skips ones that are `ready`, already queued, or actively transcoding
        (a live heartbeated processing lease exists);
      * otherwise (re)queues it — interrupted `processing`, `failed`, a lost
        `queued`, or never-started (no hls) — bumping a Redis retry counter;
      * gives up after `max_retries` so a genuinely broken file can't loop
        forever (a successful transcode clears that video's counter).

    Returns {requeued, skipped, gaveup}.
    """
    if max_retries is None:
        max_retries = hls_max_retries()
    client = get_redis_client()
    if not client:
        return {"requeued": 0, "skipped": 0, "gaveup": 0, "error": "no_redis"}
    now = datetime.now(timezone.utc)
    # Snapshot what's already waiting so we never double-queue an item.
    try:
        raw = client.lrange(REDIS_QUEUE_KEY, 0, -1)
        pending = {(x.decode() if isinstance(x, (bytes, bytearray)) else x) for x in raw}
    except Exception:
        pending = set()

    requeued = skipped = gaveup = 0
    async with _async_session_factory() as db:
        rows = (await db.execute(
            select(Activity).where(
                Activity.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED
            )
        )).scalars().all()
        for a in rows:
            if not (a.content or {}).get("filename"):
                continue
            hls = (a.extra_metadata or {}).get("hls") or {}
            if hls.get("status") == "ready":
                continue
            uuid = a.activity_uuid
            if uuid in pending:
                skipped += 1
                continue
            try:
                if client.exists(_lease_key(uuid)):  # actively transcoding somewhere
                    skipped += 1
                    continue
            except Exception:
                pass
            # Retry cap, tracked in Redis so status writes can't clobber it.
            rkey = _retries_key(uuid)
            try:
                retries = int(client.get(rkey) or 0)
            except Exception:
                retries = 0
            if retries >= max_retries:
                gaveup += 1
                continue
            try:
                client.incr(rkey)
                client.expire(rkey, 7 * 24 * 3600)
            except Exception:
                pass
            meta = dict(a.extra_metadata or {})
            meta["hls"] = {**hls, "status": "queued", "updated_at": now.isoformat()}
            a.extra_metadata = meta  # reassign so SQLAlchemy detects the JSONB change
            db.add(a)
            await db.commit()
            try:
                client.rpush(REDIS_QUEUE_KEY, uuid)
                requeued += 1
            except Exception:
                pass

        # Video BLOCKS — same retry/lease/dedup logic, keyed by block:{uuid}.
        brows = (await db.execute(
            select(Block).where(Block.block_type == BlockTypeEnum.BLOCK_VIDEO)
        )).scalars().all()
        for b in brows:
            content = b.content or {}
            if not content.get("file_id"):
                continue
            hls = content.get("hls") or {}
            if hls.get("status") == "ready":
                continue
            activity_uuid = content.get("activity_uuid")
            if not activity_uuid:
                continue
            item = _block_item(activity_uuid, b.block_uuid)
            if item in pending:
                skipped += 1
                continue
            leaseid = f"block:{b.block_uuid}"
            try:
                if client.exists(_lease_key(leaseid)):
                    skipped += 1
                    continue
            except Exception:  # pragma: no cover
                pass
            rkey = _retries_key(leaseid)
            try:
                retries = int(client.get(rkey) or 0)
            except Exception:  # pragma: no cover
                retries = 0
            if retries >= max_retries:
                gaveup += 1
                continue
            try:
                client.incr(rkey)
                client.expire(rkey, 7 * 24 * 3600)
            except Exception:  # pragma: no cover
                pass
            new_content = dict(content)
            new_content["hls"] = {**hls, "status": "queued", "updated_at": now.isoformat()}
            b.content = new_content  # reassign so SQLAlchemy detects the JSON change
            db.add(b)
            await db.commit()
            try:
                client.rpush(REDIS_QUEUE_KEY, item)
                requeued += 1
            except Exception:  # pragma: no cover
                pass
    if requeued or gaveup:
        logger.info("HLS reconcile: requeued=%s gaveup=%s skipped=%s", requeued, gaveup, skipped)
    return {"requeued": requeued, "skipped": skipped, "gaveup": gaveup}


async def _reconcile_loop(interval: int = REAPER_INTERVAL_SECONDS) -> None:
    while True:
        await asyncio.sleep(interval)
        try:
            await reconcile_unfinished()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("HLS reconcile error: %s", e)


def start_consumer() -> None:
    """Start the in-app HLS consumer + stale-job reaper (call from app startup).
    Idempotent no-op when HLS is disabled or Redis is unavailable."""
    global _consumer_task, _reaper_task
    if not hls_enabled():
        return
    if not get_redis_client():
        logger.warning("HLS enabled but no Redis; in-app consumer not started")
        return
    if not (_consumer_task and not _consumer_task.done()):
        _consumer_task = asyncio.create_task(_consumer_loop())
    if not (_reaper_task and not _reaper_task.done()):
        _reaper_task = asyncio.create_task(_reconcile_loop())


async def stop_consumer() -> None:
    """Cancel the consumer/reaper and re-enqueue in-flight jobs so a pod
    shutdown (deploy/autoscale) never orphans a transcode (call from shutdown)."""
    global _consumer_task, _reaper_task
    # Re-enqueue in-flight jobs FIRST so they survive this pod's termination.
    client = get_redis_client()
    if client and _inflight:
        for uuid in list(_inflight):
            try:
                client.rpush(REDIS_QUEUE_KEY, uuid)
            except Exception:
                pass
    for t in (_consumer_task, _reaper_task):
        if t:
            t.cancel()
            try:
                await t
            except asyncio.CancelledError:
                pass
    _consumer_task = None
    _reaper_task = None
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
