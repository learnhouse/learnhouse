"""
Unit tests for src/core/redis.py — the singleton Redis pool factory.

All tests manipulate the module-level _pool via reset_pool() so they are
fully independent and leave no global state behind.
"""

from unittest.mock import MagicMock, patch

import pytest

import src.core.redis as redis_module
from src.core.redis import get_redis_client, reset_pool


@pytest.fixture(autouse=True)
def _clean_pool():
    """Reset the global pool before and after every test."""
    reset_pool()
    yield
    reset_pool()


class TestBuildPool:
    def test_returns_none_when_conn_string_empty(self):
        config = MagicMock()
        config.redis_config.redis_connection_string = ""
        with patch("src.core.redis.get_learnhouse_config", return_value=config):
            pool = redis_module._build_pool()
        assert pool is None

    def test_returns_none_when_conn_string_is_none(self):
        config = MagicMock()
        config.redis_config.redis_connection_string = None
        with patch("src.core.redis.get_learnhouse_config", return_value=config):
            pool = redis_module._build_pool()
        assert pool is None

    def test_returns_pool_on_success(self):
        config = MagicMock()
        config.redis_config.redis_connection_string = "redis://localhost:6379/0"
        fake_pool = MagicMock()
        with patch("src.core.redis.get_learnhouse_config", return_value=config), patch(
            "redis.ConnectionPool.from_url", return_value=fake_pool
        ) as mock_from_url:
            pool = redis_module._build_pool()
        assert pool is fake_pool
        mock_from_url.assert_called_once_with(
            "redis://localhost:6379/0",
            max_connections=20,
            socket_connect_timeout=2,
            socket_timeout=5,
        )

    def test_returns_none_on_config_exception(self):
        with patch("src.core.redis.get_learnhouse_config", side_effect=RuntimeError("no config")):
            pool = redis_module._build_pool()
        assert pool is None

    def test_returns_none_on_from_url_exception(self):
        config = MagicMock()
        config.redis_config.redis_connection_string = "redis://localhost"
        with patch("src.core.redis.get_learnhouse_config", return_value=config), patch(
            "redis.ConnectionPool.from_url", side_effect=Exception("connection refused")
        ):
            pool = redis_module._build_pool()
        assert pool is None


class TestGetRedisClient:
    def test_returns_none_when_pool_cannot_be_built(self):
        with patch.object(redis_module, "_build_pool", return_value=None):
            client = get_redis_client()
        assert client is None

    def test_builds_pool_lazily_on_first_call(self):
        fake_pool = MagicMock()
        fake_client = MagicMock()
        with patch.object(redis_module, "_build_pool", return_value=fake_pool) as mock_build, patch(
            "redis.Redis", return_value=fake_client
        ):
            client = get_redis_client()
        mock_build.assert_called_once()
        assert client is fake_client

    def test_reuses_existing_pool_without_rebuilding(self):
        fake_pool = MagicMock()
        redis_module._pool = fake_pool  # pre-seed the pool
        fake_client = MagicMock()
        with patch.object(redis_module, "_build_pool") as mock_build, patch(
            "redis.Redis", return_value=fake_client
        ):
            client = get_redis_client()
        mock_build.assert_not_called()
        assert client is fake_client

    def test_returns_none_when_redis_constructor_raises(self):
        fake_pool = MagicMock()
        redis_module._pool = fake_pool
        with patch("redis.Redis", side_effect=Exception("pool exhausted")):
            client = get_redis_client()
        assert client is None


class TestResetPool:
    def test_clears_existing_pool(self):
        redis_module._pool = MagicMock()
        reset_pool()
        assert redis_module._pool is None

    def test_is_idempotent_when_already_none(self):
        redis_module._pool = None
        reset_pool()
        assert redis_module._pool is None
