"""
Redis cache layer for organization lookups.

Caches org-by-slug and instance info with short TTLs.
Falls back gracefully — if Redis is unavailable, queries hit the DB directly.
"""

import json
import logging
from typing import Optional

import redis
from config.config import get_learnhouse_config

logger = logging.getLogger(__name__)

CACHE_TTL_ORG_SLUG = 120       # org-by-slug — 2 min (short, keeps frontend fresh)
CACHE_TTL_INSTANCE_INFO = 600  # instance info — 10 min

_KEY_PREFIX = "org_cache"


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


def get_cached_org_by_slug(slug: str) -> Optional[dict]:
    """Return cached org data for a slug, or None."""
    r = _get_redis_client()
    if r is None:
        return None
    try:
        raw = r.get(f"{_KEY_PREFIX}:slug:{slug}")
        if raw:
            return json.loads(raw)
    except Exception:
        logger.debug("Org cache read failed for slug=%s", slug, exc_info=True)
    return None


def set_cached_org_by_slug(slug: str, data: dict) -> None:
    """Cache org data keyed by slug."""
    r = _get_redis_client()
    if r is None:
        return
    try:
        r.setex(f"{_KEY_PREFIX}:slug:{slug}", CACHE_TTL_ORG_SLUG, json.dumps(data))
    except Exception:
        logger.debug("Org cache write failed for slug=%s", slug, exc_info=True)


def invalidate_org_cache(slug: str) -> None:
    """Remove cached org data when org is updated."""
    r = _get_redis_client()
    if r is None:
        return
    try:
        r.delete(f"{_KEY_PREFIX}:slug:{slug}")
    except Exception:
        logger.debug("Org cache invalidate failed for slug=%s", slug, exc_info=True)


def get_cached_instance_info() -> Optional[dict]:
    """Return cached instance info, or None."""
    r = _get_redis_client()
    if r is None:
        return None
    try:
        raw = r.get(f"{_KEY_PREFIX}:instance_info")
        if raw:
            return json.loads(raw)
    except Exception:
        logger.debug("Instance info cache read failed", exc_info=True)
    return None


def set_cached_instance_info(data: dict) -> None:
    """Cache instance info."""
    r = _get_redis_client()
    if r is None:
        return
    try:
        r.setex(f"{_KEY_PREFIX}:instance_info", CACHE_TTL_INSTANCE_INFO, json.dumps(data))
    except Exception:
        logger.debug("Instance info cache write failed", exc_info=True)
