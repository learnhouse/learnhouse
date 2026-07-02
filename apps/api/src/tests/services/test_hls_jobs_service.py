"""Tests for src/services/utils/hls_jobs.py (status writes, gating, backfill)."""

import asyncio
import os
from datetime import datetime

import pytest

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.services.utils import hls_jobs


def _aret(value):
    async def _f(*a, **k):
        return value
    return _f


class _FactoryCtx:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *exc):
        return False


def _bind_session(monkeypatch, session):
    """Point hls_jobs' session factory at the test DB session."""
    monkeypatch.setattr(hls_jobs, "_async_session_factory", lambda: _FactoryCtx(session))


# --------------------------------------------------------------------------
# Flag parsing / gating
# --------------------------------------------------------------------------

def test_flags_default_off(monkeypatch):
    monkeypatch.delenv("LEARNHOUSE_HLS_ENABLED", raising=False)
    monkeypatch.delenv("LEARNHOUSE_HLS_CONCURRENCY", raising=False)
    assert hls_jobs.hls_enabled() is False
    assert hls_jobs.hls_concurrency() == 1  # default


def test_flags_parse_true(monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_HLS_ENABLED", "TRUE")
    assert hls_jobs.hls_enabled() is True


def test_hls_concurrency_parsing(monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_HLS_CONCURRENCY", "3")
    assert hls_jobs.hls_concurrency() == 3
    monkeypatch.setenv("LEARNHOUSE_HLS_CONCURRENCY", "0")
    assert hls_jobs.hls_concurrency() == 1  # clamped to >=1
    monkeypatch.setenv("LEARNHOUSE_HLS_CONCURRENCY", "bad")
    assert hls_jobs.hls_concurrency() == 1  # invalid → 1


def test_enqueue_is_noop_when_disabled(monkeypatch):
    monkeypatch.setattr(hls_jobs, "hls_enabled", lambda: False)
    # Should not touch Redis or spawn tasks; must not raise.
    called = {"redis": False}
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: called.__setitem__("redis", True))
    hls_jobs.enqueue("activity_x")
    assert called["redis"] is False


# --------------------------------------------------------------------------
# Status writes to extra_metadata
# --------------------------------------------------------------------------

async def test_set_status_writes_hls_metadata(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await hls_jobs._set_status(activity.activity_uuid, "processing")

    refreshed = await db.get(Activity, activity.id)
    assert refreshed.extra_metadata["hls"]["status"] == "processing"
    assert "updated_at" in refreshed.extra_metadata["hls"]

    await hls_jobs._set_status(
        activity.activity_uuid, "ready", master="master.m3u8", renditions=["720p"]
    )
    refreshed = await db.get(Activity, activity.id)
    assert refreshed.extra_metadata["hls"]["status"] == "ready"
    assert refreshed.extra_metadata["hls"]["renditions"] == ["720p"]


# --------------------------------------------------------------------------
# Backfill target selection
# --------------------------------------------------------------------------

async def _add_video_activity(db, org, course, uuid, *, filename, hls_status=None):
    meta = {"hls": {"status": hls_status}} if hls_status else None
    a = Activity(
        name="V",
        activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
        content={"filename": filename} if filename else {},
        published=True,
        org_id=org.id,
        course_id=course.id,
        activity_uuid=uuid,
        extra_metadata=meta,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    return a


async def test_backfill_selects_only_unready_hosted_videos(
    monkeypatch, db, org, course, chapter, activity
):
    _bind_session(monkeypatch, db)
    await _add_video_activity(db, org, course, "vid_todo", filename="a.mp4")
    await _add_video_activity(db, org, course, "vid_ready", filename="b.mp4", hls_status="ready")
    await _add_video_activity(db, org, course, "vid_nofile", filename=None)

    processed = []

    async def _fake_transcode(uuid):
        processed.append(uuid)
        return True

    monkeypatch.setattr(hls_jobs, "transcode_activity", _fake_transcode)

    result = await hls_jobs.backfill()
    # Only the hosted video that isn't ready and has a filename is transcoded.
    assert processed == ["vid_todo"]
    assert result == {"total": 1, "done": 1, "failed": 0}


def test_safe_filename_rejects_traversal_and_separators():
    assert hls_jobs._safe_filename("uuid_video.mp4") is True
    for bad in ["../x.mp4", "a/b.mp4", "a\\b.mp4", "..", ".", "", ".hidden.mp4", "x\x00.mp4"]:
        assert hls_jobs._safe_filename(bad) is False, bad


async def test_backfill_tolerates_hls_none_metadata(monkeypatch, db, org, course, chapter, activity):
    # extra_metadata={"hls": None} must not crash the target-selection .get chain.
    _bind_session(monkeypatch, db)
    a = await _add_video_activity(db, org, course, "vid_none", filename="a.mp4")
    a.extra_metadata = {"hls": None}
    db.add(a)
    await db.commit()

    async def _ok(uuid):
        return True

    monkeypatch.setattr(hls_jobs, "transcode_activity", _ok)
    result = await hls_jobs.backfill()
    assert result["done"] == 1  # the {"hls": None} activity is treated as not-ready


async def test_backfill_negative_limit_means_no_limit(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_video_activity(db, org, course, "n1", filename="1.mp4")
    await _add_video_activity(db, org, course, "n2", filename="2.mp4")

    async def _ok(uuid):
        return True

    monkeypatch.setattr(hls_jobs, "transcode_activity", _ok)
    result = await hls_jobs.backfill(limit=-5)
    assert result["total"] == 2  # negative limit does not silently drop everything


async def test_backfill_respects_limit(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_video_activity(db, org, course, "v1", filename="1.mp4")
    await _add_video_activity(db, org, course, "v2", filename="2.mp4")

    async def _ok(uuid):
        return True

    monkeypatch.setattr(hls_jobs, "transcode_activity", _ok)
    result = await hls_jobs.backfill(limit=1)
    assert result["total"] == 1


# --------------------------------------------------------------------------
# transcode_activity orchestration (mocked — no ffmpeg/S3 needed)
# --------------------------------------------------------------------------

def _mock_transcode_deps(monkeypatch, *, resolve, fetch=True, transcode=None,
                         s3=True, upload=True):
    monkeypatch.setattr(hls_jobs, "_resolve_source", _aret(resolve))
    monkeypatch.setattr(hls_jobs, "_fetch_source", lambda src, dst: fetch)
    monkeypatch.setattr(hls_jobs, "transcode_source_to_hls", _aret(transcode))
    monkeypatch.setattr(hls_jobs, "is_s3_enabled", lambda: s3)
    monkeypatch.setattr(hls_jobs, "upload_directory_to_s3", lambda out, prefix: upload)
    statuses = []

    async def _set(uuid, status, **extra):
        statuses.append((status, extra))

    monkeypatch.setattr(hls_jobs, "_set_status", _set)
    return statuses


_INFO = {"org_uuid": "O", "course_uuid": "C", "filename": "v.mp4"}
_RESULT = {"master": "master.m3u8", "renditions": ["720p"], "thumbnails": None}


async def test_transcode_activity_success(monkeypatch):
    statuses = _mock_transcode_deps(monkeypatch, resolve=_INFO, transcode=_RESULT)
    assert await hls_jobs.transcode_activity("act") is True
    assert statuses[0][0] == "processing"
    assert statuses[-1][0] == "ready"
    assert statuses[-1][1]["master"] == "master.m3u8"


async def test_transcode_activity_no_source(monkeypatch):
    statuses = _mock_transcode_deps(monkeypatch, resolve=None)
    assert await hls_jobs.transcode_activity("act") is False
    assert statuses == []  # never marked processing


async def test_transcode_activity_fetch_fails(monkeypatch):
    statuses = _mock_transcode_deps(monkeypatch, resolve=_INFO, fetch=False)
    assert await hls_jobs.transcode_activity("act") is False
    assert statuses[-1] == ("failed", {"error": "source_unavailable"})


async def test_transcode_activity_transcode_fails(monkeypatch):
    statuses = _mock_transcode_deps(monkeypatch, resolve=_INFO, transcode=None)
    assert await hls_jobs.transcode_activity("act") is False
    assert statuses[-1] == ("failed", {"error": "transcode_failed"})


async def test_transcode_activity_upload_fails(monkeypatch):
    statuses = _mock_transcode_deps(monkeypatch, resolve=_INFO, transcode=_RESULT, upload=False)
    assert await hls_jobs.transcode_activity("act") is False
    assert statuses[-1] == ("failed", {"error": "upload_failed"})


async def test_transcode_activity_exception_marks_failed(monkeypatch):
    statuses = _mock_transcode_deps(monkeypatch, resolve=_INFO)

    async def _boom(*a, **k):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(hls_jobs, "transcode_source_to_hls", _boom)
    assert await hls_jobs.transcode_activity("act") is False
    assert statuses[-1] == ("failed", {"error": "exception"})


# --------------------------------------------------------------------------
# _fetch_source
# --------------------------------------------------------------------------

def test_fetch_source_s3_success(monkeypatch, tmp_path):
    class _C:
        def download_file(self, bucket, key, local):
            open(local, "wb").close()

    monkeypatch.setattr(hls_jobs, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(hls_jobs, "get_storage_client", lambda: _C())
    monkeypatch.setattr(hls_jobs, "get_s3_bucket_name", lambda: "b")
    dst = str(tmp_path / "o.mp4")
    assert hls_jobs._fetch_source("content/x.mp4", dst) is True
    assert os.path.exists(dst)


def test_fetch_source_s3_no_client(monkeypatch):
    monkeypatch.setattr(hls_jobs, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(hls_jobs, "get_storage_client", lambda: None)
    assert hls_jobs._fetch_source("x", "y") is False


def test_fetch_source_s3_error(monkeypatch, tmp_path):
    class _C:
        def download_file(self, *a, **k):
            raise RuntimeError("net")

    monkeypatch.setattr(hls_jobs, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(hls_jobs, "get_storage_client", lambda: _C())
    monkeypatch.setattr(hls_jobs, "get_s3_bucket_name", lambda: "b")
    assert hls_jobs._fetch_source("x", str(tmp_path / "d")) is False


def test_fetch_source_local(monkeypatch, tmp_path):
    monkeypatch.setattr(hls_jobs, "is_s3_enabled", lambda: False)
    src = tmp_path / "s.mp4"
    src.write_bytes(b"data")
    dst = str(tmp_path / "d.mp4")
    assert hls_jobs._fetch_source(str(src), dst) is True
    assert open(dst, "rb").read() == b"data"


def test_fetch_source_local_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(hls_jobs, "is_s3_enabled", lambda: False)
    assert hls_jobs._fetch_source(str(tmp_path / "nope.mp4"), str(tmp_path / "d")) is False


# --------------------------------------------------------------------------
# _resolve_source
# --------------------------------------------------------------------------

async def test_resolve_source_success(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_video_activity(db, org, course, "rs_ok", filename="v.mp4")
    info = await hls_jobs._resolve_source("rs_ok")
    assert info == {"org_uuid": org.org_uuid, "course_uuid": course.course_uuid, "filename": "v.mp4"}


async def test_resolve_source_unsafe_filename(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_video_activity(db, org, course, "rs_bad", filename="../evil.mp4")
    assert await hls_jobs._resolve_source("rs_bad") is None


async def test_resolve_source_missing_activity(monkeypatch, db):
    _bind_session(monkeypatch, db)
    assert await hls_jobs._resolve_source("nope") is None


# --------------------------------------------------------------------------
# enqueue (Redis push only; the in-app consumer drains)
# --------------------------------------------------------------------------

def test_enqueue_pushes_to_redis_when_enabled(monkeypatch):
    monkeypatch.setattr(hls_jobs, "hls_enabled", lambda: True)
    pushed = []

    class _R:
        def rpush(self, key, val):
            pushed.append((key, val))

    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: _R())
    hls_jobs.enqueue("act1")
    assert pushed == [(hls_jobs.REDIS_QUEUE_KEY, "act1")]


def test_enqueue_redis_rpush_error_is_swallowed(monkeypatch):
    monkeypatch.setattr(hls_jobs, "hls_enabled", lambda: True)

    class _R:
        def rpush(self, *a):
            raise RuntimeError("redis down")

    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: _R())
    hls_jobs.enqueue("act1")  # must not raise


def test_enqueue_no_redis_warns(monkeypatch):
    monkeypatch.setattr(hls_jobs, "hls_enabled", lambda: True)
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: None)
    hls_jobs.enqueue("act1")  # no-redis warning branch, must not raise


# --------------------------------------------------------------------------
# In-app consumer + enqueue_pending
# --------------------------------------------------------------------------

async def test_consumer_loop_drains_and_transcodes(monkeypatch):
    processed = []
    seq = iter([b"a1", b"a2"])

    class _R:
        def lpop(self, key):
            try:
                return next(seq)
            except StopIteration:
                raise asyncio.CancelledError()  # end the test loop

    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: _R())

    async def _tr(uuid):
        processed.append(uuid)
        if uuid == "a1":
            raise RuntimeError("boom")  # one job errors — consumer must survive
        return True

    monkeypatch.setattr(hls_jobs, "transcode_activity", _tr)
    with pytest.raises(asyncio.CancelledError):
        await hls_jobs._consumer_loop(poll_seconds=0)
    for _ in range(5):
        await asyncio.sleep(0)
    assert set(processed) == {"a1", "a2"}


async def test_consumer_loop_recovers_from_poll_error(monkeypatch):
    calls = {"n": 0}

    class _R:
        def lpop(self, key):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("transient redis error")
            raise asyncio.CancelledError()

    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: _R())
    with pytest.raises(asyncio.CancelledError):
        await hls_jobs._consumer_loop(poll_seconds=0)
    assert calls["n"] == 2  # recovered from the first error, polled again


async def test_consumer_reenqueues_inflight_on_shutdown(monkeypatch):
    # A job cancelled mid-transcode (pod shutdown) must be pushed back to Redis.
    pushed = []

    class _R:
        def rpush(self, key, val):
            pushed.append(val)

    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: _R())

    async def _hang(uuid):
        await asyncio.sleep(3600)  # simulate an in-flight transcode

    monkeypatch.setattr(hls_jobs, "transcode_activity", _hang)
    hls_jobs._inflight.clear()

    # Drive one iteration of the loop manually by feeding lpop once.
    seq = iter([b"stuck1"])

    class _RQ(_R):
        def lpop(self, key):
            try:
                return next(seq)
            except StopIteration:
                import asyncio as _a
                raise _a.CancelledError()

    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: _RQ())
    task = asyncio.create_task(hls_jobs._consumer_loop(poll_seconds=0))
    for _ in range(10):
        await asyncio.sleep(0)
        if "stuck1" in hls_jobs._inflight:
            break
    assert "stuck1" in hls_jobs._inflight
    # Cancel the in-flight child → its except-CancelledError re-enqueues it.
    for t in list(hls_jobs._consumer_children):
        t.cancel()
    task.cancel()
    for _ in range(10):
        await asyncio.sleep(0)
    assert "stuck1" in pushed


class _FakeRedis:
    """Minimal Redis for reconcile_unfinished tests."""
    def __init__(self, leases=None, retries=None, queue=None):
        self.pushed = []
        self.leases = set(leases or [])
        self.retries = dict(retries or {})
        self.queue = list(queue or [])

    def lrange(self, key, a, b):
        return list(self.queue)

    def exists(self, key):
        return 1 if key in self.leases else 0

    def get(self, key):
        return str(self.retries[key]) if key in self.retries else None

    def incr(self, key):
        self.retries[key] = self.retries.get(key, 0) + 1
        return self.retries[key]

    def expire(self, key, ttl):
        return True

    def rpush(self, key, val):
        self.pushed.append(val)
        return len(self.pushed)


async def test_reconcile_requeues_unfinished_skips_ready(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_video_activity(db, org, course, "todo1", filename="a.mp4")  # hls None
    await _add_video_activity(db, org, course, "proc1", filename="b.mp4", hls_status="processing")
    await _add_video_activity(db, org, course, "fail1", filename="c.mp4", hls_status="failed")
    await _add_video_activity(db, org, course, "rdy1", filename="d.mp4", hls_status="ready")
    r = _FakeRedis()
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: r)
    out = await hls_jobs.reconcile_unfinished()
    assert set(r.pushed) == {"todo1", "proc1", "fail1"}  # ready skipped
    assert out["requeued"] == 3


async def test_reconcile_skips_active_lease(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_video_activity(db, org, course, "busy1", filename="a.mp4", hls_status="processing")
    r = _FakeRedis(leases={hls_jobs._lease_key("busy1")})
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: r)
    out = await hls_jobs.reconcile_unfinished()
    assert r.pushed == [] and out["skipped"] == 1


async def test_reconcile_skips_already_queued(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_video_activity(db, org, course, "q1", filename="a.mp4", hls_status="failed")
    r = _FakeRedis(queue=["q1"])
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: r)
    out = await hls_jobs.reconcile_unfinished()
    assert r.pushed == [] and out["skipped"] == 1


async def test_reconcile_gives_up_after_max_retries(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_video_activity(db, org, course, "bad1", filename="a.mp4", hls_status="failed")
    r = _FakeRedis(retries={hls_jobs._retries_key("bad1"): 6})
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: r)
    out = await hls_jobs.reconcile_unfinished(max_retries=6)
    assert r.pushed == [] and out["gaveup"] == 1


async def test_reconcile_no_redis(monkeypatch):
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: None)
    out = await hls_jobs.reconcile_unfinished()
    assert out["requeued"] == 0 and out.get("error") == "no_redis"


async def test_reconcile_resilient_to_redis_errors(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_video_activity(db, org, course, "e1", filename="a.mp4", hls_status="failed")

    class _BadR(_FakeRedis):
        def lrange(self, *a):
            raise RuntimeError("boom")

        def exists(self, key):
            raise RuntimeError("boom")

        def get(self, key):
            raise RuntimeError("boom")

        def incr(self, key):
            raise RuntimeError("boom")

        def rpush(self, key, val):
            raise RuntimeError("boom")

    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: _BadR())
    out = await hls_jobs.reconcile_unfinished()  # must not raise despite every op erroring
    assert out["requeued"] == 0  # rpush failed, so not counted


def test_hls_max_retries_parsing(monkeypatch):
    monkeypatch.delenv("LEARNHOUSE_HLS_MAX_RETRIES", raising=False)
    assert hls_jobs.hls_max_retries() == 6
    monkeypatch.setenv("LEARNHOUSE_HLS_MAX_RETRIES", "3")
    assert hls_jobs.hls_max_retries() == 3
    monkeypatch.setenv("LEARNHOUSE_HLS_MAX_RETRIES", "bad")
    assert hls_jobs.hls_max_retries() == 6


async def test_lease_heartbeat_swallows_errors(monkeypatch):
    monkeypatch.setattr(hls_jobs, "LEASE_HEARTBEAT_SECONDS", 0)

    class _C:
        def expire(self, key, ttl):
            raise RuntimeError("redis down")  # -> caught, heartbeat returns

    await hls_jobs._lease_heartbeat(_C(), "k")  # returns, no raise


async def test_lease_heartbeat_cancellable(monkeypatch):
    monkeypatch.setattr(hls_jobs, "LEASE_HEARTBEAT_SECONDS", 0)
    calls = {"n": 0}

    class _C:
        def expire(self, key, ttl):
            calls["n"] += 1

    task = asyncio.create_task(hls_jobs._lease_heartbeat(_C(), "k"))
    for _ in range(30):
        await asyncio.sleep(0)
        if calls["n"] >= 1:
            break
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert calls["n"] >= 1


async def test_consumer_loop_no_redis_returns(monkeypatch):
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: None)
    await hls_jobs._consumer_loop()  # returns immediately, no raise


def test_start_consumer_noop_when_disabled(monkeypatch):
    monkeypatch.setattr(hls_jobs, "hls_enabled", lambda: False)
    hls_jobs._consumer_task = None
    hls_jobs.start_consumer()
    assert hls_jobs._consumer_task is None


def test_start_consumer_noop_without_redis(monkeypatch):
    monkeypatch.setattr(hls_jobs, "hls_enabled", lambda: True)
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: None)
    hls_jobs._consumer_task = None
    hls_jobs.start_consumer()
    assert hls_jobs._consumer_task is None


async def test_enqueue_pending_pushes_all_targets(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_video_activity(db, org, course, "p_todo", filename="a.mp4")
    await _add_video_activity(db, org, course, "p_ready", filename="b.mp4", hls_status="ready")
    pushed = []

    class _R:
        def rpush(self, key, val):
            pushed.append(val)

    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: _R())
    result = await hls_jobs.enqueue_pending()
    assert pushed == ["p_todo"]
    assert result == {"pending": 1, "enqueued": 1}


async def test_enqueue_pending_no_redis(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_video_activity(db, org, course, "p1", filename="a.mp4")
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: None)
    result = await hls_jobs.enqueue_pending()
    assert result["enqueued"] == 0 and result.get("error") == "no_redis"


# --------------------------------------------------------------------------
# Resilience: job timeout, reaper, graceful shutdown
# --------------------------------------------------------------------------

async def test_consumer_job_timeout_marks_failed(monkeypatch):
    monkeypatch.setattr(hls_jobs, "JOB_TIMEOUT_SECONDS", 0.01)
    seq = iter([b"slow1"])

    class _R:
        def lpop(self, key):
            try:
                return next(seq)
            except StopIteration:
                raise asyncio.CancelledError()

        def rpush(self, *a):
            pass

    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: _R())

    async def _slow(uuid):
        await asyncio.sleep(10)  # exceeds JOB_TIMEOUT_SECONDS

    monkeypatch.setattr(hls_jobs, "transcode_activity", _slow)
    status = []

    async def _ss(uuid, st, **k):
        status.append((uuid, st, k.get("error")))

    monkeypatch.setattr(hls_jobs, "_set_status", _ss)
    with pytest.raises(asyncio.CancelledError):
        await hls_jobs._consumer_loop(poll_seconds=0)
    await asyncio.sleep(0.05)  # let the child's wait_for time out
    for _ in range(10):
        await asyncio.sleep(0)
    assert ("slow1", "failed", "timeout") in status


async def test_reconcile_loop_calls_and_survives_errors(monkeypatch):
    calls = {"n": 0}

    async def _rec(*a, **k):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("transient")  # must not kill the loop
        raise asyncio.CancelledError()

    monkeypatch.setattr(hls_jobs, "reconcile_unfinished", _rec)
    with pytest.raises(asyncio.CancelledError):
        await hls_jobs._reconcile_loop(interval=0)
    assert calls["n"] == 2


async def test_stop_consumer_reenqueues_inflight_and_cancels(monkeypatch):
    pushed = []

    class _R:
        def rpush(self, k, v):
            pushed.append(v)

    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: _R())
    hls_jobs._inflight.clear()
    hls_jobs._inflight.add("busy1")

    async def _idle():
        await asyncio.sleep(3600)

    hls_jobs._consumer_task = asyncio.create_task(_idle())
    hls_jobs._reaper_task = asyncio.create_task(_idle())
    await asyncio.sleep(0)
    await hls_jobs.stop_consumer()
    assert "busy1" in pushed
    assert hls_jobs._consumer_task is None and hls_jobs._reaper_task is None
    hls_jobs._inflight.clear()


async def test_start_consumer_starts_reaper(monkeypatch):
    monkeypatch.setattr(hls_jobs, "hls_enabled", lambda: True)

    class _R:
        def lpop(self, key):
            return None

    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: _R())
    hls_jobs._consumer_task = None
    hls_jobs._reaper_task = None
    hls_jobs.start_consumer()
    try:
        assert hls_jobs._consumer_task is not None
        assert hls_jobs._reaper_task is not None
    finally:
        await hls_jobs.stop_consumer()


async def test_reconcile_ignores_activities_without_a_file(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_video_activity(db, org, course, "nofile", filename=None, hls_status="failed")
    r = _FakeRedis()
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: r)
    out = await hls_jobs.reconcile_unfinished()
    assert r.pushed == [] and out["requeued"] == 0


async def test_consumer_loop_empty_poll_then_cancel(monkeypatch):
    seq = iter([None, None])

    class _R:
        def lpop(self, key):
            v = next(seq, "STOP")
            if v == "STOP":
                raise asyncio.CancelledError()
            return v

    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: _R())
    with pytest.raises(asyncio.CancelledError):
        await hls_jobs._consumer_loop(poll_seconds=0)


async def test_reconcile_bumps_retry_counter(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_video_activity(db, org, course, "retryme", filename="a.mp4", hls_status="failed")
    r = _FakeRedis()
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: r)
    await hls_jobs.reconcile_unfinished()
    assert r.retries.get(hls_jobs._retries_key("retryme")) == 1  # counter incremented


async def test_backfill_counts_failures(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_video_activity(db, org, course, "bf1", filename="a.mp4")

    async def _tr(uuid):
        return False

    monkeypatch.setattr(hls_jobs, "transcode_activity", _tr)
    r = await hls_jobs.backfill()
    assert r["failed"] >= 1


async def test_stop_consumer_waits_for_children(monkeypatch):
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: None)

    async def _child():
        await asyncio.sleep(0.01)

    hls_jobs._consumer_children.clear()
    hls_jobs._consumer_children.add(asyncio.create_task(_child()))
    hls_jobs._consumer_task = None
    hls_jobs._reaper_task = None
    hls_jobs._inflight.clear()
    await hls_jobs.stop_consumer()  # gathers children
    hls_jobs._consumer_children.clear()
