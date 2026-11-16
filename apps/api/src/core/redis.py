"""
Singleton Redis connection pool factory.

All modules that need Redis should import get_redis_client() from here
instead of creating their own redis.Redis instances. This ensures a single
connection pool is shared across all cache layers, preventing connection
exhaustion under load.
"""

import logging
from typing import Optional

import redis

from config.config import get_learnhouse_config

logger = logging.getLogger(__name__)

_pool: Optional[redis.ConnectionPool] = None
# One client over the pool. redis.Redis is safe to share (each command checks a
# connection out of the pool), and building one per call re-created its ~170
# response callbacks every time, several times per request.
_client: Optional[redis.Redis] = None
_client_pool: Optional[redis.ConnectionPool] = None


def _build_pool() -> Optional[redis.ConnectionPool]:
    try:
        config = get_learnhouse_config()
        conn_string = config.redis_config.redis_connection_string
        if not conn_string:
            return None
        return redis.ConnectionPool.from_url(
            conn_string,
            max_connections=20,
            socket_connect_timeout=2,
            socket_timeout=5,
        )
    except Exception:
        logger.debug("Redis pool creation failed; cache disabled", exc_info=True)
        return None


def get_redis_client() -> Optional[redis.Redis]:
    """
    Return a Redis client backed by the shared connection pool, or None if
    Redis is not configured or unavailable.

    All cache operations should call this instead of creating their own clients.
    """
    global _pool, _client, _client_pool
    if _pool is None:
        _pool = _build_pool()
    if _pool is None:
        return None
    if _client is not None and _client_pool is _pool:
        return _client
    try:
        _client = redis.Redis(connection_pool=_pool)
        _client_pool = _pool
        return _client
    except Exception:
        logger.debug("Failed to get Redis client from pool", exc_info=True)
        return None


def reset_pool() -> None:
    """Reset the connection pool (used in tests)."""
    global _pool, _client, _client_pool
    _pool = None
    _client = None
    _client_pool = None
