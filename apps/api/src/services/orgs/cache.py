"""
Redis cache layer for organization lookups.

Caches org-by-slug and instance info with short TTLs.
Falls back gracefully — if Redis is unavailable, queries hit the DB directly.
"""

import json
import logging
from typing import Optional

from src.core.redis import get_redis_client

logger = logging.getLogger(__name__)

CACHE_TTL_ORG_SLUG = 120       # org-by-slug — 2 min (short, keeps frontend fresh)
CACHE_TTL_INSTANCE_INFO = 600  # instance info — 10 min
CACHE_TTL_ORG_CONFIG = 120     # org config — same TTL as slug

_KEY_PREFIX = "org_cache"


def get_cached_org_config(org_id: int) -> Optional[dict]:
    """Return cached org config for an org_id, or None."""
    r = get_redis_client()
    if r is None:
        return None
    try:
        raw = r.get(f"{_KEY_PREFIX}:config:{org_id}")
        if raw:
            return json.loads(raw)
    except Exception:
        logger.debug("Org config cache read failed for org_id=%s", org_id, exc_info=True)
    return None


def set_cached_org_config(org_id: int, data: dict) -> None:
    """Cache org config keyed by org_id."""
    r = get_redis_client()
    if r is None:
        return
    try:
        r.setex(f"{_KEY_PREFIX}:config:{org_id}", CACHE_TTL_ORG_CONFIG, json.dumps(data))
    except Exception:
        logger.debug("Org config cache write failed for org_id=%s", org_id, exc_info=True)


def invalidate_org_config_cache(org_id: int) -> None:
    """Remove cached org config when config is updated."""
    r = get_redis_client()
    if r is None:
        return
    try:
        r.delete(f"{_KEY_PREFIX}:config:{org_id}")
    except Exception:
        logger.debug("Org config cache invalidate failed for org_id=%s", org_id, exc_info=True)


def get_cached_org_by_slug(slug: str) -> Optional[dict]:
    """Return cached org data for a slug, or None."""
    r = get_redis_client()
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
    r = get_redis_client()
    if r is None:
        return
    try:
        r.setex(f"{_KEY_PREFIX}:slug:{slug}", CACHE_TTL_ORG_SLUG, json.dumps(data))
    except Exception:
        logger.debug("Org cache write failed for slug=%s", slug, exc_info=True)


def invalidate_org_cache(slug: str) -> None:
    """Remove cached org data when org is updated."""
    r = get_redis_client()
    if r is None:
        return
    try:
        r.delete(f"{_KEY_PREFIX}:slug:{slug}")
    except Exception:
        logger.debug("Org cache invalidate failed for slug=%s", slug, exc_info=True)


def get_cached_instance_info() -> Optional[dict]:
    """Return cached instance info, or None."""
    r = get_redis_client()
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
    r = get_redis_client()
    if r is None:
        return
    try:
        r.setex(f"{_KEY_PREFIX}:instance_info", CACHE_TTL_INSTANCE_INFO, json.dumps(data))
    except Exception:
        logger.debug("Instance info cache write failed", exc_info=True)
