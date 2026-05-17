"""
Direct unit tests for src/services/orgs/cache.py.

Tests every function (get/set/invalidate for org_config, org_by_slug, and
instance_info) across the happy path, the Redis-unavailable path, and the
exception-swallowing path.
"""

import json
from unittest.mock import MagicMock, patch

from src.services.orgs import cache as cache_module
from src.services.orgs.cache import (
    get_cached_org_config,
    invalidate_org_config_cache,
    set_cached_org_config,
    get_cached_org_by_slug,
    set_cached_org_by_slug,
    invalidate_org_cache,
    get_cached_instance_info,
    set_cached_instance_info,
)


def _mock_redis(*, get_val=None, error=None):
    r = MagicMock()
    if error:
        r.get.side_effect = error
        r.setex.side_effect = error
        r.delete.side_effect = error
        r.mget.side_effect = error
    else:
        r.get.return_value = json.dumps(get_val).encode() if get_val is not None else None
    return r


# ---------------------------------------------------------------------------
# get_cached_org_config
# ---------------------------------------------------------------------------

class TestGetCachedOrgConfig:
    def test_returns_none_when_redis_unavailable(self):
        with patch("src.services.orgs.cache.get_redis_client", return_value=None):
            assert get_cached_org_config(1) is None

    def test_returns_parsed_dict_on_cache_hit(self):
        r = _mock_redis(get_val={"plan": "pro"})
        with patch("src.services.orgs.cache.get_redis_client", return_value=r):
            result = get_cached_org_config(1)
        assert result == {"plan": "pro"}
        r.get.assert_called_once_with("org_cache:config:1")

    def test_returns_none_on_cache_miss(self):
        r = _mock_redis()
        with patch("src.services.orgs.cache.get_redis_client", return_value=r):
            assert get_cached_org_config(2) is None

    def test_swallows_redis_exception(self):
        r = _mock_redis(error=RuntimeError("redis down"))
        with patch("src.services.orgs.cache.get_redis_client", return_value=r):
            assert get_cached_org_config(3) is None


# ---------------------------------------------------------------------------
# set_cached_org_config
# ---------------------------------------------------------------------------

class TestSetCachedOrgConfig:
    def test_no_op_when_redis_unavailable(self):
        with patch("src.services.orgs.cache.get_redis_client", return_value=None):
            set_cached_org_config(1, {"plan": "free"})  # must not raise

    def test_calls_setex_with_correct_key_and_ttl(self):
        r = MagicMock()
        with patch("src.services.orgs.cache.get_redis_client", return_value=r):
            set_cached_org_config(5, {"plan": "standard"})
        r.setex.assert_called_once_with(
            "org_cache:config:5",
            cache_module.CACHE_TTL_ORG_CONFIG,
            json.dumps({"plan": "standard"}),
        )

    def test_swallows_redis_exception(self):
        r = _mock_redis(error=RuntimeError("timeout"))
        with patch("src.services.orgs.cache.get_redis_client", return_value=r):
            set_cached_org_config(6, {"plan": "free"})  # must not raise


# ---------------------------------------------------------------------------
# invalidate_org_config_cache
# ---------------------------------------------------------------------------

class TestInvalidateOrgConfigCache:
    def test_no_op_when_redis_unavailable(self):
        with patch("src.services.orgs.cache.get_redis_client", return_value=None):
            invalidate_org_config_cache(1)  # must not raise

    def test_calls_delete_with_correct_key(self):
        r = MagicMock()
        with patch("src.services.orgs.cache.get_redis_client", return_value=r):
            invalidate_org_config_cache(7)
        r.delete.assert_called_once_with("org_cache:config:7")

    def test_swallows_redis_exception(self):
        r = _mock_redis(error=RuntimeError("io error"))
        with patch("src.services.orgs.cache.get_redis_client", return_value=r):
            invalidate_org_config_cache(8)  # must not raise


# ---------------------------------------------------------------------------
# get_cached_org_by_slug / set_cached_org_by_slug / invalidate_org_cache
# ---------------------------------------------------------------------------

class TestOrgBySlugCache:
    def test_get_returns_none_when_redis_unavailable(self):
        with patch("src.services.orgs.cache.get_redis_client", return_value=None):
            assert get_cached_org_by_slug("my-org") is None

    def test_get_returns_parsed_dict(self):
        r = _mock_redis(get_val={"name": "My Org"})
        with patch("src.services.orgs.cache.get_redis_client", return_value=r):
            result = get_cached_org_by_slug("my-org")
        assert result == {"name": "My Org"}
        r.get.assert_called_once_with("org_cache:slug:my-org")

    def test_set_calls_setex(self):
        r = MagicMock()
        with patch("src.services.orgs.cache.get_redis_client", return_value=r):
            set_cached_org_by_slug("my-org", {"name": "My Org"})
        r.setex.assert_called_once_with(
            "org_cache:slug:my-org",
            cache_module.CACHE_TTL_ORG_SLUG,
            json.dumps({"name": "My Org"}),
        )

    def test_invalidate_calls_delete(self):
        r = MagicMock()
        with patch("src.services.orgs.cache.get_redis_client", return_value=r):
            invalidate_org_cache("my-org")
        r.delete.assert_called_once_with("org_cache:slug:my-org")


# ---------------------------------------------------------------------------
# get_cached_instance_info / set_cached_instance_info
# ---------------------------------------------------------------------------

class TestInstanceInfoCache:
    def test_get_returns_none_when_redis_unavailable(self):
        with patch("src.services.orgs.cache.get_redis_client", return_value=None):
            assert get_cached_instance_info() is None

    def test_get_returns_parsed_dict(self):
        r = _mock_redis(get_val={"version": "1.0"})
        with patch("src.services.orgs.cache.get_redis_client", return_value=r):
            result = get_cached_instance_info()
        assert result == {"version": "1.0"}

    def test_set_calls_setex(self):
        r = MagicMock()
        with patch("src.services.orgs.cache.get_redis_client", return_value=r):
            set_cached_instance_info({"version": "2.0"})
        r.setex.assert_called_once_with(
            "org_cache:instance_info",
            cache_module.CACHE_TTL_INSTANCE_INFO,
            json.dumps({"version": "2.0"}),
        )
