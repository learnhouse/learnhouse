"""AI closed-captions background pipeline.

Mirrors the hardened HLS consumer (LPOP + reaper + per-job timeout + shutdown
re-enqueue) but for caption generation: resolve the hosted video → extract audio
→ meter the org's AI credits → transcribe (Gemini) → translate per target language
→ upload WebVTT to R2 → record per-language status in
``activity.extra_metadata['captions']``.

Design mirrors ``hls_jobs`` deliberately so both pipelines behave identically under
pod churn. Reuses the AI layer (``src.services.ai.llm``) and org credit metering
(``reserve_ai_credit``/``refund_ai_credit``).
"""
from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import select

from src.core.events.database import _async_session_factory
from src.core.redis import get_redis_client
from src.db.courses.activities import Activity, ActivitySubTypeEnum
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.services.ai import captions as cap
from src.services.courses.transfer.storage_utils import (
    is_s3_enabled,
    upload_directory_to_s3,
)
from src.services.utils.hls_jobs import _fetch_source  # reuse the R2 download helper

logger = logging.getLogger(__name__)

REDIS_QUEUE_KEY = "learnhouse:captions:queue"
JOB_TIMEOUT_SECONDS = 40 * 60
CONSUMER_POLL_SECONDS = 2
STALE_PROCESSING_SECONDS = 20 * 60
REAPER_INTERVAL_SECONDS = 5 * 60
# How many consecutive background failures (queue polls, reaper passes) it takes
# before we treat the condition as a real outage rather than a blip.
CONSECUTIVE_POLL_FAILURES_BEFORE_ERROR = 3

_consumer_task: Optional["asyncio.Task"] = None
_reaper_task: Optional["asyncio.Task"] = None
_children: set = set()
_inflight: set = set()


def concurrency() -> int:
    try:
        return max(1, int(os.environ.get("LEARNHOUSE_CAPTIONS_CONCURRENCY", "1")))
    except (TypeError, ValueError):
        return 1


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------
# Status writes (activity.extra_metadata['captions'])
# --------------------------------------------------------------------------

async def _patch_captions(activity_uuid: str, **patch) -> None:
    """Shallow-merge `patch` into extra_metadata['captions'] (creating it if absent)."""
    async with _async_session_factory() as db:
        activity = (
            await db.execute(select(Activity).where(Activity.activity_uuid == activity_uuid))
        ).scalars().first()
        if not activity:
            return
        meta = dict(activity.extra_metadata or {})
        captions = dict(meta.get("captions") or {})
        captions.update(patch)
        captions["updated_at"] = _now()
        meta["captions"] = captions
        activity.extra_metadata = meta
        flag_modified(activity, "extra_metadata")
        db.add(activity)
        await db.commit()


async def _set_lang_status(activity_uuid: str, code: str, status: str) -> None:
    """Update one target language's status in-place (keeps the rest untouched)."""
    async with _async_session_factory() as db:
        activity = (
            await db.execute(select(Activity).where(Activity.activity_uuid == activity_uuid))
        ).scalars().first()
        if not activity:
            return
        meta = dict(activity.extra_metadata or {})
        captions = dict(meta.get("captions") or {})
        langs = [dict(x) for x in (captions.get("languages") or [])]
        for lang in langs:
            if lang.get("code") == code:
                lang["status"] = status
        captions["languages"] = langs
        captions["updated_at"] = _now()
        meta["captions"] = captions
        activity.extra_metadata = meta
        flag_modified(activity, "extra_metadata")
        db.add(activity)
        await db.commit()


# --------------------------------------------------------------------------
# enqueue
# --------------------------------------------------------------------------

def enqueue(activity_uuid: str) -> None:
    """Queue an activity for caption generation (fire-and-forget). Callers gate on
    the org's AI feature + credits before enqueuing."""
    client = get_redis_client()
    if not client:
        logger.warning("Captions: no Redis; cannot enqueue %s", activity_uuid)
        return
    try:
        client.rpush(REDIS_QUEUE_KEY, activity_uuid)
    except Exception as e:
        logger.warning("Captions: could not enqueue %s: %s", activity_uuid, e)


# --------------------------------------------------------------------------
# The job
# --------------------------------------------------------------------------

async def _resolve(activity_uuid: str) -> Optional[dict]:
    """Return {org_id, org_uuid, course_uuid, filename, captions} for a hosted video."""
    async with _async_session_factory() as db:
        a = (
            await db.execute(select(Activity).where(Activity.activity_uuid == activity_uuid))
        ).scalars().first()
        if not a or a.activity_sub_type != ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED:
            return None
        filename = (a.content or {}).get("filename")
        captions = (a.extra_metadata or {}).get("captions") or {}
        if not filename or not captions.get("enabled"):
            return None
        org = (await db.execute(select(Organization).where(Organization.id == a.org_id))).scalars().first()
        course = (await db.execute(select(Course).where(Course.id == a.course_id))).scalars().first()
        if not org or not course:
            return None
        return {
            "org_id": a.org_id,
            "org_uuid": org.org_uuid,
            "course_uuid": course.course_uuid,
            "filename": filename,
            "captions": captions,
        }


async def generate_activity_captions(activity_uuid: str) -> bool:
    """Full caption job: transcribe + translate + upload. Returns True on (partial)
    success. Never raises for expected failures — records status instead."""
    info = await _resolve(activity_uuid)
    if not info:
        logger.warning("Captions: nothing to generate for %s", activity_uuid)
        return False

    org_id = info["org_id"]
    base = (
        f"content/orgs/{info['org_uuid']}/courses/{info['course_uuid']}"
        f"/activities/{activity_uuid}/video"
    )
    src_key = f"{base}/{info['filename']}"
    captions_prefix = f"{base}/captions"
    cfg = info["captions"]
    source_language = cfg.get("source_language") or "auto"
    targets = [dict(x) for x in (cfg.get("languages") or []) if x.get("code")]
    if not targets:
        await _patch_captions(activity_uuid, status="failed", error="no_languages")
        return False

    await _patch_captions(activity_uuid, status="processing", error=None)

    # Credit metering + generation are deferred to the LLM layer; import lazily.
    from src.security.features_utils.usage import (
        check_feature_enabled,
        refund_ai_credit,
        reserve_ai_credit,
    )
    from src.services.ai.llm import model_for_tier

    model_name = model_for_tier("standard")
    reserved = 0
    try:
        with tempfile.TemporaryDirectory() as td:
            # 1. Download source video + extract audio.
            local_src = os.path.join(td, os.path.basename(info["filename"]))
            if not await asyncio.to_thread(_fetch_source, src_key, local_src):
                await _patch_captions(activity_uuid, status="failed", error="source_unavailable")
                return False
            audio_dir = os.path.join(td, "audio")
            os.makedirs(audio_dir, exist_ok=True)
            chunks = await cap.extract_audio_chunks(local_src, audio_dir)
            if not chunks:
                await _patch_captions(activity_uuid, status="failed", error="audio_extract_failed")
                return False
            duration = await cap.probe_duration(local_src)

            # 2. Credit gate (feature + atomic reserve). Cost scales with duration
            #    + number of languages that need a real translation.
            need_translation = [
                t for t in targets
                if not (source_language != "auto" and t["code"] == source_language)
            ]
            cost = cap.estimate_credits(duration, len(need_translation))
            async with _async_session_factory() as db:
                await check_feature_enabled("ai", org_id, db)
                await reserve_ai_credit(org_id, db, amount=cost)
            reserved = cost

            # 3. Transcribe once (source language).
            source_vtt = await cap.transcribe_to_vtt(chunks, model_name, source_language)

            # 4. Produce a VTT per target language (translate unless it IS the source).
            out_dir = os.path.join(td, "captions")
            os.makedirs(out_dir, exist_ok=True)
            done = 0
            for t in targets:
                code = t["code"]
                await _set_lang_status(activity_uuid, code, "processing")
                try:
                    if source_language != "auto" and code == source_language:
                        vtt = source_vtt
                    else:
                        vtt = await cap.translate_vtt(source_vtt, t.get("label") or code, model_name)
                    with open(os.path.join(out_dir, f"{code}.vtt"), "w", encoding="utf-8") as f:
                        f.write(vtt)
                    await _set_lang_status(activity_uuid, code, "ready")
                    done += 1
                except Exception as e:  # one language failing must not sink the rest
                    logger.error("Captions: %s lang %s failed: %s", activity_uuid, code, e)
                    await _set_lang_status(activity_uuid, code, "failed")

            if done == 0:
                await _patch_captions(activity_uuid, status="failed", error="all_languages_failed")
                if reserved:
                    refund_ai_credit(org_id, amount=reserved)
                return False

            # 5. Upload the produced VTTs to R2 (or copy locally in filesystem mode).
            if is_s3_enabled():
                ok = await asyncio.to_thread(upload_directory_to_s3, out_dir, captions_prefix)
            else:
                import shutil
                await asyncio.to_thread(shutil.copytree, out_dir, captions_prefix, dirs_exist_ok=True)
                ok = True
            if not ok:
                await _patch_captions(activity_uuid, status="failed", error="upload_failed")
                if reserved:
                    refund_ai_credit(org_id, amount=reserved)
                return False

        await _patch_captions(
            activity_uuid,
            status="ready" if done == len(targets) else "partial",
            error=None,
        )
        logger.info("Captions ready for %s (%s/%s langs)", activity_uuid, done, len(targets))
        return True
    except HTTPException as e:
        # e.g. AI disabled or quota exceeded (reserve raises 403) — do NOT refund
        # (nothing was reserved on a 403), record a clear status.
        detail = getattr(e, "detail", "ai_error")
        await _patch_captions(activity_uuid, status="failed", error=str(detail)[:200])
        return False
    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.error("Captions job crashed for %s: %s", activity_uuid, e)
        await _patch_captions(activity_uuid, status="failed", error="exception")
        if reserved:
            refund_ai_credit(org_id, amount=reserved)
        return False


# --------------------------------------------------------------------------
# In-app consumer + reaper (mirrors hls_jobs)
# --------------------------------------------------------------------------

async def _consumer_loop(poll_seconds: int = CONSUMER_POLL_SECONDS) -> None:
    client = get_redis_client()
    if not client:
        logger.warning("Captions consumer: Redis unavailable; not started")
        return
    sem = asyncio.Semaphore(concurrency())
    logger.info("Captions in-app consumer started (concurrency=%s)", concurrency())

    async def _run(uuid: str) -> None:
        _inflight.add(uuid)
        try:
            await asyncio.wait_for(generate_activity_captions(uuid), timeout=JOB_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            logger.error("Captions: job %s exceeded %ss — marking failed", uuid, JOB_TIMEOUT_SECONDS)
            try:
                await _patch_captions(uuid, status="failed", error="timeout")
            except Exception:
                pass
        except asyncio.CancelledError:
            try:
                client.rpush(REDIS_QUEUE_KEY, uuid)
            except Exception:
                pass
            raise
        except Exception as e:
            logger.error("Captions consumer: job %s failed: %s", uuid, e)
        finally:
            _inflight.discard(uuid)
            sem.release()

    # A single failed poll means nothing — Redis read timeouts happen on an idle
    # connection and the next poll reconnects. Only a *run* of failures means
    # Redis is actually down.
    poll_failures = 0

    while True:
        await sem.acquire()
        try:
            item = await asyncio.to_thread(client.lpop, REDIS_QUEUE_KEY)
            poll_failures = 0
        except asyncio.CancelledError:
            sem.release()
            raise
        except Exception as e:
            poll_failures += 1
            log = logger.error if poll_failures >= CONSECUTIVE_POLL_FAILURES_BEFORE_ERROR else logger.warning
            log("Captions consumer: poll error (%s in a row): %s", poll_failures, e)
            sem.release()
            await asyncio.sleep(poll_seconds)
            continue
        if not item:
            sem.release()
            await asyncio.sleep(poll_seconds)
            continue
        activity_uuid = item.decode() if isinstance(item, (bytes, bytearray)) else item
        task = asyncio.create_task(_run(activity_uuid))
        _children.add(task)
        task.add_done_callback(_children.discard)


async def _requeue_stale_processing(stale_after: int = STALE_PROCESSING_SECONDS) -> int:
    client = get_redis_client()
    if not client:
        return 0
    now = datetime.now(timezone.utc)
    requeued = 0
    async with _async_session_factory() as db:
        rows = (await db.execute(
            select(Activity).where(
                Activity.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED
            )
        )).scalars().all()
        for a in rows:
            captions = (a.extra_metadata or {}).get("captions") or {}
            if captions.get("status") != "processing":
                continue
            ts = captions.get("updated_at")
            try:
                age = (now - datetime.fromisoformat(ts)).total_seconds() if ts else 1e9
            except (TypeError, ValueError):
                age = 1e9
            if age >= stale_after:
                meta = dict(a.extra_metadata or {})
                meta["captions"] = {**captions, "status": "queued", "updated_at": now.isoformat()}
                a.extra_metadata = meta
                flag_modified(a, "extra_metadata")
                db.add(a)
                await db.commit()
                try:
                    client.rpush(REDIS_QUEUE_KEY, a.activity_uuid)
                    requeued += 1
                except Exception:
                    pass
    if requeued:
        logger.info("Captions reaper: re-enqueued %s stale job(s)", requeued)
    return requeued


async def _reaper_loop(interval: int = REAPER_INTERVAL_SECONDS) -> None:
    failures = 0
    while True:
        await asyncio.sleep(interval)
        try:
            await _requeue_stale_processing()
            failures = 0
        except asyncio.CancelledError:
            raise
        except Exception as e:
            failures += 1
            log = logger.error if failures >= CONSECUTIVE_POLL_FAILURES_BEFORE_ERROR else logger.warning
            log("Captions reaper error (%s in a row): %s", failures, e)


def start_consumer() -> None:
    """Start the captions consumer + reaper (call from app startup). No-op when
    Redis is unavailable; otherwise idle (cheap poll) until an instructor enables
    captions on a video. Work is only ever created via the AI-gated config
    endpoint, so no separate feature flag is needed."""
    global _consumer_task, _reaper_task
    if not get_redis_client():
        return
    if not (_consumer_task and not _consumer_task.done()):
        _consumer_task = asyncio.create_task(_consumer_loop())
    if not (_reaper_task and not _reaper_task.done()):
        _reaper_task = asyncio.create_task(_reaper_loop())


async def stop_consumer() -> None:
    global _consumer_task, _reaper_task
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
    if _children:
        await asyncio.gather(*list(_children), return_exceptions=True)
