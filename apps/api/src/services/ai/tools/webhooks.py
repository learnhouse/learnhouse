"""Webhook and integration tools: where the organization sends its events.

Webhook endpoints (made by hand, or by Zapier when a Zap subscribes) receive
signed POSTs for the events they subscribe to. These tools run the webhook
service the dashboard uses: org admins only (an API token acts for the admin
who created it, and also needs its own ``organizations`` right), the Pro
plan's ``webhooks`` feature, the endpoint cap and the URL safety checks.

Creating an endpoint or pointing one at a new URL sends organization data
outside LearnHouse, so it needs approval; the signing secret is returned once,
on creation.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field

from src.db.webhooks import WebhookEndpointCreate, WebhookEndpointUpdate
from src.security.rbac import AccessAction
from src.services.ai.tools import refs, results
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec
from src.services.ai.tools.results import Paging
from src.services.webhooks.events import WEBHOOK_EVENTS
from src.services.webhooks.webhooks import (
    create_webhook_endpoint,
    delete_webhook_endpoint,
    get_webhook_delivery_logs,
    get_webhook_endpoint,
    get_webhook_endpoints,
    send_test_event,
    update_webhook_endpoint,
)


async def _url(ctx: ToolContext) -> str | None:
    base = await refs.web_base(ctx)
    return f"{base}/dash/org/settings/webhooks" if base else None


def _row(w) -> dict[str, Any]:
    return {
        "webhook_uuid": w.webhook_uuid,
        "url": w.url,
        "description": w.description or None,
        "events": list(w.events or []),
        "active": bool(w.is_active),
        "source": w.source,
        "zap_name": w.zap_name or None,
        "created_at": w.creation_date,
    }


class ListWebhooksParams(Paging):
    source: Optional[str] = Field(None, max_length=20, description="Only endpoints from this source: manual or zapier.")


class WebhookIdParams(BaseModel):
    webhook_uuid: str = Field(..., max_length=100, description="The endpoint, e.g. webhook_...")


class WebhookDeliveriesParams(BaseModel):
    webhook_uuid: str = Field(..., max_length=100, description="The endpoint.")
    limit: int = Field(20, ge=1, le=50, description="How many recent deliveries, newest first.")
    failed_only: bool = Field(False, description="Only failed deliveries.")


class CreateWebhookParams(BaseModel):
    url: str = Field(..., min_length=8, max_length=2048, description="HTTPS URL that receives the POSTs.")
    events: list[str] = Field(..., min_length=1, max_length=60, description="Event names (list_webhook_events).")
    description: Optional[str] = Field(None, max_length=500, description="What it is for.")


class UpdateWebhookParams(BaseModel):
    webhook_uuid: str = Field(..., max_length=100, description="The endpoint to change.")
    url: Optional[str] = Field(None, min_length=8, max_length=2048, description="New URL. Needs approval.")
    events: Optional[list[str]] = Field(None, min_length=1, max_length=60, description="New event list. Needs approval.")
    description: Optional[str] = Field(None, max_length=500)
    active: Optional[bool] = Field(None, description="Pause (false) or resume (true) deliveries.")


class NoParams(BaseModel):
    pass


async def _list_webhooks(ctx: ToolContext, p: ListWebhooksParams):
    rows = await get_webhook_endpoints(ctx.request, ctx.db_session, ctx.org.id, ctx.user)
    if p.source:
        rows = [w for w in rows if w.source == p.source]
    return results.page_of([_row(w) for w in rows], p, url=await _url(ctx))


async def _list_webhook_events(ctx: ToolContext, p: NoParams):
    return {
        "events": [
            {"name": name, "category": e.get("category"), "description": e.get("description")}
            for name, e in WEBHOOK_EVENTS.items()
        ]
    }


async def _get_webhook_deliveries(ctx: ToolContext, p: WebhookDeliveriesParams):
    endpoint = await get_webhook_endpoint(ctx.request, ctx.db_session, ctx.org.id, p.webhook_uuid, ctx.user)
    logs = await get_webhook_delivery_logs(ctx.request, ctx.db_session, ctx.org.id, p.webhook_uuid, ctx.user, limit=50)
    if p.failed_only:
        logs = [log for log in logs if not log.success]
    items = [
        {
            "event": log.event_name,
            "delivery_uuid": log.delivery_uuid,
            "success": log.success,
            "status": log.response_status,
            "attempt": log.attempt,
            "error": results.clip(log.error_message or None),
            "at": log.created_at,
        }
        for log in logs[: p.limit]
    ]
    failed = sum(1 for log in logs if not log.success)
    return {"webhook": _row(endpoint), "items": items, "recent_failures": failed, "url": await _url(ctx)}


async def _create_webhook(ctx: ToolContext, p: CreateWebhookParams):
    created = await create_webhook_endpoint(
        ctx.request, ctx.db_session, ctx.org.id,
        WebhookEndpointCreate(url=p.url, events=p.events, description=p.description), ctx.user,
    )
    return results.changed(
        f"Created a webhook to {created.url} for {len(created.events)} event(s). The signing secret is shown "
        "only now: give it to whoever verifies the signatures.",
        webhook={"webhook_uuid": created.webhook_uuid, "url": created.url, "events": created.events},
        signing_secret=created.secret,
    )


async def _update_webhook(ctx: ToolContext, p: UpdateWebhookParams):
    patch = {
        k: v for k, v in {"url": p.url, "events": p.events, "description": p.description, "is_active": p.active}.items()
        if v is not None
    }
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to change: pass at least one field.")
    updated = await update_webhook_endpoint(
        ctx.request, ctx.db_session, ctx.org.id, p.webhook_uuid, WebhookEndpointUpdate(**patch), ctx.user
    )
    return results.changed(f"Updated webhook {updated.webhook_uuid} ({', '.join(patch)}).", webhook=_row(updated))


async def _test_webhook(ctx: ToolContext, p: WebhookIdParams):
    outcome = await send_test_event(ctx.request, ctx.db_session, ctx.org.id, p.webhook_uuid, ctx.user)
    return results.changed(f"Sent a test ping to webhook {p.webhook_uuid}.", result=outcome)


async def _delete_webhook(ctx: ToolContext, p: WebhookIdParams):
    endpoint = await get_webhook_endpoint(ctx.request, ctx.db_session, ctx.org.id, p.webhook_uuid, ctx.user)
    await delete_webhook_endpoint(ctx.request, ctx.db_session, ctx.org.id, p.webhook_uuid, ctx.user)
    note = " The Zap that made it stops receiving events." if endpoint.source == "zapier" else ""
    return results.changed(f"Deleted the webhook to {endpoint.url}.{note}", webhook={"webhook_uuid": p.webhook_uuid})


def _spec(name: str, **kw: Any) -> ToolSpec:
    kw.setdefault("rights_bucket", "organizations")
    kw.setdefault("access", "admin")
    return ToolSpec(name=name, **kw)


SPECS: list[ToolSpec] = [
    _spec(
        "list_webhooks",
        title="List webhooks",
        description="The organization's webhook endpoints (manual and Zapier): URL, subscribed events, active or paused. Admins.",
        params_model=ListWebhooksParams, tier=ActionTier.READ, access_action=AccessAction.READ,
        execute=_list_webhooks, idempotent=True,
    ),
    _spec(
        "list_webhook_events",
        title="List webhook events",
        description="Every event a webhook can subscribe to, with its category and what triggers it.",
        params_model=NoParams, tier=ActionTier.READ, access_action=AccessAction.READ,
        execute=_list_webhook_events, idempotent=True, access="read", rights_bucket=None,
    ),
    _spec(
        "get_webhook_deliveries",
        title="Webhook deliveries",
        description="Recent deliveries of one webhook endpoint: event, success, HTTP status, error. Use it to debug a failing integration.",
        params_model=WebhookDeliveriesParams, tier=ActionTier.READ, access_action=AccessAction.READ,
        execute=_get_webhook_deliveries, idempotent=True,
    ),
    _spec(
        "create_webhook",
        title="Create a webhook",
        description="Send the chosen events to a URL as signed POSTs. Returns the signing secret once. Needs approval.",
        params_model=CreateWebhookParams, tier=ActionTier.CREATE, access_action=AccessAction.UPDATE,
        execute=_create_webhook, approval=True,
        summarize=lambda p: f"Send {', '.join(p.events)} events to {p.url}",
    ),
    _spec(
        "update_webhook",
        title="Update a webhook",
        description="Change a webhook's URL, events or description, or pause / resume it. A new URL or new events need approval.",
        params_model=UpdateWebhookParams, tier=ActionTier.EDIT, access_action=AccessAction.UPDATE,
        execute=_update_webhook, approval_if=lambda p: p.url is not None or p.events is not None, idempotent=True,
        summarize=lambda p: f"Update webhook {p.webhook_uuid}: " + ", ".join(p.model_dump(exclude={"webhook_uuid"}, exclude_none=True) or ["nothing"]),
    ),
    _spec(
        "send_test_webhook",
        title="Test a webhook",
        description="Send a test ping event to a webhook endpoint and record the delivery.",
        params_model=WebhookIdParams, tier=ActionTier.EDIT, access_action=AccessAction.UPDATE,
        execute=_test_webhook, summarize=lambda p: f"Send a test ping to webhook {p.webhook_uuid}",
    ),
    _spec(
        "delete_webhook",
        title="Delete a webhook",
        description="Delete a webhook endpoint (manual or Zapier) and its delivery log.",
        params_model=WebhookIdParams, tier=ActionTier.DESTRUCTIVE, access_action=AccessAction.DELETE,
        execute=_delete_webhook, summarize=lambda p: f"Delete webhook {p.webhook_uuid}",
    ),
]
