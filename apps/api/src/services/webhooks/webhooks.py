"""
CRUD operations for webhook endpoints.
"""

import secrets
from datetime import datetime
from typing import List
from uuid import uuid4

from fastapi import HTTPException, Request, status
from sqlmodel import Session, select, col

from src.db.organizations import Organization
from src.db.webhooks import (
    WebhookEndpoint,
    WebhookEndpointCreate,
    WebhookEndpointCreatedResponse,
    WebhookEndpointRead,
    WebhookEndpointUpdate,
    WebhookDeliveryLog,
    WebhookDeliveryLogRead,
)
from src.db.users import PublicUser
from src.security.rbac.rbac import authorization_verify_if_user_is_anon
from src.security.org_auth import require_org_admin
from src.services.webhooks.crypto import encrypt_secret
from src.services.webhooks.events import WEBHOOK_EVENTS


def _generate_signing_secret() -> str:
    """Generate a cryptographically secure signing secret."""
    return f"whsec_{secrets.token_urlsafe(32)}"


def _validate_events(events: List[str]) -> None:
    """Raise 400 if any event name is not in the allowed set."""
    invalid = set(events) - set(WEBHOOK_EVENTS.keys())
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid event names: {', '.join(sorted(invalid))}. "
            f"Allowed events: {', '.join(sorted(WEBHOOK_EVENTS.keys()))}",
        )


def _to_read(endpoint: WebhookEndpoint) -> WebhookEndpointRead:
    return WebhookEndpointRead(
        id=endpoint.id,  # type: ignore
        webhook_uuid=endpoint.webhook_uuid,
        org_id=endpoint.org_id,
        url=endpoint.url,
        description=endpoint.description,
        events=endpoint.events,
        is_active=endpoint.is_active,
        has_secret=bool(endpoint.secret_encrypted),
        created_by_user_id=endpoint.created_by_user_id,
        creation_date=endpoint.creation_date,
        update_date=endpoint.update_date,
    )


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


async def create_webhook_endpoint(
    request: Request,
    db_session: Session,
    org_id: int,
    webhook_object: WebhookEndpointCreate,
    current_user: PublicUser,
) -> WebhookEndpointCreatedResponse:
    await authorization_verify_if_user_is_anon(current_user.id)

    statement = select(Organization).where(Organization.id == org_id)
    if not db_session.exec(statement).first():
        raise HTTPException(status_code=404, detail="Organization not found")

    require_org_admin(current_user.id, org_id, db_session)
    _validate_events(webhook_object.events)

    plaintext_secret = _generate_signing_secret()
    now = str(datetime.now())

    endpoint = WebhookEndpoint(
        webhook_uuid=f"webhook_{uuid4()}",
        org_id=org_id,
        url=webhook_object.url,
        secret_encrypted=encrypt_secret(plaintext_secret),
        description=webhook_object.description,
        events=webhook_object.events,
        is_active=True,
        created_by_user_id=current_user.id,
        creation_date=now,
        update_date=now,
    )

    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)

    return WebhookEndpointCreatedResponse(
        webhook_uuid=endpoint.webhook_uuid,
        url=endpoint.url,
        description=endpoint.description,
        events=endpoint.events,
        is_active=endpoint.is_active,
        secret=plaintext_secret,
        created_by_user_id=endpoint.created_by_user_id,
        creation_date=endpoint.creation_date,
    )


async def get_webhook_endpoints(
    request: Request,
    db_session: Session,
    org_id: int,
    current_user: PublicUser,
) -> List[WebhookEndpointRead]:
    await authorization_verify_if_user_is_anon(current_user.id)
    require_org_admin(current_user.id, org_id, db_session)

    statement = select(WebhookEndpoint).where(WebhookEndpoint.org_id == org_id)
    endpoints = db_session.exec(statement).all()
    return [_to_read(ep) for ep in endpoints]


async def get_webhook_endpoint(
    request: Request,
    db_session: Session,
    org_id: int,
    webhook_uuid: str,
    current_user: PublicUser,
) -> WebhookEndpointRead:
    await authorization_verify_if_user_is_anon(current_user.id)
    require_org_admin(current_user.id, org_id, db_session)

    endpoint = _get_endpoint_or_404(db_session, org_id, webhook_uuid)
    return _to_read(endpoint)


async def update_webhook_endpoint(
    request: Request,
    db_session: Session,
    org_id: int,
    webhook_uuid: str,
    webhook_object: WebhookEndpointUpdate,
    current_user: PublicUser,
) -> WebhookEndpointRead:
    await authorization_verify_if_user_is_anon(current_user.id)
    require_org_admin(current_user.id, org_id, db_session)

    endpoint = _get_endpoint_or_404(db_session, org_id, webhook_uuid)

    if webhook_object.events is not None:
        _validate_events(webhook_object.events)
        endpoint.events = webhook_object.events
    if webhook_object.url is not None:
        endpoint.url = webhook_object.url
    if webhook_object.description is not None:
        endpoint.description = webhook_object.description
    if webhook_object.is_active is not None:
        endpoint.is_active = webhook_object.is_active

    endpoint.update_date = str(datetime.now())
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)

    return _to_read(endpoint)


async def delete_webhook_endpoint(
    request: Request,
    db_session: Session,
    org_id: int,
    webhook_uuid: str,
    current_user: PublicUser,
) -> dict:
    await authorization_verify_if_user_is_anon(current_user.id)
    require_org_admin(current_user.id, org_id, db_session)

    endpoint = _get_endpoint_or_404(db_session, org_id, webhook_uuid)
    db_session.delete(endpoint)
    db_session.commit()

    return {"detail": "Webhook endpoint deleted successfully"}


async def regenerate_webhook_secret(
    request: Request,
    db_session: Session,
    org_id: int,
    webhook_uuid: str,
    current_user: PublicUser,
) -> WebhookEndpointCreatedResponse:
    await authorization_verify_if_user_is_anon(current_user.id)
    require_org_admin(current_user.id, org_id, db_session)

    endpoint = _get_endpoint_or_404(db_session, org_id, webhook_uuid)

    plaintext_secret = _generate_signing_secret()
    endpoint.secret_encrypted = encrypt_secret(plaintext_secret)
    endpoint.update_date = str(datetime.now())

    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)

    return WebhookEndpointCreatedResponse(
        webhook_uuid=endpoint.webhook_uuid,
        url=endpoint.url,
        description=endpoint.description,
        events=endpoint.events,
        is_active=endpoint.is_active,
        secret=plaintext_secret,
        created_by_user_id=endpoint.created_by_user_id,
        creation_date=endpoint.creation_date,
    )


async def get_webhook_delivery_logs(
    request: Request,
    db_session: Session,
    org_id: int,
    webhook_uuid: str,
    current_user: PublicUser,
    limit: int = 50,
) -> List[WebhookDeliveryLogRead]:
    await authorization_verify_if_user_is_anon(current_user.id)
    require_org_admin(current_user.id, org_id, db_session)

    endpoint = _get_endpoint_or_404(db_session, org_id, webhook_uuid)

    statement = (
        select(WebhookDeliveryLog)
        .where(WebhookDeliveryLog.webhook_id == endpoint.id)
        .order_by(col(WebhookDeliveryLog.id).desc())
        .limit(limit)
    )
    logs = db_session.exec(statement).all()

    return [WebhookDeliveryLogRead(**log.model_dump()) for log in logs]


async def send_test_event(
    request: Request,
    db_session: Session,
    org_id: int,
    webhook_uuid: str,
    current_user: PublicUser,
) -> dict:
    """Send a test 'ping' event to verify the webhook endpoint."""
    await authorization_verify_if_user_is_anon(current_user.id)
    require_org_admin(current_user.id, org_id, db_session)

    endpoint = _get_endpoint_or_404(db_session, org_id, webhook_uuid)

    from src.services.webhooks.dispatch import dispatch_webhooks

    await dispatch_webhooks(
        event_name="ping",
        org_id=org_id,
        data={"message": "This is a test webhook event from LearnHouse."},
        webhook_ids=[endpoint.id],  # type: ignore
    )

    return {"detail": "Test event dispatched"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_endpoint_or_404(
    db_session: Session, org_id: int, webhook_uuid: str
) -> WebhookEndpoint:
    statement = select(WebhookEndpoint).where(
        WebhookEndpoint.org_id == org_id,
        WebhookEndpoint.webhook_uuid == webhook_uuid,
    )
    endpoint = db_session.exec(statement).first()
    if not endpoint:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Webhook endpoint not found",
        )
    return endpoint
