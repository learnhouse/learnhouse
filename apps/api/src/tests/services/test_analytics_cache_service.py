"""Tests for src/services/analytics/cache.py."""

from types import SimpleNamespace
from unittest.mock import Mock, patch

from src.services.analytics.cache import (
    CACHE_TTL_ADVANCED,
    CACHE_TTL_CORE,
    CACHE_TTL_COURSE,
    CACHE_TTL_DETAIL,
    _build_cache_key,
    _get_redis_client,
    get_cached_result,
    get_ttl_for_query,
    set_cached_result,
)


def _make_config(*, redis_connection_string="redis://test"):
    return SimpleNamespace(redis_config=SimpleNamespace(redis_connection_string=redis_connection_string))


class TestAnalyticsCacheHelpers:
    def test_build_cache_key_is_deterministic(self):
        base_key = _build_cache_key("event_counts", 3, 14)
        same_key = _build_cache_key("event_counts", 3, 14)
        course_key = _build_cache_key("event_counts", 3, 14, course_id="course-1")

        assert base_key == same_key
        assert base_key.startswith("tb_cache:event_counts:")
        assert course_key != base_key

    def test_get_ttl_for_query_routes_all_branches(self):
        assert get_ttl_for_query("live_users") == 0
        assert get_ttl_for_query("detail_live_users") == 0
        assert get_ttl_for_query("course_recent_enrollments") == CACHE_TTL_DETAIL
        assert get_ttl_for_query("course_custom_widget") == CACHE_TTL_COURSE
        assert get_ttl_for_query("detail_custom") == CACHE_TTL_DETAIL
        assert get_ttl_for_query("peak_usage_hours") == CACHE_TTL_ADVANCED
        assert get_ttl_for_query("event_counts") == CACHE_TTL_CORE

    def test_get_redis_client_missing_connection_string_returns_none(self):
        with patch(
            "src.services.analytics.cache.get_learnhouse_config",
            return_value=_make_config(redis_connection_string=""),
        ):
            assert _get_redis_client() is None

    def test_get_redis_client_handles_construction_errors(self):
        with patch(
            "src.services.analytics.cache.get_learnhouse_config",
            return_value=_make_config(),
        ), patch("src.services.analytics.cache.redis.Redis.from_url", side_effect=RuntimeError("boom")):
            assert _get_redis_client() is None


class TestAnalyticsCacheReadsAndWrites:
    def test_get_cached_result_handles_no_cache_redis_unavailable_and_hit(self):
        cached_payload = {"result": 1}
        redis_client = Mock()
        redis_client.get.return_value = b'{"result": 1}'

        with patch(
            "src.services.analytics.cache._get_redis_client",
            return_value=redis_client,
        ), patch("src.services.analytics.cache.logger.debug") as mock_debug:
            assert get_cached_result("live_users", 1, 7) is None
            assert get_cached_result("event_counts", 1, 7) == cached_payload

            redis_client.get.side_effect = RuntimeError("boom")
            assert get_cached_result("event_counts", 1, 7) is None

        mock_debug.assert_called_once()

    def test_set_cached_result_handles_ttl_guard_and_write_paths(self):
        redis_client = Mock()

        with patch(
            "src.services.analytics.cache.get_ttl_for_query",
            side_effect=[0, 60, 60, 60],
        ), patch(
            "src.services.analytics.cache._get_redis_client",
            return_value=redis_client,
        ), patch("src.services.analytics.cache.logger.debug") as mock_debug:
            set_cached_result("live_users", 1, 7, {"x": 1})
            set_cached_result("event_counts", 2, 14, {"count": 2})
            set_cached_result("event_counts", 3, 21, {"count": 3}, course_id="course-1")

            redis_client.setex.side_effect = RuntimeError("boom")
            set_cached_result("event_counts", 4, 28, {"count": 4})

        assert redis_client.setex.call_count == 3
        assert redis_client.setex.call_args_list[0].args[1] == 60
        assert redis_client.setex.call_args_list[1].args[1] == 60
        assert redis_client.setex.call_args_list[2].args[1] == 60
        assert mock_debug.call_count == 1
