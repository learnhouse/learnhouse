from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from sqlmodel import select

from src.db.webhooks import WebhookDeliveryLog, WebhookEndpoint
from src.services.webhooks import dispatch


class _FakeStream:
    def __init__(self, server_addr):
        self._server_addr = server_addr

    def get_extra_info(self, name):
        if name == "server_addr":
            return self._server_addr
        return None


def _make_endpoint(db, org, admin_user, *, webhook_uuid, events, is_active=True):
    endpoint = WebhookEndpoint(
        webhook_uuid=webhook_uuid,
        org_id=org.id,
        url="https://example.com/hook",
        secret_encrypted="encrypted-secret",
        description="Webhook",
        events=events,
        is_active=is_active,
        created_by_user_id=admin_user.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(endpoint)
    db.commit()
    db.refresh(endpoint)
    return endpoint


def _make_response(status_code, *, body="ok", peer=("93.184.216.34", 443)):
    request = httpx.Request("POST", "https://example.com/hook")
    return httpx.Response(
        status_code,
        content=body.encode(),
        request=request,
        extensions={"network_stream": _FakeStream(peer)},
    )


class _FakePruneResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakePruneSession:
    def __init__(self, rows):
        self.rows = rows
        self.exec_calls = []
        self.deleted_statement = None
        self.committed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def exec(self, statement):
        self.exec_calls.append(statement)
        if len(self.exec_calls) == 1:
            return _FakePruneResult(self.rows)
        self.deleted_statement = statement
        return _FakePruneResult([])

    def commit(self):
        self.committed = True


@pytest.fixture(autouse=True)
def reset_dispatch_state():
    dispatch._background_tasks.clear()
    dispatch._webhook_client = None
    yield
    dispatch._background_tasks.clear()
    dispatch._webhook_client = None


class TestWebhookDispatchHelpers:
    @pytest.mark.asyncio
    async def test_get_webhook_client_is_singleton_and_close_resets(self):
        fake_client = MagicMock()
        fake_client.aclose = AsyncMock()

        with patch(
            "src.services.webhooks.dispatch.httpx.AsyncClient",
            return_value=fake_client,
        ) as mock_client_cls:
            first = dispatch._get_webhook_client()
            second = dispatch._get_webhook_client()

            assert first is fake_client
            assert second is fake_client
            mock_client_cls.assert_called_once_with(
                timeout=10.0,
                follow_redirects=False,
                headers={"User-Agent": "LearnHouse-Webhooks/1.0"},
            )

            await dispatch.close_webhook_client()

        fake_client.aclose.assert_awaited_once()
        assert dispatch._webhook_client is None

    @pytest.mark.asyncio
    async def test_dispatch_webhooks_schedules_background_task(self):
        task = MagicMock()
        scheduled = {}

        def fake_create_task(coro):
            scheduled["coro"] = coro
            coro.close()
            return task

        with patch(
            "src.services.webhooks.dispatch.validate_event_data",
        ) as mock_validate, patch(
            "src.services.webhooks.dispatch.asyncio.create_task",
            side_effect=fake_create_task,
        ) as mock_create:
            await dispatch.dispatch_webhooks(
                "course_created",
                1,
                {"course_uuid": "course_123"},
                [1, 2],
            )

        mock_validate.assert_called_once_with(
            "course_created",
            {"course_uuid": "course_123"},
        )
        mock_create.assert_called_once()
        assert "coro" in scheduled
        # Two callbacks: one to discard the task from the tracking set,
        # one to log unexpected exceptions.
        assert task.add_done_callback.call_count == 2
        assert task in dispatch._background_tasks

    @pytest.mark.asyncio
    async def test_deliver_webhooks_filters_by_org_and_event(
        self,
        db,
        org,
        other_org,
        admin_user,
    ):
        matching = _make_endpoint(
            db,
            org,
            admin_user,
            webhook_uuid="match",
            events=["course_created"],
        )
        _make_endpoint(
            db,
            org,
            admin_user,
            webhook_uuid="skip-event",
            events=["user_signed_up"],
        )
        _make_endpoint(
            db,
            other_org,
            admin_user,
            webhook_uuid="skip-org",
            events=["course_created"],
        )

        with patch.object(dispatch, "engine", db.get_bind()), patch(
            "src.services.webhooks.dispatch._deliver_to_endpoint",
            new_callable=AsyncMock,
        ) as mock_deliver:
            await dispatch._deliver_webhooks(
                "course_created",
                org.id,
                {"course_uuid": "course_123"},
                None,
            )

        mock_deliver.assert_awaited_once()
        delivered = mock_deliver.await_args.args[0]
        assert delivered.webhook_uuid == matching.webhook_uuid

    @pytest.mark.asyncio
    async def test_deliver_webhooks_filters_by_requested_ids(self, db, org, admin_user):
        selected = _make_endpoint(
            db,
            org,
            admin_user,
            webhook_uuid="selected",
            events=["user_signed_up"],
        )
        skipped = _make_endpoint(
            db,
            org,
            admin_user,
            webhook_uuid="skipped",
            events=["course_created"],
            is_active=False,
        )

        with patch.object(dispatch, "engine", db.get_bind()), patch(
            "src.services.webhooks.dispatch._deliver_to_endpoint",
            new_callable=AsyncMock,
        ) as mock_deliver:
            await dispatch._deliver_webhooks(
                "course_created",
                org.id,
                {"course_uuid": "course_123"},
                [selected.id, skipped.id],
            )

        mock_deliver.assert_awaited_once()
        delivered = mock_deliver.await_args.args[0]
        assert delivered.webhook_uuid == selected.webhook_uuid

    @pytest.mark.asyncio
    async def test_deliver_webhooks_logs_warning_on_session_failure(self):
        with patch(
            "src.services.webhooks.dispatch.Session",
            side_effect=RuntimeError("boom"),
        ), patch("src.services.webhooks.dispatch.logger.warning") as mock_warning:
            await dispatch._deliver_webhooks(
                "course_created",
                1,
                {"course_uuid": "course_123"},
                None,
            )

        mock_warning.assert_called_once()

    @pytest.mark.asyncio
    async def test_deliver_to_endpoint_retries_and_persists_logs(
        self,
        db,
    ):
        endpoint = dispatch._EndpointInfo(
            id=1,
            webhook_uuid="webhook_1",
            url="https://example.com/hook",
            secret_encrypted="encrypted-secret",
            events=["course_created"],
        )
        client = MagicMock()
        client.post = AsyncMock(
            side_effect=[
                _make_response(500, body="first failure"),
                _make_response(200, body="second success"),
            ]
        )

        with patch.object(dispatch, "engine", db.get_bind()), patch(
            "src.services.webhooks.dispatch.decrypt_secret",
            return_value="plaintext-secret",
        ), patch(
            "src.services.webhooks.dispatch.compute_signature",
            return_value="sha256=test",
        ), patch(
            "src.services.webhooks.dispatch.resolve_and_validate_url",
            return_value={"93.184.216.34"},
        ), patch(
            "src.services.webhooks.dispatch.assert_connected_peer_allowed",
        ), patch(
            "src.services.webhooks.dispatch._get_webhook_client",
            return_value=client,
        ), patch(
            "src.services.webhooks.dispatch._prune_delivery_logs",
        ) as mock_prune, patch(
            "src.services.webhooks.dispatch.asyncio.sleep",
            new_callable=AsyncMock,
        ) as mock_sleep:
            await dispatch._deliver_to_endpoint(
                endpoint,
                "course_created",
                42,
                {"course_uuid": "course_123"},
            )

        assert client.post.await_count == 2
        mock_sleep.assert_awaited_once_with(1)
        mock_prune.assert_called_once_with(endpoint.id)

        logs = db.exec(
            select(WebhookDeliveryLog).where(
                WebhookDeliveryLog.webhook_id == endpoint.id
            ).order_by(WebhookDeliveryLog.attempt)
        ).all()
        assert [log.attempt for log in logs] == [1, 2]
        assert logs[0].success is False
        assert logs[0].response_status == 500
        assert logs[0].response_body == "first failure"
        assert logs[1].success is True
        assert logs[1].response_status == 200
        assert logs[1].response_body == "second success"

    @pytest.mark.asyncio
    async def test_deliver_to_endpoint_handles_decrypt_and_ssrf_failures(
        self,
        db,
    ):
        decrypt_endpoint = dispatch._EndpointInfo(
            id=11,
            webhook_uuid="decrypt_fail",
            url="https://example.com/hook",
            secret_encrypted="encrypted-secret",
            events=["course_created"],
        )
        ssrf_endpoint = dispatch._EndpointInfo(
            id=12,
            webhook_uuid="ssrf_fail",
            url="https://example.com/hook",
            secret_encrypted="encrypted-secret",
            events=["course_created"],
        )
        client = MagicMock()
        client.post = AsyncMock(return_value=_make_response(200, body="ok"))

        with patch.object(dispatch, "engine", db.get_bind()), patch(
            "src.services.webhooks.dispatch.decrypt_secret",
            side_effect=[RuntimeError("no secret"), "plaintext-secret"],
        ), patch(
            "src.services.webhooks.dispatch.compute_signature",
            return_value="sha256=test",
        ), patch(
            "src.services.webhooks.dispatch.resolve_and_validate_url",
            return_value={"93.184.216.34"},
        ), patch(
            "src.services.webhooks.dispatch.assert_connected_peer_allowed",
            side_effect=dispatch.SSRFBlockedError("dns rebinding detected"),
        ), patch(
            "src.services.webhooks.dispatch._get_webhook_client",
            return_value=client,
        ), patch(
            "src.services.webhooks.dispatch._prune_delivery_logs",
        ), patch(
            "src.services.webhooks.dispatch.asyncio.sleep",
            new_callable=AsyncMock,
        ):
            await dispatch._deliver_to_endpoint(
                decrypt_endpoint,
                "course_created",
                42,
                {"course_uuid": "course_123"},
            )
            await dispatch._deliver_to_endpoint(
                ssrf_endpoint,
                "course_created",
                42,
                {"course_uuid": "course_123"},
            )

        assert client.post.await_count == 3

        decrypt_logs = db.exec(
            select(WebhookDeliveryLog).where(
                WebhookDeliveryLog.webhook_id == decrypt_endpoint.id
            )
        ).all()
        assert decrypt_logs == []

        ssrf_logs = db.exec(
            select(WebhookDeliveryLog).where(
                WebhookDeliveryLog.webhook_id == ssrf_endpoint.id
            ).order_by(WebhookDeliveryLog.attempt)
        ).all()
        assert len(ssrf_logs) == 3
        assert all(log.success is False for log in ssrf_logs)
        assert all(log.error_message.startswith("SSRF guard: ") for log in ssrf_logs)

    @pytest.mark.asyncio
    async def test_deliver_to_endpoint_handles_ssrf_resolution_failure(self, db):
        endpoint = dispatch._EndpointInfo(
            id=13,
            webhook_uuid="resolve_fail",
            url="https://example.com/hook",
            secret_encrypted="encrypted-secret",
            events=["course_created"],
        )
        client = MagicMock()
        client.post = AsyncMock(return_value=_make_response(200, body="ok"))

        with patch.object(dispatch, "engine", db.get_bind()), patch(
            "src.services.webhooks.dispatch.decrypt_secret",
            return_value="plaintext-secret",
        ), patch(
            "src.services.webhooks.dispatch.compute_signature",
            return_value="sha256=test",
        ), patch(
            "src.services.webhooks.dispatch.resolve_and_validate_url",
            side_effect=dispatch.SSRFBlockedError("blocked hostname"),
        ), patch(
            "src.services.webhooks.dispatch._get_webhook_client",
            return_value=client,
        ), patch(
            "src.services.webhooks.dispatch._prune_delivery_logs",
        ), patch(
            "src.services.webhooks.dispatch.asyncio.sleep",
            new_callable=AsyncMock,
        ):
            await dispatch._deliver_to_endpoint(
                endpoint,
                "course_created",
                42,
                {"course_uuid": "course_123"},
            )

        assert client.post.await_count == 0
        logs = db.exec(
            select(WebhookDeliveryLog).where(
                WebhookDeliveryLog.webhook_id == endpoint.id
            ).order_by(WebhookDeliveryLog.attempt)
        ).all()
        assert len(logs) == 3
        assert all(log.success is False for log in logs)
        assert all("SSRF guard: blocked hostname" == log.error_message for log in logs)

    @pytest.mark.asyncio
    async def test_deliver_to_endpoint_handles_generic_exception(self, db):
        endpoint = dispatch._EndpointInfo(
            id=21,
            webhook_uuid="network_fail",
            url="https://example.com/hook",
            secret_encrypted="encrypted-secret",
            events=["course_created"],
        )
        client = MagicMock()
        client.post = AsyncMock(side_effect=RuntimeError("socket closed"))

        with patch.object(dispatch, "engine", db.get_bind()), patch(
            "src.services.webhooks.dispatch.decrypt_secret",
            return_value="plaintext-secret",
        ), patch(
            "src.services.webhooks.dispatch.compute_signature",
            return_value="sha256=test",
        ), patch(
            "src.services.webhooks.dispatch.resolve_and_validate_url",
            return_value={"93.184.216.34"},
        ), patch(
            "src.services.webhooks.dispatch._get_webhook_client",
            return_value=client,
        ), patch(
            "src.services.webhooks.dispatch._prune_delivery_logs",
        ), patch(
            "src.services.webhooks.dispatch.asyncio.sleep",
            new_callable=AsyncMock,
        ) as mock_sleep:
            await dispatch._deliver_to_endpoint(
                endpoint,
                "course_created",
                42,
                {"course_uuid": "course_123"},
            )

        assert client.post.await_count == 3
        assert mock_sleep.await_count == 2

        logs = db.exec(
            select(WebhookDeliveryLog).where(
                WebhookDeliveryLog.webhook_id == endpoint.id
            ).order_by(WebhookDeliveryLog.attempt)
        ).all()
        assert len(logs) == 3
        assert all(log.success is False for log in logs)
        assert logs[0].error_message == "socket closed"

    def test_prune_delivery_logs_keeps_recent_rows(self):
        fake_session = _FakePruneSession(
            list(range(dispatch.LOG_RETENTION_PER_ENDPOINT + 1))
        )

        with patch(
            "src.services.webhooks.dispatch.Session",
            return_value=fake_session,
        ):
            dispatch._prune_delivery_logs(31)

        assert fake_session.exec_calls
        assert fake_session.deleted_statement is not None
        assert fake_session.committed is True

    def test_prune_delivery_logs_noop_when_below_retention(self, db):
        webhook_id = 32
        row = WebhookDeliveryLog(
            webhook_id=webhook_id,
            event_name="course_created",
            delivery_uuid="delivery-1",
            request_payload={"message": "ok"},
            response_status=200,
            response_body="ok",
            success=True,
            attempt=1,
            created_at=str(datetime.now()),
        )
        db.add(row)
        db.commit()

        dispatch._prune_delivery_logs(webhook_id)

        remaining = db.exec(
            select(WebhookDeliveryLog).where(
                WebhookDeliveryLog.webhook_id == webhook_id
            )
        ).all()
        assert len(remaining) == 1
