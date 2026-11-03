"""Runs the unread-message emails every five minutes, and delivers due
reminders every few seconds, from inside the API.

Same shape as the drip scheduler: a per-window lock in Redis keeps N replicas
from each scanning, and the ``last_emailed_message_id`` ledger keeps the job
correct without it. Reminders need no lock: each one is claimed with a
conditional update before it is sent.
"""

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

INTERVAL_SECONDS = 5 * 60
REMINDER_INTERVAL_SECONDS = 20
STARTUP_DELAY_SECONDS = 60
_LOCK_TTL_SECONDS = 4 * 60

_task: Optional[asyncio.Task] = None
_reminder_task: Optional[asyncio.Task] = None


def _lock_key(now: datetime) -> str:
    window = now.minute // 5
    return f"learnhouse:messaging:unread:{now.strftime('%Y-%m-%dT%H')}:{window}"


async def _claim(now: datetime) -> bool:
    try:
        from src.core.redis import get_redis_client

        client = get_redis_client()
        if client is None:
            return True
        return bool(await asyncio.to_thread(client.set, _lock_key(now), "1", nx=True, ex=_LOCK_TTL_SECONDS))
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Messaging email lock unavailable, running anyway: %s", exc)
        return True


async def _tick() -> None:
    try:
        now = datetime.now(timezone.utc)
        if not await _claim(now):
            return
        from src.core.events.database import _async_session_factory
        from src.services.messaging.notify import run_unread_emails

        async with _async_session_factory() as db_session:
            stats = await run_unread_emails(db_session, now)
        if stats.emails or stats.failed:
            logger.info("Unread message emails: sent=%s failed=%s", stats.emails, stats.failed)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.exception("Unread message email run failed: %s", exc)


async def _loop() -> None:
    await asyncio.sleep(STARTUP_DELAY_SECONDS)
    while True:
        await _tick()
        await asyncio.sleep(INTERVAL_SECONDS)


async def _reminder_loop() -> None:
    await asyncio.sleep(STARTUP_DELAY_SECONDS / 2)
    while True:
        try:
            from src.core.events.database import _async_session_factory
            from src.services.messaging.reminders import deliver_due

            async with _async_session_factory() as db_session:
                sent = await deliver_due(db_session)
            if sent:
                logger.info("Delivered %s reminder(s)", sent)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("Reminder delivery failed: %s", exc)
        await asyncio.sleep(REMINDER_INTERVAL_SECONDS)


def start_scheduler() -> None:
    """Never raises. Idle under tests and with LEARNHOUSE_MESSAGING_EMAILS_DISABLED."""
    global _task
    try:
        if os.environ.get("TESTING") == "true" or os.environ.get("LEARNHOUSE_MESSAGING_EMAILS_DISABLED"):
            return
        _task = asyncio.create_task(_loop())
        global _reminder_task
        _reminder_task = asyncio.create_task(_reminder_loop())
    except Exception as exc:
        logger.warning("Messaging email scheduler not started: %s", exc)


async def stop_scheduler() -> None:
    global _task, _reminder_task
    for task in (_task, _reminder_task):
        if task is None:
            continue
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    _task = None
    _reminder_task = None
