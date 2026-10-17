"""The periodic backfill: queue what the index is missing or behind on."""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import update
from sqlmodel import select

from src.db.course_embeddings import CourseEmbedding
from src.db.courses.chapters import Chapter
from src.db.organization_config import OrganizationConfig
from src.services.ai.rag import pipeline, scheduler
from src.services.ai.rag.types import ContentRef
from src.tests.services.rag_helpers import (
    ActivitySubTypeEnum,
    ActivityTypeEnum,
    add_activity,
    same_session,
)


async def _fake_embeddings(texts):
    return [[0.1] * 768 for _ in texts]


@pytest.fixture(autouse=True)
def _no_task():
    scheduler._task = None
    yield
    scheduler._task = None


@pytest.fixture
def session(db):
    with patch.object(pipeline, "_session", new=lambda: same_session(db)), \
         patch.object(pipeline, "generate_embeddings", new=AsyncMock(side_effect=_fake_embeddings)), \
         patch("src.core.events.database._async_session_factory", new=lambda: same_session(db)):
        yield db


def _later() -> str:
    return str(datetime.now() + timedelta(seconds=5))


def _queued(rag_dispatch) -> dict[ContentRef, float]:
    # The backfill never lets a run transcribe (spend credits).
    assert all(c.args[2] is False for c in rag_dispatch.call_args_list)
    return {c.args[0]: c.args[1] for c in rag_dispatch.call_args_list}


async def _page(db, org, course, chapter, activity_id):
    return await add_activity(
        db, org, course, chapter, activity_id,
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Cells"}]}]},
    )


class TestSweep:
    async def test_never_indexed_content_is_queued_now(self, session, org, course, chapter, rag_dispatch):
        await _page(session, org, course, chapter, 10)

        result = await scheduler.sweep(session)

        assert (result.activities, result.courses, result.never_indexed) == (1, 1, 2)
        assert _queued(rag_dispatch) == {ContentRef.activity(10): 0, ContentRef.course(course.id): 0}

    async def test_indexed_content_is_left_alone(self, session, org, course, chapter, rag_dispatch):
        await _page(session, org, course, chapter, 10)
        await pipeline.run_course(course.id)

        result = await scheduler.sweep(session)

        assert result.queued == 0
        rag_dispatch.assert_not_called()

    async def test_edits_after_indexing_are_queued(self, session, org, course, chapter, rag_dispatch):
        activity = await _page(session, org, course, chapter, 10)
        await _page(session, org, course, chapter, 11)
        await pipeline.run_course(course.id)

        activity.update_date = _later()
        session.add(activity)
        await session.commit()

        result = await scheduler.sweep(session)

        assert (result.activities, result.courses, result.never_indexed) == (1, 0, 0)
        assert _queued(rag_dispatch) == {ContentRef.activity(10): 0}

    async def test_chapter_edits_queue_the_course_and_its_activities(
        self, session, org, course, chapter, rag_dispatch
    ):
        await _page(session, org, course, chapter, 10)
        await pipeline.run_course(course.id)

        row = await session.get(Chapter, chapter.id)
        row.update_date = _later()
        session.add(row)
        await session.commit()

        await scheduler.sweep(session)

        assert set(_queued(rag_dispatch)) == {ContentRef.activity(10), ContentRef.course(course.id)}

    async def test_a_rerun_with_unchanged_text_counts_as_current(self, session, org, course, chapter, rag_dispatch):
        # A touch that changes nothing indexable takes the no-re-embed path;
        # it must still clear the ref, or every sweep would queue it again.
        await _page(session, org, course, chapter, 10)
        await pipeline.run_course(course.id)
        await session.execute(update(CourseEmbedding).values(update_date="2000-01-01 00:00:00"))
        await session.commit()
        assert (await scheduler.sweep(session)).queued == 2

        await pipeline.run_course(course.id)

        assert (await scheduler.sweep(session)).queued == 0


    async def test_rows_from_the_old_indexer_are_refreshed_once(self, session, org, course, chapter, rag_dispatch):
        await _page(session, org, course, chapter, 10)
        await pipeline.run_course(course.id)
        await session.execute(update(CourseEmbedding).where(CourseEmbedding.activity_id == 10).values(content_hash=None))
        await session.commit()

        await scheduler.sweep(session)
        assert set(_queued(rag_dispatch)) == {ContentRef.activity(10)}
        await pipeline.run(ContentRef.activity(10))
        assert (await scheduler.sweep(session)).queued == 0

    async def test_iso_dates_compare_by_the_second(self, session, org, course, chapter, rag_dispatch):
        activity = await _page(session, org, course, chapter, 10)
        await pipeline.run_course(course.id)
        indexed = (await session.execute(select(CourseEmbedding.update_date).where(CourseEmbedding.activity_id == 10))).scalars().first()

        # Same moment written as isoformat(): not newer, so not stale.
        activity.update_date = indexed.replace(" ", "T")
        session.add(activity)
        await session.commit()
        assert (await scheduler.sweep(session)).queued == 0

    async def test_orgs_without_ai_search_are_skipped(self, session, org, course, chapter, rag_dispatch):
        await _page(session, org, course, chapter, 10)
        session.add(OrganizationConfig(
            org_id=org.id, config={"config_version": "2.0", "admin_toggles": {"ai": {"copilot_enabled": False}}},
            creation_date="", update_date="",
        ))
        await session.commit()
        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True}):
            assert (await scheduler.sweep(session)).queued == 0
        rag_dispatch.assert_not_called()

    async def test_a_large_backlog_is_spread_over_sweeps(
        self, session, org, course, chapter, rag_dispatch, monkeypatch
    ):
        for activity_id in (10, 11, 12):
            await _page(session, org, course, chapter, activity_id)
        monkeypatch.setenv("LEARNHOUSE_RAG_BACKFILL_BATCH", "2")

        result = await scheduler.sweep(session)

        assert (result.courses, result.activities, result.deferred) == (1, 1, 2)
        assert set(_queued(rag_dispatch)) == {ContentRef.course(course.id), ContentRef.activity(10)}


class TestRunOnce:
    async def test_logs_what_it_queued(self, session, org, course, chapter, rag_dispatch, caplog):
        await _page(session, org, course, chapter, 10)
        with caplog.at_level(logging.INFO, logger=scheduler.__name__):
            await scheduler.run_once()
        assert "RAG backfill: queued 1 activities and 1 courses for indexing (2 never indexed" in caplog.text

    async def test_logs_what_it_left_for_later(self, session, org, course, chapter, rag_dispatch, caplog, monkeypatch):
        await _page(session, org, course, chapter, 10)
        monkeypatch.setenv("LEARNHOUSE_RAG_BACKFILL_BATCH", "1")
        with caplog.at_level(logging.INFO, logger=scheduler.__name__):
            await scheduler.run_once()
        assert "; 1 more left for the next sweep" in caplog.text

    async def test_logs_when_up_to_date(self, session, rag_dispatch, caplog):
        with caplog.at_level(logging.INFO, logger=scheduler.__name__):
            result = await scheduler.run_once()
        assert result.queued == 0
        assert "RAG backfill: index is up to date" in caplog.text


class TestLock:
    def test_one_key_per_interval(self):
        start = datetime(2026, 10, 10, 9, 0, 1, tzinfo=timezone.utc)
        assert scheduler._lock_key(start, 3 * 3600) == scheduler._lock_key(start + timedelta(hours=2), 3 * 3600)
        assert scheduler._lock_key(start, 3 * 3600) != scheduler._lock_key(start + timedelta(hours=3), 3 * 3600)

    async def test_redis_decides_which_replica_sweeps(self, monkeypatch):
        calls = []

        class _Client:
            def __init__(self, grant):
                self.grant = grant

            def set(self, key, value, nx=False, ex=None):
                calls.append((key, nx, ex))
                return self.grant

        now = datetime.now(timezone.utc)
        monkeypatch.setattr("src.core.redis.get_redis_client", lambda: _Client(True))
        assert await scheduler._claim(now, 10800) is True
        monkeypatch.setattr("src.core.redis.get_redis_client", lambda: _Client(None))
        assert await scheduler._claim(now, 10800) is False
        assert calls[0] == (scheduler._lock_key(now, 10800), True, 10795)

    async def test_without_redis_this_process_sweeps(self, monkeypatch):
        monkeypatch.setattr("src.core.redis.get_redis_client", lambda: None)
        assert await scheduler._claim(datetime.now(timezone.utc), 10800) is True

    async def test_a_broken_lock_does_not_skip_the_sweep(self, monkeypatch):
        def broken():
            raise ConnectionError("redis down")

        monkeypatch.setattr("src.core.redis.get_redis_client", broken)
        assert await scheduler._claim(datetime.now(timezone.utc), 10800) is True


class TestTick:
    async def test_runs_when_claimed(self):
        with patch.object(scheduler, "_claim", new=AsyncMock(return_value=True)), \
             patch.object(scheduler, "run_once", new=AsyncMock()) as run:
            await scheduler._tick(10800)
        run.assert_awaited_once()

    async def test_skips_when_another_replica_claimed(self):
        with patch.object(scheduler, "_claim", new=AsyncMock(return_value=False)), \
             patch.object(scheduler, "run_once", new=AsyncMock()) as run:
            await scheduler._tick(10800)
        run.assert_not_awaited()

    async def test_a_failed_sweep_is_logged_not_raised(self, caplog):
        with patch.object(scheduler, "_claim", new=AsyncMock(return_value=True)), \
             patch.object(scheduler, "run_once", new=AsyncMock(side_effect=RuntimeError("db down"))):
            await scheduler._tick(10800)
        assert "RAG backfill: sweep failed" in caplog.text

    async def test_loop_sweeps_after_boot_then_every_interval(self, monkeypatch):
        sleeps = []

        async def fake_sleep(seconds):
            sleeps.append(seconds)
            if len(sleeps) == 3:
                raise asyncio.CancelledError

        monkeypatch.setattr(scheduler.asyncio, "sleep", fake_sleep)
        with patch.object(scheduler, "_tick", new=AsyncMock()) as tick:
            with pytest.raises(asyncio.CancelledError):
                await scheduler._loop(10800)
        assert scheduler.STARTUP_DELAY_SECONDS <= sleeps[0] <= scheduler.STARTUP_DELAY_SECONDS + scheduler.STARTUP_JITTER_SECONDS
        assert sleeps[1:] == [10800, 10800]
        assert tick.await_count == 2


class TestLifecycle:
    @pytest.mark.parametrize(("value", "hours"), [(None, 3.0), ("6", 6.0), ("0.5", 0.5), ("0", 0.0), ("soon", 3.0)])
    def test_interval_from_env(self, monkeypatch, value, hours):
        if value is None:
            monkeypatch.delenv("LEARNHOUSE_RAG_BACKFILL_HOURS", raising=False)
        else:
            monkeypatch.setenv("LEARNHOUSE_RAG_BACKFILL_HOURS", value)
        assert scheduler.interval_hours() == hours

    @pytest.mark.parametrize(("value", "size"), [(None, 500), ("50", 50), ("0", 1), ("lots", 500)])
    def test_batch_from_env(self, monkeypatch, value, size):
        if value is None:
            monkeypatch.delenv("LEARNHOUSE_RAG_BACKFILL_BATCH", raising=False)
        else:
            monkeypatch.setenv("LEARNHOUSE_RAG_BACKFILL_BATCH", value)
        assert scheduler.batch_size() == size

    async def test_start_and_stop(self, monkeypatch, caplog):
        monkeypatch.delenv("LEARNHOUSE_RAG_BACKFILL_HOURS", raising=False)
        started = asyncio.Event()

        async def fake_loop(interval):
            assert interval == 10800
            started.set()
            await asyncio.Event().wait()

        monkeypatch.setattr(scheduler, "_loop", fake_loop)
        with caplog.at_level(logging.INFO, logger=scheduler.__name__):
            scheduler.start_scheduler()
            scheduler.start_scheduler()  # idempotent
        await started.wait()
        assert "RAG backfill scheduler started (every 3h)" in caplog.text

        task = scheduler._task
        await scheduler.stop_scheduler()
        assert task.cancelled() and scheduler._task is None

    async def test_zero_disables(self, monkeypatch, caplog):
        monkeypatch.setenv("LEARNHOUSE_RAG_BACKFILL_HOURS", "0")
        with caplog.at_level(logging.INFO, logger=scheduler.__name__):
            scheduler.start_scheduler()
        assert scheduler._task is None
        assert "RAG backfill disabled" in caplog.text
        await scheduler.stop_scheduler()  # no-op
