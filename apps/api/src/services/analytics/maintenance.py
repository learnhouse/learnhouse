"""Background upkeep for analytics: summary tables and retention.

* Every ``REFRESH_SECONDS`` the daily summaries (``analytics_daily_actor``,
  ``analytics_hourly_count``) are rebuilt for today and yesterday from the raw
  stream. Yesterday is included so late writes around midnight land. When the
  summaries are empty (first boot after the migration, or after an import),
  every day that has events is rebuilt once.
* Once a day, events and summaries past each org's retention are deleted in
  small batches so the table is never locked for long. Orgs that set more
  than a year but no longer have the plan for it fall back to the default.
  Rows left behind by deleted orgs go too.

Runs inside the API, modelled on ``services/backfill/scheduler.py``: each
window is claimed in Redis so only one replica does the work, a failed run
never kills the loop, and nothing here can stop the app from booting.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import text

from src.db.analytics import DEFAULT_RETENTION_DAYS

logger = logging.getLogger(__name__)

REFRESH_SECONDS = 5 * 60
RETENTION_SECONDS = 24 * 3600
STARTUP_DELAY_SECONDS = 60
DELETE_BATCH = 10_000

_task: Optional[asyncio.Task] = None
_last_windows: dict[str, int] = {}

_REFRESH_ACTORS = """
INSERT INTO analytics_daily_actor (org_id, day, actor_key, user_id, events, page_views)
SELECT org_id, (ts AT TIME ZONE 'UTC')::date, actor_key, max(user_id), count(*),
       count(*) FILTER (WHERE event_name = 'page_view')
FROM analytics_event
WHERE ts >= :since AND actor_key <> ''
GROUP BY 1, 2, 3
"""

_REFRESH_HOURLY = """
INSERT INTO analytics_hourly_count (org_id, day, hour, event_name, n)
SELECT org_id, (ts AT TIME ZONE 'UTC')::date, extract(hour FROM ts AT TIME ZONE 'UTC')::smallint,
       event_name, count(*)
FROM analytics_event
WHERE ts >= :since
GROUP BY 1, 2, 3, 4
"""


def _session_factory():
    from src.core.events.database import _async_session_factory

    return _async_session_factory


async def refresh_rollups(since: date | None = None) -> date:
    """Rebuild the summaries from ``since`` (default: yesterday) to now."""
    factory = _session_factory()
    async with factory() as db:
        if since is None:
            has_rollups = (await db.execute(text("SELECT 1 FROM analytics_daily_actor LIMIT 1"))).first()
            if has_rollups is None:
                earliest = (await db.execute(text("SELECT min(ts) FROM analytics_event"))).scalar()
                since = earliest.date() if earliest else date.today()
            else:
                since = datetime.now(timezone.utc).date() - timedelta(days=1)
        since_ts = datetime(since.year, since.month, since.day, tzinfo=timezone.utc)
        await db.execute(text("DELETE FROM analytics_daily_actor WHERE day >= :day"), {"day": since})
        await db.execute(text("DELETE FROM analytics_hourly_count WHERE day >= :day"), {"day": since})
        await db.execute(text(_REFRESH_ACTORS), {"since": since_ts})
        await db.execute(text(_REFRESH_HOURLY), {"since": since_ts})
        await db.commit()
    return since


async def _delete_batched(db, where: str, params: dict) -> int:
    total = 0
    while True:
        result = await db.execute(
            text(f"DELETE FROM analytics_event WHERE id IN (SELECT id FROM analytics_event WHERE {where} LIMIT {DELETE_BATCH})"),
            params,
        )
        await db.commit()
        total += result.rowcount or 0
        if (result.rowcount or 0) < DELETE_BATCH:
            return total


async def _retention_groups(db) -> dict[int, list[int]]:
    """Orgs whose retention differs from the default, grouped by days kept.
    Orgs above the default that no longer qualify are left out (default applies)."""
    from src.services.analytics.settings import can_extend_retention

    rows = (
        await db.execute(
            text("SELECT org_id, retention_days FROM analytics_settings WHERE retention_days <> :d"),
            {"d": DEFAULT_RETENTION_DAYS},
        )
    ).all()
    groups: dict[int, list[int]] = {}
    for org_id, days in rows:
        if days > DEFAULT_RETENTION_DAYS and not await can_extend_retention(org_id, db):
            continue
        groups.setdefault(days, []).append(org_id)
    return groups


async def apply_retention() -> int:
    """Delete everything past each org's retention. Returns events deleted."""
    factory = _session_factory()
    deleted = 0
    async with factory() as db:
        groups = await _retention_groups(db)
        custom = [org for orgs in groups.values() for org in orgs]

        # Default retention for every org without its own setting.
        deleted += await _delete_batched(
            db,
            "ts < now() - make_interval(days => :days) AND NOT (org_id = ANY(:custom))",
            {"days": DEFAULT_RETENTION_DAYS, "custom": custom},
        )
        for days, orgs in groups.items():
            deleted += await _delete_batched(
                db,
                "ts < now() - make_interval(days => :days) AND org_id = ANY(:orgs)",
                {"days": days, "orgs": orgs},
            )

        # Orgs that no longer exist.
        orphans = [
            row[0]
            for row in (
                await db.execute(
                    text(
                        "SELECT DISTINCT a.org_id FROM analytics_daily_actor a "
                        "WHERE NOT EXISTS (SELECT 1 FROM organization o WHERE o.id = a.org_id)"
                    )
                )
            ).all()
        ]
        if orphans:
            deleted += await _delete_batched(db, "org_id = ANY(:orgs)", {"orgs": orphans})

        # Summaries follow the same rules (they're small, one statement each).
        longest = max([DEFAULT_RETENTION_DAYS, *groups.keys()])
        for table in ("analytics_daily_actor", "analytics_hourly_count"):
            await db.execute(
                text(f"DELETE FROM {table} WHERE day < current_date - CAST(:days AS integer) AND NOT (org_id = ANY(:custom))"),
                {"days": DEFAULT_RETENTION_DAYS, "custom": custom},
            )
            for days, orgs in groups.items():
                await db.execute(
                    text(f"DELETE FROM {table} WHERE day < current_date - CAST(:days AS integer) AND org_id = ANY(:orgs)"),
                    {"days": days, "orgs": orgs},
                )
            await db.execute(text(f"DELETE FROM {table} WHERE day < current_date - CAST(:days AS integer)"), {"days": longest})
            if orphans:
                await db.execute(text(f"DELETE FROM {table} WHERE org_id = ANY(:orgs)"), {"orgs": orphans})
        await db.commit()
    logger.info("Analytics retention: deleted %d events", deleted)
    return deleted


def enabled() -> bool:
    """LEARNHOUSE_ANALYTICS_MAINTENANCE=false turns the background job off
    (e.g. when a separate worker runs it)."""
    value = os.environ.get("LEARNHOUSE_ANALYTICS_MAINTENANCE", "")
    return value.strip().lower() not in ("false", "0", "no", "off")


async def _claim(name: str, window: int, ttl: int) -> bool:
    try:
        from src.core.redis import get_redis_client

        client = get_redis_client()
    except Exception:  # pragma: no cover - defensive
        client = None
    if client is None:
        if _last_windows.get(name) == window:
            return False
        _last_windows[name] = window
        return True
    try:
        return bool(await asyncio.to_thread(
            client.set, f"learnhouse:analytics:{name}:{window}", "1", nx=True, ex=ttl
        ))
    except Exception as exc:
        logger.warning("Analytics %s: lock unavailable, skipping: %s", name, exc)
        return False


async def tick(now: datetime | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    epoch = int(now.timestamp())
    try:
        if await _claim("rollup", epoch // REFRESH_SECONDS, REFRESH_SECONDS):
            await refresh_rollups()
        if await _claim("retention", epoch // RETENTION_SECONDS, RETENTION_SECONDS):
            await apply_retention()
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("Analytics maintenance failed, will retry next window")


async def _loop() -> None:
    await asyncio.sleep(STARTUP_DELAY_SECONDS)
    while True:
        await tick()
        await asyncio.sleep(REFRESH_SECONDS)


def start_scheduler() -> None:
    """Start the background job. Never raises: this runs at startup."""
    global _task
    try:
        if not enabled():
            logger.info("Analytics maintenance disabled (LEARNHOUSE_ANALYTICS_MAINTENANCE=false)")
            return
        if _task is None or _task.done():
            _task = asyncio.create_task(_loop())
    except Exception:  # pragma: no cover - defensive
        logger.exception("Analytics maintenance failed to start")


async def stop_scheduler() -> None:
    global _task
    task, _task = _task, None
    if task is not None:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    from src.services.analytics.analytics import flush

    await flush()
