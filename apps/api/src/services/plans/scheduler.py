"""Hourly trial job, run from inside the API: move orgs whose trial ran out to
Free, then send whichever trial email is due.

Same shape as the other in-app schedulers: a Redis lock per hour keeps several
replicas from each doing the scan, and both steps are idempotent on their own
(the plan write is a no-op once applied; every email is claimed in the ledger
before it is sent), so running twice is harmless. SaaS only.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

INTERVAL_SECONDS = 60 * 60
STARTUP_DELAY_SECONDS = 90
_LOCK_TTL_SECONDS = 55 * 60

_task: Optional[asyncio.Task] = None


def _slot(now: datetime) -> str:
    return f"learnhouse:trials:tick:{now.strftime('%Y-%m-%dT%H')}"


async def _claim(key: str) -> bool:
    try:
        from src.core.redis import get_redis_client

        client = get_redis_client()
        if client is None:
            return True
        return bool(await asyncio.to_thread(client.set, key, "1", nx=True, ex=_LOCK_TTL_SECONDS))
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Trial job lock unavailable, running anyway: %s", exc)
        return True


async def run_once(db_session, now: Optional[datetime] = None) -> dict:
    """Expire due trials, then send due trial emails. Returns what happened."""
    from src.services.plans.notify import send_due_trial_emails
    from src.services.plans.trial import expire_due_trials

    now = now or datetime.now(timezone.utc)
    expired = await expire_due_trials(db_session, now)
    emails = await send_due_trial_emails(db_session, now)
    return {"expired": expired, "emails_sent": emails}


async def tick(now: Optional[datetime] = None) -> None:
    """One scheduled run. Never raises."""
    try:
        now = now or datetime.now(timezone.utc)
        if not await _claim(_slot(now)):
            return
        from src.core.events.database import _async_session_factory

        async with _async_session_factory() as db:
            result = await run_once(db, now)
        if result["expired"] or result["emails_sent"]:
            logger.info("Trial job: %s", result)
    except asyncio.CancelledError:  # pragma: no cover
        raise
    except Exception as exc:
        logger.exception("Trial job failed, will retry next hour: %s", exc)


async def _loop() -> None:  # pragma: no cover - timing loop
    await asyncio.sleep(STARTUP_DELAY_SECONDS)
    while True:
        await tick()
        await asyncio.sleep(INTERVAL_SECONDS)


def start_scheduler() -> None:
    """Never raises. Idle outside SaaS, under tests and with
    LEARNHOUSE_TRIAL_JOB_DISABLED."""
    global _task
    try:
        from src.core.deployment_mode import get_deployment_mode

        if os.environ.get("TESTING") == "true" or os.environ.get("LEARNHOUSE_TRIAL_JOB_DISABLED"):
            return
        if get_deployment_mode() != "saas":
            return
        _task = asyncio.create_task(_loop())  # pragma: no cover
    except Exception as exc:  # pragma: no cover
        logger.warning("Trial job not started: %s", exc)


async def stop_scheduler() -> None:
    global _task
    if _task is None:
        return
    _task.cancel()  # pragma: no cover
    try:  # pragma: no cover
        await _task
    except (asyncio.CancelledError, Exception):  # pragma: no cover
        pass
    finally:  # pragma: no cover
        _task = None
