"""Runs the drip unlock emails every hour from inside the API, so no external
cron is needed. Same shape as the nudge scheduler: an hour-lock in Redis
keeps N replicas from each scanning, and the ledger in ``drip_notification``
keeps the job correct without it.
"""

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

INTERVAL_SECONDS = 60 * 60
STARTUP_DELAY_SECONDS = 45
_LOCK_TTL_SECONDS = 50 * 60

_task: Optional[asyncio.Task] = None


def _lock_key(now: datetime) -> str:
    return f"learnhouse:drip:notify:{now.strftime('%Y-%m-%dT%H')}"


async def _claim_hour(now: datetime) -> bool:
    """True when this replica should run this hour's job (or Redis is absent)."""
    try:
        from src.core.redis import get_redis_client

        client = get_redis_client()
        if client is None:
            return True
        return bool(await asyncio.to_thread(client.set, _lock_key(now), "1", nx=True, ex=_LOCK_TTL_SECONDS))
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Drip hour-lock unavailable, running anyway: %s", exc)
        return True


async def _tick() -> None:
    try:
        now = datetime.now(timezone.utc)
        if not await _claim_hour(now):
            return
        from src.core.events.database import _async_session_factory
        from src.services.courses.drip_notify import run_drip_notifications

        async with _async_session_factory() as db_session:
            stats = await run_drip_notifications(db_session, now)
        if stats.emails or stats.failed:
            logger.info("Drip emails: sent=%s failed=%s", stats.emails, stats.failed)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        # A failed run must not kill the loop.
        logger.exception("Drip email run failed, will retry next hour: %s", exc)


async def _loop() -> None:
    await asyncio.sleep(STARTUP_DELAY_SECONDS)
    while True:
        await _tick()
        await asyncio.sleep(INTERVAL_SECONDS)


def start_scheduler() -> None:
    """Start the hourly tick. Never raises: it runs during startup.

    Idle under tests and when ``LEARNHOUSE_DRIP_EMAILS_DISABLED`` is set.
    Courses opt in one by one, so an instance without any does a cheap query
    per hour and nothing else.
    """
    global _task
    try:
        if os.environ.get("TESTING") == "true" or os.environ.get("LEARNHOUSE_DRIP_EMAILS_DISABLED"):
            return
        _task = asyncio.create_task(_loop())
    except Exception as exc:
        logger.warning("Drip email scheduler not started: %s", exc)


async def stop_scheduler() -> None:
    global _task
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except asyncio.CancelledError:
        pass
    _task = None
