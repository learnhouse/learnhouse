"""Tests for src/services/messaging/scheduler.py: the unread-email and
reminder loops, the per-window lock, and start/stop."""

import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.messaging import scheduler
from src.services.messaging.notify import NotifyStats


class FakeSession:
    async def __aenter__(self):
        return "db"

    async def __aexit__(self, *exc):
        return False


def _sleeps(n):
    """An asyncio.sleep stand-in that returns n times, then cancels."""
    calls = []

    async def sleep(seconds):
        calls.append(seconds)
        if len(calls) > n:
            raise asyncio.CancelledError

    return sleep, calls


def test_lock_key_uses_five_minute_windows():
    now = datetime(2026, 11, 3, 14, 37, tzinfo=timezone.utc)
    assert scheduler._lock_key(now) == "learnhouse:messaging:unread:2026-11-03T14:7"


async def test_claim_without_redis_runs():
    with patch("src.core.redis.get_redis_client", return_value=None):
        assert await scheduler._claim(datetime.now(timezone.utc)) is True


async def test_claim_uses_redis_lock():
    client = MagicMock()
    client.set.return_value = None
    with patch("src.core.redis.get_redis_client", return_value=client):
        assert await scheduler._claim(datetime.now(timezone.utc)) is False
    _, kwargs = client.set.call_args
    assert kwargs == {"nx": True, "ex": scheduler._LOCK_TTL_SECONDS}


async def test_tick_skips_when_lock_is_held():
    run = AsyncMock()
    with patch.object(scheduler, "_claim", AsyncMock(return_value=False)), \
         patch("src.services.messaging.notify.run_unread_emails", run):
        await scheduler._tick()
    run.assert_not_called()


@pytest.mark.parametrize("stats", [NotifyStats(emails=2, failed=1), NotifyStats()])
async def test_tick_runs_unread_emails(stats):
    run = AsyncMock(return_value=stats)
    with patch.object(scheduler, "_claim", AsyncMock(return_value=True)), \
         patch("src.core.events.database._async_session_factory", FakeSession), \
         patch("src.services.messaging.notify.run_unread_emails", run):
        await scheduler._tick()
    assert run.call_args.args[0] == "db"


async def test_tick_swallows_errors():
    run = AsyncMock(side_effect=RuntimeError("boom"))
    with patch.object(scheduler, "_claim", AsyncMock(return_value=True)), \
         patch("src.core.events.database._async_session_factory", FakeSession), \
         patch("src.services.messaging.notify.run_unread_emails", run):
        await scheduler._tick()
    run.assert_awaited_once()


async def test_tick_propagates_cancel():
    with patch.object(scheduler, "_claim", AsyncMock(side_effect=asyncio.CancelledError)):
        with pytest.raises(asyncio.CancelledError):
            await scheduler._tick()


async def test_loop_waits_then_ticks():
    sleep, calls = _sleeps(1)
    tick = AsyncMock()
    with patch.object(scheduler.asyncio, "sleep", sleep), patch.object(scheduler, "_tick", tick):
        with pytest.raises(asyncio.CancelledError):
            await scheduler._loop()
    assert calls == [scheduler.STARTUP_DELAY_SECONDS, scheduler.INTERVAL_SECONDS]
    tick.assert_awaited_once()


@pytest.mark.parametrize("sent", [3, 0])
async def test_reminder_loop_delivers(sent):
    sleep, calls = _sleeps(1)
    deliver = AsyncMock(return_value=sent)
    with patch.object(scheduler.asyncio, "sleep", sleep), \
         patch("src.core.events.database._async_session_factory", FakeSession), \
         patch("src.services.messaging.reminders.deliver_due", deliver):
        with pytest.raises(asyncio.CancelledError):
            await scheduler._reminder_loop()
    assert calls == [scheduler.STARTUP_DELAY_SECONDS / 2, scheduler.REMINDER_INTERVAL_SECONDS]
    deliver.assert_awaited_once_with("db")


async def test_reminder_loop_survives_errors():
    sleep, _ = _sleeps(2)
    deliver = AsyncMock(side_effect=[RuntimeError("boom"), 1])
    with patch.object(scheduler.asyncio, "sleep", sleep), \
         patch("src.core.events.database._async_session_factory", FakeSession), \
         patch("src.services.messaging.reminders.deliver_due", deliver):
        with pytest.raises(asyncio.CancelledError):
            await scheduler._reminder_loop()
    assert deliver.await_count == 2


async def test_reminder_loop_propagates_cancel():
    sleep, _ = _sleeps(1)
    deliver = AsyncMock(side_effect=asyncio.CancelledError)
    with patch.object(scheduler.asyncio, "sleep", sleep), \
         patch("src.core.events.database._async_session_factory", FakeSession), \
         patch("src.services.messaging.reminders.deliver_due", deliver):
        with pytest.raises(asyncio.CancelledError):
            await scheduler._reminder_loop()
    deliver.assert_awaited_once()


@pytest.mark.parametrize("env", [{"TESTING": "true"}, {"LEARNHOUSE_MESSAGING_EMAILS_DISABLED": "1"}])
async def test_start_scheduler_idle_when_disabled(monkeypatch, env):
    monkeypatch.delenv("TESTING", raising=False)
    monkeypatch.delenv("LEARNHOUSE_MESSAGING_EMAILS_DISABLED", raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setattr(scheduler, "_task", None)
    monkeypatch.setattr(scheduler, "_reminder_task", None)
    scheduler.start_scheduler()
    assert scheduler._task is None and scheduler._reminder_task is None


async def test_start_and_stop_scheduler(monkeypatch):
    monkeypatch.delenv("TESTING", raising=False)
    monkeypatch.delenv("LEARNHOUSE_MESSAGING_EMAILS_DISABLED", raising=False)
    monkeypatch.setattr(scheduler, "_task", None)
    monkeypatch.setattr(scheduler, "_reminder_task", None)

    async def forever():
        await asyncio.Event().wait()

    monkeypatch.setattr(scheduler, "_loop", forever)
    monkeypatch.setattr(scheduler, "_reminder_loop", forever)
    scheduler.start_scheduler()
    tasks = (scheduler._task, scheduler._reminder_task)
    assert all(isinstance(t, asyncio.Task) for t in tasks)

    await scheduler.stop_scheduler()
    assert all(t.cancelled() for t in tasks)
    assert scheduler._task is None and scheduler._reminder_task is None


async def test_stop_scheduler_without_tasks(monkeypatch):
    monkeypatch.setattr(scheduler, "_task", None)
    monkeypatch.setattr(scheduler, "_reminder_task", None)
    await scheduler.stop_scheduler()
    assert scheduler._task is None


def test_start_scheduler_never_raises(monkeypatch):
    monkeypatch.delenv("TESTING", raising=False)
    monkeypatch.delenv("LEARNHOUSE_MESSAGING_EMAILS_DISABLED", raising=False)
    monkeypatch.setattr(scheduler, "_task", None)
    monkeypatch.setattr(scheduler, "_loop", MagicMock())
    # No running loop: create_task raises and is logged.
    scheduler.start_scheduler()
    assert scheduler._task is None
