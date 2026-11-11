"""Failure-tolerance tests for src/services/utils/hls_jobs.py.

The HLS job/consumer code treats Redis as best-effort: a flaky lease write,
retry-counter delete or re-enqueue must never fail a transcode or crash the
consumer. These tests drive those swallowed-error branches plus a few
missing-row guards. Redis, storage and ffmpeg are all faked.
"""

import asyncio
from datetime import datetime

import pytest

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.services.utils import hls_jobs


class _FactoryCtx:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *exc):
        return False


def _bind_session(monkeypatch, session):
    monkeypatch.setattr(hls_jobs, "_async_session_factory", lambda: _FactoryCtx(session))


def _aret(value):
    async def _f(*a, **k):
        return value
    return _f


class _BrokenRedis:
    """Every write raises, as if Redis dropped mid-job."""

    def __init__(self):
        self.calls = []

    def set(self, *a, **k):
        self.calls.append("set")
        raise ConnectionError("redis down")

    def delete(self, *a):
        self.calls.append("delete")
        raise ConnectionError("redis down")

    def rpush(self, *a):
        self.calls.append("rpush")
        raise ConnectionError("redis down")


@pytest.fixture(autouse=True)
def _clean_consumer_state():
    hls_jobs._inflight.clear()
    yield
    hls_jobs._inflight.clear()


# --------------------------------------------------------------------------
# Missing-row guards
# --------------------------------------------------------------------------

async def test_set_status_on_missing_activity_is_noop(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    before = activity.extra_metadata

    assert await hls_jobs._set_status("does-not-exist", "processing") is None

    refreshed = await db.get(Activity, activity.id)
    assert refreshed.extra_metadata == before


async def test_resolve_source_returns_none_when_course_missing(monkeypatch, db, org):
    """A hosted-video activity whose course row is gone can't be keyed in
    storage, so it must not be transcoded."""
    _bind_session(monkeypatch, db)
    db.add(Activity(
        name="Orphan",
        activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
        content={"filename": "v.mp4"},
        published=True,
        org_id=org.id,
        course_id=987654,  # no such course
        activity_uuid="activity_orphan",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    ))
    await db.commit()

    assert await hls_jobs._resolve_source("activity_orphan") is None


# --------------------------------------------------------------------------
# transcode_activity / transcode_block with a failing Redis
# --------------------------------------------------------------------------

async def test_transcode_activity_succeeds_when_redis_writes_fail(monkeypatch):
    """Lease set, retry-counter delete and lease delete all raise; the job
    still runs (without a heartbeat) and reports ready."""
    r = _BrokenRedis()
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: r)
    monkeypatch.setattr(hls_jobs, "_resolve_source", _aret(
        {"org_uuid": "O", "course_uuid": "C", "filename": "v.mp4"}
    ))
    monkeypatch.setattr(hls_jobs, "_fetch_source", lambda src, dst: True)
    monkeypatch.setattr(hls_jobs, "transcode_source_to_hls", _aret(
        {"master": "master.m3u8", "renditions": ["480p"], "thumbnails": None}
    ))
    monkeypatch.setattr(hls_jobs, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(hls_jobs, "upload_directory_to_s3_parallel", lambda *a, **k: True)
    heartbeats = []
    monkeypatch.setattr(hls_jobs, "_lease_heartbeat", lambda *a: heartbeats.append(a))
    statuses = []

    async def _set(uuid, status, **extra):
        statuses.append(status)

    monkeypatch.setattr(hls_jobs, "_set_status", _set)

    assert await hls_jobs.transcode_activity("act") is True
    assert statuses == ["processing", "ready"]
    assert heartbeats == []  # lease write failed → no heartbeat task
    # set (lease), delete (retries), delete (lease) were all attempted.
    assert r.calls == ["set", "delete", "delete"]


async def test_transcode_activity_holds_and_releases_its_lease(monkeypatch):
    """With Redis up, the job holds a heartbeated lease while it runs, then
    stops the heartbeat and drops the lease and retry count when done."""

    class _Redis:
        def __init__(self):
            self.calls = []

        def set(self, key, value, ex=None):
            self.calls.append(("set", key))

        def delete(self, key):
            self.calls.append(("delete", key))

    r = _Redis()
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: r)
    monkeypatch.setattr(hls_jobs, "_resolve_source", _aret(
        {"org_uuid": "O", "course_uuid": "C", "filename": "v.mp4"}
    ))
    monkeypatch.setattr(hls_jobs, "_fetch_source", lambda src, dst: True)
    monkeypatch.setattr(hls_jobs, "transcode_source_to_hls", _aret(
        {"master": "master.m3u8", "renditions": ["480p"], "thumbnails": None}
    ))
    monkeypatch.setattr(hls_jobs, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(hls_jobs, "upload_directory_to_s3_parallel", lambda *a, **k: True)
    monkeypatch.setattr(hls_jobs, "_set_status", _aret(None))
    heartbeat_running = asyncio.Event()

    async def _heartbeat(client, key):
        heartbeat_running.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(hls_jobs, "_lease_heartbeat", _heartbeat)
    created = []
    real_create_task = asyncio.create_task

    def _track(coro):
        task = real_create_task(coro)
        created.append(task)
        return task

    monkeypatch.setattr(hls_jobs.asyncio, "create_task", _track)

    assert await hls_jobs.transcode_activity("act") is True
    lease = hls_jobs._lease_key("act")
    assert r.calls == [
        ("set", lease),
        ("delete", hls_jobs._retries_key("act")),
        ("delete", lease),
    ]
    assert len(created) == 1
    await asyncio.sleep(0)
    assert created[0].cancelled()


async def test_transcode_block_unsupported_source_is_terminal(monkeypatch):
    statuses = []

    async def _set(uuid, status, **extra):
        statuses.append((status, extra))

    monkeypatch.setattr(hls_jobs, "_set_block_status", _set)
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: None)
    monkeypatch.setattr(hls_jobs, "_resolve_block_source", _aret(
        {"org_uuid": "o", "course_uuid": "c", "activity_uuid": "a", "filename": "v.mp4"}
    ))
    monkeypatch.setattr(hls_jobs, "_fetch_source", lambda *a: True)
    monkeypatch.setattr(hls_jobs, "transcode_source_to_hls", _aret({"unsupported": "no_video_stream"}))
    uploads = []
    monkeypatch.setattr(hls_jobs, "_upload_output", lambda *a: uploads.append(a))

    assert await hls_jobs.transcode_block("a", "b") is False
    assert statuses[-1] == ("unsupported", {"reason": "no_video_stream"})
    assert uploads == []


# --------------------------------------------------------------------------
# Consumer loop
# --------------------------------------------------------------------------

def _one_item_redis(item, pushes=None, rpush_error=False):
    seq = iter([item])

    class _R:
        def lpop(self, key):
            try:
                return next(seq)
            except StopIteration:
                raise asyncio.CancelledError()  # end the poll loop

        def rpush(self, key, val):
            if rpush_error:
                raise ConnectionError("redis down")
            pushes.append(val)

    return _R()


async def test_consumer_timeout_survives_mark_failed_error(monkeypatch):
    """A job that exceeds JOB_TIMEOUT_SECONDS is marked failed; if that status
    write itself blows up, the consumer child still finishes cleanly."""
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: _one_item_redis(b"slow1"))
    monkeypatch.setattr(hls_jobs, "JOB_TIMEOUT_SECONDS", 0.01)

    async def _hang(job):
        await asyncio.sleep(3600)

    marked = []

    async def _mark(job, error):
        marked.append((job["activity_uuid"], error))
        raise RuntimeError("db down")

    monkeypatch.setattr(hls_jobs, "_dispatch", _hang)
    monkeypatch.setattr(hls_jobs, "_mark_failed", _mark)

    before = set(hls_jobs._consumer_children)
    with pytest.raises(asyncio.CancelledError):
        await hls_jobs._consumer_loop(poll_seconds=0)
    children = list(set(hls_jobs._consumer_children) - before)
    results = await asyncio.gather(*children, return_exceptions=True)

    assert marked == [("slow1", "timeout")]
    assert all(r is None for r in results)  # child swallowed the error
    assert "slow1" not in hls_jobs._inflight


async def test_consumer_cancel_with_failing_requeue_still_cancels(monkeypatch):
    """On shutdown the child tries to re-enqueue its job; a Redis error there
    is swallowed and the cancellation still propagates."""
    monkeypatch.setattr(
        hls_jobs, "get_redis_client", lambda: _one_item_redis(b"busy1", rpush_error=True)
    )
    # Two permits so the poll loop can return while the job is still running.
    monkeypatch.setenv("LEARNHOUSE_HLS_CONCURRENCY", "2")
    started = asyncio.Event()

    async def _hang(job):
        started.set()
        await asyncio.sleep(3600)

    monkeypatch.setattr(hls_jobs, "_dispatch", _hang)

    before = set(hls_jobs._consumer_children)
    with pytest.raises(asyncio.CancelledError):
        await hls_jobs._consumer_loop(poll_seconds=0)
    await asyncio.wait_for(started.wait(), 5)
    children = list(set(hls_jobs._consumer_children) - before)
    assert len(children) == 1
    children[0].cancel()
    results = await asyncio.gather(*children, return_exceptions=True)

    assert isinstance(results[0], asyncio.CancelledError)
    assert "busy1" not in hls_jobs._inflight


# --------------------------------------------------------------------------
# Reaper / shutdown / bulk enqueue
# --------------------------------------------------------------------------

async def test_reconcile_loop_keeps_running_then_stops_on_cancel(monkeypatch):
    """A successful pass keeps the reaper looping; cancellation must stop it
    rather than be counted as a failure."""
    calls = []

    async def _reconcile(*a, **k):
        calls.append(1)
        if len(calls) == 2:
            raise asyncio.CancelledError()
        return {"requeued": 0, "skipped": 0, "gaveup": 0}

    monkeypatch.setattr(hls_jobs, "reconcile_unfinished", _reconcile)
    with pytest.raises(asyncio.CancelledError):
        await hls_jobs._reconcile_loop(interval=0)
    assert len(calls) == 2  # looped after the first success, stopped on cancel


async def test_stop_consumer_tolerates_requeue_errors(monkeypatch):
    r = _BrokenRedis()
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: r)
    monkeypatch.setattr(hls_jobs, "_consumer_task", None)
    monkeypatch.setattr(hls_jobs, "_reaper_task", None)
    hls_jobs._inflight.update({"j1", "j2"})

    await hls_jobs.stop_consumer()  # must not raise

    assert r.calls == ["rpush", "rpush"]  # tried every in-flight job
    assert hls_jobs._consumer_task is None and hls_jobs._reaper_task is None


async def test_enqueue_pending_counts_only_successful_pushes(monkeypatch):
    monkeypatch.setattr(hls_jobs, "_pending_targets", _aret(["a1", "a2"]))
    r = _BrokenRedis()
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: r)

    result = await hls_jobs.enqueue_pending()

    assert result == {"pending": 2, "enqueued": 0}
    assert r.calls == ["rpush", "rpush"]
