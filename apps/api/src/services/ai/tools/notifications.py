"""Notification tools: the caller's own inbox and settings, and the org's
routing of admin notifications.

The inbox and preferences are personal data, so like their HTTP routes they
refuse API tokens (``api_tokens=False``): Atlas and signed-in MCP clients
read the person's own notifications, a token made by someone never does.
The routing of admin events is org configuration: admins and maintainers,
API tokens included when their creator is one.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from src.security.auth import resolve_acting_user_id
from src.security.rbac import AccessAction
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec
from src.services.notifications import emit as emit_service
from src.services.notifications import notifications as service

Category = Optional[Literal[
    "messages", "assignments", "courses", "live", "community", "groups", "billing", "boards",
    "teaching", "people", "integrations", "newsletter", "plan", "automation",
]]


def _brief(item: dict) -> dict:
    return {k: item.get(k) for k in (
        "notification_uuid", "type", "category", "audience", "title", "body", "count",
        "read", "important", "created_at", "path",
    )} | {"actor": (item.get("actor") or {}).get("name")}


class ListNotificationsParams(BaseModel):
    audience: Literal["personal", "admin"] = Field(
        "personal",
        description="personal: your own inbox (grades, replies, live sessions…); admin: things that need your attention as an admin or teacher.",
    )
    unread_only: bool = Field(True, description="Only unread notifications.")
    category: Category = Field(None, description="Only one category.")
    q: Optional[str] = Field(None, max_length=100, description="Search titles and bodies.")
    limit: int = Field(20, ge=1, le=50)


async def _list(ctx: ToolContext, p: ListNotificationsParams) -> dict[str, Any]:
    page = await service.list_notifications(
        ctx.db_session, resolve_acting_user_id(ctx.user), ctx.org.id,
        unread_only=p.unread_only, category=p.category, limit=p.limit, audience=p.audience, q=p.q,
    )
    base = await refs.web_base(ctx)
    return {
        "unread_count": page["unread_count"],
        "unread_important": page.get("unread_important", 0),
        "unread_by_category": {k: v for k, v in page["unread_by_category"].items() if v},
        "items": [
            {**_brief(i), "url": f"{base}{i['path']}" if base and i.get("path") else None}
            for i in page["items"]
        ],
        "more": bool(page["next_cursor"]),
        "url": f"{base}{'/dash/notifications' if p.audience == 'admin' else '/notifications'}" if base else None,
    }


class MarkReadParams(BaseModel):
    notification_uuids: list[str] = Field(default_factory=list, max_length=200)
    all: bool = Field(False, description="Mark every unread notification of the audience read.")
    audience: Literal["personal", "admin"] = "personal"


async def _mark_read(ctx: ToolContext, p: MarkReadParams) -> dict[str, Any]:
    out = await service.mark_read(
        ctx.db_session, resolve_acting_user_id(ctx.user),
        notification_uuids=p.notification_uuids, all_=p.all, org_id=ctx.org.id, audience=p.audience,
    )
    return {"marked": out["marked"], "unread_count": out["unread_count"]}


class NoParams(BaseModel):
    pass


async def _preferences(ctx: ToolContext, _p: NoParams) -> dict[str, Any]:
    view = await service.get_preferences(ctx.db_session, resolve_acting_user_id(ctx.user))
    base = await refs.web_base(ctx)
    return {
        "email_digest": view["email_digest"],
        "push_enabled": view["push_enabled"],
        "channels": view["channels"],
        "url": f"{base}/account/notifications" if base else None,
    }


async def _require_staff(ctx: ToolContext, _p: BaseModel) -> str | None:
    from src.security.org_auth import is_org_admin

    if await is_org_admin(resolve_acting_user_id(ctx.user), ctx.org.id, ctx.db_session):
        return None
    return "Only organization admins and maintainers can see or change who is notified about admin events."


async def _routing(ctx: ToolContext, _p: NoParams) -> dict[str, Any]:
    return await emit_service.get_org_routing(ctx.db_session, ctx.org.id)


class UpdateRoutingParams(BaseModel):
    routing: dict[str, list[Literal["admins", "maintainers", "course_authors"]]] = Field(
        ...,
        description="Admin notification type -> role groups that receive it, e.g. {\"submission_to_grade\": [\"course_authors\", \"admins\"]}. Types left out keep their setting.",
    )


async def _update_routing(ctx: ToolContext, p: UpdateRoutingParams) -> dict[str, Any]:
    return await emit_service.update_org_routing(
        ctx.db_session, ctx.org.id, {k: [str(r) for r in v] for k, v in p.routing.items()}
    )


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_my_notifications",
        title="My notifications",
        description=(
            "Your own notifications in this organization, newest first: grades, replies, mentions, live sessions, "
            "course news (audience=personal) or what needs your attention as an admin or teacher: submissions to "
            "grade, join requests, sync errors, plan limits (audience=admin). Signed-in people only."
        ),
        params_model=ListNotificationsParams,
        tier=ActionTier.READ,
        rights_bucket=None,
        access_action=AccessAction.READ,
        execute=_list,
        idempotent=True,
        api_tokens=False,
    ),
    ToolSpec(
        name="mark_notifications_read",
        title="Mark notifications read",
        description="Mark some of your notifications read (by uuid), or all of one audience with all=true.",
        params_model=MarkReadParams,
        tier=ActionTier.EDIT,
        rights_bucket=None,
        access_action=AccessAction.READ,
        execute=_mark_read,
        idempotent=True,
        api_tokens=False,
        # Only touches the caller's own inbox.
        approval=False,
    ),
    ToolSpec(
        name="get_my_notification_settings",
        title="My notification settings",
        description="Your notification settings: in-app, email and push per category, the email digest and push on/off.",
        params_model=NoParams,
        tier=ActionTier.READ,
        rights_bucket=None,
        access_action=AccessAction.READ,
        execute=_preferences,
        idempotent=True,
        api_tokens=False,
    ),
    ToolSpec(
        name="get_notification_routing",
        title="Who is notified about admin events",
        description="For each admin notification type (submissions to grade, join requests, sync errors…), which roles receive it in this organization.",
        params_model=NoParams,
        tier=ActionTier.READ,
        rights_bucket=None,
        access_action=AccessAction.READ,
        execute=_routing,
        preflight=_require_staff,
        access="admin",
        idempotent=True,
    ),
    ToolSpec(
        name="update_notification_routing",
        title="Change who is notified about admin events",
        description="Choose which roles (admins, maintainers, course_authors) receive each admin notification type.",
        params_model=UpdateRoutingParams,
        tier=ActionTier.EDIT,
        rights_bucket=None,
        access_action=AccessAction.UPDATE,
        execute=_update_routing,
        preflight=_require_staff,
        access="admin",
        idempotent=True,
    ),
]
