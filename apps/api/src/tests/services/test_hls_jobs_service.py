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
    monkeypatch.delenv("LEARNHOUSE_HLS_INPROCESS_WORKER", raising=False)
    assert hls_jobs.hls_enabled() is False
    assert hls_jobs.inprocess_worker_enabled() is False


def test_flags_parse_true(monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_HLS_ENABLED", "TRUE")
    monkeypatch.setenv("LEARNHOUSE_HLS_INPROCESS_WORKER", "true")
    assert hls_jobs.hls_enabled() is True
    assert hls_jobs.inprocess_worker_enabled() is True


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
# enqueue + run_worker
# --------------------------------------------------------------------------

def test_enqueue_pushes_to_redis_when_enabled(monkeypatch):
    monkeypatch.setattr(hls_jobs, "hls_enabled", lambda: True)
    monkeypatch.setattr(hls_jobs, "inprocess_worker_enabled", lambda: False)
    pushed = []

    class _R:
        def rpush(self, key, val):
            pushed.append((key, val))

    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: _R())
    hls_jobs.enqueue("act1")
    assert pushed == [(hls_jobs.REDIS_QUEUE_KEY, "act1")]


async def test_run_worker_processes_and_survives_job_errors(monkeypatch):
    processed = []
    seq = iter([("k", b"a1"), ("k", b"a2")])

    class _R:
        def blpop(self, key, timeout):
            try:
                return next(seq)
            except StopIteration:
                raise asyncio.CancelledError()

    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: _R())

    async def _tr(uuid):
        processed.append(uuid)
        if uuid == "a1":
            raise RuntimeError("boom")  # first job errors — worker must survive
        return True

    monkeypatch.setattr(hls_jobs, "transcode_activity", _tr)
    with pytest.raises(asyncio.CancelledError):
        await hls_jobs.run_worker(poll_timeout=0)
    assert processed == ["a1", "a2"]


async def test_run_worker_requires_redis(monkeypatch):
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: None)
    with pytest.raises(RuntimeError):
        await hls_jobs.run_worker()


# --------------------------------------------------------------------------
# enqueue branch coverage
# --------------------------------------------------------------------------

def test_enqueue_redis_rpush_error_is_swallowed(monkeypatch):
    monkeypatch.setattr(hls_jobs, "hls_enabled", lambda: True)
    monkeypatch.setattr(hls_jobs, "inprocess_worker_enabled", lambda: False)

    class _R:
        def rpush(self, *a):
            raise RuntimeError("redis down")

    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: _R())
    # Must not raise despite the Redis error.
    hls_jobs.enqueue("act1")


def test_enqueue_no_redis_no_inprocess_warns(monkeypatch):
    monkeypatch.setattr(hls_jobs, "hls_enabled", lambda: True)
    monkeypatch.setattr(hls_jobs, "inprocess_worker_enabled", lambda: False)
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: None)
    hls_jobs.enqueue("act1")  # hits the "no queue, no worker" warning branch


async def test_enqueue_spawns_inprocess_worker(monkeypatch):
    monkeypatch.setattr(hls_jobs, "hls_enabled", lambda: True)
    monkeypatch.setattr(hls_jobs, "inprocess_worker_enabled", lambda: True)
    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: None)
    processed = []

    async def _tr(uuid):
        processed.append(uuid)
        return True

    monkeypatch.setattr(hls_jobs, "transcode_activity", _tr)
    hls_jobs.enqueue("act_inproc")
    # Let the spawned task run.
    for _ in range(5):
        await asyncio.sleep(0)
    assert processed == ["act_inproc"]


async def test_run_worker_recovers_from_poll_error(monkeypatch):
    calls = {"n": 0}

    class _R:
        def blpop(self, key, timeout):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("transient redis error")
            raise asyncio.CancelledError()

    monkeypatch.setattr(hls_jobs, "get_redis_client", lambda: _R())
    with pytest.raises(asyncio.CancelledError):
        await hls_jobs.run_worker(poll_timeout=0)
    assert calls["n"] == 2  # recovered from the first error, polled again
