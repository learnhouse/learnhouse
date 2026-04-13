"""Tests for src/services/courses/cache.py."""

from types import SimpleNamespace
from unittest.mock import Mock, patch

from src.services.courses.cache import (
    CACHE_TTL_COURSE_META,
    CACHE_TTL_COURSES_LIST,
    _get_redis_client,
    get_cached_course_meta,
    get_cached_courses_list,
    invalidate_course_meta_cache,
    invalidate_courses_cache,
    set_cached_course_meta,
    set_cached_courses_list,
)


def _make_config(*, redis_connection_string="redis://test"):
    return SimpleNamespace(redis_config=SimpleNamespace(redis_connection_string=redis_connection_string))


class TestRedisClient:
    def test_get_redis_client_returns_none_without_connection_string(self):
        with patch(
            "src.services.courses.cache.get_learnhouse_config",
            return_value=_make_config(redis_connection_string=""),
        ):
            assert _get_redis_client() is None

    def test_get_redis_client_returns_client_and_handles_errors(self):
        with patch(
            "src.services.courses.cache.get_learnhouse_config",
            return_value=_make_config(),
        ), patch("src.services.courses.cache.redis.Redis.from_url", return_value=Mock()) as mock_from_url:
            client = _get_redis_client()

        mock_from_url.assert_called_once_with("redis://test", socket_connect_timeout=2)
        assert client is not None

        with patch(
            "src.services.courses.cache.get_learnhouse_config",
            side_effect=RuntimeError("boom"),
        ):
            assert _get_redis_client() is None


class TestCourseListCache:
    def test_get_cached_courses_list_returns_none_when_redis_is_unavailable(self):
        with patch("src.services.courses.cache._get_redis_client", return_value=None):
            assert get_cached_courses_list("org-1", 1, 10) is None

    def test_get_cached_courses_list_covers_miss_hit_and_failure(self):
        redis_client = Mock()
        redis_client.get.return_value = b"[{\"id\": 1}]"

        with patch(
            "src.services.courses.cache._get_redis_client",
            return_value=redis_client,
        ), patch("src.services.courses.cache.logger.debug") as mock_debug:
            assert get_cached_courses_list("org-1", 1, 10) == [{"id": 1}]

            redis_client.get.return_value = None
            assert get_cached_courses_list("org-1", 1, 10) is None

            redis_client.get.side_effect = RuntimeError("boom")
            assert get_cached_courses_list("org-1", 1, 10) is None

        mock_debug.assert_called_once()

    def test_set_cached_courses_list_covers_write_and_failure(self):
        redis_client = Mock()

        with patch(
            "src.services.courses.cache._get_redis_client",
            return_value=redis_client,
        ), patch("src.services.courses.cache.logger.debug") as mock_debug:
            set_cached_courses_list("org-1", 2, 25, [{"id": 1}])

            redis_client.setex.side_effect = RuntimeError("boom")
            set_cached_courses_list("org-1", 2, 25, [{"id": 2}])

        assert redis_client.setex.call_count == 2
        assert redis_client.setex.call_args_list[0].args[0] == "courses_cache:list:org-1:2:25"
        assert redis_client.setex.call_args_list[0].args[1] == CACHE_TTL_COURSES_LIST
        mock_debug.assert_called_once()

    def test_set_cached_courses_list_returns_quickly_when_redis_is_unavailable(self):
        with patch("src.services.courses.cache._get_redis_client", return_value=None):
            set_cached_courses_list("org-1", 2, 25, [{"id": 1}])

    def test_invalidate_courses_cache_covers_delete_paths(self):
        redis_client = Mock()
        redis_client.keys.return_value = [b"courses_cache:list:org-1:1:10"]

        with patch(
            "src.services.courses.cache._get_redis_client",
            return_value=redis_client,
        ), patch("src.services.courses.cache.logger.debug") as mock_debug:
            invalidate_courses_cache("org-1")

            redis_client.keys.return_value = []
            invalidate_courses_cache("org-1")

            redis_client.keys.side_effect = RuntimeError("boom")
            invalidate_courses_cache("org-1")

        redis_client.delete.assert_called_once_with(b"courses_cache:list:org-1:1:10")
        mock_debug.assert_called_once()

    def test_invalidate_courses_cache_returns_quickly_when_redis_is_unavailable(self):
        with patch("src.services.courses.cache._get_redis_client", return_value=None):
            invalidate_courses_cache("org-1")


class TestCourseMetaCache:
    def test_get_cached_course_meta_returns_none_when_redis_is_unavailable(self):
        with patch("src.services.courses.cache._get_redis_client", return_value=None):
            assert get_cached_course_meta("course-1", slim=True) is None

    def test_get_cached_course_meta_covers_hit_miss_and_failure(self):
        redis_client = Mock()
        redis_client.get.return_value = b"{\"id\": 1}"

        with patch(
            "src.services.courses.cache._get_redis_client",
            return_value=redis_client,
        ), patch("src.services.courses.cache.logger.debug") as mock_debug:
            assert get_cached_course_meta("course-1", slim=True) == {"id": 1}

            redis_client.get.return_value = None
            assert get_cached_course_meta("course-1", slim=False) is None

            redis_client.get.side_effect = RuntimeError("boom")
            assert get_cached_course_meta("course-1", slim=False) is None

        mock_debug.assert_called_once()

    def test_set_cached_course_meta_covers_write_and_failure(self):
        redis_client = Mock()

        with patch(
            "src.services.courses.cache._get_redis_client",
            return_value=redis_client,
        ), patch("src.services.courses.cache.logger.debug") as mock_debug:
            set_cached_course_meta("course-1", slim=True, data={"id": 1})

            redis_client.setex.side_effect = RuntimeError("boom")
            set_cached_course_meta("course-1", slim=False, data={"id": 2})

        assert redis_client.setex.call_count == 2
        assert redis_client.setex.call_args_list[0].args[0] == "courses_cache:meta:course-1:slim"
        assert redis_client.setex.call_args_list[0].args[1] == CACHE_TTL_COURSE_META
        mock_debug.assert_called_once()

    def test_set_cached_course_meta_returns_quickly_when_redis_is_unavailable(self):
        with patch("src.services.courses.cache._get_redis_client", return_value=None):
            set_cached_course_meta("course-1", slim=True, data={"id": 1})

    def test_invalidate_course_meta_cache_covers_delete_and_failure(self):
        redis_client = Mock()

        with patch(
            "src.services.courses.cache._get_redis_client",
            return_value=redis_client,
        ), patch("src.services.courses.cache.logger.debug") as mock_debug:
            invalidate_course_meta_cache("course-1")

            redis_client.delete.side_effect = RuntimeError("boom")
            invalidate_course_meta_cache("course-1")

        assert redis_client.delete.call_count == 2
        assert redis_client.delete.call_args_list[0].args == (
            "courses_cache:meta:course-1:slim",
            "courses_cache:meta:course-1:full",
        )
        mock_debug.assert_called_once()

    def test_invalidate_course_meta_cache_returns_quickly_when_redis_is_unavailable(self):
        with patch("src.services.courses.cache._get_redis_client", return_value=None):
            invalidate_course_meta_cache("course-1")
