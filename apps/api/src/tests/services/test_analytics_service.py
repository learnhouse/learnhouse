"""Tests for src/services/analytics/analytics.py."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

import src.services.analytics.analytics as analytics_module
from src.services.analytics.analytics import _get_ingest_client, _send_event, track


def _make_config(*, tinybird_config=None):
    return SimpleNamespace(tinybird_config=tinybird_config)


class TestAnalyticsTrack:
    @pytest.mark.asyncio
    async def test_track_no_tinybird_config_returns_without_scheduling(self):
        with patch(
            "src.services.analytics.analytics.get_learnhouse_config",
            return_value=_make_config(),
        ), patch("src.services.analytics.analytics.asyncio.create_task") as mock_create_task:
            await track("page_view", org_id=10)

        mock_create_task.assert_not_called()

    @pytest.mark.asyncio
    async def test_track_schedules_fire_and_forget_event(self):
        tinybird_config = SimpleNamespace(api_url="https://tinybird.test", ingest_token="secret")
        scheduled = {}

        def _fake_create_task(coro):
            scheduled["coro"] = coro
            coro.close()
            return Mock(name="task")

        with patch(
            "src.services.analytics.analytics.get_learnhouse_config",
            return_value=_make_config(tinybird_config=tinybird_config),
        ), patch("src.services.analytics.analytics.asyncio.create_task", side_effect=_fake_create_task) as mock_create_task:
            await track(
                "course_view",
                org_id=11,
                user_id=22,
                session_id="session-1",
                properties={"course_uuid": "course-1"},
                source="web",
                ip="127.0.0.1",
            )

        assert "coro" in scheduled
        mock_create_task.assert_called_once()


class TestAnalyticsSendEvent:
    @pytest.mark.asyncio
    async def test_send_event_returns_when_client_unavailable(self):
        with patch(
            "src.services.analytics.analytics._get_ingest_client",
            return_value=None,
        ), patch("src.services.analytics.analytics.logger.warning") as mock_warning:
            await _send_event(
                "page_view",
                org_id=1,
                user_id=2,
                session_id="session",
                properties={},
                source="api",
                ip="",
            )

        mock_warning.assert_not_called()

    @pytest.mark.asyncio
    async def test_send_event_posts_payload_and_logs_http_errors(self):
        response = SimpleNamespace(status_code=500, text="failure-body")
        client = AsyncMock()
        client.post.return_value = response
        fixed_now = SimpleNamespace(strftime=Mock(return_value="2024-01-02 03:04:05"))

        with patch(
            "src.services.analytics.analytics._get_ingest_client",
            return_value=client,
        ), patch(
            "src.services.analytics.analytics.datetime"
        ) as mock_datetime, patch("src.services.analytics.analytics.logger.warning") as mock_warning:
            mock_datetime.now.return_value = fixed_now

            await _send_event(
                "course_completed",
                org_id=7,
                user_id=8,
                session_id="session-2",
                properties={"course_uuid": "course-2"},
                source="api",
                ip="10.0.0.1",
            )

        client.post.assert_awaited_once()
        assert client.post.await_args.args == ("/v0/events?name=events",)
        assert client.post.await_args.kwargs["json"] == {
            "event_name": "course_completed",
            "timestamp": "2024-01-02 03:04:05",
            "org_id": 7,
            "user_id": 8,
            "session_id": "session-2",
            "properties": '{"course_uuid": "course-2"}',
            "source": "api",
            "ip": "10.0.0.1",
        }
        mock_warning.assert_called_once_with(
            "Tinybird ingest failed (%s): %s",
            500,
            "failure-body",
        )

    @pytest.mark.asyncio
    async def test_send_event_logs_exception_and_swallow_failure(self):
        client = AsyncMock()
        client.post.side_effect = RuntimeError("boom")

        with patch(
            "src.services.analytics.analytics._get_ingest_client",
            return_value=client,
        ), patch("src.services.analytics.analytics.logger.warning") as mock_warning:
            await _send_event(
                "page_view",
                org_id=1,
                user_id=2,
                session_id="session-3",
                properties={"path": "/"},
                source="api",
                ip="127.0.0.1",
            )

        client.post.assert_awaited_once()
        mock_warning.assert_called_once()
        assert mock_warning.call_args.args[0] == "Failed to send analytics event %s"
        assert mock_warning.call_args.args[1] == "page_view"
        assert mock_warning.call_args.kwargs["exc_info"] is True


class TestAnalyticsIngestClient:
    def test_get_ingest_client_missing_config_returns_none(self):
        with patch(
            "src.services.analytics.analytics.get_learnhouse_config",
            return_value=_make_config(),
        ):
            assert _get_ingest_client() is None

    def test_get_ingest_client_builds_and_reuses_singleton(self):
        tinybird_config = SimpleNamespace(api_url="https://tinybird.test", ingest_token="secret")
        fake_client = Mock(name="async_client")

        with patch(
            "src.services.analytics.analytics.get_learnhouse_config",
            return_value=_make_config(tinybird_config=tinybird_config),
        ), patch("src.services.analytics.analytics.httpx.AsyncClient", return_value=fake_client) as mock_async_client, patch.object(
            analytics_module,
            "_ingest_client",
            None,
        ):
            first = _get_ingest_client()
            second = _get_ingest_client()

        assert first is fake_client
        assert second is fake_client
        mock_async_client.assert_called_once_with(
            base_url="https://tinybird.test",
            headers={"Authorization": "Bearer secret"},
            timeout=10.0,
        )

