"""
Redis cache layer for course listings.

Caches public course lists by org slug with short TTLs.
Invalidated when courses are created, updated, or deleted.
"""

import json
import logging
from typing import Optional

import redis
from config.config import get_learnhouse_config

logger = logging.getLogger(__name__)

CACHE_TTL_COURSES_LIST = 60  # 1 min — public course list

_KEY_PREFIX = "courses_cache"


def _get_redis_client() -> Optional[redis.Redis]:
    try:
        config = get_learnhouse_config()
        conn_string = config.redis_config.redis_connection_string
        if not conn_string:
            return None
        return redis.Redis.from_url(conn_string, socket_connect_timeout=2)
    except Exception:
        return None


def get_cached_courses_list(org_slug: str, page: int, limit: int) -> Optional[list]:
    """Return cached public course list for an org, or None."""
    r = _get_redis_client()
    if r is None:
        return None
    try:
        key = f"{_KEY_PREFIX}:list:{org_slug}:{page}:{limit}"
        raw = r.get(key)
        if raw:
            return json.loads(raw)
    except Exception:
        logger.debug("Courses cache read failed for %s", org_slug, exc_info=True)
    return None


def set_cached_courses_list(org_slug: str, page: int, limit: int, data: list) -> None:
    """Cache public course list for an org."""
    r = _get_redis_client()
    if r is None:
        return
    try:
        key = f"{_KEY_PREFIX}:list:{org_slug}:{page}:{limit}"
        r.setex(key, CACHE_TTL_COURSES_LIST, json.dumps(data, default=str))
    except Exception:
        logger.debug("Courses cache write failed for %s", org_slug, exc_info=True)


def invalidate_courses_cache(org_slug: str) -> None:
    """Remove all cached course lists for an org."""
    r = _get_redis_client()
    if r is None:
        return
    try:
        # Delete all list keys for this org
        pattern = f"{_KEY_PREFIX}:list:{org_slug}:*"
        keys = r.keys(pattern)
        if keys:
            r.delete(*keys)
    except Exception:
        logger.debug("Courses cache invalidate failed for %s", org_slug, exc_info=True)


# ── Course meta cache (per-course, shared across users) ──

CACHE_TTL_COURSE_META = 60  # 1 min

def get_cached_course_meta(course_uuid: str, slim: bool) -> Optional[dict]:
    """Return cached course meta, or None."""
    r = _get_redis_client()
    if r is None:
        return None
    try:
        suffix = ":slim" if slim else ":full"
        raw = r.get(f"{_KEY_PREFIX}:meta:{course_uuid}{suffix}")
        if raw:
            return json.loads(raw)
    except Exception:
        logger.debug("Course meta cache read failed for %s", course_uuid, exc_info=True)
    return None


def set_cached_course_meta(course_uuid: str, slim: bool, data: dict) -> None:
    """Cache course meta (shared across all users who have access)."""
    r = _get_redis_client()
    if r is None:
        return
    try:
        suffix = ":slim" if slim else ":full"
        r.setex(
            f"{_KEY_PREFIX}:meta:{course_uuid}{suffix}",
            CACHE_TTL_COURSE_META,
            json.dumps(data, default=str),
        )
    except Exception:
        logger.debug("Course meta cache write failed for %s", course_uuid, exc_info=True)


def invalidate_course_meta_cache(course_uuid: str) -> None:
    """Remove cached course meta when course is updated."""
    r = _get_redis_client()
    if r is None:
        return
    try:
        r.delete(
            f"{_KEY_PREFIX}:meta:{course_uuid}:slim",
            f"{_KEY_PREFIX}:meta:{course_uuid}:full",
        )
    except Exception:
        logger.debug("Course meta cache invalidate failed for %s", course_uuid, exc_info=True)
