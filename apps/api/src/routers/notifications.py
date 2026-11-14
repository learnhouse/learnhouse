from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.security.api_token_utils import get_authenticated_non_api_token_user
from src.services.notifications import emit as emit_service
from src.services.notifications import notifications as service
from src.services.notifications import push as push_service
from src.services.notifications import realtime

router = APIRouter()

# Personal data: signed-in people only, never API tokens.
CurrentUser = Depends(get_authenticated_non_api_token_user)

Category = Literal[
    "messages", "assignments", "courses", "live",
    "community", "groups", "billing", "boards",
    "teaching", "people", "integrations", "newsletter", "plan", "automation",
]
# "personal" (the learner bell, the mobile app; the default), "admin" (the
# dashboard bell) or "all".
Audience = Literal["personal", "admin", "all"]
Channel = Literal["in_app", "email", "push"]


class MarkRead(BaseModel):
    notification_uuids: list[str] = Field(default_factory=list, max_length=500)
    all: bool = False
    org_id: Optional[int] = None
    category: Optional[Category] = None
    audience: Audience = "personal"


class Bulk(MarkRead):
    action: Literal["read", "unread", "archive", "unarchive", "delete"]


class OrgRoutingUpdate(BaseModel):
    # admin type -> role groups ("admins", "maintainers", "course_authors")
    routing: dict[str, list[Literal["admins", "maintainers", "course_authors"]]]


class DeviceRegister(BaseModel):
    token: str = Field(..., max_length=255, description="Expo push token, `ExponentPushToken[...]`")
    platform: Literal["ios", "android"]
    org_id: Optional[int] = Field(None, description="Only push this org's notifications to the device")
    device_name: str = Field("", max_length=120)
    app_version: str = Field("", max_length=40)


class DeviceUnregister(BaseModel):
    token: str = Field(..., max_length=255)


class PreferencesUpdate(BaseModel):
    push_enabled: Optional[bool] = None
    push_categories: Optional[dict[Category, bool]] = None
    channels: Optional[dict[Category, dict[Channel, bool]]] = None
    email_digest: Optional[Literal["off", "daily", "weekly"]] = None


async def _member(db_session: AsyncSession, user_id: int, org_id: Optional[int]) -> None:
    if org_id is not None:
        from src.security.org_auth import verify_org_membership

        await verify_org_membership(user_id, org_id, db_session)


# ============================================================================
# Inbox
# ============================================================================


@router.get(
    "",
    summary="My notifications",
    description=(
        "The signed-in user's notifications, newest first. Pass `org_id` to see "
        "one organization's. Page with `cursor` (the previous page's `next_cursor`). "
        "Also returns the unread counts. `audience=admin` lists the dashboard's "
        "needs-attention items instead of the personal inbox; `archived=true` "
        "lists the archive; `q` searches titles and bodies."
    ),
)
async def api_list(
    org_id: Optional[int] = None,
    unread_only: bool = False,
    category: Optional[Category] = None,
    cursor: Optional[str] = None,
    limit: int = Query(30, ge=1, le=service.MAX_PAGE),
    audience: Audience = "personal",
    archived: bool = False,
    type: Optional[str] = Query(None, max_length=64),
    important: bool = False,
    q: Optional[str] = Query(None, max_length=100),
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.list_notifications(
        db_session, current_user.id, org_id,
        unread_only=unread_only, category=category, cursor=cursor, limit=limit,
        audience=audience, archived=archived, type_=type, important_only=important, q=q,
    )


@router.get("/unread_count", summary="Unread notification count")
async def api_unread_count(
    org_id: Optional[int] = None,
    audience: Audience = "personal",
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.unread_count(db_session, current_user.id, org_id, audience)


@router.get("/counts", summary="Unread counts for both bells", description="Personal and admin unread counts in one call.")
async def api_counts(
    org_id: Optional[int] = None,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.counts(db_session, current_user.id, org_id)


@router.get(
    "/stream",
    summary="Live notification stream (SSE)",
    description=(
        "Server-sent events for the signed-in user: `hello` (with both unread "
        "counts), `notification.new` (the row) and `notification.changed`. "
        "Pass `org_id` to receive only that organization's events."
    ),
)
async def api_stream(
    request: Request,
    org_id: Optional[int] = None,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    await _member(db_session, current_user.id, org_id)
    hello = {"type": "hello", "counts": await service.counts(db_session, current_user.id, org_id)}
    user_id = current_user.id
    # The stream outlives this request's session: release it now.
    await db_session.close()
    return StreamingResponse(
        realtime.event_stream(user_id, org_id, hello, request.is_disconnected),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/read",
    summary="Mark notifications read",
    description="Mark the listed notifications read, or every unread one with `all: true` (optionally within `org_id` and `category`).",
)
async def api_mark_read(
    body: MarkRead,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.mark_read(
        db_session, current_user.id,
        notification_uuids=body.notification_uuids, all_=body.all,
        org_id=body.org_id, category=body.category, audience=body.audience,
    )


@router.post(
    "/bulk",
    summary="Bulk actions",
    description="Read, unread, archive, unarchive or delete the listed notifications, or every one in the scope with `all: true`.",
)
async def api_bulk(
    body: Bulk,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.bulk(
        db_session, current_user.id, body.action,
        notification_uuids=body.notification_uuids, all_=body.all,
        org_id=body.org_id, category=body.category, audience=body.audience,
    )


# ============================================================================
# Preferences
# ============================================================================


@router.get("/preferences", summary="My push preferences")
async def api_get_preferences(
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.get_preferences(db_session, current_user.id)


@router.put("/preferences", summary="Update my notification preferences")
async def api_update_preferences(
    body: PreferencesUpdate,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.update_preferences(
        db_session, current_user.id, body.push_enabled,
        dict(body.push_categories) if body.push_categories else None,
        channels={k: dict(v) for k, v in body.channels.items()} if body.channels else None,
        email_digest=body.email_digest,
    )


# ============================================================================
# Org routing of admin notifications
# ============================================================================


@router.get(
    "/org/{org_id}/routing",
    summary="Who hears about admin events",
    description="For each admin notification type, the roles that receive it in this organization. Admins and maintainers only.",
)
async def api_get_org_routing(
    org_id: int,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    from src.security.org_auth import require_org_admin

    await require_org_admin(current_user.id, org_id, db_session)
    return await emit_service.get_org_routing(db_session, org_id)


@router.put("/org/{org_id}/routing", summary="Change who hears about admin events")
async def api_update_org_routing(
    org_id: int,
    body: OrgRoutingUpdate,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    from src.security.org_auth import require_org_admin

    await require_org_admin(current_user.id, org_id, db_session)
    return await emit_service.update_org_routing(
        db_session, org_id, {k: [str(r) for r in v] for k, v in body.routing.items()}
    )


# ============================================================================
# Push devices
# ============================================================================


@router.get("/devices", summary="My push devices")
async def api_list_devices(
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await push_service.list_devices(db_session, current_user.id)


@router.post(
    "/devices",
    summary="Register a push device",
    description="Register (or refresh) this device's Expo push token. Call on every app start; a token registered from another account moves to this one.",
)
async def api_register_device(
    body: DeviceRegister,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await push_service.register_device(
        db_session, current_user.id, body.token, body.platform,
        org_id=body.org_id, device_name=body.device_name, app_version=body.app_version,
    )


@router.post(
    "/devices/unregister",
    summary="Unregister a push device",
    description="Stop pushing to this token (call on sign-out, before the session is dropped).",
)
async def api_unregister_device(
    body: DeviceUnregister,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await push_service.unregister_device(db_session, current_user.id, body.token)


# ============================================================================
# One notification
# ============================================================================


@router.post("/{notification_uuid}/read", summary="Mark one notification read")
async def api_mark_one_read(
    notification_uuid: str,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.mark_read(db_session, current_user.id, notification_uuids=[notification_uuid])


@router.post("/{notification_uuid}/unread", summary="Mark one notification unread")
async def api_mark_one_unread(
    notification_uuid: str,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.bulk(db_session, current_user.id, "unread", notification_uuids=[notification_uuid])


@router.post("/{notification_uuid}/archive", summary="Archive one notification")
async def api_archive(
    notification_uuid: str,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.bulk(db_session, current_user.id, "archive", notification_uuids=[notification_uuid])


@router.post("/{notification_uuid}/unarchive", summary="Restore one archived notification")
async def api_unarchive(
    notification_uuid: str,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.bulk(db_session, current_user.id, "unarchive", notification_uuids=[notification_uuid])


@router.delete("/{notification_uuid}", summary="Delete one notification")
async def api_delete(
    notification_uuid: str,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.delete_notification(db_session, current_user.id, notification_uuid)
