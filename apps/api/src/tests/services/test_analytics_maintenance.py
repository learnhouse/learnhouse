"""Tests for src/services/analytics/maintenance.py and store.py.

The SQL itself is Postgres-only and is exercised against a real database by
scripts/ci_analytics_queries.py in the API Migrations workflow; these tests
cover the control flow around it.
"""

import asyncio
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession

from src.services.analytics import maintenance, store


def _result(first=None, scalar=None, rows=None, rowcount=0):
    result = MagicMock()
    result.first.return_value = first
    result.scalar.return_value = scalar
    result.all.return_value = rows or []
    result.rowcount = rowcount
    return result


def _factory(db):
    @asynccontextmanager
    async def factory():
        yield db

    return factory


def _sql(call) -> str:
    return str(call.args[0])


class TestRefreshRollups:
    async def test_first_run_rebuilds_from_the_earliest_event(self):
        db = AsyncMock()
        db.execute.side_effect = [_result(first=None), _result(scalar=datetime(2026, 3, 4, 5, tzinfo=timezone.utc))] + [
            _result()
        ] * 4
        with patch.object(maintenance, "_session_factory", return_value=_factory(db)):
            since = await maintenance.refresh_rollups()
        assert since == date(2026, 3, 4)
        statements = [_sql(c) for c in db.execute.call_args_list]
        assert any("INSERT INTO analytics_daily_actor" in s for s in statements)
        assert any("INSERT INTO analytics_hourly_count" in s for s in statements)
        db.commit.assert_awaited_once()

    async def test_first_run_without_events_starts_today(self):
        db = AsyncMock()
        db.execute.side_effect = [_result(first=None), _result(scalar=None)] + [_result()] * 4
        with patch.object(maintenance, "_session_factory", return_value=_factory(db)):
            assert await maintenance.refresh_rollups() == date.today()

    async def test_regular_run_covers_yesterday(self):
        db = AsyncMock()
        db.execute.side_effect = [_result(first=(1,))] + [_result()] * 4
        with patch.object(maintenance, "_session_factory", return_value=_factory(db)):
            since = await maintenance.refresh_rollups()
        assert (datetime.now(timezone.utc).date() - since).days == 1

    async def test_explicit_start(self):
        db = AsyncMock()
        db.execute.return_value = _result()
        with patch.object(maintenance, "_session_factory", return_value=_factory(db)):
            assert await maintenance.refresh_rollups(date(2025, 1, 1)) == date(2025, 1, 1)
        assert db.execute.await_count == 4

    def test_session_factory_is_the_app_one(self):
        from src.core.events.database import _async_session_factory

        assert maintenance._session_factory() is _async_session_factory


class TestRetention:
    async def test_delete_batched_loops_until_short_batch(self):
        db = AsyncMock()
        db.execute.side_effect = [_result(rowcount=maintenance.DELETE_BATCH), _result(rowcount=3)]
        assert await maintenance._delete_batched(db, "org_id = :o", {"o": 1}) == maintenance.DELETE_BATCH + 3
        assert db.commit.await_count == 2

    async def test_retention_groups_skip_orgs_that_lost_the_plan(self):
        db = AsyncMock()
        db.execute.return_value = _result(rows=[(1, 90), (2, 1825), (3, 1825), (4, 90)])
        with patch(
            "src.services.analytics.settings.can_extend_retention",
            new=AsyncMock(side_effect=lambda org_id, _db: org_id == 3),
        ):
            assert await maintenance._retention_groups(db) == {90: [1, 4], 1825: [3]}

    @pytest.mark.parametrize("orphans", [[], [77]])
    async def test_apply_retention(self, orphans):
        db = AsyncMock()

        async def execute(statement, params=None):
            sql = str(statement)
            if "FROM analytics_settings" in sql:
                return _result(rows=[(5, 90)])
            if "NOT EXISTS" in sql:
                return _result(rows=[(o,) for o in orphans])
            if sql.startswith("DELETE FROM analytics_event"):
                return _result(rowcount=2)
            return _result()

        db.execute.side_effect = execute
        with patch.object(maintenance, "_session_factory", return_value=_factory(db)):
            deleted = await maintenance.apply_retention()
        # default orgs + the 90-day group (+ orphans)
        assert deleted == 2 * (3 if orphans else 2)
        summary_deletes = [c for c in db.execute.call_args_list if "analytics_daily_actor WHERE" in _sql(c)]
        assert len(summary_deletes) == (4 if orphans else 3)


class TestScheduling:
    def test_enabled(self, monkeypatch):
        monkeypatch.delenv("LEARNHOUSE_ANALYTICS_MAINTENANCE", raising=False)
        assert maintenance.enabled() is True
        monkeypatch.setenv("LEARNHOUSE_ANALYTICS_MAINTENANCE", "off")
        assert maintenance.enabled() is False

    async def test_claim_without_redis_runs_each_window_once(self):
        maintenance._last_windows.clear()
        with patch("src.core.redis.get_redis_client", return_value=None):
            assert await maintenance._claim("x", 1, 60) is True
            assert await maintenance._claim("x", 1, 60) is False
            assert await maintenance._claim("x", 2, 60) is True

    async def test_claim_with_redis(self):
        client = MagicMock()
        client.set.return_value = True
        with patch("src.core.redis.get_redis_client", return_value=client):
            assert await maintenance._claim("rollup", 9, 300) is True
        client.set.assert_called_once_with("learnhouse:analytics:rollup:9", "1", nx=True, ex=300)
        client.set.side_effect = RuntimeError("down")
        with patch("src.core.redis.get_redis_client", return_value=client):
            assert await maintenance._claim("rollup", 10, 300) is False

    async def test_tick_runs_claimed_jobs_and_survives_failures(self):
        with patch.object(maintenance, "_claim", new=AsyncMock(return_value=True)), patch.object(
            maintenance, "refresh_rollups", new=AsyncMock()
        ) as refresh, patch.object(maintenance, "apply_retention", new=AsyncMock()) as retention:
            await maintenance.tick(datetime(2026, 1, 1, tzinfo=timezone.utc))
            refresh.assert_awaited_once()
            retention.assert_awaited_once()
            refresh.side_effect = RuntimeError("boom")
            await maintenance.tick()
            refresh.side_effect = asyncio.CancelledError()
            with pytest.raises(asyncio.CancelledError):
                await maintenance.tick()

    async def test_loop(self):
        with patch.object(maintenance.asyncio, "sleep", new=AsyncMock(side_effect=[None, asyncio.CancelledError()])), patch.object(
            maintenance, "tick", new=AsyncMock()
        ) as tick:
            with pytest.raises(asyncio.CancelledError):
                await maintenance._loop()
        tick.assert_awaited_once()

    async def test_start_and_stop(self, monkeypatch):
        monkeypatch.setenv("LEARNHOUSE_ANALYTICS_MAINTENANCE", "false")
        maintenance.start_scheduler()
        assert maintenance._task is None

        monkeypatch.delenv("LEARNHOUSE_ANALYTICS_MAINTENANCE")
        with patch.object(maintenance, "_loop", new=AsyncMock(side_effect=lambda: asyncio.sleep(3600))), patch(
            "src.services.analytics.analytics.flush", new=AsyncMock()
        ) as flush:
            maintenance.start_scheduler()
            assert maintenance._task is not None
            await maintenance.stop_scheduler()
            assert maintenance._task is None
            await maintenance.stop_scheduler()  # nothing running: just flushes
        assert flush.await_count == 2


class TestStore:
    def test_jsonable(self):
        assert store._jsonable(Decimal("1.5")) == 1.5
        assert store._jsonable(float("nan")) is None
        assert store._jsonable(datetime(2026, 1, 2, 3, 4, 5)) == "2026-01-02 03:04:05"
        assert store._jsonable(date(2026, 1, 2)) == "2026-01-02"
        assert store._jsonable("x") == "x"

    async def test_run_query_on_sqlite(self, engine):
        factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        with patch("src.core.events.database._async_session_factory", factory):
            rows = await store.run_query("SELECT :a AS a, 2.5 AS b", {"a": 1})
        assert rows == [{"a": 1, "b": 2.5}]

    async def test_run_query_sets_timeout_on_postgres(self):
        db = AsyncMock()
        db.bind = MagicMock()
        db.bind.dialect.name = "postgresql"
        db.execute.side_effect = [_result(), []]
        with patch("src.core.events.database._async_session_factory", _factory(db)):
            assert await store.run_query("SELECT 1", {}) == []
        assert "statement_timeout" in _sql(db.execute.call_args_list[0])
