"""Tests for src/services/analytics/analytics.py (the buffered event writer)."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession

from src.services.analytics import analytics

# The autouse ``analytics_queue`` fixture replaces ``_schedule``; keep the real one.
_REAL_SCHEDULE = analytics._schedule


class TestBuildRow:
    def test_uncatalogued_event_is_dropped(self):
        assert analytics.build_row("made_up_event", 1) is None

    def test_columns_and_catalogued_properties(self):
        row = analytics.build_row(
            "activity_view",
            org_id="7",
            user_id=3,
            session_id="s" * 80,
            properties={
                "course_uuid": "course_1",
                "activity_uuid": 42,
                "path": "",
                "activity_type": "TYPE_VIDEO",
                "email": "someone@example.com",
                "seconds_spent": "12",
            },
            source="web",
            country="fr",
            device="mobile",
        )
        assert row["org_id"] == 7
        assert row["actor_key"] == "u:3"
        assert len(row["session_id"]) == 64
        assert row["course_uuid"] == "course_1"
        assert row["activity_uuid"] == "42"
        assert row["path"] is None
        assert row["country"] == "FR"
        assert row["device"] == "mobile"
        assert row["seconds_spent"] == 12.0
        # Only catalogued, non-column properties end up in JSONB.
        assert row["properties"] == {"activity_type": "TYPE_VIDEO"}

    def test_anonymous_row_uses_given_actor_and_no_geo(self):
        row = analytics.build_row("page_view", 1, actor_key="v:abc", properties={"path": "/x"})
        assert row["user_id"] == 0
        assert row["actor_key"] == "v:abc"
        assert row["country"] is None and row["device"] is None
        assert row["seconds_spent"] is None

    def test_property_values_are_cleaned(self):
        row = analytics.build_row(
            "assignment_graded",
            1,
            user_id=1,
            properties={
                "grade": float("nan"),
                "max_grade": 20,
                "passed": True,
                "assignment_uuid": "a" * 600,
                "attempt": {"nested": 1},
            },
        )
        props = row["properties"]
        assert "grade" not in props
        assert props["max_grade"] == 20
        assert props["passed"] is True
        assert len(props["assignment_uuid"]) == analytics.MAX_STRING

    @pytest.mark.parametrize(
        "value,expected",
        [("abc", None), (None, None), (-5, None), (0, None), (float("inf"), None), (99999, 14400.0), (30.5, 30.5)],
    )
    def test_seconds_spent(self, value, expected):
        assert analytics._seconds(value) == expected

    def test_clean_value_none(self):
        assert analytics._clean_value(None) is None

    def test_non_scalar_properties_are_dropped(self):
        row = analytics.build_row("assignment_submitted", 1, user_id=1, properties={"attempt": {"n": 1}})
        assert row["properties"] == {}


class TestTrack:
    async def test_track_queues_a_row(self, analytics_queue):
        await analytics.track("course_enrolled", 1, user_id=2, properties={"course_uuid": "c"})
        assert len(analytics_queue) == 1
        assert analytics_queue[0]["event_name"] == "course_enrolled"

    async def test_track_ignores_uncatalogued_events(self, analytics_queue):
        await analytics.track("nope", 1)
        assert analytics_queue == []

    async def test_track_swallows_bad_input(self, analytics_queue):
        await analytics.track("course_enrolled", org_id="not-a-number")
        assert analytics_queue == []


class TestQueue:
    def test_enqueue_drops_when_full(self, analytics_queue):
        analytics_queue.extend([{}] * analytics.MAX_QUEUED)
        analytics.enqueue([{"x": 1}])
        assert len(analytics_queue) == analytics.MAX_QUEUED

    def test_enqueue_flushes_now_when_buffer_is_large(self, analytics_queue):
        with patch.object(analytics, "_schedule") as schedule:
            analytics.enqueue([{}] * analytics.MAX_BUFFER)
            schedule.assert_called_once_with(0)
            analytics.enqueue([{}])
            schedule.assert_called_with(0)
        analytics_queue.clear()
        with patch.object(analytics, "_schedule") as schedule:
            analytics.enqueue([{}])
            schedule.assert_called_once_with(analytics.FLUSH_INTERVAL_SECONDS)

    async def test_schedule_reuses_pending_delayed_flush(self):
        with patch.object(analytics, "_flush_after", new=AsyncMock()) as flush_after:
            _REAL_SCHEDULE(5)
            first = analytics._flush_task
            _REAL_SCHEDULE(5)
            assert analytics._flush_task is first
            _REAL_SCHEDULE(0)
            assert analytics._flush_task is not first
            await asyncio.gather(*list(analytics._background_tasks))
        assert flush_after.await_count == 2

    async def test_flush_after_waits_then_flushes(self):
        with patch.object(analytics.asyncio, "sleep", new=AsyncMock()) as sleep, patch.object(
            analytics, "flush", new=AsyncMock()
        ) as flush:
            await analytics._flush_after(1.0)
            await analytics._flush_after(0)
        sleep.assert_awaited_once_with(1.0)
        assert flush.await_count == 2


class TestFlush:
    async def test_flush_with_empty_queue_is_a_no_op(self):
        with patch("src.core.events.database._async_session_factory") as factory:
            await analytics.flush()
        factory.assert_not_called()

    async def test_flush_writes_rows(self, engine, analytics_queue):
        factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        await analytics.track("page_view", 1, actor_key="v:1", properties={"path": "/a"})
        await analytics.track("course_enrolled", 1, user_id=4, properties={"course_uuid": "c1"})
        with patch("src.core.events.database._async_session_factory", factory):
            await analytics.flush()
        assert analytics_queue == []
        async with factory() as db:
            rows = (await db.execute(text("SELECT event_name, user_id, path FROM analytics_event ORDER BY id"))).all()
        assert rows == [("page_view", 0, "/a"), ("course_enrolled", 4, None)]

    async def test_flush_swallows_database_errors(self, analytics_queue):
        broken = MagicMock(side_effect=RuntimeError("db down"))
        analytics_queue.append({"event_name": "page_view"})
        with patch("src.core.events.database._async_session_factory", broken), patch.object(
            analytics.logger, "warning"
        ) as warning:
            await analytics.flush()
        warning.assert_called_once()
        assert analytics_queue == []
