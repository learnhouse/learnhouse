from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.webhooks import (
    WebhookDeliveryLog,
    WebhookEndpoint,
    WebhookEndpointCreate,
    WebhookEndpointUpdate,
)
from src.services.webhooks import webhooks


def _make_webhook_endpoint(
    db,
    org,
    *,
    webhook_uuid="webhook_test",
    url="https://example.com/hook",
    description="Webhook",
    events=None,
    is_active=True,
    secret_encrypted="encrypted-secret",
):
    endpoint = WebhookEndpoint(
        webhook_uuid=webhook_uuid,
        org_id=org.id,
        url=url,
        secret_encrypted=secret_encrypted,
        description=description,
        events=events or ["course_created"],
        is_active=is_active,
        created_by_user_id=1,
        creation_date="2024-01-01T00:00:00",
        update_date="2024-01-01T00:00:00",
    )
    db.add(endpoint)
    db.commit()
    db.refresh(endpoint)
    return endpoint


def _make_delivery_log(db, endpoint, *, delivery_uuid, attempt, created_at):
    log = WebhookDeliveryLog(
        webhook_id=endpoint.id,
        event_name="ping",
        delivery_uuid=delivery_uuid,
        request_payload={"message": "ok"},
        response_status=200,
        response_body="ok",
        success=True,
        attempt=attempt,
        error_message=None,
        created_at=created_at,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


class TestWebhookHelpers:
    def test_generate_signing_secret_prefix(self):
        with patch(
            "src.services.webhooks.webhooks.secrets.token_urlsafe",
            return_value="abc123",
        ):
            assert webhooks._generate_signing_secret() == "whsec_abc123"

    def test_validate_webhook_url_accepts_public_http(self):
        with patch(
            "src.services.webhooks.webhooks.socket.getaddrinfo",
            return_value=[
                (
                    object(),
                    object(),
                    object(),
                    object(),
                    ("93.184.216.34", 443),
                )
            ],
        ):
            webhooks._validate_webhook_url("http://example.com/hook")

    def test_validate_webhook_url_rejects_invalid_scheme(self):
        with pytest.raises(HTTPException) as exc:
            webhooks._validate_webhook_url("ftp://example.com/hook")

        assert exc.value.status_code == 400
        assert "https://" in exc.value.detail

    def test_validate_webhook_url_rejects_missing_hostname(self):
        with pytest.raises(HTTPException) as exc:
            webhooks._validate_webhook_url("https:///hook")

        assert exc.value.status_code == 400
        assert "valid hostname" in exc.value.detail

    def test_validate_webhook_url_rejects_unresolvable_host(self):
        with patch(
            "src.services.webhooks.webhooks.socket.getaddrinfo",
            side_effect=webhooks.socket.gaierror,
        ):
            with pytest.raises(HTTPException) as exc:
                webhooks._validate_webhook_url("https://no-such-host.example/hook")

        assert exc.value.status_code == 400
        assert "Could not resolve hostname" in exc.value.detail

    def test_validate_webhook_url_rejects_private_address(self):
        with patch(
            "src.services.webhooks.webhooks.socket.getaddrinfo",
            return_value=[
                (
                    object(),
                    object(),
                    object(),
                    object(),
                    ("10.0.0.1", 443),
                )
            ],
        ):
            with pytest.raises(HTTPException) as exc:
                webhooks._validate_webhook_url("https://internal.example/hook")

        assert exc.value.status_code == 400
        assert "private or internal" in exc.value.detail

    def test_validate_events_rejects_invalid_names(self):
        with pytest.raises(HTTPException) as exc:
            webhooks._validate_events(["course_created", "not-a-real-event"])

        assert exc.value.status_code == 400
        assert "not-a-real-event" in exc.value.detail


class TestWebhookCrud:
    async def test_create_webhook_endpoint_success(
        self, db, org, admin_user, mock_request
    ):
        webhook_object = WebhookEndpointCreate(
            url="http://example.com/hook",
            description="Test webhook",
            events=["course_created"],
        )

        with patch(
            "src.services.webhooks.webhooks.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ) as mock_auth, patch(
            "src.services.webhooks.webhooks.require_org_admin"
        ) as mock_admin, patch(
            "src.services.webhooks.webhooks.socket.getaddrinfo",
            return_value=[
                (
                    object(),
                    object(),
                    object(),
                    object(),
                    ("93.184.216.34", 443),
                )
            ],
        ), patch(
            "src.services.webhooks.webhooks._generate_signing_secret",
            return_value="whsec_plaintext",
        ), patch(
            "src.services.webhooks.webhooks.encrypt_secret",
            return_value="encrypted-secret",
        ), patch(
            "src.services.webhooks.webhooks.uuid4",
            return_value="uuid-123",
        ):
            result = await webhooks.create_webhook_endpoint(
                mock_request,
                db,
                org.id,
                webhook_object,
                admin_user,
            )

        mock_auth.assert_awaited_once_with(admin_user.id)
        mock_admin.assert_called_once_with(admin_user.id, org.id, db)
        assert result.webhook_uuid == "webhook_uuid-123"
        assert result.secret == "whsec_plaintext"

        stored = db.exec(
            webhooks.select(WebhookEndpoint).where(  # type: ignore[attr-defined]
                WebhookEndpoint.org_id == org.id
            )
        ).first()
        assert stored is not None
        assert stored.secret_encrypted == "encrypted-secret"
        assert stored.description == "Test webhook"
        assert stored.events == ["course_created"]
        assert stored.is_active is True

    async def test_create_webhook_endpoint_missing_org(
        self, db, admin_user, mock_request
    ):
        webhook_object = WebhookEndpointCreate(
            url="http://example.com/hook",
            description="Missing org",
            events=["course_created"],
        )

        with patch(
            "src.services.webhooks.webhooks.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.webhooks.webhooks.require_org_admin"
        ):
            with pytest.raises(HTTPException) as exc:
                await webhooks.create_webhook_endpoint(
                    mock_request,
                    db,
                    999,
                    webhook_object,
                    admin_user,
                )

        assert exc.value.status_code == 404
        assert "Organization not found" in exc.value.detail

    async def test_get_webhook_endpoints_and_endpoint(
        self, db, org, admin_user, mock_request
    ):
        endpoint = _make_webhook_endpoint(db, org)

        with patch(
            "src.services.webhooks.webhooks.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ) as mock_auth, patch(
            "src.services.webhooks.webhooks.require_org_admin"
        ) as mock_admin:
            endpoints = await webhooks.get_webhook_endpoints(
                mock_request, db, org.id, admin_user
            )
            endpoint_read = await webhooks.get_webhook_endpoint(
                mock_request, db, org.id, endpoint.webhook_uuid, admin_user
            )

        mock_auth.assert_awaited()
        assert mock_admin.call_count == 2
        assert len(endpoints) == 1
        assert endpoints[0].webhook_uuid == endpoint.webhook_uuid
        assert endpoint_read.url == endpoint.url
        assert endpoint_read.has_secret is True

    async def test_get_webhook_endpoint_not_found(
        self, db, org, admin_user, mock_request
    ):
        with patch(
            "src.services.webhooks.webhooks.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.webhooks.webhooks.require_org_admin"
        ):
            with pytest.raises(HTTPException) as exc:
                await webhooks.get_webhook_endpoint(
                    mock_request,
                    db,
                    org.id,
                    "missing-webhook",
                    admin_user,
                )

        assert exc.value.status_code == 404
        assert "Webhook endpoint not found" in exc.value.detail

    async def test_update_delete_regenerate_webhook_endpoint(
        self, db, org, admin_user, mock_request
    ):
        endpoint = _make_webhook_endpoint(db, org)

        with patch(
            "src.services.webhooks.webhooks.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.webhooks.webhooks.require_org_admin"
        ), patch(
            "src.services.webhooks.webhooks.socket.getaddrinfo",
            return_value=[
                (
                    object(),
                    object(),
                    object(),
                    object(),
                    ("93.184.216.34", 443),
                )
            ],
        ), patch(
            "src.services.webhooks.webhooks._generate_signing_secret",
            side_effect=["whsec_new_secret"],
        ), patch(
            "src.services.webhooks.webhooks.encrypt_secret",
            return_value="encrypted-new-secret",
        ):
            updated = await webhooks.update_webhook_endpoint(
                mock_request,
                db,
                org.id,
                endpoint.webhook_uuid,
                WebhookEndpointUpdate(
                    url="https://example.org/updated",
                    description="Updated webhook",
                    events=["course_created"],
                    is_active=False,
                ),
                admin_user,
            )
            regenerated = await webhooks.regenerate_webhook_secret(
                mock_request,
                db,
                org.id,
                endpoint.webhook_uuid,
                admin_user,
            )

        assert updated.url == "https://example.org/updated"
        assert updated.description == "Updated webhook"
        assert updated.is_active is False
        assert updated.events == ["course_created"]
        assert regenerated.secret == "whsec_new_secret"
        assert regenerated.webhook_uuid == endpoint.webhook_uuid

        refreshed = db.get(WebhookEndpoint, endpoint.id)
        assert refreshed is not None
        assert refreshed.url == "https://example.org/updated"
        assert refreshed.secret_encrypted == "encrypted-new-secret"

        with patch(
            "src.services.webhooks.webhooks.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.webhooks.webhooks.require_org_admin"
        ):
            deleted = await webhooks.delete_webhook_endpoint(
                mock_request,
                db,
                org.id,
                endpoint.webhook_uuid,
                admin_user,
            )

        assert deleted == {"detail": "Webhook endpoint deleted successfully"}
        assert db.get(WebhookEndpoint, endpoint.id) is None

    async def test_update_webhook_endpoint_not_found(
        self, db, org, admin_user, mock_request
    ):
        with patch(
            "src.services.webhooks.webhooks.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.webhooks.webhooks.require_org_admin"
        ):
            with pytest.raises(HTTPException) as exc:
                await webhooks.update_webhook_endpoint(
                    mock_request,
                    db,
                    org.id,
                    "missing-webhook",
                    WebhookEndpointUpdate(description="Updated"),
                    admin_user,
                )

        assert exc.value.status_code == 404
        assert "Webhook endpoint not found" in exc.value.detail

    async def test_get_delivery_logs_and_send_test_event(
        self, db, org, admin_user, mock_request
    ):
        endpoint = _make_webhook_endpoint(db, org)
        first_log = _make_delivery_log(
            db,
            endpoint,
            delivery_uuid="delivery-1",
            attempt=1,
            created_at="2024-01-02T00:00:00",
        )
        second_log = _make_delivery_log(
            db,
            endpoint,
            delivery_uuid="delivery-2",
            attempt=2,
            created_at="2024-01-03T00:00:00",
        )

        with patch(
            "src.services.webhooks.webhooks.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ) as mock_auth, patch(
            "src.services.webhooks.webhooks.require_org_admin"
        ) as mock_admin:
            logs = await webhooks.get_webhook_delivery_logs(
                mock_request, db, org.id, endpoint.webhook_uuid, admin_user, limit=250
            )

        mock_auth.assert_awaited_once_with(admin_user.id)
        mock_admin.assert_called_once_with(admin_user.id, org.id, db)
        assert [log.delivery_uuid for log in logs] == ["delivery-2", "delivery-1"]
        assert logs[0].webhook_id == endpoint.id
        assert logs[0].id == second_log.id
        assert logs[1].id == first_log.id

        with patch(
            "src.services.webhooks.webhooks.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.webhooks.webhooks.require_org_admin"
        ), patch(
            "src.services.webhooks.dispatch.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as mock_dispatch:
            response = await webhooks.send_test_event(
                mock_request,
                db,
                org.id,
                endpoint.webhook_uuid,
                admin_user,
            )

        mock_dispatch.assert_awaited_once_with(
            event_name="ping",
            org_id=org.id,
            data={"message": "This is a test webhook event from LearnHouse."},
            webhook_ids=[endpoint.id],
        )
        assert response == {"detail": "Test event dispatched"}

    async def test_send_test_event_not_found(
        self, db, org, admin_user, mock_request
    ):
        with patch(
            "src.services.webhooks.webhooks.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.webhooks.webhooks.require_org_admin"
        ):
            with pytest.raises(HTTPException) as exc:
                await webhooks.send_test_event(
                    mock_request,
                    db,
                    org.id,
                    "missing-webhook",
                    admin_user,
                )

        assert exc.value.status_code == 404
        assert "Webhook endpoint not found" in exc.value.detail
