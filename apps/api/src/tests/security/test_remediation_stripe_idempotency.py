"""
F-10: Stripe webhook idempotency is atomic and fails closed.

Two replays of the same event.id must result in the second call returning
the "already processed" short-circuit. Redis outages must return 503 so
Stripe retries rather than double-processing.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from ee.services.payments.payments_stripe import StripePaymentProvider


class _FakeEvent:
    def __init__(self, event_id, event_type="checkout.session.completed"):
        self.id = event_id
        self.type = event_type
        self.data = SimpleNamespace(object=SimpleNamespace(to_dict=lambda: {}))
        self.account = None  # Platform-level event → early-return branch.


async def _call_webhook(provider, redis_client, event):
    """Minimal harness around handle_webhook with the external calls stubbed."""
    fake_request = MagicMock()
    fake_request.body = MagicMock()

    async def _body():
        return b"{}"

    fake_request.body = _body  # awaited inside handle_webhook
    fake_request.headers = {"stripe-signature": "sig"}

    with patch.object(
        provider, "_get_credentials", return_value={
            "stripe_secret_key": "sk",
            "stripe_webhook_standard_secret": "whsec",
            "stripe_webhook_connect_secret": "whsec",
        },
    ), patch(
        "ee.services.payments.payments_stripe.stripe.Webhook.construct_event",
        return_value=event,
    ), patch(
        "src.security.features_utils.usage._get_redis_client",
        return_value=redis_client,
    ):
        return await provider.handle_webhook(
            fake_request, db_session=MagicMock(), webhook_type="standard"
        )


@pytest.mark.asyncio
async def test_duplicate_event_ids_short_circuit_on_second_call():
    """
    F-10: second delivery of the same event.id is recognised via the Redis
    SETNX claim and returns the "already processed" response.
    """
    redis_client = MagicMock()
    # First call claims the key; second call sees it already set.
    redis_client.set.side_effect = [True, False]

    provider = StripePaymentProvider()
    event = _FakeEvent("evt_123")

    first = await _call_webhook(provider, redis_client, event)
    assert first["status"] in ("success", "ignored")

    second = await _call_webhook(provider, redis_client, event)
    assert second["status"] == "success"
    assert "already" in second["message"].lower()


@pytest.mark.asyncio
async def test_redis_outage_fails_closed_with_503():
    """
    F-10: when Redis is unreachable the handler must return 503 so Stripe
    retries. Previously it fell open and processed the event anyway, which
    could double-activate enrollments during a Redis incident.
    """
    redis_client = MagicMock()
    redis_client.set.side_effect = RuntimeError("connection refused")

    provider = StripePaymentProvider()
    event = _FakeEvent("evt_456")

    with pytest.raises(HTTPException) as exc:
        await _call_webhook(provider, redis_client, event)

    assert exc.value.status_code == 503
    assert "retry" in str(exc.value.detail).lower()
