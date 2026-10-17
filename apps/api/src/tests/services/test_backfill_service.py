"""Tests for src/services/backfill (job registry + scheduled runner)."""

import asyncio
from datetime import datetime, timezone

import pytest

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.services.backfill import jobs, scheduler


class _FactoryCtx:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *exc):
        return False


async def _add_video(db, org, course, uuid, *, hls_status=None, filename="v.mp4"):
    a = Activity(
        name="V",
        activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
        content={"filename": filename} if filename else {},
        published=True,
        org_id=org.id,
        course_id=course.id,
        activity_uuid=uuid,
        extra_metadata={"hls": {"status": hls_status}} if hls_status else None,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()


# --- jobs --------------------------------------------------------------------

async def test_hls_job_queues_only_unstarted_videos_up_to_the_cap(monkeypatch, db, org, course, chapter, activity):
    import src.core.events.database as database
    from src.services.utils import hls_jobs

    monkeypatch.setattr(database, "_async_session_factory", lambda: _FactoryCtx(db))
    queued = []
    monkeypatch.setattr(hls_jobs, "enqueue", lambda uuid: queued.append(uuid))
    await _add_video(db, org, course, "new1")
    await _add_video(db, org, course, "failed1", hls_status="failed")
    await _add_video(db, org, course, "ready1", hls_status="ready")
    await _add_video(db, org, course, "busy1", hls_status="processing")
    await _add_video(db, org, course, "queued1", hls_status="queued")
    await _add_video(db, org, course, "nofile", filename=None)

    out = await jobs._hls()
    assert sorted(queued) == ["failed1", "new1"]
    assert out == {"queued": 2, "deferred": 0}

    queued.clear()
    monkeypatch.setenv("LEARNHOUSE_BACKFILL_HLS_LIMIT", "1")
    assert await jobs._hls() == {"queued": 1, "deferred": 1}
    assert len(queued) == 1


async def test_chapters_job_caps_and_counts(monkeypatch):
    import src.services.utils.chapter_jobs as chapter_jobs

    async def _targets():
        return ["a", "b", "c"]

    async def _generate(uuid):
        return uuid != "b"

    monkeypatch.setattr(chapter_jobs, "backfill_targets", _targets)
    monkeypatch.setattr(chapter_jobs, "generate_activity_chapters", _generate)
    assert await jobs._chapters() == {"ready": 2, "failed": 1, "deferred": 0}
    monkeypatch.setenv("LEARNHOUSE_BACKFILL_CHAPTERS_LIMIT", "1")
    assert await jobs._chapters() == {"ready": 1, "failed": 0, "deferred": 2}


async def test_index_job_reports_the_sweep(monkeypatch):
    import src.services.ai.rag.scheduler as rag

    async def _run_once():
        return rag.SweepResult(activities=3, courses=1, deferred=7)

    monkeypatch.setattr(rag, "run_once", _run_once)
    assert await jobs._index() == {"queued": 4, "deferred": 7}


def test_env_limit_parsing(monkeypatch):
    monkeypatch.setenv("X_LIMIT", "bad")
    assert jobs._env_limit("X_LIMIT", 5) == 5
    monkeypatch.setenv("X_LIMIT", "-3")
    assert jobs._env_limit("X_LIMIT", 5) == 0


def test_hls_enabled_follows_the_flag(monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_HLS_ENABLED", "true")
    assert jobs._hls_enabled() is True
    monkeypatch.setenv("LEARNHOUSE_HLS_ENABLED", "false")
    assert jobs._hls_enabled() is False


async def test_run_all_isolates_failures_and_honours_filters(monkeypatch):
    calls = []

    async def ok():
        calls.append("ok")
        return {"queued": 1}

    async def boom():
        raise RuntimeError("down")

    monkeypatch.setattr(jobs, "JOBS", (
        jobs.BackfillJob("first", "", boom),
        jobs.BackfillJob("second", "", ok),
        jobs.BackfillJob("off", "", ok, enabled=lambda: False),
    ))
    out = await jobs.run_all()
    assert out == {"first": {"error": "down"}, "second": {"queued": 1}, "off": {"skipped": "disabled"}}
    assert calls == ["ok"]
    assert await jobs.run_all(["second"]) == {"second": {"queued": 1}}


def test_registry_lists_the_content_backfills():
    assert [job.name for job in jobs.JOBS] == ["hls", "index", "chapters"]


# --- scheduler ---------------------------------------------------------------

def test_interval_hours(monkeypatch):
    monkeypatch.delenv("LEARNHOUSE_BACKFILL_INTERVAL_HOURS", raising=False)
    assert scheduler.interval_hours() == 48.0
    monkeypatch.setenv("LEARNHOUSE_BACKFILL_INTERVAL_HOURS", "0")
    assert scheduler.interval_hours() == 0.0
    monkeypatch.setenv("LEARNHOUSE_BACKFILL_INTERVAL_HOURS", "nope")
    assert scheduler.interval_hours() == 48.0


def test_window_buckets_time():
    t = datetime(2026, 1, 3, tzinfo=timezone.utc)
    assert scheduler._window(t, 48 * 3600) == int(t.timestamp()) // (48 * 3600)


class _Redis:
    def __init__(self, fail=False):
        self.keys = {}
        self.fail = fail

    def set(self, key, val, nx=False, ex=None):
        if self.fail:
            raise ConnectionError("down")
        if nx and key in self.keys:
            return None
        self.keys[key] = (val, ex)
        return True


async def test_claim_once_per_window_with_redis(monkeypatch):
    import src.core.redis as redis_mod

    r = _Redis()
    monkeypatch.setattr(redis_mod, "get_redis_client", lambda: r)
    assert await scheduler._claim(7, 3600) is True
    assert await scheduler._claim(7, 3600) is False
    assert await scheduler._claim(8, 3600) is True
    assert r.keys["learnhouse:backfill:7"] == ("1", 3600)

    monkeypatch.setattr(redis_mod, "get_redis_client", lambda: _Redis(fail=True))
    assert await scheduler._claim(9, 3600) is False


async def test_claim_once_per_window_without_redis(monkeypatch):
    import src.core.redis as redis_mod

    monkeypatch.setattr(redis_mod, "get_redis_client", lambda: None)
    monkeypatch.setattr(scheduler, "_last_window", None)
    assert await scheduler._claim(3, 3600) is True
    assert await scheduler._claim(3, 3600) is False
    assert await scheduler._claim(4, 3600) is True


async def test_tick_runs_claimed_windows_and_survives_errors(monkeypatch):
    runs = []

    async def _claim(window, interval):
        return True

    async def _run_all(only=None):
        runs.append(only)
        return {"hls": {"queued": 0}}

    monkeypatch.setattr(scheduler, "_claim", _claim)
    monkeypatch.setattr(jobs, "run_all", _run_all)
    await scheduler._tick(3600)
    assert runs == [None]

    async def _boom():
        raise RuntimeError("db down")

    monkeypatch.setattr(scheduler, "run_once", _boom)
    await scheduler._tick(3600)  # logged, not raised

    async def _skip(window, interval):
        return False

    monkeypatch.setattr(scheduler, "_claim", _skip)
    monkeypatch.setattr(scheduler, "run_once", lambda: pytest.fail("should not run"))
    await scheduler._tick(3600)


async def test_tick_lets_cancellation_through(monkeypatch):
    async def _cancel(window, interval):
        raise asyncio.CancelledError()

    monkeypatch.setattr(scheduler, "_claim", _cancel)
    with pytest.raises(asyncio.CancelledError):
        await scheduler._tick(3600)


async def test_loop_waits_then_ticks_every_check(monkeypatch):
    sleeps = []
    ticks = []

    async def _sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) >= 3:
            raise asyncio.CancelledError()

    async def _tick(interval):
        ticks.append(interval)

    monkeypatch.setattr(scheduler.asyncio, "sleep", _sleep)
    monkeypatch.setattr(scheduler, "_tick", _tick)
    monkeypatch.setattr(scheduler.random, "random", lambda: 0.0)
    with pytest.raises(asyncio.CancelledError):
        await scheduler._loop(7200)
    assert sleeps == [scheduler.STARTUP_DELAY_SECONDS, scheduler.CHECK_SECONDS, scheduler.CHECK_SECONDS]
    assert ticks == [7200, 7200]


async def test_start_and_stop_scheduler(monkeypatch):
    started = []

    async def _loop(interval):
        started.append(interval)
        await asyncio.sleep(3600)

    monkeypatch.setattr(scheduler, "_loop", _loop)
    monkeypatch.setenv("LEARNHOUSE_BACKFILL_INTERVAL_HOURS", "0")
    scheduler.start_scheduler()
    assert scheduler._task is None

    monkeypatch.setenv("LEARNHOUSE_BACKFILL_INTERVAL_HOURS", "2")
    scheduler.start_scheduler()
    await asyncio.sleep(0)
    assert started == [7200]
    await scheduler.stop_scheduler()
    assert scheduler._task is None
    await scheduler.stop_scheduler()  # already stopped: no-op
