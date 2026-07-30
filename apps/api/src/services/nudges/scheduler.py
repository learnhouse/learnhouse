"""
Runs the nudge job on a daily tick from inside the API, so no external cron is
required for the feature to work.

Correctness does not depend on only one replica running this. The ledger's
unique dedupe key is written before the provider is called, so if several pods
wake at the same moment they collide in the database rather than in someone's
inbox — the loser of the race simply skips. The Redis day-lock below is an
optimisation that stops N pods each doing the same full scan; when Redis is
absent the job still runs correctly, just more than once.

The CLI commands remain the operator's interface for dry runs, stats and
one-off invocations. This only removes the need to schedule anything.
"""

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# One tick a day. Late morning UTC lands in working hours across Europe and the
# Americas, which is when an email about your own academy is worth reading.
RUN_AT_HOUR_UTC = 9

# Held for well under a day so a pod that dies mid-run does not block tomorrow.
_LOCK_TTL_SECONDS = 6 * 60 * 60

_task: Optional[asyncio.Task] = None


def _lock_key(day: datetime) -> str:
    return f"learnhouse:nudges:daily:{day.date().isoformat()}"


async def _claim_day(now: datetime) -> bool:
    """Try to become the pod that runs today's job.

    Returns True when Redis is unavailable: the ledger already guarantees a
    nudge is sent once, so running without the lock is wasteful rather than
    wrong, and silently doing nothing would be worse.
    """
    try:
        from src.core.redis import get_redis_client

        client = get_redis_client()
        if client is None:
            return True
        acquired = await asyncio.to_thread(
            client.set, _lock_key(now), "1", nx=True, ex=_LOCK_TTL_SECONDS
        )
        return bool(acquired)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Nudge day-lock unavailable, running anyway: %s", exc)
        return True


def _seconds_until_next_run(now: datetime) -> float:
    target = now.replace(hour=RUN_AT_HOUR_UTC, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


async def _run_once() -> None:
    from src.core.events.database import _async_session_factory
    from src.services.nudges.runner import run_nudges

    async with _async_session_factory() as db_session:
        stats = await run_nudges(db_session)
    result = stats.as_dict()
    if result["auto_seeded"]:
        logger.info("Nudge backlog seeded; sending begins on the next run")
    else:
        logger.info(
            "Nudge run complete: sent=%s failed=%s", result["sent"], result["failed"]
        )


async def _loop() -> None:
    while True:
        now = datetime.now(timezone.utc)
        await asyncio.sleep(_seconds_until_next_run(now))
        try:
            today = datetime.now(timezone.utc)
            if await _claim_day(today):
                await _run_once()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # A failed run must not kill the loop, or the feature silently
            # stops until the next deploy.
            logger.exception("Nudge run failed, will retry tomorrow: %s", exc)


def start_scheduler() -> None:
    """Start the daily tick, unless the feature is switched off.

    Never raises: this runs during application startup, and a background email
    job must not be able to stop the API from booting.

    Deliberately checks the kill switch here as well as inside the job — an
    instance with nudges disabled should not carry a background task at all.
    """
    global _task

    try:
        from src.core.deployment_mode import get_deployment_mode
        from src.services.nudges.runner import nudges_enabled

        if not nudges_enabled():
            return
        if get_deployment_mode() != "saas":
            return
        if os.environ.get("LEARNHOUSE_NUDGES_NO_SCHEDULER"):
            # For deployments that would rather drive the CLI from their own cron.
            logger.info("Nudge scheduler disabled; drive `nudges-run` yourself")
            return

        _task = asyncio.create_task(_loop())
        logger.info("Nudge scheduler started (daily at %02d:00 UTC)", RUN_AT_HOUR_UTC)
    except Exception as exc:
        logger.warning("Nudge scheduler not started: %s", exc)


async def stop_scheduler() -> None:
    """Stop the tick. Never raises, for the same reason as `start_scheduler`."""
    global _task
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except (asyncio.CancelledError, Exception):
        pass
    finally:
        _task = None
