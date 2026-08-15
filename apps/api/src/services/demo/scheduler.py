"""Runs the demo refresh on an interval from inside the API.

Modelled on ``src/services/nudges/scheduler.py`` — same shape, same guarantees:
a failed run never kills the loop, and nothing here can stop the application
booting.

Two deliberate differences from the nudge scheduler:

* It ticks on an interval rather than at a fixed hour, because the demo is
  meant to be recent rather than daily.
* It is **not** gated on SaaS mode. A self-hosted install demonstrating
  LearnHouse to its own stakeholders wants the demo as much as the hosted
  product does.

Correctness does not depend on only one replica running it. The sync is
idempotent, so two pods racing produce the same result as one; the Redis lock
below only stops them both doing the work.
"""

import asyncio
import logging
import random
from datetime import datetime, timezone
from typing import Optional

from src.services.demo import flags

logger = logging.getLogger(__name__)

#: Spread the boot sync so a rolling deploy's replicas do not all reach the
#: interval lock in the same instant. Only the loser of that race is wasted
#: work, but on a database with no demo yet the losers race an INSERT on a
#: unique slug instead, and crash.
STARTUP_JITTER_SECONDS = 20

_task: Optional[asyncio.Task] = None


def _lock_key(now: datetime, interval_minutes: int) -> str:
    """One lock per interval bucket, so a tick is claimed at most once."""
    bucket = int(now.timestamp()) // (interval_minutes * 60)
    return f"learnhouse:demo:refresh:{bucket}"


async def _claim(now: datetime, interval_minutes: int) -> bool:
    """Try to become the replica that refreshes this interval.

    Returns True when Redis is unavailable: the sync is idempotent, so running
    it more than once is wasteful rather than wrong, and silently skipping the
    refresh would leave a vandalised demo up.
    """
    try:
        from src.core.redis import get_redis_client

        client = get_redis_client()
        if client is None:
            return True
        # Expire just under the interval so the next bucket is always claimable
        # even if a pod dies holding this one.
        ttl = max(30, interval_minutes * 60 - 5)
        acquired = await asyncio.to_thread(
            client.set, _lock_key(now, interval_minutes), "1", nx=True, ex=ttl
        )
        return bool(acquired)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Demo refresh lock unavailable, running anyway: %s", exc)
        return True


async def _run_once() -> None:
    from src.core.events.database import _async_session_factory
    from src.services.demo.sync import sync_demo

    async with _async_session_factory() as db_session:
        stats = await sync_demo(db_session)

    if stats.provisioned:
        logger.info("Demo organization provisioned (epoch %s)", stats.epoch)
    elif stats.created or stats.updated or stats.drift_deleted:
        logger.info(
            "Demo refreshed: created=%s updated=%s drift=%s",
            stats.created,
            stats.updated,
            stats.drift_deleted,
        )
    else:
        logger.debug("Demo refresh: already in sync")


async def _loop() -> None:
    interval_minutes = flags.refresh_minutes()

    # Build immediately on boot rather than waiting a full interval — otherwise
    # a fresh install has no demo for up to an hour after enabling it.
    #
    # Jittered and lock-claimed like any other tick, matching the nudge
    # scheduler this is modelled on. Straight through to _run_once() meant a
    # rolling deploy had every replica provisioning the same demo at the same
    # instant: on a database with no demo yet they all reach the INSERT
    # together, and Organization.slug is unique, so all but one crash — and the
    # one that wins may lose its media uploads to the others' rollbacks.
    await asyncio.sleep(STARTUP_JITTER_SECONDS * random.random())
    try:
        if await _claim(datetime.now(timezone.utc), interval_minutes):
            await _run_once()
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.exception("Initial demo sync failed, will retry: %s", exc)

    while True:
        await asyncio.sleep(interval_minutes * 60)
        try:
            if await _claim(datetime.now(timezone.utc), interval_minutes):
                await _run_once()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # A failed refresh must not kill the loop, or the demo silently
            # stops being refreshed until the next deploy.
            logger.exception("Demo refresh failed, will retry next tick: %s", exc)


def start_scheduler() -> None:
    """Start the refresh tick, unless the demo is switched off.

    Never raises: this runs during application startup, and a demo organization
    must not be able to stop the API from booting.
    """
    global _task

    try:
        if not flags.demo_enabled():
            return
        if flags.scheduler_disabled():
            logger.info("Demo scheduler disabled; drive `demo-sync` yourself")
            return

        _task = asyncio.create_task(_loop())
        logger.info(
            "Demo scheduler started (every %s minutes)", flags.refresh_minutes()
        )
    except Exception as exc:
        logger.warning("Demo scheduler not started: %s", exc)


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
