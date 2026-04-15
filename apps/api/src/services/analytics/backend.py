"""
Analytics backend abstraction.

Two concrete implementations — Tinybird and ClickHouse — share a single
interface so the rest of the codebase does not care which one is active.

Selection order:
  1. Explicit LEARNHOUSE_ANALYTICS_BACKEND env var (or yaml `analytics_backend`)
  2. Tinybird if tinybird_config is set (preserves backwards-compatibility)
  3. ClickHouse if clickhouse_config is set
  4. None — analytics disabled (existing behavior)

Both backends return query results in the shape `{data, rows, meta}` — matching
what the dashboard frontend has always consumed from Tinybird's /v0/sql.
"""

from __future__ import annotations

import json
import logging
from typing import Protocol

import httpx

from config.config import (
    ClickHouseConfig,
    LearnHouseConfig,
    TinybirdConfig,
    get_learnhouse_config,
)

logger = logging.getLogger(__name__)


EMPTY_RESULT: dict = {"data": [], "rows": 0, "meta": []}

# Error fragments that indicate a missing table / datasource — treated as an
# empty result rather than a query failure, so the dashboard can render
# before the operator has provisioned the schema.
_MISSING_TABLE_FRAGMENTS = (
    "UNKNOWN_TABLE",
    "doesn't exist",
    "does not exist",
    "not found",
    "Table default",
    "UNKNOWN_DATABASE",
)


class BackendQueryError(Exception):
    """Raised when the backend query fails for a non-missing-table reason."""


class AnalyticsBackend(Protocol):
    name: str

    async def ingest_event(self, payload: dict) -> None:
        ...

    async def execute_sql(self, sql: str) -> dict:
        ...


# ---------------------------------------------------------------------------
# Tinybird
# ---------------------------------------------------------------------------
class TinybirdBackend:
    name = "tinybird"

    def __init__(self, cfg: TinybirdConfig) -> None:
        self._cfg = cfg
        self._ingest_client = httpx.AsyncClient(
            base_url=cfg.api_url,
            headers={"Authorization": f"Bearer {cfg.ingest_token}"},
            timeout=10.0,
        )
        self._read_client = httpx.AsyncClient(
            base_url=cfg.api_url,
            headers={"Authorization": f"Bearer {cfg.read_token}"},
            timeout=30.0,
        )

    async def ingest_event(self, payload: dict) -> None:
        resp = await self._ingest_client.post("/v0/events?name=events", json=payload)
        if resp.status_code >= 400:
            logger.warning(
                "Tinybird ingest failed (%s): %s",
                resp.status_code,
                resp.text[:200],
            )

    async def execute_sql(self, sql: str) -> dict:
        try:
            resp = await self._read_client.post("/v0/sql", content=sql + " FORMAT JSON")
            resp.raise_for_status()
            result = resp.json()
        except httpx.HTTPStatusError as exc:
            error_msg = exc.response.text[:500]
            if any(frag in error_msg for frag in _MISSING_TABLE_FRAGMENTS):
                return EMPTY_RESULT
            logger.warning(
                "Tinybird query failed (%s): %s",
                exc.response.status_code,
                error_msg,
            )
            raise BackendQueryError("Analytics query failed") from exc
        except Exception as exc:
            logger.warning("Tinybird query failed: %s", str(exc)[:500])
            raise BackendQueryError("Analytics query failed") from exc

        rows = result.get("data", [])
        return {
            "data": rows,
            "rows": result.get("rows", len(rows)),
            "meta": result.get("meta", []),
        }


# ---------------------------------------------------------------------------
# ClickHouse
# ---------------------------------------------------------------------------
class ClickHouseBackend:
    name = "clickhouse"

    def __init__(self, cfg: ClickHouseConfig) -> None:
        self._cfg = cfg
        auth = (cfg.username, cfg.password) if cfg.username else None
        # `database` is sent as a query-string param on every request so the
        # caller never has to write fully-qualified table names in the SQL.
        self._client = httpx.AsyncClient(
            base_url=cfg.url,
            auth=auth,
            params={"database": cfg.database},
            timeout=30.0,
        )

    async def ingest_event(self, payload: dict) -> None:
        # ClickHouse's HTTP interface accepts newline-delimited JSON with
        # `INSERT INTO <table> FORMAT JSONEachRow`.
        try:
            body = json.dumps(payload)
            resp = await self._client.post(
                "/",
                params={
                    "database": self._cfg.database,
                    "query": f"INSERT INTO {self._cfg.events_table} FORMAT JSONEachRow",
                },
                content=body,
            )
            if resp.status_code >= 400:
                logger.warning(
                    "ClickHouse ingest failed (%s): %s",
                    resp.status_code,
                    resp.text[:200],
                )
        except Exception:
            logger.warning("ClickHouse ingest raised", exc_info=True)

    async def execute_sql(self, sql: str) -> dict:
        # The queries module emits plain ClickHouse SQL against an `events`
        # table. If the operator configured a non-default table name we
        # rewrite the literal `FROM events` — a minimal, explicit alias so
        # we do not force a query-template rewrite.
        rewritten = sql
        if self._cfg.events_table != "events":
            rewritten = sql.replace("FROM events", f"FROM {self._cfg.events_table}")

        try:
            resp = await self._client.post(
                "/",
                params={"database": self._cfg.database, "default_format": "JSON"},
                content=rewritten,
            )
            resp.raise_for_status()
            result = resp.json()
        except httpx.HTTPStatusError as exc:
            error_msg = exc.response.text[:500]
            if any(frag in error_msg for frag in _MISSING_TABLE_FRAGMENTS):
                return EMPTY_RESULT
            logger.warning(
                "ClickHouse query failed (%s): %s",
                exc.response.status_code,
                error_msg,
            )
            raise BackendQueryError("Analytics query failed") from exc
        except Exception as exc:
            logger.warning("ClickHouse query failed: %s", str(exc)[:500])
            raise BackendQueryError("Analytics query failed") from exc

        rows = result.get("data", [])
        return {
            "data": rows,
            "rows": result.get("rows", len(rows)),
            "meta": result.get("meta", []),
        }


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------
_cached_backend: AnalyticsBackend | None = None
_cache_fingerprint: tuple | None = None


def _fingerprint(cfg: LearnHouseConfig) -> tuple:
    tb = cfg.tinybird_config
    ch = cfg.clickhouse_config
    return (
        cfg.analytics_backend,
        tb.api_url if tb else None,
        tb.ingest_token if tb else None,
        tb.read_token if tb else None,
        ch.url if ch else None,
        ch.database if ch else None,
        ch.username if ch else None,
        ch.password if ch else None,
        ch.events_table if ch else None,
    )


def get_analytics_backend() -> AnalyticsBackend | None:
    """Return the configured analytics backend, or None if analytics is disabled.

    The result is cached until the underlying config changes (detected via a
    cheap fingerprint of the relevant fields), so tests that mutate the
    config between runs still observe the new selection.
    """
    global _cached_backend, _cache_fingerprint

    cfg = get_learnhouse_config()
    fp = _fingerprint(cfg)
    if _cached_backend is not None and fp == _cache_fingerprint:
        return _cached_backend

    backend: AnalyticsBackend | None = None
    choice = cfg.analytics_backend

    if choice == "tinybird":
        if cfg.tinybird_config is not None:
            backend = TinybirdBackend(cfg.tinybird_config)
    elif choice == "clickhouse":
        if cfg.clickhouse_config is not None:
            backend = ClickHouseBackend(cfg.clickhouse_config)
    else:
        # Auto: Tinybird wins if both are set (preserves existing behavior).
        if cfg.tinybird_config is not None:
            backend = TinybirdBackend(cfg.tinybird_config)
        elif cfg.clickhouse_config is not None:
            backend = ClickHouseBackend(cfg.clickhouse_config)

    _cached_backend = backend
    _cache_fingerprint = fp
    return backend
