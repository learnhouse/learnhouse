"""Runs the user group sync every 15 minutes from inside the API (rules,
email domains, nesting, scheduled starts, expiries), and the weekly manager
digest on Monday mornings (EE). Same shape as the drip scheduler: a Redis
lock per slot keeps replicas from each running it, and the sync itself is
idempotent, so running it twice is harmless.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

INTERVAL_SECONDS = 15 * 60
STARTUP_DELAY_SECONDS = 60
_LOCK_TTL_SECONDS = 14 * 60

_task: Optional[asyncio.Task] = None


def _slot(now: datetime) -> str:
    return f"learnhouse:usergroups:sync:{now.strftime('%Y-%m-%dT%H')}:{now.minute // 15}"


async def _claim(key: str, ttl: int) -> bool:
    try:
        from src.core.redis import get_redis_client

        client = get_redis_client()
        if client is None:
            return True
        return bool(await asyncio.to_thread(client.set, key, "1", nx=True, ex=ttl))
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("User group sync lock unavailable, running anyway: %s", exc)
        return True


async def tick(now: Optional[datetime] = None) -> None:
    try:
        now = now or datetime.now(timezone.utc)
        if not await _claim(_slot(now), _LOCK_TTL_SECONDS):
            return
        from src.core.events.database import _async_session_factory
        from src.services.usergroups.sync import sync_all

        async with _async_session_factory() as db:
            stats = await sync_all(db, now)
            if stats.added or stats.removed or stats.expired or stats.scheduled_started:
                logger.info("User group sync: %s", stats.as_dict())
            # Monday 7:00-7:15 UTC: weekly manager digests (EE).
            if now.weekday() == 0 and now.hour == 7 and now.minute < 15:
                if await _claim(f"learnhouse:usergroups:digest:{now.strftime('%Y-%W')}", 7 * 24 * 3600):
                    from src.core.ee_hooks import run_ee_usergroup_digests

                    await run_ee_usergroup_digests(db, now)
    except asyncio.CancelledError:  # pragma: no cover
        raise
    except Exception as exc:
        logger.exception("User group sync failed, will retry: %s", exc)


async def _loop() -> None:  # pragma: no cover - timing loop
    await asyncio.sleep(STARTUP_DELAY_SECONDS)
    while True:
        await tick()
        await asyncio.sleep(INTERVAL_SECONDS)


def start_scheduler() -> None:
    """Never raises. Idle under tests and with LEARNHOUSE_USERGROUP_SYNC_DISABLED."""
    global _task
    try:
        if os.environ.get("TESTING") == "true" or os.environ.get("LEARNHOUSE_USERGROUP_SYNC_DISABLED"):
            return
        _task = asyncio.create_task(_loop())  # pragma: no cover
    except Exception as exc:  # pragma: no cover
        logger.warning("User group scheduler not started: %s", exc)


async def stop_scheduler() -> None:
    global _task
    if _task is None:
        return
    _task.cancel()  # pragma: no cover
    try:  # pragma: no cover
        await _task
    except asyncio.CancelledError:  # pragma: no cover
        pass
    _task = None  # pragma: no cover
