"""Failure and recovery paths of src/services/utils/caption_jobs.py.

Each test drives one way a caption job can go wrong (missing rows, no usable
languages, storage or AI errors, cancellation, Redis hiccups) and checks the
status that gets recorded, whether credits are refunded, and whether the job
is re-queued. Redis, storage, credits and the transcription engine are mocked.
"""

import asyncio
import logging
import os
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.services.utils import caption_jobs as cj

SOURCE_VTT = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n"


class _FactoryCtx:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *exc):
        return False


@pytest.fixture
def bound(monkeypatch, db):
    """Route the job's own sessions to the test database."""
    monkeypatch.setattr(cj, "_async_session_factory", lambda: _FactoryCtx(db))
    return db


@pytest.fixture
def engine_mocks(monkeypatch):
    """Mock the engine, storage and credit calls; return the call recorders."""
    rec = {"refunds": [], "reserved": [], "uploads": []}

    async def _chunks(src, out):
        return ["a.mp3"]

    async def _dur(src):
        return 60.0

    async def _tvtt(chunks, model, source_language=None):
        return SOURCE_VTT

    async def _trans(vtt, label, model):
        return f"WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n[{label}]\n"

    async def _reserve(org_id, db_session, amount=1):
        rec["reserved"].append(amount)
        return 1

    async def _no_transcript(media):
        return None

    monkeypatch.setattr(cj.cap, "extract_audio_chunks", _chunks)
    monkeypatch.setattr(cj.cap, "probe_duration", _dur)
    monkeypatch.setattr(cj.cap, "transcribe_to_vtt", _tvtt)
    monkeypatch.setattr(cj.cap, "translate_vtt", _trans)
    monkeypatch.setattr(cj.cap, "estimate_credits", lambda duration, n: 3)
    monkeypatch.setattr(cj, "read_transcript", _no_transcript)
    monkeypatch.setattr(cj, "_fetch_source", lambda key, path: True)
    monkeypatch.setattr(cj, "is_s3_enabled", lambda: True)

    def _upload(d, prefix):
        rec["uploads"].append((sorted(os.listdir(d)), prefix))
        return True

    monkeypatch.setattr(cj, "upload_directory_to_s3", _upload)
    monkeypatch.setattr(cj, "index_activity", lambda *a, **k: None)

    import src.security.features_utils.usage as usage
    import src.services.ai.llm as llm
    import src.services.utils.chapter_jobs as chapter_jobs

    monkeypatch.setattr(usage, "check_feature_enabled", AsyncMock(return_value=True))
    monkeypatch.setattr(usage, "reserve_ai_credit", _reserve)
    monkeypatch.setattr(usage, "refund_ai_credit", lambda org_id, amount=1: rec["refunds"].append(amount))
    monkeypatch.setattr(llm, "model_for_tier", lambda tier: "gemini-standard")
    monkeypatch.setattr(chapter_jobs, "generate_activity_chapters", AsyncMock(return_value=True))
    return rec


async def _add(db, org, course, uuid, *, captions=None, org_id=None, course_id=None,
               sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED):
    a = Activity(
        name="V",
        activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=sub_type,
        content={"filename": "v.mp4"},
        published=True,
        org_id=org_id if org_id is not None else org.id,
        course_id=course_id if course_id is not None else course.id,
        activity_uuid=uuid,
        extra_metadata={"captions": captions} if captions else None,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    return a


def _enabled(*codes):
    return {
        "enabled": True,
        "source_language": "auto",
        "languages": [{"code": c, "label": c.upper(), "status": "queued"} for c in codes],
    }


async def _captions(db, uuid) -> dict:
    db.expire_all()
    a = (await db.execute(select(Activity).where(Activity.activity_uuid == uuid))).scalars().first()
    return (a.extra_metadata or {}).get("captions") or {}


# ---------------------------------------------------------------------------
# Status writers and resolution
# ---------------------------------------------------------------------------


async def test_status_writers_ignore_unknown_activity(bound, org):
    """A job for a deleted activity must not crash or create anything."""
    await cj._patch_captions("activity_gone", status="failed")
    await cj._set_lang_status("activity_gone", "fr", "ready")
    rows = (await bound.execute(select(Activity))).scalars().all()
    assert rows == []


async def test_resolve_rejects_unknown_non_hosted_and_orphaned(bound, org, course):
    await _add(bound, org, course, "yt", captions=_enabled("fr"),
               sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE)
    await _add(bound, org, course, "orphan_org", captions=_enabled("fr"), org_id=999)
    await _add(bound, org, course, "orphan_course", captions=_enabled("fr"), course_id=999)
    await _add(bound, org, course, "good", captions=_enabled("fr"))

    assert await cj._resolve("missing") is None
    assert await cj._resolve("yt") is None
    assert await cj._resolve("orphan_org") is None
    assert await cj._resolve("orphan_course") is None
    info = await cj._resolve("good")
    assert info["org_uuid"] == org.org_uuid and info["course_uuid"] == course.course_uuid


def test_enqueue_swallows_redis_errors(monkeypatch, caplog):
    client = MagicMock()
    client.set.side_effect = ConnectionError("redis down")
    monkeypatch.setattr(cj, "get_redis_client", lambda: client)
    with caplog.at_level(logging.WARNING, logger=cj.__name__):
        cj.enqueue("act1")
    client.rpush.assert_not_called()
    assert "could not enqueue act1" in caplog.text


# ---------------------------------------------------------------------------
# generate_activity_captions failure outcomes
# ---------------------------------------------------------------------------


async def test_generate_without_valid_languages_fails_fast(bound, org, course, engine_mocks):
    await _add(bound, org, course, "nolangs", captions={
        "enabled": True, "languages": [{"code": "../etc"}, "fr"],
    })
    assert await cj.generate_activity_captions("nolangs") is False
    cap = await _captions(bound, "nolangs")
    assert cap["status"] == "failed" and cap["error"] == "no_languages"
    assert engine_mocks["reserved"] == []


async def test_generate_source_unavailable(bound, org, course, engine_mocks, monkeypatch):
    monkeypatch.setattr(cj, "_fetch_source", lambda key, path: False)
    await _add(bound, org, course, "nosrc", captions=_enabled("fr"))
    assert await cj.generate_activity_captions("nosrc") is False
    cap = await _captions(bound, "nosrc")
    assert cap["error"] == "source_unavailable"
    assert engine_mocks["reserved"] == []


async def test_generate_one_language_failing_gives_partial(bound, org, course, engine_mocks, monkeypatch):
    """One failed translation must not sink the others; status is 'partial'."""
    async def _trans(vtt, label, model):
        if label == "DE":
            raise RuntimeError("model refused")
        return SOURCE_VTT

    monkeypatch.setattr(cj.cap, "translate_vtt", _trans)
    await _add(bound, org, course, "partial", captions=_enabled("fr", "de"))
    assert await cj.generate_activity_captions("partial") is True
    cap = await _captions(bound, "partial")
    assert cap["status"] == "partial"
    assert {lang["code"]: lang["status"] for lang in cap["languages"]} == {"fr": "ready", "de": "failed"}
    assert engine_mocks["uploads"][0][0] == ["fr.vtt"]
    assert engine_mocks["refunds"] == []


async def test_generate_source_language_track_reuses_transcript(bound, org, course, engine_mocks, monkeypatch):
    """The track in the spoken language is the transcript itself, not a translation."""
    translated = []

    async def _trans(vtt, label, model):
        translated.append(label)
        return vtt

    monkeypatch.setattr(cj.cap, "translate_vtt", _trans)
    await _add(bound, org, course, "srclang", captions={**_enabled("en", "fr"), "source_language": "en"})
    assert await cj.generate_activity_captions("srclang") is True
    assert translated == ["FR"]
    assert (await _captions(bound, "srclang"))["status"] == "ready"


async def test_generate_all_languages_failing_refunds(bound, org, course, engine_mocks, monkeypatch):
    async def _trans(vtt, label, model):
        raise RuntimeError("model down")

    monkeypatch.setattr(cj.cap, "translate_vtt", _trans)
    await _add(bound, org, course, "allfail", captions=_enabled("fr", "de"))
    assert await cj.generate_activity_captions("allfail") is False
    cap = await _captions(bound, "allfail")
    assert cap["error"] == "all_languages_failed"
    assert engine_mocks["reserved"] == [3]
    assert engine_mocks["refunds"] == [3]
    assert engine_mocks["uploads"] == []


async def test_generate_upload_failure_refunds(bound, org, course, engine_mocks, monkeypatch):
    monkeypatch.setattr(cj, "upload_directory_to_s3", lambda d, p: False)
    await _add(bound, org, course, "upfail", captions=_enabled("fr"))
    assert await cj.generate_activity_captions("upfail") is False
    assert (await _captions(bound, "upfail"))["error"] == "upload_failed"
    assert engine_mocks["refunds"] == [3]


async def test_generate_filesystem_mode_copies_vtts(bound, org, course, engine_mocks, monkeypatch, tmp_path):
    """Without S3 the VTTs are copied under the local content tree."""
    monkeypatch.setattr(cj, "is_s3_enabled", lambda: False)
    monkeypatch.chdir(tmp_path)
    await _add(bound, org, course, "localfs", captions=_enabled("fr"))
    assert await cj.generate_activity_captions("localfs") is True
    out = tmp_path / (
        f"content/orgs/{org.org_uuid}/courses/{course.course_uuid}/activities/localfs/video/captions/fr.vtt"
    )
    assert out.read_text(encoding="utf-8").startswith("WEBVTT")
    assert (await _captions(bound, "localfs"))["status"] == "ready"
    assert engine_mocks["uploads"] == []


async def test_generate_http_error_records_detail_without_refund(bound, org, course, engine_mocks, monkeypatch):
    """A 403 from the credit gate means nothing was reserved: no refund."""
    import src.security.features_utils.usage as usage

    async def _deny(org_id, db_session, amount=1):
        raise HTTPException(status_code=403, detail="AI credits exhausted")

    monkeypatch.setattr(usage, "reserve_ai_credit", _deny)
    await _add(bound, org, course, "denied", captions=_enabled("fr"))
    assert await cj.generate_activity_captions("denied") is False
    cap = await _captions(bound, "denied")
    assert cap["status"] == "failed" and cap["error"] == "AI credits exhausted"
    assert engine_mocks["refunds"] == []


async def test_generate_crash_after_reserve_refunds(bound, org, course, engine_mocks, monkeypatch):
    async def _boom(*a, **k):
        raise RuntimeError("transcriber crashed")

    monkeypatch.setattr(cj.cap, "transcribe_to_vtt", _boom)
    await _add(bound, org, course, "crash", captions=_enabled("fr"))
    assert await cj.generate_activity_captions("crash") is False
    assert (await _captions(bound, "crash"))["error"] == "exception"
    assert engine_mocks["refunds"] == [3]


async def test_generate_crash_before_reserve_does_not_refund(bound, org, course, engine_mocks, monkeypatch):
    async def _boom(src, out):
        raise RuntimeError("ffmpeg missing")

    monkeypatch.setattr(cj.cap, "extract_audio_chunks", _boom)
    await _add(bound, org, course, "crash0", captions=_enabled("fr"))
    assert await cj.generate_activity_captions("crash0") is False
    assert (await _captions(bound, "crash0"))["error"] == "exception"
    assert engine_mocks["refunds"] == []


async def test_generate_propagates_cancellation(bound, org, course, engine_mocks, monkeypatch):
    """Shutdown cancels jobs; the consumer re-queues them, so the job must not
    swallow the cancellation as a failure."""
    async def _cancel(*a, **k):
        raise asyncio.CancelledError()

    monkeypatch.setattr(cj.cap, "transcribe_to_vtt", _cancel)
    await _add(bound, org, course, "cancel", captions=_enabled("fr"))
    with pytest.raises(asyncio.CancelledError):
        await cj.generate_activity_captions("cancel")
    assert (await _captions(bound, "cancel"))["status"] == "processing"


# ---------------------------------------------------------------------------
# Consumer loop
# ---------------------------------------------------------------------------


class _Redis:
    """lpop serves `items`, then raises CancelledError to stop the loop."""

    def __init__(self, items, *, rpush_error=None):
        self.items = list(items)
        self.pushed = []
        self.deleted = []
        self.rpush_error = rpush_error

    def lpop(self, key):
        if not self.items:
            raise asyncio.CancelledError()
        item = self.items.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def rpush(self, key, val):
        if self.rpush_error:
            raise self.rpush_error
        self.pushed.append(val)

    def delete(self, key):
        self.deleted.append(key)


async def _drain_children():
    if cj._children:
        await asyncio.gather(*list(cj._children), return_exceptions=True)


async def test_consumer_timeout_survives_status_write_failure(monkeypatch):
    monkeypatch.setattr(cj, "JOB_TIMEOUT_SECONDS", 0.01)
    r = _Redis([b"slow"])
    monkeypatch.setattr(cj, "get_redis_client", lambda: r)

    async def _slow(uuid):
        await asyncio.sleep(10)

    async def _db_down(uuid, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(cj, "generate_activity_captions", _slow)
    monkeypatch.setattr(cj, "_patch_captions", _db_down)
    loop = asyncio.create_task(cj._consumer_loop(poll_seconds=0))
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(loop, timeout=5)
    await _drain_children()
    assert r.deleted == [f"{cj.QUEUED_MARKER_PREFIX}slow"]
    assert "slow" not in cj._inflight


@pytest.mark.parametrize("rpush_error", [None, ConnectionError("redis down")])
async def test_consumer_requeues_cancelled_job(monkeypatch, rpush_error):
    """A job cancelled mid-run goes back on the queue and keeps its marker; if
    the re-push fails, the marker is cleared so a later save can re-queue."""
    r = _Redis([b"job1"], rpush_error=rpush_error)
    monkeypatch.setattr(cj, "get_redis_client", lambda: r)
    started = asyncio.Event()

    async def _hang(uuid):
        started.set()
        await asyncio.sleep(3600)

    monkeypatch.setattr(cj, "generate_activity_captions", _hang)
    loop = asyncio.create_task(cj._consumer_loop(poll_seconds=0))
    await asyncio.wait_for(started.wait(), timeout=5)
    assert "job1" in cj._inflight
    for child in list(cj._children):
        child.cancel()
    await _drain_children()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(loop, timeout=5)

    if rpush_error is None:
        assert r.pushed == ["job1"]
        assert r.deleted == []
    else:
        assert r.pushed == []
        assert r.deleted == [f"{cj.QUEUED_MARKER_PREFIX}job1"]
    assert "job1" not in cj._inflight


async def test_consumer_escalates_repeated_poll_errors(monkeypatch, caplog):
    """Isolated poll errors are warnings; a run of them is logged as an error."""
    r = _Redis([ConnectionError("t1"), ConnectionError("t2"), ConnectionError("t3")])
    monkeypatch.setattr(cj, "get_redis_client", lambda: r)
    with caplog.at_level(logging.WARNING, logger=cj.__name__):
        with pytest.raises(asyncio.CancelledError):
            await cj._consumer_loop(poll_seconds=0)
    levels = [rec.levelno for rec in caplog.records if "poll error" in rec.getMessage()]
    assert levels == [logging.WARNING, logging.WARNING, logging.ERROR]


# ---------------------------------------------------------------------------
# Reaper
# ---------------------------------------------------------------------------


async def test_requeue_treats_bad_timestamp_as_stale_and_survives_rpush_error(bound, org, course, monkeypatch):
    await _add(bound, org, course, "badts", captions={"status": "processing", "updated_at": "yesterday-ish"})
    r = _Redis([], rpush_error=ConnectionError("redis down"))
    monkeypatch.setattr(cj, "get_redis_client", lambda: r)
    assert await cj._requeue_stale_processing() == 0
    # The row is still flipped back to queued, so the next pass can pick it up.
    assert (await _captions(bound, "badts"))["status"] == "queued"


async def test_reaper_success_resets_failure_streak(monkeypatch, caplog):
    outcomes = [RuntimeError("a"), RuntimeError("b"), 0, RuntimeError("c"), RuntimeError("d")]

    async def _req():
        if not outcomes:
            raise asyncio.CancelledError()
        o = outcomes.pop(0)
        if isinstance(o, Exception):
            raise o
        return o

    monkeypatch.setattr(cj, "_requeue_stale_processing", _req)
    with caplog.at_level(logging.WARNING, logger=cj.__name__):
        with pytest.raises(asyncio.CancelledError):
            await cj._reaper_loop(interval=0)
    reaper = [rec for rec in caplog.records if "reaper error" in rec.getMessage()]
    assert len(reaper) == 4
    assert all(rec.levelno == logging.WARNING for rec in reaper)


# ---------------------------------------------------------------------------
# Shutdown
# ---------------------------------------------------------------------------


async def test_stop_consumer_tolerates_rpush_error_and_awaits_children(monkeypatch):
    r = _Redis([], rpush_error=ConnectionError("redis down"))
    monkeypatch.setattr(cj, "get_redis_client", lambda: r)
    monkeypatch.setattr(cj, "_consumer_task", None)
    monkeypatch.setattr(cj, "_reaper_task", None)
    monkeypatch.setattr(cj, "_inflight", {"busy"})
    finished = []

    async def _child():
        await asyncio.sleep(0)
        finished.append(True)
        raise RuntimeError("job failed during shutdown")

    child = asyncio.create_task(_child())
    monkeypatch.setattr(cj, "_children", {child})
    await cj.stop_consumer()
    assert finished == [True]
    assert child.done()
