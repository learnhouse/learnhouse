"""Tests for src/services/utils/caption_jobs.py (AI caption pipeline)."""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.services.utils import caption_jobs as cj


class _FactoryCtx:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *exc):
        return False


def _bind_session(monkeypatch, session):
    monkeypatch.setattr(cj, "_async_session_factory", lambda: _FactoryCtx(session))


async def _add_caption_activity(db, org, course, uuid, *, filename="v.mp4", captions=None):
    a = Activity(
        name="V",
        activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
        content={"filename": filename} if filename else {},
        published=True,
        org_id=org.id,
        course_id=course.id,
        activity_uuid=uuid,
        extra_metadata={"captions": captions} if captions else None,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    return a


# --- concurrency / enqueue -------------------------------------------------

def test_concurrency_parsing(monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_CAPTIONS_CONCURRENCY", "4")
    assert cj.concurrency() == 4
    monkeypatch.setenv("LEARNHOUSE_CAPTIONS_CONCURRENCY", "bad")
    assert cj.concurrency() == 1


def test_enqueue_pushes(monkeypatch):
    pushed = []

    class _R:
        def rpush(self, key, val):
            pushed.append((key, val))

    monkeypatch.setattr(cj, "get_redis_client", lambda: _R())
    cj.enqueue("act1")
    assert pushed == [(cj.REDIS_QUEUE_KEY, "act1")]


def test_enqueue_no_redis(monkeypatch):
    monkeypatch.setattr(cj, "get_redis_client", lambda: None)
    cj.enqueue("act1")  # warns, no raise


# --- consumer --------------------------------------------------------------

async def test_consumer_drains_and_survives_errors(monkeypatch):
    processed = []
    seq = iter([b"a1", b"a2"])

    class _R:
        def lpop(self, key):
            try:
                return next(seq)
            except StopIteration:
                raise asyncio.CancelledError()

    monkeypatch.setattr(cj, "get_redis_client", lambda: _R())

    async def _gen(uuid):
        processed.append(uuid)
        if uuid == "a1":
            raise RuntimeError("boom")
        return True

    monkeypatch.setattr(cj, "generate_activity_captions", _gen)
    with pytest.raises(asyncio.CancelledError):
        await cj._consumer_loop(poll_seconds=0)
    for _ in range(5):
        await asyncio.sleep(0)
    assert set(processed) == {"a1", "a2"}


async def test_consumer_job_timeout(monkeypatch):
    monkeypatch.setattr(cj, "JOB_TIMEOUT_SECONDS", 0.01)
    seq = iter([b"slow"])

    class _R:
        def lpop(self, key):
            try:
                return next(seq)
            except StopIteration:
                raise asyncio.CancelledError()

        def rpush(self, *a):
            pass

    monkeypatch.setattr(cj, "get_redis_client", lambda: _R())

    async def _slow(uuid):
        await asyncio.sleep(10)

    monkeypatch.setattr(cj, "generate_activity_captions", _slow)
    status = []

    async def _cap(uuid, **k):
        status.append(k)

    monkeypatch.setattr(cj, "_patch_captions", _cap)
    with pytest.raises(asyncio.CancelledError):
        await cj._consumer_loop(poll_seconds=0)
    await asyncio.sleep(0.05)
    for _ in range(10):
        await asyncio.sleep(0)
    assert any(k.get("status") == "failed" and k.get("error") == "timeout" for k in status)


async def test_consumer_empty_poll_then_cancel(monkeypatch):
    seq = iter([None])

    class _R:
        def lpop(self, key):
            v = next(seq, "STOP")
            if v == "STOP":
                raise asyncio.CancelledError()
            return v

    monkeypatch.setattr(cj, "get_redis_client", lambda: _R())
    with pytest.raises(asyncio.CancelledError):
        await cj._consumer_loop(poll_seconds=0)


async def test_consumer_no_redis_returns(monkeypatch):
    monkeypatch.setattr(cj, "get_redis_client", lambda: None)
    await cj._consumer_loop()


def test_start_consumer_noop_without_redis(monkeypatch):
    monkeypatch.setattr(cj, "get_redis_client", lambda: None)
    cj._consumer_task = None
    cj._reaper_task = None
    cj.start_consumer()
    assert cj._consumer_task is None


async def test_reaper_calls_requeue_and_survives(monkeypatch):
    calls = {"n": 0}

    async def _req():
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("x")
        raise asyncio.CancelledError()

    monkeypatch.setattr(cj, "_requeue_stale_processing", _req)
    with pytest.raises(asyncio.CancelledError):
        await cj._reaper_loop(interval=0)
    assert calls["n"] == 2


async def test_stop_consumer_reenqueues_inflight(monkeypatch):
    pushed = []

    class _R:
        def rpush(self, k, v):
            pushed.append(v)

    monkeypatch.setattr(cj, "get_redis_client", lambda: _R())
    cj._inflight.clear()
    cj._inflight.add("busy")

    async def _idle():
        await asyncio.sleep(3600)

    cj._consumer_task = asyncio.create_task(_idle())
    cj._reaper_task = asyncio.create_task(_idle())
    await asyncio.sleep(0)
    await cj.stop_consumer()
    assert "busy" in pushed
    assert cj._consumer_task is None and cj._reaper_task is None
    cj._inflight.clear()


# --- requeue stale ---------------------------------------------------------

async def test_requeue_stale_processing(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    old = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    await _add_caption_activity(db, org, course, "stale", captions={"status": "processing", "updated_at": old})
    await _add_caption_activity(db, org, course, "fresh", captions={"status": "processing", "updated_at": datetime.now(timezone.utc).isoformat()})
    await _add_caption_activity(db, org, course, "ready1", captions={"status": "ready"})
    pushed = []

    class _R:
        def rpush(self, k, v):
            pushed.append(v)

    monkeypatch.setattr(cj, "get_redis_client", lambda: _R())
    n = await cj._requeue_stale_processing(stale_after=1200)
    assert n == 1 and pushed == ["stale"]


async def test_requeue_stale_no_redis(monkeypatch):
    monkeypatch.setattr(cj, "get_redis_client", lambda: None)
    assert await cj._requeue_stale_processing() == 0


# --- generate_activity_captions (mocked engine + credits) ------------------

def _mock_engine(monkeypatch):
    async def _chunks(src, out):
        return ["a.mp3"]

    async def _dur(src):
        return 60.0

    async def _tvtt(chunks, model, source_language=None):
        return "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n"

    async def _trans(vtt, label, model):
        return "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nBonjour\n"

    monkeypatch.setattr(cj.cap, "extract_audio_chunks", _chunks)
    monkeypatch.setattr(cj.cap, "probe_duration", _dur)
    monkeypatch.setattr(cj.cap, "transcribe_to_vtt", _tvtt)
    monkeypatch.setattr(cj.cap, "translate_vtt", _trans)
    monkeypatch.setattr(cj, "_fetch_source", lambda key, path: True)
    monkeypatch.setattr(cj, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(cj, "upload_directory_to_s3", lambda d, p: True)

    import src.security.features_utils.usage as usage
    import src.services.ai.llm as llm

    async def _feat(*a, **k):
        return True

    async def _reserve(*a, **k):
        return 1

    monkeypatch.setattr(usage, "check_feature_enabled", _feat)
    monkeypatch.setattr(usage, "reserve_ai_credit", _reserve)
    monkeypatch.setattr(usage, "refund_ai_credit", lambda *a, **k: 0)
    monkeypatch.setattr(llm, "model_for_tier", lambda tier: "gemini-standard")


async def test_generate_captions_success(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    _mock_engine(monkeypatch)
    await _add_caption_activity(
        db, org, course, "capA",
        captions={"enabled": True, "source_language": "auto",
                  "languages": [{"code": "fr", "label": "French", "status": "queued"}]},
    )
    ok = await cj.generate_activity_captions("capA")
    assert ok is True


async def test_generate_captions_disabled_activity(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_caption_activity(db, org, course, "capOff", captions={"enabled": False, "languages": []})
    assert await cj.generate_activity_captions("capOff") is False


async def test_generate_captions_audio_failure(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    _mock_engine(monkeypatch)

    async def _no_audio(src, out):
        return []

    monkeypatch.setattr(cj.cap, "extract_audio_chunks", _no_audio)
    await _add_caption_activity(
        db, org, course, "capB",
        captions={"enabled": True, "source_language": "auto",
                  "languages": [{"code": "fr", "label": "French", "status": "queued"}]},
    )
    assert await cj.generate_activity_captions("capB") is False
