"""One-time import of analytics history from Tinybird into Postgres.

Analytics used to be stored in Tinybird. This copies the events still there
(Tinybird kept 365 days) into ``analytics_event`` so dashboards keep their
history after the switch, then rebuilds the daily summaries.

Run it from apps/api with the Tinybird read credentials set, after the
migration, on the host the API runs on:

    LEARNHOUSE_TINYBIRD_API_URL=https://api.europe-west2.gcp.tinybird.co \\
    LEARNHOUSE_TINYBIRD_READ_TOKEN=p.eyJ... \\
    python scripts/import_tinybird_analytics.py [--days 365] [--dry-run]

It works one day at a time and skips days that already have imported rows
(``source`` starting with ``tinybird:``), so it can be stopped and re-run.
Events go through the same catalog as live tracking: unknown names and
properties are dropped, and raw IPs are not carried over.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402
from sqlalchemy import insert, text  # noqa: E402

from config.config import get_learnhouse_config  # noqa: E402
from src.db.analytics import AnalyticsEvent  # noqa: E402
from src.services.analytics.analytics import build_row  # noqa: E402
from src.services.analytics.maintenance import refresh_rollups  # noqa: E402

PAGE = 50_000
INSERT_CHUNK = 5_000


def convert(raw: dict) -> dict | None:
    """A Tinybird ``events`` row as an ``analytics_event`` row (None if dropped)."""
    try:
        props = json.loads(raw.get("properties") or "{}")
    except (TypeError, ValueError):
        props = {}
    if not isinstance(props, dict):
        props = {}
    user_id = int(raw.get("user_id") or 0)
    row = build_row(
        raw["event_name"],
        int(raw["org_id"]),
        user_id=user_id,
        session_id=raw.get("session_id") or "",
        properties=props,
        source="tinybird:web" if raw.get("source") == "frontend" else "tinybird:api",
        # Anonymous rows never existed in Tinybird (the old beacon required a
        # session), so every imported row is a signed-in user or a server event.
        actor_key=f"u:{user_id}" if user_id else "",
        country=props.get("country_code"),
        device=props.get("device_type"),
    )
    if row is not None:
        row["ts"] = datetime.strptime(raw["timestamp"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    return row


async def fetch_day(client: httpx.AsyncClient, day: date) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        sql = (
            "SELECT event_name, toString(timestamp) AS timestamp, org_id, user_id, session_id, properties, source "
            f"FROM events WHERE toDate(timestamp) = toDate('{day.isoformat()}') "
            f"ORDER BY timestamp LIMIT {PAGE} OFFSET {offset} FORMAT JSON"
        )
        response = await client.post("/v0/sql", content=sql)
        response.raise_for_status()
        page = response.json().get("data", [])
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        offset += PAGE


async def main(days: int, dry_run: bool) -> None:
    config = get_learnhouse_config()
    tb = config.tinybird_config
    if tb is None or not tb.read_token:
        sys.exit("Set LEARNHOUSE_TINYBIRD_API_URL and LEARNHOUSE_TINYBIRD_READ_TOKEN first.")

    from src.core.events.database import _async_session_factory

    today = datetime.now(timezone.utc).date()
    first = today - timedelta(days=days)
    imported = skipped = dropped = 0
    async with httpx.AsyncClient(
        base_url=tb.api_url, headers={"Authorization": f"Bearer {tb.read_token}"}, timeout=120
    ) as client:
        day = first
        while day <= today:
            async with _async_session_factory() as db:
                done = (
                    await db.execute(
                        text(
                            "SELECT 1 FROM analytics_event WHERE source LIKE 'tinybird:%' "
                            "AND ts >= :start AND ts < :end LIMIT 1"
                        ),
                        {"start": datetime(day.year, day.month, day.day, tzinfo=timezone.utc),
                         "end": datetime(day.year, day.month, day.day, tzinfo=timezone.utc) + timedelta(days=1)},
                    )
                ).first()
                if done:
                    skipped += 1
                    day += timedelta(days=1)
                    continue
                raw_rows = await fetch_day(client, day)
                rows = [r for r in (convert(raw) for raw in raw_rows) if r is not None]
                dropped += len(raw_rows) - len(rows)
                if rows and not dry_run:
                    for i in range(0, len(rows), INSERT_CHUNK):
                        await db.execute(insert(AnalyticsEvent.__table__), rows[i : i + INSERT_CHUNK])
                    await db.commit()
                imported += len(rows)
                print(f"{day}: {len(rows)} events{' (dry run)' if dry_run else ''}", flush=True)
            day += timedelta(days=1)

    if not dry_run and imported:
        await refresh_rollups(first)
    print(f"Done: {imported} events imported, {dropped} dropped (not in the catalog), {skipped} days already imported.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--days", type=int, default=365, help="How many days back to import (default 365).")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and convert, but don't write.")
    args = parser.parse_args()
    asyncio.run(main(args.days, args.dry_run))
