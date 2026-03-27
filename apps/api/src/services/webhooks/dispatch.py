"""
Fire-and-forget webhook delivery engine.

Mirrors the analytics ``track()`` pattern: wraps work in
``asyncio.create_task()`` so the calling request is never blocked.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import List, Optional
from uuid import uuid4

import httpx
from sqlmodel import Session, select, col

from src.core.events.database import engine
from src.db.webhooks import WebhookEndpoint, WebhookDeliveryLog
from src.services.webhooks.crypto import decrypt_secret, compute_signature

logger = logging.getLogger(__name__)

# Lazy singleton httpx client for outgoing webhook requests
_webhook_client: httpx.AsyncClient | None = None

MAX_ATTEMPTS = 3
# Exponential backoff delays in seconds: 1, 4, 16
BACKOFF_DELAYS = [1, 4, 16]
LOG_RETENTION_PER_ENDPOINT = 200


def _get_webhook_client() -> httpx.AsyncClient:
    global _webhook_client
    if _webhook_client is None:
        _webhook_client = httpx.AsyncClient(
            timeout=10.0,
            headers={"User-Agent": "LearnHouse-Webhooks/1.0"},
        )
    return _webhook_client


async def dispatch_webhooks(
    event_name: str,
    org_id: int,
    data: dict,
    webhook_ids: Optional[List[int]] = None,
) -> None:
    """
    Public entry point. Schedules webhook delivery as a background task.

    Args:
        event_name: The event that occurred (e.g. "course_completed").
        org_id: The organization where the event happened.
        data: Event-specific payload data.
        webhook_ids: If provided, only deliver to these specific endpoints
                     (used by the test/ping feature).
    """
    asyncio.create_task(
        _deliver_webhooks(event_name, org_id, data, webhook_ids)
    )


async def _deliver_webhooks(
    event_name: str,
    org_id: int,
    data: dict,
    webhook_ids: Optional[List[int]],
) -> None:
    """Background task that queries matching endpoints and delivers payloads."""
    try:
        with Session(engine) as db_session:
            if webhook_ids:
                statement = select(WebhookEndpoint).where(
                    WebhookEndpoint.id.in_(webhook_ids),  # type: ignore
                    WebhookEndpoint.is_active == True,
                )
            else:
                statement = select(WebhookEndpoint).where(
                    WebhookEndpoint.org_id == org_id,
                    WebhookEndpoint.is_active == True,
                )
            endpoints = db_session.exec(statement).all()

            for endpoint in endpoints:
                # For normal dispatches, check if the endpoint is subscribed
                if not webhook_ids and event_name not in (endpoint.events or []):
                    continue

                await _deliver_to_endpoint(db_session, endpoint, event_name, org_id, data)

    except Exception:
        logger.warning(
            "Failed to dispatch webhooks for event %s org %s",
            event_name,
            org_id,
            exc_info=True,
        )


async def _deliver_to_endpoint(
    db_session: Session,
    endpoint: WebhookEndpoint,
    event_name: str,
    org_id: int,
    data: dict,
) -> None:
    """Deliver a single event to a single endpoint with retries."""
    delivery_uuid = f"dlv_{uuid4().hex[:16]}"
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    payload = {
        "event": event_name,
        "delivery_id": delivery_uuid,
        "timestamp": timestamp,
        "org_id": org_id,
        "data": data,
    }

    payload_bytes = json.dumps(payload, separators=(",", ":")).encode()

    try:
        secret = decrypt_secret(endpoint.secret_encrypted)
    except Exception:
        logger.warning("Failed to decrypt secret for webhook %s", endpoint.webhook_uuid)
        return

    signature = compute_signature(payload_bytes, secret)

    headers = {
        "Content-Type": "application/json",
        "X-Webhook-Event": event_name,
        "X-Webhook-Delivery": delivery_uuid,
        "X-Webhook-Signature": signature,
    }

    client = _get_webhook_client()

    for attempt in range(1, MAX_ATTEMPTS + 1):
        log_entry = WebhookDeliveryLog(
            webhook_id=endpoint.id,  # type: ignore
            event_name=event_name,
            delivery_uuid=delivery_uuid,
            request_payload=payload,
            attempt=attempt,
            created_at=str(datetime.now()),
        )

        try:
            resp = await client.post(endpoint.url, content=payload_bytes, headers=headers)
            log_entry.response_status = resp.status_code
            log_entry.response_body = resp.text[:500] if resp.text else None
            log_entry.success = 200 <= resp.status_code < 300

            db_session.add(log_entry)
            db_session.commit()

            if log_entry.success:
                break

        except Exception as e:
            log_entry.success = False
            log_entry.error_message = str(e)[:1000]
            db_session.add(log_entry)
            db_session.commit()

        # Retry with backoff if not the last attempt and not successful
        if attempt < MAX_ATTEMPTS and not log_entry.success:
            delay = BACKOFF_DELAYS[attempt - 1] if attempt - 1 < len(BACKOFF_DELAYS) else BACKOFF_DELAYS[-1]
            await asyncio.sleep(delay)

    # Prune old logs for this endpoint
    _prune_delivery_logs(db_session, endpoint.id)  # type: ignore


def _prune_delivery_logs(db_session: Session, webhook_id: int) -> None:
    """Keep only the most recent LOG_RETENTION_PER_ENDPOINT logs per endpoint."""
    try:
        statement = (
            select(WebhookDeliveryLog.id)
            .where(WebhookDeliveryLog.webhook_id == webhook_id)
            .order_by(col(WebhookDeliveryLog.id).desc())
            .offset(LOG_RETENTION_PER_ENDPOINT)
            .limit(1)
        )
        cutoff_row = db_session.exec(statement).first()
        if cutoff_row is not None:
            old_logs = db_session.exec(
                select(WebhookDeliveryLog).where(
                    WebhookDeliveryLog.webhook_id == webhook_id,
                    WebhookDeliveryLog.id <= cutoff_row,
                )
            ).all()
            for log in old_logs:
                db_session.delete(log)
            db_session.commit()
    except Exception:
        logger.warning("Failed to prune webhook delivery logs for endpoint %s", webhook_id)
