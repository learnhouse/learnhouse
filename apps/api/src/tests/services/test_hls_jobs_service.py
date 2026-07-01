"""Tests for src/services/utils/hls_jobs.py (status writes, gating, backfill)."""

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


async def test_backfill_respects_limit(monkeypatch, db, org, course, chapter, activity):
    _bind_session(monkeypatch, db)
    await _add_video_activity(db, org, course, "v1", filename="1.mp4")
    await _add_video_activity(db, org, course, "v2", filename="2.mp4")

    async def _ok(uuid):
        return True

    monkeypatch.setattr(hls_jobs, "transcode_activity", _ok)
    result = await hls_jobs.backfill(limit=1)
    assert result["total"] == 1
