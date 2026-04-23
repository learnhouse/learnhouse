"""Router tests for src/routers/webhooks.py."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.webhooks import (
    WebhookDeliveryLogRead,
    WebhookEndpointCreatedResponse,
    WebhookEndpointRead,
)
from src.routers.webhooks import router as webhooks_router
from src.security.auth import get_current_user


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(webhooks_router, prefix="/api/v1/orgs")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


def _mock_webhook_read(**overrides) -> WebhookEndpointRead:
    data = dict(
        id=1,
        webhook_uuid="webhook_test",
        org_id=1,
        url="https://example.com/hook",
        description="Webhook",
        events=["course.created"],
        is_active=True,
        has_secret=True,
        created_by_user_id=1,
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )
    data.update(overrides)
    return WebhookEndpointRead(**data)


def _mock_webhook_created(**overrides) -> WebhookEndpointCreatedResponse:
    data = dict(
        webhook_uuid="webhook_test",
        url="https://example.com/hook",
        description="Webhook",
        events=["course.created"],
        is_active=True,
        secret="whsec_123",
        created_by_user_id=1,
        creation_date="2024-01-01",
    )
    data.update(overrides)
    return WebhookEndpointCreatedResponse(**data)


def _mock_delivery(**overrides) -> WebhookDeliveryLogRead:
    data = dict(
        id=1,
        webhook_id=1,
        event_name="course.created",
        delivery_uuid="delivery_1",
        request_payload={"ok": True},
        response_status=200,
        response_body="ok",
        success=True,
        attempt=1,
        error_message=None,
        created_at="2024-01-01",
    )
    data.update(overrides)
    return WebhookDeliveryLogRead(**data)


class TestWebhooksRouter:
    @pytest.fixture(autouse=True)
    def _bypass_webhook_rate_limit(self):
        with patch(
            "src.routers.webhooks.check_webhook_mutation_rate_limit",
            return_value=(True, 0),
        ):
            yield

    async def test_list_webhook_events(self, client):
        response = await client.get("/api/v1/orgs/1/webhooks/events")

        assert response.status_code == 200
        assert "events" in response.json()

    async def test_create_webhook_endpoint(self, client):
        with patch(
            "src.routers.webhooks.create_webhook_endpoint",
            new_callable=AsyncMock,
            return_value=_mock_webhook_created(),
        ):
            response = await client.post(
                "/api/v1/orgs/1/webhooks",
                json={"url": "https://example.com/hook", "events": ["course.created"]},
            )

        assert response.status_code == 200
        assert response.json()["secret"] == "whsec_123"

    async def test_list_webhook_endpoints(self, client):
        with patch(
            "src.routers.webhooks.get_webhook_endpoints",
            new_callable=AsyncMock,
            return_value=[_mock_webhook_read()],
        ):
            response = await client.get("/api/v1/orgs/1/webhooks")

        assert response.status_code == 200
        assert response.json()[0]["webhook_uuid"] == "webhook_test"

    async def test_get_webhook_endpoint(self, client):
        with patch(
            "src.routers.webhooks.get_webhook_endpoint",
            new_callable=AsyncMock,
            return_value=_mock_webhook_read(),
        ):
            response = await client.get("/api/v1/orgs/1/webhooks/webhook_test")

        assert response.status_code == 200
        assert response.json()["url"] == "https://example.com/hook"

    async def test_update_webhook_endpoint(self, client):
        with patch(
            "src.routers.webhooks.update_webhook_endpoint",
            new_callable=AsyncMock,
            return_value=_mock_webhook_read(description="Updated"),
        ):
            response = await client.put(
                "/api/v1/orgs/1/webhooks/webhook_test",
                json={"description": "Updated"},
            )

        assert response.status_code == 200
        assert response.json()["description"] == "Updated"

    async def test_delete_webhook_endpoint(self, client):
        with patch(
            "src.routers.webhooks.delete_webhook_endpoint",
            new_callable=AsyncMock,
            return_value={"deleted": True},
        ):
            response = await client.delete("/api/v1/orgs/1/webhooks/webhook_test")

        assert response.status_code == 200
        assert response.json()["deleted"] is True

    async def test_regenerate_webhook_secret(self, client):
        with patch(
            "src.routers.webhooks.regenerate_webhook_secret",
            new_callable=AsyncMock,
            return_value=_mock_webhook_created(secret="whsec_new"),
        ):
            response = await client.post(
                "/api/v1/orgs/1/webhooks/webhook_test/regenerate-secret"
            )

        assert response.status_code == 200
        assert response.json()["secret"] == "whsec_new"

    async def test_send_test_event(self, client):
        with patch(
            "src.routers.webhooks.send_test_event",
            new_callable=AsyncMock,
            return_value={"sent": True},
        ):
            response = await client.post("/api/v1/orgs/1/webhooks/webhook_test/test")

        assert response.status_code == 200
        assert response.json()["sent"] is True

    async def test_get_webhook_deliveries(self, client):
        with patch(
            "src.routers.webhooks.get_webhook_delivery_logs",
            new_callable=AsyncMock,
            return_value=[_mock_delivery()],
        ):
            response = await client.get(
                "/api/v1/orgs/1/webhooks/webhook_test/deliveries?limit=10"
            )

        assert response.status_code == 200
        assert response.json()[0]["delivery_uuid"] == "delivery_1"
