"""Router tests for src/routers/monitoring.py (Sentry feedback relay)."""

from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.routers.monitoring import router as monitoring_router


@pytest.fixture
def app():
    app = FastAPI()
    app.include_router(monitoring_router, prefix="/monitoring")
    return app


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class TestSubmitFeedback:
    async def test_empty_message_returns_400(self, client):
        response = await client.post("/monitoring/feedback", data={"message": "   "})
        assert response.status_code == 400
        assert response.json()["detail"] == "Feedback message is required"

    async def test_returns_early_when_sentry_inactive(self, client):
        # Line 43-44: when Sentry has no active client we short-circuit before
        # touching attachments / capture_event.
        inactive_client = MagicMock()
        inactive_client.is_active.return_value = False
        with patch("src.routers.monitoring.sentry_sdk.get_client", return_value=inactive_client), \
             patch("src.routers.monitoring.sentry_sdk.capture_event") as cap:
            response = await client.post(
                "/monitoring/feedback", data={"message": "hello"}
            )
        assert response.status_code == 204
        cap.assert_not_called()

    async def test_reads_attachment_when_sentry_active(self, client):
        # Line 53: with an active Sentry client and an attachment that has a
        # filename, the handler reads the (bounded) attachment bytes and forwards
        # the feedback event with the attachment added to the scope.
        active_client = MagicMock()
        active_client.is_active.return_value = True

        scope = MagicMock()
        scope_cm = MagicMock()
        scope_cm.__enter__.return_value = scope
        scope_cm.__exit__.return_value = False

        with patch("src.routers.monitoring.sentry_sdk.get_client", return_value=active_client), \
             patch("src.routers.monitoring.sentry_sdk.new_scope", return_value=scope_cm), \
             patch("src.routers.monitoring.sentry_sdk.capture_event") as cap:
            response = await client.post(
                "/monitoring/feedback",
                data={"message": "broken page", "name": "Tester", "email": "t@example.com"},
                files={"attachments": ("log.txt", b"trace-bytes", "text/plain")},
            )

        assert response.status_code == 204
        cap.assert_called_once()
        # The attachment was read and added to the scope.
        scope.add_attachment.assert_called_once()
        kwargs = scope.add_attachment.call_args.kwargs
        assert kwargs["bytes"] == b"trace-bytes"
        assert kwargs["filename"] == "log.txt"

    async def test_active_sentry_without_attachments_still_captures(self, client):
        # Active Sentry, no attachments: the event is still captured (no scope
        # attachment added).
        active_client = MagicMock()
        active_client.is_active.return_value = True

        scope = MagicMock()
        scope_cm = MagicMock()
        scope_cm.__enter__.return_value = scope
        scope_cm.__exit__.return_value = False

        with patch("src.routers.monitoring.sentry_sdk.get_client", return_value=active_client), \
             patch("src.routers.monitoring.sentry_sdk.new_scope", return_value=scope_cm), \
             patch("src.routers.monitoring.sentry_sdk.capture_event") as cap:
            response = await client.post(
                "/monitoring/feedback",
                data={"message": "no attachments here"},
            )

        assert response.status_code == 204
        cap.assert_called_once()
        scope.add_attachment.assert_not_called()
