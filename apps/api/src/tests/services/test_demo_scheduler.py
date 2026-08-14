"""The tick that keeps the demo fresh.

Nothing here touches the database — the sync itself is covered in
test_demo_sync.py. What matters at this level is that the scheduler cannot take
the API down with it: it must not raise during startup, must not die on a failed
refresh, and must not have every replica of a rolling deploy provision the same
organization at once.
"""

import asyncio
from datetime import datetime, timezone

import pytest

from src.services.demo import scheduler


@pytest.fixture(autouse=True)
def _no_task():
    """Leave module state clean, whatever a test does to it."""
    scheduler._task = None
    yield
    scheduler._task = None


@pytest.fixture
def demo_on(monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_DEMO_ENABLED", "1")
    monkeypatch.delenv("LEARNHOUSE_DEMO_NO_SCHEDULER", raising=False)


# ---------------------------------------------------------------------------
# the interval lock
# ---------------------------------------------------------------------------

def test_lock_key_is_one_bucket_per_interval():
    """Two moments in the same interval must claim the same key."""
    early = datetime(2026, 8, 14, 12, 0, 5, tzinfo=timezone.utc)
    late = datetime(2026, 8, 14, 12, 9, 59, tzinfo=timezone.utc)
    later = datetime(2026, 8, 14, 12, 10, 1, tzinfo=timezone.utc)

    assert scheduler._lock_key(early, 10) == scheduler._lock_key(late, 10)
    assert scheduler._lock_key(early, 10) != scheduler._lock_key(later, 10)


async def test_claim_succeeds_when_redis_grants_the_key(monkeypatch):
    calls = {}

    class _Client:
        def set(self, key, value, nx=False, ex=None):
            calls["key"] = key
            calls["nx"] = nx
            calls["ex"] = ex
            return True

    monkeypatch.setattr("src.core.redis.get_redis_client", lambda: _Client())

    assert await scheduler._claim(datetime.now(timezone.utc), 10) is True
    assert calls["nx"] is True
    # Expire inside the interval so the next bucket is claimable even if the
    # holder dies.
    assert calls["ex"] < 10 * 60


async def test_claim_fails_when_another_replica_holds_the_key(monkeypatch):
    class _Client:
        def set(self, *args, **kwargs):
            return None  # redis SET NX returns nil when the key exists

    monkeypatch.setattr("src.core.redis.get_redis_client", lambda: _Client())

    assert await scheduler._claim(datetime.now(timezone.utc), 10) is False


async def test_claim_runs_anyway_when_redis_is_absent(monkeypatch):
    """A missing lock must not mean a missing refresh.

    The sync is idempotent, so a second run is wasted work; skipping the
    refresh would leave a vandalised demo up until someone noticed.
    """
    monkeypatch.setattr("src.core.redis.get_redis_client", lambda: None)
    assert await scheduler._claim(datetime.now(timezone.utc), 10) is True


async def test_claim_runs_anyway_when_redis_raises(monkeypatch):
    def _boom():
        raise RuntimeError("redis is down")

    monkeypatch.setattr("src.core.redis.get_redis_client", _boom)
    assert await scheduler._claim(datetime.now(timezone.utc), 10) is True


# ---------------------------------------------------------------------------
# starting and stopping
# ---------------------------------------------------------------------------

async def test_start_does_nothing_when_the_demo_is_off(monkeypatch):
    """Async on purpose: a sync test has no running event loop, so
    start_scheduler would fail at create_task and leave _task None whatever the
    flag said — the assertion would hold with the guard deleted."""
    monkeypatch.delenv("LEARNHOUSE_DEMO_ENABLED", raising=False)

    scheduler.start_scheduler()

    assert scheduler._task is None


async def test_start_does_nothing_when_the_scheduler_is_disabled(monkeypatch, demo_on):
    """The operator drives `demo-sync` from their own cron instead.

    Async for the same reason as the test above.
    """
    monkeypatch.setenv("LEARNHOUSE_DEMO_NO_SCHEDULER", "1")

    scheduler.start_scheduler()

    assert scheduler._task is None


async def test_start_never_raises_during_application_startup(monkeypatch, demo_on):
    """A broken demo must not stop the API from booting.

    The failure is injected at the first thing start_scheduler does, so this
    exercises the guard rather than incidentally tripping over there being no
    running event loop.
    """
    def _boom():
        raise RuntimeError("flag lookup exploded")

    monkeypatch.setattr(scheduler.flags, "demo_enabled", _boom)

    scheduler.start_scheduler()  # must not raise
    assert scheduler._task is None


async def test_start_schedules_the_loop_and_stop_cancels_it(monkeypatch, demo_on):
    started = asyncio.Event()

    async def _fake_loop():
        started.set()
        await asyncio.sleep(3600)

    monkeypatch.setattr(scheduler, "_loop", _fake_loop)

    scheduler.start_scheduler()
    assert scheduler._task is not None
    await asyncio.wait_for(started.wait(), timeout=2)

    await scheduler.stop_scheduler()
    assert scheduler._task is None


async def test_stop_is_a_no_op_when_nothing_is_running():
    await scheduler.stop_scheduler()  # must not raise
    assert scheduler._task is None


# ---------------------------------------------------------------------------
# the loop
# ---------------------------------------------------------------------------

async def test_boot_sync_goes_through_the_lock(monkeypatch):
    """Otherwise a rolling deploy has every replica provisioning at once.

    On a database with no demo yet they all reach the same INSERT, and the org
    slug is unique — so all but one crash, and the winner can lose its uploads
    to the others' rollbacks.
    """
    claims = []
    runs = []

    async def _claim(now, interval):
        claims.append(interval)
        return False  # somebody else holds this bucket

    async def _run_once():
        runs.append(1)

    monkeypatch.setattr(scheduler, "_claim", _claim)
    monkeypatch.setattr(scheduler, "_run_once", _run_once)
    monkeypatch.setattr(scheduler, "STARTUP_JITTER_SECONDS", 0)
    monkeypatch.setattr(scheduler.flags, "refresh_minutes", lambda: 10)

    task = asyncio.create_task(scheduler._loop())
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert claims, "the boot run did not try to claim the lock"
    assert runs == [], "the boot run ignored a lock somebody else holds"


async def test_boot_sync_runs_when_it_wins_the_lock(monkeypatch):
    runs = []

    async def _claim(now, interval):
        return True

    async def _run_once():
        runs.append(1)

    monkeypatch.setattr(scheduler, "_claim", _claim)
    monkeypatch.setattr(scheduler, "_run_once", _run_once)
    monkeypatch.setattr(scheduler, "STARTUP_JITTER_SECONDS", 0)
    monkeypatch.setattr(scheduler.flags, "refresh_minutes", lambda: 10)

    task = asyncio.create_task(scheduler._loop())
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert runs == [1]


async def test_a_failed_refresh_does_not_kill_the_loop(monkeypatch):
    """A loop that dies stops refreshing until the next deploy, silently."""
    attempts = []

    async def _claim(now, interval):
        return True

    async def _run_once():
        attempts.append(1)
        raise RuntimeError("sync blew up")

    monkeypatch.setattr(scheduler, "_claim", _claim)
    monkeypatch.setattr(scheduler, "_run_once", _run_once)
    monkeypatch.setattr(scheduler, "STARTUP_JITTER_SECONDS", 0)
    monkeypatch.setattr(scheduler.flags, "refresh_minutes", lambda: 10)

    # Collapse the wait between ticks so the loop comes round again
    # immediately. Patched through the module path rather than
    # `scheduler.asyncio`, which is the stdlib module object itself — setting an
    # attribute on it would rebind asyncio.sleep for the whole process.
    real_sleep = asyncio.sleep

    async def _fast_sleep(delay, result=None):
        return await real_sleep(0, result)

    monkeypatch.setattr("asyncio.sleep", _fast_sleep)

    task = asyncio.create_task(scheduler._loop())
    await real_sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert len(attempts) > 1, "the loop stopped after the first failure"


async def test_a_refresh_that_changed_something_says_so(monkeypatch, caplog):
    """The quiet path is DEBUG; a refresh that moved rows has to be visible.

    Without this line an operator watching the logs cannot tell a demo that is
    being vandalised and repaired from one nobody has touched.
    """
    import logging
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def _factory():
        yield "session"

    class _Stats:
        provisioned = False
        epoch = "2026-08-09"
        created = 0
        updated = 3
        drift_deleted = 2

    async def _sync(session):
        return _Stats()

    monkeypatch.setattr("src.core.events.database._async_session_factory", _factory)
    monkeypatch.setattr("src.services.demo.sync.sync_demo", _sync)

    with caplog.at_level(logging.DEBUG, logger=scheduler.logger.name):
        await scheduler._run_once()

    messages = [r.getMessage() for r in caplog.records if r.levelno >= logging.INFO]
    assert any("drift=2" in m for m in messages), messages


async def test_a_first_provision_is_announced(monkeypatch, caplog):
    import logging
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def _factory():
        yield "session"

    class _Stats:
        provisioned = True
        epoch = "2026-08-09"
        created = 3700
        updated = 0
        drift_deleted = 0

    async def _sync(session):
        return _Stats()

    monkeypatch.setattr("src.core.events.database._async_session_factory", _factory)
    monkeypatch.setattr("src.services.demo.sync.sync_demo", _sync)

    with caplog.at_level(logging.DEBUG, logger=scheduler.logger.name):
        await scheduler._run_once()

    messages = [r.getMessage() for r in caplog.records if r.levelno >= logging.INFO]
    assert any("provisioned" in m for m in messages), messages


async def test_cancelling_the_loop_during_a_tick_propagates(monkeypatch):
    """Shutdown must actually stop it, not be swallowed as a failed refresh.

    Both try blocks re-raise CancelledError ahead of the broad handler; if that
    ordering were reversed, stop_scheduler would hang waiting for a task that
    kept looping.
    """
    started = asyncio.Event()

    async def _claim(now, interval):
        return True

    async def _run_once():
        started.set()
        await asyncio.sleep(3600)

    monkeypatch.setattr(scheduler, "_claim", _claim)
    monkeypatch.setattr(scheduler, "_run_once", _run_once)
    monkeypatch.setattr(scheduler, "STARTUP_JITTER_SECONDS", 0)
    monkeypatch.setattr(scheduler.flags, "refresh_minutes", lambda: 10)

    task = asyncio.create_task(scheduler._loop())
    await asyncio.wait_for(started.wait(), timeout=2)
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task


async def test_cancelling_during_a_steady_state_tick_propagates(monkeypatch):
    """The steady-state loop has its own cancellation handler.

    The boot tick's is covered above; this is the one that runs for the life of
    the process. The cancel has to land *inside* the tick rather than during the
    wait between ticks, since only the tick is wrapped in the try — and if that
    handler swallowed CancelledError, shutdown would hang on a task that kept
    looping.
    """
    calls = {"claims": 0}
    in_the_tick = asyncio.Event()

    async def _claim(now, interval):
        calls["claims"] += 1
        # Skip the boot tick so the loop reaches its steady-state body.
        return calls["claims"] > 1

    async def _run_once():
        in_the_tick.set()
        await asyncio.sleep(3600)

    monkeypatch.setattr(scheduler, "_claim", _claim)
    monkeypatch.setattr(scheduler, "_run_once", _run_once)
    monkeypatch.setattr(scheduler, "STARTUP_JITTER_SECONDS", 0)
    monkeypatch.setattr(scheduler.flags, "refresh_minutes", lambda: 10)

    real_sleep = asyncio.sleep

    async def _fast_sleep(delay, result=None):
        # Collapse only the wait between ticks; _run_once above must still block.
        if delay == 10 * 60:
            return await real_sleep(0, result)
        return await real_sleep(delay, result)

    monkeypatch.setattr("asyncio.sleep", _fast_sleep)

    task = asyncio.create_task(scheduler._loop())
    await asyncio.wait_for(in_the_tick.wait(), timeout=2)
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task
