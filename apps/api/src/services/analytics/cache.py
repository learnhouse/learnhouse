"""
Redis cache layer for Tinybird analytics queries.

Caches query results by (query_name, org_id, days, course_id) with a
configurable TTL.  Falls back gracefully — if Redis is unavailable the
query runs against Tinybird directly.
"""

import hashlib
import json
import logging
from typing import Optional

import redis
from config.config import get_learnhouse_config

logger = logging.getLogger(__name__)

# Default TTL per query category (seconds)
CACHE_TTL_CORE = 60        # core widgets — 1 min
CACHE_TTL_ADVANCED = 300   # advanced widgets — 5 min (expensive queries)
CACHE_TTL_COURSE = 60      # course-level widgets — 1 min
CACHE_TTL_DETAIL = 30      # detail/enriched queries — 30 s
CACHE_TTL_LIVE = 0         # live_users — never cached

# Queries that should never be cached (real-time data)
_NO_CACHE_QUERIES = {"live_users", "detail_live_users"}

_KEY_PREFIX = "tb_cache"


def _get_redis_client() -> Optional[redis.Redis]:
    """Return a Redis client or None if unavailable."""
    try:
        config = get_learnhouse_config()
        conn_string = config.redis_config.redis_connection_string
        if not conn_string:
            return None
        return redis.Redis.from_url(conn_string, socket_connect_timeout=2)
    except Exception:
        return None


def _build_cache_key(
    query_name: str,
    org_id: int,
    days: int,
    course_id: Optional[str] = None,
) -> str:
    """Build a deterministic Redis key for a query + params."""
    parts = f"{query_name}:{org_id}:{days}"
    if course_id:
        parts += f":{course_id}"
    # Short hash to keep key length reasonable
    digest = hashlib.md5(parts.encode()).hexdigest()[:12]
    return f"{_KEY_PREFIX}:{query_name}:{digest}"


def get_ttl_for_query(query_name: str) -> int:
    """Return the TTL in seconds for a given query name."""
    if query_name in _NO_CACHE_QUERIES:
        return 0
    if query_name.startswith("course_"):
        from src.services.analytics.queries import COURSE_DETAIL_QUERIES
        if query_name in COURSE_DETAIL_QUERIES:
            return CACHE_TTL_DETAIL
        return CACHE_TTL_COURSE
    if query_name.startswith("detail_"):
        return CACHE_TTL_DETAIL
    # Everything else — check if it's in the advanced set (imported lazily)
    from src.services.analytics.queries import ADVANCED_QUERIES
    if query_name in ADVANCED_QUERIES:
        return CACHE_TTL_ADVANCED
    return CACHE_TTL_CORE


def get_cached_result(
    query_name: str,
    org_id: int,
    days: int,
    course_id: Optional[str] = None,
) -> Optional[dict]:
    """Return cached analytics result or None."""
    if query_name in _NO_CACHE_QUERIES:
        return None
    r = _get_redis_client()
    if r is None:
        return None
    try:
        key = _build_cache_key(query_name, org_id, days, course_id)
        raw = r.get(key)
        if raw:
            return json.loads(raw)
    except Exception:
        logger.debug("Analytics cache read failed for %s", query_name, exc_info=True)
    return None


def set_cached_result(
    query_name: str,
    org_id: int,
    days: int,
    result: dict,
    course_id: Optional[str] = None,
) -> None:
    """Store an analytics result in Redis with appropriate TTL."""
    ttl = get_ttl_for_query(query_name)
    if ttl <= 0:
        return
    r = _get_redis_client()
    if r is None:
        return
    try:
        key = _build_cache_key(query_name, org_id, days, course_id)
        r.setex(key, ttl, json.dumps(result))
    except Exception:
        logger.debug("Analytics cache write failed for %s", query_name, exc_info=True)
