"""Tests for the in-app daily tick and the first-run auto-seed.

Together these are what let the feature work from a deploy alone, with no cron
to schedule and no command to remember to run first.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from src.services.nudges import scheduler

NOW = datetime(2026, 7, 28, 12, 0, 0, tzinfo=timezone.utc)


class TestNextRunTiming:
    def test_waits_until_this_morning_when_still_early(self):
        early = NOW.replace(hour=3)
        seconds = scheduler._seconds_until_next_run(early)
        assert seconds == pytest.approx((scheduler.RUN_AT_HOUR_UTC - 3) * 3600)

    def test_rolls_to_tomorrow_once_the_hour_has_passed(self):
        late = NOW.replace(hour=20)
        seconds = scheduler._seconds_until_next_run(late)
        assert 0 < seconds <= 24 * 3600

    def test_exactly_on_the_hour_waits_a_full_day(self):
        """Otherwise a pod restarting at 09:00 would run again immediately."""
        on_hour = NOW.replace(hour=scheduler.RUN_AT_HOUR_UTC, minute=0, second=0, microsecond=0)
        assert scheduler._seconds_until_next_run(on_hour) == 24 * 3600


class TestDayLock:
    async def test_first_pod_claims_the_day(self, monkeypatch):
        client = type("R", (), {"set": lambda self, *a, **k: True})()
        monkeypatch.setattr("src.core.redis.get_redis_client", lambda: client)

        assert await scheduler._claim_day(NOW) is True

    async def test_second_pod_is_turned_away(self, monkeypatch):
        client = type("R", (), {"set": lambda self, *a, **k: None})()
        monkeypatch.setattr("src.core.redis.get_redis_client", lambda: client)

        assert await scheduler._claim_day(NOW) is False

    async def test_absent_redis_still_runs(self, monkeypatch):
        """The ledger already guarantees a nudge is sent once, so running
        without the lock is wasteful rather than wrong — and silently doing
        nothing would be worse."""
        monkeypatch.setattr("src.core.redis.get_redis_client", lambda: None)

        assert await scheduler._claim_day(NOW) is True

    async def test_a_broken_redis_still_runs(self, monkeypatch):
        def explode():
            raise RuntimeError("redis down")

        monkeypatch.setattr("src.core.redis.get_redis_client", explode)

        assert await scheduler._claim_day(NOW) is True

    def test_the_lock_is_scoped_to_the_day(self):
        assert scheduler._lock_key(NOW) != scheduler._lock_key(NOW + timedelta(days=1))
        assert scheduler._lock_key(NOW) == scheduler._lock_key(NOW.replace(hour=23))


class TestIdleLogging:
    """Silence is what made this undebuggable: an instance that decides not to
    run must say so."""

    def test_says_so_when_the_flag_is_unset(self, monkeypatch, caplog):
        monkeypatch.setenv("LEARNHOUSE_NUDGES_ENABLED", "false")
        scheduler._task = None
        with caplog.at_level("INFO"):
            scheduler.start_scheduler()
        assert "LEARNHOUSE_NUDGES_ENABLED" in caplog.text

    def test_says_so_when_the_deployment_is_not_saas(self, monkeypatch, caplog):
        monkeypatch.setenv("LEARNHOUSE_NUDGES_ENABLED", "true")
        monkeypatch.setattr(
            "src.core.deployment_mode.get_deployment_mode", lambda: "oss"
        )
        scheduler._task = None
        with caplog.at_level("INFO"):
            scheduler.start_scheduler()
        assert "not 'saas'" in caplog.text


class TestStartGating:
    @pytest.fixture(autouse=True)
    def _clean(self, monkeypatch):
        monkeypatch.delenv("LEARNHOUSE_NUDGES_NO_SCHEDULER", raising=False)
        scheduler._task = None
        yield
        scheduler._task = None

    def test_does_not_start_when_the_feature_is_off(self, monkeypatch):
        monkeypatch.setenv("LEARNHOUSE_NUDGES_ENABLED", "false")
        scheduler.start_scheduler()
        assert scheduler._task is None

    def test_does_not_start_outside_saas(self, monkeypatch):
        monkeypatch.setenv("LEARNHOUSE_NUDGES_ENABLED", "true")
        monkeypatch.setattr(
            "src.core.deployment_mode.get_deployment_mode", lambda: "oss"
        )
        scheduler.start_scheduler()
        assert scheduler._task is None

    def test_can_be_opted_out_of(self, monkeypatch):
        """For deployments that would rather drive the CLI from their own cron."""
        monkeypatch.setenv("LEARNHOUSE_NUDGES_ENABLED", "true")
        monkeypatch.setattr(
            "src.core.deployment_mode.get_deployment_mode", lambda: "saas"
        )
        monkeypatch.setenv("LEARNHOUSE_NUDGES_NO_SCHEDULER", "1")
        scheduler.start_scheduler()
        assert scheduler._task is None

    async def test_starts_when_enabled_on_saas(self, monkeypatch):
        monkeypatch.setenv("LEARNHOUSE_NUDGES_ENABLED", "true")
        monkeypatch.setattr(
            "src.core.deployment_mode.get_deployment_mode", lambda: "saas"
        )
        scheduler.start_scheduler()
        assert scheduler._task is not None
        await scheduler.stop_scheduler()
        assert scheduler._task is None

    async def test_stopping_when_never_started_is_harmless(self):
        await scheduler.stop_scheduler()


class TestRunOnce:
    async def test_reports_a_seeding_run_distinctly(self, monkeypatch, caplog):
        from src.services.nudges.runner import RunStats

        stats = RunStats()
        stats.auto_seeded = True

        monkeypatch.setattr(
            "src.services.nudges.runner.run_nudges", AsyncMock(return_value=stats)
        )
        with patch("src.core.events.database._async_session_factory"):
            with caplog.at_level("INFO"):
                await scheduler._run_once()

        assert "seeded" in caplog.text


class TestAutoSeed:
    async def test_the_first_run_seeds_instead_of_sending(
        self, db, org, admin_role, admin_user, monkeypatch
    ):
        """No prerequisite command: the first run consumes the backlog itself,
        so switching the feature on cannot fire a year of accumulated state."""
        from sqlmodel import select

        from src.db.nudges import NudgeSend, NudgeSendStatus
        from src.db.users import User
        from src.services.nudges import runner as runner_module
        from src.services.nudges.runner import run_nudges

        org.creation_date = str((NOW - timedelta(days=1.5)).replace(tzinfo=None))
        org.update_date = org.creation_date
        db.add(org)
        row = (await db.execute(select(User).where(User.id == admin_user.id))).scalars().first()
        row.email_verified = True
        db.add(row)
        await db.commit()

        monkeypatch.setenv("LEARNHOUSE_NUDGES_ENABLED", "true")
        monkeypatch.setattr(runner_module, "get_deployment_mode", lambda: "saas")

        with patch("src.services.nudges.runner.send_nudge_email") as sender:
            stats = await run_nudges(db, now=NOW)

        assert stats.auto_seeded is True
        assert stats.sent == 0
        sender.assert_not_called()

        rows = (await db.execute(select(NudgeSend))).scalars().all()
        assert rows and all(r.status == NudgeSendStatus.SUPPRESSED for r in rows)

    async def test_the_second_run_sends_normally(
        self, db, org, admin_role, admin_user, monkeypatch
    ):
        from sqlmodel import select

        from src.db.users import User
        from src.services.nudges import runner as runner_module
        from src.services.nudges.runner import run_nudges

        org.creation_date = str((NOW - timedelta(days=1.5)).replace(tzinfo=None))
        org.update_date = org.creation_date
        db.add(org)
        row = (await db.execute(select(User).where(User.id == admin_user.id))).scalars().first()
        row.email_verified = True
        db.add(row)
        await db.commit()

        monkeypatch.setenv("LEARNHOUSE_NUDGES_ENABLED", "true")
        monkeypatch.setattr(runner_module, "get_deployment_mode", lambda: "saas")
        monkeypatch.setattr(
            runner_module.links, "org_base_url", AsyncMock(return_value="https://a.test")
        )
        monkeypatch.setattr(
            runner_module, "get_media_base_url", lambda _r=None: "https://api.test"
        )

        with patch("src.services.nudges.runner.send_nudge_email") as sender:
            first = await run_nudges(db, now=NOW)
            # A day later, a newly-eligible org is reached normally.
            second = await run_nudges(db, now=NOW + timedelta(days=1))

        assert first.auto_seeded is True
        assert second.auto_seeded is False
        assert sender.call_count == second.sent


class TestRunsOnBoot:
    async def test_it_runs_without_waiting_for_the_scheduled_hour(self, monkeypatch):
        """A pod restarts on every deploy. A loop that sleeps until a fixed
        hour resets that timer each time, so on a daily-or-faster deploy
        cadence it would never fire at all."""
        import asyncio

        monkeypatch.setattr(scheduler, "STARTUP_DELAY_SECONDS", 0)
        monkeypatch.setattr(scheduler, "_seconds_until_next_run", lambda _now: 3600)
        monkeypatch.setattr(scheduler, "_claim_day", AsyncMock(return_value=True))
        ran = AsyncMock()
        monkeypatch.setattr(scheduler, "_run_once", ran)

        task = asyncio.create_task(scheduler._loop())
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        ran.assert_awaited_once()

    async def test_a_restart_does_not_send_twice(self, monkeypatch):
        """The day-lock is what makes running on every boot free."""
        import asyncio

        monkeypatch.setattr(scheduler, "STARTUP_DELAY_SECONDS", 0)
        monkeypatch.setattr(scheduler, "_seconds_until_next_run", lambda _now: 3600)
        monkeypatch.setattr(scheduler, "_claim_day", AsyncMock(return_value=False))
        ran = AsyncMock()
        monkeypatch.setattr(scheduler, "_run_once", ran)

        task = asyncio.create_task(scheduler._loop())
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        ran.assert_not_awaited()


class TestLoop:
    async def test_one_tick_claims_the_day_and_runs(self, monkeypatch):
        import asyncio

        monkeypatch.setattr(scheduler, "STARTUP_DELAY_SECONDS", 0)
        monkeypatch.setattr(scheduler, "_seconds_until_next_run", lambda _now: 0)
        monkeypatch.setattr(scheduler, "_claim_day", AsyncMock(return_value=True))
        ran = AsyncMock()
        monkeypatch.setattr(scheduler, "_run_once", ran)

        task = asyncio.create_task(scheduler._loop())
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        assert ran.await_count >= 1

    async def test_a_pod_that_loses_the_lock_does_not_run(self, monkeypatch):
        import asyncio

        monkeypatch.setattr(scheduler, "STARTUP_DELAY_SECONDS", 0)
        monkeypatch.setattr(scheduler, "_seconds_until_next_run", lambda _now: 0)
        monkeypatch.setattr(scheduler, "_claim_day", AsyncMock(return_value=False))
        ran = AsyncMock()
        monkeypatch.setattr(scheduler, "_run_once", ran)

        task = asyncio.create_task(scheduler._loop())
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        ran.assert_not_awaited()

    async def test_a_failed_run_does_not_kill_the_loop(self, monkeypatch, caplog):
        """Otherwise the feature stops silently until the next deploy."""
        import asyncio

        monkeypatch.setattr(scheduler, "STARTUP_DELAY_SECONDS", 0)
        monkeypatch.setattr(scheduler, "_seconds_until_next_run", lambda _now: 0)
        monkeypatch.setattr(scheduler, "_claim_day", AsyncMock(return_value=True))
        monkeypatch.setattr(
            scheduler, "_run_once", AsyncMock(side_effect=RuntimeError("db gone"))
        )

        with caplog.at_level("ERROR"):
            task = asyncio.create_task(scheduler._loop())
            await asyncio.sleep(0.05)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

        assert "will retry tomorrow" in caplog.text

    async def test_run_once_reports_a_normal_run(self, monkeypatch, caplog):
        from src.services.nudges.runner import RunStats

        stats = RunStats()
        stats.sent = 3
        monkeypatch.setattr(
            "src.services.nudges.runner.run_nudges", AsyncMock(return_value=stats)
        )
        with patch("src.core.events.database._async_session_factory"):
            with caplog.at_level("INFO"):
                await scheduler._run_once()

        assert "sent=3" in caplog.text

    async def test_cancelling_mid_run_stops_the_loop(self, monkeypatch):
        """Shutdown must actually stop it — the cancellation has to propagate
        rather than be swallowed by the retry handler."""
        import asyncio

        started = asyncio.Event()

        async def slow_run():
            started.set()
            await asyncio.sleep(10)

        monkeypatch.setattr(scheduler, "STARTUP_DELAY_SECONDS", 0)
        monkeypatch.setattr(scheduler, "_seconds_until_next_run", lambda _now: 0)
        monkeypatch.setattr(scheduler, "_claim_day", AsyncMock(return_value=True))
        monkeypatch.setattr(scheduler, "_run_once", slow_run)

        task = asyncio.create_task(scheduler._loop())
        await asyncio.wait_for(started.wait(), timeout=1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    async def test_a_broken_start_never_stops_the_api_booting(self, monkeypatch):
        """This runs during application startup; a background email job must
        not be able to prevent the service coming up."""
        monkeypatch.setattr(
            "src.services.nudges.runner.nudges_enabled",
            lambda: (_ for _ in ()).throw(RuntimeError("config exploded")),
        )
        scheduler._task = None
        scheduler.start_scheduler()
        assert scheduler._task is None
