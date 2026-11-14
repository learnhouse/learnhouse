"""Background tick for scheduled notifications: assignment due reminders and
the email digests every fifteen minutes, and a daily prune of old inbox rows.

Dedupe keys make the reminders correct on any number of replicas; the Redis
lock only saves the duplicate scans.
"""

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

INTERVAL_SECONDS = 15 * 60
STARTUP_DELAY_SECONDS = 90
_LOCK_TTL_SECONDS = 14 * 60

_task: Optional[asyncio.Task] = None
_last_prune: Optional[str] = None


def _lock_key(now: datetime) -> str:
    return f"learnhouse:notifications:tick:{now.strftime('%Y-%m-%dT%H')}:{now.minute // 15}"


async def _claim(now: datetime) -> bool:
    try:
        from src.core.redis import get_redis_client

        client = get_redis_client()
        if client is None:
            return True
        return bool(await asyncio.to_thread(client.set, _lock_key(now), "1", nx=True, ex=_LOCK_TTL_SECONDS))
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Notification lock unavailable, running anyway: %s", exc)
        return True


async def tick(now: Optional[datetime] = None) -> None:
    global _last_prune
    now = now or datetime.now(timezone.utc)
    if not await _claim(now):
        return
    from src.core.events.database import _async_session_factory
    from src.services.notifications.events import run_assignment_due_reminders
    from src.services.notifications.notifications import prune

    async with _async_session_factory() as db:
        written = await run_assignment_due_reminders(db, now)
        if written:
            logger.info("Assignment due reminders: %s", written)
        from src.services.notifications.digest import run_digests

        digests = await run_digests(db, now)
        if digests:
            logger.info("Notification digests sent: %s", digests)
        day = now.date().isoformat()
        if _last_prune != day:
            _last_prune = day
            await prune(db, now)


async def _loop() -> None:
    await asyncio.sleep(STARTUP_DELAY_SECONDS)
    while True:
        try:
            await tick()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("Notification tick failed: %s", exc)
        await asyncio.sleep(INTERVAL_SECONDS)


def start_scheduler() -> None:
    """Never raises. Idle under tests and with LEARNHOUSE_NOTIFICATIONS_SCHEDULER_DISABLED."""
    global _task
    try:
        if os.environ.get("TESTING") == "true" or os.environ.get("LEARNHOUSE_NOTIFICATIONS_SCHEDULER_DISABLED"):
            return
        _task = asyncio.create_task(_loop())
    except Exception as exc:
        logger.warning("Notification scheduler not started: %s", exc)


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
