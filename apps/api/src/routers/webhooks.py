from typing import List
from fastapi import APIRouter, Depends, Request
from sqlmodel import Session

from src.core.events.database import get_db_session
from src.db.webhooks import (
    WebhookEndpointCreate,
    WebhookEndpointCreatedResponse,
    WebhookEndpointRead,
    WebhookEndpointUpdate,
    WebhookDeliveryLogRead,
)
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.webhooks.webhooks import (
    create_webhook_endpoint,
    delete_webhook_endpoint,
    get_webhook_delivery_logs,
    get_webhook_endpoint,
    get_webhook_endpoints,
    regenerate_webhook_secret,
    send_test_event,
    update_webhook_endpoint,
)
from src.services.webhooks.events import WEBHOOK_EVENTS

router = APIRouter()


@router.get(
    "/{org_id}/webhooks/events",
    summary="List available webhook event types",
    description="Returns the catalogue of webhook event types supported by LearnHouse along with their descriptions.",
    responses={
        200: {"description": "Dictionary of event types and their descriptions"},
    },
)
async def api_list_webhook_events() -> dict:
    """List all available webhook event types and their descriptions."""
    return {"events": WEBHOOK_EVENTS}


@router.post(
    "/{org_id}/webhooks",
    response_model=WebhookEndpointCreatedResponse,
    summary="Create a webhook endpoint",
    description="Creates a new webhook endpoint for the organization. The signing secret is only returned once upon creation and cannot be retrieved later; store it securely.",
    responses={
        200: {"description": "Webhook endpoint created; signing secret included", "model": WebhookEndpointCreatedResponse},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to manage webhooks for this organization"},
        404: {"description": "Organization not found"},
    },
)
async def api_create_webhook_endpoint(
    request: Request,
    org_id: int,
    webhook_object: WebhookEndpointCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> WebhookEndpointCreatedResponse:
    """
    Create a new webhook endpoint for an organization.

    The signing secret is only returned once upon creation.
    Store it securely as it cannot be retrieved later.
    """
    return await create_webhook_endpoint(
        request, db_session, org_id, webhook_object, current_user
    )


@router.get(
    "/{org_id}/webhooks",
    response_model=List[WebhookEndpointRead],
    summary="List webhook endpoints",
    description="Returns all webhook endpoints configured for the given organization.",
    responses={
        200: {"description": "List of webhook endpoints", "model": List[WebhookEndpointRead]},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view webhooks for this organization"},
        404: {"description": "Organization not found"},
    },
)
async def api_list_webhook_endpoints(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[WebhookEndpointRead]:
    """List all webhook endpoints for an organization."""
    return await get_webhook_endpoints(request, db_session, org_id, current_user)


@router.get(
    "/{org_id}/webhooks/{webhook_uuid}",
    response_model=WebhookEndpointRead,
    summary="Get a webhook endpoint",
    description="Returns details of a specific webhook endpoint by its UUID.",
    responses={
        200: {"description": "Webhook endpoint details", "model": WebhookEndpointRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view this webhook"},
        404: {"description": "Webhook endpoint not found"},
    },
)
async def api_get_webhook_endpoint(
    request: Request,
    org_id: int,
    webhook_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> WebhookEndpointRead:
    """Get details of a specific webhook endpoint."""
    return await get_webhook_endpoint(
        request, db_session, org_id, webhook_uuid, current_user
    )


@router.put(
    "/{org_id}/webhooks/{webhook_uuid}",
    response_model=WebhookEndpointRead,
    summary="Update a webhook endpoint",
    description="Updates mutable fields of a webhook endpoint (URL, subscribed events, active flag).",
    responses={
        200: {"description": "Webhook endpoint updated", "model": WebhookEndpointRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to modify this webhook"},
        404: {"description": "Webhook endpoint not found"},
    },
)
async def api_update_webhook_endpoint(
    request: Request,
    org_id: int,
    webhook_uuid: str,
    webhook_object: WebhookEndpointUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> WebhookEndpointRead:
    """Update a webhook endpoint (URL, events, active status)."""
    return await update_webhook_endpoint(
        request, db_session, org_id, webhook_uuid, webhook_object, current_user
    )


@router.delete(
    "/{org_id}/webhooks/{webhook_uuid}",
    summary="Delete a webhook endpoint",
    description="Deletes a webhook endpoint along with all of its delivery logs.",
    responses={
        200: {"description": "Webhook endpoint deleted"},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to delete this webhook"},
        404: {"description": "Webhook endpoint not found"},
    },
)
async def api_delete_webhook_endpoint(
    request: Request,
    org_id: int,
    webhook_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> dict:
    """Delete a webhook endpoint and all its delivery logs."""
    return await delete_webhook_endpoint(
        request, db_session, org_id, webhook_uuid, current_user
    )


@router.post(
    "/{org_id}/webhooks/{webhook_uuid}/regenerate-secret",
    response_model=WebhookEndpointCreatedResponse,
    summary="Regenerate a webhook signing secret",
    description="Regenerates the signing secret for a webhook endpoint. The new secret is only returned once and must be stored securely.",
    responses={
        200: {"description": "Webhook signing secret regenerated", "model": WebhookEndpointCreatedResponse},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to manage this webhook"},
        404: {"description": "Webhook endpoint not found"},
    },
)
async def api_regenerate_webhook_secret(
    request: Request,
    org_id: int,
    webhook_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> WebhookEndpointCreatedResponse:
    """
    Regenerate the signing secret for a webhook endpoint.

    The new secret is only returned once. Store it securely.
    """
    return await regenerate_webhook_secret(
        request, db_session, org_id, webhook_uuid, current_user
    )


@router.post(
    "/{org_id}/webhooks/{webhook_uuid}/test",
    summary="Send a test webhook event",
    description="Sends a synthetic 'ping' event to the webhook endpoint to verify it is reachable and correctly configured.",
    responses={
        200: {"description": "Test event delivered (or attempted) successfully"},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to manage this webhook"},
        404: {"description": "Webhook endpoint not found"},
    },
)
async def api_send_test_event(
    request: Request,
    org_id: int,
    webhook_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> dict:
    """Send a test 'ping' event to verify the webhook endpoint is reachable."""
    return await send_test_event(
        request, db_session, org_id, webhook_uuid, current_user
    )


@router.get(
    "/{org_id}/webhooks/{webhook_uuid}/deliveries",
    response_model=List[WebhookDeliveryLogRead],
    summary="List webhook delivery logs",
    description="Returns recent webhook delivery attempts and their outcomes for the specified endpoint, up to the requested limit.",
    responses={
        200: {"description": "List of webhook delivery log entries", "model": List[WebhookDeliveryLogRead]},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view this webhook"},
        404: {"description": "Webhook endpoint not found"},
    },
)
async def api_get_webhook_deliveries(
    request: Request,
    org_id: int,
    webhook_uuid: str,
    limit: int = 50,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[WebhookDeliveryLogRead]:
    """Get recent delivery logs for a webhook endpoint."""
    return await get_webhook_delivery_logs(
        request, db_session, org_id, webhook_uuid, current_user, limit=limit
    )
