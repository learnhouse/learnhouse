"""Runs every content backfill (``backfill.jobs``) on a long interval from
inside the API, so the work needs no external scheduler.

Modelled on ``src/services/demo/scheduler.py`` and the AI search backfill: a
failed run never kills the loop, and nothing here can stop the application
booting. Two differences, both because the interval (two days by default) is
much longer than a deploy cycle:

* Time is split into fixed windows and the scheduler checks every hour
  whether the current window has run. Sleeping a full interval after boot
  would mean a platform that deploys daily never runs a backfill at all.
* The window is claimed with a Redis key that lives as long as the window,
  so across restarts and replicas each window runs once. Without Redis there
  is only this process, which runs once per window it sees.
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
from datetime import datetime, timezone
from typing import Optional

from src.services.backfill import jobs

logger = logging.getLogger(__name__)

DEFAULT_INTERVAL_HOURS = 48.0
CHECK_SECONDS = 60 * 60
#: Let the app settle, and spread a rolling deploy's replicas before the lock.
STARTUP_DELAY_SECONDS = 5 * 60
STARTUP_JITTER_SECONDS = 60

_task: Optional[asyncio.Task] = None
_last_window: Optional[int] = None


def interval_hours() -> float:
    """LEARNHOUSE_BACKFILL_INTERVAL_HOURS; 0 turns the scheduled backfill off."""
    try:
        return max(0.0, float(os.environ.get("LEARNHOUSE_BACKFILL_INTERVAL_HOURS", DEFAULT_INTERVAL_HOURS)))
    except ValueError:
        return DEFAULT_INTERVAL_HOURS


def _window(now: datetime, interval_seconds: int) -> int:
    return int(now.timestamp()) // interval_seconds


async def _claim(window: int, interval_seconds: int) -> bool:
    """Try to become the replica that runs this window."""
    global _last_window
    try:
        from src.core.redis import get_redis_client

        client = get_redis_client()
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Backfill: Redis unavailable: %s", exc)
        client = None
    if client is None:
        if _last_window == window:
            return False
        _last_window = window
        return True
    try:
        return bool(await asyncio.to_thread(
            client.set, f"learnhouse:backfill:{window}", "1", nx=True, ex=interval_seconds
        ))
    except Exception as exc:
        logger.warning("Backfill: lock unavailable, skipping this check: %s", exc)
        return False


async def run_once() -> dict[str, dict]:
    results = await jobs.run_all()
    logger.info("Backfill run: %s", results)
    return results


async def _tick(interval_seconds: int) -> None:
    try:
        window = _window(datetime.now(timezone.utc), interval_seconds)
        if await _claim(window, interval_seconds):
            await run_once()
    except asyncio.CancelledError:
        raise
    except Exception:
        # A failed run must not kill the loop; the next window retries.
        logger.exception("Backfill: run failed, will retry next window")


async def _loop(interval_seconds: int) -> None:
    await asyncio.sleep(STARTUP_DELAY_SECONDS + STARTUP_JITTER_SECONDS * random.random())
    while True:
        await _tick(interval_seconds)
        await asyncio.sleep(CHECK_SECONDS)


def start_scheduler() -> None:
    """Start the scheduled backfill. Never raises: this runs at startup."""
    global _task
    try:
        hours = interval_hours()
        if not hours:
            logger.info("Scheduled backfill disabled (LEARNHOUSE_BACKFILL_INTERVAL_HOURS=0)")
            return
        if _task is None or _task.done():
            _task = asyncio.create_task(_loop(int(hours * 3600)))
            logger.info("Scheduled backfill every %sh", hours)
    except Exception:  # pragma: no cover - defensive
        logger.exception("Backfill scheduler failed to start")


async def stop_scheduler() -> None:
    global _task
    task, _task = _task, None
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
